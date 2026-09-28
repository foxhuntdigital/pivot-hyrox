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
import { resolveGoal, PLANNER_GOALS } from './lib/stimulus-taxonomy.mjs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const packPaths = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (!packPaths.length) throw new Error('usage: import-workouts.mjs <pack.json> [...]');

let sql = readFileSync(SRC, 'utf8');

const q = v =>
  v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? (v ? '1' : '0')
  : `'${String(v).replace(/'/g, "''")}'`;
const row = (table, values) => {
  // Rows are written positionally, so a migration that widens a table silently
  // turns every emitted row into a short one. 0011 added seven columns to
  // block_exercises and 0013 two to workout_templates while this still wrote
  // the old nine and fifteen — a file SQLite refuses to load, long after the
  // import has reported success. Arity is checked against the schema in the
  // file actually being written, so a widened table stops the import.
  if (arity[table] && values.length !== arity[table]) {
    throw new Error(`${table}: emitting ${values.length} values into ${arity[table]} `
      + 'columns — the dump\'s schema has moved and this importer has not');
  }
  return `INSERT INTO "${table}" VALUES(${values.map(q).join(',')});`;
};

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

/**
 * Columns per table.
 *
 * Split at paren depth zero, so `UNIQUE(workout_id,variant_code)` is one item
 * rather than two — and then dropped, because a table constraint is not a
 * column and counting it would demand a ninth value for workout_variants that
 * has nowhere to go.
 */
const TABLE_CONSTRAINT = /^(UNIQUE|PRIMARY|FOREIGN|CHECK|CONSTRAINT)\b/i;
const columnCount = (body) => {
  const items = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; continue; }
    cur += ch;
  }
  items.push(cur);
  return items.filter(i => !TABLE_CONSTRAINT.test(i.trim())).length;
};
/**
 * Columns a pack may declare that the dump does not have yet.
 *
 * Migration 0013 added the supplemental model to Postgres; the dump is the
 * authoring source and needs the same three columns before a pack can say a
 * workout is supplemental. Added here rather than in a script of their own
 * because the importer is what reads them off a pack — the column and the
 * thing that writes it stay together.
 */
const TEMPLATE_COLUMNS = [
  ['workout_role', 'TEXT'], ['supplemental_type', 'TEXT'], ['supplemental_load', 'TEXT'],
];
{
  const re = /CREATE TABLE workout_templates\(([^)]*)\);/;
  const m = sql.match(re);
  if (!m) throw new Error('workout_templates CREATE TABLE not found in the dump');
  const missing = TEMPLATE_COLUMNS.filter(([n]) => !new RegExp(`\\b${n}\\b`).test(m[1]));
  if (missing.length && missing.length !== TEMPLATE_COLUMNS.length) {
    throw new Error(`dump is half-migrated: missing ${missing.map(c => c[0]).join(', ')}`);
  }
  if (missing.length) {
    sql = sql.replace(re, `CREATE TABLE workout_templates(${m[1]},`
      + missing.map(([n, t]) => `${n} ${t}`).join(',') + ');');
    // Every existing row is a primary with no supplemental fields, which is
    // exactly what 0013's default and its completeness constraint say.
    sql = sql.replace(/INSERT INTO "workout_templates" VALUES\(([\s\S]*?)\);/g,
      (whole, body) => `INSERT INTO "workout_templates" VALUES(${body},'primary',NULL,NULL);`);
    console.log('added workout_role + supplemental_type + supplemental_load to workout_templates\n');
  }
}

const arity = {};
for (const m of sql.matchAll(/CREATE TABLE (\w+)\(([\s\S]*?)\);/g)) {
  arity[m[1]] = columnCount(m[2]);
}

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
  blockMeta[v[0]] = {
    order: Number(v[2]),
    rounds: v[6] == null ? null : Number(v[6]),
    duration: v[7] == null ? null : Number(v[7]),
    instructions: v[5] ?? null,
  };
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

