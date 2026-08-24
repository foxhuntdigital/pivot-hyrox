/**
 * Imports canonical content packs into the seed dump.
 *
 * `data/adaptive_athlete_schema_and_seed.sql` is the source of truth both
 * generators read, so a pack has to land there rather than in the generated
 * files. Re-running replaces a pack's rows instead of duplicating them, so
 * editing a pack and importing again is the normal workflow.
 *
 * Two rules are enforced, not advised:
 *
 *   1. EXPLICIT UNITS. No workout is importable unless every prescribed
 *      quantity carries an explicit prescription_type and unit. Prose packs go
 *      through scripts/prepare-pack.mjs first, which refuses to infer a unit
 *      from magnitude; this importer will not accept an inferred one either.
 *
 *   2. SEMANTIC DEDUP. Four packs now overlap by design — the original library,
 *      the RowErg expansion, the station matrix and the running expansion. A
 *      workout is matched on what it actually prescribes (movements, quantities,
 *      units, rounds), not on its id or name, and a match keeps the existing
 *      richer template rather than adding a near-identical session.
 *
 *   node scripts/import-workouts.mjs data/rower-workouts.json [more-packs...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const packPaths = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (!packPaths.length) throw new Error('usage: import-workouts.mjs <pack.json> [...]');

let sql = readFileSync(SRC, 'utf8');

const q = v =>
  v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? (v ? '1' : '0')
  : `'${String(v).replace(/'/g, "''")}'`;
const row = (table, values) => `INSERT INTO "${table}" VALUES(${values.map(q).join(',')});`;

function splitValues(body) {
  const out = []; let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { cur += ch; if (ch === "'") { if (body[i + 1] === "'") { cur += "'"; i++; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unquote = v => (v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v === 'NULL' ? null : v);

// ── existing content, for name resolution and dedup ────────────────────────
const exerciseIdByName = {};
for (const m of sql.matchAll(/INSERT INTO "exercises" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  exerciseIdByName[v[1].toLowerCase()] = v[0];
}
const templateName = {};
for (const m of sql.matchAll(/INSERT INTO "workout_templates" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  templateName[v[0]] = v[1];
}
const blockOwner = {}, blockMeta = {};
for (const m of sql.matchAll(/INSERT INTO "workout_blocks" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  blockOwner[v[0]] = v[1];
  blockMeta[v[0]] = { order: Number(v[2]), rounds: v[6] == null ? null : Number(v[6]), duration: v[7] == null ? null : Number(v[7]) };
}
const existingItems = {};
for (const m of sql.matchAll(/INSERT INTO "block_exercises" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  const wid = blockOwner[v[1]];
  if (!wid) continue;
  (existingItems[wid] ??= []).push({ block: v[1], exercise_id: v[3], prescription_type: v[4], quantity: Number(v[5]), unit: v[6] });
}

/**
 * What a session actually prescribes, independent of its id, name or wording:
 * per block, the round/duration shape and the sorted movement prescriptions.
 */
function signature(blocks) {
  return blocks.map(b => {
    const items = b.items
      .map(i => `${i.exercise_id}:${i.prescription_type}:${i.quantity}${i.unit}`)
      .sort().join('|');
    return `${b.rounds ?? '-'}r/${b.duration_minutes ?? '-'}m[${items}]`;
  }).join(' >> ');
}

/** Same shape and movements, quantities within 10% — the same session, retuned. */
function looseKey(blocks) {
  return blocks.map(b => {
    const movements = b.items.map(i => `${i.exercise_id}:${i.prescription_type}`).sort().join('|');
    return `${b.rounds ?? '-'}r[${movements}]`;
  }).join(' >> ');
}
const quantitiesOf = blocks => blocks.flatMap(b => b.items.map(i => i.quantity));

/**
 * The block that carries the session's reason for existing — the one with the
 * most prescribed work. Comparing on this catches "an existing session plus a
 * cool-down", which a whole-sequence comparison treats as a different workout:
 * run_1k_repeats_01 is wo_1k_repeat_builder with two easy minutes bolted on.
 */
function dominantSignature(blocks) {
  const weight = b => (b.rounds ?? 1) * b.items.reduce((s, i) => s + Math.abs(i.quantity || 0), 0);
  const top = [...blocks].sort((a, b) => weight(b) - weight(a))[0];
  return top ? signature([top]) : '';
}
const within = (a, b, tol) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= Math.max(1, Math.abs(b[i]) * tol));

