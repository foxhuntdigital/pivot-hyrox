/**
 * Shared Edge Function plumbing: auth, content loading, and athlete state.
 *
 * The engine is imported directly from packages/engine — the same code the
 * tests run and the client uses — so a recommendation cannot drift between
 * server and app.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type {
  CompletedSession, Exercise, StimulusRequirement, Substitution, WorkoutTemplate,
} from '../../../packages/engine/src/index.ts';
import { capabilityState } from './evidence.ts';
import { effectiveLoadCapacity } from './rebuilding.ts';

export function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

export function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/**
 * Builds a client bound to the caller's JWT so every query runs under their
 * RLS policies. The service role is never used on a user-facing path.
 */
export function clientFor(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization') ?? '';
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  );
}

export async function requireUser(db: SupabaseClient) {
  const { data, error } = await db.from('users').select('id, timezone, units').single();
  if (error || !data) throw new HttpError(401, 'Not authenticated');
  return data as { id: string; timezone: string; units: string };
}

export class HttpError extends Error {
  status: number;

  // The field is declared rather than taken as a constructor parameter
  // property: this module is imported by tests running under Node's strip-only
  // type stripping, which does not support that syntax.
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The athlete's local date, computed in their own timezone (PRD §11.1). */
export function localDate(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Loads the curated library in engine shape. Content is small and identical for
 * every athlete, so it is fetched whole rather than filtered per request.
 */
export async function loadContent(db: SupabaseClient): Promise<{
  exercises: Exercise[];
  /**
   * Every template, including retired ones.
   *
   * Look things up here. A completed session on a retired template must still
   * resolve its name, family and goal — the athlete did that training, and a
   * history entry that lost its name because the library moved on would be the
   * library rewriting the record.
   */
  templates: WorkoutTemplate[];
  /**
   * Templates the planner may schedule. Build `EngineInput.candidates` from
   * this, never from `templates`.
   *
   * Two exclusions. Retirement (migration 0016) removes a template from
   * candidate generation and from nothing else. And a supplemental is not
   * plannable at all: it is offered after a session by
   * `_shared/supplemental.ts`, never queued into a week and never returned as
   * today's session. Left in this array it would compete for the day — the
   * eight-minute core routine has a plausible time_fit against a twenty-minute
   * budget — and `planWeekQueue` would queue optional work as the week's.
   *
   * The split lives here rather than in a filter at each call site because one
   * of five filters would eventually be forgotten.
   */
  candidates: WorkoutTemplate[];
  substitutions: Substitution[];
}> {
  const [exRes, eqRes, tplRes, varRes, blkRes, bxRes, tagRes, subRes] = await Promise.all([
    db.schema('content').from('exercises').select('*'),
    db.schema('content').from('exercise_equipment').select('*'),
    db.schema('content').from('workout_templates').select('*'),
    db.schema('content').from('workout_variants').select('*'),
    db.schema('content').from('workout_blocks').select('*'),
    db.schema('content').from('block_exercises').select('*'),
    db.schema('content').from('workout_tags').select('workout_id, tags(name)'),
    db.schema('content').from('substitutions').select('*'),
  ]);

  for (const r of [exRes, eqRes, tplRes, varRes, blkRes, bxRes, tagRes, subRes]) {
    if (r.error) throw new HttpError(500, `content load failed: ${r.error.message}`);
  }

  const equipByExercise = new Map<string, string[]>();
  for (const r of eqRes.data!) {
    const list = equipByExercise.get(r.exercise_id) ?? [];
    list.push(r.equipment_id);
    equipByExercise.set(r.exercise_id, list);
  }

  const exercises: Exercise[] = exRes.data!.map((e: any) => ({
    id: e.id,
    name: e.name,
    impact_level: e.impact_level,
    postpartum_friendly: e.postpartum_friendly,
    equipment: equipByExercise.get(e.id) ?? [],
    // The ontology migration 0014 added. Carried because the strength services
    // branch on it — `progression_class` decides whether a movement advances by
    // load at all — and because dropping it here left the server reading a
    // narrower exercise than the engine's own gate does.
    movement_families: e.movement_families ?? [],
    // Carried for the same reason `movement_families` is, and it was missing
    // for the same reason: the engine reads it and the server was handing over
    // a narrower exercise than the engine's own types describe. Micro's
    // decision about what a session can lose is made from this.
    exercise_role_eligibility: e.exercise_role_eligibility ?? [],
    complexity_level: e.complexity_level ?? null,
    progression_class: e.progression_class ?? null,
    progression_tracks: e.progression_tracks ?? [],
  }));

  const bxByBlock = new Map<string, any[]>();
  for (const r of bxRes.data!) {
    const list = bxByBlock.get(r.block_id) ?? [];
    list.push(r);
    bxByBlock.set(r.block_id, list);
  }

  const blocksByWorkout = new Map<string, any[]>();
  for (const b of blkRes.data!) {
    const list = blocksByWorkout.get(b.workout_id) ?? [];
    list.push({
      ...b,
      exercises: (bxByBlock.get(b.id) ?? [])
        .sort((x, y) => x.sequence_order - y.sequence_order),
    });
    blocksByWorkout.set(b.workout_id, list);
  }

  const variantsByWorkout = new Map<string, any[]>();
  for (const v of varRes.data!) {
    const list = variantsByWorkout.get(v.workout_id) ?? [];
    list.push(v);
    variantsByWorkout.set(v.workout_id, list);
  }

  const tagsByWorkout = new Map<string, string[]>();
  for (const t of tagRes.data! as any[]) {
    const list = tagsByWorkout.get(t.workout_id) ?? [];
    if (t.tags?.name) list.push(t.tags.name);
    tagsByWorkout.set(t.workout_id, list);
  }

  const templates: WorkoutTemplate[] = tplRes.data!.map((t: any) => ({
    ...t,
    tags: tagsByWorkout.get(t.id) ?? [],
    variants: variantsByWorkout.get(t.id) ?? [],
    blocks: (blocksByWorkout.get(t.id) ?? []).sort((a, b) => a.block_order - b.block_order),
  }));

  return {
    exercises,
    templates,
    candidates: templates.filter((t: any) =>
      t.status !== 'retired' && (t.workout_role ?? 'primary') === 'primary'),
    substitutions: subRes.data! as Substitution[],
  };
}

/**
 * The athlete's sessions for one of THEIR days.
 *
 * Read from `snapshot_json.started_local_date` rather than from `started_at`,
 * because "today" is a question about the athlete's day and not about UTC. A
 * session begun at 23:40 and finished after midnight is still that day's
 * session, and anything counting sessions per day has to agree with the
 * athlete about which day it was.
 */
export async function loadTodaySessions(db: SupabaseClient, userId: string, today: string) {
  const { data } = await db
    .from('workout_sessions')
    .select('id, template_id, status, workout_role, session_rpe, ended_early, snapshot_json')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(20);

  const onToday = (data ?? []).filter((s: any) =>
    (s.snapshot_json?.started_local_date ?? null) === today);

  return {
    sessions: onToday,
    completedPrimary: onToday.find((s: any) =>
      s.status === 'completed' && (s.workout_role ?? 'primary') === 'primary') ?? null,
    supplementalTakenToday: onToday.some((s: any) =>
      (s.workout_role ?? 'primary') === 'supplemental'),
  };
}

/** One phase of the program, as the ribbon and the roadmap draw it. */
export interface PhaseSummary {
  type: string;
  order: number;
  start_date: string;
  end_date: string;
  /** Weekly cycles inside this phase. */
  weeks: number;
}

/**
 * Refuses the request unless the athlete's subscription is currently paid for.
 *
 * Gating in the app only hides UI — these functions are the product, and a JWT
 * is enough to call them directly. So the check lives here, next to the work.
 *
 * `has_active_entitlement` counts trials and grace periods as entitled, and
 * counts a cancelled-but-unexpired subscription as entitled too: turning off
 * auto-renew does not surrender the days already paid for.
 *
 * 402 rather than 403: this is not "you may not", it is "this needs payment",
 * which is what the client keys the paywall off.
 */
export async function requireEntitlement(db: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await db.rpc('has_active_entitlement', { uid: userId });
  if (error) throw new HttpError(500, `entitlement check failed: ${error.message}`);
  if (!data) throw new HttpError(402, 'subscription_required');
}

/** Everything about the athlete the engine needs, in one round of queries. */
export async function loadAthleteState(db: SupabaseClient, userId: string, today: string) {
  const [profileRes, raceRes, programRes, checkinRes, sessionsRes, equipRes,
    prefRes, weaknessRes, evidenceRes] = await Promise.all([
    db.from('athlete_profiles').select('*').eq('user_id', userId).maybeSingle(),
    db.from('races').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle(),
    db.from('programs')
      .select('id, program_phases(id, phase_type, phase_order, start_date, end_date, weekly_cycles(id, week_index, status, stimulus_requirements(*), session_queue_items(*)))')
      .eq('user_id', userId).eq('status', 'active').maybeSingle(),
    // Fourteen days of check-ins, not one: the latest drives today's decision,
    // the run of them backs the recovery detail on Progress.
    db.from('recovery_checkins').select('*').eq('user_id', userId)
      .order('local_date', { ascending: false }).limit(14),
    db.from('workout_sessions')
      .select('id, client_session_id, template_id, variant_code, started_at, ended_at, '
        + 'session_rpe, ended_early, status, snapshot_json')
      .eq('user_id', userId).eq('status', 'completed')
      .order('started_at', { ascending: false }).limit(20),
    db.from('equipment_profiles')
      .select('id, is_default, equipment_profile_items(equipment_id)')
      .eq('user_id', userId),
    db.from('athlete_preferences')
      .select('modality_or_domain, rating').eq('user_id', userId),
    db.from('athlete_perceived_weaknesses')
      .select('capability_key').eq('user_id', userId),
    // Append-only, so the whole log is the input: `capabilityState` needs the
    // run of rows to decide whether anything has been shown twice.
    db.from('athlete_capability_evidence')
      .select('capability_key, direction, magnitude_band, confidence_band, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(200),
  ]);

  const profile = profileRes.data;
  const race = raceRes.data;
  const checkins = checkinRes.data ?? [];
  const checkin = checkins[0] ?? null;

  const daysToRace = race
    ? Math.round((Date.parse(race.event_date) - Date.parse(today)) / 86_400_000)
    : null;

  // Current weekly cycle: the active one, else the highest week index.
  const phases = ((programRes.data as any)?.program_phases ?? [])
    .slice()
    .sort((a: any, b: any) => a.phase_order - b.phase_order);
  const currentPhase = phases.find((p: any) => today >= p.start_date && today <= p.end_date)
    ?? phases[phases.length - 1];
  const cycles = (currentPhase?.weekly_cycles ?? [])
    .slice()
    .sort((a: any, b: any) => a.week_index - b.week_index);

  /**
   * Which week of the current phase today falls in, counted from the phase's
   * own start date.
   *
   * Derived from the calendar rather than from `weekly_cycles.status`, because
   * nothing advances that status as time passes: onboarding marks the first
   * week `active` and no job ever moves it, so a program left to run reported
   * the first week of its phase forever — and with it a week window that never
   * caught up to the athlete.
   *
   * Reading the cycle by position rather than by `week_index` also makes this
   * agnostic to how the writer numbered them. The cycles are already filtered
   * to this phase and sorted, so the nth entry is the nth week of the phase
   * whether the stored indices restart per phase or run across the program.
   */
  const weekInPhaseRaw = currentPhase?.start_date
    ? Math.floor(daysBetween(currentPhase.start_date, today) / 7) + 1
    : 1;
  const weekInPhase: number = Math.max(1, Math.min(cycles.length || 1, weekInPhaseRaw));
  const currentCycle = cycles[weekInPhase - 1]
    ?? cycles.find((c: any) => c.status === 'active')
    ?? cycles[0];

  /**
   * The shape of the whole program: one entry per phase, in order, with the
   * weeks it holds. This is what the phase ribbon and the race roadmap are
   * drawn from — both were reading an authored six-phase list before.
   */
  const phaseSequence: PhaseSummary[] = phases.map((p: any) => ({
    type: p.phase_type as string,
    order: p.phase_order as number,
    start_date: p.start_date as string,
    end_date: p.end_date as string,
    weeks: (p.weekly_cycles ?? []).length as number,
  }));

  const programTotalWeeks = phaseSequence.reduce((n, p) => n + p.weeks, 0);

  // The absolute week the athlete is in, counted across phases — "week 7 of 16"
  // rather than "week 2" of whichever phase this is.
  const weeksBefore = phaseSequence
    .filter(p => p.order < (currentPhase?.phase_order ?? 0))
    .reduce((n, p) => n + p.weeks, 0);
  const programWeek = weeksBefore + weekInPhase;

  /**
   * The current cycle's date window, derived from its phase's start date and
   * its week index. `weekly_cycles` stores no dates of its own, and the week is
   * what "completed this week" has to be measured against.
   */
  const weekStart = currentPhase?.start_date
    ? addDays(currentPhase.start_date, (weekInPhase - 1) * 7)
    : null;
  const weekEnd = weekStart ? addDays(weekStart, 6) : null;

  const stimulus_requirements: StimulusRequirement[] =
    (currentCycle?.stimulus_requirements ?? []).map((r: any) => ({
      stimulus_type: r.stimulus_type,
      target_exposures: r.target_exposures,
      completed_exposures: r.completed_exposures,
      priority: r.priority,
    }));

  const sessionRows = (sessionsRes.data ?? []) as any[];

  /**
   * Sessions finished inside the current week's window. Measured on the day the
   * session ended rather than on its queue item, so a session performed off
   * plan still counts as work the athlete did this week.
   */
  const completed_this_week = (weekStart && weekEnd)
    ? sessionRows.filter(s => {
        const day = (s.ended_at ?? s.started_at ?? '').slice(0, 10);
        return day >= weekStart && day <= weekEnd;
      })
    : [];

  const recent_sessions: CompletedSession[] = sessionRows.map((s: any) => ({
    template_id: s.template_id,
    workout_family: '',   // filled in by the caller from the content index
    primary_goal: '',
    days_ago: Math.round((Date.parse(today) - Date.parse(s.started_at)) / 86_400_000),
    impact_level: 'medium' as const,
    session_rpe: s.session_rpe,
  }));

  /**
   * What the planner should use, with any rebuilding ceiling already applied.
   *
   * Resolved once here rather than at each call site, because a ceiling that
   * one caller forgets to apply is a ceiling that does not exist: six functions
   * build an `EngineInput`, and the athlete would get a reduced week from some
   * of them and a full one from the others.
   */
  const effective_load_capacity = effectiveLoadCapacity(
    profile?.load_capacity, profile?.rebuilding_load_ceiling);

  const defaultProfile = (equipRes.data ?? []).find((p: any) => p.is_default)
    ?? (equipRes.data ?? [])[0];
  const available_equipment: string[] =
    (defaultProfile?.equipment_profile_items ?? []).map((i: any) => i.equipment_id);

  const queue = (currentCycle?.session_queue_items ?? []) as { state: string }[];

  /**
   * Stated preferences, split into the two lists the engine scores with.
   *
   * `neutral` is not an opinion and produces nothing; `love` and `like` both
   * reward, because the engine's preference dimension is a nudge and grading it
   * finer than "yes" would imply a precision the athlete never expressed.
   */
  const prefs = prefRes.data ?? [];
  const preferred_families = prefs
    .filter((p: any) => p.rating === 'love' || p.rating === 'like')
    .map((p: any) => p.modality_or_domain);
  const avoided_families = prefs
    .filter((p: any) => p.rating === 'rather_not')
    .map((p: any) => p.modality_or_domain);

  /**
   * Demonstrated deficits, as demand the planner can score with.
   *
   * `capabilityState` is what makes this safe to act on: it reports a direction
   * only where repeated comparable evidence agrees, so a single bad session
   * cannot create a need. Only `negative` becomes demand — a capability that is
   * improving needs no extra priority, and one that is holding is not a deficit.
   */
  /**
   * What the athlete says needs work. A third signal, never mixed with the
   * second: it ranks, and it does not become evidence. Migration 0013 puts it
   * on the table itself — a belief has no confidence band.
   */
  const perceived_weaknesses = (weaknessRes.data ?? []).map((w: any) => w.capability_key);

  /**
   * PIVOT's determination about each capability — direction, confidence and the
   * sample behind it. Coach is given this rather than the raw evidence rows,
   * because deciding what a run of sessions means is the engine's job and
   * inviting a language model to re-derive it is inviting a second opinion the
   * product never sanctioned.
   */
  const capability_state = capabilityState((evidenceRes.data ?? []) as any);

  const capability_needs: Record<string, number> = {};
  const MAGNITUDE: Record<string, number> = { small: 0.3, moderate: 0.6, large: 1 };
  const CONFIDENCE: Record<string, number> = { low: 0.5, medium: 0.75, high: 1 };
  for (const state of capability_state) {
    if (state.direction !== 'negative') continue;
    const rows = (evidenceRes.data ?? []).filter((r: any) =>
      r.capability_key === state.capability_key && r.direction === 'negative');
    const magnitude = Math.max(...rows.map((r: any) => MAGNITUDE[r.magnitude_band] ?? 0.3));
    capability_needs[state.capability_key] = magnitude * (CONFIDENCE[state.confidence] ?? 0.5);
  }

  return {
    profile, race, daysToRace, currentPhase, currentCycle, checkin, checkins, queue,
    stimulus_requirements, recent_sessions, available_equipment,
    effective_load_capacity,
    phaseSequence, programTotalWeeks, programWeek, weekInPhase, weekStart, weekEnd,
    completed_this_week, sessionRows,
    preferred_families, avoided_families, capability_needs, perceived_weaknesses,
    capability_state,
  };
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `2026-03-02` + 7 → `2026-03-09`. Dates only; no timezone enters here. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
