/**
 * Keeps the two-level taxonomy in sync in the seed dump.
 *
 * `stimulus` holds the authored training stimulus; `primary_goal` holds the
 * planner-facing goal it rolls up to (see scripts/lib/stimulus-taxonomy.mjs).
 *
 * An EXISTING canonical primary_goal wins. Once a template carries one of the
 * five planner goals it is frozen: this script will fill a missing goal and
 * report a stimulus that now rolls up somewhere else, but it will not rewrite
 * one. Deriving unconditionally would mean a taxonomy edit silently re-pointed
 * live templates and changed what athletes are scheduled — enrichment must not
 * destabilise planner behaviour.
 *
 * A genuine conflict — the stored goal says strength, the stimulus now says
 * threshold — is reported for review rather than resolved either way.
 *
 * `--reconcile` is how a deliberate ruling lands: it re-derives exactly the
 * conflicting templates and prints each change. Without it a corrected roll-up
 * would have no way to reach content that was imported under the old one, and
 * with it the correction is explicit rather than a side effect of a re-run.
 *
 * First run adds the column, seeding stimulus from whatever primary_goal each
 * template already carried — that authored value is the richer one and is what
 * we want to keep.
 *
 *   node scripts/apply-taxonomy.mjs [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveGoal, PLANNER_GOALS } from './lib/stimulus-taxonomy.mjs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const quiet = process.argv.includes('--quiet');
const reconcile = process.argv.includes('--reconcile');

let sql = readFileSync(SRC, 'utf8');

/** Split a VALUES(...) tuple into raw SQL literals, respecting '' escapes. */
function splitValues(body) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") { cur += "'"; i++; }
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const unquote = v => (v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v === 'NULL' ? null : v);
const quote = v => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

