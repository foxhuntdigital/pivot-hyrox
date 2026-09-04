/**
 * What a persisted session is, and when it is still worth resuming.
 *
 * Split from `activeSession.ts` for the same reason the outbox's rules are:
 * the decisions here — is this record intelligible, is it recent enough to be
 * the session the athlete is still in — are the part worth testing, and they
 * should not need native storage to exercise.
 */
import type { VariantCode } from '@pivot/engine';
import type { SetEntries } from '@/state/actuals';

/**
 * Bumped whenever the shape below changes incompatibly. An unrecognised
 * version is discarded rather than guessed at: a half-read session is worse
 * than none, because it would put the athlete back into a workout whose steps
 * no longer line up with the numbers they typed.
 *
 * 2 — `client_session_id` (migration 0021). A version-1 record has no identity
 * for its session, so a restore from one could not name the session to the
 * server or recognise it coming back in the week. Discarding is the honest
 * answer: at most it costs an in-flight workout on the launch after an update,
 * and only for an athlete who was mid-session as it installed.
 */
export const SCHEMA_VERSION = 2;

/**
 * How long a stored session stays resumable.
 *
 * The same twelve hours `start-workout` allows its resume branch, and for the
 * same reason: longer than any session, shorter than any gap between two. Past
 * it, this is not a session the athlete is still in — it is one the app never
 * saw the end of, and offering to resume it a day later would be offering to
 * continue a workout they finished, abandoned, or forgot.
 */
export const RESUMABLE_HOURS = 12;

/**
 * The statuses a session can be persisted in.
 *
 * Deliberately narrower than the reducer's `WorkoutStatus`. `ready` means there
 * is nothing to store, and `completed`/`abandoned` are decided — a record in
 * either state is a record that should have been cleared.
 */
export type ActiveStatus = 'active_block' | 'paused' | 'completed_pending_review';

/**
 * A workout in progress, as it survives the process.
 *
 * Everything here is what the player measured or the athlete typed. The
 * prescription is not stored: it is rebuilt from `template_id` and `variant`
 * through the same engine that built it the first time, so a restored session
 * cannot disagree with the library about what its own steps are.
 */
export interface ActiveSessionRecord {
  version: number;
  /** What is being performed. Pins the restored player to this, not to whatever the plan now recommends. */
  template_id: string;
  variant: VariantCode;
  name: string;
  estimated_minutes: number;

  status: ActiveStatus;
  step_index: number;
  elapsed_seconds: number;
  step_seconds: number[];
  entries: SetEntries;
  session_rpe: number | null;
  ended_early: boolean;

  /** The server's row, when Start reached it. Null when it did not. */
  session_id: string | null;
  session_revision: number;
  /**
   * The session's own identity, minted when the player opened. Unlike
   * `session_id` this is never null for a live session, which is what lets a
   * restored offline workout still be named to the server.
   */
  client_session_id: string;
  /**
   * The id every finish for this session carries, minted once when the player
   * opened. Stored because it is what makes the finish written at the last step
   * and the finish written after the review the *same* event rather than two.
   */
  finish_event_id: string;

  /** The athlete's own day, for filing the finish. */
  local_date: string;
  started_at: string;
  /** When this record was last written. Staleness is measured from here. */
  saved_at: string;
}

const STATUSES: ActiveStatus[] = ['active_block', 'paused', 'completed_pending_review'];

/**
 * Whether a value read back off disk is a session record at all.
 *
 * Checked field by field rather than trusted, because the alternative is
 * restoring a partially-written or hand-edited blob into the player and letting
 * it fail somewhere further in, where the failure looks like a bug in the
 * workout rather than in the storage.
 */
export function isRecord(value: unknown): value is ActiveSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ActiveSessionRecord>;
  return r.version === SCHEMA_VERSION
    && typeof r.template_id === 'string' && r.template_id.length > 0
    && typeof r.variant === 'string'
    && typeof r.name === 'string'
    && typeof r.finish_event_id === 'string' && r.finish_event_id.length > 0
    && typeof r.client_session_id === 'string' && r.client_session_id.length > 0
    && typeof r.step_index === 'number' && Number.isFinite(r.step_index) && r.step_index >= 0
    && typeof r.elapsed_seconds === 'number' && Number.isFinite(r.elapsed_seconds)
    && Array.isArray(r.step_seconds)
    && typeof r.saved_at === 'string'
    && STATUSES.includes(r.status as ActiveStatus);
}

/** What to do with a record found on launch. */
export type Verdict = 'resume' | 'discard';

/**
 * Whether this record is still the session the athlete is in.
 *
 * Note what `discard` does *not* mean: it never means the training is lost. A
 * session that reached `completed_pending_review` has already written its
 * finish to the outbox, which is durable on its own and replays independently
 * of this record. This decides only whether to put the athlete back into the
 * player.
 */
export function verdictFor(record: unknown, now: number): Verdict {
  if (!isRecord(record)) return 'discard';
  const saved = Date.parse(record.saved_at);
  if (!Number.isFinite(saved)) return 'discard';
  // A clock that has moved backwards — a timezone change, a manual set — reads
  // as a negative age. Treat it as fresh: the record is recent by every other
  // measure, and discarding real work over a clock adjustment is the worse error.
  const age = now - saved;
  return age > RESUMABLE_HOURS * 3_600_000 ? 'discard' : 'resume';
}