/**
 * Block instructions are part of the prescription, not decoration.
 *
 * For most content the movements and quantities say what a session is, and the
 * instruction repeats it. For skill content they are the whole prescription:
 * every round of the boxing pack is `ex_shadowboxing, 90s, RPE 4`, and what
 * separates "Jab + Movement" from "Footwork Flow" is the combination written in
 * the instruction. Without this, semantic dedup collapsed six of fourteen
 * deliberately distinct sessions into one another — correct by its own rule and
 * wrong in fact.
 *
 * Normalised the same way effort is, so whitespace and punctuation edits do not
 * make two identical sessions look different.
 */
const instruction = text => String(text ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function signature(blocks) {
  return blocks.map(b => {
    const items = b.items
      .map(i => `${i.exercise_id}:${i.prescription_type}:${i.quantity}${i.unit}@${effort(i.intensity ?? i.intensity_note)}`)
      .sort().join('|');
    return `${b.rounds ?? '-'}r/${b.duration_minutes ?? '-'}m/${b.rest_seconds ?? '-'}s`
      + `"${instruction(b.instructions)}"[${items}]`;
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
    .map(([bid, its]) => ({
      rounds: blockMeta[bid].rounds,
      duration_minutes: blockMeta[bid].duration,
      instructions: blockMeta[bid].instructions,
      items: its,
    }));
  existingByBlocks[wid] = blocks;
}

// ── read packs, enforcing the explicit-unit rule ───────────────────────────
const PRESCRIPTION_TYPES = new Set(['duration', 'distance', 'reps', 'sets_reps', 'calories', 'load']);
/** The supplemental vocabulary, from migration 0013's own check constraints. */
const SUPPLEMENTAL_TYPES = ['core', 'muscular_endurance', 'metcon', 'accessory_strength',
  'resilience', 'recovery', 'boxing'];
const SUPPLEMENTAL_LOADS = ['minimal', 'low', 'moderate'];

/**
 * Rest that is recovery between working sets rather than a density clock.
 *
 * The same bounds apply-prescriptions.mjs enforces, for the same reason: rest
 * is what separates a strength session from a circuit, so an eight-second
 * "rest" would quietly reclassify a squat session into the thing migration
 * 0011 exists to keep out of the strength count, and a thirty-minute one is a
 * transcription slip that would sit in the library unnoticed.
 */
const REST_BOUNDS = [30, 600];

/**
 * Numbers that arrived as strings.
 *
 * A pack that writes `"rest_seconds": "120"` means 120, and rejecting the
 * template over a pair of quote marks helps nobody. But a parser that quietly
 * accepts anything numeric-looking is how "2 min" becomes 2 seconds, so the
 * canonicalisation is narrow — a string that is exactly a number, nothing else —
 * and every one is REPORTED, so the pack can be corrected rather than depending
 * on permissive parsing for ever.
 */
const coercions = [];
function canonicalNumber(value, field, where, problems) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value.trim());
    coercions.push(`${where}: ${field} ${JSON.stringify(value)} -> ${n}`);
    return n;
  }
  problems.push(`${where}: ${field} ${JSON.stringify(value)} is not a number`);
  return null;
}
const LOAD_BASES = new Set(['absolute', 'percent_1rm', 'rpe', 'bodyweight']);

/**
 * The structured prescription 0011 added, read from a pack item.
 *
 * Before 0011 a set scheme was stored by overloading the two columns every
 * prescription had: four sets of six was `quantity 4, unit 'x6'`. That shape
 * cannot hold rest, a rep range or a target RPE, and it rendered in the player
 * as "4 x6". A pack may no longer author strength that way — a sets_reps item
 * must say `sets` and `reps_min` in the fields that can hold them, which is
 * the one rule that stops new content landing in the shape 0011 replaced.
 *
 * Every other field is optional and validated only if present, because a pack
 * that has not yet had a coaching pass on rest is a normal state to be in:
 * `rest_seconds` NULL keeps the session out of the true-strength coverage
 * gate, which is the honest reading of a prescription that does not yet say
 * how long to rest.
 */
