/**
 * One worksheet for everything still blocked, with a column per blocker.
 *
 * Three distinct gaps came out of the first authoring round:
 *   - intensity_target absent (the matrix pack has no such column at all)
 *   - per-block rounds/rest, which the flat sheet had nowhere to put
 *   - movements the exercise library does not define
 *
 *   node scripts/export-followup-sheet.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = new URL('../data/review/', import.meta.url);
const read = f => JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const source = {};
for (const f of ['hyrox-station-matrix', 'running-expansion']) {
  for (const b of ['review', 'authoring']) {
    for (const w of read(`${f}.${b}.json`).workouts) source[w.id] = w;
  }
}
const authored = Object.fromEntries(read('authored.v1.json').authoring.map(r => [r.workout_id, r]));

const rows = new Map();
const add = (id, blocker, detail) => {
  const s = source[id] ?? {};
  const a = authored[id] ?? {};
  const r = rows.get(id) ?? {
    workout_id: id, station: s.station, category: s.category, stimulus: s.stimulus,
    source_prescription: s.source_prescription, authored_items: a.authored_items,
    estimated_minutes: a.estimated_minutes ?? s.estimated_minutes, blockers: [], details: [],
  };
  r.blockers.push(blocker); r.details.push(detail);
  rows.set(id, r);
};

for (const r of read('import-rejected.json').rejected) {
  for (const reason of r.reasons) {
    add(r.id, /intensity_target/.test(reason) ? 'intensity_target' : 'other', reason);
  }
}
for (const h of read('authored.held.json').held) {
  for (const reason of h.reasons) {
    add(h.id, /carries structure/.test(reason) ? 'per-block rounds/rest'
      : /no exercise named/.test(reason) ? 'undefined exercise'
      : /review rejected/.test(reason) ? 'review rejected' : 'other', reason);
  }
}

const COLUMNS = ['workout_id', 'blockers', 'detail', 'station', 'category', 'stimulus',
  'source_prescription', 'authored_items', 'estimated_minutes',
  'AUTHOR_intensity_target', 'AUTHOR_per_block_rounds_rest', 'AUTHOR_new_exercise_definition'];

const out = [COLUMNS.join(',')];
for (const r of [...rows.values()].sort((a, b) => a.workout_id.localeCompare(b.workout_id))) {
  out.push([r.workout_id, [...new Set(r.blockers)].join(' + '), r.details.join(' | '),
    r.station, r.category, r.stimulus, r.source_prescription, r.authored_items,
    r.estimated_minutes, '', '', ''].map(cell).join(','));
}
writeFileSync(new URL('followup-sheet.csv', DIR), out.join('\n') + '\n');

const tally = {};
for (const r of rows.values()) for (const b of new Set(r.blockers)) tally[b] = (tally[b] ?? 0) + 1;
console.log(`data/review/followup-sheet.csv  ${rows.size} rows still blocked`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
