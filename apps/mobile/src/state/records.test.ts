/**
 * The refusals are what make a personal record worth showing, so they are what
 * is pinned here. A rule that awards one too easily costs more than a rule that
 * misses one: the athlete only has to be congratulated for a number that was
 * not a best once before they stop believing the next one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { recordsIn, type RecordTarget } from './records.ts';

const squat = (over: Partial<NonNullable<RecordTarget['best']>> = {}): RecordTarget => ({
  exercise: 'Back Squat',
  best: { load: 100, load_unit: 'kg', reps: 5, count: 3, ...over },
});

const set = (load: number | null, reps: number | null = 5) => ({
  exercise_id: 'ex_back_squat', load, reps,
});

describe('Personal records', () => {
  test('a heavier top set beats the best comparable exposure', () => {
    const [pr] = recordsIn([set(100), set(105)], { ex_back_squat: squat() });
    assert.equal(pr.kind, 'load');
    assert.equal(pr.value, 105);
    assert.equal(pr.previous, 100);
    assert.equal(pr.unit, 'kg');
  });

  test('the heaviest set competes, not the last one', () => {
    // A back-off set after a heavy top set must not lose the record.
    const [pr] = recordsIn([set(110), set(80)], { ex_back_squat: squat() });
    assert.equal(pr.value, 110);
  });

  test('matching the best is not beating it', () => {
    assert.deepEqual(recordsIn([set(100)], { ex_back_squat: squat() }), []);
  });

  test('more reps at the same load is the plateau record', () => {
    const [pr] = recordsIn([set(100, 7)], { ex_back_squat: squat({ reps: 5 }) });
    assert.equal(pr.kind, 'reps');
    assert.equal(pr.value, 7);
    assert.equal(pr.previous, 5);
  });

  test('a first exposure sets no record, however good', () => {
    // count 0 means nothing comparable came before. The number is
    // simultaneously the athlete's best and their worst.
    assert.deepEqual(recordsIn([set(200)], { ex_back_squat: squat({ count: 0 }) }), []);
  });

  test('a movement the server sent no history for sets no record', () => {
    assert.deepEqual(recordsIn([set(200)], {}), []);
    assert.deepEqual(recordsIn([set(200)], { ex_back_squat: { exercise: 'Back Squat', best: null } }), []);
  });

  test('a set with no weight typed is not a zero and not a record', () => {
    assert.deepEqual(recordsIn([set(null)], { ex_back_squat: squat() }), []);
  });

  test('an unloaded best cannot be beaten by a loaded set', () => {
    // Bodyweight volume and a loaded set are not the same measurement, which is
    // the same rule prs.ts applies from the other direction.
    assert.deepEqual(recordsIn([set(60)], { ex_back_squat: squat({ load: null }) }), []);
  });

  test('one record per movement, and named so it can be shown', () => {
    const records = recordsIn(
      [set(105), { exercise_id: 'ex_bench', load: 80, reps: 5 }],
      {
        ex_back_squat: squat(),
        ex_bench: { exercise: 'Bench Press', best: { load: 75, load_unit: 'kg', reps: 5, count: 4 } },
      },
    );
    assert.equal(records.length, 2);
    // Sorted by name, so the celebration reads in a stable order.
    assert.deepEqual(records.map(r => r.exercise), ['Back Squat', 'Bench Press']);
  });
});
