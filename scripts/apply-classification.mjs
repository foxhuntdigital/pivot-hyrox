/**
 * Classifies every template by what it is, independently of the athlete it was
 * authored for (Workstream A).
 *
 * `primary_goal` speaks the planner's five names and cannot describe strength
 * honestly: twenty-five templates claim it and four are resistance sessions.
 * `training_domain` and `session_type` are added by migration 0013 to say what
 * a session actually is, and this fills them.
 *
 * The strength domain is reached structurally — a template must prescribe
 * working sets — so relabelling cannot promote a metcon into it. See
 * `resolveClassification` in scripts/lib/stimulus-taxonomy.mjs.
 *
 * NOTHING READS THESE COLUMNS YET. `rank.ts:matchesStimulus` still matches
 * `primary_goal`, so running this does not change a single athlete's plan. The
 * switch is one line in the engine and is gated on the true-strength coverage
 * test going green; flipping it against today's library would ask for two
 * strength exposures a week from four templates, none of them reachable
 * without a barbell.
 *
 * Writes two reports, which is what the PRD asks for:
 *   data/review/classification.report.csv    old -> new, with the evidence
 *   data/review/classification.review.json   calls worth a human ruling
 *
 *   node scripts/apply-classification.mjs [--quiet]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { resolveClassification } from './lib/stimulus-taxonomy.mjs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const REPORT = new URL('../data/review/classification.report.csv', import.meta.url);
const REVIEW = new URL('../data/review/classification.review.json', import.meta.url);
const quiet = process.argv.includes('--quiet');

const ADDED = [['training_domain', 'TEXT'], ['session_type', 'TEXT']];

let sql = readFileSync(SRC, 'utf8');

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

const unquote = v => (v === 'NULL' || v === undefined)
  ? null
  : v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;

const quote = v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

/** Column order for a table, from the dump's own CREATE TABLE. */
function columnsOf(table) {
  const m = sql.match(new RegExp(`CREATE TABLE ${table}\\(([^)]*)\\);`));
  if (!m) throw new Error(`${table} CREATE TABLE not found`);
  return m[1].split(',').map(c => c.trim().split(/\s+/)[0]);
}

function rowsOf(table) {
  const cols = columnsOf(table);
  const rows = [];
  for (const m of sql.matchAll(new RegExp(`INSERT INTO "${table}" VALUES\\((.*)\\);`, 'g'))) {
    const vals = splitValues(m[1]).map(unquote);
    rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? null])));
  }
  return rows;
}

// ── Evidence ─────────────────────────────────────────────────────────────────

const exerciseModality = new Map(rowsOf('exercises').map(e => [e.id, e.modality]));
const blocks = rowsOf('workout_blocks');
const blockWorkout = new Map(blocks.map(b => [b.id, b.workout_id]));

/** Per workout: the modalities it uses, and whether it prescribes working sets. */
const evidence = new Map();
for (const be of rowsOf('block_exercises')) {
  const workoutId = blockWorkout.get(be.block_id);
  if (!workoutId) continue;
  const e = evidence.get(workoutId) ?? { modalities: new Set(), hasWorkingSets: false, needsRest: 0 };
  const modality = exerciseModality.get(be.exercise_id);
  if (modality) e.modalities.add(modality);
  if (be.sets !== null && be.sets !== undefined) {
    e.hasWorkingSets = true;
    // Structurally strength, but not yet plannable: the coverage gate also
    // wants rest, and this is what it is still waiting on.
    if (be.rest_seconds === null) e.needsRest++;
  }
  evidence.set(workoutId, e);
}

// ── Schema ───────────────────────────────────────────────────────────────────

const createRe = /CREATE TABLE workout_templates\(([^)]*)\);/;
const create = sql.match(createRe);
if (!create) throw new Error('workout_templates CREATE TABLE not found');

