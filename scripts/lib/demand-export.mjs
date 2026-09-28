/**
 * Reads the seed into grading-sheet rows, for the demand-grading exports.
 *
 * Two scripts need exactly the same rendering of a template — the twenty-row
 * calibration sample and the full 239-row library sheet — and a sheet whose
 * columns mean subtly different things depending on which script wrote it is
 * worse than no sheet. So the seed parsing, the prescription rendering and the
 * column list live here once.
 *
 * ── The column contract ────────────────────────────────────────────────────
 *
 * A sheet that goes out, gets edited and comes back has to say which of its
 * columns an editor may actually change, because the ones it cannot honour are
 * not obvious by looking. Three kinds:
 *
 *   IDENTITY   template_id. The row's link back to the seed. Change it and the
 *              row describes a different workout, or no workout at all.
 *   EDITABLE   one-to-one with a column on content.workout_templates, so an
 *              importer can write the new value straight back.
 *   REFERENCE  `ref_`-prefixed, derived by flattening workout_blocks,
 *              block_exercises and workout_variants for reading. An edit here
 *              has nowhere to go: "4×5 @ RPE 7" typed into a cell is prose, and
 *              turning prose back into rows is what scripts/prepare-pack.mjs
 *              exists to do, under rules this sheet does not enforce. The
 *              prefix is the warning, carried in the file itself rather than in
 *              a README nobody opens next to a spreadsheet.
 *
 * technical_demand and load_demand are editable and are read back off the seed,
 * so a re-export of a graded library shows the grades rather than blanking them.
 * Nothing in this file COMPUTES them: an ungraded template exports empty and
 * stays empty. The seed carries several fields that correlate with demand —
 * complexity_level, target_rpe, impact_level, estimated_minutes — and every one
 * of them is a hypothesis the rubric was written to test, not a shortcut to
 * filling in a template nobody has graded.
 */
import { readSeed, jsonArray } from './seed.mjs';

export { readSeed };

const index = (rows, key) => (rows ?? []).reduce((acc, r) => ((acc[r[key]] ??= []).push(r), acc), {});

export function buildContext(tables) {
  const equipmentByExercise = {};
  for (const e of tables.exercise_equipment ?? []) {
    (equipmentByExercise[e.exercise_id] ??= [])
      .push(e.required ? e.equipment_id : `${e.equipment_id} (optional)`);
  }
  return {
    templates: Object.fromEntries(tables.workout_templates.map(t => [t.id, t])),
    exercises: Object.fromEntries(tables.exercises.map(e => [e.id, e])),
    blocksByWorkout: index(tables.workout_blocks, 'workout_id'),
    itemsByBlock: index(tables.block_exercises, 'block_id'),
    variantsByWorkout: index(tables.workout_variants, 'workout_id'),
    tagsByWorkout: index(tables.workout_tags, 'workout_id'),
    equipmentByExercise,
  };
}

/** The eligible primary library: what "the 239" means, in one place. */
export function eligiblePrimary(tables) {
  return tables.workout_templates
    .filter(t => t.workout_role === 'primary' && t.status === 'content_eligible');
}

/* ---------- rendering ---------- */

/** One prescribed item, the way a coach reads it off a whiteboard. */
export function itemText(it, ctx) {
  const name = ctx.exercises[it.exercise_id]?.name ?? it.exercise_id;
  const unit = it.quantity_unit ?? '';
  const qty = it.prescription_type === 'sets_reps' && /^x/.test(unit)
    ? `${it.sets ?? it.quantity}×${unit.slice(1)}`
    : `${it.quantity ?? '?'} ${unit}`.trim();
  const bits = [`${name} — ${qty}`];
  const intensity = it.intensity_note ?? (it.target_rpe != null ? `RPE ${it.target_rpe}` : null);
  if (intensity) bits.push(`@ ${intensity}`);
  if (it.side_note) bits.push(`(${it.side_note})`);
  if (it.rest_seconds != null) bits.push(`rest ${it.rest_seconds}s`);
  return bits.join(' ');
}

