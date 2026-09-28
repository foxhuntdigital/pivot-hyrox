/**
 * Reads an edited demand sheet and emits a reviewable changeset. Writes nothing
 * to the seed.
 *
 * This is the half of the round-trip that can be checked by eye. The other half
 * — applying a changeset to data/adaptive_athlete_schema_and_seed.sql — is a
 * separate step on purpose: grading 239 templates is one keystroke away from
 * rewriting the content library, and the two should not be the same keystroke.
 *
 * ── What it can and cannot take back ───────────────────────────────────────
 *
 * EDITABLE columns are one-to-one with content.workout_templates, so a change
 * there becomes a field update.
 *
 * `ref_prescription` is a rendering of workout_blocks and block_exercises and
 * was exported read-only. An edit to it is still worth recovering rather than
 * discarding, so this re-parses the rendered form on both sides and reports the
 * structured delta — a block's rest_seconds, an item's exercise, quantity or
 * intensity note. Anything it cannot read back UNAMBIGUOUSLY is reported as
 * unparsed rather than guessed at, because a prescription silently misread is
 * the failure mode scripts/prepare-pack.mjs exists to prevent. An exercise name
 * is resolved against content.exercises by name, canonical_name or alias, and
 * an unresolvable name is an error, never a new row.
 *
 * The changeset is the review artefact: read it, then apply it.
 *
 *   node scripts/ingest-demand-sheet.mjs data/review/demand-library.v1.graded.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from './lib/csv.mjs';
import { readSeed, jsonArray } from './lib/seed.mjs';
import {
  buildContext, workoutRecord, sheetRow,
  COLUMNS, EDITABLE_COLUMNS, REFERENCE_COLUMNS,
} from './lib/demand-export.mjs';

const sheetPath = process.argv[2] ?? 'data/review/demand-library.v1.graded.csv';
const BASELINE = new URL('../data/review/demand-library.v1.json', import.meta.url);
const OUT = new URL('../data/review/demand-library.v1.changeset.json', import.meta.url);

/* ---------- read the sheet ---------- */

const raw = parseCsv(readFileSync(sheetPath, 'utf8'));
// A spreadsheet writes its sheet name above the table; the header is the first
// row carrying two or more values (the rule lib/xlsx.mjs already uses).
const headerAt = raw.findIndex(r => r.filter(c => c !== '').length > 1);
if (headerAt === -1) throw new Error(`${sheetPath}: no header row found`);
const header = raw[headerAt].map(h => h.trim());

const unknown = header.filter(h => !COLUMNS.includes(h));
const absent = COLUMNS.filter(c => !header.includes(c));
if (unknown.length || absent.length) {
  throw new Error(`${sheetPath}: header does not match the export`
    + (absent.length ? `\n  missing: ${absent.join(', ')}` : '')
    + (unknown.length ? `\n  unknown: ${unknown.join(', ')}` : ''));
}

const rows = raw.slice(headerAt + 1)
  .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '')])))
  .filter(r => Object.values(r).some(v => String(v).trim() !== ''));

/**
 * Comparison has to survive a spreadsheet, which rewrites a file even where a
 * person did not: CRLF for LF, a trailing space trimmed or added, 0.40 for 0.4.
 * Normalising here is what keeps the changeset to cells someone actually typed
 * in rather than 239 rows of the spreadsheet's own punctuation.
 */
const NUMERIC = new Set(['estimated_minutes', 'hyrox_specificity',
  'ref_block_count', 'ref_exercise_count', 'technical_demand', 'load_demand']);
const norm = (v, col) => {
  let s = String(v ?? '').replace(/\r\n?/g, '\n');
  s = s.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').trim();
  if (s === '') return '';
  if (NUMERIC.has(col) && /^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
  if (/^(TRUE|FALSE)$/i.test(s)) return s.toUpperCase();
  return s;
};

/* ---------- baseline ---------- */

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const baseSheet = Object.fromEntries(baseline.workouts.map(w => [w.template_id, sheetRow(w)]));
const baseRecord = Object.fromEntries(baseline.workouts.map(w => [w.template_id, w]));

const { tables } = readSeed();
const ctx = buildContext(tables);

/** Exercise name -> id, over name, canonical_name and aliases. */
const byName = {};
for (const e of tables.exercises) {
  for (const n of [e.name, e.canonical_name, ...jsonArray(e.aliases)]) {
    if (n) (byName[String(n).toLowerCase().trim()] ??= new Set()).add(e.id);
  }
}

/* ---------- re-parse the rendered prescription ---------- */

const BLOCK = /^B(\d+)\s+\[([^\]]*)\]\s*(.*)$/;
const ITEM = /^(\d+)\.\s*(.*)$/;

