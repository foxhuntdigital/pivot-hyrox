/**
 * How a prescription becomes the list the player walks through.
 *
 * The rule under test: a working set is a step. A sets x reps prescription used
 * to collapse into ONE step whose headline read "4 x6" — the set count and the
 * rep count side by side with no label saying which was which — so four
 * working sets were one tap, and `buildLogs` recorded `prescribed_reps: 4`,
 * the number of sets.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSteps, formatPrescription } from './steps.ts';
import type { Recommendation } from '@pivot/engine';

function rec(exercises: any[], over: Partial<any> = {}): Recommendation {
  return {
    template: {
      id: 'wo_test', name: 'Test', workout_family: 'strength_legs',
      primary_goal: 'strength', estimated_minutes: 45, intensity_target: 'RPE 7',
      impact_level: 'medium', hyrox_specificity: 0.5, postpartum_friendly: true,
      requires_running: false, requires_ski: false, tags: [], variants: [], blocks: [],
    },
    variant: { variant_code: 'green', time_budget_minutes: 45, recovery_state: 'good', volume_multiplier: 1 },
    blocks: [{
      id: 'b1', block_order: 0, block_type: 'continuous', title: 'Main',
      instructions: 'Lower-body strength', rounds: 1, rest_seconds: null,
      exercises,
      ...over,
    }],
    estimated_minutes: 45, primary_stimulus: 'strength',
    score: {} as any, reason_codes: [], rationale: '', substitutions_applied: [],
  } as unknown as Recommendation;
}

const squat = (over: any = {}) => ({
  exercise_id: 'ex_back_squat', sequence_order: 1, prescription_type: 'sets_reps',
  quantity: 4, quantity_unit: 'x6', intensity_note: 'RPE 7',
  sets: 4, reps_min: 6, reps_max: 6, rest_seconds: 150, target_rpe: 7,
  load_basis: null, load_value: null, ...over,
});

describe('Prescription formatting', () => {
  test('the card states sets and reps as two labelled numbers', () => {
    // "4 x6" — a bare set count beside a bare rep count — is what let the two
    // be confused, on screen and in the log.
    assert.equal(formatPrescription({
      prescription_type: 'sets_reps', quantity: 4, quantity_unit: 'x6',
      sets: 4, reps_min: 6, reps_max: 6,
    }), '4 × 6');
  });

  test('a range and per-side work read as written', () => {
    assert.equal(formatPrescription({
      prescription_type: 'sets_reps', quantity: 3, quantity_unit: 'x8-10',
      sets: 3, reps_min: 8, reps_max: 10,
    }), '3 × 8-10');
    assert.equal(formatPrescription({
      prescription_type: 'sets_reps', quantity: 3, quantity_unit: 'x10/leg',
      sets: 3, reps_min: 10, reps_max: 10,
    }), '3 × 10 / side');
  });

  test('the card and the player never disagree about a distance', () => {
    const be = { prescription_type: 'distance', quantity: 800, quantity_unit: 'm' };
    assert.equal(formatPrescription(be), '800 m');
    assert.equal(buildSteps(rec([{ ...be, exercise_id: 'ex_run', sequence_order: 1 }]))[0].qty, '800 m');
  });
});

describe('Step expansion', () => {
  test('four working sets become four steps, not one', () => {
    const work = buildSteps(rec([squat()])).filter(s => !s.rest);
    assert.equal(work.length, 4);
    assert.deepEqual(work.map(s => s.set_number), [1, 2, 3, 4]);
    assert.deepEqual(work.map(s => s.phase), ['SET 1 / 4', 'SET 2 / 4', 'SET 3 / 4', 'SET 4 / 4']);
  });

  test('the headline number is the reps, never the set count', () => {
    // "4 x6" was the bug: two numbers, no label, and the log took the wrong one.
    const [first] = buildSteps(rec([squat()]));
    assert.equal(first.qty, '6');
    assert.equal(first.prescribed_reps_min, 6);
  });

  test('a rep range stays a range', () => {
    const [first] = buildSteps(rec([squat({ reps_min: 8, reps_max: 10 })]));
    assert.equal(first.qty, '8-10');
    assert.deepEqual([first.prescribed_reps_min, first.prescribed_reps_max], [8, 10]);
  });

  test('AMRAP asks for effort, not a fabricated rep count', () => {
    const [first] = buildSteps(rec([squat({
      quantity_unit: 'AMRAP-2', reps_min: null, reps_max: null,
    })]));
    assert.equal(first.qty, 'AMRAP-2');
    assert.equal(first.prescribed_reps_min, null);
    assert.equal(first.amrap_reserve, 2);
  });

  test('rest between working sets is a step, and never trails the last set', () => {
    const steps = buildSteps(rec([squat()]));
    const rests = steps.filter(s => s.rest);
    assert.equal(rests.length, 3, 'three rests between four sets');
    assert.equal(steps[steps.length - 1].rest, false, 'the session does not end on a rest');
    assert.equal(rests[0].qty, '2:30');
    assert.equal(rests[0].duration_seconds, 150);
    // Rest belongs to no movement, so it is never logged as one.
    assert.equal(rests[0].exercise_id, '');
  });

  test('a prescription with no rest emits no rest steps', () => {
    const steps = buildSteps(rec([squat({ rest_seconds: null })]));
    assert.equal(steps.filter(s => s.rest).length, 0);
    assert.equal(steps.length, 4);
  });

  test('bodyweight work is not asked what was on the bar', () => {
    const [loaded] = buildSteps(rec([squat()]));
    const [bw] = buildSteps(rec([squat({ load_basis: 'bodyweight' })]));
    assert.equal(loaded.logs_load, true);
    assert.equal(bw.logs_load, false);
  });

  test('distance and duration work is untouched by any of this', () => {
    const steps = buildSteps(rec([{
      exercise_id: 'ex_run', sequence_order: 1, prescription_type: 'distance',
      quantity: 800, quantity_unit: 'm', intensity_note: 'RPE 7',
    }]));
    assert.equal(steps.length, 1);
    assert.equal(steps[0].qty, '800 m');
    assert.equal(steps[0].set_number, undefined);
    assert.equal(steps[0].logs_load, undefined);
  });

  test('an unstructured sets_reps row still renders rather than disappearing', () => {
    // Content authored before 0011, or imported without a set scheme. It keeps
    // the old single-step behaviour instead of vanishing from the session.
    const steps = buildSteps(rec([{
      exercise_id: 'ex_back_squat', sequence_order: 1, prescription_type: 'sets_reps',
      quantity: 3, quantity_unit: 'x10', intensity_note: 'RPE 7',
    }]));
    assert.equal(steps.length, 1);
    assert.equal(steps[0].set_number, undefined);
  });

  test('sets expand inside every round', () => {
    const steps = buildSteps(rec([squat({ sets: 2, rest_seconds: null })], { rounds: 3 }));
    assert.equal(steps.filter(s => !s.rest).length, 6, '3 rounds x 2 sets');
    assert.deepEqual([...new Set(steps.map(s => s.round))], [1, 2, 3]);
  });
});
