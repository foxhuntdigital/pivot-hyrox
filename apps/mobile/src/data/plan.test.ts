/**
 * What the week is allowed to claim the athlete has done.
 *
 * The rule under test: a session is counted once and attributed to itself. The
 * app credits a finish locally so the counters move before the refetch lands,
 * and that optimism has to expire the instant the server's week contains the
 * same session — otherwise one workout is counted twice and the tick migrates
 * onto whatever the engine recommends next.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { planView, type FinishedHere } from './plan.ts';
import type { TodayPayload } from './todayRepo.ts';

function payload(over: Partial<TodayPayload> = {}): TodayPayload {
  return {
    date_local: '2026-08-25',
    active_race: null,
    phase: null,
    week: { start_date: null, end_date: null, queue: [], completed: [] },
    training_7d: { sessions: 0, minutes: 0 },
    comparable_runs: null,
    recovery: null,
    readiness: {
      overall: null, confidence: 'low', components: {}, model_version: 'test',
    },
    recommendation: null,
    no_session: null,
    stimulus_requirements: [],
    recent_sessions: [],
    engine_version: 'test',
    ...over,
  } as TodayPayload;
}

/**
 * A finished session as the week reports it.
 *
 * `client_session_id` carries the same value as the row id here, because that
 * is what the matching is now done on: the device's own id for the session, not
 * the server's. The two are the same string in these fixtures only to keep the
 * tests readable.
 */
const completed = (session_id: string, client_session_id: string | null = session_id) => ({
  session_id,
  client_session_id,
  template_id: 'tpl_hybrid',
  name: 'Long Hybrid 60',
  stimulus: 'aerobic_durability',
  estimated_minutes: 39,
  variant: 'yellow',
  session_rpe: 7,
  ended_early: false,
  completed_on: '2026-08-25',
});

/** A finish made on this device. Defaults to the fixture payload's own day. */
const here = (client_session_id: string, on = '2026-08-25'): FinishedHere =>
  ({ client_session_id, on });

const week = (done: number) => [
  { stimulus_type: 'aerobic_durability', target_exposures: 7, completed_exposures: done, priority: 1 },
] as TodayPayload['stimulus_requirements'];