const present = ADDED.filter(([n]) => new RegExp(`\\b${n}\\b`).test(create[1]));
if (present.length && present.length !== ADDED.length) {
  throw new Error('dump is half-classified');
}
if (!present.length) {
  sql = sql.replace(createRe, `CREATE TABLE workout_templates(${create[1]},`
    + ADDED.map(([n, t]) => `${n} ${t}`).join(',') + ');');
}

const templateCols = columnsOf('workout_templates');
const BASE = templateCols.length - (present.length ? ADDED.length : 0);

// ── Rows ─────────────────────────────────────────────────────────────────────

const report = [['id', 'name', 'family', 'old_primary_goal', 'training_domain', 'session_type', 'basis', 'ambiguous']];
const ambiguous = [];
const moved = [];

sql = sql.replace(
  /INSERT INTO "workout_templates" VALUES\((.*)\);/g,
  (line, body) => {
    const vals = splitValues(body);
    const base = vals.slice(0, BASE).map(unquote);
    const row = Object.fromEntries(templateCols.slice(0, BASE).map((c, i) => [c, base[i]]));

    const ev = evidence.get(row.id) ?? { modalities: new Set(), hasWorkingSets: false, needsRest: 0 };
    const cls = resolveClassification(row.primary_goal, {
      hasWorkingSets: ev.hasWorkingSets,
      modalities: [...ev.modalities],
      family: row.workout_family,
      requiresRunning: row.requires_running === '1' || row.requires_running === 1,
    });

    report.push([row.id, row.name, row.workout_family, row.primary_goal,
      cls.training_domain, cls.session_type, cls.basis, cls.ambiguous ? 'review' : '']);

    if (row.primary_goal === 'strength' && cls.training_domain !== 'strength') {
      moved.push({ id: row.id, name: row.name, family: row.workout_family, to: cls.training_domain, basis: cls.basis });
    }
    if (cls.ambiguous) {
      ambiguous.push({ id: row.id, name: row.name, family: row.workout_family,
        old_primary_goal: row.primary_goal, proposed: cls.training_domain, basis: cls.basis });
    }

    const tail = [quote(cls.training_domain), quote(cls.session_type)];
    return `INSERT INTO "workout_templates" VALUES(${
      vals.slice(0, BASE).join(',')},${tail.join(',')});`;
  });

writeFileSync(SRC, sql);

mkdirSync(new URL('../data/review/', import.meta.url), { recursive: true });
writeFileSync(REPORT, report
  .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
  .join('\n') + '\n');
writeFileSync(REVIEW, JSON.stringify({
  note: 'Classifications worth a human ruling. Each kept its training value; what '
    + 'changed is the label the planner reads. A session listed as loaded+engine may '
    + 'be better split into a strength session and a finisher than reclassified whole.',
  rows: ambiguous,
}, null, 2) + '\n');

if (!quiet) {
  const byDomain = {};
  for (const r of report.slice(1)) byDomain[r[4]] = (byDomain[r[4]] ?? 0) + 1;

  console.log(`classified ${report.length - 1} templates\n`);
  for (const [d, n] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${d}`);
  }

  console.log(`\n${moved.length} template(s) lose the strength label:`);
  for (const m of moved.slice(0, 10)) {
    console.log(`  ${m.family.padEnd(26)} ${m.name.padEnd(34)} -> ${m.to}`);
  }
  if (moved.length > 10) console.log(`  … and ${moved.length - 10} more (see the report)`);

  const stillStrength = report.slice(1).filter(r => r[4] === 'strength');
  const restOwed = [...evidence.values()].reduce((n, e) => n + (e.needsRest ? 1 : 0), 0);
  console.log(`\n${stillStrength.length} template(s) keep it: `
    + stillStrength.map(r => r[1]).join(', '));
  console.log(`${restOwed} of them still need rest values before the coverage gate can pass.`);
  console.log(`\n  ${report.length - 1} rows -> data/review/classification.report.csv`);
  console.log(`  ${ambiguous.length} for review -> data/review/classification.review.json`);
}
