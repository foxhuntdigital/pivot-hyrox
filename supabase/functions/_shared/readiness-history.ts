/**
 * Turns stored training history into the readiness model's inputs (PRD §9.5).
 *
 * `today` previously passed zeros for everything except consistency and
 * recovery, so four of the six components always read 0 on a live account and
 * the overall score could not exceed 30. The history was being written — by
 * `complete-workout` — but never aggregated.
 *
 * The aggregation is a pure function over rows so the arithmetic is testable
 * without a database; `loadReadinessHistory` is the thin part that fetches
 * them.
 */
import { HYROX_STATION_EXERCISES, type ReadinessInputs } from '../../../packages/engine/src/index.ts';

/** Windows the model is defined over, in days. */
export const WINDOWS = { aerobic: 14, threshold: 14, run: 7, stations: 21, strength: 28, observed: 30 } as const;

export interface SessionRow {
  id: string;
  template_id: string;
  started_at: string | null;
  ended_at: string | null;
  session_rpe?: number | null;
}
export interface SetLogRow {
  session_id: string; exercise_id: string;
  prescribed_reps: number | null; actual_reps: number | null;
  actual_load?: number | null; load_unit?: string | null;
}
export interface CardioLogRow {
  session_id: string; exercise_id: string;
  distance_meters: number | null; duration_seconds: number | null;
  pace_seconds_per_km?: number | null; avg_hr?: number | null;
}
/** Only the template fields readiness needs, keyed by template id. */
export interface TemplateFacts { primary_goal: string; requires_running: boolean; estimated_minutes: number }

const STATIONS = new Set<string>(HYROX_STATION_EXERCISES);
const dayFloor = (iso: string) => iso.slice(0, 10);

export { dayFloor };

export const daysAgo = (today: string, at: string | null) =>
  at == null ? Infinity : Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(at)) / 86_400_000);

