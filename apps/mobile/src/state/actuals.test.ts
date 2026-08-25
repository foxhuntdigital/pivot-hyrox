/**
 * What the player is allowed to claim the athlete did.
 *
 * The rule under test throughout: a completed step asserts its own
 * prescription and nothing more. Steps never reached are absent rather than
 * zeroed, rest is never work, and no number is inferred that the player did not
 * either measure or have prescribed to it — load above all, which nothing here
 * knows.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLogs } from './actuals.ts';
import type { Step } from './steps.ts';

const AT = new Date('2026-03-01T10:00:00.000Z');

function step(over: Partial<Step> = {}): Step {
  return {
    kind: 'Work',
    qty: '10 reps',
    label: 'Back Squat',
    targetKey: 'Target RPE',
    target: '7',
    note: '',
    phase: 'ROUND 1 / 1',
    exercise_id: 'ex_back_squat',
    duration_seconds: null,
    block_order: 0,
    round: 1,
    prescription_type: 'reps',
    quantity: 10,
    quantity_unit: 'reps',
    rest: false,
    ...over,
  };
}

describe('Session actuals', () => {
  test('a completed set logs its prescription as performed', () => {
    const logs = buildLogs([step()], [40], 1, AT);
    assert.equal(logs.set_logs.length, 1);
    assert.deepEqual(
      { reps: logs.set_logs[0].actual_reps, prescribed: logs.set_logs[0].prescribed_reps },
      { reps: 10, prescribed: 10 },
    );
  });

  test('a step never reached is absent, not a zero', () => {
    const steps = [step(), step({ quantity: 8 })];
    const logs = buildLogs(steps, [40, 0], 1, AT);
    assert.equal(logs.set_logs.length, 1, 'only the step the athlete reached');
    assert.equal(logs.set_logs[0].actual_reps, 10);
  });

  test('load is never inferred', () => {
    const logs = buildLogs([step()], [40], 1, AT);
    // The player does not know what was on the bar, and a set log that guessed
    // would be indistinguishable from one that measured.
    assert.equal('actual_load' in logs.set_logs[0], false);
  });

  test('set_index is unique per block, not per round', () => {
    // Three exercises across two rounds of one block: the table is unique on
    // (session_block_id, set_index), so a round-numbered index would collide.
    const steps = [
      step({ round: 1, exercise_id: 'ex_a' }),
      step({ round: 1, exercise_id: 'ex_b' }),
      step({ round: 2, exercise_id: 'ex_a' }),
      step({ round: 2, exercise_id: 'ex_b' }),
    ];
    const logs = buildLogs(steps, [30, 30, 30, 30], 4, AT);
    assert.deepEqual(logs.set_logs.map(l => l.set_index), [0, 1, 2, 3]);
  });

  test('a prescribed distance plus a measured clock is a real pace', () => {
    const logs = buildLogs(
      [step({ prescription_type: 'distance', quantity: 1, quantity_unit: 'km',
        exercise_id: 'ex_run' })],
      [258], 1, AT,
    );
    assert.equal(logs.cardio_logs.length, 1);
    assert.deepEqual(
      { m: logs.cardio_logs[0].distance_meters, s: logs.cardio_logs[0].duration_seconds },
      { m: 1000, s: 258 },
    );
  });

  test('metres are recorded as metres however the block was authored', () => {
    const logs = buildLogs(
      [step({ prescription_type: 'distance', quantity: 500, quantity_unit: 'm',
        exercise_id: 'ex_row' })],
      [100], 1, AT,
    );
    assert.equal(logs.cardio_logs[0].distance_meters, 500);
  });

  test('a timed effort logs no distance rather than an estimated one', () => {
    const logs = buildLogs(
      [step({ prescription_type: 'duration', quantity: 30, quantity_unit: 'min',
        exercise_id: 'ex_run', duration_seconds: 1800 })],
      [1795], 1, AT,
    );
    assert.equal(logs.cardio_logs[0].distance_meters, null,
      'no distance means it can never enter a pace claim');
    assert.equal(logs.cardio_logs[0].duration_seconds, 1795, 'the clock, not the prescription');
  });

  test('rest is structure, not work', () => {
    const steps = [step(), step({ rest: true, exercise_id: '', prescription_type: 'duration' })];
    const logs = buildLogs(steps, [40, 60], 2, AT);
    assert.equal(logs.set_logs.length, 1);
    assert.equal(logs.cardio_logs.length, 0);
    assert.equal(logs.blocks[0].actual_json.steps_prescribed, 1, 'rest is not a prescribed step');
    assert.equal(logs.blocks[0].actual_json.seconds, 100, 'but its time belongs to the block');
  });

  test('a block the athlete never started is marked skipped', () => {
    const steps = [step({ block_order: 0 }), step({ block_order: 1 })];
    const logs = buildLogs(steps, [40, 0], 1, AT);
    const [first, second] = logs.blocks;
    assert.equal(first.skipped, false);
    assert.equal(second.skipped, true);
    assert.equal(second.completed_at, undefined, 'nothing finished, so no finish time');
  });

  test('rounds completed is how far they got, not how many were asked for', () => {
    const steps = [
      step({ round: 1 }), step({ round: 2 }), step({ round: 3 }),
    ];
    const logs = buildLogs(steps, [30, 30, 0], 2, AT);
    assert.equal(logs.blocks[0].actual_json.rounds_completed, 2);
    assert.equal(logs.blocks[0].actual_json.steps_prescribed, 3);
    assert.equal(logs.blocks[0].actual_json.steps_completed, 2);
  });

  test('a session ended before anything finished logs nothing', () => {
    const logs = buildLogs([step(), step()], [12, 0], 0, AT);
    assert.equal(logs.set_logs.length, 0);
    assert.equal(logs.cardio_logs.length, 0);
    assert.ok(logs.blocks.every(b => b.skipped), 'and claims no block was performed');
  });
});
