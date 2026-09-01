/**
 * Retires templates in the seed dump: kept for the history that references
 * them, never scheduled again (migration 0016).
 *
 * Retirement is content authoring, so it lands in the dump both generators read
 * rather than in the generated files. Idempotent: re-running restates the same
 * status, and a retirement removed from the ruling file is lifted rather than
 * left behind, so this file is the whole answer to "what is retired".
 *
 * ── What it refuses ─────────────────────────────────────────────────────────
 *
 *   * an id that is not a template — the likeliest typo, and one that would
 *     otherwise retire nothing while reporting success;
 *   * a successor that does not exist, or that is itself retired, because
 *     "superseded by something that is also gone" answers nothing;
 *   * a template retiring itself.
 *
 * A retirement with no successor is refused by the migration's own constraint;
 * it is refused here too, so the failure arrives while the author is looking.
 *
 *   node scripts/retire-templates.mjs [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const RULING = new URL('../data/template-retirements.json', import.meta.url);
const quiet = process.argv.includes('--quiet');

/** Column name and SQLite storage type, in the order they are appended. */
const ADDED = [['status', 'TEXT'], ['superseded_by', 'TEXT']];

let sql = readFileSync(SRC, 'utf8');
const ruling = JSON.parse(readFileSync(RULING, 'utf8'));

const q = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

function splitValues(body) {
  const out = []; let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { cur += ch; if (ch === "'") { if (body[i + 1] === "'") { cur += "'"; i++; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unquote = v => (v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v === 'NULL' ? null : v);

// ── Schema ───────────────────────────────────────────────────────────────────

const createRe = /CREATE TABLE workout_templates\(([^)]*)\);/;
const create = sql.match(createRe);
if (!create) throw new Error('workout_templates CREATE TABLE not found in the dump');

const present = ADDED.filter(([n]) => new RegExp(`\\b${n}\\b`).test(create[1]));
if (present.length && present.length !== ADDED.length) {
  throw new Error(`dump is half-migrated: has ${present.map(c => c[0]).join(', ')}`);
}
const widening = !present.length;
if (widening) {
  sql = sql.replace(createRe, `CREATE TABLE workout_templates(${create[1]},`
    + ADDED.map(([n, t]) => `${n} ${t}`).join(',') + ');');
}

// ── Rows ─────────────────────────────────────────────────────────────────────

const rowRe = /INSERT INTO "workout_templates" VALUES\(([\s\S]*?)\);/g;
const ids = new Set();
for (const m of sql.matchAll(rowRe)) ids.add(unquote(splitValues(m[1])[0]));

const errors = [];
const byId = new Map();
for (const r of ruling.retirements ?? []) {
  if (!ids.has(r.id)) { errors.push(`${r.id}: not a template in the dump`); continue; }
  if (!r.superseded_by) { errors.push(`${r.id}: retirement needs a superseded_by`); continue; }
  if (r.superseded_by === r.id) { errors.push(`${r.id}: cannot supersede itself`); continue; }
  if (!ids.has(r.superseded_by)) {
    errors.push(`${r.id}: superseded_by "${r.superseded_by}" is not a template in the dump`);
    continue;
  }
  byId.set(r.id, r);
}
for (const r of byId.values()) {
  if (byId.has(r.superseded_by)) {
    errors.push(`${r.id}: superseded by ${r.superseded_by}, which is itself retired`);
  }
}
if (errors.length) {
  console.error('Refusing to apply retirements:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const applied = [], lifted = [];
sql = sql.replace(rowRe, (whole, body) => {
  const values = splitValues(body);
  const id = unquote(values[0]);
  const base = widening ? values : values.slice(0, values.length - ADDED.length);
  const wasStatus = widening ? null : unquote(values[values.length - 2]);
  const r = byId.get(id);

  if (r) {
    applied.push(r);
    return `INSERT INTO "workout_templates" VALUES(${[...base, q('retired'), q(r.superseded_by)].join(',')});`;
  }
  // Not in the ruling file: eligible. A template previously retired and since
  // removed from the file is lifted, so the file is the whole answer.
  if (wasStatus === 'retired') lifted.push(id);
  return `INSERT INTO "workout_templates" VALUES(${[...base, q('content_eligible'), 'NULL'].join(',')});`;
});

writeFileSync(SRC, sql);

if (!quiet) {
  if (widening) console.log('added status + superseded_by to workout_templates\n');
  console.log(`${applied.length} template(s) retired:`);
  for (const r of applied) console.log(`  ${r.id.padEnd(24)} -> ${r.superseded_by}`);
  if (lifted.length) {
    console.log(`\n${lifted.length} lifted back to content_eligible: ${lifted.join(', ')}`);
  }
  console.log(`\n${ids.size - applied.length} of ${ids.size} templates remain schedulable.`);
  console.log('\nNow run: node scripts/convert-seed.mjs && node scripts/build-fixtures.mjs');
}
