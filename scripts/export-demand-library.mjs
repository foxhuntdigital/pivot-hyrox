/**
 * Exports the whole eligible primary library as an editable grading sheet.
 *
 * The calibration sample proved the two demand axes on twenty sessions. This is
 * the same sheet over all 239 templates that `workout_role='primary'` and
 * `status='content_eligible'` — the pool migration 0023 added load_demand and
 * technical_demand for, and the pool the planner draws a week from.
 *
 * Both graded columns are exported EMPTY and nothing here computes them.
 *
 * ── This sheet is meant to be edited and come back ─────────────────────────
 *
 * Not only the two demand columns: every EDITABLE column in lib/demand-export
 * maps one-to-one onto content.workout_templates, so a corrected name, a
 * re-pointed training_domain or a rewritten coaching note can all be written
 * back. Three things make that safe rather than hopeful:
 *
 *   1. The JSON written beside the CSV is the BASELINE — the library exactly as
 *      it was at export. It is what an importer diffs the returned CSV against,
 *      so only cells a person actually changed are written back, and a
 *      spreadsheet's own reformatting (a stripped decimal, a re-quoted string)
 *      does not turn into 239 spurious updates. Do not edit the JSON.
 *   2. `template_id` is identity and `ref_`-prefixed columns are derived. An
 *      importer ignores edits to the latter and refuses a changed former.
 *   3. Export is deterministic and ordered by domain, family, minutes and id,
 *      so re-exporting after an import produces a readable diff instead of a
 *      reshuffle.
 *
 * The importer does not exist yet — write the edits, then it gets built against
 * a real edited sheet rather than a guess about one. Until then this script
 * only reads; the seed and every generated file are untouched.
 *
 *   node scripts/export-demand-library.mjs
 */
import { writeFileSync } from 'node:fs';
import { writeCsv } from './lib/csv.mjs';
import {
  readSeed, buildContext, eligiblePrimary, workoutRecord,
  sheetRow, COLUMNS, COLUMN_CONTRACT, countBy,
} from './lib/demand-export.mjs';

const OUT = new URL('../data/review/', import.meta.url);

const { tables } = readSeed();
const ctx = buildContext(tables);
const pool = eligiblePrimary(tables);

/**
 * Domain, then family, then length, then id.
 *
 * Someone grading 239 rows is comparing like with like — all the threshold
 * rows, then all the strength rows — and inconsistency between neighbours is
 * the thing a sheet should make visible. Id last so the order is total, and the
 * file therefore byte-stable across runs.
 */
const DOMAIN_ORDER = ['recovery', 'aerobic', 'threshold', 'muscular_endurance', 'strength', 'hybrid'];
const rank = d => { const i = DOMAIN_ORDER.indexOf(d); return i === -1 ? DOMAIN_ORDER.length : i; };

const workouts = pool
  .map(t => workoutRecord(t.id, ctx))
  .sort((a, b) =>
    rank(a.training_domain) - rank(b.training_domain)
    || String(a.training_domain).localeCompare(String(b.training_domain))
    || String(a.workout_family).localeCompare(String(b.workout_family))
    || (a.estimated_minutes ?? 0) - (b.estimated_minutes ?? 0)
    || a.template_id.localeCompare(b.template_id));

/* Every template in the pool reaches the sheet, or the sheet is not the library. */
if (workouts.length !== pool.length) {
  throw new Error(`built ${workouts.length} rows from a pool of ${pool.length}`);
}
/* Grades may be PRESENT — the library is graded now — but only ever the value
 * the seed holds. This script must carry a grade, never invent one, so every
 * exported value is checked against the row it came from. */
const seedGrade = Object.fromEntries(pool.map(t => [t.id, t]));
const invented = workouts.filter(w =>
  (w.technical_demand ?? null) !== (seedGrade[w.template_id].technical_demand ?? null)
  || (w.load_demand ?? null) !== (seedGrade[w.template_id].load_demand ?? null));
