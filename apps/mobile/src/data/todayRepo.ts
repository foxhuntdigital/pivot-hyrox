/**
 * Today's decision, from the server.
 *
 * The engine runs in the `today` Edge Function, not here: the decision is
 * recorded against `engine_version` so it can be reproduced from stored inputs
 * later (PRD §24), which a client-side recommendation cannot promise. The
 * payload is the engine's own `Recommendation`, so what arrives is the shape
 * the screens already render.
 */
import type {
  NoSessionResult, Recommendation, StimulusRequirement,
} from '@pivot/engine';

import { supabase } from '@/lib/supabase';

/** One phase of the program. `weeks` is the weekly cycles it holds. */
export interface PhaseSummary {
  type: string;
  order: number;
  start_date: string;
  end_date: string;
  weeks: number;
}

/** A session the week still holds, in the order the engine ranks it. */
export interface QueuedSession {
  id: string;
  template_id: string;
  name: string;
  stimulus_type: string;
  rank: number;
  state: 'queued' | 'recommended' | 'in_progress' | 'completed' | 'skipped';
  estimated_minutes: number | null;
}

/** One session inside a comparable set. */
export interface ComparableRun {
  session_id: string;
  date: string;
  /** Median seconds per kilometre across the session's qualifying efforts. */
  pace_seconds: number;
  rpe: number | null;
  hr: number | null;
}

/** Sessions alike enough to trend against each other (Coach brief §5.3). */
export interface ComparableSeries {
  exercise_id: string;
  distance_meters: number;
  /** Oldest first. */
  runs: ComparableRun[];
  /** Sessions in the window that ran this exercise but did not qualify. */
  excluded: number;
  window_days: number;
}

/** A session the athlete finished inside the current week. */
export interface CompletedThisWeek {
  session_id: string;
  /**
   * The id the device that performed it gave the session (migration 0021).
   *
   * Null for anything recorded before that existed, which is why every match on
   * it is guarded — an old row must not answer to a null the client is holding.
   */
  client_session_id: string | null;
  template_id: string;
  /** The name as prescribed, taken from the session's own snapshot. */
  name: string;
  stimulus: string | null;
  estimated_minutes: number | null;
  variant: string;
  session_rpe: number | null;
  ended_early: boolean;
  completed_on: string;
}

/**
 * A bonus workout on offer — a full session from the same library, chosen for
 * what the athlete said they like.
 *
 * Distinct from a supplemental, which is a 5-to-12-minute accessory bolted onto
 * a finished session. These are whole sessions with their own Full / Express /
 * Micro choice, takeable before the day's primary, instead of it, or three in a
 * day.
 */
export interface Opportunity {
  template_id: string;
  name: string;
  training_domain: string | null;
  stimulus: string | null;
  estimated_minutes: number | null;
  /** A session on this template was completed this week. */
  done: boolean;
}

/** One movement's history and suggestion, as `_shared/guidance.ts` sends it. */
export interface ExerciseGuidance {
  exercise_id: string;
  exercise: string;
  last: {
    date: string;
    days_ago: number;
    load: number | null;
    load_unit: string | null;
    reps: number | null;
    rpe: number | null;
    sets: number;
  } | null;
  /**
   * The heaviest comparable exposure on record, and how many there are.
   *
   * The target a personal best is measured against. `count` of zero means
   * nothing comparable came before, and no record is possible — which is the
   * rule `_shared/prs.ts` applies server-side.
   */
  best: {
    load: number | null;
    load_unit: string | null;
    reps: number | null;
    date: string;
    count: number;
  } | null;
  suggestion: {
    dimension: 'load' | 'reps' | 'density' | 'none';
    load: number | null;
    load_unit: string | null;
    reps: number | null;
    reason_code: string;
    /** The reason in prose. Held server-side so Coach and the player agree. */
    reason: string;
    caveat: string | null;
  };
}

/** PIVOT's determination about one capability. */
export interface CapabilityState {
  capability_key: string;
  direction: 'negative' | 'neutral' | 'positive';
  confidence: 'low' | 'medium' | 'high';
  samples: number;
  agreeing: number;
}