/** One rendered prescription back into comparable parts. */
function parsePrescription(text) {
  const blocks = [];
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const bm = t.match(BLOCK);
    if (bm) {
      const [, order, title, rest] = bm;
      const parts = rest.split(',').map(s => s.trim()).filter(Boolean);
      const block = { block_order: Number(order), title, items: [], raw: t, unparsed: [] };
      for (const p of parts) {
        let m;
        if ((m = p.match(/^(\d+)\s+rounds$/))) block.rounds = Number(m[1]);
        else if ((m = p.match(/^([\d.]+)\s+min$/))) block.duration_minutes = Number(m[1]);
        else if ((m = p.match(/^rest\s+(\d+)s$/))) block.rest_seconds = Number(m[1]);
        else if (/^(continuous|rounds)$/.test(p)) block.block_type = p;
        else block.unparsed.push(p);
      }
      blocks.push(block);
      continue;
    }
    const im = t.match(ITEM);
    if (im && blocks.length) {
      const body = im[2];
      const dash = body.indexOf('—');
      if (dash === -1) { blocks[blocks.length - 1].items.push({ raw: t, unparsed: true }); continue; }
      const name = body.slice(0, dash).trim();
      let tail = body.slice(dash + 1).trim();
      const item = { sequence_order: Number(im[1]), exercise_name: name, raw: t, unparsed: false };
      const rm = tail.match(/,?\s*rest\s+(\d+)s$/);
      if (rm) { item.rest_seconds = Number(rm[1]); tail = tail.slice(0, rm.index).trim(); }
      const sm = tail.match(/\(([^)]*)\)$/);
      if (sm) { item.side_note = sm[1]; tail = tail.slice(0, sm.index).trim(); }
      const am = tail.indexOf(' @ ');
      if (am !== -1) { item.intensity = tail.slice(am + 3).trim(); tail = tail.slice(0, am).trim(); }
      item.quantity_text = tail.trim();
      blocks[blocks.length - 1].items.push(item);
      continue;
    }
    if (blocks.length) blocks[blocks.length - 1].unparsed.push(t);
  }
  return blocks;
}

const resolveExercise = name => {
  const hit = byName[String(name).toLowerCase().trim()];
  if (!hit || hit.size === 0) return { ok: false, reason: 'no exercise matches this name' };
  if (hit.size > 1) return { ok: false, reason: `ambiguous: ${[...hit].join(', ')}` };
  return { ok: true, exercise_id: [...hit][0] };
};

/* ---------- build the changeset ---------- */

const grades = [];
const fieldUpdates = [];
const prescriptionEdits = [];
const problems = [];
const skippedRows = [];

const seenIds = new Set();
for (const r of rows) {
  const id = String(r.template_id ?? '').trim();
  if (!id) {
    const filled = Object.entries(r).filter(([, v]) => String(v).trim() !== '');
    skippedRows.push({ reason: 'no template_id', cells: Object.fromEntries(filled) });
    continue;
  }
  if (seenIds.has(id)) { problems.push({ template_id: id, problem: 'duplicate row' }); continue; }
  seenIds.add(id);
  const base = baseSheet[id];
  if (!base) { problems.push({ template_id: id, problem: 'not in the baseline export' }); continue; }

  // grades
  const entry = { template_id: id };
  for (const c of ['technical_demand', 'load_demand']) {
    const v = norm(r[c], c);
    if (v === '') { entry[c] = null; continue; }
    if (!/^[1-4]$/.test(v)) {
      problems.push({ template_id: id, problem: `${c} is ${JSON.stringify(r[c])}, expected an integer 1-4` });
      entry[c] = null; continue;
    }
    entry[c] = Number(v);
  }
  if (entry.technical_demand !== null || entry.load_demand !== null) grades.push(entry);

  // editable fields
  for (const c of EDITABLE_COLUMNS) {
    if (c === 'technical_demand' || c === 'load_demand') continue;
    const from = norm(base[c], c), to = norm(r[c], c);
    if (from !== to) fieldUpdates.push({ template_id: id, column: c, from: base[c], to: r[c] });
  }

  // reference columns: recover what can be recovered, report the rest
  for (const c of REFERENCE_COLUMNS) {
    if (norm(base[c], c) === norm(r[c], c)) continue;
    if (c !== 'ref_prescription') {
      problems.push({
        template_id: id,
        problem: `${c} was edited but is derived from other rows; ignored`,
        from: base[c], to: r[c],
      });
      continue;
    }
    const was = parsePrescription(base[c]);
    const now = parsePrescription(r[c]);
    const deltas = [];
    if (was.length !== now.length) {
      deltas.push({ change: 'block_count', from: was.length, to: now.length, applicable: false,
        note: 'adding or removing a block is a content-pack change, not a field update' });
    }
    for (let i = 0; i < Math.min(was.length, now.length); i++) {
      const a = was[i], b = now[i];
      for (const f of ['rounds', 'duration_minutes', 'rest_seconds', 'block_type']) {
        if ((a[f] ?? null) !== (b[f] ?? null)) {
          deltas.push({ change: `block.${f}`, block_order: a.block_order,
            from: a[f] ?? null, to: b[f] ?? null, applicable: true,
            table: 'workout_blocks', column: f });
        }
      }
      if (b.unparsed.length) {
        deltas.push({ change: 'block.unreadable', block_order: a.block_order,
          text: b.unparsed, applicable: false });
      }
      for (let j = 0; j < Math.max(a.items.length, b.items.length); j++) {
        const x = a.items[j], y = b.items[j];
        if (!x || !y) {
          deltas.push({ change: 'item_count', block_order: a.block_order,
            from: a.items.length, to: b.items.length, applicable: false,
            note: 'adding or removing a prescribed item is a content-pack change' });
          break;
        }
        if (y.unparsed) {
          deltas.push({ change: 'item.unreadable', block_order: a.block_order,
            sequence_order: j + 1, text: y.raw, applicable: false });
          continue;
        }
        if (x.exercise_name !== y.exercise_name) {
          const res = resolveExercise(y.exercise_name);
          deltas.push({ change: 'item.exercise', block_order: a.block_order,
            sequence_order: y.sequence_order, from: x.exercise_name, to: y.exercise_name,
            applicable: res.ok, table: 'block_exercises', column: 'exercise_id',
            ...(res.ok ? { exercise_id: res.exercise_id } : { blocked: res.reason }) });
        }
        if (x.quantity_text !== y.quantity_text) {
          deltas.push({ change: 'item.quantity', block_order: a.block_order,
            sequence_order: y.sequence_order, from: x.quantity_text, to: y.quantity_text,
            applicable: true, table: 'block_exercises', column: 'quantity + quantity_unit' });
        }
        if ((x.intensity ?? null) !== (y.intensity ?? null)) {
          deltas.push({ change: 'item.intensity_note', block_order: a.block_order,
            sequence_order: y.sequence_order, from: x.intensity ?? null, to: y.intensity ?? null,
            applicable: true, table: 'block_exercises', column: 'intensity_note' });
        }
        if ((x.rest_seconds ?? null) !== (y.rest_seconds ?? null)) {
          deltas.push({ change: 'item.rest_seconds', block_order: a.block_order,
            sequence_order: y.sequence_order, from: x.rest_seconds ?? null, to: y.rest_seconds ?? null,
            applicable: true, table: 'block_exercises', column: 'rest_seconds' });
        }
      }
    }
    prescriptionEdits.push({ template_id: id, deltas });
  }
}