describe('The week as Plan counts it', () => {
  test('a finish counts immediately, before the server has heard about it', () => {
    const v = planView(payload({ stimulus_requirements: week(0) }), here('sess_1'));
    assert.equal(v.week.done, 1, 'the counter must move without waiting for a refetch');
    assert.equal(v.pendingCompletion, true);
  });

  test('the same session is not counted twice once the refetch lands', () => {
    const v = planView(
      payload({
        stimulus_requirements: week(1),
        week: { start_date: null, end_date: null, queue: [], completed: [completed('sess_1')] },
      }),
      here('sess_1'),
    );
    assert.equal(v.week.done, 1, 'one workout, counted once');
    assert.equal(v.pendingCompletion, false, 'the local credit has been superseded');
  });

  test('a session finished offline still retires its own credit', () => {
    /**
     * The case that could not work before. Started with no connection, so Start
     * never answered and there was no server id to hold — which meant the match
     * could not succeed at any point, the bump never expired, and the week read
     * one workout as two for as long as the app stayed open.
     *
     * The device minted the id itself, so the session the outbox eventually
     * opened comes back carrying it and is recognised.
     */
    const v = planView(
      payload({
        stimulus_requirements: week(1),
        week: {
          start_date: null, end_date: null, queue: [],
          // A different server id — the outbox opened this row long after the
          // workout — but the athlete's own id for the session is unchanged.
          completed: [completed('sess_opened_later', 'client_abc')],
        },
      }),
      here('client_abc'),
    );
    assert.equal(v.week.done, 1, 'one workout, counted once');
    assert.equal(v.pendingCompletion, false);
  });

  test('a session recorded before client ids existed retires nothing', () => {
    // Rows written before migration 0021 carry a null. One must never answer to
    // a finish this device is holding, or the first old session in the week
    // would retire the credit for whatever was just completed.
    const v = planView(
      payload({
        stimulus_requirements: week(0),
        week: {
          start_date: null, end_date: null, queue: [],
          completed: [completed('sess_legacy', null)],
        },
      }),
      here('client_abc'),
    );
    assert.equal(v.pendingCompletion, true, 'the legacy row is not this finish');
    assert.equal(v.week.done, 1);
  });

  test('a finish does not follow the athlete into the next week', () => {
    /**
     * The rollover. `serverHasIt` retires the marker by finding the session in
     * `week.completed` — and a new week's list is empty, so the match failed
     * again for a session that had landed perfectly well days earlier. The
     * credit came back, in a week the work was not done in, named as though it
     * had just been finished.
     *
     * The marker is a claim about a day. Monday does not inherit it.
     */
    const v = planView(
      payload({
        date_local: '2026-08-31',
        stimulus_requirements: week(0),
        week: { start_date: null, end_date: null, queue: [], completed: [] },
      }),
      here('sess_1', '2026-08-25'),
    );
    assert.equal(v.pendingCompletion, false, 'last week\'s finish is not this week\'s');
    assert.equal(v.week.done, 0, 'the new week starts where it should');
    assert.equal(v.pendingSession, null, 'and nothing is named');
  });

  test('a finish made today survives a payload that has not caught up', () => {
    // The window the marker exists for: sent, dropped from the queue, and the
    // refetch still in flight. Same day, absent from the week — still counted.
    const v = planView(
      payload({ date_local: '2026-08-25', stimulus_requirements: week(0) }),
      here('sess_1', '2026-08-25'),
    );
    assert.equal(v.pendingCompletion, true);
    assert.equal(v.week.done, 1);
  });

  test("another athlete's session in the week does not retire this one's credit", () => {
    const v = planView(
      payload({
        stimulus_requirements: week(1),
        week: { start_date: null, end_date: null, queue: [], completed: [completed('sess_earlier')] },
      }),
      here('sess_1'),
    );
    assert.equal(v.pendingCompletion, true, 'a different session id is not this finish');
    assert.equal(v.week.done, 2, 'two distinct sessions are two exposures');
  });

  test('an unrecorded finish keeps its credit — offline is not undone', () => {
    /**
     * The write never reached the server, or there is no server.
     *
     * This case used to be expressed as "finished, but with no id to match on",
     * and that state no longer exists: since migration 0021 the device mints the
     * session's id itself, before Start is sent, so an offline finish is as
     * identifiable as any other. What is absent here is the server's week, not
     * the session's name.
     */
    const v = planView(payload({ stimulus_requirements: week(0) }), here('client_abc'));
    assert.equal(v.pendingCompletion, true);
    assert.equal(v.week.done, 1);
  });

  test('no finish claims nothing', () => {
    const v = planView(payload({ stimulus_requirements: week(0) }), null);
    assert.equal(v.week.done, 0);
    assert.equal(v.pendingCompletion, false);
  });

  test("only today's finishes count as today's", () => {
    const v = planView(
      payload({
        date_local: '2026-08-25',
        stimulus_requirements: week(2),
        week: {
          start_date: null, end_date: null, queue: [],
          completed: [
            { ...completed('sess_today'), completed_on: '2026-08-25' },
            { ...completed('sess_yesterday'), completed_on: '2026-08-24' },
          ],
        },
      }),
      false,
      null,
    );
    assert.deepEqual(
      v.week.completedToday.map(c => c.session_id), ['sess_today'],
      "yesterday's session must not make today look finished");
  });

  test('the count never exceeds what the week asked for', () => {
    const v = planView(payload({ stimulus_requirements: week(7) }), here('sess_1'));
    assert.equal(v.week.done, 7);
  });
});

/**
 * Naming the finished session.
 *
 * The screens used to read the name off the engine's current decision, which
 * is only the finished session until the moment it is finished: the override
 * that chose it is spent on the way out of the player, and the engine's next
 * answer is a different workout. An athlete who trained a session Coach built
 * for them was shown the plan's assigned workout, ticked and dated today.
 */
describe('What the pending finish is called', () => {
  const performed = {
    template_id: 'wo_strength_45',
    name: 'Strength 45',
    estimated_minutes: 45,
  };

  test('the session that was performed is the session that is named', () => {
    const v = planView(
      payload({ stimulus_requirements: week(0) }), here('sess_1'), performed);
    assert.deepEqual(v.pendingSession, performed);
  });

  test('nothing is named once the server has the session', () => {
    // The server's own row is the better answer from here, and this one is a
    // stale copy that would keep a finished session on screen as pending.
    const v = planView(
      payload({
        stimulus_requirements: week(1),
        week: { start_date: null, end_date: null, queue: [], completed: [completed('sess_1')] },
      }),
      true, 'sess_1', performed);
    assert.equal(v.pendingCompletion, false);
    assert.equal(v.pendingSession, null);
  });

  test('nothing is named when nothing was finished here', () => {
    const v = planView(
      payload({ stimulus_requirements: week(0) }), null, performed);
    assert.equal(v.pendingSession, null);
  });

  test('an unknown session is a missing name, not a wrong one', () => {
    const v = planView(payload({ stimulus_requirements: week(0) }), here('sess_1'));
    assert.equal(v.pendingCompletion, true);
    assert.equal(v.pendingSession, null);
  });

  test('a plan that has not loaded still names what was performed', () => {
    assert.deepEqual(planView(null, here('sess_1'), performed).pendingSession, performed);
  });
});
