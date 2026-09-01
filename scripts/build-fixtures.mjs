/**
 * Emits tests/engine-fixtures/content.json — the real curated library, shaped
 * for the engine. Tests run against actual content rather than stubs, so a
 * seed change that breaks the engine shows up as a test failure.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const sql = readFileSync(new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url), 'utf8');

function parseSchema() {
  const schema = {};
  for (const m of sql.matchAll(/CREATE TABLE (\w+)\(([\s\S]*?)\);/g)) {
    const [, table, body] = m;
    const cols = [];
    let depth = 0, cur = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) cols.push(cur.trim());
    schema[table] = cols.filter(c => !/^(PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(c))
                        .map(c => c.split(/\s+/)[0]);
  }
  return schema;
}

function splitValues(body) {
  const out = []; let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "'") {
        if (body[i + 1] === "'") { cur += "'"; i++; continue; }
        inStr = false; continue;
      }
      cur += ch; continue;
    }
    if (ch === "'") { inStr = true; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const schema = parseSchema();
const tables = {};
for (const m of sql.matchAll(/INSERT INTO "(\w+)" VALUES\(([\s\S]*?)\);\n/g)) {
  const [, table, body] = m;
  const vals = splitValues(body);
  const cols = schema[table];
  const row = {};
  cols.forEach((c, i) => {
    const v = vals[i];
    row[c] = v === 'NULL' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  });
  (tables[table] ??= []).push(row);
}

// Exercises with their equipment options.
const equipByExercise = {};
for (const r of tables.exercise_equipment) {
  (equipByExercise[r.exercise_id] ??= []).push(r.equipment_id);
}
/** Ontology arrays are JSON text in the dump (see scripts/import-ontology.mjs). */
function jsonArray(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`exercise ontology field is not a JSON array: ${String(raw).slice(0, 60)}`);
  }
}

const exercises = tables.exercises.map(e => ({
  id: e.id,
  name: e.name,
  impact_level: e.impact_level,
  postpartum_friendly: e.postpartum_friendly === 1,
  equipment: equipByExercise[e.id] ?? [],
  // Ontology (addendum §3). The engine does not rank on these yet; the library
  // QA gates read them, and the progression service will branch on
  // progression_class.
  movement_families: jsonArray(e.movement_families),
  training_qualities: jsonArray(e.training_qualities),
  movement_characters: jsonArray(e.movement_characters),
  complexity_level: e.complexity_level ?? null,
  exercise_role_eligibility: jsonArray(e.exercise_role_eligibility),
  progression_class: e.progression_class ?? null,
  progression_tracks: jsonArray(e.progression_tracks),
  exercise_family_id: e.exercise_family_id ?? null,
  history_comparability_group: e.history_comparability_group ?? null,
}));

// Blocks with their exercises.
const bxByBlock = {};
for (const r of tables.block_exercises) (bxByBlock[r.block_id] ??= []).push(r);
const blocksByWorkout = {};
for (const b of tables.workout_blocks) {
  (blocksByWorkout[b.workout_id] ??= []).push({
    id: b.id,
    block_order: b.block_order,
    block_type: b.block_type,
    title: b.title,
    instructions: b.instructions,
    rounds: b.rounds,
    duration_minutes: b.duration_minutes,
    rest_seconds: b.rest_seconds,
    exercises: (bxByBlock[b.id] ?? [])
      .sort((x, y) => x.sequence_order - y.sequence_order)
      .map(x => ({
        exercise_id: x.exercise_id,
        sequence_order: x.sequence_order,
        prescription_type: x.prescription_type,
        // The role this movement plays in THIS session (addendum §6).
        ...(x.exercise_role ? { exercise_role: x.exercise_role } : {}),
        quantity: x.quantity,
        quantity_unit: x.quantity_unit,
        intensity_note: x.intensity_note,
        // Structured strength prescription (migration 0011). Emitted only where
        // the row has one, so a distance or duration exercise keeps the shape
        // it has always had rather than gaining seven nulls.
        ...(x.sets == null ? {} : {
          sets: x.sets,
          reps_min: x.reps_min,
          reps_max: x.reps_max,
          rest_seconds: x.rest_seconds,
          target_rpe: x.target_rpe,
          load_basis: x.load_basis,
          load_value: x.load_value,
        }),
      })),
  });
}

