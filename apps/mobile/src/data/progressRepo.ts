/**
 * The Progress read (`supabase/functions/progress`).
 *
 * One payload for the tab and every subpage behind it. The types mirror
 * `_shared/progress-view.ts`; the server builds them, the app only draws them.
 * Three outcomes for the same reason as `historyRepo`: a failed read is not an
 * empty record, and only one of those is safe to state.
 */
import { supabase } from '@/lib/supabase';

export type CapabilityKey =
  | 'lower_body_strength' | 'upper_body_strength' | 'running_threshold'
  | 'aerobic_durability' | 'loaded_movement' | 'muscular_endurance'
  | 'station_proficiency';

export interface IndexSession {
  id: string;
  date: string;
  template_id: string;
  variant_code: string | null;
  name: string;
  minutes: number | null;
  rpe: number | null;
  ended_early: boolean;
  supplemental: boolean;
}

export interface TrendPoint {
  date: string;
  overall: number;
  confidence: string;
  components: Record<string, number>;
  observed: string[];
}

export interface ReadinessInputs {
  aerobic_minutes_14d: number;
  threshold_sessions_14d: number;
  run_sessions_7d: number;
  longest_run_km: number;
  strength_completion_rate: number;
  stations_covered_21d: number;
  stimulus_adherence_4w: number;
  recovery_signal: number;
  observed_days: number;
}

export interface Reading {
  date: string;
  direction: 'negative' | 'neutral' | 'positive';
  band: 'small' | 'moderate' | 'large';
  confidence: 'low' | 'medium' | 'high';
  session_id: string | null;
  session_name: string | null;
}

export interface Lift {
  exercise_id: string;
  name: string;
  reps_min: number | null;
  reps_max: number | null;
  start: number;
  now: number;
  unit: string | null;
}

export interface SeriesPoint {
  week: string;
  pct: number;
  session_id: string;
  session_name: string;
  detail: string;
}

export interface CapabilityDetail {
  readings: Reading[];
  lifts: Lift[];
  series: SeriesPoint[];
  baseline: { date: string; session_id: string; session_name: string } | null;
}

export interface CapabilityStateRow {
  capability_key: CapabilityKey;
  direction: 'negative' | 'neutral' | 'positive';
  confidence: 'low' | 'medium' | 'high';
  samples: number;
  agreeing: number;
}

export interface Highlights {
  pace: { exercise_id: string; distance_meters: number; points: { date: string; seconds: number }[] } | null;
  lift: { exercise_id: string; name: string; reps: number | null; unit: string | null;
    points: { date: string; load: number }[] } | null;
  record: { exercise: string; kind: 'load' | 'reps'; value: number; unit: string | null;
    previous: number; date: string; session_id: string } | null;
}

export interface ProgressPayload {
  today: string;
  race: { date: string | null; name: string | null; days: number | null } | null;
  program: { week: number | null; total_weeks: number | null };
  readiness: {
    overall: number | null;
    confidence: 'low' | 'medium' | 'high';
    components: Record<string, number>;
    observed: string[];
    lowest: string | null;
    inputs: ReadinessInputs | null;
    stations_covered: string[];
  };
  trend: TrendPoint[];
  /** Every completed session, newest first. */
  sessions: IndexSession[];
  capabilities: {
    state: CapabilityStateRow[];
    perceived: string[];
    detail: Partial<Record<CapabilityKey, CapabilityDetail>>;
  };
  highlights: Highlights;
}

export type ProgressResult =
  | { status: 'ok'; payload: ProgressPayload }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

export async function fetchProgress(): Promise<ProgressResult> {
  if (!supabase) return { status: 'unconfigured' };
  try {
    const { data, error } = await supabase.functions.invoke('progress', { method: 'GET' });
    if (error) {
      const context = (error as { context?: Response }).context;
      let message = error.message;
      try {
        const body = context && typeof context.json === 'function' ? await context.json() : null;
        if (typeof body?.error === 'string') message = body.error;
      } catch { /* the envelope's own message stands */ }
      return { status: 'error', message };
    }
    if (!data) return { status: 'error', message: 'The server returned nothing.' };
    return { status: 'ok', payload: data as ProgressPayload };
  } catch (e) {
    return {
      status: 'error',
      message: e instanceof Error && e.message ? e.message : 'Could not reach the server.',
    };
  }
}
