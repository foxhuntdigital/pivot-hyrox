/**
 * Applies the approved vocabulary to the seed dump. The first thing in this
 * sequence that touches canonical data.
 *
 * Deliberately a separate script from apply-vocabulary.mjs, which promises to
 * write nothing. A flag on that script would have made the promise conditional,
 * and the value of a gate is that it is unconditional — so the gate stays inert
 * and this is the only thing that can move the library.
 *
 * It refuses to run unless the plan is COHERENT with no errors, and it applies
 * only rows marked Approved. Everything else it reports.
 *
 * ── What it will not invent ──────────────────────────────────────────────────
 *
 * `content.exercises` demands seven columns a vocabulary review does not
 * contain. Six are derived from the ontology and every derivation is printed,
 * so a wrong guess is visible as a guess. The seventh, `postpartum_friendly`,
 * is not derived at all: it withholds content when false and exposes it when
 * true, nobody has assessed 180 new movements, and a depth jump defaulting to
 * safe is the one failure here that reaches an athlete's body. New exercises
 * land false and are listed as needing review.
 *
 *   node scripts/write-vocabulary.mjs [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { deriveExerciseColumns } from './lib/exercise-defaults.mjs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const PLAN = new URL('../data/review/vocabulary.apply-plan.json', import.meta.url);
const RULES = new URL('../data/vocabulary-reconcile-rules.json', import.meta.url);
const REPORT = new URL('../data/review/vocabulary.written.json', import.meta.url);
const quiet = process.argv.includes('--quiet');

const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
const rules = JSON.parse(readFileSync(RULES, 'utf8'));

if (plan.status !== 'COHERENT' || plan.errors.length) {
  console.error(`refusing to write: the plan is ${plan.status} with ${plan.errors.length} error(s).`);
  console.error('run: npm run vocab:apply');
  process.exit(1);
}

let sql = readFileSync(SRC, 'utf8');

// ── Dump helpers ────────────────────────────────────────────────────────────

function splitValues(body) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") { if (body[i + 1] === "'") { cur += "'"; i++; } else inStr = false; }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unquote = v => (v === 'NULL' || v === undefined) ? null
  : v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;
const lit = v => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const jsonLit = v => `'${JSON.stringify(v ?? []).replace(/'/g, "''")}'`;
const boolLit = v => (v ? '1' : '0');

function columnsOf(table) {
  const m = sql.match(new RegExp(`CREATE TABLE ${table}\\(([^)]*)\\);`));
  if (!m) throw new Error(`${table} CREATE TABLE not found`);
  return m[1].split(',').map(c => c.trim().split(/\s+/)[0]);
}

/** Adds columns to a table in the dump, if they are not already there. */
function widen(table, added) {
  const re = new RegExp(`CREATE TABLE ${table}\\(([^)]*)\\);`);
  const m = sql.match(re);
  const present = added.filter(([n]) => new RegExp(`\\b${n}\\b`).test(m[1]));
  if (present.length === added.length) return false;
  if (present.length) throw new Error(`${table} is half-migrated`);
  sql = sql.replace(re, `CREATE TABLE ${table}(${m[1]},`
    + added.map(([n, t]) => `${n} ${t}`).join(',') + ');');
  return true;
}

// ── Widen for 0015 ──────────────────────────────────────────────────────────

const EXERCISE_ADDED = [
  ['canonical_name', 'TEXT'], ['aliases', 'TEXT'], ['variant_parent', 'TEXT'],
  ['methodology_bucket', 'TEXT'], ['status', 'TEXT'],
];
const EQUIPMENT_ADDED = [['selection_tier', 'TEXT']];

const exerciseWidened = widen('exercises', EXERCISE_ADDED);
const equipmentWidened = widen('equipment', EQUIPMENT_ADDED);

const exerciseCols = columnsOf('exercises');
const equipmentCols = columnsOf('equipment');
const EX_BASE = exerciseCols.length - EXERCISE_ADDED.length;
const EQ_BASE = equipmentCols.length - EQUIPMENT_ADDED.length;

// ── Existing rows ───────────────────────────────────────────────────────────

const approved = xs => xs.filter(e => e.approved);

