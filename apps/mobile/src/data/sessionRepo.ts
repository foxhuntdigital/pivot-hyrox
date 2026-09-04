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

/**
 * The server declined because the subscription has lapsed (402).
 *
 * Distinct from `null` because the two want opposite handling. `null` means
 * "try again later" and the outbox does exactly that; an entitlement refusal
 * will answer the same way on every attempt until the athlete resubscribes, so
 * retrying it burns the queue's 30-day window and drops a real finished workout
 * at the end of it. Worse, it does so silently — `history` deliberately does not
 * check entitlement, so the surface built to survive a lapse was being fed by a
 * writer that could not.
 */
export interface BlockedSession {
  blocked: 'entitlement';
}

/** The HTTP status behind an Edge Function failure, when there is one. */
function statusOf(error: unknown): number | null {
  const context = (error as { context?: Response }).context;
  return context && typeof context.status === 'number' ? context.status : null;
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
): Promise<StartedSession | RefusedSession | BlockedSession | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('start-workout', {
      method: 'POST',
      body: request,
    });
    if (error) {
      if (statusOf(error) === 402) return { blocked: 'entitlement' };
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
): Promise<CompletedSession | BlockedSession | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('complete-workout', {
      method: 'POST',
      body: request,
    });
    if (error && statusOf(error) === 402) return { blocked: 'entitlement' };
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
 * Closes a session the athlete discarded.
 *
 * Discarding was local-only, and the row it left behind was the mechanism
 * behind every phantom workout: nothing in the codebase ever wrote
 * `'abandoned'`, so a discarded session stayed `'active'` for good, and
 * `start-workout`'s resume branch handed that stale row — with its original
 * prescription and its original date — back to the next athlete who started the
 * same template. Today's logs then landed on a fortnight-old snapshot, and
 * history dated the entry to a day the athlete had not trained.
 *
 * Written straight through PostgREST rather than through an Edge Function: RLS
 * already scopes `workout_sessions` to its owner, and this needs no engine, no
 * entitlement and no reconciliation — it is the athlete retracting a claim.
 *
 * Guarded on the open statuses so it can never reopen a decided session: a
 * finish that landed first leaves nothing here to update, which is the correct
 * outcome for a race between the two.
 */
export async function abandonSession(sessionId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from('workout_sessions')
      .update({ status: 'abandoned', ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .in('status', ['ready', 'active', 'paused', 'completed_pending_review']);
  } catch {
    // Best-effort. A row left open is repaired by the staleness bound on the
    // server's resume query, which is the backstop this is the tidy version of.
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
