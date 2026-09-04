/**
 * The stored session's rules.
 *
 * What is under test is what the app is allowed to believe about a record it
 * found on disk: that it is a session record at all, and that it is recent
 * enough to still be the one the athlete is in.
 *
 * The bug this record exists for: the player's entire state — the step reached,
 * the clock, every load and rep typed — lived in a reducer, so a backgrounded
 * app reclaimed mid-workout lost all of it, silently, with the UI having
 * already told the athlete the session was under way.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isRecord, verdictFor, RESUMABLE_HOURS, SCHEMA_VERSION,
  type ActiveSessionRecord,
} from './activeSessionRules.ts';

const NOW = Date.parse('2026-09-03T18:00:00.000Z');

function record(over: Partial<ActiveSessionRecord> = {}): ActiveSessionRecord {
  return {
    version: SCHEMA_VERSION,
    template_id: 'wo_long_hybrid_75',
    variant: 'green',
    name: 'Long Hybrid 75',
    estimated_minutes: 75,
    status: 'active_block',
    step_index: 6,
    elapsed_seconds: 1458,
    step_seconds: [180, 240, 190, 260, 210, 200, 178],
    entries: { 3: { weight: 24, reps: 12, unit: 'kg' } },
    session_rpe: null,
    ended_early: false,
    session_id: 'sess_1',
    session_revision: 0,
    finish_event_id: 'evt_abc',
    client_session_id: '9f1c2a44-0b8e-4d63-9a71-2e5c8b0d4417',
    local_date: '2026-09-03',
    started_at: '2026-09-03T17:35:00.000Z',
    saved_at: '2026-09-03T17:59:30.000Z',
    ...over,
  };
}

describe('reading a stored session back', () => {
  test('a well-formed record is recognised', () => {
    assert.equal(isRecord(record()), true);
  });

  test('a record from a future schema is not guessed at', () => {
    assert.equal(isRecord(record({ version: SCHEMA_VERSION + 1 })), false);
  });

  test('junk is not a record', () => {
    for (const junk of [null, undefined, 0, '', 'active', [], {}]) {
      assert.equal(isRecord(junk), false, `${JSON.stringify(junk)} should not read as a record`);
    }
  });

  test('a decided status is not an active session', () => {
    // 'ready' means nothing was running; 'completed' and 'abandoned' mean the
    // record should have been cleared. Restoring either puts the athlete back
    // into a session that is over.
    for (const status of ['ready', 'completed', 'abandoned']) {
      assert.equal(isRecord(record({ status: status as never })), false, status);
    }
  });

  test('a record with no session identity is rejected', () => {
    // Without it a restored session cannot be named to the server, which is the
    // whole reason the id is minted on the device rather than granted by Start.
    assert.equal(isRecord(record({ client_session_id: '' })), false);
  });

  test('a record missing the finish id is rejected', () => {
    // Without it the finish written at the last step and the finish written
    // after the review are two events, and the server counts two workouts.
    assert.equal(isRecord(record({ finish_event_id: '' })), false);
  });

  test('a truncated write is rejected rather than half-restored', () => {
    const partial = { ...record() } as Partial<ActiveSessionRecord>;
    delete partial.step_seconds;
    assert.equal(isRecord(partial), false);
  });
});

describe('deciding whether to resume', () => {
  test('a session saved moments ago resumes', () => {
    assert.equal(verdictFor(record(), NOW), 'resume');
  });

  test('a session inside the window resumes', () => {
    const saved = new Date(NOW - (RESUMABLE_HOURS - 1) * 3_600_000).toISOString();
    assert.equal(verdictFor(record({ saved_at: saved }), NOW), 'resume');
  });

  test('a session past the window is not offered back', () => {
    // Twelve hours on, this is not a workout in progress — it is one the app
    // never saw the end of, and resuming it would be resuming yesterday.
    const saved = new Date(NOW - (RESUMABLE_HOURS + 1) * 3_600_000).toISOString();
    assert.equal(verdictFor(record({ saved_at: saved }), NOW), 'discard');
  });

  test('a clock that moved backwards does not discard real work', () => {
    // A timezone change or a manually set clock reads as a negative age. The
    // record is recent by every other measure; losing a session to it would be
    // the worse error.
    const saved = new Date(NOW + 3_600_000).toISOString();
    assert.equal(verdictFor(record({ saved_at: saved }), NOW), 'resume');
  });

  test('an unreadable timestamp discards', () => {
    assert.equal(verdictFor(record({ saved_at: 'not a date' }), NOW), 'discard');
  });

  test('anything that is not a record discards', () => {
    assert.equal(verdictFor({ version: 99 }, NOW), 'discard');
    assert.equal(verdictFor(null, NOW), 'discard');
  });
});
