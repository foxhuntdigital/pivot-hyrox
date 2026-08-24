/**
 * Converts a prose content pack into the canonical explicit format.
 *
 * The station matrix and running expansion describe sessions as prose, and that
 * source format is underspecified: `m` is overloaded between metres and minutes,
 * and for runs and ergs there is no semantic discriminator once magnitude is the
 * deciding factor. Rather than bake a parser's guesses into production content,
 * this splits a pack three ways:
 *
 *   ready.json      every unit resolved without magnitude inference — importable
 *   review.json     parsed, but a metre/minute call rested on magnitude
 *   authoring.json  not parseable; pre-filled skeletons for hand authoring
 *
 * Only `ready` is fit to import. The other two are worksheets.
 *
 *   node scripts/prepare-pack.mjs data/hyrox-station-matrix.json --station
 *   node scripts/prepare-pack.mjs data/running-expansion.json --fallback ex_run
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePrescription, STATION_EXERCISE } from './lib/prescription.mjs';

const args = process.argv.slice(2);
const packPath = args.find(a => !a.startsWith('-'));
if (!packPath) throw new Error('usage: prepare-pack.mjs <pack.json> [--station] [--fallback ex_id]');
const useStation = args.includes('--station');
const fallbackMovement = args[args.indexOf('--fallback') + 1]?.startsWith('ex_')
  ? args[args.indexOf('--fallback') + 1] : null;

const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const lib = JSON.parse(readFileSync(new URL('../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));
const exerciseName = Object.fromEntries(lib.exercises.map(e => [e.id, e.name]));

const OUT_DIR = new URL('../data/review/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });
const stem = basename(packPath).replace(/\.json$/, '');

/** Minutes a parsed session accounts for, used to sanity-check the estimate. */
const timedTotal = blocks =>
  blocks.reduce((s, b) => s + (b.block.duration_minutes ?? 0), 0) || null;

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const ready = [], review = [], authoring = [];

for (const w of pack.workouts) {
  const id = w.workout_id ?? w.id;
  const station = useStation ? w.station : null;
  const parsed = parsePrescription(w.full_prescription, {
    station, fallbackMovement, estimatedMinutes: w.estimated_minutes ?? null,
  });

  const common = {
    id, name: w.name ?? `${w.station} — ${w.category}`,
    // The matrix has no family of its own. The station is what progresses, so
    // it is the natural family for progression rules to key on.
    workout_family: w.workout_family ?? (w.station ? `station_${slug(w.station)}` : null),
    stimulus: w.primary_goal,
    category: w.category ?? null,
    station: w.station ?? null,
    estimated_minutes: w.estimated_minutes ?? null,
    intensity_target: w.intensity_target ?? null,
    impact_level: w.impact_level,
    hyrox_specificity: w.hyrox_specificity,
    source_prescription: w.full_prescription,
  };

  if (parsed.unparsed) {
    authoring.push({
      ...common,
      reason: parsed.unparsed,
      // Pre-filled skeleton: fill quantity/unit/prescription_type per movement.
      block: { block_type: null, rounds: null, duration_minutes: null, rest_seconds: null },
      items: [{ exercise: null, prescription_type: null, quantity: null, unit: null, intensity: null }],
    });
    continue;
  }

  // The matrix supplies no estimated_minutes at all, and it is NOT NULL. Where
  // the prescription states a duration ("20m EMOM: ...", "30 min steady") that
  // is a reading, not a guess. Where it does not — "6 x 500m / 90s" — turning
  // distance into minutes needs a pace model, so the session goes to authoring
  // rather than being given an invented length.
  const estimated = w.estimated_minutes ?? timedTotal(parsed.blocks);
  if (!estimated) {
    authoring.push({
      ...common,
      reason: 'estimated_minutes is absent and not derivable — the prescription states no duration',
      blocks: parsed.blocks.map(b => ({
        block_type: b.block.block_type, rounds: b.block.rounds,
        duration_minutes: b.block.duration_minutes, rest_seconds: b.block.rest_seconds,
        title: b.block.title, instructions: b.block.instructions,
        items: b.items.map(i => ({
          exercise: exerciseName[i.exercise_id] ?? i.exercise_id,
          prescription_type: i.prescription_type,
          quantity: i.quantity, unit: i.quantity_unit, intensity: i.intensity_note,
        })),
      })),
      estimated_minutes: null,
    });
    continue;
  }

  const canonical = {
    ...common,
    estimated_minutes: estimated,
    blocks: parsed.blocks.map(b => ({
      block_type: b.block.block_type, rounds: b.block.rounds,
      duration_minutes: b.block.duration_minutes, rest_seconds: b.block.rest_seconds,
      title: b.block.title, instructions: b.block.instructions,
      items: b.items.map(i => ({
        exercise: exerciseName[i.exercise_id] ?? i.exercise_id,
        prescription_type: i.prescription_type,
        quantity: i.quantity, unit: i.quantity_unit, intensity: i.intensity_note,
      })),
    })),
  };

  if (parsed.notes.length) {
    review.push({
      ...canonical,
      inferred_units: parsed.notes.map(n => {
        const m = n.match(/read "(\d+)m" as (\w+) for (\S+) on magnitude/);
        return m ? { token: `${m[1]}m`, inferred_unit: m[2] === 'metres' ? 'm' : 'min', movement: m[3], basis: 'magnitude' } : { note: n };
      }),
      confidence: 'magnitude-inferred',
      reason: parsed.notes.join('; '),
      timed_total_minutes: timedTotal(parsed.blocks),
    });
  } else {
    ready.push(canonical);
  }
}

const write = (name, rows, extra = {}) => {
  const path = new URL(`${stem}.${name}.json`, OUT_DIR);
  writeFileSync(path, JSON.stringify({
    meta: {
      pack: pack.meta.name ?? pack.meta.pack, source: basename(packPath),
      bucket: name, workout_count: rows.length, format: 'canonical-v1', ...extra,
    },
    workouts: rows,
  }, null, 1));
  return path;
};

write('ready', ready, {
  _note: 'Every unit resolved by the movement or an explicit token. No magnitude inference. Safe to import.',
});
write('review', review, {
  _note: 'Parsed, but at least one metre/minute call rested on magnitude alone. Check inferred_units against source_prescription and timed_total_minutes vs estimated_minutes, then move approved rows into a .ready.json.',
});
write('authoring', authoring, {
  _note: 'Not parseable — prose describes structure the schema needs spelled out. Fill block + items; every quantity needs an explicit prescription_type and unit.',
});

console.log(`${basename(packPath)}`);
console.log(`  ready      ${String(ready.length).padStart(3)}  no inference, importable`);
console.log(`  review     ${String(review.length).padStart(3)}  magnitude-inferred, needs sign-off`);
console.log(`  authoring  ${String(authoring.length).padStart(3)}  prose, needs structured items`);
