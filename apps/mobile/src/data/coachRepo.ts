/**
 * Coach turns, from the server.
 *
 * The LLM lives behind the `coach` Edge Function so the API key never reaches
 * the app (PRD §15). What comes back is the narrative and the structured intent
 * — not the cards. Cards keep being built locally from the engine, which is
 * both faster (they render before the model has finished writing) and safer: a
 * card can only ever show what the deterministic engine returned.
 *
 * Every failure path here returns null rather than throwing. Coach degrading to
 * its local deterministic answers is a designed state, not an error — the
 * orchestration spec calls for exactly that when the provider is unavailable,
 * and it is what the athlete gets offline, unconfigured, or over the monthly
 * message cap.
 */
import { supabase } from '@/lib/supabase';
import type { CoachIntent, CoachSignals } from '@/data/coach';

/** The server's intent vocabulary (coach-intent.schema.json). */
type RemoteIntent =
  | 'explain_today' | 'adapt_today' | 'request_workout' | 'ask_progress'
  | 'ask_readiness' | 'ask_plan' | 'request_plan_change' | 'equipment_change'
  | 'report_recovery' | 'report_pain_or_symptom' | 'race_strategy'
  | 'general_training_question' | 'other';

interface RemoteEntities {
  available_time_minutes?: number | null;
  reported_recovery?: 'poor' | 'okay' | 'good' | null;
  energy?: 'low' | 'normal' | 'high' | null;
  low_impact?: boolean | null;
  equipment_available?: string[];
  requested_modality?: string[];
  requested_station?: string[];
}

interface CoachTurnResponse {
  thread_id: string | null;
  intent: RemoteIntent;
  confidence: number;
  needs_clarification: boolean;
  response: {
    response_type: string;
    message: string;
    confidence?: 'low' | 'medium' | 'high';
    evidence?: { label: string; value: string | number; context?: string | null }[];
    warnings?: string[];
  };
  action: { action_type: string; requires_confirmation: boolean } | null;
  versions: Record<string, string>;
  usage: Record<string, number>;
}

/** What the thread stores for a server-answered message. */
export interface RemoteAnswer {
  text: string;
  response_type: string;
  confidence?: 'low' | 'medium' | 'high';
  evidence: { label: string; value: string | number }[];
  warnings: string[];
  thread_id: string | null;
  /** The server's reading of the message, used to pick the card. */
  intent: CoachIntent | null;
  signals: CoachSignals;
  versions: Record<string, string>;
}

/**
 * The server classifies into thirteen intents; the local card layer has eight.
 * Anything without a card maps to null — the athlete still gets the server's
 * prose, just without a structured object under it, which is correct for
 * questions like "should I double up tomorrow?" that have no card to show.
 */
const INTENT_MAP: Record<RemoteIntent, CoachIntent | null> = {
  explain_today: 'explain',
  adapt_today: 'adapt',
  report_recovery: 'adapt',
  request_workout: 'build',
  ask_progress: 'progress',
  ask_readiness: 'progress',
  request_plan_change: 'plan',
  equipment_change: 'travel',
  report_pain_or_symptom: 'safety',
  ask_plan: null,
  race_strategy: null,
  general_training_question: null,
  other: null,
};

function signalsFrom(entities: RemoteEntities | undefined): CoachSignals {
  const e = entities ?? {};
  const keywords = [...(e.requested_modality ?? []), ...(e.requested_station ?? [])]
    .map(k => k.toLowerCase());
  return {
    time_limit: typeof e.available_time_minutes === 'number' ? e.available_time_minutes : undefined,
    low_energy: e.energy === 'low' || e.reported_recovery === 'poor',
    low_impact: e.low_impact === true,
    equipment: e.equipment_available?.length ? [...e.equipment_available, 'bodyweight'] : undefined,
    keywords: keywords.length ? keywords : undefined,
  };
}

export async function askCoach(args: {
  message: string;
  threadId?: string | null;
  history?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<RemoteAnswer | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.functions.invoke('coach', {
      method: 'POST',
      body: {
        message: args.message,
        thread_id: args.threadId ?? null,
        history: (args.history ?? []).slice(-4),
      },
    });
    if (error || !data) return null;

    const turn = data as CoachTurnResponse & { entities?: RemoteEntities };
    if (!turn.response?.message) return null;

    return {
      text: turn.response.message,
      response_type: turn.response.response_type,
      confidence: turn.response.confidence,
      evidence: turn.response.evidence ?? [],
      warnings: turn.response.warnings ?? [],
      thread_id: turn.thread_id,
      intent: INTENT_MAP[turn.intent] ?? null,
      signals: signalsFrom(turn.entities),
      versions: turn.versions ?? {},
    };
  } catch {
    return null;   // offline, rate-limited, or unconfigured — fall back locally
  }
}
