/**
 * The durable finish queue `sessionRepo` has always described and never had.
 *
 * A session used to reach the server on exactly one attempt. `startSession` and
 * `completeSession` both answer `null` on any failure — offline, a 500, the
 * entitlement 402 — and `finishSession` gave up silently when there was no
 * `session_id` to attach a finish to. The athlete saw "completed", because that
 * came from a reducer flag, and the flag lived in memory. The next launch had
 * neither the flag nor a server row, so a finished workout simply stopped
 * existing.
 *
 * Everything needed to fix that already existed on the server: `complete-workout`
 * dedupes on session status and a monotonic revision, so replaying a finish is
 * safe by construction. What was missing was something to replay *from*.
 *
 * This is that. A finish is written to disk before it is sent, so the record
 * survives the process; it is retried on launch and on foreground; and the id it
 * was first queued with travels with it, which is what makes a replay a replay
 * rather than a second workout.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { completeSession, startSession } from './sessionRepo';
import {
  blockedFinishes as blocked, expired, finishRequestFor, mergeQueued, MAX_ENTRIES,
  promoteProvisional, sendable, type PendingFinish,
} from './outboxRules';

export {
  blockedFinishes, finishRequestFor, hasPendingFinishOn, mergeQueued, pendingFinishOn,
  promoteProvisional, sendable, type PendingFinish,
} from './outboxRules';

const KEY = 'pivot.outbox.finishes.v1';

type Listener = (pending: PendingFinish[]) => void;

const listeners = new Set<Listener>();
let cache: PendingFinish[] | null = null;
let flushing = false;

function notify() {
  const snapshot = cache ?? [];
  for (const l of listeners) l(snapshot);
}

/** Subscribe to the queue. Returns the unsubscribe. */
export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  if (cache) listener(cache);
  return () => { listeners.delete(listener); };
}

export async function loadOutbox(): Promise<PendingFinish[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Promoted on the way in, and only here: this runs once per process, so a
    // provisional entry read off disk is by definition one whose review screen
    // the athlete never came back to.
    cache = Array.isArray(parsed) ? promoteProvisional(parsed as PendingFinish[]) : [];
  } catch {
    // Unreadable storage is an empty queue, never a crash on launch. Losing a
    // pending finish is bad; failing to start the app is worse.
    cache = [];
  }
  notify();
  return cache;
}

async function persist(entries: PendingFinish[]): Promise<void> {
  cache = entries;
  notify();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Kept in memory for this session at least, so the retry still happens
    // while the app is open.
  }
}

/**
 * Records a finish before any attempt is made to send it.
 *
 * Written first, sent second, on purpose: a finish that is sent first and
 * written only on failure is lost to whatever kills the process between the two.
 */
export async function enqueueFinish(
  entry: Omit<PendingFinish, 'attempts' | 'queued_at'>,
): Promise<void> {
  const entries = await loadOutbox();
  await persist(mergeQueued(entries, {
    ...entry, attempts: 0, queued_at: new Date().toISOString(),
  }));
}

export interface FlushResult {
  /** Finishes that reached the server on this pass. */
  sent: number;
  /** Still queued afterwards. */
  remaining: number;
  /** Of those, the ones waiting on the athlete's subscription rather than the network. */
  blocked: number;
}

/**
 * Sends everything queued, oldest first.
 *
 * Each entry is tried at most once per flush and kept on failure. Opening the
 * session is part of the retry: a workout whose Start never landed has no row
 * to complete, so one is opened now and the finish attached to it — which is
 * the case that used to lose the session outright.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushing) {
    const held = cache ?? [];
    return { sent: 0, remaining: held.length, blocked: blocked(held).length };
  }
  flushing = true;
  try {
    const entries = await loadOutbox();
    if (!entries.length) return { sent: 0, remaining: 0, blocked: 0 };

    const now = Date.now();
    const keep: PendingFinish[] = [];
    let sent = 0;

    for (const entry of entries) {
      if (expired(entry, now)) continue;
      // Queued at the last step and still waiting on the review. Held rather
      // than sent, so the athlete's RPE is not lost to a revision the server
      // has already moved past.
      if (!sendable(entry)) { keep.push(entry); continue; }

      let sessionId = entry.session_id;
      let revision = entry.revision;

      if (!sessionId) {
        const started = await startSession(entry.start);
        if (started && 'blocked' in started) {
          // Held, not failed. No attempt is counted and the entry stops ageing,
          // so resubscribing months later still credits the workout.
          keep.push({ ...entry, blocked_reason: started.blocked });
          continue;
        }
        if (started && 'session_id' in started) {
          sessionId = started.session_id;
          revision = started.revision;
        } else {
          // Null is a failure worth retrying; a refusal means the engine will
          // not open this session under today's inputs, which will not improve
          // by asking again today. Both are kept — the entry costs nothing and
          // tomorrow's inputs are different.
          keep.push({ ...entry, blocked_reason: null, attempts: entry.attempts + 1 });
          continue;
        }
      }

      const done = await completeSession(finishRequestFor(entry, sessionId, revision));

      if (done && 'blocked' in done) {
        keep.push({ ...entry, session_id: sessionId, revision, blocked_reason: done.blocked });
      } else if (done) {
        sent++;
      } else {
        // The session id is kept even though the finish failed: it was opened,
        // and re-opening it on the next pass would be a second row.
        keep.push({
          ...entry, session_id: sessionId, revision,
          // Cleared on any non-402 answer: whatever was blocking it is not
          // blocking it now, and the entry should age normally again.
          blocked_reason: null,
          attempts: entry.attempts + 1,
        });
      }
    }

    await persist(keep);
    return { sent, remaining: keep.length, blocked: blocked(keep).length };
  } finally {
    flushing = false;
  }
}