/**
 * The three ways an existing exercise can be touched, which are NOT the same.
 *
 *   EXACT_EXISTING   the ontology arrives; the name does not move.
 *   RENAME_EXISTING  the sheet's name becomes the display name, and the one it
 *                    replaces survives as an alias.
 *   ALIAS_EXISTING   the sheet's name is ANOTHER WAY OF SAYING this movement.
 *                    The display name does not move.
 *
 * Collapsing them is how "Incline DB Press" quietly became "Incline DB Bench
 * Press" — product ruled that an alias, and an alias that overwrites the name
 * it was supposed to sit beside is just a rename nobody approved.
 */
const updates = new Map();          // id -> { canonical_name, aliases, ontology }
const touch = (e, { rename }) => {
  const prev = updates.get(e.id);
  updates.set(e.id, {
    // `undefined` means "leave whatever the row already has".
    canonical_name: rename ? e.name : prev?.canonical_name,
    aliases: [...new Set([...(prev?.aliases ?? []), ...e.aliases])],
    ontology: e.ontology ?? prev?.ontology,
  });
};
for (const e of approved(plan.plan.update)) touch(e, { rename: false });
for (const e of approved(plan.plan.alias)) touch(e, { rename: false });
for (const e of approved(plan.plan.rename)) touch(e, { rename: true });

const written = { updated: [], created: [], equipment: [], derived: [], skipped: [] };

sql = sql.replace(/INSERT INTO "exercises" VALUES\((.*)\);/g, (line, body) => {
  const vals = splitValues(body);
  const id = unquote(vals[0]);
  const u = updates.get(id);

  // Widen every row; only the updated ones change value.
  const base = vals.slice(0, EX_BASE);
  const tail = vals.length > EX_BASE ? vals.slice(EX_BASE) : null;

  const existingName = unquote(vals[1]);
  const canonical = u?.canonical_name ?? (tail ? unquote(tail[0]) : existingName);
  // An alias must never be the name it was meant to sit beside.
  if (u && !u.canonical_name && u.aliases.includes(canonical)) {
    throw new Error(`${id}: "${canonical}" is both the display name and an alias`);
  }
  const aliases = u?.aliases ?? (tail ? JSON.parse(unquote(tail[1]) || '[]') : []);
  const bucket = u?.ontology?.methodology_bucket ?? (tail ? unquote(tail[3]) : null);
  const status = tail ? unquote(tail[4]) : 'content_eligible';

  if (u) {
    written.updated.push({
      id, was: existingName, now: canonical,
      renamed: canonical !== existingName,
      aliases,
    });
  }

  return `INSERT INTO "exercises" VALUES(${base.join(',')},`
    + [lit(canonical), jsonLit(aliases), tail ? tail[2] : 'NULL', lit(bucket), lit(status)].join(',')
    + ');';
});

// ── Equipment ───────────────────────────────────────────────────────────────

const equipmentTiers = new Map();
for (const [id, meta] of Object.entries(rules.equipment_new)) {
  if (id === 'note') continue;
  equipmentTiers.set(id, meta);
}