function blockHeader(b) {
  const bits = [b.block_type];
  if (b.rounds != null) bits.push(`${b.rounds} rounds`);
  if (b.duration_minutes != null) bits.push(`${b.duration_minutes} min`);
  if (b.rest_seconds != null) bits.push(`rest ${b.rest_seconds}s`);
  return `B${b.block_order} [${b.title ?? 'Main'}] ${bits.join(', ')}`;
}

const VARIANT_ORDER = ['green', 'yellow', 'red'];

/** The full-fidelity record: everything a reviewer needs to judge the session. */
export function workoutRecord(id, ctx) {
  const t = ctx.templates[id];
  const blocks = (ctx.blocksByWorkout[id] ?? []).sort((a, b) => a.block_order - b.block_order);
  const itemsOf = b => (ctx.itemsByBlock[b.id] ?? []).sort((x, y) => x.sequence_order - y.sequence_order);

  return {
    template_id: t.id,
    name: t.name,
    training_domain: t.training_domain,
    workout_family: t.workout_family,
    session_type: t.session_type,
    workout_role: t.workout_role,
    status: t.status,
    primary_goal: t.primary_goal,
    secondary_goal: t.secondary_goal,
    stimulus: t.stimulus,
    estimated_minutes: t.estimated_minutes,
    intensity_target: t.intensity_target,
    impact_level: t.impact_level,
    hyrox_specificity: t.hyrox_specificity,
    postpartum_friendly: !!t.postpartum_friendly,
    requires_running: !!t.requires_running,
    requires_ski: !!t.requires_ski,
    description: t.description,
    coaching_notes: t.coaching_notes,
    tags: (ctx.tagsByWorkout[id] ?? []).map(r => r.tag_id),

    variants: (ctx.variantsByWorkout[id] ?? [])
      .slice()
      .sort((a, b) => VARIANT_ORDER.indexOf(a.variant_code) - VARIANT_ORDER.indexOf(b.variant_code))
      .map(v => ({
        variant_code: v.variant_code,
        recovery_state: v.recovery_state,
        time_budget_minutes: v.time_budget_minutes,
        volume_multiplier: v.volume_multiplier,
        intensity_modifier: v.intensity_modifier,
        provenance: v.notes,
      })),

    blocks: blocks.map(b => ({
      block_order: b.block_order,
      block_type: b.block_type,
      title: b.title,
      instructions: b.instructions,
      rounds: b.rounds,
      duration_minutes: b.duration_minutes,
      rest_seconds: b.rest_seconds,
      exercises: itemsOf(b).map(it => {
        const ex = ctx.exercises[it.exercise_id] ?? {};
        return {
          sequence_order: it.sequence_order,
          exercise_id: it.exercise_id,
          exercise_name: ex.name ?? null,
          modality: ex.modality ?? null,
          movement_pattern: ex.movement_pattern ?? null,
          complexity_level: ex.complexity_level ?? null,
          movement_families: jsonArray(ex.movement_families),
          training_qualities: jsonArray(ex.training_qualities),
          equipment: ctx.equipmentByExercise[it.exercise_id] ?? [],
          exercise_impact_level: ex.impact_level ?? null,
          prescription_type: it.prescription_type,
          quantity: it.quantity,
          quantity_unit: it.quantity_unit,
          sets: it.sets,
          reps_min: it.reps_min,
          reps_max: it.reps_max,
          rest_seconds: it.rest_seconds,
          target_rpe: it.target_rpe,
          intensity_note: it.intensity_note,
          side_note: it.side_note,
          reads_as: itemText(it, ctx),
        };
      }),
    })),

    prescription_summary: blocks.map(b => [
      blockHeader(b),
      ...itemsOf(b).map((it, i) => `    ${i + 1}. ${itemText(it, ctx)}`),
    ].join('\n')).join('\n'),

    // Authored by hand, 1-4; null until someone grades it. Never computed.
    technical_demand: t.technical_demand ?? null,
    load_demand: t.load_demand ?? null,
  };
}