const variantsByWorkout = {};
for (const v of tables.workout_variants) {
  (variantsByWorkout[v.workout_id] ??= []).push({
    variant_code: v.variant_code,
    time_budget_minutes: v.time_budget_minutes,
    recovery_state: v.recovery_state,
    volume_multiplier: v.volume_multiplier,
    intensity_modifier: v.intensity_modifier,
  });
}

const tagName = Object.fromEntries(tables.tags.map(t => [t.id, t.name]));
const tagsByWorkout = {};
for (const wt of tables.workout_tags) {
  (tagsByWorkout[wt.workout_id] ??= []).push(tagName[wt.tag_id]);
}

/**
 * Retired templates do not reach the fixture.
 *
 * This file is what the planner plans from — the engine's candidate set and the
 * app's bundled library — so a template that must never be scheduled again has
 * no business in it. The row itself survives in the dump and in Postgres, which
 * is where the history that references it looks things up (migration 0016).
 */
const retired = tables.workout_templates.filter(t => t.status === 'retired');
const schedulable = tables.workout_templates.filter(t => t.status !== 'retired');

const templates = schedulable.map(t => ({
  id: t.id,
  name: t.name,
  workout_family: t.workout_family,
  primary_goal: t.primary_goal,
  // The authored stimulus alongside the planner goal it rolls up to; see
  // scripts/lib/stimulus-taxonomy.mjs.
  stimulus: t.stimulus,
  secondary_goal: t.secondary_goal,
  estimated_minutes: t.estimated_minutes,
  intensity_target: t.intensity_target,
  impact_level: t.impact_level,
  hyrox_specificity: t.hyrox_specificity,
  postpartum_friendly: t.postpartum_friendly === 1,
  requires_running: t.requires_running === 1,
  requires_ski: t.requires_ski === 1,
  description: t.description,
  coaching_notes: t.coaching_notes,
  // Taxonomy (migration 0013). Null until the classification pass runs; the
  // engine reads primary_goal until the coverage gate allows the switch.
  training_domain: t.training_domain ?? null,
  session_type: t.session_type ?? null,
  workout_role: t.workout_role ?? 'primary',
  // Null on a primary, and the two fields a supplemental cannot be offered
  // without (migration 0013). `_shared/supplemental.ts` skips a supplemental
  // row missing either rather than guessing at it.
  supplemental_type: t.supplemental_type ?? null,
  supplemental_load: t.supplemental_load ?? null,
  tags: tagsByWorkout[t.id] ?? [],
  variants: variantsByWorkout[t.id] ?? [],
  blocks: (blocksByWorkout[t.id] ?? []).sort((a, b) => a.block_order - b.block_order),
}));

const substitutions = tables.substitutions.map(s => ({
  exercise_id: s.exercise_id,
  substitute_exercise_id: s.substitute_exercise_id,
  reason: s.reason,
  priority: s.priority,
}));

const out = { exercises, templates, substitutions, equipment: tables.equipment };
const json = JSON.stringify(out, null, 2);

/**
 * Two destinations, one build.
 *
 * The app bundles the library so it runs with no network (src/data/content.ts),
 * and the engine tests run against the same file so a seed change that breaks
 * the engine shows up as a test failure. They were byte-identical copies kept
 * in step by hand, which works until one of them is regenerated and the other
 * is not — and then the tests pass against content the app does not have.
 */
for (const dest of [
  '../tests/engine-fixtures/content.json',
  '../apps/mobile/src/data/content.json',
]) {
  writeFileSync(new URL(dest, import.meta.url), json);
}

console.log(`exercises     ${exercises.length}`);
console.log(`templates     ${templates.length}`);
if (retired.length) {
  console.log(`  retired, not in the fixture: ${retired.length}`);
  for (const t of retired) {
    console.log(`    ${t.id.padEnd(24)} superseded by ${t.superseded_by ?? '(unrecorded)'}`);
  }
}
console.log(`substitutions ${substitutions.length}`);
console.log(`equipment     ${tables.equipment.length}`);
const noBlocks = templates.filter(t => !t.blocks.length);
const noVariants = templates.filter(t => t.variants.length !== 3);
console.log(`templates missing blocks:   ${noBlocks.length}`);
console.log(`templates missing variants: ${noVariants.length}`);
