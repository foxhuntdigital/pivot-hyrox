/**
 * The finish queue's rules, with no storage and no network in sight.
 *
 * Separated from `outbox.ts` so they can be tested for what they are — the
 * decisions that make a retry a retry rather than a duplicate — without a
 * filesystem, a native storage module or a server standing in the way.
 */
import type { CompleteRequest, StartRequest } from './sessionRepo';

/** Beyond this the queue is not a retry queue, it is a leak. */
export const MAX_ENTRIES = 50;

/**
 * How long a finish keeps trying. A month covers any plausible stretch of a
 * broken connection or a server-side outage; past that the week it belonged to
 * is long closed and crediting it would move counters the athlete has stopped
 * looking at.
 */
export const MAX_AGE_DAYS = 30;

export interface PendingFinish {
  /**
   * Minted once, when the finish is queued, and never regenerated. This is the
   * whole reason a retry is idempotent rather than a duplicate.
   */
  client_event_id: string;
  /** The athlete's local day, so the UI can still call this "completed today". */
  local_date: string;
  template_id: string;
  name: string;
  /**
   * What the session was billed at, so a finish that outlives the process can
   * still be named and totalled on Today and Plan. Optional because entries
   * queued before it existed do not carry one.
   */
  estimated_minutes?: number;
  /** Null when the session was never opened server-side — start failed too. */
  session_id: string | null;
  /** The revision Start handed back. A finish always sends this plus one. */
  revision: number;
  /** Re-opens the session when there is none. */
  start: StartRequest;
  /** The finish itself, minus the ids that are resolved at send time. */
  finish: Omit<CompleteRequest, 'session_id' | 'client_event_id' | 'revision'>;
  attempts: number;
  queued_at: string;
}

/**
 * Adds a finish to the queue, replacing any entry that describes the same
 * workout.
 *
 * A re-finish of the same session replaces its pending entry rather than
 * queueing a second one. The server would dedupe them on arrival, but two
 * entries for one workout would still be two attempts to open two rows on the
 * way there.
 *
 * Pure, and exported for that reason: the queue's rules are the part worth
 * testing, and they should not require a filesystem to exercise.
 */
export function mergeQueued(
  entries: PendingFinish[], entry: PendingFinish,
): PendingFinish[] {
  const without = entries.filter(e =>
    e.client_event_id !== entry.client_event_id
    && !(entry.session_id !== null && e.session_id === entry.session_id));
  return [...without, entry].slice(-MAX_ENTRIES);
}

/** Whether a queued finish has been waiting long enough to give up on. */
export function expired(entry: PendingFinish, now: number): boolean {
  const age = now - Date.parse(entry.queued_at);
  return Number.isFinite(age) && age > MAX_AGE_DAYS * 86_400_000;
}

/**
 * The finish to send for a queued entry, once a session id is known.
 *
 * The revision is the one Start handed back plus one, because the server treats
 * anything at or below the stored revision as an already-applied replay — which
 * is exactly what a retry of an accepted finish should look like, and exactly
 * what a first attempt should not.
 */
export function finishRequestFor(
  entry: PendingFinish, sessionId: string, revision: number,
): CompleteRequest {
  return {
    ...entry.finish,
    session_id: sessionId,
    client_event_id: entry.client_event_id,
    revision: revision + 1,
  };
}

/**
 * The finish for `localDate` still waiting to be sent, if there is one.
 *
 * The most recently queued wins: two sessions on one day are queued in order,
 * and the last one is the one just finished.
 */
export function pendingFinishOn(
  pending: PendingFinish[], localDate: string,
): PendingFinish | null {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].local_date === localDate) return pending[i];
  }
  return null;
}

/** Whether a finish for `localDate` is still waiting to be sent. */
export function hasPendingFinishOn(pending: PendingFinish[], localDate: string): boolean {
  return pendingFinishOn(pending, localDate) !== null;
}
