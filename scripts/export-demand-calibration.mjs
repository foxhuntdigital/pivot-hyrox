/**
 * Exports a 20-template calibration sample for demand grading.
 *
 * Two axes are being added to the content schema — technical_demand and
 * load_demand, each 1-4, already present as columns via migration 0023. Before
 * all 239 primaries are graded, a human rubric has to exist, and a rubric is
 * only as good as the sessions it was argued over. This emits twenty existing
 * primary templates in full, with both fields present and EMPTY, to be filled
 * in by hand.
 *
 * Same columns as scripts/export-demand-library.mjs, deliberately: the sample
 * is a subset of that sheet, so grades entered here transfer by template_id.
 *
 * Three rules this file exists to keep:
 *
 *   1. NOTHING IS INFERRED. Both fields are written empty and never computed.
 *      The seed carries plenty that correlates with demand — complexity_level,
 *      target_rpe, impact_level, estimated_minutes — and every one of them is a
 *      hypothesis the rubric is supposed to test, not a shortcut to pre-filling
 *      the answer. If this script ever learns to guess, the calibration
 *      measures the guess instead of the reviewers.
 *
 *   2. NOTHING IS WRITTEN BACK. The seed is read-only and the outputs land in
 *      data/review/, which no generator reads. workout_role, planner
 *      eligibility and scheduling behaviour are untouched.
 *
 *   3. THE SAMPLE IS DELIBERATE. SELECTION below is a hand-picked id list, not
 *      a filter or a score, because "representative" here means spanning all
 *      six training domains AND the apparent easy/moderate/demanding/technical
 *      spread AND the structural edge cases that will break a naive rubric.
 *
 * Why the reasons are not on the grading rows: a reviewer who reads "shortest
 * session in the library, highest prescribed intensity" before grading has been
 * handed most of a load_demand answer. The sampling frame lives in meta so the
 * sample stays auditable; the rows stay clean so the grades stay independent.
 *
 *   node scripts/export-demand-calibration.mjs
 */
import { writeFileSync } from 'node:fs';
import { writeCsv } from './lib/csv.mjs';
import {
  readSeed, buildContext, eligiblePrimary, workoutRecord,
  sheetRow, COLUMNS, COLUMN_CONTRACT, countBy,
} from './lib/demand-export.mjs';

const OUT = new URL('../data/review/', import.meta.url);

/**
 * The twenty, with the axis each is meant to stress.
 *
 * Domain allocation tracks the eligible population (hybrid 96, aerobic 64,
 * strength 42, threshold 24, muscular_endurance 9, recovery 4) while giving the
 * two small domains enough rows to anchor the bottom of both scales.
 */
const SELECTION = [
  // recovery (2) — the floor of both scales
  { id: 'run_recovery_run_01', bucket: 'easy', stresses: 'Absolute floor: lowest intensity, one movement, no structure. Anchors 1/1.' },
  { id: 'wo_recovery_spin_mobility', bucket: 'easy', stresses: 'Recovery that is still multi-modal — does "recovery" force technical_demand to 1?' },

  // muscular_endurance (2)
  { id: 'mx_sled_pull_micro', bucket: 'easy', stresses: 'Joint-shortest session (10 min), single station. Floor of the duration axis.' },
  { id: 'mx_sandbag_lunge_strength_power', bucket: 'demanding', stresses: 'Intermediate movement at RPE 7-8 prescribed in "steps" — a unit with no load or time in it.' },

  // threshold (3)
  { id: 'mx_burpee_broad_jump_threshold', bucket: 'demanding', stresses: 'Short (18 min) but high-impact and intermediate-complexity. Duration pulls down, everything else pulls up.' },
  { id: 'run_threshold_03', bucket: 'demanding', stresses: 'Longest threshold session, three blocks, duration and distance prescribed in the same workout.' },
  { id: 'wo_row_descending_ladder_2k_500', bucket: 'moderate', stresses: 'RPE band spans 6-8 within one session — which end does a single load grade take?' },

  // strength (4)
  { id: 'wo_micro_strength_legs_15', bucket: 'moderate', stresses: 'Strength stripped to 15 minutes. Tests whether session_type=strength carries a demand floor.' },
  { id: 'str_recovery_01', bucket: 'moderate', stresses: 'Forty minutes of maintenance strength at RPE 5-6 — long but deliberately undemanding.' },
  { id: 'str_lower_02', bucket: 'technical', stresses: 'Advanced-complexity movement, four modalities, and rep RANGES (x10-12) rather than fixed reps.' },
  { id: 'wo_hyrox_pull_a', bucket: 'technical', stresses: 'Advanced complexity plus an open-ended AMRAP-2 item — prescribed work with no fixed quantity.' },

  // aerobic (4)
  { id: 'run_micro_run_01', bucket: 'easy', stresses: 'Twelve easy minutes, one movement. The easy anchor for a non-recovery domain.' },
  { id: 'mx_burpee_broad_jump_technique', bucket: 'technical', stresses: 'DECOUPLING CASE: RPE 3-4 and 15 minutes, but high impact and intermediate complexity. Low load, high technique.' },
  { id: 'run_long_aerobic_02', bucket: 'demanding', stresses: 'DECOUPLING CASE: longest session in the library (75 min) at RPE 3-4 on one movement. High load, no technique.' },
  { id: 'run_treadmill_control_01', bucket: 'moderate', stresses: 'Six blocks — most structurally segmented session in the library — on a single trivial movement.' },

  // hybrid (5)
  { id: 'mx_sled_push_benchmark', bucket: 'demanding', stresses: 'DECOUPLING CASE: ten minutes at RPE 8-9. Shortest possible session, highest prescribed intensity.' },
  { id: 'run_taper_sharpen_03', bucket: 'easy', stresses: 'Twenty minutes across four blocks at RPE 3-6 — taper work that looks busier than it is.' },
  { id: 'wo_hyrox_density_emom_20', bucket: 'technical', stresses: 'Five exercises across four modalities in twenty minutes, on an EMOM clock.' },
  { id: 'wo_half_hyrox_simulation', bucket: 'demanding', stresses: 'Race simulation: 75 min, high impact, RPE 7. The intended ceiling of load.' },
  { id: 'run_mixed_race_pace_02', bucket: 'technical', stresses: 'Structural ceiling: six blocks, seven exercises, four modalities, 75 minutes.' },
];

