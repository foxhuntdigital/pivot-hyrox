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
const exercises = tables.exercises.map(e => ({
  id: e.id,
  name: e.name,
  impact_level: e.impact_level,
  postpartum_friendly: e.postpartum_friendly === 1,
  equipment: equipByExercise[e.id] ?? [],
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
        quantity: x.quantity,
        quantity_unit: x.quantity_unit,
        intensity_note: x.intensity_note,
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

const templates = tables.workout_templates.map(t => ({
  id: t.id,
  name: t.name,
  workout_family: t.workout_family,
  primary_goal: t.primary_goal,
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
writeFileSync(new URL('../tests/engine-fixtures/content.json', import.meta.url),
  JSON.stringify(out, null, 2));

console.log(`exercises     ${exercises.length}`);
console.log(`templates     ${templates.length}`);
console.log(`substitutions ${substitutions.length}`);
console.log(`equipment     ${tables.equipment.length}`);
const noBlocks = templates.filter(t => !t.blocks.length);
const noVariants = templates.filter(t => t.variants.length !== 3);
console.log(`templates missing blocks:   ${noBlocks.length}`);
console.log(`templates missing variants: ${noVariants.length}`);
