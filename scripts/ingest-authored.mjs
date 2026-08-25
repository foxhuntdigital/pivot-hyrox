/**
 * Turns a filled-in authoring/review pack into canonical `.ready.json`.
 *
 * Review rows marked Y take the parse they were reviewing, verbatim — that is
 * what was signed off. Rows marked N are held out; their corrections are prose
 * again, and re-deriving structure from prose is the thing we stopped doing.
 *
 * Authored rows are read from `authored_items`. Two notations are accepted:
 *
 *   b1:SkiErg 500m|distance                 compact
 *   b1:Sled Push|20|ft|distance|70% load    explicit, with an intensity note
 *
 * `bN` groups items into blocks, so a sequence authors as b1/b2/b3.
 *
 * The check that matters: a sheet has ONE rounds/rest per workout, so a
 * multi-block session cannot express per-block structure. Where an intensity
 * note still carries structure — "tempo x3 with 120sec easy recovery" — that
 * structure would be lost on import, and the row is refused rather than
 * silently flattened.
 *
 *   node scripts/ingest-authored.mjs data/review/authored.v1.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const packPath = process.argv[2] ?? 'data/review/authored.v1.json';
const authored = JSON.parse(readFileSync(packPath, 'utf8'));
const lib = JSON.parse(readFileSync(new URL('../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));
const knownExercise = new Set(lib.exercises.map(e => e.name.toLowerCase()));

const source = {};
for (const f of ['hyrox-station-matrix', 'running-expansion']) {
  for (const bucket of ['review', 'authoring']) {
    const doc = JSON.parse(readFileSync(new URL(`../data/review/${f}.${bucket}.json`, import.meta.url), 'utf8'));
    for (const w of doc.workouts) source[w.id] = w;
  }
}

const UNITS = { min: 'min', mins: 'min', sec: 's', secs: 's', s: 's', m: 'm', km: 'km', mile: 'mile', miles: 'mile', ft: 'ft', reps: 'reps', rep: 'reps', steps: 'steps', step: 'steps' };
const TYPES = new Set(['duration', 'distance', 'reps', 'sets_reps', 'calories', 'load']);
/** Structure that a single rounds/rest per workout cannot hold. */
const EMBEDDED_STRUCTURE = /\bx\s?\d+\b|\brepeat\b|\brecover(?:y|ies)\b|\d+\s*sec\b|\d+\s*min\b|\/\d/i;

const ready = [], held = [];

function parseItem(raw, where) {
  const text = raw.trim();
  // explicit: Name|qty|unit|type[|intensity]
  const parts = text.split('|').map(p => p.trim());
  if (parts.length >= 4 && /^\d+(\.\d+)?$/.test(parts[1])) {
    const [name, qty, unit, type, ...rest] = parts;
    return { name, quantity: Number(qty), unit: UNITS[unit.toLowerCase()] ?? unit, type, intensity: rest.join(' | ') || null, where };
  }
  // compact: Name QTYUNIT|type
  const m = text.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*\|\s*(\w+)$/);
  if (m) return { name: m[1].trim(), quantity: Number(m[2]), unit: UNITS[m[3].toLowerCase()] ?? m[3], type: m[4], intensity: null, where };
  return { error: `cannot read item ${JSON.stringify(text)}`, where };
}

