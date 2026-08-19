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
  constructor(public status: number, message: string) { super(message); }
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

/** Everything about the athlete the engine needs, in one round of queries. */
export async function loadAthleteState(db: SupabaseClient, userId: string, today: string) {
  const [profileRes, raceRes, programRes, checkinRes, sessionsRes, equipRes] = await Promise.all([
    db.from('athlete_profiles').select('*').eq('user_id', userId).maybeSingle(),
    db.from('races').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle(),
    db.from('programs')
      .select('id, program_phases(id, phase_type, phase_order, start_date, end_date, weekly_cycles(id, week_index, status, stimulus_requirements(*), session_queue_items(*)))')
      .eq('user_id', userId).eq('status', 'active').maybeSingle(),
    db.from('recovery_checkins').select('*').eq('user_id', userId)
      .order('local_date', { ascending: false }).limit(1).maybeSingle(),
    db.from('workout_sessions')
      .select('template_id, started_at, session_rpe, status')
      .eq('user_id', userId).eq('status', 'completed')
      .order('started_at', { ascending: false }).limit(20),
    db.from('equipment_profiles')
      .select('id, is_default, equipment_profile_items(equipment_id)')
      .eq('user_id', userId),
  ]);

  const profile = profileRes.data;
  const race = raceRes.data;
  const checkin = checkinRes.data;

  const daysToRace = race
    ? Math.round((Date.parse(race.event_date) - Date.parse(today)) / 86_400_000)
    : null;

  // Current weekly cycle: the active one, else the highest week index.
  const phases = (programRes.data as any)?.program_phases ?? [];
  const currentPhase = phases.find((p: any) => today >= p.start_date && today <= p.end_date)
    ?? phases[phases.length - 1];
  const cycles = currentPhase?.weekly_cycles ?? [];
  const currentCycle = cycles.find((c: any) => c.status === 'active') ?? cycles[0];

  const stimulus_requirements: StimulusRequirement[] =
    (currentCycle?.stimulus_requirements ?? []).map((r: any) => ({
      stimulus_type: r.stimulus_type,
      target_exposures: r.target_exposures,
      completed_exposures: r.completed_exposures,
      priority: r.priority,
    }));

  const recent_sessions: CompletedSession[] = (sessionsRes.data ?? []).map((s: any) => ({
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

  return {
    profile, race, daysToRace, currentPhase, currentCycle, checkin,
    stimulus_requirements, recent_sessions, available_equipment,
  };
}
