/**
 * Replanning the open part of a week after the athlete's equipment changes.
 *
 * The rule pinned here is "replace only what is no longer possible": what was
 * done, what the athlete dropped, and what they can still do all stay where
 * they are, and only the impossible sessions are swapped out.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { replanWeekQueue, type QueueItem, type WeekRequirement } from './queue.ts';
import type { EngineInput, Exercise, WorkoutTemplate } from '../../../packages/engine/src/index.ts';

const EXERCISES: Exercise[] = [
  { id: 'ex_run', name: 'Run', impact_level: 'medium', postpartum_friendly: true, equipment: ['outdoor'] },
  { id: 'ex_sled', name: 'Sled Push', impact_level: 'low', postpartum_friendly: true, equipment: ['sled'] },
  { id: 'ex_squat', name: 'Squat', impact_level: 'low', postpartum_friendly: true, equipment: ['barbell'] },
];

/** A one-exercise template, so its equipment need is exactly that exercise's. */
function template(id: string, primary_goal: string, exercise_id: string): WorkoutTemplate {
  return {
    id,
    name: id,
    workout_family: 'run_base',
    primary_goal,
    estimated_minutes: 45,
    impact_level: 'medium',
    hyrox_specificity: 5,
    postpartum_friendly: true,
    requires_running: false,
    requires_ski: false,
    variants: [{ variant_code: 'green', volume_multiplier: 1, recovery_state: 'okay' }],
    blocks: [{
      id: 'b1', block_order: 0, block_type: 'rounds', rounds: 1,
      exercises: [{
        exercise_id, sequence_order: 0,
        prescription_type: 'reps', quantity: 10, quantity_unit: 'reps',
      }],
    }],
    tags: [],
  } as WorkoutTemplate;
}

const TEMPLATES = [
  template('run_a', 'aerobic_durability', 'ex_run'),
  template('run_b', 'aerobic_durability', 'ex_run'),
  template('sled_a', 'strength', 'ex_sled'),
  template('lift_a', 'strength', 'ex_squat'),
  template('lift_b', 'strength', 'ex_squat'),
];

const INPUT: EngineInput = {
  local_date: '2026-08-24',
  phase_type: 'build',
  days_to_race: 100,
  stimulus_requirements: [],
  recent_sessions: [],
  recovery_state: 'okay',
  energy: 'normal',
  sleep_hours: null,
  available_minutes: 60,
  available_equipment: ['outdoor', 'barbell'],
  low_impact_required: false,
  symptom_flags: [],
  considerations: [],
  candidates: [],
  substitutions: [],
};

const item = (
  id: string, workout_template_id: string, stimulus_type: string, rank: number, state = 'queued',
): QueueItem => ({ id, workout_template_id, stimulus_type, rank, state });

const req = (
  stimulus_type: string, target_exposures: number, completed_exposures = 0, priority = 1,
): WeekRequirement => ({ stimulus_type, target_exposures, completed_exposures, priority });

const replan = (
  items: QueueItem[], requirements: WeekRequirement[], input: Partial<EngineInput> = {},
) => replanWeekQueue({
  items, requirements, templates: TEMPLATES, exercises: EXERCISES, input: { ...INPUT, ...input },
});

describe('Replanning a week after an equipment change', () => {
  test('a week that is still possible is left alone', () => {
    const r = replan(
      [item('q1', 'run_a', 'aerobic_durability', 0), item('q2', 'lift_a', 'strength', 1)],
      [req('aerobic_durability', 1), req('strength', 1)],
    );
    assert.deepEqual(r, { expire: [], add: [] });
  });

  test('a session needing removed equipment is replaced at its rank', () => {
    // Sled was given up; the strength exposure moves to the barbell.
    const r = replan(
      [
        item('q1', 'run_a', 'aerobic_durability', 0),
        item('q2', 'sled_a', 'strength', 1),
        item('q3', 'run_b', 'aerobic_durability', 2),
      ],
      [req('aerobic_durability', 2), req('strength', 1)],
    );
    assert.deepEqual(r.expire, ['q2']);
    assert.deepEqual(r.add, [{ workout_template_id: 'lift_a', stimulus_type: 'strength', rank: 1 }]);
  });

  test('started, completed and skipped sessions are never touched', () => {
    // All three name the sled, which is gone. None of them is the plan any more:
    // two are what happened, and the third is a drop the athlete chose.
    const r = replan(
      [
        item('q1', 'sled_a', 'strength', 0, 'completed'),
        item('q2', 'sled_a', 'strength', 1, 'in_progress'),
        item('q3', 'sled_a', 'strength', 2, 'skipped'),
      ],
      [req('strength', 3, 1)],
    );
    assert.deepEqual(r, { expire: [], add: [] });
  });

  test('a dropped session is not brought back by a replan', () => {
    const r = replan(
      [item('q1', 'lift_a', 'strength', 0), item('q2', 'lift_b', 'strength', 1, 'skipped')],
      [req('strength', 2)],
    );
    assert.deepEqual(r.add, []);
  });

  test('the replacement differs from what the week already holds', () => {
    const r = replan(
      [item('q1', 'lift_a', 'strength', 0), item('q2', 'sled_a', 'strength', 1)],
      [req('strength', 2)],
    );
    assert.deepEqual(r.add.map(a => a.workout_template_id), ['lift_b']);
  });

  test('with nothing to replace it, the impossible session is still expired', () => {
    // No sled and no barbell: the strength exposure cannot be met this week,
    // and leaving the sled session queued would offer work they cannot do.
    const r = replan(
      [item('q1', 'run_a', 'aerobic_durability', 0), item('q2', 'sled_a', 'strength', 1)],
      [req('aerobic_durability', 1), req('strength', 1)],
      { available_equipment: ['outdoor'] },
    );
    assert.deepEqual(r, { expire: ['q2'], add: [] });
  });

  test('added equipment fills a need nothing could meet before, at the end', () => {
    // The week was planned without a barbell, so its strength exposure had no
    // session. With one, it does.
    const r = replan(
      [item('q1', 'run_a', 'aerobic_durability', 0), item('q2', 'run_b', 'aerobic_durability', 1)],
      [req('aerobic_durability', 2), req('strength', 1)],
    );
    assert.deepEqual(r.expire, []);
    assert.deepEqual(r.add, [{ workout_template_id: 'lift_a', stimulus_type: 'strength', rank: 2 }]);
  });

  test('a week already over-credited plans nothing new', () => {
    // A session done off the queue still credits the stimulus, so completed
    // plus queued can exceed the target. That is not a gap to fill.
    const r = replan(
      [item('q1', 'lift_a', 'strength', 0)],
      [req('strength', 1, 1)],
    );
    assert.deepEqual(r.add, []);
  });

  test('a replacement comes from a family the week does not already hold', () => {
    // Both lift templates are one family; the sled is gone, and the week
    // already has a lift. With another family available, it goes there.
    const templates = [
      ...TEMPLATES.map(t => ({ ...t, workout_family: t.id.split('_')[0] })),
      { ...template('row_a', 'strength', 'ex_squat'), workout_family: 'row' },
    ];
    const r = replanWeekQueue({
      items: [item('q1', 'lift_a', 'strength', 0), item('q2', 'sled_a', 'strength', 1)],
      requirements: [req('strength', 2)],
      templates, exercises: EXERCISES, input: INPUT,
    });
    assert.deepEqual(r.add.map(a => a.workout_template_id), ['row_a']);
  });
});
