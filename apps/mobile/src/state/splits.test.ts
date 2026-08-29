/**
 * Splits.
 *
 * The properties worth pinning down are the ones that decide whether a number
 * on the summary screen is trustworthy: that a lap is the time on that step and
 * nothing else, that cumulative time is the session's clock rather than a
 * running sum of something narrower, and that a step never reached leaves no
 * lap behind rather than a zero the athlete would read as "0:00 — instant".
 */
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { buildSplits, splitTotals, fastestAndSlowest } from './splits.ts';
import type { Step } from './steps.ts';

function step(over: Partial<Step> = {}): Step {
  return {
    kind: 'Work',
    qty: '800 m',
    label: 'Run',
    targetKey: 'Target RPE',
    target: '6',
    note: '',
    phase: 'ROUND 1 / 4',
    exercise_id: 'ex_run',
    duration_seconds: null,
    block_order: 0,
    round: 1,
    prescription_type: 'distance',
    quantity: 800,
    quantity_unit: 'm',
    rest: false,
    ...over,
  };
}

/** A round of 800 m + rest, four times — a session with comparable laps. */
const REPEATS: Step[] = [1, 2, 3, 4].flatMap(round => [
  step({ round, phase: `ROUND ${round} / 4` }),
  step({
    round, kind: 'Rest', label: 'Recover', qty: '0:60', exercise_id: '',
    rest: true, prescription_type: 'duration', quantity: 60, quantity_unit: 'seconds',
  }),
]);

describe('Splits', () => {
  test('a lap is the time on that step, and cumulative is the session clock', () => {
    const splits = buildSplits(REPEATS, [240, 60, 250, 60, 245, 60, 236, 60], 8);

    assert.deepEqual(splits.map(s => s.seconds), [240, 60, 250, 60, 245, 60, 236, 60]);
    assert.deepEqual(splits.map(s => s.cumulative_seconds),
      [240, 300, 550, 610, 855, 915, 1151, 1211]);
    // Cumulative is the sum of every lap, rest included — it is the clock the
    // athlete watched, not working time.
    assert.equal(splits[splits.length - 1].cumulative_seconds, 1211);
  });

  test('a step never reached leaves no lap, rather than a zero', () => {
    const splits = buildSplits(REPEATS, [240, 60, 250], 3);

    assert.equal(splits.length, 3, 'only what was completed');
    assert.ok(!splits.some(s => s.seconds === 0));
    assert.equal(splits[2].cumulative_seconds, 550);
  });

  test('the step under way is not a lap yet', () => {
    // Three completed, the fourth running: 42 seconds on the clock so far.
    const splits = buildSplits(REPEATS, [240, 60, 250, 42], 3);
    assert.equal(splits.length, 3);
    assert.ok(!splits.some(s => s.seconds === 42));
  });

  test('rest is a lap, and is kept apart from work in the totals', () => {
    const splits = buildSplits(REPEATS, [240, 60, 250, 60, 245, 60, 236, 60], 8);
    assert.equal(splits.filter(s => s.rest).length, 4);

    const totals = splitTotals(splits);
    assert.equal(totals.work, 971);
    assert.equal(totals.rest, 240);
    assert.equal(totals.total, 1211);
  });

  test('fastest and slowest compare only laps that prescribe the same thing', () => {
    const splits = buildSplits(REPEATS, [240, 60, 250, 60, 245, 60, 236, 60], 8);
    const { fastest, slowest } = fastestAndSlowest(splits);

    assert.equal(fastest, 6, 'the 236-second round is the quickest 800 m');
    assert.equal(slowest, 2, 'the 250-second round is the slowest');
    // Rest laps are 60 seconds each and must never win "fastest" against a run.
    assert.ok(!splits[fastest!].rest);
  });

  test('a session with nothing to compare marks nothing', () => {
    // A warm-up, a piece of work and a cool-down: three different prescriptions.
    const mixed: Step[] = [
      step({ kind: 'Warm-up', qty: '10 min', exercise_id: 'ex_run', prescription_type: 'duration' }),
      step({ qty: '20 reps', label: 'DB Thruster', exercise_id: 'ex_db_thruster', prescription_type: 'reps' }),
      step({ kind: 'Cooldown', qty: '5 min', prescription_type: 'duration' }),
    ];
    const { fastest, slowest } = fastestAndSlowest(buildSplits(mixed, [600, 90, 300], 3));

    assert.equal(fastest, null);
    assert.equal(slowest, null);
  });

  test('comparable laps that all took the same time have no fastest', () => {
    const { fastest, slowest } = fastestAndSlowest(
      buildSplits(REPEATS, [240, 60, 240, 60, 240, 60, 240, 60], 8));

    assert.equal(fastest, null);
    assert.equal(slowest, null);
  });

  test('a session that never started records nothing', () => {
    assert.deepEqual(buildSplits(REPEATS, [], 0), []);
    assert.deepEqual(splitTotals([]), { work: 0, rest: 0, total: 0 });
  });
});
