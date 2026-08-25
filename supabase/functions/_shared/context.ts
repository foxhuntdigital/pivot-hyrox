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
  templates: WorkoutTemplate[];
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

  return { exercises, templates, substitutions: subRes.data! as Substitution[] };
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

/** Everything about the athlete the engine needs, in one round of queries. */
export async function loadAthleteState(db: SupabaseClient, userId: string, today: string) {
  const [profileRes, raceRes, programRes, checkinRes, sessionsRes, equipRes] = await Promise.all([
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
      .select('id, template_id, variant_code, started_at, ended_at, session_rpe, '
        + 'ended_early, status, snapshot_json')
      .eq('user_id', userId).eq('status', 'completed')
      .order('started_at', { ascending: false }).limit(20),
    db.from('equipment_profiles')
      .select('id, is_default, equipment_profile_items(equipment_id)')
      .eq('user_id', userId),
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
  const currentCycle = cycles.find((c: any) => c.status === 'active') ?? cycles[0];

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
  const weekInPhase: number = currentCycle?.week_index ?? 1;
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

  const defaultProfile = (equipRes.data ?? []).find((p: any) => p.is_default)
    ?? (equipRes.data ?? [])[0];
  const available_equipment: string[] =
    (defaultProfile?.equipment_profile_items ?? []).map((i: any) => i.equipment_id);

  const queue = (currentCycle?.session_queue_items ?? []) as { state: string }[];

  return {
    profile, race, daysToRace, currentPhase, currentCycle, checkin, checkins, queue,
    stimulus_requirements, recent_sessions, available_equipment,
    phaseSequence, programTotalWeeks, programWeek, weekInPhase, weekStart, weekEnd,
    completed_this_week, sessionRows,
  };
}

/** `2026-03-02` + 7 → `2026-03-09`. Dates only; no timezone enters here. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
