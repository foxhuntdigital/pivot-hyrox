/**
 * How a week's stimulus requirements become sessions.
 *
 * `rank` is the load-bearing output: a compressed week is cut from the bottom
 * of it, so an order that put optional work above protected work would drop the
 * wrong sessions every time. Most of what is pinned here is that order.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { planWeekQueue, type WeekRequirement } from './queue.ts';
import type { EngineInput, Exercise, WorkoutTemplate } from '../../../packages/engine/src/index.ts';

const EXERCISES: Exercise[] = [
  { id: 'ex_run', name: 'Run', impact_level: 'medium', postpartum_friendly: true, equipment: ['outdoor'] },
  { id: 'ex_ski', name: 'Ski', impact_level: 'low', postpartum_friendly: true, equipment: ['ski'] },
  { id: 'ex_squat', name: 'Squat', impact_level: 'low', postpartum_friendly: true, equipment: ['barbell'] },
];

function template(over: Partial<WorkoutTemplate> = {}): WorkoutTemplate {
  return {
    id: 't1',
    name: 'Session',
    workout_family: 'run_base',
    primary_goal: 'aerobic_durability',
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
        exercise_id: 'ex_run', sequence_order: 0,
        prescription_type: 'duration', quantity: 30, quantity_unit: 'min',
      }],
    }],
    tags: [],
    ...over,
  } as WorkoutTemplate;
}

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
  available_equipment: ['outdoor', 'ski', 'barbell'],
  low_impact_required: false,
  symptom_flags: [],
  considerations: [],
  candidates: [],
  substitutions: [],
};

const req = (
  stimulus_type: string, target_exposures: number, priority: number,
): WeekRequirement => ({ stimulus_type, target_exposures, priority });

const plan = (
  requirements: WeekRequirement[],
  templates: WorkoutTemplate[],
  input: Partial<EngineInput> = {},
) => planWeekQueue({
  requirements, templates, exercises: EXERCISES, input: { ...INPUT, ...input },
});

describe('Planning a week', () => {
  test('one session per required exposure', () => {
    const items = plan([req('aerobic_durability', 3, 1)], [
      template({ id: 'a' }), template({ id: 'b' }), template({ id: 'c' }),
    ]);
    assert.equal(items.length, 3);
    assert.deepEqual(items.map(i => i.rank), [0, 1, 2]);
  });

  test('protected stimuli rank above optional ones', () => {
    // Rank is what a shortened week is cut from the bottom of, so priority has
    // to survive into it.
    const items = plan(
      [req('recovery', 1, 3), req('strength', 1, 2), req('aerobic_durability', 1, 1)],
      [
        template({ id: 'aero', primary_goal: 'aerobic_durability' }),
        template({ id: 'str', primary_goal: 'strength' }),
        template({ id: 'rec', primary_goal: 'recovery' }),
      ],
    );
    assert.deepEqual(items.map(i => i.workout_template_id), ['aero', 'str', 'rec']);
  });

  test('a tier is round-robined, not grouped', () => {
    // Three aerobic sessions ahead of the threshold work they share a tier with
    // would put every hard session at the end of the week.
    const items = plan(
      [req('aerobic_durability', 3, 1), req('threshold', 2, 1)],
      [
        template({ id: 'a1' }), template({ id: 'a2' }), template({ id: 'a3' }),
        template({ id: 't1', primary_goal: 'threshold' }),
        template({ id: 't2', primary_goal: 'threshold' }),
      ],
    );
    assert.deepEqual(items.map(i => i.stimulus_type), [
      'aerobic_durability', 'threshold',
      'aerobic_durability', 'threshold',
      'aerobic_durability',
    ]);
  });

  test('specificity no longer decides what the week queues', () => {
    /**
     * This asserted the opposite until the pool sort was removed, and the
     * reversal is deliberate.
     *
     * Ordering every pool by `hyrox_specificity` descending made one scalar the
     * authority over what an athlete is given: it always reached for the hardest
     * session available, which is the substance of the "beginners get advanced
     * workouts" reports, and it is not a rule that survives the app having more
     * than one sport.
     *
     * Specificity keeps its real job in `raceSpecificity`, where it is scored
     * rather than sorted and ramps with race proximity.
     */
    const items = plan([req('aerobic_durability', 1, 1)], [
      template({ id: 'b_specific', hyrox_specificity: 9 }),
      template({ id: 'a_generic', hyrox_specificity: 2 }),
    ]);
    assert.equal(items[0].workout_template_id, 'a_generic',
      'the pool is ordered stably, not by specificity');
  });

  test('a truthful zero specificity is still reachable', () => {
    /**
     * The case that would have stranded the 48-workout strength expansion.
     *
     * A foundational barbell session has no race specificity and says so. Under
     * a descending sort that is not "less specific", it is "last, always" — so
     * every one of those templates would have been unreachable in every phase
     * the moment it was imported. Fixing the sort is the right answer; inventing
     * a 0.4 to make the planner behave would have corrupted the metadata to work
     * around it.
     */
    const items = plan([req('aerobic_durability', 1, 1)], [
      template({ id: 'a_general_strength', hyrox_specificity: 0 }),
      template({ id: 'b_race_specific', hyrox_specificity: 1 }),
    ]);
    assert.equal(items[0].workout_template_id, 'a_general_strength');
  });

  test('the same week planned twice queues the same sessions', () => {
    // With no ranking left in the pool, determinism is what stops a week
    // reshuffling between two reads of the same plan.
    const pool = [
      template({ id: 'c', hyrox_specificity: 3 }),
      template({ id: 'a', hyrox_specificity: 7 }),
      template({ id: 'b', hyrox_specificity: 5 }),
    ];
    const first = plan([req('aerobic_durability', 2, 1)], pool);
    const second = plan([req('aerobic_durability', 2, 1)], pool);
    assert.deepEqual(
      first.map(i => i.workout_template_id),
      second.map(i => i.workout_template_id));
  });

  test('a week does not repeat a session while others are available', () => {
    const items = plan([req('aerobic_durability', 2, 1)], [
      template({ id: 'a' }), template({ id: 'b' }),
    ]);
    assert.deepEqual(items.map(i => i.workout_template_id), ['a', 'b']);
  });

  test('a thin library repeats rather than dropping the exposure', () => {
    // Asking for three of a stimulus the library has one of is still three
    // exposures — the week is what it is, and a missing row would read as a
    // requirement nobody intended to meet.
    const items = plan([req('aerobic_durability', 3, 1)], [template({ id: 'only' })]);
    assert.equal(items.length, 3);
    assert.deepEqual([...new Set(items.map(i => i.workout_template_id))], ['only']);
  });

  test('a session the athlete could not be offered is never queued', () => {
    // No barbell, so the strength template is ineligible and its exposure has
    // nothing to fill it.
    const items = plan(
      [req('strength', 1, 1), req('aerobic_durability', 1, 1)],
      [
        template({ id: 'lift', primary_goal: 'strength', blocks: [{
          id: 'b', block_order: 0, block_type: 'rounds', rounds: 1,
          exercises: [{ exercise_id: 'ex_squat', sequence_order: 0,
            prescription_type: 'reps', quantity: 5, quantity_unit: 'reps' }],
        }] } as Partial<WorkoutTemplate>),
        template({ id: 'run' }),
      ],
      { available_equipment: ['outdoor'] },
    );
    assert.deepEqual(items.map(i => i.workout_template_id), ['run']);
  });

  test('considerations are honoured when the week is planned', () => {
    const items = plan([req('aerobic_durability', 1, 1)], [
      template({ id: 'unsafe', postpartum_friendly: false }),
      template({ id: 'safe', postpartum_friendly: true, hyrox_specificity: 1 }),
    ], { considerations: ['Postpartum'] });
    assert.deepEqual(items.map(i => i.workout_template_id), ['safe'],
      'the more race-specific session is skipped because it is not eligible');
  });

  test('an exposure already completed is not queued again', () => {
    const items = plan(
      [{ stimulus_type: 'aerobic_durability', target_exposures: 3, completed_exposures: 2, priority: 1 }],
      [template({ id: 'a' }), template({ id: 'b' }), template({ id: 'c' })],
    );
    assert.equal(items.length, 1);
  });

  test('a week with nothing eligible plans nothing', () => {
    const items = plan([req('strength', 2, 1)], [template({ id: 'run' })]);
    assert.deepEqual(items, []);
  });
});
