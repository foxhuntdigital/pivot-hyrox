/**
 * Applies a reviewed demand changeset to the seed dump.
 *
 * `data/adaptive_athlete_schema_and_seed.sql` is the authoring source of truth:
 * supabase/seed/01_content.sql is generated from it by convert-seed.mjs, and
 * tests/engine-fixtures + the mobile bundle by build-fixtures.mjs. So grades
 * land here and are regenerated outward, never typed into a generated file.
 *
 * Separate from ingest-demand-sheet.mjs on purpose. That one reads a sheet and
 * reports; this one writes 239 rows of the content library. Splitting them is
 * what makes the changeset reviewable before it is a mutation.
 *
 * ── Widening workout_templates ─────────────────────────────────────────────
 *
 * Migration 0023 added load_demand and technical_demand to Postgres, but the
 * SQLite dump those generators read has its own CREATE TABLE and does not know
 * about them. This adds the two columns and back-fills every existing row with
 * NULL — the same self-migrating idiom import-workouts.mjs uses for the columns
 * 0011 and 0013 added, and for the same reason: the dump is written positionally
 * by several scripts, so the column has to exist before anything writes a value
 * into it.
 *
 * NULL is the correct back-fill and the correct value for anything ungraded.
 * Every rule that reads these treats null as "unknown, do not constrain", so a
 * supplemental or retired template keeps behaving exactly as it does today.
 *
 *   node scripts/apply-demand-changeset.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SEED = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const CHANGESET = new URL('../data/review/demand-library.v1.changeset.json', import.meta.url);
const dryRun = process.argv.includes('--dry-run');

const NEW_COLUMNS = ['technical_demand', 'load_demand'];

const changeset = JSON.parse(readFileSync(CHANGESET, 'utf8'));
if (changeset.problems?.length) {
  throw new Error(`changeset reports ${changeset.problems.length} problem(s); resolve them first`);
}
let sql = readFileSync(SEED, 'utf8');

/* ---------- raw value handling (quoting preserved) ---------- */

/** Splits a VALUES body on top-level commas, KEEPING each value's raw text. */
function splitRaw(body) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") { cur += "'"; i++; continue; }
        inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '' || out.length) out.push(cur.trim());
  return out;
}
const unquote = v => (v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v === 'NULL' ? null : v);
const q = v =>
  v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? (v ? '1' : '0')
  : `'${String(v).replace(/'/g, "''")}'`;

/** Column names of one CREATE TABLE in the dump. */
function columnsOf(table) {
  const m = sql.match(new RegExp(`CREATE TABLE ${table}\\(([\\s\\S]*?)\\);`));
  if (!m) throw new Error(`${table}: CREATE TABLE not found`);
  const items = [];
  let depth = 0, cur = '';
  for (const ch of m[1]) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items.filter(c => !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(c))
    .map(c => c.split(/\s+/)[0]);
}

/** Rewrites every INSERT row of a table through `fn(values, columns)`. */
function rewriteRows(table, fn) {
  const cols = columnsOf(table);
  let touched = 0;
  sql = sql.replace(
    new RegExp(`INSERT INTO "${table}" VALUES\\(([\\s\\S]*?)\\);\\n`, 'g'),
    (whole, body) => {
      const raw = splitRaw(body);
      if (raw.length !== cols.length) {
        throw new Error(`${table}: row has ${raw.length} values for ${cols.length} columns`);
      }
      const next = fn(raw, cols);
      if (!next) return whole;
      touched++;
      return `INSERT INTO "${table}" VALUES(${next.join(',')});\n`;
    });
  return touched;
}

/* ---------- 1. widen workout_templates ---------- */

const existing = columnsOf('workout_templates');
const missing = NEW_COLUMNS.filter(c => !existing.includes(c));
if (missing.length) {
  if (missing.length !== NEW_COLUMNS.length) {
    throw new Error(`workout_templates has ${NEW_COLUMNS.length - missing.length} of the two `
      + 'demand columns; the dump is half-migrated and this script will not guess');
  }
  // Rows first, then the schema. rewriteRows checks each row against the column
  // list currently in the file, so widening the CREATE TABLE first would make
  // every existing row look two values short and abort the migration.
  const backfilled = rewriteRows('workout_templates', raw => [...raw, ...NEW_COLUMNS.map(() => 'NULL')]);
  sql = sql.replace(/CREATE TABLE workout_templates\(([\s\S]*?)\);/,
    (whole, body) => `CREATE TABLE workout_templates(${body},`
      + `${NEW_COLUMNS.map(c => `${c} INTEGER`).join(',')});`);
  console.log(`added ${NEW_COLUMNS.join(' + ')} to workout_templates (${backfilled} rows back-filled NULL)`);
} else {
  console.log('workout_templates already carries both demand columns');
}

/* ---------- 2. write the grades ---------- */

