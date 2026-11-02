/**
 * Field-completeness audit of the content library.
 *
 * Every column of workout_templates, workout_blocks, block_exercises and
 * workout_variants, with how many rows actually carry a value. A nullable
 * column that is null everywhere is indistinguishable from a column nothing
 * writes to, and the difference matters: the first is content debt, the second
 * is a feature that was never finished. Neither shows up in a test.
 *
 * Templates are split primary/supplemental because the two legitimately differ
 * — a supplemental carries NULL primary_goal and training_domain by design
 * (migration 0018), so counting them together reports a gap that is actually
 * the schema working.
 *
 * Read-only.
 *
 *   node scripts/audit-content-fields.mjs
 */
import { writeFileSync } from 'node:fs';
import { writeCsv } from './lib/csv.mjs';
import { readSeed } from './lib/seed.mjs';

const OUT = new URL('../data/review/content-field-audit.csv', import.meta.url);
const { schema, tables } = readSeed();

const blank = v => v === null || v === undefined || String(v).trim() === ''
  || String(v).trim() === '[]';

/** Columns that are NULL by design for a given slice, so a gap is not a gap. */
const BY_DESIGN = {
  'workout_templates/supplemental': new Set(['primary_goal', 'training_domain', 'session_type',
    'superseded_by', 'technical_demand', 'load_demand']),
  'workout_templates/primary': new Set(['superseded_by', 'supplemental_type', 'supplemental_load']),
};

const slices = [
  {
    key: 'workout_templates/primary', table: 'workout_templates',
    rows: tables.workout_templates.filter(t => (t.workout_role ?? 'primary') === 'primary'),
  },
  {
    key: 'workout_templates/supplemental', table: 'workout_templates',
    rows: tables.workout_templates.filter(t => t.workout_role === 'supplemental'),
  },
  { key: 'workout_blocks', table: 'workout_blocks', rows: tables.workout_blocks },
  { key: 'block_exercises', table: 'block_exercises', rows: tables.block_exercises },
  { key: 'workout_variants', table: 'workout_variants', rows: tables.workout_variants },
];

const report = [];
for (const s of slices) {
  const design = BY_DESIGN[s.key] ?? new Set();
  for (const col of schema[s.table]) {
    const filled = s.rows.filter(r => !blank(r[col])).length;
    const pct = s.rows.length ? Math.round((filled / s.rows.length) * 100) : 0;
    report.push({
      slice: s.key, column: col, rows: s.rows.length,
      filled, empty: s.rows.length - filled, percent_filled: pct,
      by_design: design.has(col) ? 'yes' : '',
      flag: design.has(col) ? '' : pct === 0 ? 'EMPTY' : pct < 50 ? 'sparse' : '',
    });
  }
}

writeFileSync(OUT, writeCsv(
  ['slice', 'column', 'rows', 'filled', 'empty', 'percent_filled', 'by_design', 'flag'], report));

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
for (const s of slices) {
  const mine = report.filter(r => r.slice === s.key);
  console.log(`\n${s.key}  (${s.rows.length} rows)`);
  const notable = mine.filter(r => r.flag || r.by_design === 'yes');
  if (!notable.length) { console.log('  every column fully populated'); continue; }
  for (const r of notable) {
    console.log('  ' + pad(r.column, 24), pad(`${r.filled}/${r.rows}`, 10),
      pad(r.percent_filled + '%', 5), r.by_design === 'yes' ? '(null by design)' : r.flag);
  }
}
console.log('\nwrote data/review/content-field-audit.csv');