function structuredPrescription(it, where, problems) {
  if (it.prescription_type === 'sets_reps'
      && (it.sets === null || it.sets === undefined || it.reps_min === null || it.reps_min === undefined)) {
    problems.push(`${where}: a sets_reps item must carry sets and reps_min — `
      + 'encoding the reps in the unit string (4, "x6") is the pre-0011 shape');
    return null;
  }

  const sets = canonicalNumber(it.sets, 'sets', where, problems);
  const reps_min = canonicalNumber(it.reps_min, 'reps_min', where, problems);
  const reps_max = canonicalNumber(it.reps_max, 'reps_max', where, problems) ?? reps_min;
  const rest = canonicalNumber(it.rest_seconds, 'rest_seconds', where, problems);
  const rpe = canonicalNumber(it.target_rpe, 'target_rpe', where, problems);
  const basis = it.load_basis ?? null;

  if (sets != null && !(Number.isInteger(sets) && sets > 0)) {
    problems.push(`${where}: sets must be a positive whole number, got ${JSON.stringify(it.sets)}`);
  }
  if (reps_min != null && reps_max != null && reps_max < reps_min) {
    problems.push(`${where}: reps_max ${reps_max} is below reps_min ${reps_min}`);
  }
  if (rest != null) {
    if (!Number.isInteger(rest)) {
      problems.push(`${where}: rest_seconds ${JSON.stringify(rest)} is not a whole number of seconds`);
    } else if (rest < REST_BOUNDS[0] || rest > REST_BOUNDS[1]) {
      problems.push(`${where}: rest_seconds ${rest} is outside ${REST_BOUNDS[0]}-${REST_BOUNDS[1]}s — `
        + 'that is a density clock or a transcription slip, not rest between working sets');
    }
  }
  if (rpe != null && !(rpe >= 1 && rpe <= 10)) {
    problems.push(`${where}: target_rpe ${rpe} is outside 1-10`);
  }
  if (basis != null && !LOAD_BASES.has(basis)) {
    problems.push(`${where}: load_basis "${basis}" is not one of ${[...LOAD_BASES].join('/')}`);
  }
  if (sets == null && rest != null) {
    problems.push(`${where}: rest_seconds without sets — rest between what?`);
  }

  return { sets, reps_min, reps_max, rest_seconds: rest, target_rpe: rpe,
    load_basis: basis,
    load_value: canonicalNumber(it.load_value, 'load_value', where, problems) };
}

/**
 * The `quantity`/`quantity_unit` pair, which the player still renders and the
 * dedup signature still compares.
 *
 * For a sets_reps item it is DERIVED from the structured fields rather than
 * authored, so the two can never drift apart — and a pack that states both is
 * checked rather than trusted, because a disagreement between "4 x6" and
 * `sets 4, reps_min 8` is exactly the kind of edit that reaches an athlete.
 * Every other prescription type keeps what it authored: a 30m carry for three
 * sets is thirty metres, not three of them.
 */
