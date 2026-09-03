/**
 * The finish queue's rules.
 *
 * What is under test is the part that decides: what replaces what, what is
 * given up on, and what revision a retry carries. The storage and the network
 * around it are thin by design so that these can be exercised without either.
 *
 * The bug this queue exists for: a finished workout that reached no server —
 * because Start had failed, or the finish did — was held only in a reducer
 * flag, and came back after a restart as a workout that never happened.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  expired, finishRequestFor, hasPendingFinishOn, mergeQueued, pendingFinishOn,
  type PendingFinish,
} from './outboxRules.ts';

function entry(over: Partial<PendingFinish> = {}): PendingFinish {
  return {
    client_event_id: 'evt_1',
    local_date: '2026-08-28',
    template_id: 'wo_long_hybrid_75',
    name: 'Long Hybrid 75',
    session_id: 'sess_1',
    revision: 0,
    start: { template_id: 'wo_long_hybrid_75' },
    finish: { session_rpe: 7, ended_early: false },
    attempts: 0,
    queued_at: '2026-08-28T17:10:00.000Z',
    ...over,
  };
}

describe('mergeQueued', () => {
  test('a finish is queued', () => {
    assert.equal(mergeQueued([], entry()).length, 1);
  });

  test('re-finishing the same session replaces its entry', () => {
    // Two entries would be two attempts to record one workout.
    const queued = mergeQueued([entry()], entry({ client_event_id: 'evt_2' }));
    assert.equal(queued.length, 1);
    assert.equal(queued[0].client_event_id, 'evt_2');
  });

  test('a resend of the same event replaces its entry', () => {
    const queued = mergeQueued([entry()], entry({ session_id: null }));
    assert.equal(queued.length, 1);
  });

  test('a finish with no session id does not collide with another', () => {
    // Both failed to open a session. They are still two different workouts and
    // must both survive to be retried.
    const a = entry({ client_event_id: 'evt_a', session_id: null });
    const b = entry({ client_event_id: 'evt_b', session_id: null });
    assert.equal(mergeQueued([a], b).length, 2);
  });

  test('different sessions both stay queued', () => {
    const a = entry({ client_event_id: 'evt_a', session_id: 'sess_a' });
    const b = entry({ client_event_id: 'evt_b', session_id: 'sess_b' });
    assert.equal(mergeQueued([a], b).length, 2);
  });

  test('the queue is bounded', () => {
    let queued: PendingFinish[] = [];
    for (let i = 0; i < 80; i++) {
      queued = mergeQueued(queued, entry({
        client_event_id: `evt_${i}`, session_id: `sess_${i}`,
      }));
    }
    assert.ok(queued.length <= 50, `queue grew to ${queued.length}`);
    // The newest survive: an old finish matters less than a recent one.
    assert.equal(queued[queued.length - 1].client_event_id, 'evt_79');
  });
});

describe('expired', () => {
  const queued = Date.parse('2026-08-28T17:10:00.000Z');

  test('a fresh finish is kept', () => {
    assert.equal(expired(entry(), queued + 60_000), false);
  });

  test('a finish is still retried a week later', () => {
    // The connection may have been broken the whole time. A week is not a
    // reason to throw away a workout the athlete actually did.
    assert.equal(expired(entry(), queued + 7 * 86_400_000), false);
  });

  test('a finish is given up on after a month', () => {
    assert.equal(expired(entry(), queued + 31 * 86_400_000), true);
  });

  test('an unparseable timestamp is not treated as expired', () => {
    // Losing a finish to a malformed date would be the same bug again.
    assert.equal(expired(entry({ queued_at: 'not a date' }), queued), false);
  });
});

describe('finishRequestFor', () => {
  test('the revision advances past the one Start returned', () => {
    // At or below the stored revision the server reads a replay and does
    // nothing, so a first attempt has to clear it.
    const req = finishRequestFor(entry(), 'sess_1', 0);
    assert.equal(req.revision, 1);
    assert.equal(req.session_id, 'sess_1');
  });

  test('the event id is the one it was queued with, not a new one', () => {
    // This is what makes a retry idempotent rather than a second workout.
    const e = entry({ client_event_id: 'evt_original' });
    assert.equal(finishRequestFor(e, 'sess_1', 3).client_event_id, 'evt_original');
    assert.equal(finishRequestFor(e, 'sess_1', 3).revision, 4);
  });

  test('what was performed travels with the retry', () => {
    const e = entry({ finish: { session_rpe: 9, ended_early: true } });
    const req = finishRequestFor(e, 'sess_1', 0);
    assert.equal(req.session_rpe, 9);
    assert.equal(req.ended_early, true);
  });
});

describe('hasPendingFinishOn', () => {
  test("a queued finish counts as today's completion", () => {
    // The reducer flag dies with the process; this is what replaces it, and it
    // is the answer to "why did my completed workout come back as undone".
    assert.equal(hasPendingFinishOn([entry()], '2026-08-28'), true);
  });

  test('a finish from another day does not', () => {
    assert.equal(hasPendingFinishOn([entry()], '2026-08-29'), false);
  });

  test('an empty queue claims nothing', () => {
    assert.equal(hasPendingFinishOn([], '2026-08-28'), false);
  });
});

describe('pendingFinishOn', () => {
  test('the queued finish is the one the screens can name', () => {
    // Why it returns the entry and not a boolean: after a restart this is the
    // only surviving record of which workout was performed, and Today and Plan
    // have to print its name rather than the engine's next recommendation.
    const found = pendingFinishOn([entry()], '2026-08-28');
    assert.equal(found?.name, 'Long Hybrid 75');
  });

  test('two sessions in one day resolve to the one just finished', () => {
    const found = pendingFinishOn(
      [entry(), entry({ client_event_id: 'evt_2', name: 'Strength 45' })],
      '2026-08-28');
    assert.equal(found?.name, 'Strength 45');
  });

  test('a finish from another day is not today\'s', () => {
    assert.equal(pendingFinishOn([entry()], '2026-08-29'), null);
  });
});