function columnsOf(table) {
  const m = sql.match(new RegExp(`CREATE TABLE ${table}\\(([\\s\\S]*?)\\);`));
  if (!m) throw new Error(`no CREATE TABLE for ${table}`);
  const cols = [];
  let depth = 0, cur = '';
  for (const ch of m[1]) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { cols.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) cols.push(cur.trim());
  return cols.filter(c => !/^(PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(c)).map(c => c.split(/\s+/)[0]);
}

/** modality per exercise, and the exercises each template's blocks use. */
const modalityOf = {};
for (const m of sql.matchAll(/INSERT INTO "exercises" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  modalityOf[v[0]] = v[4];
}
const blockOwner = {};
for (const m of sql.matchAll(/INSERT INTO "workout_blocks" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  blockOwner[v[0]] = v[1];
}
const modalitiesByWorkout = {};
const exercisesByWorkout = {};
for (const m of sql.matchAll(/INSERT INTO "block_exercises" VALUES\(([\s\S]*?)\);/g)) {
  const v = splitValues(m[1]).map(unquote);
  const wid = blockOwner[v[1]];
  if (!wid) continue;
  (modalitiesByWorkout[wid] ??= new Set()).add(modalityOf[v[3]]);
  (exercisesByWorkout[wid] ??= new Set()).add(v[3]);
}

// ── add the column on first run ────────────────────────────────────────────
let cols = columnsOf('workout_templates');
const fresh = !cols.includes('stimulus');
if (fresh) {
  sql = sql.replace(
    /(CREATE TABLE workout_templates\([^)]*?primary_goal TEXT)(,)/,
    '$1,stimulus TEXT$2',
  );
  cols = columnsOf('workout_templates');
  if (!cols.includes('stimulus')) throw new Error('failed to add stimulus column');
}
const iGoal = cols.indexOf('primary_goal');
const iStim = cols.indexOf('stimulus');
const iFamily = cols.indexOf('workout_family');
const iIntensity = cols.indexOf('intensity_target');

// ── rewrite every template row ────────────────────────────────────────────
const report = [];
const unmapped = [];
const conflicts = [];
sql = sql.replace(/INSERT INTO "workout_templates" VALUES\(([\s\S]*?)\);/g, (whole, body) => {
  const v = splitValues(body);
  // On the first run the authored value still lives in primary_goal.
  if (fresh) v.splice(iStim, 0, v[iGoal]);
  const stimulus = unquote(v[iStim]);
  const id = unquote(v[0]);
  const resolved = resolveGoal(stimulus, {
    modalities: [...(modalitiesByWorkout[id] ?? [])].filter(Boolean),
    exercises: [...(exercisesByWorkout[id] ?? [])],
    intensityTarget: unquote(v[iIntensity]),
    family: unquote(v[iFamily]),
    category: unquote(v[iFamily]),
  });
  if (!resolved) { unmapped.push(`${id} (${stimulus})`); return whole; }

  const before = unquote(v[iGoal]);
  const canonical = PLANNER_GOALS.includes(before);
  // Fill a missing goal; never overwrite one that is already canonical.
  const conflicted = canonical && before !== resolved.primary_goal;
  const goal = conflicted && !reconcile ? before : canonical && !conflicted ? before : resolved.primary_goal;
  if (conflicted) {
    conflicts.push({ id, stimulus, stored: before, derives: resolved.primary_goal, basis: resolved.basis, applied: reconcile });
  }
  v[iGoal] = quote(goal);
  v[iStim] = quote(stimulus);
  report.push({ id, stimulus, goal, changed: before !== goal, frozen: canonical, ...resolved, primary_goal: goal });
  return `INSERT INTO "workout_templates" VALUES(${v.join(',')});`;
});

if (unmapped.length) {
  console.error('Refusing to write — stimuli with no taxonomy entry:');
  for (const u of unmapped) console.error(`  ${u}`);
  process.exit(1);
}

writeFileSync(SRC, sql);

if (!quiet) {
  const byGoal = {};
  for (const r of report) (byGoal[r.goal] ??= []).push(r);
  console.log(`${report.length} templates carry a stimulus; primary_goal derived from it\n`);
  for (const g of Object.keys(byGoal).sort()) {
    const rs = byGoal[g];
    console.log(`  ${g.padEnd(20)} ${String(rs.length).padStart(3)}  ${[...new Set(rs.map(r => r.stimulus))].sort().join(', ')}`);
  }
  const ctx = report.filter(r => r.confidence === 'contextual');
  if (ctx.length) {
    console.log(`\n  ${ctx.length} resolved on session context:`);
    for (const r of ctx) console.log(`    ${r.id.padEnd(40)} ${r.stimulus} -> ${r.goal}  (${r.basis})`);
  }
  const dose = report.filter(r => r.needsDeclaredStimulus);
  if (dose.length) {
    console.log(`\n  ${dose.length} label the dose, not the goal — the pack should declare a real stimulus:`);
    for (const r of dose) console.log(`    ${r.id.padEnd(40)} ${r.stimulus} -> ${r.goal}  (${r.basis.replace(/^.*\((.*)\)$/, '$1')})`);
  }
  if (conflicts.length) {
    console.log(`\n  ${conflicts.length} SEMANTIC CONFLICT(S) — ${reconcile ? 'RECONCILED' : 'stored goal kept, needs review'}:`);
    for (const c of conflicts) {
      console.log(`    ${c.id.padEnd(40)} ${c.stimulus}: ${c.stored} ${reconcile ? '=>' : 'vs derived'} ${c.derives}`);
    }
    if (!reconcile) console.log('    (re-run with --reconcile to apply the derived goal to these)');
  }
  const proposed = [...new Set(report.filter(r => r.confidence === 'proposed').map(r => r.stimulus))].sort();
  if (proposed.length) console.log(`\n  proposed roll-ups still needing review: ${proposed.join(', ')}`);
  const frozen = report.filter(r => r.frozen).length;
  console.log(`\n  ${report.filter(r => r.changed).length} templates changed primary_goal `
    + `(${frozen} already canonical and left alone, ${report.length - frozen} derived)`);
}
