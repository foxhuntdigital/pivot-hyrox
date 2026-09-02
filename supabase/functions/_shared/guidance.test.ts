/**
 * The player renders whatever this sends, so what is pinned here is the shape
 * of an absence: a movement with no comparable history must arrive with
 * `last: null` and a reason code, never with a number borrowed from a different
 * rep range or a different day.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { guidanceFor } from './guidance.ts';
import { exerciseHistory, type StrengthSetRow } from './exercise-history.ts';
import type { ProgressionRuleRow } from './progression.ts';
import type { SessionRow } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString();

const RULES: ProgressionRuleRow[] = [{
  id: 'pr_4', workout_family: 'strength_legs', metric: 'load',
  trigger_condition: 'all work sets completed at RPE <=7',
  action: 'increase 2.5-5%', max_change_pct: 5, notes: 'Autoregulated',
}];

const EXERCISES = new Map<string, any>([
  ['ex_back_squat', { name: 'Back Squat', progression_class: 'anchor', progression_tracks: ['load'] }],
  ['ex_suitcase_carry', { name: 'Suitcase Carry', progression_class: 'developmental' }],
]);

const template = (exercises: Record<string, any>[]) => ({
  workout_family: 'strength_legs',
  blocks: [{ exercises }],
});

const SQUAT = { exercise_id: 'ex_back_squat', sets: 4, reps_min: 5, reps_max: 5, target_rpe: 7 };
const CARRY = { exercise_id: 'ex_suitcase_carry', sets: 3, reps_min: null, reps_max: null };

const session = (id: string, daysAgo: number): SessionRow => ({
  id, template_id: 'wo_hyrox_legs_a', started_at: at(daysAgo), ended_at: at(daysAgo),
  session_rpe: 7,
});

const set = (over: Partial<StrengthSetRow> & { session_id: string }): StrengthSetRow => ({
  exercise_id: 'ex_back_squat', set_index: 1,
  prescribed_reps: 5, prescribed_reps_min: 5, prescribed_reps_max: 5,
  actual_reps: 5, actual_load: 100, load_unit: 'kg', rpe: 6, source: 'manual',
  ...over,
});

const guide = (exercises: Record<string, any>[], sessions: SessionRow[], logs: StrengthSetRow[]) =>
  guidanceFor({
    today: TODAY,
    template: template(exercises) as any,
    histories: exerciseHistory({ today: TODAY, sessions, setLogs: logs }),
    rules: RULES,
    exercises: EXERCISES,
  });

describe('Exercise guidance', () => {
  test('carries the last exposure, how long ago, and the suggestion', () => {
    const g = guide([SQUAT], [session('a', 8)], [set({ session_id: 'a' })]);
    const squat = g.ex_back_squat;

    assert.equal(squat.exercise, 'Back Squat');
    assert.equal(squat.last?.load, 100);
    assert.equal(squat.last?.reps, 5);
    assert.equal(squat.last?.rpe, 6);
    assert.equal(squat.last?.days_ago, 8);
    assert.equal(squat.suggestion.dimension, 'load');
    assert.equal(squat.suggestion.load, 105);
    assert.equal(squat.suggestion.reason_code, 'PROGRESS_ALL_SETS_BELOW_RPE_CEILING');
  });

  test('no history is an absence with a reason, not a borrowed number', () => {
    const g = guide([SQUAT], [], []);
    assert.equal(g.ex_back_squat.last, null);
    assert.equal(g.ex_back_squat.suggestion.load, null);
    assert.equal(g.ex_back_squat.suggestion.reason_code, 'NO_COMPARABLE_HISTORY');
  });

  test('history at a different rep range is not offered as this rep range', () => {
    const g = guide([SQUAT], [session('tens', 7)], [
      set({ session_id: 'tens', prescribed_reps_min: 10, prescribed_reps_max: 10, actual_reps: 10 }),
    ]);
    assert.equal(g.ex_back_squat.last, null);
    assert.match(g.ex_back_squat.suggestion.caveat ?? '', /different rep range/);
  });

  test('only movements that prescribe working sets appear', () => {
    // The carry has sets, so it appears; a distance step with no sets does not.
    const g = guide(
      [SQUAT, CARRY, { exercise_id: 'ex_run', sets: null }],
      [session('a', 3)], [set({ session_id: 'a' })],
    );
    assert.deepEqual(Object.keys(g).sort(), ['ex_back_squat', 'ex_suitcase_carry']);
  });

  test('a movement the ontology does not load is never suggested a weight', () => {
    const g = guide([CARRY], [session('a', 3)], [
      set({ session_id: 'a', exercise_id: 'ex_suitcase_carry', actual_load: null, actual_reps: 30 }),
    ]);
    assert.notEqual(g.ex_suitcase_carry.suggestion.dimension, 'load');
    assert.equal(g.ex_suitcase_carry.suggestion.load, null);
  });
});
