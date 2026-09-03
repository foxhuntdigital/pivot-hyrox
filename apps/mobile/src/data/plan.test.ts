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

import { planView } from './plan.ts';
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

const completed = (session_id: string) => ({
  session_id,
  template_id: 'tpl_hybrid',
  name: 'Long Hybrid 60',
  stimulus: 'aerobic_durability',
  estimated_minutes: 39,
  variant: 'yellow',
  session_rpe: 7,
  ended_early: false,
  completed_on: '2026-08-25',
});

const week = (done: number) => [
  { stimulus_type: 'aerobic_durability', target_exposures: 7, completed_exposures: done, priority: 1 },
] as TodayPayload['stimulus_requirements'];

describe('The week as Plan counts it', () => {
  test('a finish counts immediately, before the server has heard about it', () => {
    const v = planView(payload({ stimulus_requirements: week(0) }), true, 'sess_1');
    assert.equal(v.week.done, 1, 'the counter must move without waiting for a refetch');
    assert.equal(v.pendingCompletion, true);
  });

  test('the same session is not counted twice once the refetch lands', () => {
    const v = planView(
      payload({
        stimulus_requirements: week(1),
        week: { start_date: null, end_date: null, queue: [], completed: [completed('sess_1')] },
      }),
      true,
      'sess_1',
    );
    assert.equal(v.week.done, 1, 'one workout, counted once');
    assert.equal(v.pendingCompletion, false, 'the local credit has been superseded');
  });

  test("another athlete's session in the week does not retire this one's credit", () => {
    const v = planView(
      payload({
        stimulus_requirements: week(1),
        week: { start_date: null, end_date: null, queue: [], completed: [completed('sess_earlier')] },
      }),
      true,
      'sess_1',
    );
    assert.equal(v.pendingCompletion, true, 'a different session id is not this finish');
    assert.equal(v.week.done, 2, 'two distinct sessions are two exposures');
  });

  test('an unrecorded finish keeps its credit — offline is not undone', () => {
    // No session id: the write never reached the server, or there is no server.
    const v = planView(payload({ stimulus_requirements: week(0) }), true, null);
    assert.equal(v.pendingCompletion, true);
    assert.equal(v.week.done, 1);
  });

  test('no finish claims nothing', () => {
    const v = planView(payload({ stimulus_requirements: week(0) }), false, null);
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
    const v = planView(payload({ stimulus_requirements: week(7) }), true, 'sess_1');
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
      payload({ stimulus_requirements: week(0) }), true, 'sess_1', performed);
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
      payload({ stimulus_requirements: week(0) }), false, null, performed);
    assert.equal(v.pendingSession, null);
  });

  test('an unknown session is a missing name, not a wrong one', () => {
    const v = planView(payload({ stimulus_requirements: week(0) }), true, 'sess_1');
    assert.equal(v.pendingCompletion, true);
    assert.equal(v.pendingSession, null);
  });

  test('a plan that has not loaded still names what was performed', () => {
    assert.deepEqual(planView(null, true, 'sess_1', performed).pendingSession, performed);
  });
});
