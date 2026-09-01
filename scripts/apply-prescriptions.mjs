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
 * ── Applying the answers ─────────────────────────────────────────────────────
 *
 *   node scripts/apply-prescriptions.mjs --rest
 *
 * reads the rest values back out of data/review/prescriptions.authoring.json
 * and writes them into the dump. It refuses a value it cannot believe: rest is
 * the field that decides whether a session is strength or density work, and a
 * typo here is not a cosmetic error — an eight-second rest turns a squat
 * session into a circuit, and an eighty-minute one is a transcription slip that
 * would sit in the library unnoticed.
 *
 *   node scripts/apply-prescriptions.mjs [--quiet] [--rest]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

import { parseSetScheme } from './lib/prescription.mjs';
import { writeCsv } from './lib/csv.mjs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const REVIEW = new URL('../data/review/prescriptions.authoring.json', import.meta.url);
const REVIEW_CSV = new URL('../data/review/prescriptions.authoring.csv', import.meta.url);
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

const applyRest = process.argv.includes('--rest');

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

/**
 * The rest values a coach answered, keyed by block_exercise id.
 *
 * Bounds rather than a free number. Under thirty seconds is not recovery
 * between working sets, it is a density prescription wearing a strength
 * session's clothes — which is the exact confusion migration 0011 exists to
 * end. Over ten minutes is a transcription error, not a coaching decision.
 * Both are refused loudly rather than stored.
 */
const MIN_REST_SECONDS = 30;
const MAX_REST_SECONDS = 600;

let answered = new Map();
if (applyRest) {
  const review = JSON.parse(readFileSync(REVIEW, 'utf8'));
  const bad = [];
  for (const row of review.rows ?? []) {
    const v = row.rest_seconds;
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n)) {
      bad.push(`${row.id} (${row.exercise}): "${v}" is not a whole number of seconds`);
    } else if (n < MIN_REST_SECONDS || n > MAX_REST_SECONDS) {
      bad.push(`${row.id} (${row.exercise}): ${n}s is outside ${MIN_REST_SECONDS}-${MAX_REST_SECONDS}s`
        + (n < MIN_REST_SECONDS ? ' — that is density work, not rest between working sets' : ''));
    } else {
      answered.set(row.id, n);
    }
  }
  if (bad.length) {
    console.error(`refusing to apply ${bad.length} rest value(s):\n  ` + bad.join('\n  '));
    process.exit(1);
  }
}

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

/**
 * Names and structure, so the authoring file describes a session rather than a
 * list of row ids.
 *
 * Rest between working sets cannot be decided from a row id: it depends on
 * whether the movement is the day's primary lift or the third accessory, how
 * heavy the prescription is, and what comes after it. All of that is in the
 * dump already, so the review file carries it instead of asking a coach to go
 * and look it up fifteen times.
 */
function lookup(table, keyCol, cols) {
  const create = sql.match(new RegExp(`CREATE TABLE ${table}\\(([^)]*)\\);`));
  const names = create[1].split(',').map(c => c.trim().split(/\s+/)[0]);
  const out = new Map();
  for (const m of sql.matchAll(new RegExp(`INSERT INTO "${table}" VALUES\\((.*)\\);`, 'g'))) {
    const vals = splitValues(m[1]).map(unquote);
    const rec = Object.fromEntries(names.map((n, i) => [n, vals[i] ?? null]));
    out.set(rec[keyCol], cols ? Object.fromEntries(cols.map(c => [c, rec[c]])) : rec);
  }
  return out;
}

const exerciseName = lookup('exercises', 'id', ['name', 'category']);
const blockOf = lookup('workout_blocks', 'id', ['workout_id', 'block_order', 'title', 'instructions']);
const workoutOf = lookup('workout_templates', 'id', ['name', 'workout_family', 'intensity_target']);

/** One row needing a rest value, described well enough to answer without digging. */
function restRow({ id, block_id, exercise_id, sets, reps_min, reps_max, target_rpe, sequence }) {
  const block = blockOf.get(block_id) ?? {};
  const workout = workoutOf.get(block.workout_id) ?? {};
  const reps = reps_min == null ? 'AMRAP'
    : reps_max != null && reps_max !== reps_min ? `${reps_min}-${reps_max}` : String(reps_min);
  return {
    id,
    workout: workout.name ?? block.workout_id ?? '?',
    workout_family: workout.workout_family ?? null,
    block: block.title ?? block.instructions ?? '?',
    position: `movement ${sequence ?? '?'}`,
    exercise: exerciseName.get(exercise_id)?.name ?? exercise_id,
    exercise_id,
    prescription: `${sets} x ${reps}`,
    sets, reps_min, reps_max,
    target_rpe,
    session_intensity: workout.intensity_target ?? null,
    rest_seconds: null,
  };
}