if (invented.length) {
  throw new Error('a demand value differs from the seed — this export must never grade: '
    + invented.map(w => w.template_id).join(', '));
}

const retired = tables.workout_templates
  .filter(t => t.workout_role === 'primary' && t.status !== 'content_eligible');

const doc = {
  meta: {
    export: 'demand-library',
    version: 'v1',
    purpose: 'Editable authoring sheet for the full eligible primary library. '
      + 'technical_demand and load_demand are authored by hand and carried through from '
      + 'the seed on re-export; the other editable columns may be corrected in the same pass.',
    role: 'BASELINE — the library as exported. An importer diffs the edited CSV against '
      + 'this to find genuinely changed cells. Edit the CSV, not this file.',
    source: 'data/adaptive_athlete_schema_and_seed.sql (read-only)',
    schema: 'supabase/migrations/0023_capacity_and_demand.sql',
    grading_fields: {
      technical_demand: {
        type: 'integer', scale: '1-4',
        means: 'How much skill this session assumes.',
        consequence: 'Matched as a HARD constraint once set — technical demand above an '
          + "athlete's capacity makes the session ineligible, not merely disfavoured.",
      },
      load_demand: {
        type: 'integer', scale: '1-4',
        means: 'How much this session costs to absorb: volume, intensity, recovery required.',
        consequence: 'Read when the planner filters the candidate pool.',
      },
      null_semantics: 'Empty = ungraded. Every matching rule reads null as "do not constrain", '
        + 'so a partially graded library is safe to ship: ungraded rows behave as they do today.',
    },
    columns: COLUMN_CONTRACT,
    row_count: workouts.length,
    sort: 'training_domain (recovery, aerobic, threshold, muscular_endurance, strength, hybrid), '
      + 'then workout_family, estimated_minutes, template_id',
    population_by_domain: countBy(workouts, 'training_domain'),
    excluded: {
      supplemental: tables.workout_templates.filter(t => t.workout_role === 'supplemental').length,
      retired_primary: retired.length,
      retired_primary_ids: retired.map(t => t.id),
    },
    caveats: [
      'block_exercises.load_basis and .load_value are unpopulated across all 765 rows in the '
        + 'seed, so no absolute external load exists anywhere in the library. Load grading rests '
        + 'on prescribed volume, RPE and movement.',
      'intensity_note sometimes carries a rep count rather than an intensity — '
        + '"Farmer Carry — 100 ft @ 4 repeats" in wo_hyrox_pull_a. Rendered faithfully; not a bug '
        + 'in this export.',
    ],
  },
  workouts,
};

writeFileSync(new URL('demand-library.v1.json', OUT), JSON.stringify(doc, null, 1) + '\n');
writeFileSync(new URL('demand-library.v1.csv', OUT), writeCsv(COLUMNS, workouts.map(sheetRow)));

console.log(`demand library sheet: ${workouts.length} templates, ${COLUMNS.length} columns`);
for (const d of Object.keys(doc.meta.population_by_domain)) {
  console.log(`    ${d.padEnd(20)} ${String(doc.meta.population_by_domain[d]).padStart(3)}`);
}
console.log(`  excluded: ${doc.meta.excluded.supplemental} supplemental, `
  + `${doc.meta.excluded.retired_primary} retired primary`);
const gradedCount = workouts.filter(w => w.technical_demand != null && w.load_demand != null).length;
console.log(`  graded: ${gradedCount}/${workouts.length}`
  + (gradedCount === workouts.length ? '' : ' — the rest export empty for authoring'));
console.log(`  editable columns: ${COLUMN_CONTRACT.editable.length}`
  + `, reference (read-only): ${COLUMN_CONTRACT.reference_read_only.length}`);
console.log('\nwrote data/review/demand-library.v1.json  (baseline — do not edit)');
console.log('wrote data/review/demand-library.v1.csv   (edit this)');
