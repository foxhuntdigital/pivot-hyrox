/**
 * Training history for a screenshot account, so Progress (readiness trend,
 * capabilities, lifts, history) has something to show.
 *
 *   node --experimental-strip-types scripts/screenshot-seed.ts \
 *     --email screenshots@example.com [--weeks 6] [--today 2026-11-15] > seed.sql
 *
 * Prints SQL. Paste it into the Supabase SQL editor and run it; it needs no
 * keys and touches one account, found by email. It is for an account that
 * exists only for screenshots: what it writes is invented, and anything read
 * from it (readiness, capabilities, Coach's view of the athlete) reflects
 * training that never happened.
 *
 * The history is built from the real library and scored by the app's own
 * readiness maths, so the numbers on Progress are what the app would say about
 * an athlete who did this training:
 *
 *   * five sessions a week: strength (squat/bench, then deadlift/press),
 *     1K repeats, an easy run, and a race-pace session or a long run;
 *   * lifts that progress about 2.5% a week, 1K repeats a few seconds faster;
 *   * a check-in every day, evidence rows per session, and a readiness
 *     snapshot per day computed with `readinessInputsFrom` + `computeReadiness`.
 *
 * Re-running replaces the previous seed (rows are tagged, see SEED_TAG).
 * The SQL ends with the statement that removes it, commented out.
 *
 * Nothing touches the plan: no queue items, stimulus credits or programs. The
 * week on Plan is the account's real one.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { computeReadiness, READINESS_MODEL_VERSION } from '../packages/engine/src/index.ts';
import {
  readinessInputsFrom, recoveryOverDays, stimulusAdherence,
  type CardioLogRow, type SessionRow, type SetLogRow, type TemplateFacts,
} from '../supabase/functions/_shared/readiness-history.ts';

const SEED_TAG = 'screenshot-seed';

/* ------------------------------------------------------------------ args --- */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] ?? '');
}
const email = (args.get('email') ?? '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('usage: node --experimental-strip-types scripts/screenshot-seed.ts --email you@example.com [--weeks 6] [--today YYYY-MM-DD]');
  process.exit(1);
}
const WEEKS = Math.max(2, Math.min(12, Number(args.get('weeks') ?? 6)));
const TODAY = args.get('today') ?? new Date().toISOString().slice(0, 10);

/* --------------------------------------------------------------- content --- */

const content = JSON.parse(readFileSync(new URL('../apps/mobile/src/data/content.json', import.meta.url), 'utf8'));
const templateById = new Map<string, any>(content.templates.map((t: any) => [t.id, t]));
const facts = new Map<string, TemplateFacts>(content.templates.map((t: any) => [t.id, {
  primary_goal: t.primary_goal, requires_running: t.requires_running, estimated_minutes: t.estimated_minutes,
}]));

function template(id: string) {
  const t = templateById.get(id);
  if (!t) throw new Error(`template ${id} is not in content.json`);
  return t;
}

/* ------------------------------------------------------------- schedule --- */

/** Day of week (0 = Monday) → template, by week. Odd weeks swap the weekend. */
function plannedFor(dow: number, week: number): string | null {
  switch (dow) {
    case 0: return 'str_total_01';            // squat / bench / row
    case 1: return 'run_1k_repeats_01';       // 4 x 1K
    case 2: return 'wo_zone_2_run_30';        // easy run
    case 3: return 'str_total_02';            // deadlift / press / split squat
    case 5: return week % 2 ? 'run_long_aerobic_01' : 'run_mixed_race_pace_02';
    default: return null;
  }
}

/** Working weights in kg at the start of the block. */
const BASE_LOAD: Record<string, number> = {
  ex_back_squat: 80, ex_bench_press: 60, ex_db_row: 26, ex_romanian_deadlift: 70,
  ex_deadlift: 110, ex_strict_overhead_press: 40, ex_bulgarian_split_squat: 16,
  ex_pull_up: 0, ex_suitcase_carry: 24, ex_farmer_carry: 28,
};

/** Seconds per km. Easy pace and 1K-repeat pace, both improving with the week. */
const easyPace = (w: number) => 345 - w * 2;
const repeatPace = (w: number) => 262 - w * 3;

/* ----------------------------------------------------------- generation --- */

