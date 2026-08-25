/**
 * Folds the filled-in follow-up sheet into the canonical ready pack.
 *
 * Three kinds of answer come back: an intensity_target for every row, a
 * per-block rounds/rest rebuild for sessions the flat sheet could not express,
 * and decisions about movements the exercise library lacked.
 *
 * Some authored structures are richer than content.workout_blocks can hold —
 * `rest_seconds` is a single column per block, `rounds` belongs to the block
 * and not to an item, and `quantity` is a number. Those rows are reported with
 * the specific column that would have to change, rather than being flattened
 * into something that reads plausible and prescribes something else.
 *
 *   node scripts/ingest-followup.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = new URL('../data/review/', import.meta.url);
const read = f => JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));

const followup = read('followup.v2.json');
const authored = Object.fromEntries(read('authored.v1.json').authoring.map(r => [r.workout_id, r]));
const lib = JSON.parse(readFileSync(new URL('../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));
const known = new Set(lib.exercises.map(e => e.name.toLowerCase()));
for (const d of Object.values(followup.new_exercises)) {
  if (d.decision === 'create') known.add(d.exercise.name.toLowerCase());
}

const source = {};
for (const f of ['hyrox-station-matrix', 'running-expansion']) {
  for (const b of ['ready', 'review', 'authoring']) for (const w of read(`${f}.${b}.json`).workouts) source[w.id] = w;
}

const UNIT = { min: 'min', sec: 's', s: 's', m: 'm', ft: 'ft', reps: 'reps', steps: 'steps', mile: 'mile' };
/** Renames applied by the exercise decisions, e.g. Run/Walk -> Run. */
const rename = {};
for (const d of Object.values(followup.new_exercises)) {
  if (d.decision === 'do_not_create' && d.replacement) rename['run/walk'] = d.replacement;
  if (d.decision === 'create') rename[d.exercise.canonical_name.replace(/_/g, ' ')] = d.exercise.name;
}
rename['run drill'] = 'Running Drills';

/** Parses the compact `b1:Name 500m|distance` notation from the first sheet. */
function itemsFromAuthored(text) {
  const out = new Map();
  for (const seg of String(text ?? '').split(';')) {
    const s = seg.trim();
    if (!s || /^(?:source_context|note)\s*:/i.test(s)) continue;
    const m = s.match(/^b(\d+)\s*:\s*(.+)$/i);
    if (!m) continue;
    for (const piece of m[2].split(/\s+\+\s+/)) {
      const parts = piece.split('|').map(p => p.trim());
      let it;
      if (parts.length >= 4 && /^\d+(\.\d+)?$/.test(parts[1])) {
        it = { exercise: parts[0], quantity: Number(parts[1]), unit: UNIT[parts[2].toLowerCase()] ?? parts[2], prescription_type: parts[3], intensity: parts.slice(4).join(' | ') || null };
      } else {
        const c = piece.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*\|\s*(\w+)$/);
        if (!c) continue;
        it = { exercise: c[1].trim(), quantity: Number(c[2]), unit: UNIT[c[3].toLowerCase()] ?? c[3], prescription_type: c[4], intensity: null };
      }
      const k = Number(m[1]);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(it);
    }
  }
  return out;
}


/**
 * Warm-up and cool-down are claims the source has to make. Positional guessing
 * mislabels any session whose first block is real work.
 */
function titleFor(items, bs, pb) {
  const text = [pb?.title, pb?.instructions, bs?.note, bs?.recovery,
    ...items.map(i => i.intensity)].filter(Boolean).join(' ').toLowerCase();
  if (/\bwarm-?\s?up\b/.test(text)) return 'Warm-up';
  if (/\bcool-?\s?down\b|\bcooldown\b|\bflush\b/.test(text)) return 'Cool-down';
  return 'Main';
}

const ready = [], blocked = [];
const ids = new Set([...Object.keys(followup.intensity_target)]);