const recovered = [];
const needsRest = [];
let scanned = 0;
let applied = 0;

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
      const answer = answered.get(widened[0]);
      if (answer !== undefined && widened[setsAt] !== null && widened[restAt] === null) {
        const cells = [...vals];
        cells[restAt] = String(answer);
        applied++;
        return `INSERT INTO "block_exercises" VALUES(${cells.join(',')});`;
      }

      if (widened[setsAt] !== null && widened[restAt] === null) {
        needsRest.push(restRow({
          id: widened[0], block_id: widened[1], exercise_id: widened[3],
          sets: Number(widened[setsAt]),
          reps_min: widened[BASE_COLUMNS + 1] === null ? null : Number(widened[BASE_COLUMNS + 1]),
          reps_max: widened[BASE_COLUMNS + 2] === null ? null : Number(widened[BASE_COLUMNS + 2]),
          target_rpe: widened[BASE_COLUMNS + 4] === null ? null : Number(widened[BASE_COLUMNS + 4]),
          sequence: widened[2],
        }));
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
    needsRest.push(restRow({
      id, block_id: vals[1] ? unquote(vals[1]) : null, exercise_id,
      sets: parsed.sets, reps_min: parsed.reps_min, reps_max: parsed.reps_max,
      target_rpe: parsed.target_rpe, sequence: vals[2],
    }));

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

/**
 * An answered review file is a record, not a scratch pad.
 *
 * Once the rest values are applied there is nothing left needing an answer, so
 * regenerating this file from `needsRest` writes an empty list over the top of
 * the coaching decisions that produced it. The answers are then only in the
 * dump, as bare numbers, with no trace of what they were chosen for.
 *
 * So a file whose rows are all answered is left alone. It stays the record of
 * why HYROX Legs A rests three minutes on the squat and one on the lunge.
 */
const alreadyAnswered = existsSync(REVIEW)
  && (() => {
    const rows = JSON.parse(readFileSync(REVIEW, 'utf8')).rows ?? [];
    return rows.length > 0 && rows.every(r => r.rest_seconds !== null && r.rest_seconds !== undefined);
  })();

if (alreadyAnswered && !needsRest.length) {
  if (!quiet) console.log('review file is fully answered and was left as the record of it');
} else {
writeFileSync(REVIEW, JSON.stringify({
  note: 'Rest between working sets — the one field the dump never carried, and the '
    + 'one that separates true strength from density work. Fill rest_seconds on each '
    + 'row and re-run this script. Until every row here has a value the true-strength '
    + 'coverage gate stays red, because a session that does not say how long to rest '
    + 'is not yet a strength session anyone can plan from.',
  guidance: 'Rest is a coaching decision, not a derivation — that is why these are '
    + 'blank rather than defaulted. The context on each row (the session it belongs '
    + 'to, where it sits in the block, the load scheme and the authored RPE ceiling) '
    + 'is what the decision needs.',
  rows: needsRest,
}, null, 2) + '\n');

  writeFileSync(REVIEW_CSV, writeCsv(
  ['rest_seconds', 'workout', 'position', 'exercise', 'prescription', 'target_rpe',
   'block', 'id'],
  needsRest.map(r => ({
    rest_seconds: '', workout: r.workout, position: r.position, exercise: r.exercise,
    prescription: r.prescription, target_rpe: r.target_rpe ?? '', block: r.block, id: r.id,
  }))));
}

if (!quiet) {
  console.log(scanned
    ? `scanned ${scanned} block_exercises rows`
    : 'dump already carries the prescription columns; nothing to recover');
  console.log(`recovered ${recovered.length} set schemes:\n`);
  for (const r of recovered) {
    console.log(`  ${r.exercise_id.padEnd(28)} ${String(r.was).padEnd(12)} -> ${r.now}`
      + (r.target_rpe ? `  @RPE ${r.target_rpe}` : ''));
  }
  if (applied) console.log(`\napplied ${applied} rest value(s) from the review file`);
  console.log(`${needsRest.length} row(s) still need a rest value`
    + (needsRest.length ? ': data/review/prescriptions.authoring.json' : ' — none'));
}