function displayPair(it, structured, where, problems) {
  if (it.prescription_type !== 'sets_reps' || structured?.sets == null) {
    return { quantity: it.quantity, unit: it.unit };
  }
  const { sets, reps_min, reps_max } = structured;
  const reps = reps_max != null && reps_max !== reps_min ? `${reps_min}-${reps_max}` : `${reps_min}`;
  // `per_side: true` reads as a leg movement because that is what the seed's
  // existing per-side rows are; a string says which side-word to use, so a
  // row that is per-arm does not render as "/leg".
  const side = it.per_side === true ? 'leg' : it.per_side || null;
  const unit = `x${reps}${side ? `/${side}` : ''}`;
  if (it.quantity != null && it.quantity !== sets) {
    problems.push(`${where}: quantity ${it.quantity} disagrees with sets ${sets}`);
  }
  if (it.unit != null && it.unit !== unit) {
    problems.push(`${where}: unit "${it.unit}" disagrees with the authored reps ("${unit}")`);
  }
  return { quantity: sets, unit };
}
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
        const structured = structuredPrescription(it, where, problems);
        const shown = displayPair(it, structured, where, problems);
        // The explicit-unit rule, restated for the shape 0011 introduced: a
        // sets_reps item states its quantity as sets and reps, and the pair
        // above is derived from them. Demanding a unit string as well would be
        // asking for the encoding this release exists to remove.
        if (!shown.unit) problems.push(`${where}: missing unit (explicit-unit rule)`);
        if (shown.quantity == null) problems.push(`${where}: missing quantity`);
        shown.quantity = canonicalNumber(shown.quantity, 'quantity', where, problems);
        const exId = exerciseIdByName[String(it.exercise ?? '').toLowerCase()] ?? it.exercise_id;
        if (!exId) problems.push(`${where}: no exercise named ${JSON.stringify(it.exercise)}`);
        return { exercise_id: exId, prescription_type: it.prescription_type,
          quantity: shown.quantity, unit: shown.unit, intensity: it.intensity ?? null,
          side_note: it.side_note ?? null, ...(structured ?? {}) };
      });
      if (!items.length) problems.push(`${id} block ${bi + 1}: no items`);
      return { ...b, items };
    });
    // Without a stated intensity the engine cannot tell hard work from easy:
    // intensityCost() falls back to 0.5, so an RPE 7 session reads as moderate
    // and the recovery guardrail hands it to a depleted athlete. A missing
    // intensity is therefore a refusal, not a default.
    const role = w.workout_role ?? 'primary';

    /**
     * The planner goal has to be one of the five, or the template is content
     * nothing will ever schedule.
     *
     * `matchesStimulus` compares a template's `primary_goal` against the goal
     * the week is asking for, and the week only ever asks for the five in
     * PLANNER_GOALS. This used to fall back to the raw stimulus when the
     * taxonomy had no roll-up for it, so a pack naming its stimulus
     * `bilateral_squat_strength` imported cleanly, classified correctly, passed
     * the coverage gate, and was then invisible to the planner for ever. Thirty
     * templates arrived that way in one pack.
     *
     * There is no fallback now. The detailed stimulus stays exactly where it
     * was — `stimulus` is orthogonal metadata and keeps every distinction the
     * author drew — and the roll-up is a ruling in
     * scripts/lib/stimulus-taxonomy.mjs that a human makes once.
     */
    const plannerGoal = resolveGoal(w.stimulus, {
      modalities: blocks.flatMap(b => b.items.map(i => modalityOf[i.exercise_id])).filter(Boolean),
      exercises: blocks.flatMap(b => b.items.map(i => i.exercise_id)),
      family: w.workout_family,
      category: w.category ?? w.workout_family,
      intensityTarget: w.intensity_target,
    })?.primary_goal ?? null;
    /**
     * Supplementals are exempt, and are not put through `resolveGoal` at all.
     *
     * The invariant is that every PLANNER-SELECTABLE template resolves to one
     * of the five. A supplemental is not selectable — `loadContent` keeps it
     * out of the candidate pool — so making it claim a goal would be writing a
     * value only to satisfy a constraint, which is the silent fallback this
     * validator exists to remove. It carries NULL, which migration 0018 permits
     * for supplementals and still refuses for everything else.
     */
    if (role !== 'supplemental' && !PLANNER_GOALS.includes(plannerGoal)) {
      problems.push(`${id}: stimulus "${w.stimulus}" does not roll up to a planner goal `
        + `(${PLANNER_GOALS.join('/')}). Add the roll-up to scripts/lib/stimulus-taxonomy.mjs — `
        + 'without one the stimulus would become the template\'s primary_goal, which no '
        + 'planner goal matches, and the session would never be scheduled.');
    }
    /**
     * The supplemental model, as 0013 constrains it.
     *
     * A supplemental needs a type and a load; a primary must carry neither.
     * The constraint exists in Postgres and is restated here so a pack fails
     * while its author is looking, rather than on a migration months later.
     */
    if (!['primary', 'supplemental'].includes(role)) {
      problems.push(`${id}: workout_role "${role}" is not primary or supplemental`);
    } else if (role === 'supplemental') {
      if (!SUPPLEMENTAL_TYPES.includes(w.supplemental_type)) {
        problems.push(`${id}: supplemental_type ${JSON.stringify(w.supplemental_type)} is not one of `
          + SUPPLEMENTAL_TYPES.join('/'));
      }
      if (!SUPPLEMENTAL_LOADS.includes(w.supplemental_load)) {
        problems.push(`${id}: supplemental_load ${JSON.stringify(w.supplemental_load)} is not one of `
          + SUPPLEMENTAL_LOADS.join('/') + ' — supplemental work that could compromise tomorrow '
          + 'is not supplemental, so there is no "high"');
      }
    } else if (w.supplemental_type != null || w.supplemental_load != null) {
      problems.push(`${id}: a primary workout must not carry supplemental_type or supplemental_load`);
    }
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
  // Already validated as one of the five on the way in; recomputed rather than
  // threaded through so the two can never say different things. A supplemental
  // is never resolved at all — see the validator above.
  const isSupplemental = (w.workout_role ?? 'primary') === 'supplemental';
  const derivedGoal = isSupplemental ? null : goalOf(w.stimulus, allItems.map(i => i.exercise_id), {
    family: w.workout_family, category: w.category ?? w.workout_family, intensityTarget: w.intensity_target,
  });
  if (!isSupplemental && !PLANNER_GOALS.includes(derivedGoal)) {
    throw new Error(`${id}: planner goal resolved to ${JSON.stringify(derivedGoal)} at emit time `
      + 'but passed validation — the two resolutions disagree');
  }
  emitted.workout_templates.push(row('workout_templates', [
    id, w.name, w.workout_family, derivedGoal,
    w.stimulus, w.secondary_goal ?? null, w.estimated_minutes, w.intensity_target,
    w.impact_level, w.hyrox_specificity, true,
    allItems.some(i => i.exercise_id === 'ex_run'),
    allItems.some(i => i.exercise_id === 'ex_skierg'),
    w.description ?? meta.default_description ?? `${meta.pack ?? 'Imported'} workout.`,
    w.coaching_notes ?? meta.default_coaching_notes ?? null,
    // training_domain and session_type are left for apply-classification.mjs,
    // which reads them off the session's structure rather than its label. An
    // importer that set them here would let a pack assert the strength domain
    // by writing the word, which is what deciding it structurally prevents.
    null, null,
    // Newly imported content is schedulable and supersedes nothing. Retirement
    // is a separate, explicit ruling (scripts/retire-templates.mjs) — a pack
    // must not be able to retire a template by omitting it, or re-importing an
    // edited pack would silently retire whatever the edit dropped.
    'content_eligible', null,
    w.workout_role ?? 'primary', w.supplemental_type ?? null, w.supplemental_load ?? null,
    // technical_demand + load_demand (migration 0023). Newly imported content is
    // ungraded: null reads as "do not constrain" everywhere, so the template is
    // scheduled exactly as it was before grading existed and is picked up by the
    // next grading pass — rather than by a number this importer invented.
    null, null,
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
        it.prescription_type, it.quantity, it.unit, it.intensity, it.side_note,
        it.sets ?? null, it.reps_min ?? null, it.reps_max ?? null,
        it.rest_seconds ?? null, it.target_rpe ?? null,
        it.load_basis ?? null, it.load_value ?? null,
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
if (coercions.length) {
  console.log(`\n${coercions.length} value(s) canonicalised from strings — correct them at source:`);
  for (const c of coercions) console.log(`  ${c}`);
}
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
console.log('\nNow run: node scripts/apply-taxonomy.mjs && node scripts/apply-classification.mjs'
  + ' && node scripts/convert-seed.mjs && node scripts/build-fixtures.mjs');
