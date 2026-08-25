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

export interface TodayPayload {
  date_local: string;
  active_race: { id: string; name: string; days_remaining: number } | null;
  phase: { type: string; week: number } | null;
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