const existingByBlocks = {};
for (const [wid, items] of Object.entries(existingItems)) {
  const byBlock = {};
  for (const it of items) (byBlock[it.block] ??= []).push(it);
  const blocks = Object.entries(byBlock)
    .sort((a, b) => blockMeta[a[0]].order - blockMeta[b[0]].order)
    .map(([bid, its]) => ({ rounds: blockMeta[bid].rounds, duration_minutes: blockMeta[bid].duration, items: its }));
  existingByBlocks[wid] = blocks;
}

// ── read packs, enforcing the explicit-unit rule ───────────────────────────
const PRESCRIPTION_TYPES = new Set(['duration', 'distance', 'reps', 'sets_reps', 'calories', 'load']);
const problems = [], skipped = [], toImport = [];
const packIds = new Set();

for (const path of packPaths) {
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  if (pack.meta?.format && pack.meta.format !== 'canonical-v1') {
    problems.push(`${basename(path)}: format ${pack.meta.format}, expected canonical-v1`);
    continue;
  }
  for (const w of pack.workouts) {
    const id = w.id ?? w.workout_id;
    packIds.add(id);
    const blocks = (w.blocks ?? [{ ...w.block, items: w.items }]).map((b, bi) => {
      const items = (b.items ?? []).map((it, ii) => {
        const where = `${id} block ${bi + 1} item ${ii + 1}`;
        if (!it.prescription_type) problems.push(`${where}: missing prescription_type (explicit-unit rule)`);
        else if (!PRESCRIPTION_TYPES.has(it.prescription_type)) problems.push(`${where}: prescription_type "${it.prescription_type}" is not one of ${[...PRESCRIPTION_TYPES].join('/')}`);
        if (!it.unit) problems.push(`${where}: missing unit (explicit-unit rule)`);
        if (it.quantity == null) problems.push(`${where}: missing quantity`);
        const exId = exerciseIdByName[String(it.exercise ?? '').toLowerCase()] ?? it.exercise_id;
        if (!exId) problems.push(`${where}: no exercise named ${JSON.stringify(it.exercise)}`);
        return { exercise_id: exId, prescription_type: it.prescription_type, quantity: it.quantity, unit: it.unit, intensity: it.intensity ?? null };
      });
      if (!items.length) problems.push(`${id} block ${bi + 1}: no items`);
      return { ...b, items };
    });
    if (!w.stimulus) problems.push(`${id}: missing stimulus`);
    if (!w.workout_family) problems.push(`${id}: missing workout_family`);
    if (!w.estimated_minutes) problems.push(`${id}: missing estimated_minutes`);
    toImport.push({ pack: basename(path), meta: pack.meta, w, id, blocks });
  }
}

if (problems.length) {
  console.error('Refusing to import — these violate the pack rules:');
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  process.exit(1);
}

// ── semantic dedup against content that is already in the library ─────────
const seenInThisRun = new Map();
const accepted = [];
for (const entry of toImport) {
  const sig = signature(entry.blocks);
  const loose = looseKey(entry.blocks);
  const qty = quantitiesOf(entry.blocks);

  let match = null, kind = null;
  for (const [wid, blocks] of Object.entries(existingByBlocks)) {
    if (packIds.has(wid)) continue;              // a prior import of this same pack
    if (signature(blocks) === sig) { match = wid; kind = 'identical prescription'; break; }
    if (looseKey(blocks) === loose && within(qty, quantitiesOf(blocks), 0.1)) {
      match = wid; kind = 'same shape, quantities within 10%';
    }
    if (!match && dominantSignature(blocks) === dominantSignature(entry.blocks)) {
      match = wid; kind = 'same main set, differing only in warm-up/cool-down';
    }
  }
  if (!match && seenInThisRun.has(sig)) { match = seenInThisRun.get(sig); kind = 'duplicate within this import'; }

  if (match) {
    skipped.push({ id: entry.id, matched: match, matchedName: templateName[match] ?? match, kind, stimulus: entry.w.stimulus, station: entry.w.station });
    continue;
  }
  seenInThisRun.set(sig, entry.id);
  accepted.push(entry);
}