const existingEquipment = new Set(
  [...sql.matchAll(/INSERT INTO "equipment" VALUES\('([^']+)'/g)].map(m => m[1]));

sql = sql.replace(/INSERT INTO "equipment" VALUES\((.*)\);/g, (line, body) => {
  const vals = splitValues(body);
  if (vals.length > EQ_BASE) return line;
  // Everything that predates the vocabulary stays selectable: those checkboxes
  // are already on the onboarding screen and athletes have answered them.
  return `INSERT INTO "equipment" VALUES(${vals.slice(0, EQ_BASE).join(',')},'athlete_selectable');`;
});

const newEquipmentRows = [];
for (const eq of plan.new_equipment) {
  if (existingEquipment.has(eq.id)) continue;
  const meta = equipmentTiers.get(eq.id);
  if (!meta) throw new Error(`no tier ruling for equipment "${eq.id}"`);
  const name = eq.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  newEquipmentRows.push(
    `INSERT INTO "equipment" VALUES('${eq.id}',${lit(name)},${lit(meta.category)},${lit(meta.tier)});`);
  written.equipment.push({ id: eq.id, name, tier: meta.tier, uses: eq.uses });
}
if (newEquipmentRows.length) {
  const anchor = sql.lastIndexOf('INSERT INTO "equipment"');
  const end = sql.indexOf('\n', anchor) + 1;
  sql = sql.slice(0, end) + newEquipmentRows.join('\n') + '\n' + sql.slice(end);
}

// ── New exercises ───────────────────────────────────────────────────────────

const creates = [...approved(plan.plan.create), ...approved(plan.plan.variant)];
const exerciseRows = [];
const equipmentLinks = [];

for (const e of creates) {
  const o = e.ontology ?? {};
  const equipment = (o.equipment ?? []).filter(Boolean);
  const d = deriveExerciseColumns({ ...o, equipment });

  written.derived.push({
    id: e.id, name: e.name,
    impact_level: d.impact_level, modality: d.modality,
    default_unit: d.default_unit, category: d.category,
  });

  exerciseRows.push(`INSERT INTO "exercises" VALUES(${[
    lit(e.id), lit(e.name), lit(d.category), lit(d.movement_pattern), lit(d.modality),
    lit(d.default_unit), lit(d.impact_level), d.hyrox_relevance, boolLit(d.postpartum_friendly),
    'NULL',                                   // notes
    jsonLit(o.movement_families), jsonLit(o.training_qualities), jsonLit(o.movement_characters),
    lit(o.complexity_level), jsonLit(o.exercise_role_eligibility), lit(o.progression_class),
    jsonLit(o.progression_tracks),
    // Family and comparability default to the exercise's own identity: a new
    // movement is its own family until something says otherwise, and a load
    // must never carry to a neighbour by accident.
    lit(e.id.replace(/^ex_/, '')), lit(e.id.replace(/^ex_/, '')),
    lit(e.name), jsonLit(e.aliases), lit(e.parent), lit(o.methodology_bucket), lit('created'),
  ].join(',')});`);

  for (const eq of equipment) {
    equipmentLinks.push(`INSERT INTO "exercise_equipment" VALUES('${e.id}','${eq}',1);`);
  }
  written.created.push({ id: e.id, name: e.name, parent: e.parent, equipment });
}

for (const [rows, table] of [[exerciseRows, 'exercises'], [equipmentLinks, 'exercise_equipment']]) {
  if (!rows.length) continue;
  const anchor = sql.lastIndexOf(`INSERT INTO "${table}"`);
  const end = sql.indexOf('\n', anchor) + 1;
  sql = sql.slice(0, end) + rows.join('\n') + '\n' + sql.slice(end);
}

written.skipped = plan.plan.drop.map(e => ({ name: e.proposed_name ?? e.name, why: 'duplicate candidate' }));

writeFileSync(SRC, sql);
writeFileSync(REPORT, JSON.stringify({
  note: 'What write-vocabulary.mjs actually did. Derived columns are listed because '
    + 'the review did not contain them; postpartum_friendly is false on every new '
    + 'exercise and needs a coaching pass before any of them reaches an athlete who '
    + 'set that consideration.',
  ...written,
}, null, 2) + '\n');

if (!quiet) {
  console.log(`updated  ${written.updated.length} existing exercise(s)`);
  for (const u of written.updated.filter(u => u.renamed)) {
    console.log(`    renamed ${u.id.padEnd(24)} "${u.was}" -> "${u.now}"`);
  }
  for (const u of written.updated.filter(u => !u.renamed && u.aliases.length)) {
    console.log(`    aliased ${u.id.padEnd(24)} + ${JSON.stringify(u.aliases)}`);
  }
  console.log(`\ncreated  ${written.created.length} exercise(s)`);
  console.log(`         ${written.created.filter(c => c.parent).length} of them as variants of an existing movement`);
  console.log(`\nadded    ${written.equipment.length} equipment type(s)`);
  for (const eq of written.equipment) console.log(`    ${eq.id.padEnd(16)} ${eq.tier}`);
  console.log(`\nskipped  ${written.skipped.length} duplicate candidate(s)`);
  console.log(`\nderived columns for ${written.derived.length} new exercise(s) — see the report.`);
  console.log('postpartum_friendly is FALSE on all of them and needs a coaching pass.');
  console.log(`\n  -> data/review/vocabulary.written.json`);
}
