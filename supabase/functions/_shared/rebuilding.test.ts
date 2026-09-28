/**
 * The rebuilding ceiling.
 *
 * The rule under test: an athlete returning from injury is asked for less
 * without being recorded as less, and the constraint lifts on evidence rather
 * than on a clock.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  effectiveLoadCapacity, startingCeiling, progressionVerdict,
  EXPOSURES_TO_PROGRESS, DAYS_TO_PROGRESS, type ToleratedExposure,
} from './rebuilding.ts';

const NOW = new Date('2026-09-28T12:00:00Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

const exposure = (over: Partial<ToleratedExposure> = {}): ToleratedExposure => ({
  at: daysAgo(1), load_demand: 2, completed: true, ended_early: false, ...over,
});

describe('the ceiling', () => {
  test('starts one level below the athlete', () => {
    assert.equal(startingCeiling(4), 3);
    assert.equal(startingCeiling(2), 1);
  });

  test('never goes below 1', () => {
    // A capacity-1 athlete returning from injury has nowhere lower to go, and
    // a zero would mean a week with nothing in it.
    assert.equal(startingCeiling(1), 1);
  });

  test('constrains the stated capacity without replacing it', () => {
    assert.equal(effectiveLoadCapacity(4, 2), 2);
  });

  test('is ignored when it is above the athlete anyway', () => {
    assert.equal(effectiveLoadCapacity(2, 4), 2);
  });

  test('no rebuild means the stated capacity stands', () => {
    assert.equal(effectiveLoadCapacity(3, null), 3);
  });

  test('an unanswered capacity stays unanswered', () => {
    // Null is "not known" and must not become a number because a ceiling exists.
    assert.equal(effectiveLoadCapacity(null, 2), null);
  });
});

describe('when a step forward is offered', () => {
  const rebuilding = (over: Record<string, unknown> = {}) => progressionVerdict({
    loadCapacity: 4, ceiling: 2, ceilingSetAt: daysAgo(10),
    exposures: [exposure({ at: daysAgo(9) }), exposure({ at: daysAgo(2) })],
    now: NOW, ...over,
  });

  test('two tolerated exposures across a week qualifies', () => {
    const v = rebuilding();
    assert.equal(v.eligible, true);
    assert.equal(v.eligible && v.next_ceiling, 3);
    assert.equal(v.eligible && v.clears_rebuild, false);
  });

  test('reaching the stated capacity ends the rebuild', () => {
    const v = rebuilding({ loadCapacity: 3 });
    assert.equal(v.eligible, true);
    assert.equal(v.eligible && v.next_ceiling, 3);
    assert.equal(v.eligible && v.clears_rebuild, true);
  });

  test('one exposure is not enough', () => {
    const v = rebuilding({ exposures: [exposure({ at: daysAgo(9) })] });
    assert.equal(v.eligible, false);
    assert.equal(!v.eligible && v.reason, 'too_few');
  });

  test('two exposures in two days is not repeatability', () => {
    // The span rule exists for this: a body absorbing work is the claim, and
    // two sessions in a weekend does not demonstrate it.
    const v = rebuilding({
      ceilingSetAt: daysAgo(2),
      exposures: [exposure({ at: daysAgo(2) }), exposure({ at: daysAgo(1) })],
    });
    assert.equal(v.eligible, false);
    assert.equal(!v.eligible && v.reason, 'too_soon');
  });

  test('an abandoned session is not tolerated', () => {
    const v = rebuilding({
      exposures: [exposure({ at: daysAgo(9), completed: false }), exposure({ at: daysAgo(2) })],
    });
    assert.equal(!v.eligible && v.reason, 'too_few');
  });

  test('a session ended early is not tolerated', () => {
    // Finishing is what the word means. Stopping early is the athlete telling
    // us the dose was too much, which is the opposite of evidence to raise it.
    const v = rebuilding({
      exposures: [exposure({ at: daysAgo(9), ended_early: true }), exposure({ at: daysAgo(2) })],
    });
    assert.equal(!v.eligible && v.reason, 'too_few');
  });

  test('easier sessions do not count toward the ceiling they are below', () => {
    // The claim is that this athlete tolerated work AT the current level.
    const v = rebuilding({
      exposures: [exposure({ at: daysAgo(9), load_demand: 1 }), exposure({ at: daysAgo(2) })],
    });
    assert.equal(!v.eligible && v.reason, 'too_few');
  });

  test('an ungraded session cannot evidence a level', () => {
    const v = rebuilding({
      exposures: [exposure({ at: daysAgo(9), load_demand: null }), exposure({ at: daysAgo(2) })],
    });
    assert.equal(!v.eligible && v.reason, 'too_few');
  });

  test('an athlete not rebuilding is never offered a step', () => {
    assert.equal(rebuilding({ ceiling: null }).eligible, false);
    const v = progressionVerdict({
      loadCapacity: null, ceiling: 2, ceilingSetAt: daysAgo(10),
      exposures: [], now: NOW,
    });
    assert.equal(!v.eligible && v.reason, 'not_rebuilding');
  });

  test('a ceiling already at capacity reports itself, rather than stepping past', () => {
    const v = rebuilding({ loadCapacity: 2, ceiling: 2 });
    assert.equal(!v.eligible && v.reason, 'at_capacity');
  });

  test('the constants are the signed-off ones', () => {
    assert.equal(EXPOSURES_TO_PROGRESS, 2);
    assert.equal(DAYS_TO_PROGRESS, 7);
  });
});
