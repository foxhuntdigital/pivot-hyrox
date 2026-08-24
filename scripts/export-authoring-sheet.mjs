/**
 * Flattens the review and authoring buckets into CSVs for content review.
 *
 * The JSON in data/review/ is the machine-readable form; these are the same
 * rows one-per-line so they can be read, sorted and filled in a spreadsheet.
 * Approved rows go back into a `.ready.json` and through import-workouts.mjs,
 * which re-checks the explicit-unit rule and re-runs semantic dedup.
 *
 *   node scripts/export-authoring-sheet.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../data/review/', import.meta.url);
const cell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const itemsOf = w =>
  (w.blocks ?? []).flatMap((b, i) => (b.items ?? []).map(it =>
    `b${i + 1}:${it.exercise ?? '?'} ${it.quantity ?? '?'}${it.unit ?? '?'}(${it.prescription_type ?? '?'})`)).join(' + ');
const shapeOf = w =>
  (w.blocks ?? []).map(b => `${b.block_type ?? '?'} rounds=${b.rounds ?? '-'} dur=${b.duration_minutes ?? '-'} rest=${b.rest_seconds ?? '-'}`).join(' >> ');

const COLUMNS = {
  review: ['workout_id', 'station', 'category', 'stimulus', 'source_prescription',
    'parsed_items', 'block_shape', 'inferred_unit', 'reason', 'estimated_minutes',
    'timed_total_minutes', 'confidence', 'APPROVE_Y_N', 'CORRECTED_NOTES'],
  authoring: ['workout_id', 'station', 'category', 'stimulus', 'source_prescription',
    'reason', 'partial_parse', 'block_shape', 'estimated_minutes',
    'AUTHOR_block_type', 'AUTHOR_rounds', 'AUTHOR_duration_minutes', 'AUTHOR_rest_seconds',
    'AUTHOR_estimated_minutes', 'AUTHOR_items_exercise_qty_unit_type'],
};

let totals = { review: 0, authoring: 0 };
for (const bucket of ['review', 'authoring']) {
  const rows = [COLUMNS[bucket].join(',')];
  for (const file of readdirSync(DIR).filter(f => f.endsWith(`.${bucket}.json`)).sort()) {
    const doc = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));
    for (const w of doc.workouts) {
      const base = {
        workout_id: w.id, station: w.station, category: w.category, stimulus: w.stimulus,
        source_prescription: w.source_prescription, block_shape: shapeOf(w),
        reason: w.reason, estimated_minutes: w.estimated_minutes,
      };
      rows.push((bucket === 'review' ? [
        base.workout_id, base.station, base.category, base.stimulus, base.source_prescription,
        itemsOf(w), base.block_shape,
        (w.inferred_units ?? []).map(u => `${u.token}->${u.inferred_unit} (${u.movement ?? ''})`).join('; '),
        base.reason, base.estimated_minutes, w.timed_total_minutes, w.confidence, '', '',
      ] : [
        base.workout_id, base.station, base.category, base.stimulus, base.source_prescription,
        base.reason, itemsOf(w), base.block_shape, base.estimated_minutes,
        '', '', '', '', '', '',
      ]).map(cell).join(','));
    }
  }
  totals[bucket] = rows.length - 1;
  writeFileSync(new URL(`${bucket}-sheet.csv`, DIR), rows.join('\n') + '\n');
}

console.log(`data/review/review-sheet.csv     ${totals.review} magnitude-inferred sessions`);
console.log(`data/review/authoring-sheet.csv  ${totals.authoring} sessions needing structured items`);