const missingFromSheet = Object.keys(baseSheet).filter(id => !seenIds.has(id));
const applicable = prescriptionEdits.flatMap(p => p.deltas).filter(d => d.applicable);
const blocked = prescriptionEdits.flatMap(p => p.deltas).filter(d => !d.applicable);

const doc = {
  meta: {
    changeset: 'demand-library',
    version: 'v1',
    sheet: sheetPath,
    baseline: 'data/review/demand-library.v1.json',
    applied: false,
    note: 'Nothing has been written to the seed. This is a review artefact.',
    counts: {
      rows_read: rows.length,
      templates_matched: seenIds.size,
      graded: grades.filter(g => g.technical_demand !== null && g.load_demand !== null).length,
      partially_graded: grades.filter(g => g.technical_demand === null || g.load_demand === null).length,
      missing_from_sheet: missingFromSheet.length,
      field_updates: fieldUpdates.length,
      templates_with_prescription_edits: prescriptionEdits.length,
      prescription_deltas_applicable: applicable.length,
      prescription_deltas_blocked: blocked.length,
      problems: problems.length,
      skipped_rows: skippedRows.length,
    },
    grade_distribution: {
      technical_demand: grades.reduce((a, g) => (g.technical_demand != null && (a[g.technical_demand] = (a[g.technical_demand] ?? 0) + 1), a), {}),
      load_demand: grades.reduce((a, g) => (g.load_demand != null && (a[g.load_demand] = (a[g.load_demand] ?? 0) + 1), a), {}),
    },
  },
  grades,
  field_updates: fieldUpdates,
  prescription_edits: prescriptionEdits,
  missing_from_sheet: missingFromSheet,
  problems,
  skipped_rows: skippedRows,
};

writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');

const c = doc.meta.counts;
console.log(`sheet: ${sheetPath}`);
console.log(`  ${c.templates_matched} templates matched, ${c.graded} fully graded`
  + (c.partially_graded ? `, ${c.partially_graded} partial` : ''));
console.log(`  technical_demand ${JSON.stringify(doc.meta.grade_distribution.technical_demand)}`);
console.log(`  load_demand      ${JSON.stringify(doc.meta.grade_distribution.load_demand)}`);
console.log(`  field updates (editable columns): ${c.field_updates}`);
console.log(`  prescription edits: ${c.templates_with_prescription_edits} templates`
  + ` — ${c.prescription_deltas_applicable} recoverable, ${c.prescription_deltas_blocked} blocked`);
if (c.missing_from_sheet) console.log(`  MISSING from sheet: ${c.missing_from_sheet}`);
if (c.problems) {
  console.log(`\n  ${c.problems} problem(s):`);
  for (const p of problems.slice(0, 10)) console.log(`    ${p.template_id}: ${p.problem}`);
}
if (c.skipped_rows) {
  console.log(`\n  ${c.skipped_rows} row(s) skipped:`);
  for (const s of skippedRows) console.log(`    ${s.reason}: ${JSON.stringify(s.cells)}`);
}
console.log('\nwrote data/review/demand-library.v1.changeset.json  (nothing applied)');
