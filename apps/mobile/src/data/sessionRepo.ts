/**
 * The workout session's server record.
 *
 * Starting opens the row; finishing closes it and credits the week. Both are
 * best-effort: the athlete's session runs from local state either way (PRD
 * §15.1), so a failed call costs the record, never the workout. What it returns
 * is `null`, and the caller carries on.
 *
 * The consequence is worth stating plainly: with no `session_id` there is
 * nothing for the finish to attach to, so a session begun offline is not
 * recorded when it ends. The durable fix is an offline event queue keyed by
 * `client_event_id` — the completion endpoint is already idempotent and waiting
 * for one.
 */
import { supabase } from '@/lib/supabase';
import type { VariantCode } from '@pivot/engine';
import type { BlockActual, CardioActual, SetActual } from '@/state/actuals';
import type { Split } from '@/state/splits';

export interface StartRequest {
  template_id: string;
  variant_code?: VariantCode;
  available_minutes?: number;
  energy?: 'low' | 'normal' | 'high';
  sleep_hours?: number | null;
  low_impact?: boolean;
  symptom_flags?: string[];
  unavailable_equipment?: string[];
}

export interface StartedSession {
  session_id: string;
  revision: number;
  /** True when this Start found the session already open and returned it. */
  resumed: boolean;
  template_id: string;
  variant: VariantCode | null;
  primary_stimulus: string | null;
}

/** The engine refused to open a session for these inputs. */
export interface RefusedSession {
  refused: true;
  rationale: string;
  guidance: string;
}

export interface CompleteRequest {
  session_id: string;
  /** Identifies this finish. Replays are caught by status and revision. */
  client_event_id: string;
  revision: number;
  session_rpe?: number | null;
  ended_early?: boolean;
  notes?: string;
  /**
   * What was performed. Absent fields are absent measurements — the server
   * replaces the session's logs with exactly what arrives here, so a finish
   * that carries nothing records a session with no detail rather than a
   * session of zeroes.
   */
  blocks?: BlockActual[];
  set_logs?: SetActual[];
  cardio_logs?: CardioActual[];
  /**
   * The laps the clock recorded, in order. Sent alongside the logs rather than
   * folded into them: the logs say what was performed, splits say what the
   * stopwatch saw, and rest has a split but no log.
   */
  splits?: Split[];
}

export interface CompletedSession {
  session_id: string;
  status: string;
  /** The stimulus this session credited to the week, when it credited one. */
  credited_stimulus: string | null;
  replayed?: boolean;
}

export async function startSession(
  request: StartRequest,
): Promise<StartedSession | RefusedSession | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('start-workout', {
      method: 'POST',
      body: request,
    });
    if (error) {
      // A refusal arrives as 409 with the engine's guidance in the body, which
      // is an answer rather than a failure — read it before giving up.
      const refusal = await readRefusal(error);
      return refusal ?? null;
    }
    if (!data?.session_id) return null;
    return {
      session_id: data.session_id,
      revision: data.revision ?? 0,
      resumed: Boolean(data.resumed),
      template_id: data.template_id,
      variant: data.variant ?? null,
      primary_stimulus: data.primary_stimulus ?? null,
    };
  } catch {
    return null;   // offline or unconfigured — the session still runs locally
  }
}

export async function completeSession(
  request: CompleteRequest,
): Promise<CompletedSession | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('complete-workout', {
      method: 'POST',
      body: request,
    });
    if (error || !data?.session_id) return null;
    return {
      session_id: data.session_id,
      status: data.status,
      credited_stimulus: data.credited_stimulus ?? null,
      replayed: data.replayed,
    };
  } catch {
    return null;
  }
}

/** Edge Function failures carry their body on the error's `context` Response. */
async function readRefusal(error: unknown): Promise<RefusedSession | null> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    return body?.refused
      ? { refused: true, rationale: body.rationale ?? '', guidance: body.guidance ?? '' }
      : null;
  } catch {
    return null;
  }
}

/**
 * A unique id for one finish event. `crypto.randomUUID` is not in every React
 * Native runtime, so this does not depend on it.
 *
 * Each call mints a new id, which is correct while every finish is a fresh
 * attempt. A retry queue would need to keep the id it first generated — the
 * endpoint dedupes on session status and revision either way.
 */
export function eventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
