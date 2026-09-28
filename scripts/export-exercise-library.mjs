/**
 * Exports the strength exercise library — the ontology, as authored.
 *
 * `data/review/strength-library.export.{json,csv}` has existed since 1 Sep and
 * no script produced it. It was generated once, by hand, against
 * `supabase/seed/01_content.sql` at commit cb3b6ff, and could therefore never
 * be refreshed — which is the same as saying it began drifting from the library
 * the moment it was written. This is that export as a script, so the content
 * team can ask for a current one instead of trusting a snapshot.
 *
 * ── What "the strength library" means ──────────────────────────────────────
 *
 * Not `category = 'strength'`; that is 51 rows and misses every power, carry
 * and accessory movement. The library is the subset of content.exercises with a
 * POPULATED ONTOLOGY — `movement_families` non-empty — which is the rule the
 * original export recorded in its own meta and the one
 * scripts/import-mobility-vocabulary.mjs describes in prose:
 *
 *     "The strength library is not everything in content.exercises. It is the
 *      subset with a populated ontology ... Cardio rows have lived in this
 *      table with empty ontology arrays since the first seed for exactly this
 *      reason, and mobility rows join them on the same terms."
 *
 * So cardio, erg, run, boxing and mobility rows are excluded by that emptiness
 * rather than by a list of ids — they are rows a session can prescribe, not
 * movements the progression model has an opinion about. Adding a mobility row
 * never grows this file; populating its ontology would, which is the correct
 * trigger.
 *
 * ── Derived columns ────────────────────────────────────────────────────────
 *
 * Three of the exported columns are not columns on content.exercises:
 *
 *   variant_children     reverse of variant_parent, collected across the whole
 *                        catalogue — a parent outside the library still lists
 *                        the children inside it.
 *   equipment_required   content.exercise_equipment where required = 1
 *   equipment_optional   content.exercise_equipment where required = 0
 *
 * Everything else is read straight off the row.
 *
 * Read-only: the seed is never written, and the outputs land in data/review/,
 * which no generator reads.
 *
 *   node scripts/export-exercise-library.mjs
 */
import { writeFileSync } from 'node:fs';
import { writeCsv } from './lib/csv.mjs';
import { readSeed, jsonArray } from './lib/seed.mjs';

const OUT = new URL('../data/review/', import.meta.url);

/** Exactly the requested columns, in the requested order. */
const COLUMNS = [
  'id', 'name', 'canonical_name', 'aliases', 'category', 'status',
  'movement_pattern', 'movement_families', 'modality', 'methodology_bucket',
  'training_qualities', 'movement_characters', 'complexity_level',
  'exercise_role_eligibility', 'progression_class', 'progression_tracks',
  'exercise_family_id', 'variant_parent', 'variant_children',
  'history_comparability_group',
  'equipment_required', 'equipment_optional', 'default_unit', 'impact_level',
  'notes',
];

/** Columns holding a list. Arrays in JSON, pipe-joined in CSV — the convention
 *  the original export used, kept so existing review sheets stay comparable. */
const LIST_COLUMNS = new Set([
  'aliases', 'movement_families', 'training_qualities', 'movement_characters',
  'exercise_role_eligibility', 'progression_tracks', 'variant_children',
  'equipment_required', 'equipment_optional',
]);

const { tables, schema } = readSeed();

/* Derived: equipment, split on `required`. */
const equipment = {};
for (const r of tables.exercise_equipment ?? []) {
  const e = (equipment[r.exercise_id] ??= { required: [], optional: [] });
  (r.required ? e.required : e.optional).push(r.equipment_id);
}

/* Derived: variant children, reversed across the whole catalogue, not just the
 * library — a parent row that sits outside it still owns its children. */
const children = {};
for (const e of tables.exercises) {
  if (e.variant_parent) (children[e.variant_parent] ??= []).push(e.id);
}

const inLibrary = e => jsonArray(e.movement_families).length > 0;
const library = tables.exercises.filter(inLibrary)
  .sort((a, b) => String(a.movement_families).localeCompare(String(b.movement_families))
    || String(a.exercise_family_id ?? '').localeCompare(String(b.exercise_family_id ?? ''))
    || a.id.localeCompare(b.id));

const record = e => ({
  id: e.id,
  name: e.name,
  canonical_name: e.canonical_name,
  aliases: jsonArray(e.aliases),
  category: e.category,
  status: e.status,
  movement_pattern: e.movement_pattern,
  movement_families: jsonArray(e.movement_families),
  modality: e.modality,
  methodology_bucket: e.methodology_bucket,
  training_qualities: jsonArray(e.training_qualities),
  movement_characters: jsonArray(e.movement_characters),
  complexity_level: e.complexity_level,
  exercise_role_eligibility: jsonArray(e.exercise_role_eligibility),
  progression_class: e.progression_class,
  progression_tracks: jsonArray(e.progression_tracks),
  exercise_family_id: e.exercise_family_id,
  variant_parent: e.variant_parent,
  variant_children: (children[e.id] ?? []).slice().sort(),
  history_comparability_group: e.history_comparability_group,
  equipment_required: (equipment[e.id]?.required ?? []).slice().sort(),
  equipment_optional: (equipment[e.id]?.optional ?? []).slice().sort(),
  default_unit: e.default_unit,
  impact_level: e.impact_level,
  notes: e.notes,
});