/** Minutes a session actually took, falling back to what it was scheduled for. */
export function sessionMinutes(s: SessionRow, facts: TemplateFacts | undefined): number {
  if (s.started_at && s.ended_at) {
    const mins = (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60_000;
    // A clock that ran overnight is a stuck timer, not a twelve hour session.
    if (mins > 0 && mins < 300) return mins;
  }
  return facts?.estimated_minutes ?? 0;
}

/**
 * Computes the readiness inputs from history.
 *
 * `stimulus_adherence_4w` and `recovery_signal` are passed through rather than
 * derived here: they come from the weekly cycle and the check-in, which the
 * caller already holds.
 */
export function readinessInputsFrom(args: {
  today: string;
  sessions: SessionRow[];
  setLogs: SetLogRow[];
  cardioLogs: CardioLogRow[];
  templates: Map<string, TemplateFacts>;
  stimulus_adherence_4w: number;
  recovery_signal: number;
  /** Whether the week actually set targets, and whether a check-in exists. */
  hasStimulusTargets?: boolean;
  hasCheckin?: boolean;
}): ReadinessInputs {
  const { today, sessions, setLogs, cardioLogs, templates } = args;
  const hasStimulusTargets = args.hasStimulusTargets ?? false;
  const hasCheckin = args.hasCheckin ?? args.recovery_signal > 0;

  const within = (s: SessionRow, days: number) => daysAgo(today, s.started_at) < days;
  const factsFor = (s: SessionRow) => templates.get(s.template_id);
  const sessionById = new Map(sessions.map(s => [s.id, s]));

  let aerobic_minutes_14d = 0, threshold_sessions_14d = 0, run_sessions_7d = 0;
  for (const s of sessions) {
    const f = factsFor(s);
    if (!f) continue;
    if (within(s, WINDOWS.aerobic) && f.primary_goal === 'aerobic_durability') {
      aerobic_minutes_14d += sessionMinutes(s, f);
    }
    if (within(s, WINDOWS.threshold) && f.primary_goal === 'threshold') threshold_sessions_14d++;
    if (within(s, WINDOWS.run) && f.requires_running) run_sessions_7d++;
  }

  // Longest single continuous run, not the week's total — the model asks how
  // far the athlete has actually gone in one go.
  let longest_run_km = 0;
  for (const c of cardioLogs) {
    const s = sessionById.get(c.session_id);
    if (!s || !within(s, WINDOWS.run)) continue;
    if (c.exercise_id !== 'ex_run' || !c.distance_meters) continue;
    longest_run_km = Math.max(longest_run_km, c.distance_meters / 1000);
  }

  // Completion against what was prescribed, capped per set so beating the
  // prescription cannot mask a set that was missed.
  let prescribedSets = 0, completion = 0;
  for (const l of setLogs) {
    const s = sessionById.get(l.session_id);
    if (!s || !within(s, WINDOWS.strength)) continue;
    if (!l.prescribed_reps) continue;
    prescribedSets++;
    completion += Math.min(1, (l.actual_reps ?? 0) / l.prescribed_reps);
  }
  const strength_completion_rate = prescribedSets ? completion / prescribedSets : 0;

  const stations = new Set<string>();
  for (const l of [...setLogs, ...cardioLogs]) {
    const s = sessionById.get(l.session_id);
    if (!s || !within(s, WINDOWS.stations)) continue;
    if (STATIONS.has(l.exercise_id)) stations.add(l.exercise_id);
  }

  // Confidence is about how much real training we have seen, so it counts
  // distinct days trained rather than sessions — two sessions in a day is one
  // day of evidence.
  const observedDays = new Set<string>();
  for (const s of sessions) {
    if (s.started_at && within(s, WINDOWS.observed)) observedDays.add(dayFloor(s.started_at));
  }

  /**
   * A component counts as observed when there was an opportunity to measure it
   * — the athlete trained in that window, or the input exists at all. Training
   * for two weeks and doing no aerobic work is a real aerobic zero; logging
   * nothing is not.
   */
  const trainedWithin = (days: number) =>
    sessions.some(s => daysAgo(today, s.started_at) < days);
  const observed = {
    aerobic: trainedWithin(WINDOWS.aerobic),
    running: trainedWithin(WINDOWS.run),
    stations: trainedWithin(WINDOWS.stations),
    strength: prescribedSets > 0,
    consistency: args.stimulus_adherence_4w > 0 || hasStimulusTargets,
    recovery: hasCheckin,
  };

  return {
    observed,
    aerobic_minutes_14d: Math.round(aerobic_minutes_14d),
    threshold_sessions_14d,
    run_sessions_7d,
    longest_run_km: Number(longest_run_km.toFixed(1)),
    strength_completion_rate,
    stations_covered_21d: stations.size,
    stimulus_adherence_4w: args.stimulus_adherence_4w,
    recovery_signal: args.recovery_signal,
    observed_days: observedDays.size,
  };
}

/**
 * Fetches the history the model needs. Four queries rather than a join so each
 * stays inside its own RLS policy, which is written per table.
 */
export async function loadReadinessHistory(db: any, userId: string, today: string) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - WINDOWS.observed * 86_400_000).toISOString();

  const { data: sessions } = await db.from('workout_sessions')
    .select('id, template_id, started_at, ended_at, session_rpe')
    .eq('user_id', userId).eq('status', 'completed')
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  const rows: SessionRow[] = sessions ?? [];
  if (!rows.length) return { sessions: rows, setLogs: [], cardioLogs: [] };

  // session_blocks carries the session_id the logs need; the logs themselves
  // only reference the block.
  const { data: blocks } = await db.from('session_blocks')
    .select('id, session_id').in('session_id', rows.map(s => s.id));
  const blockToSession = new Map((blocks ?? []).map((b: any) => [b.id, b.session_id]));
  const blockIds = [...blockToSession.keys()];
  if (!blockIds.length) return { sessions: rows, setLogs: [], cardioLogs: [] };

  const [setRes, cardioRes] = await Promise.all([
    db.from('set_logs').select('session_block_id, exercise_id, prescribed_reps, actual_reps, actual_load, load_unit').in('session_block_id', blockIds),
    db.from('cardio_logs').select('session_block_id, exercise_id, distance_meters, duration_seconds, pace_seconds_per_km, avg_hr').in('session_block_id', blockIds),
  ]);

  const attach = (r: any) => ({ ...r, session_id: blockToSession.get(r.session_block_id) });
  return {
    sessions: rows,
    setLogs: (setRes.data ?? []).map(attach) as SetLogRow[],
    cardioLogs: (cardioRes.data ?? []).map(attach) as CardioLogRow[],
  };
}