/** A trend, as `_shared/trends.ts` composes it. */
export interface PerformanceTrend {
  metric: string;
  window_weeks: number;
  direction: 'improving' | 'holding' | 'slowing';
  samples: number;
  from: string;
  to: string;
  confidence: 'low' | 'medium' | 'high';
  caveat: string;
}

export interface TodayPayload {
  date_local: string;
  active_race: {
    id: string;
    name: string;
    event_date: string;
    division: string | null;
    goal_type: string | null;
    days_remaining: number;
  } | null;
  phase: {
    type: string;
    order: number;
    /** Week within this phase. */
    week: number;
    weeks: number;
    /** Week within the whole program — what "week 7 of 16" counts. */
    program_week: number;
    program_total_weeks: number;
    sequence: PhaseSummary[];
    start_date: string;
    end_date: string;
  } | null;
  /** The current week: what is queued, and what has already been done. */
  week: {
    start_date: string | null;
    end_date: string | null;
    queue: QueuedSession[];
    completed: CompletedThisWeek[];
    /** Bonus sessions on offer this week. Absent from older payloads. */
    opportunities?: Opportunity[];
  } | null;
  /**
   * Seven-day volume — sessions and minutes actually trained. Deliberately not
   * a load score: the app has no defended load model, and both of these are
   * measured rather than inferred.
   */
  training_7d: { sessions: number; minutes: number };
  /**
   * The comparable running sessions behind a pace claim. Null when nothing in
   * the window qualified — which is an answer, not an empty state to fill.
   */
  comparable_runs: ComparableSeries | null;
  /**
   * Last exposure and suggested load for today's movements, keyed by exercise
   * id. Absent for a movement with no working sets, and for a no_session day.
   *
   * `last` being null is a real answer — the athlete has nothing comparable on
   * this movement — and the player shows nothing rather than a number from a
   * different day or a different rep range.
   */
  exercise_guidance?: Record<string, ExerciseGuidance>;
  /**
   * The one trend worth stating, or null when nothing qualifies. Null is an
   * answer the screen renders rather than hides.
   */
  performance_trend?: PerformanceTrend | null;
  /**
   * What performance has demonstrated. Bands, never numbers — a confidence
   * band rendered as a percentage would be inventing precision the evidence
   * does not have.
   */
  capability_state?: CapabilityState[];
  /** What the athlete says needs work. A separate claim, never merged above. */
  perceived_weaknesses?: string[];
  /**
   * The athlete's own check-in. Null when they have not logged one — which is
   * not zero, and must not be rendered as a number.
   */
  recovery: {
    sleep_hours: number | null;
    energy: string | null;
    source: 'self_reported' | 'connected';
    observed_on: string;
  } | null;
  readiness: {
    /** Null when nothing has been measured yet — not the same as zero. */
    overall: number | null;
    confidence: string;
    components: Record<string, number>;
    /** Components with data behind them; the rest are not in `overall`. */
    observed?: string[];
    model_version: string;
    /**
     * Supporting stats per component, computed from the athlete's own history.
     * A component is absent, or carries an empty list, when there is nothing
     * measured behind it yet — the screen shows no chips rather than invented
     * ones.
     */
    metric_detail?: Record<string, { stats: { k: string; v: string }[] }>;
  };
  recommendation: (Recommendation & { variant_label: string }) | null;
  no_session: Omit<NoSessionResult, 'kind'> | null;
  stimulus_requirements: StimulusRequirement[];
  recent_sessions: {
    template_id: string; workout_family: string; primary_goal: string;
    days_ago: number; impact_level: string; session_rpe: number;
  }[];
  engine_version: string;
}

export async function fetchToday(): Promise<TodayPayload> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('today', { method: 'GET' });
  if (error) throw new Error(await functionMessage(error) ?? error.message);
  return data as TodayPayload;
}

/** Edge Function failures put the useful message in the response body. */
async function functionMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}