const day = (offset: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const dowOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const jitter = (n: number, spread: number) => Math.round(n + (rng() * 2 - 1) * spread);
const q = (v: unknown): string =>
  v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
    : `'${String(v).replace(/'/g, "''")}'`;

interface Session extends SessionRow { name: string; minutes: number; rpe: number; blocks: any[]; date: string; capabilities: string[] }
const sessions: Session[] = [];
/** Rows by index, not UUID: the SQL generates ids in the database and links by these. */
const blockRows: { n: number; session: number; order: number }[] = [];
const setRows: { block: number; ex: string; idx: number; reps: number | null; lo: number | null; hi: number | null; load: number | null }[] = [];
const cardioRows: { block: number; ex: string; seconds: number; meters: number; pace: number | null }[] = [];
const setLogs: SetLogRow[] = [];
const cardioLogs: CardioLogRow[] = [];
const checkins: { local_date: string; sleep_hours: number; energy: 'low' | 'normal' | 'high'; soreness: number; stress: number; motivation: number }[] = [];

const startOffset = -WEEKS * 7;
for (let offset = startOffset; offset < 0; offset++) {
  const date = day(offset);
  const week = Math.floor((offset - startOffset) / 7);

  checkins.push({
    local_date: date,
    sleep_hours: Math.round((6.8 + rng() * 1.4) * 4) / 4,
    energy: rng() < 0.15 ? 'low' : rng() < 0.4 ? 'high' : 'normal',
    soreness: 1 + Math.floor(rng() * 3), stress: 2, motivation: 4,
  });

  const templateId = plannedFor(dowOf(date), week);
  if (!templateId) continue;
  const t = template(templateId);
  const id = randomUUID();
  const minutes = jitter(t.estimated_minutes, 4);
  // 06:30 local for most of the Americas and Europe lands inside this window.
  const started = `${date}T13:${String(10 + Math.floor(rng() * 40)).padStart(2, '0')}:00Z`;
  const ended = new Date(Date.parse(started) + minutes * 60_000).toISOString();
  const rpe = t.primary_goal === 'aerobic_durability' ? 4 : jitter(7, 1);
  const capabilities = t.primary_goal === 'strength'
    ? ['lower_body_strength', 'upper_body_strength']
    : t.primary_goal === 'race_specific'
      ? (templateId.startsWith('run_1k') ? ['running_threshold'] : ['station_proficiency', 'muscular_endurance'])
      : ['aerobic_durability'];
  const sessionIndex = sessions.length;
  sessions.push({ id, template_id: templateId, started_at: started, ended_at: ended, session_rpe: rpe,
    name: t.name, minutes, rpe, blocks: t.blocks, date, capabilities });

  for (const block of t.blocks) {
    const blockIndex = blockRows.length;
    blockRows.push({ n: blockIndex, session: sessionIndex, order: block.block_order });
    const rounds = block.rounds ?? 1;
    let setIndex = 0;
    for (let r = 0; r < rounds; r++) {
      for (const x of block.exercises) {
        const isCardio = x.prescription_type === 'distance' || x.prescription_type === 'duration';
        if (isCardio && !(x.exercise_id in BASE_LOAD)) {
          const run = x.exercise_id === 'ex_run';
          // Hard runs (repeats, race-pace segments) at repeat pace, so the 1K
          // comparison on Progress is one improving line rather than a mix of
          // hard and easy kilometres.
          const hard = templateId === 'run_1k_repeats_01' || templateId.startsWith('run_mixed_race_pace');
          const pace = run ? (hard ? repeatPace(week) - (templateId === 'run_1k_repeats_01' ? 0 : 1.5) : easyPace(week)) : 240;
          const meters = x.prescription_type === 'distance'
            ? (x.quantity_unit === 'ft' ? Math.round(x.quantity * 0.3048) : x.quantity)
            : Math.round((x.quantity * 60) / pace * 1000);
          const seconds = x.prescription_type === 'duration' ? x.quantity * 60 : Math.round(meters / 1000 * pace);
          cardioRows.push({ block: blockIndex, ex: x.exercise_id, seconds, meters, pace: run ? pace : null });
          cardioLogs.push({ session_id: id, exercise_id: x.exercise_id, distance_meters: meters, duration_seconds: seconds, pace_seconds_per_km: run ? pace : null });
          continue;
        }
        const sets = x.prescription_type === 'sets_reps' ? (x.sets ?? x.quantity ?? 3) : 1;
        for (let s = 0; s < sets; s++) {
          const reps = x.prescription_type === 'sets_reps' ? (x.reps_min ?? x.reps_max ?? 5)
            : x.prescription_type === 'reps' ? x.quantity : null;
          const base = BASE_LOAD[x.exercise_id];
          const load = base ? Math.round(base * (1 + 0.025 * week) / 2.5) * 2.5 : null;
          const lo = x.reps_min ?? reps; const hi = x.reps_max ?? reps;
          setRows.push({ block: blockIndex, ex: x.exercise_id, idx: setIndex++, reps, lo, hi, load });
          setLogs.push({ session_id: id, exercise_id: x.exercise_id, prescribed_reps: reps, actual_reps: reps, actual_load: load, load_unit: load ? 'kg' : null });
        }
      }
    }
  }
}

/* ------------------------------------------------------------ readiness --- */

const snapshots = [];
for (let offset = startOffset + 7; offset < 0; offset++) {
  const today = day(offset);
  const upTo = sessions.filter(s => s.date <= today);
  const ids = new Set(upTo.map(s => s.id));
  const inputs = readinessInputsFrom({
    today,
    sessions: upTo,
    setLogs: setLogs.filter(l => ids.has(l.session_id)),
    cardioLogs: cardioLogs.filter(l => ids.has(l.session_id)),
    templates: facts,
    stimulus_adherence_4w: stimulusAdherence({ previousWeeks: [], currentWeek: [{ completed_exposures: 4, target_exposures: 5 } as any] }),
    recovery_signal: recoveryOverDays({ today, checkins: checkins.filter(c => c.local_date <= today) as any }),
    hasStimulusTargets: true,
    hasCheckin: true,
  });
  const r = computeReadiness(inputs);
  if (r.overall === null) continue;
  snapshots.push({ today, r });
}

/* ------------------------------------------------------------------- SQL --- */

/*
 * Compact on purpose: it is pasted into the Supabase SQL editor. Each workout's
 * prescription is written once (`_t`), ids are generated in the database and
 * rows link by index (`_s`, `_b`), and repeated values are filled in by SQL.
 */
const v = (rows: unknown[][]) => rows.map(r => `(${r.map(q).join(',')})`).join(',\n');
const used = [...new Set(sessions.map(s => s.template_id))];
const sessionByIndex = sessions;

const out: string[] = [];
out.push(`-- Screenshot history for ${email}: ${sessions.length} sessions over ${WEEKS} weeks to ${day(-1)}.`);
out.push('-- Generated by scripts/screenshot-seed.ts. Invented training: use on a screenshot account only.');
out.push('begin;');
out.push(`create temp table _u on commit drop as select id from public.users where lower(email) = ${q(email)};`);
out.push(`do $$ begin if (select count(*) from _u) <> 1 then raise exception 'No account with email %', ${q(email)}; end if; end $$;`);
out.push('-- Replace any earlier seed for this account.');
out.push(`delete from public.athlete_capability_evidence where source_session_id in (select id from public.workout_sessions where user_id = (select id from _u) and notes = ${q(SEED_TAG)});`);
out.push(`delete from public.workout_sessions where user_id = (select id from _u) and notes = ${q(SEED_TAG)};`);
out.push(`delete from public.readiness_snapshots where user_id = (select id from _u) and model_version = ${q(`${READINESS_MODEL_VERSION}+${SEED_TAG}`)};`);
out.push(`delete from public.recovery_checkins where user_id = (select id from _u) and symptom_json ? ${q(SEED_TAG)};`);

out.push('create temp table _t (id text, name text, blocks jsonb) on commit drop;');
out.push('insert into _t values\n' + used.map(id => {
  const t = template(id);
  return `(${q(id)},${q(t.name)},${q(JSON.stringify(t.blocks))}::jsonb)`;
}).join(',\n') + ';');
out.push(`create temp table _s on commit drop as select g as n, gen_random_uuid() as id from generate_series(0, ${sessions.length - 1}) g;`);
out.push(`create temp table _b on commit drop as select g as n, gen_random_uuid() as id from generate_series(0, ${blockRows.length - 1}) g;`);

out.push(`insert into public.workout_sessions (id, user_id, template_id, variant_code, snapshot_json, status, started_at, ended_at, session_rpe, notes, ended_early, workout_role)
select s.id, (select id from _u), x.t, 'green',
  jsonb_build_object('template_id', x.t, 'name', t.name, 'variant', 'green', 'variant_label', 'Full',
    'estimated_minutes', x.m, 'blocks', t.blocks, 'started_local_date', x.d, 'seeded', true),
  'completed', x.st::timestamptz, x.st::timestamptz + make_interval(mins => x.m), x.r, ${q(SEED_TAG)}, false, 'primary'
from (values
${v(sessionByIndex.map((ss, n) => [n, ss.template_id, ss.minutes, ss.date, ss.started_at, ss.rpe]))}
) x(n, t, m, d, st, r) join _s s on s.n = x.n join _t t on t.id = x.t;`);

out.push(`insert into public.session_blocks (id, session_id, block_order, block_type, prescribed_json, completed_at)
select b.id, s.id, x.o, blk->>'block_type', blk, w.ended_at
from (values
${v(blockRows.map(b => [b.n, b.session, b.order]))}
) x(n, sn, o) join _b b on b.n = x.n join _s s on s.n = x.sn
join public.workout_sessions w on w.id = s.id join _t t on t.id = w.template_id
cross join lateral jsonb_array_elements(t.blocks) blk where (blk->>'block_order')::int = x.o;`);

if (setRows.length) {
  out.push(`insert into public.set_logs (session_block_id, exercise_id, set_index, prescribed_reps, prescribed_reps_min, prescribed_reps_max, actual_reps, actual_load, load_unit, client_event_id, source)
select b.id, x.e, x.i, x.r, x.lo, x.hi, x.r, x.l, case when x.l is not null then 'kg' end, gen_random_uuid(), 'manual'
from (values
${v(setRows.map(r => [r.block, r.ex, r.idx, r.reps, r.lo, r.hi, r.load]))}
) x(n, e, i, r, lo, hi, l) join _b b on b.n = x.n;`.replace(/\(values\n\((\d+),'([^']+)',(\d+),null,null,null,null\)/, '(values\n($1,\'$2\',$3,null::int,null::int,null::int,null::real)'));
}
if (cardioRows.length) {
  out.push(`insert into public.cardio_logs (session_block_id, exercise_id, duration_seconds, distance_meters, pace_seconds_per_km, client_event_id, source)
select b.id, x.e, x.s, x.m, x.p, gen_random_uuid(), 'manual'
from (values
${v(cardioRows.map(r => [r.block, r.ex, r.seconds, r.meters, r.pace]))}
) x(n, e, s, m, p) join _b b on b.n = x.n;`);
}

out.push(`insert into public.athlete_capability_evidence (user_id, capability_key, direction, magnitude_band, confidence_band, source_session_id, created_at)
select (select id from _u), x.k, x.dir, 'moderate', x.c, s.id, w.ended_at
from (values
${v(sessions.flatMap((ss, n) => ss.capabilities.map((c, i) => [n, c,
  i === 0 || ss.date > day(-21) ? 'positive' : 'neutral', ss.date > day(-21) ? 'high' : 'medium'])))}
) x(n, k, dir, c) join _s s on s.n = x.n join public.workout_sessions w on w.id = s.id;`);

out.push(`insert into public.recovery_checkins (user_id, local_date, sleep_hours, energy, stress, soreness, motivation, symptom_json)
select (select id from _u), x.d::date, x.h, x.e, 2, x.so, 4, jsonb_build_object(${q(SEED_TAG)}, true)
from (values
${v(checkins.map(c => [c.local_date, c.sleep_hours, c.energy, c.soreness]))}
) x(d, h, e, so)
on conflict (user_id, local_date) do nothing;`);

if (snapshots.length) {
  out.push(`insert into public.readiness_snapshots (user_id, local_date, overall, components_json, confidence, model_version)
select (select id from _u), x.d::date, x.o, x.c::jsonb, x.f, ${q(`${READINESS_MODEL_VERSION}+${SEED_TAG}`)}
from (values
${v(snapshots.map(({ today, r }) => [today, r.overall, JSON.stringify({ components: r.components, observed: r.observed }), r.confidence]))}
) x(d, o, c, f)
on conflict (user_id, local_date) do nothing;`);
}

out.push('commit;');
out.push('');
out.push('-- To remove this history later, run:');
out.push(`-- delete from public.athlete_capability_evidence where source_session_id in (select id from public.workout_sessions where notes = ${q(SEED_TAG)} and user_id = (select id from public.users where lower(email) = ${q(email)}));`);
out.push(`-- delete from public.workout_sessions where notes = ${q(SEED_TAG)} and user_id = (select id from public.users where lower(email) = ${q(email)});`);
out.push(`-- delete from public.readiness_snapshots where model_version like '%+${SEED_TAG}' and user_id = (select id from public.users where lower(email) = ${q(email)});`);
out.push(`-- delete from public.recovery_checkins where symptom_json ? ${q(SEED_TAG)} and user_id = (select id from public.users where lower(email) = ${q(email)});`);
console.log(out.join('\n'));
console.error(`${sessions.length} sessions, ${setRows.length} sets, ${cardioRows.length} cardio logs, `
  + `${checkins.length} check-ins, ${snapshots.length} readiness days`
  + (snapshots.length ? ` (last: ${snapshots[snapshots.length - 1].r.overall}, ${snapshots[snapshots.length - 1].r.confidence})` : ''));
