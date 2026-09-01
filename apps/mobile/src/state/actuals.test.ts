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
    // The player does not know what was on the bar unless it was told, and a
    // set log that guessed would be indistinguishable from one that measured.
    // The row now carries the field explicitly as null and marks itself
    // `asserted`, which says the same thing louder than an absent key did.
    assert.equal(logs.set_logs[0].actual_load, null);
    assert.equal(logs.set_logs[0].source, 'asserted');
  });

  test('an asserted row is marked as one, so no trend can read it as evidence', () => {
    // A Complete tap cannot show a miss: it restates the prescription. Every
    // set_log written before there was a way to ask is exactly this kind of
    // row, which is why migration 0012 defaults `source` to 'asserted'.
    const logs = buildLogs([step()], [40], 1, AT);
    assert.equal(logs.set_logs[0].source, 'asserted');
    assert.equal(logs.set_logs[0].actual_reps, logs.set_logs[0].prescribed_reps);
  });

  test('what the athlete typed is recorded, and marked as theirs', () => {
    const s = step({
      prescription_type: 'sets_reps', set_number: 1, set_count: 4,
      prescribed_reps_min: 6, prescribed_reps_max: 6, target_rpe: 7, quantity: 4,
    });
    const logs = buildLogs([s], [40], 1, AT, { 0: { weight: 135, reps: 5, rpe: 8, unit: 'lb' } });

    const [log] = logs.set_logs;
    assert.equal(log.actual_load, 135);
    assert.equal(log.load_unit, 'lb');
    assert.equal(log.rpe, 8);
    assert.equal(log.source, 'manual');
    // The miss is the whole point: six were asked for and five were done, and
    // an asserted row could never have said so.
    assert.equal(log.prescribed_reps, 6);
    assert.equal(log.actual_reps, 5);
  });

  test('a structured set logs the rep target, never the set count', () => {
    // The bug this replaced: `quantity` on a sets x reps row is the number of
    // SETS, and logging it as prescribed_reps made every set of six read as
    // four reps.
    const s = step({
      prescription_type: 'sets_reps', quantity: 4, quantity_unit: 'x6',
      set_number: 2, set_count: 4, prescribed_reps_min: 6, prescribed_reps_max: 6,
    });
    const [log] = buildLogs([s], [40], 1, AT).set_logs;
    assert.equal(log.prescribed_reps, 6, 'six reps, not four sets');
    assert.equal(log.prescribed_reps_min, 6);
  });

  test('one field entered is enough to make the row the athlete\'s', () => {
    // Weight without reps, or an RPE on its own, is still something true that
    // the athlete reported. Requiring all three would throw it away.
    const s = step({ set_number: 1, set_count: 3, prescribed_reps_min: 10 });
    assert.equal(buildLogs([s], [40], 1, AT, { 0: { weight: 40 } }).set_logs[0].source, 'manual');
    assert.equal(buildLogs([s], [40], 1, AT, { 0: { rpe: 9 } }).set_logs[0].source, 'manual');
    assert.equal(buildLogs([s], [40], 1, AT, { 0: {} }).set_logs[0].source, 'asserted');
  });

  test('a nonsense entry is discarded rather than stored', () => {
    const s = step({ set_number: 1, set_count: 3, prescribed_reps_min: 10 });
    const bad = { 0: { weight: NaN, reps: -4, rpe: Infinity } } as any;
    const [log] = buildLogs([s], [40], 1, AT, bad).set_logs;
    assert.equal(log.actual_load, null);
    assert.equal(log.rpe, null);
    assert.equal(log.actual_reps, 10, 'falls back to the prescription');
    assert.equal(log.source, 'asserted');
  });

  test('an entry on a step the athlete never reached is not logged', () => {
    // Typing a weight into set 3 and then ending after set 1 must not create a
    // record of work that did not happen.
    const s = () => step({ set_number: 1, set_count: 3, prescribed_reps_min: 10 });
    const logs = buildLogs([s(), s(), s()], [40, 0, 0], 1, AT, { 2: { weight: 100 } });
    assert.equal(logs.set_logs.length, 1);
    assert.equal(logs.set_logs[0].actual_load, null);
  });

  test('a measured run is marked as measured, not as something typed', () => {
    // Unlike a set, a distance step IS measured: the clock ran and the tap says
    // the distance was covered. comparable.ts has been trending these all along
    // and must keep doing so.
    const s = step({ prescription_type: 'distance', quantity: 800, quantity_unit: 'm' });
    const [log] = buildLogs([s], [200], 1, AT).cardio_logs;
    assert.equal(log.distance_meters, 800);
    assert.equal(log.duration_seconds, 200);
    assert.equal(log.source, 'timer');
  });

  test('a correction replaces what the clock saw', () => {
    // The treadmill said 750 m in 190 s and the phone never saw any of it.
    const s = step({ prescription_type: 'distance', quantity: 800, quantity_unit: 'm' });
    const [log] = buildLogs([s], [200], 1, AT, {
      0: { distance_meters: 750, seconds: 190 },
    }).cardio_logs;
    assert.equal(log.distance_meters, 750);
    assert.equal(log.duration_seconds, 190);
    assert.equal(log.source, 'manual');
  });

  test('correcting one half leaves the other measured', () => {
    // A timer left running through a water stop: the distance was right.
    const s = step({ prescription_type: 'distance', quantity: 1000, quantity_unit: 'm' });
    const [log] = buildLogs([s], [400], 1, AT, { 0: { seconds: 300 } }).cardio_logs;
    assert.equal(log.distance_meters, 1000, 'the distance the clock had was not touched');
    assert.equal(log.duration_seconds, 300);
    assert.equal(log.source, 'manual');
  });

  test('a duration step gains a real pace only when a distance is supplied', () => {
    // Time is known, distance is not, so no pace can be claimed — until the
    // athlete says how far they went.
    const s = step({ prescription_type: 'duration', quantity: 20, quantity_unit: 'min' });
    assert.equal(buildLogs([s], [1200], 1, AT).cardio_logs[0].distance_meters, null);
    const [corrected] = buildLogs([s], [1200], 1, AT, { 0: { distance_meters: 3800 } }).cardio_logs;
    assert.equal(corrected.distance_meters, 3800);
    assert.equal(corrected.duration_seconds, 1200);
    assert.equal(corrected.source, 'manual');
  });

  test('a blank correction leaves the measurement standing', () => {
    // An empty field means "the clock was right", never zero.
    const s = step({ prescription_type: 'distance', quantity: 800, quantity_unit: 'm' });
    const [log] = buildLogs([s], [200], 1, AT, {
      0: { distance_meters: null, seconds: null },
    }).cardio_logs;
    assert.equal(log.distance_meters, 800);
    assert.equal(log.duration_seconds, 200);
    assert.equal(log.source, 'timer');
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