for (const id of ids) {
  const src = source[id];
  const a = authored[id];
  const spec = followup.per_block[id];
  const problems = [];
  if (!src) { blocked.push({ id, reasons: ['no source row'] }); continue; }

  // Structures the schema cannot hold. Each names the column that would change.
  for (const b of spec?.blocks ?? []) {
    if (b.rest_seconds_by_rep) problems.push(`per-rep rest ${JSON.stringify(b.rest_seconds_by_rep)} — workout_blocks.rest_seconds is one value per block`);
    if (b.embedded) problems.push('surges embedded inside a continuous block — no schema construct for work nested in a duration');
    if (b.intervals) problems.push('an interval set inside a duration block — same nesting gap');
    for (const it of b.items ?? []) {
      if (typeof it.quantity === 'string') problems.push(`quantity ${JSON.stringify(it.quantity)} is not a number — block_exercises.quantity is REAL`);
    }
  }

  // Rows that came back from the review bucket were never re-authored — their
  // parse already carries blocks, and the sheet only added an intensity.
  const fromAuthored = a?.authored_items
    ? itemsFromAuthored(a.authored_items)
    : new Map((src.blocks ?? []).map((b, i) => [i + 1, b.items]));
  const parsedBlocks = a?.authored_items ? null : (src.blocks ?? null);
  const blocks = [];
  const specBlocks = spec?.blocks ?? [];
  const indices = specBlocks.length
    ? specBlocks.map((b, i) => ({ spec: b, idx: Number(String(b.block).replace(/\D/g, '')) || i + 1 }))
    : [...fromAuthored.keys()].sort((x, y) => x - y).map(idx => ({ spec: null, idx }));

  for (const { spec: bs, idx } of indices) {
    // `item_rounds` is a movement repeated inside the block. The schema keeps
    // rounds on the block, so the item is emitted that many times — which is
    // lossless and, unlike splitting the block, still compresses correctly:
    // the block's rounds are what Express and Micro cut.
    const expanded = (bs?.items ?? fromAuthored.get(idx) ?? [])
      .flatMap(it => Array.from({ length: it.item_rounds ?? 1 }, () => ({ ...it, item_rounds: undefined })));
    const items = expanded.map(it => ({
      exercise: rename[String(it.exercise).toLowerCase()] ?? it.exercise,
      prescription_type: it.prescription_type,
      quantity: it.unit === 'mile' ? Math.round(it.quantity * 1609) : it.quantity,
      unit: it.unit === 'mile' ? 'm' : (UNIT[String(it.unit).toLowerCase()] ?? it.unit),
      intensity: it.intensity ?? null,
    }));
    if (!items.length) { problems.push(`block b${idx} has no items`); continue; }
    for (const it of items) if (!known.has(String(it.exercise).toLowerCase())) problems.push(`no exercise named ${JSON.stringify(it.exercise)}`);
    // An authored block spec is authoritative for its own shape. Falling back
    // to the earlier parse here let a rejected parse's round count leak into a
    // block that was authored precisely to replace it — a 10 minute warm-up
    // became ten of them.
    const pb = bs ? null : (parsedBlocks?.[idx - 1] ?? null);
    const rounds = bs
      ? (bs.rounds && bs.rounds > 1 ? bs.rounds : null)
      : pb?.rounds ?? (indices.length === 1 ? a?.rounds ?? null : null);
    blocks.push({
      block_type: rounds ? 'rounds' : 'continuous',
      rounds: rounds ?? null,
      duration_minutes: bs?.duration_minutes ?? pb?.duration_minutes
        ?? (rounds ? null : (indices.length === 1 ? a?.duration_minutes ?? null : null)),
      rest_seconds: bs?.rest_seconds ?? pb?.rest_seconds ?? (indices.length === 1 ? a?.rest_seconds ?? null : null),
      // Title by what the block says it is, never by where it sits. A
      // negative-split 6K has two main halves, not a warm-up and a cool-down,
      // and blockRole() reads this title to decide how Micro scales the block.
      title: titleFor(items, bs, pb),
      instructions: bs?.recovery ? `Recovery between rounds: ${bs.recovery}` : bs?.note ?? pb?.instructions ?? null,
      items,
    });
  }
  if (!blocks.length) problems.push('no blocks');
  // A per-block rebuild may restate the total — the row it replaced carried the
  // rejected parse's estimate, which no longer describes the session.
  const estimated = spec?.estimated_minutes ?? a?.estimated_minutes ?? src.estimated_minutes;
  if (!estimated) problems.push('missing estimated_minutes');

  if (problems.length) { blocked.push({ id, reasons: [...new Set(problems)] }); continue; }

  ready.push({
    id, name: src.name, workout_family: src.workout_family, stimulus: src.stimulus,
    category: src.category, station: src.station, estimated_minutes: estimated,
    intensity_target: followup.intensity_target[id],
    impact_level: src.impact_level, hyrox_specificity: src.hyrox_specificity,
    source_prescription: src.source_prescription, blocks,
  });
}

writeFileSync(new URL('followup.ready.json', DIR), JSON.stringify({
  meta: { pack: 'Adaptive Athlete Follow-up v2', format: 'canonical-v1', workout_count: ready.length },
  workouts: ready,
}, null, 1));
writeFileSync(new URL('followup.blocked.json', DIR), JSON.stringify({ meta: { blocked: blocked.length }, blocked }, null, 1));

console.log(`ready    ${ready.length}`);
console.log(`blocked  ${blocked.length}`);
const by = {};
for (const b of blocked) for (const r of b.reasons) (by[r.replace(/\[[^\]]*\]/, '[...]').replace(/"[^"]*"/g, 'X')] ??= []).push(b.id);
for (const [r, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(2)}  ${r}`);
  console.log(`      ${list.join(', ')}`);
}
