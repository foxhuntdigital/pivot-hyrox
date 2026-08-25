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
import { resolveGoal } from './lib/stimulus-taxonomy.mjs';

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
 * What a session actually prescribes, independent of its id, name or wording.
 *
 * Intensity and rest are part of it, not decoration: "8 x 40m @ 110-130%" is a
 * strength-power carry and "8 x 40m @ 50-60%" is a technique drill. They share
 * a rep scheme and nothing else, and a signature that ignored the load called
 * them the same workout.
 */
const effort = note => String(note ?? '')
  .toLowerCase().replace(/[^a-z0-9%.-]+/g, ' ').trim();

function signature(blocks) {
  return blocks.map(b => {
    const items = b.items
      .map(i => `${i.exercise_id}:${i.prescription_type}:${i.quantity}${i.unit}@${effort(i.intensity ?? i.intensity_note)}`)
      .sort().join('|');
    return `${b.rounds ?? '-'}r/${b.duration_minutes ?? '-'}m/${b.rest_seconds ?? '-'}s[${items}]`;
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

/**
 * The planner goal a template serves. Two sessions can only be duplicates if
 * they train the same thing — which is what stops a Durability row from
 * swallowing a Race-Pace one that happens to share 5 x 1000m. Comparing the
 * rolled-up goal rather than the raw stimulus lets packs that say
 * `aerobic_local_durability` and `aerobic_base` still recognise each other.
 */
const goalOf = (stimulus, exercises, ctx = {}) => resolveGoal(stimulus, {
  modalities: exercises.map(e => modalityOf[e]).filter(Boolean),
  exercises, ...ctx,
})?.primary_goal ?? null;

const modalityOf = {};
for (const m of sql.matchAll(/INSERT INTO "exercises" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  modalityOf[v[0]] = v[4];
}
const stimulusOf = {}, ctxOf = {};
for (const m of sql.matchAll(/INSERT INTO "workout_templates" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  stimulusOf[v[0]] = v[4];
  ctxOf[v[0]] = { family: v[2], category: v[2], intensityTarget: v[7] };
}

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
const fatal = [], skipped = [], toImport = [], rejected = [], conflicts = [];
const packIds = new Set();

for (const path of packPaths) {
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  if (pack.meta?.format && pack.meta.format !== 'canonical-v1') {
    fatal.push(`${basename(path)}: format ${pack.meta.format}, expected canonical-v1`);
    continue;
  }
  for (const w of pack.workouts) {
    const id = w.id ?? w.workout_id;
    packIds.add(id);
    const problems = [];
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
    // Without a stated intensity the engine cannot tell hard work from easy:
    // intensityCost() falls back to 0.5, so an RPE 7 session reads as moderate
    // and the recovery guardrail hands it to a depleted athlete. A missing
    // intensity is therefore a refusal, not a default.
    if (!w.intensity_target) problems.push(`${id}: missing intensity_target — intensityCost() would default it to moderate`);
    if (!w.stimulus) problems.push(`${id}: missing stimulus`);
    if (!w.workout_family) problems.push(`${id}: missing workout_family`);
    if (!w.estimated_minutes) problems.push(`${id}: missing estimated_minutes`);
    if (problems.length) { rejected.push({ id, reasons: [...new Set(problems)] }); continue; }
    toImport.push({ pack: basename(path), meta: pack.meta, w, id, blocks });
  }
}

/**
 * A later pack supersedes an earlier one for the same id, so a follow-up round
 * that fills in a missing field replaces the row that was missing it rather
 * than being weighed against it.
 */
{
  const latest = new Map();
  for (const e of toImport) latest.set(e.id, { kind: 'ok', e });
  for (const r of rejected) if (!latest.has(r.id) || latest.get(r.id).kind === 'bad') latest.set(r.id, { kind: 'bad', r });
  for (const e of toImport) latest.set(e.id, { kind: 'ok', e });   // ok always wins over an earlier rejection
  toImport.length = 0; rejected.length = 0;
  for (const v of latest.values()) (v.kind === 'ok' ? toImport : rejected).push(v.kind === 'ok' ? v.e : v.r);
}

if (fatal.length) {
  console.error('Refusing to import — pack-level problems:');
  for (const p of fatal) console.error(`  ${p}`);
  process.exit(1);
}

// ── semantic dedup against content that is already in the library ─────────
const seenInThisRun = new Map();
const accepted = [];
for (const entry of toImport) {
  const sig = signature(entry.blocks);
  const loose = looseKey(entry.blocks);
  const qty = quantitiesOf(entry.blocks);

  const entryCtx = { family: entry.w.workout_family, category: entry.w.category ?? entry.w.workout_family, intensityTarget: entry.w.intensity_target };
  const entryGoal = goalOf(entry.w.stimulus, entry.blocks.flatMap(b => b.items.map(i => i.exercise_id)), entryCtx);

  let match = null, kind = null;
  for (const [wid, blocks] of Object.entries(existingByBlocks)) {
    if (packIds.has(wid)) continue;              // a prior import of this same pack
    // Only sessions training the same thing can be the same session.
    if (goalOf(stimulusOf[wid], blocks.flatMap(b => b.items.map(i => i.exercise_id)), ctxOf[wid]) !== entryGoal) {
      // Same prescription, different goal, is a semantic conflict rather than
      // two workouts: one of the two labels is wrong. Importing it as a
      // separate template would be picking an answer silently, so hold it.
      if (signature(blocks) === sig) {
        conflicts.push({ id: entry.id, existing: wid, existingGoal: goalOf(stimulusOf[wid], blocks.flatMap(b => b.items.map(i => i.exercise_id)), ctxOf[wid]),
          incomingGoal: entryGoal, incomingStimulus: entry.w.stimulus, existingStimulus: stimulusOf[wid] });
        match = '__conflict__';
      }
      continue;
    }
    if (signature(blocks) === sig) { match = wid; kind = 'identical prescription'; break; }
    if (looseKey(blocks) === loose && within(qty, quantitiesOf(blocks), 0.1)) {
      match = wid; kind = 'same shape, quantities within 10%';
    }
    if (!match && dominantSignature(blocks) === dominantSignature(entry.blocks)) {
      match = wid; kind = 'same main set, differing only in warm-up/cool-down';
    }
  }
  if (!match && seenInThisRun.has(sig)) {
    const prior = seenInThisRun.get(sig);
    if (prior.goal === entryGoal) { match = prior.id; kind = 'duplicate within this import'; }
  }

  if (match === '__conflict__') continue;   // held; reported below
  if (match) {
    skipped.push({ id: entry.id, matched: match, matchedName: templateName[match] ?? match, kind, stimulus: entry.w.stimulus, station: entry.w.station });
    continue;
  }
  seenInThisRun.set(sig, { id: entry.id, goal: entryGoal });
  accepted.push(entry);
}

// ── emit ──────────────────────────────────────────────────────────────────
const emitted = { workout_templates: [], workout_blocks: [], block_exercises: [], workout_variants: [] };
for (const { meta, w, id, blocks } of accepted) {
  const allItems = blocks.flatMap(b => b.items);
  // A new template derives its planner goal from its stimulus at import time.
  // apply-taxonomy will not re-derive it afterwards — once set it is canonical.
  const derivedGoal = goalOf(w.stimulus, allItems.map(i => i.exercise_id), {
    family: w.workout_family, category: w.category ?? w.workout_family, intensityTarget: w.intensity_target,
  }) ?? w.stimulus;
  emitted.workout_templates.push(row('workout_templates', [
    id, w.name, w.workout_family, derivedGoal,
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

console.log(`\nimported ${accepted.length} of ${toImport.length + rejected.length} workouts`);
if (rejected.length) {
  const byReason = {};
  for (const r of rejected) for (const reason of r.reasons) {
    (byReason[reason.replace(/^[^:]+: /, '').replace(/"[^"]*"/g, 'X')] ??= []).push(r.id);
  }
  console.log(`\nheld ${rejected.length} that break a pack rule:`);
  for (const [reason, ids] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(ids.length).padStart(3)}  ${reason}`);
  }
  writeFileSync(new URL('../data/review/import-rejected.json', import.meta.url),
    JSON.stringify({ meta: { rejected: rejected.length }, rejected }, null, 1));
}
if (conflicts.length) {
  console.log(`\n${conflicts.length} SEMANTIC CONFLICT(S) held for review — same prescription, different goal:`);
  for (const c of conflicts) {
    console.log(`  ${c.id.padEnd(32)} ${c.incomingStimulus} (${c.incomingGoal})`);
    console.log(`  ${''.padEnd(32)} vs ${c.existing} ${c.existingStimulus} (${c.existingGoal})`);
  }
  writeFileSync(new URL('../data/review/import-conflicts.json', import.meta.url),
    JSON.stringify({ meta: { conflicts: conflicts.length }, conflicts }, null, 1));
}
if (skipped.length) {
  console.log(`\nskipped ${skipped.length} as semantically duplicate — kept the existing template:`);
  for (const s of skipped) {
    console.log(`  ${s.id.padEnd(34)} -> ${s.matched.padEnd(32)} ${s.kind}`);
  }
}
console.log('\nNow run: node scripts/apply-taxonomy.mjs && node scripts/convert-seed.mjs && node scripts/build-fixtures.mjs');