/* ---------- the sheet ---------- */

export const IDENTITY_COLUMNS = ['template_id'];

/**
 * Editable columns, each one-to-one with content.workout_templates.
 * `ref_prescription` sits between coaching_notes and the two graded columns on
 * purpose: a grader reads the session and grades it without scrolling.
 */
export const EDITABLE_COLUMNS = [
  'name', 'training_domain', 'workout_family', 'session_type',
  'primary_goal', 'secondary_goal', 'stimulus',
  'estimated_minutes', 'intensity_target', 'impact_level',
  'hyrox_specificity', 'postpartum_friendly', 'requires_running', 'requires_ski',
  'description', 'coaching_notes',
  'technical_demand', 'load_demand',
];

export const REFERENCE_COLUMNS = [
  'ref_prescription', 'ref_block_count', 'ref_exercise_count', 'ref_variants',
];

export const COLUMNS = [
  'template_id',
  'name', 'training_domain', 'workout_family', 'session_type',
  'primary_goal', 'secondary_goal', 'stimulus',
  'estimated_minutes', 'intensity_target', 'impact_level',
  'hyrox_specificity', 'postpartum_friendly', 'requires_running', 'requires_ski',
  'description', 'coaching_notes',
  'ref_prescription',
  'technical_demand', 'load_demand',
  'ref_block_count', 'ref_exercise_count', 'ref_variants',
];

/** A record flattened to the sheet's columns. Booleans as TRUE/FALSE so a
 *  spreadsheet round-trips them as themselves rather than as 1/0 or "true". */
export function sheetRow(w) {
  const bool = v => (v ? 'TRUE' : 'FALSE');
  return {
    template_id: w.template_id,
    name: w.name,
    training_domain: w.training_domain,
    workout_family: w.workout_family,
    session_type: w.session_type,
    primary_goal: w.primary_goal,
    secondary_goal: w.secondary_goal,
    stimulus: w.stimulus,
    estimated_minutes: w.estimated_minutes,
    intensity_target: w.intensity_target,
    impact_level: w.impact_level,
    hyrox_specificity: w.hyrox_specificity,
    postpartum_friendly: bool(w.postpartum_friendly),
    requires_running: bool(w.requires_running),
    requires_ski: bool(w.requires_ski),
    description: w.description,
    coaching_notes: w.coaching_notes,
    ref_prescription: w.prescription_summary,
    technical_demand: w.technical_demand ?? '',
    load_demand: w.load_demand ?? '',
    ref_block_count: w.blocks.length,
    ref_exercise_count: w.blocks.reduce((n, b) => n + b.exercises.length, 0),
    ref_variants: w.variants
      .map(v => `${v.variant_code}: ${v.time_budget_minutes}min ×${v.volume_multiplier} — ${v.intensity_modifier}`)
      .join('\n'),
  };
}

/** The column contract, for the meta block of whichever sheet is being written. */
export const COLUMN_CONTRACT = {
  identity: IDENTITY_COLUMNS,
  editable: EDITABLE_COLUMNS,
  reference_read_only: REFERENCE_COLUMNS,
  note: 'Columns prefixed ref_ are flattened from workout_blocks, block_exercises and '
    + 'workout_variants for reading. Edits to them cannot be imported — changing a '
    + 'prescription means editing a content pack and going through '
    + 'scripts/prepare-pack.mjs and scripts/import-workouts.mjs, which enforce the '
    + 'explicit-unit rule and semantic dedup that this sheet does not.',
};

export const countBy = (rows, f) => rows.reduce((a, r) => ((a[r[f]] = (a[r[f]] ?? 0) + 1), a), {});
