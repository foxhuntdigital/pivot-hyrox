/**
 * Fills `workout_archetype` (migration 0024) for the strength library.
 *
 * The column says what kind of strength session a template is: foundational
 * (repeatable anchors progressed week to week), athletic (power and force
 * expression), complex (integrated and offset loading) or mixed (foundational
 * anchors plus athletic or complex work). The planner reads it to keep a week's
 * strength slots doing the job the phase needs, rather than rotating the
 * foundational overload away.
 *
 * Derived, not hand-typed, from what the session prescribes. Every exercise in
 * the strength library carries an authored `methodology_bucket` (migration
 * 0014) that lines up with three of the four archetypes:
 *
 *   foundational_repeatable    → foundational
 *   athletic_power_plyometric  → athletic
 *   complex_specific_novel     → complex
 *
 * A session is read from those buckets, with its opening lift weighted as the
 * anchor that sets its purpose:
 *
 *   athletic      at least 60% of its classified exercises are athletic
 *   complex       at least 60% are complex
 *   mixed         it opens on an athletic or complex lift (a primer before the
 *                 anchors), or at least 40% of it is not foundational
 *   foundational  otherwise
 *
 * The thresholds exist because the buckets are per exercise and a session is
 * more than its accessories: a single-leg RDL is filed athletic, and a hinge
 * session that finishes with one is still a foundational session.
 *
 * A ruling the rule gets wrong goes in data/archetype-overrides.json, keyed by
 * template id, with the reason. The override wins and the report says so.
 *
 * Only `training_domain = 'strength'` is labelled. Migration 0024 defines no
 * other domain's vocabulary yet, and a null is "no rotation preference", which
 * is the honest value for everything else.
 *
 * Writes data/review/archetype.report.csv: every strength template, its
 * buckets, the rule's answer and the value written.
 *
 *   node scripts/apply-archetypes.mjs [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { deriveArchetype, STRENGTH_ARCHETYPES as VOCABULARY } from './lib/archetype.mjs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const OVERRIDES = new URL('../data/archetype-overrides.json', import.meta.url);
const REPORT = new URL('../data/review/archetype.report.csv', import.meta.url);
const quiet = process.argv.includes('--quiet');

const COLUMN = 'workout_archetype';
const BUCKET = {
  foundational_repeatable: 'foundational',
  athletic_power_plyometric: 'athletic',
  complex_specific_novel: 'complex',
};

let sql = readFileSync(SRC, 'utf8');

function splitValues(body) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") { cur += "'"; i++; }
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const unquote = v => (v === 'NULL' || v === undefined)
  ? null
  : v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;

const quote = v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

/** Column order for a table, from the dump's own CREATE TABLE. */
function columnsOf(table) {
  const m = sql.match(new RegExp(`CREATE TABLE ${table}\\(([^)]*)\\);`));
  if (!m) throw new Error(`${table} CREATE TABLE not found`);
  return m[1].split(',').map(c => c.trim().split(/\s+/)[0]);
}

function rowsOf(table) {
  const cols = columnsOf(table);
  return [...sql.matchAll(new RegExp(`INSERT INTO "${table}" VALUES\\((.*)\\);`, 'g'))]
    .map(m => {
      const vals = splitValues(m[1]).map(unquote);
      return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? null]));
    });
}

// ── Schema ───────────────────────────────────────────────────────────────────

// Appended, like 0023's demand columns, and then found by NAME below: a column
// located by counting from the end is how apply-classification once wrote the
// domain into `status` after a later migration added columns behind it.
const createRe = /CREATE TABLE workout_templates\(([^)]*)\);/;
const create = sql.match(createRe);
if (!create) throw new Error('workout_templates CREATE TABLE not found');
if (!new RegExp(`\\b${COLUMN}\\b`).test(create[1])) {
  sql = sql.replace(createRe, `CREATE TABLE workout_templates(${create[1]},${COLUMN} TEXT);`);
  sql = sql.replace(/INSERT INTO "workout_templates" VALUES\((.*)\);/g,
    (_, body) => `INSERT INTO "workout_templates" VALUES(${body},NULL);`);
}
const templateCols = columnsOf('workout_templates');
const AT = templateCols.indexOf(COLUMN);

// ── Evidence ─────────────────────────────────────────────────────────────────

const bucketOf = new Map(rowsOf('exercises').map(e => [e.id, BUCKET[e.methodology_bucket] ?? null]));
const nameOf = new Map(rowsOf('exercises').map(e => [e.id, e.name]));
const blockWorkout = new Map(rowsOf('workout_blocks').map(b => [b.id, b.workout_id]));
const blockOrder = new Map(rowsOf('workout_blocks').map(b => [b.id, Number(b.block_order)]));

/** Per workout: its exercises' archetypes, in the order they are performed. */
const sequence = new Map();
for (const be of rowsOf('block_exercises')
  .sort((a, b) => (blockOrder.get(a.block_id) ?? 0) - (blockOrder.get(b.block_id) ?? 0)
    || Number(a.sequence_order) - Number(b.sequence_order))) {
  const id = blockWorkout.get(be.block_id);
  if (!id) continue;
  sequence.set(id, [...(sequence.get(id) ?? []), { exercise_id: be.exercise_id, kind: bucketOf.get(be.exercise_id) ?? null }]);
}

// ── Apply ────────────────────────────────────────────────────────────────────

const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8')).overrides ?? {};
for (const [id, o] of Object.entries(overrides)) {
  if (!VOCABULARY.includes(o.workout_archetype)) {
    throw new Error(`override ${id}: ${JSON.stringify(o.workout_archetype)} is not in the strength vocabulary`);
  }
}

const report = [['id', 'name', 'workout_family', 'exercises', 'derived', 'override', 'written']];
const counts = {};

sql = sql.replace(/INSERT INTO "workout_templates" VALUES\((.*)\);/g, (whole, body) => {
  const vals = splitValues(body);
  const row = Object.fromEntries(templateCols.map((c, i) => [c, unquote(vals[i])]));
  // Everything outside the strength domain is cleared rather than left as it
  // was, so a template that moves domain does not keep a strength label.
  let value = null;
  if (row.training_domain === 'strength') {
    const items = sequence.get(row.id) ?? [];
    const derived = deriveArchetype(items.map(i => i.kind));
    const override = overrides[row.id]?.workout_archetype ?? null;
    value = override ?? derived;
    counts[value] = (counts[value] ?? 0) + 1;
    report.push([
      row.id, row.name, row.workout_family,
      items.map(i => `${nameOf.get(i.exercise_id) ?? i.exercise_id} (${i.kind ?? '?'})`).join('; '),
      derived ?? '', override ?? '', value ?? '',
    ]);
  }
  vals[AT] = quote(value);
  return `INSERT INTO "workout_templates" VALUES(${vals.join(',')});`;
});

writeFileSync(SRC, sql);
writeFileSync(REPORT, report
  .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
  .join('\n') + '\n');

if (!quiet) {
  console.log(`labelled ${report.length - 1} strength templates`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
  console.log(`\n  ${report.length - 1} rows -> data/review/archetype.report.csv`);
}