const { tables } = readSeed();
const ctx = buildContext(tables);

const missing = SELECTION.filter(s => !ctx.templates[s.id]);
if (missing.length) throw new Error(`not in seed: ${missing.map(s => s.id).join(', ')}`);

const notEligible = SELECTION.filter(s => ctx.templates[s.id].workout_role !== 'primary'
  || ctx.templates[s.id].status !== 'content_eligible');
if (notEligible.length) {
  throw new Error(`not an eligible primary template: ${notEligible.map(s => s.id).join(', ')}`);
}

const workouts = SELECTION.map(({ id }) => workoutRecord(id, ctx));
const pool = eligiblePrimary(tables);

const doc = {
  meta: {
    export: 'demand-calibration',
    version: 'v1',
    purpose: 'Human rubric calibration for technical_demand and load_demand (1-4). '
      + 'Both fields are intentionally empty and must be filled in by a person.',
    source: 'data/adaptive_athlete_schema_and_seed.sql (read-only)',
    schema: 'supabase/migrations/0023_capacity_and_demand.sql',
    full_library_sheet: 'data/review/demand-library.v1.csv — same columns, all '
      + `${pool.length} eligible primaries. Grades entered here transfer by template_id.`,
    grading_fields: {
      technical_demand: {
        type: 'integer', scale: '1-4', populated: false,
        means: 'How much skill this session assumes.',
        consequence: 'Matched as a HARD constraint once set — technical demand above an '
          + "athlete's capacity makes the session ineligible, not merely disfavoured. "
          + 'Grading one point too high silently removes a session from a library that is '
          + 'already thin in some domains; one point too low is a safety question.',
      },
      load_demand: {
        type: 'integer', scale: '1-4', populated: false,
        means: 'How much this session costs to absorb: volume, intensity, recovery required.',
        consequence: 'Read when the planner filters the candidate pool.',
      },
      null_semantics: 'Empty = ungraded. Every matching rule reads null as "do not constrain", '
        + 'so an ungraded template behaves exactly as it does today.',
    },
    columns: COLUMN_CONTRACT,
    selected: workouts.length,
    eligible_primary_population: pool.length,
    population_by_domain: countBy(pool, 'training_domain'),
    sample_by_domain: countBy(workouts, 'training_domain'),
    coverage: {
      estimated_minutes: [Math.min(...workouts.map(w => w.estimated_minutes)),
        Math.max(...workouts.map(w => w.estimated_minutes))],
      intensity_targets: [...new Set(workouts.map(w => w.intensity_target))],
      impact_levels: [...new Set(workouts.map(w => w.impact_level))],
      blocks_per_session: [Math.min(...workouts.map(w => w.blocks.length)),
        Math.max(...workouts.map(w => w.blocks.length))],
      prescription_types: [...new Set(workouts.flatMap(w => w.blocks.flatMap(b => b.exercises.map(e => e.prescription_type))))],
      complexity_levels: [...new Set(workouts.flatMap(w => w.blocks.flatMap(b => b.exercises.map(e => e.complexity_level))))],
      quantity_units: [...new Set(workouts.flatMap(w => w.blocks.flatMap(b => b.exercises.map(e => e.quantity_unit))))],
    },
    // Kept out of the rows on purpose: a reviewer who reads why a session was
    // picked has been handed part of the answer. This is here for whoever runs
    // the calibration session, not for whoever grades the rows.
    sampling_frame: SELECTION.map(s => ({
      template_id: s.id, bucket: s.bucket, stresses: s.stresses,
      training_domain: ctx.templates[s.id].training_domain,
    })),
    caveats: [
      'block_exercises.load_basis and .load_value are unpopulated across all 765 rows in the seed, '
        + 'so no absolute external load is available anywhere in the library. Load grading rests on '
        + 'prescribed volume, RPE and movement.',
      'Four primary templates carry status=retired and were excluded from the sampling population.',
    ],
  },
  workouts,
};

writeFileSync(new URL('demand-calibration.v1.json', OUT), JSON.stringify(doc, null, 1) + '\n');
writeFileSync(new URL('demand-calibration.v1.csv', OUT), writeCsv(COLUMNS, workouts.map(sheetRow)));

console.log(`demand calibration sample: ${workouts.length} templates`);
console.log(`  from ${pool.length} eligible primary templates`);
for (const [d, n] of Object.entries(countBy(workouts, 'training_domain')).sort()) {
  console.log(`    ${d.padEnd(20)} ${n}  (of ${countBy(pool, 'training_domain')[d]})`);
}
console.log(`  minutes ${doc.meta.coverage.estimated_minutes.join('-')}`
  + `, blocks ${doc.meta.coverage.blocks_per_session.join('-')}`
  + `, RPE bands ${doc.meta.coverage.intensity_targets.length}`);
const gradedCount = workouts.filter(w => w.technical_demand != null && w.load_demand != null).length;
console.log(`  graded: ${gradedCount}/${workouts.length}`
  + (gradedCount === workouts.length ? '' : ' — the rest export empty for authoring'));
console.log('\nwrote data/review/demand-calibration.v1.json');
console.log('wrote data/review/demand-calibration.v1.csv');