for (const row of authored.authoring) {
  const src = source[row.workout_id];
  const problems = [];
  if (!src) { held.push({ id: row.workout_id, reasons: ['no source row — unknown workout_id'] }); continue; }

  // Group items by their bN prefix.
  const byBlock = new Map();
  for (const seg of String(row.authored_items).split(';')) {
    const s = seg.trim();
    if (!s || /^(?:source_context|note)\s*:/i.test(s)) continue;
    const m = s.match(/^b(\d+)\s*:\s*(.+)$/i);
    if (!m) { problems.push(`segment has no bN prefix: ${JSON.stringify(s)}`); continue; }
    const idx = Number(m[1]);
    for (const piece of m[2].split(/\s+\+\s+/)) {
      const it = parseItem(piece, `b${idx}`);
      if (it.error) { problems.push(it.error); continue; }
      if (!knownExercise.has(it.name.toLowerCase())) problems.push(`no exercise named ${JSON.stringify(it.name)} in the library`);
      if (!TYPES.has(it.type)) problems.push(`prescription_type ${JSON.stringify(it.type)} is not one of ${[...TYPES].join('/')}`);
      if (it.intensity && EMBEDDED_STRUCTURE.test(it.intensity)) {
        problems.push(`b${idx} intensity ${JSON.stringify(it.intensity)} still carries structure the sheet has no field for`);
      }
      if (!byBlock.has(idx)) byBlock.set(idx, []);
      byBlock.get(idx).push(it);
    }
  }
  if (!byBlock.size) problems.push('no items');
  if (!row.estimated_minutes) problems.push('missing estimated_minutes');

  const indices = [...byBlock.keys()].sort((a, b) => a - b);
  // rounds/rest are per-workout on the sheet, so they can only be trusted when
  // the workout is a single block.
  if (indices.length > 1 && (row.rounds != null || row.rest_seconds != null)) {
    problems.push(`${indices.length} blocks but rounds/rest are per-workout on the sheet — cannot tell which block they belong to`);
  }

  if (problems.length) { held.push({ id: row.workout_id, reasons: [...new Set(problems)] }); continue; }

  const single = indices.length === 1;
  ready.push({
    id: row.workout_id, name: src.name, workout_family: src.workout_family,
    stimulus: src.stimulus, category: src.category, station: src.station,
    estimated_minutes: row.estimated_minutes, intensity_target: src.intensity_target,
    impact_level: src.impact_level, hyrox_specificity: src.hyrox_specificity,
    source_prescription: src.source_prescription,
    blocks: indices.map((idx, i) => {
      const items = byBlock.get(idx);
      const rounds = single ? row.rounds ?? null : null;
      const timed = items.every(it => it.type === 'duration' && it.unit === 'min');
      return {
        // 'emom'/'amrap'/'sequence'/'benchmark' are not shapes the engine knows;
        // they collapse to whether the block repeats a set number of times.
        block_type: rounds ? 'rounds' : 'continuous',
        rounds,
        duration_minutes: single ? row.duration_minutes ?? null : (timed ? items.reduce((s, it) => s + it.quantity, 0) : null),
        rest_seconds: single ? row.rest_seconds ?? null : null,
        // Titled by what the block says it is, not by position — blockRole()
        // reads this, and a mislabelled first block gets warm-up scaling.
        title: /\bwarm-?\s?up\b/i.test(items.map(x => x.intensity).join(' ')) ? 'Warm-up'
          : /\bcool-?\s?down\b|\bcooldown\b/i.test(items.map(x => x.intensity).join(' ')) ? 'Cool-down'
          : 'Main',
        instructions: row.block_type === 'emom' ? 'EMOM — one movement per minute'
          : row.block_type === 'amrap' ? 'Repeat the circuit for the time available'
          : row.block_type === 'benchmark' ? 'Repeatable test — record the result under the same conditions'
          : null,
        items: items.map(it => ({
          exercise: it.name, prescription_type: it.type,
          quantity: it.unit === 'mile' ? Math.round(it.quantity * 1609) : it.quantity,
          unit: it.unit === 'mile' ? 'm' : it.unit,
          intensity: it.intensity,
        })),
      };
    }),
  });
}

// Review rows: Y takes the parse as signed off, N is held.
const approvedIds = new Set(authored.review.filter(r => r.approve === 'Y').map(r => r.workout_id));
for (const r of authored.review) {
  const src = source[r.workout_id];
  if (!src) { held.push({ id: r.workout_id, reasons: ['no source row'] }); continue; }
  if (r.approve !== 'Y') { held.push({ id: r.workout_id, reasons: ['review rejected — correction is prose, needs authoring'] }); continue; }
  ready.push({ ...src, estimated_minutes: src.estimated_minutes });
}

const out = new URL('../data/review/authored.ready.json', import.meta.url);
writeFileSync(out, JSON.stringify({
  meta: { pack: 'Adaptive Athlete Authored v1', format: 'canonical-v1', workout_count: ready.length,
    _note: 'Authored rows plus review rows signed off Y. Held-out rows are listed in authored.held.json.' },
  workouts: ready,
}, null, 1));
writeFileSync(new URL('../data/review/authored.held.json', import.meta.url),
  JSON.stringify({ meta: { held: held.length }, held }, null, 1));

console.log(`ready  ${ready.length}   (${ready.length - approvedIds.size} authored + ${approvedIds.size} review-approved)`);
console.log(`held   ${held.length}`);
const byReason = {};
for (const h of held) for (const r of h.reasons) {
  const k = r.replace(/"[^"]*"/g, 'X').replace(/\d+ blocks/, 'N blocks');
  (byReason[k] ??= []).push(h.id);
}
for (const [k, ids] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(ids.length).padStart(3)}  ${k}`);
}
