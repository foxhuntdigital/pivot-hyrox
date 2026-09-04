/**
 * The workout in progress, on disk.
 *
 * The active session lived in a `useReducer` and nowhere else, which made the
 * player's whole record — the step reached, the clock, the per-step seconds,
 * every load and rep the athlete typed — volatile for the entire length of a
 * workout. A backgrounded app reclaimed by the OS, a crash, a force-quit: all
 * of it gone, with a server row left open behind it and nothing anywhere that
 * knew a session had been running.
 *
 * This is the missing half of the outbox. The outbox makes a *finished* workout
 * durable; this makes an *unfinished* one durable, so the two together mean no
 * point in a session is held only in memory.
 *
 * Writes are best-effort and never block the player. A failed write costs the
 * ability to resume, never the workout the athlete is currently doing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isRecord, type ActiveSessionRecord } from './activeSessionRules';

export {
  RESUMABLE_HOURS, SCHEMA_VERSION, isRecord, verdictFor,
  type ActiveSessionRecord, type ActiveStatus, type Verdict,
} from './activeSessionRules';

const KEY = 'pivot.session.active.v1';

/**
 * Reads the stored session, or null when there is none to read.
 *
 * Anything unintelligible answers null and is left on disk rather than
 * deleted. The outbox learned this the hard way: it cleared its cache on a
 * parse failure and then persisted the empty result, so one malformed byte
 * destroyed the queue permanently. Leaving the blob alone costs nothing — the
 * next successful write replaces it — and keeps a recoverable file recoverable.
 */
export async function loadActiveSession(): Promise<ActiveSessionRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes the session as it currently stands, replacing whatever was there. */
export async function saveActiveSession(record: ActiveSessionRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage full, or unavailable. The session keeps running from memory; only
    // the ability to survive the process is lost, and saying so to the athlete
    // mid-workout would be an interruption they can do nothing with.
  }
}

/**
 * Forgets the stored session.
 *
 * Called when a session is finished or discarded — both of which are decisions,
 * after which resuming would offer to continue something that is over.
 */
export async function clearActiveSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // A record that outlives its session is retired by `verdictFor` twelve
    // hours later, so a failure here delays the tidy-up rather than breaking it.
  }
}
