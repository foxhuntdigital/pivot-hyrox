/**
 * Recovers the structured strength prescription the seed already encodes.
 *
 * Before migration 0011 `block_exercises` had two columns for every kind of
 * work — `quantity` and `quantity_unit` — so a set scheme was stored by
 * overloading them: the set count in the number, the rep count in the unit
 * string. `4.0, 'x6'` is four sets of six.
 *
 * Three things followed, all of them visible to the athlete:
 *
 *   * the player renders `${quantity} ${unit}` and shows "4 x6";
 *   * buildSteps emits one step, so four working sets are one tap;
 *   * actuals.ts logs prescribed_reps = quantity = 4 — sets recorded as reps.
 *
 * This reads that encoding back into the columns that can hold it. It is
 * recovery, not authoring: the coach wrote "4 x6" and meant four sets of six,
 * and `parseSetScheme` only ever restates what is already there.
 *
 * REST IS NOT DERIVED. Rest between working sets is what separates strength
 * from density work, it was never in the dump, and a guess would sit behind
 * every future progression decision. Rows are written with rest_seconds NULL
 * and listed in data/review/prescriptions.authoring.json for a coach to
 * answer — the same bucket pattern prepare-pack.mjs uses. Until they are
 * answered the true-strength coverage gate stays red, which is the correct
 * reading of a library that does not yet say how long to rest.
 *
 *   node scripts/apply-prescriptions.mjs [--quiet]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { parseSetScheme } from './lib/prescription.mjs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const REVIEW = new URL('../data/review/prescriptions.authoring.json', import.meta.url);
const quiet = process.argv.includes('--quiet');

/** The columns 0011 adds, in the order they are appended to the dump's rows. */
const ADDED = [
  ['sets', 'INTEGER'],
  ['reps_min', 'INTEGER'],
  ['reps_max', 'INTEGER'],
  ['rest_seconds', 'INTEGER'],
  ['target_rpe', 'REAL'],
  ['load_basis', 'TEXT'],
  ['load_value', 'REAL'],
];

let sql = readFileSync(SRC, 'utf8');

// ── Schema ───────────────────────────────────────────────────────────────────

const createRe = /CREATE TABLE block_exercises\(([^)]*)\);/;
const create = sql.match(createRe);
if (!create) throw new Error('block_exercises CREATE TABLE not found in the dump');

const already = ADDED.filter(([name]) => new RegExp(`\\b${name}\\b`).test(create[1]));
if (already.length && already.length !== ADDED.length) {
  throw new Error(`dump is half-migrated: has ${already.map(c => c[0]).join(', ')}`);
}

if (!already.length) {
  const widened = `CREATE TABLE block_exercises(${create[1]},`
    + ADDED.map(([n, t]) => `${n} ${t}`).join(',') + ');';
  sql = sql.replace(createRe, widened);
}

/**
 * How many values a row carried BEFORE the new columns existed.
 *
 * Read from the pre-widening count, which on a second run means subtracting the
 * columns this script itself added. Taking the widened count instead would make
 * `vals.length > BASE_COLUMNS` false for every already-processed row, and the
 * script would append a second copy of all seven values on every run.
 */
const BASE_COLUMNS = create[1].split(',').length - (already.length ? ADDED.length : 0);

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Split a VALUES(...) tuple into raw SQL literals, respecting '' escapes. */
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

const num = v => (v === null ? 'NULL' : String(v));

const recovered = [];
const needsRest = [];
let scanned = 0;

sql = sql.replace(
  /INSERT INTO "block_exercises" VALUES\((.*)\);/g,
  (line, body) => {
    const vals = splitValues(body);

    // Already widened by a previous run. The row is left exactly as it is, but
    // it is still read: the authoring bucket below describes the state of the
    // dump, not what this particular run happened to touch. Deriving it from
    // the run instead would empty the file on every no-op re-run.
    if (vals.length > BASE_COLUMNS) {
      const widened = vals.map(unquote);
      const setsAt = BASE_COLUMNS;
      const restAt = BASE_COLUMNS + 3;
      if (widened[setsAt] !== null && widened[restAt] === null) {
        needsRest.push({
          id: widened[0],
          exercise_id: widened[3],
          sets: Number(widened[setsAt]),
          rest_seconds: null,
        });
      }
      return line;
    }
    scanned++;

    const [id, , , exercise_id, prescription_type, quantity, quantity_unit, intensity_note] =
      vals.map(unquote);

    const parsed = prescription_type === 'sets_reps'
      ? parseSetScheme(Number(quantity), quantity_unit, { intensityNote: intensity_note })
      : null;

    if (!parsed) {
      // Distance, duration and calorie rows are described correctly by
      // quantity/quantity_unit and are widened with nulls, not touched.
      return `INSERT INTO "block_exercises" VALUES(${body},`
        + ADDED.map(() => 'NULL').join(',') + ');';
    }

    recovered.push({
      id,
      exercise_id,
      was: `${quantity} ${quantity_unit}`,
      now: parsed.amrap_reserve !== null
        ? `${parsed.sets} x AMRAP (${parsed.amrap_reserve} in reserve)`
        : `${parsed.sets} x ${parsed.reps_min}${parsed.reps_max !== parsed.reps_min ? `-${parsed.reps_max}` : ''}`
          + (parsed.per_side ? ' per side' : ''),
      target_rpe: parsed.target_rpe,
    });
    needsRest.push({ id, exercise_id, sets: parsed.sets, rest_seconds: null });

    // load_basis / load_value stay null: the dump never said what was on the
    // bar, and the whole point of this release is to stop pretending it did.
    const appended = [
      num(parsed.sets), num(parsed.reps_min), num(parsed.reps_max),
      num(parsed.rest_seconds), num(parsed.target_rpe), 'NULL', 'NULL',
    ];
    return `INSERT INTO "block_exercises" VALUES(${body},${appended.join(',')});`;
  });

writeFileSync(SRC, sql);

mkdirSync(new URL('../data/review/', import.meta.url), { recursive: true });
writeFileSync(REVIEW, JSON.stringify({
  note: 'Rest between working sets, which the dump never carried. Fill rest_seconds '
    + 'and re-run scripts/apply-prescriptions.mjs --rest to apply. Until then the '
    + 'true-strength coverage gate stays red.',
  rows: needsRest,
}, null, 2) + '\n');

if (!quiet) {
  console.log(scanned
    ? `scanned ${scanned} block_exercises rows`
    : 'dump already carries the prescription columns; nothing to recover');
  console.log(`recovered ${recovered.length} set schemes:\n`);
  for (const r of recovered) {
    console.log(`  ${r.exercise_id.padEnd(28)} ${String(r.was).padEnd(12)} -> ${r.now}`
      + (r.target_rpe ? `  @RPE ${r.target_rpe}` : ''));
  }
  console.log(`\n${needsRest.length} row(s) need a rest value: data/review/prescriptions.authoring.json`);
}