const exercises = library.map(record);

/* Every requested column must exist on the row we built, or the header lies. */
const absent = COLUMNS.filter(c => !(c in exercises[0]));
if (absent.length) throw new Error(`requested column not produced: ${absent.join(', ')}`);

const countBy = (rows, f) => rows.reduce((a, r) => {
  const k = r[f] ?? 'NULL';
  a[k] = (a[k] ?? 0) + 1;
  return a;
}, {});
const spread = (rows, f) => rows.reduce((a, r) => {
  for (const v of r[f]) a[v] = (a[v] ?? 0) + 1;
  return a;
}, {});

/** How much of each column is actually filled in — a column that is 5% present
 *  is a different thing to author against than one that is 100%, and the sheet
 *  should say so rather than let a reviewer infer it from blank cells. */
const filled = Object.fromEntries(COLUMNS.map(c => {
  const n = exercises.filter(e => {
    const v = e[c];
    return LIST_COLUMNS.has(c) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== '';
  }).length;
  return [c, `${n}/${exercises.length}`];
}));

const doc = {
  meta: {
    export: 'exercise-library',
    version: 'v1',
    source: 'data/adaptive_athlete_schema_and_seed.sql (read-only) — content.exercises '
      + '+ content.exercise_equipment',
    scope: 'Exercises with a populated ontology (movement_families non-empty) — the Strength '
      + '& Athletic Development library per migrations 0014/0015.',
    excluded: 'Cardio, erg, run, boxing and mobility rows carry empty ontology arrays and NULL '
      + 'progression_class by design. They are movements a session can prescribe, not movements '
      + 'the progression model grades.',
    supersedes: 'data/review/strength-library.export.{json,csv} — generated by hand at commit '
      + 'cb3b6ff on 1 Sep with no producing script, and unrefreshable since.',
    exercises_in_catalogue: tables.exercises.length,
    exercise_library_count: exercises.length,
    derived_columns: {
      variant_children: 'reverse of variant_parent, across the whole catalogue',
      equipment_required: 'content.exercise_equipment where required = 1',
      equipment_optional: 'content.exercise_equipment where required = 0',
    },
    list_columns: [...LIST_COLUMNS],
    csv_list_separator: '|',
    sort: 'movement_families, then exercise_family_id, then id',
    column_fill: filled,
    by_category: countBy(exercises, 'category'),
    by_status: countBy(exercises, 'status'),
    by_complexity_level: countBy(exercises, 'complexity_level'),
    by_methodology_bucket: countBy(exercises, 'methodology_bucket'),
    by_progression_class: countBy(exercises, 'progression_class'),
    by_movement_family: spread(exercises, 'movement_families'),
    caveats: [
      'equipment_optional is empty for every row: all 318 content.exercise_equipment rows '
        + 'carry required = 1. The column is exported because it was asked for and the join '
        + 'supports it, not because anything populates it yet.',
      'aliases (10/217), variant_parent (29/217), variant_children (17/217) and notes (37/217) '
        + 'are sparse. See column_fill for every column.',
    ],
  },
  exercises,
};

writeFileSync(new URL('exercise-library.v1.json', OUT), JSON.stringify(doc, null, 1) + '\n');

const cell = v => (Array.isArray(v) ? v.join('|') : v);
writeFileSync(new URL('exercise-library.v1.csv', OUT), writeCsv(COLUMNS,
  exercises.map(e => Object.fromEntries(COLUMNS.map(c => [c, cell(e[c])])))));

console.log(`exercise library: ${exercises.length} of ${tables.exercises.length} catalogue rows`);
console.log(`  rule: movement_families non-empty (ontology populated)`);
console.log(`  columns: ${COLUMNS.length} (${[...LIST_COLUMNS].length} list columns, pipe-joined in CSV)`);
console.log('\n  by category:');
for (const [k, n] of Object.entries(doc.meta.by_category).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(16)} ${String(n).padStart(3)}`);
}
const sparse = Object.entries(filled).filter(([, v]) => {
  const [n, d] = v.split('/').map(Number);
  return n < d;
});
console.log('\n  columns not fully populated:');
for (const [c, v] of sparse) console.log(`    ${c.padEnd(28)} ${v}`);
console.log('\nwrote data/review/exercise-library.v1.json');
console.log('wrote data/review/exercise-library.v1.csv');