const grades = Object.fromEntries(changeset.grades.map(g => [g.template_id, g]));
const seen = new Set();
const cols = columnsOf('workout_templates');
const iTech = cols.indexOf('technical_demand');
const iLoad = cols.indexOf('load_demand');

rewriteRows('workout_templates', raw => {
  const id = unquote(raw[0]);
  const g = grades[id];
  if (!g) return null;
  seen.add(id);
  const next = [...raw];
  next[iTech] = q(g.technical_demand);
  next[iLoad] = q(g.load_demand);
  return next;
});
const unwritten = Object.keys(grades).filter(id => !seen.has(id));
if (unwritten.length) throw new Error(`graded templates absent from the dump: ${unwritten.join(', ')}`);
console.log(`graded ${seen.size} templates`);

/* ---------- 3. apply the prescription deltas ---------- */

/* Blocks and items are addressed the way the changeset describes them —
 * workout_id + block_order, then block_id + sequence_order — rather than by row
 * id, so a delta cannot silently land on the wrong row if ids ever change. */
const blockCols = columnsOf('workout_blocks');
const itemCols = columnsOf('block_exercises');

const blockIdOf = {};
for (const m of sql.matchAll(/INSERT INTO "workout_blocks" VALUES\(([\s\S]*?)\);\n/g)) {
  const v = splitRaw(m[1]).map(unquote);
  blockIdOf[`${v[blockCols.indexOf('workout_id')]}#${v[blockCols.indexOf('block_order')]}`] =
    v[blockCols.indexOf('id')];
}

const blockSets = new Map();   // block_id -> { column: value }
const itemSets = new Map();    // `${block_id}#${sequence_order}` -> { column: value }
let applied = 0, skipped = 0;

for (const edit of changeset.prescription_edits ?? []) {
  for (const d of edit.deltas) {
    if (!d.applicable) { skipped++; continue; }
    const blockId = blockIdOf[`${edit.template_id}#${d.block_order}`];
    if (!blockId) throw new Error(`${edit.template_id}: no block ${d.block_order} in the dump`);

    if (d.change.startsWith('block.')) {
      const col = d.change.slice('block.'.length);
      if (!blockCols.includes(col)) throw new Error(`workout_blocks has no column ${col}`);
      const target = blockSets.get(blockId) ?? {};
      target[col] = d.to;
      blockSets.set(blockId, target);
      applied++;
      continue;
    }

    const key = `${blockId}#${d.sequence_order}`;
    const target = itemSets.get(key) ?? {};
    if (d.change === 'item.exercise') {
      if (!d.exercise_id) throw new Error(`${edit.template_id}: exercise delta without a resolved id`);
      target.exercise_id = d.exercise_id;
    } else if (d.change === 'item.intensity_note') {
      target.intensity_note = d.to;
    } else if (d.change === 'item.rest_seconds') {
      target.rest_seconds = d.to;
    } else if (d.change === 'item.quantity') {
      // The rendered form is "<quantity> <unit>" for everything except sets_reps,
      // which renders as "<sets>×<reps>" and is refused here rather than guessed:
      // sets, reps_min and reps_max would all have to move together.
      const m = String(d.to).match(/^([\d.]+)\s+(\S.*)$/);
      if (!m) throw new Error(`${edit.template_id}: cannot read quantity ${JSON.stringify(d.to)}`);
      target.quantity = Number(m[1]);
      target.quantity_unit = m[2].trim();
    } else {
      throw new Error(`${edit.template_id}: unhandled delta ${d.change}`);
    }
    itemSets.set(key, target);
    applied++;
  }
}

if (blockSets.size) {
  rewriteRows('workout_blocks', raw => {
    const id = unquote(raw[blockCols.indexOf('id')]);
    const set = blockSets.get(id);
    if (!set) return null;
    const next = [...raw];
    for (const [col, val] of Object.entries(set)) next[blockCols.indexOf(col)] = q(val);
    return next;
  });
}
if (itemSets.size) {
  rewriteRows('block_exercises', raw => {
    const key = `${unquote(raw[itemCols.indexOf('block_id')])}#${unquote(raw[itemCols.indexOf('sequence_order')])}`;
    const set = itemSets.get(key);
    if (!set) return null;
    const next = [...raw];
    for (const [col, val] of Object.entries(set)) next[itemCols.indexOf(col)] = q(val);
    return next;
  });
}
console.log(`applied ${applied} prescription delta(s)`
  + ` across ${blockSets.size} block(s) and ${itemSets.size} item(s)`
  + (skipped ? `, skipped ${skipped} not applicable` : ''));

/* ---------- 4. write ---------- */

if (dryRun) {
  console.log('\n--dry-run: the dump was NOT written');
} else {
  writeFileSync(SEED, sql);
  console.log('\nwrote data/adaptive_athlete_schema_and_seed.sql');
  console.log('regenerate downstream:  npm run seed:build && npm run seed:fixtures');
}