// ── emit ──────────────────────────────────────────────────────────────────
const emitted = { workout_templates: [], workout_blocks: [], block_exercises: [], workout_variants: [] };
for (const { meta, w, id, blocks } of accepted) {
  const allItems = blocks.flatMap(b => b.items);
  emitted.workout_templates.push(row('workout_templates', [
    id, w.name, w.workout_family, w.stimulus /* primary_goal; re-derived by apply-taxonomy */,
    w.stimulus, w.secondary_goal ?? null, w.estimated_minutes, w.intensity_target,
    w.impact_level, w.hyrox_specificity, true,
    allItems.some(i => i.exercise_id === 'ex_run'),
    allItems.some(i => i.exercise_id === 'ex_skierg'),
    w.description ?? meta.default_description ?? `${meta.pack ?? 'Imported'} workout.`,
    w.coaching_notes ?? meta.default_coaching_notes ?? null,
  ]));

  blocks.forEach((b, bi) => {
    const blockId = `${id}_b${bi + 1}`;
    emitted.workout_blocks.push(row('workout_blocks', [
      blockId, id, bi + 1, b.block_type, b.title ?? 'Main', b.instructions ?? null,
      b.rounds ?? null, b.duration_minutes ?? null, b.rest_seconds ?? null,
    ]));
    b.items.forEach((it, ii) => {
      emitted.block_exercises.push(row('block_exercises', [
        `${blockId}_e${ii + 1}`, blockId, ii + 1, it.exercise_id,
        it.prescription_type, it.quantity, it.unit, it.intensity, null,
      ]));
    });
  });

  // Green carries the session's own length rather than a flat budget: a 30
  // minute workout claiming 45 is filtered out of a 40 minute slot.
  for (const [code, minutes, state, mult, modifier] of [
    ['green', w.estimated_minutes, 'good', 1.0, 'full prescription'],
    ['yellow', Math.max(10, Math.round(w.estimated_minutes * 0.65)), 'okay', 0.65, meta.express_rule ?? 'preserve the primary stimulus; reduce accessory volume first'],
    ['red', Math.max(8, Math.round(w.estimated_minutes * 0.3)), 'poor', 0.3, meta.micro_rule ?? 'minimum effective dose; no intensity compensation'],
  ]) {
    emitted.workout_variants.push(row('workout_variants', [
      `${id}_${code}`, id, code, minutes, state, mult, modifier, meta.pack ?? meta.name ?? null,
    ]));
  }
}

/**
 * Drop any prior import of this pack so re-running replaces rather than
 * duplicates — and, crucially, so a workout REMOVED from a pack is removed from
 * the library too. Matching only on the ids currently in the pack would leave
 * anything dropped from it orphaned in the dump forever, which is how a stale
 * lossy parse survived a re-run. Provenance is the pack label already written
 * to workout_variants.notes.
 */
const packLabels = new Set(packPaths.map(p => {
  const meta = JSON.parse(readFileSync(p, 'utf8')).meta ?? {};
  return meta.pack ?? meta.name ?? null;
}).filter(Boolean));

for (const m of sql.matchAll(/INSERT INTO "workout_variants" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  if (packLabels.has(v[7])) packIds.add(v[1]);
}

const ids = [...packIds];
sql = sql.split('\n').filter(line => {
  const m = line.match(/^INSERT INTO "(workout_templates|workout_blocks|block_exercises|workout_variants)" VALUES\('([^']+)'/);
  if (!m) return true;
  return !ids.some(w => m[2] === w || m[2].startsWith(`${w}_`));
}).join('\n');

for (const [table, rows] of Object.entries(emitted)) {
  if (!rows.length) continue;
  const lines = sql.split('\n');
  let last = -1;
  lines.forEach((l, i) => { if (l.startsWith(`INSERT INTO "${table}" VALUES(`)) last = i; });
  if (last === -1) throw new Error(`no existing rows for ${table} to append after`);
  lines.splice(last + 1, 0, ...rows);
  sql = lines.join('\n');
  console.log(`${table.padEnd(20)} +${rows.length}`);
}
writeFileSync(SRC, sql);

console.log(`\nimported ${accepted.length} of ${toImport.length} workouts`);
if (skipped.length) {
  console.log(`\nskipped ${skipped.length} as semantically duplicate — kept the existing template:`);
  for (const s of skipped) {
    console.log(`  ${s.id.padEnd(34)} -> ${s.matched.padEnd(32)} ${s.kind}`);
  }
}
console.log('\nNow run: node scripts/apply-taxonomy.mjs && node scripts/convert-seed.mjs && node scripts/build-fixtures.mjs');
