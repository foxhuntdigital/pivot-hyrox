/**
 * The exclusions are the point of this module, so what is pinned here is the
 * refusals: a prescription read back as performance must never count, a
 * different rep range must not carry load, and an absence must come back as an
 * absence rather than as a weaker comparison.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  exerciseHistory, mostRecentComparable, rangesOverlap, EXPOSURE_WINDOW_DAYS,
} from './exercise-history.ts';
import type { StrengthSetRow } from './exercise-history.ts';
import type { SessionRow } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString();

const session = (id: string, daysAgo: number, rpe: number | null = 7): SessionRow => ({
  id, template_id: 'wo_strength_total_a', started_at: at(daysAgo), ended_at: at(daysAgo),
  session_rpe: rpe,
});

const set = (over: Partial<StrengthSetRow> & { session_id: string }): StrengthSetRow => ({
  exercise_id: 'ex_back_squat',
  set_index: 1,
  prescribed_reps: 5,
  prescribed_reps_min: 5,
  prescribed_reps_max: 5,
  actual_reps: 5,
  actual_load: 100,
  load_unit: 'kg',
  rpe: 7,
  source: 'manual',
  ...over,
});

const history = (sessions: SessionRow[], setLogs: StrengthSetRow[]) =>
  exerciseHistory({ today: TODAY, sessions, setLogs });

describe('Exercise history', () => {
  test('reads the top set, the set count and the total reps from one exposure', () => {
    const h = history([session('a', 7)], [
      set({ session_id: 'a', set_index: 1, actual_load: 100, actual_reps: 5 }),
      set({ session_id: 'a', set_index: 2, actual_load: 105, actual_reps: 5 }),
      set({ session_id: 'a', set_index: 3, actual_load: 105, actual_reps: 4 }),
    ]).get('ex_back_squat');

    assert.ok(h);
    assert.equal(h.exposures.length, 1);
    const [e] = h.exposures;
    assert.equal(e.top_load, 105);
    assert.equal(e.top_reps, 5);
    assert.equal(e.sets, 3);
    assert.equal(e.total_reps, 14);
    assert.equal(e.load_unit, 'kg');
    // The third set fell a rep short of the bottom of its range.
    assert.equal(e.all_sets_completed, false);
  });

  test('an asserted set is not evidence, and the exposure is counted as excluded', () => {
    // A Complete tap with nothing typed. actual_reps is the prescription copied
    // onto itself and can never show a miss, so reading it back would be the
    // progression engine consuming its own output.
    const h = history([session('a', 7)], [
      set({ session_id: 'a', source: 'asserted', actual_load: null }),
      set({ session_id: 'a', set_index: 2, source: 'asserted', actual_load: null }),
    ]).get('ex_back_squat');

    assert.ok(h);
    assert.equal(h.exposures.length, 0);
    assert.equal(h.excluded, 1);
  });

  test('a carried set counts — the athlete kept using that weight', () => {
    const h = history([session('a', 7)], [
      set({ session_id: 'a', set_index: 1, source: 'manual', actual_load: 100 }),
      set({ session_id: 'a', set_index: 2, source: 'carried', actual_load: 100 }),
      set({ session_id: 'a', set_index: 3, source: 'asserted', actual_load: null }),
    ]).get('ex_back_squat');

    assert.equal(h?.exposures[0].sets, 2);
    assert.equal(h?.exposures[0].excluded_sets, 1);
  });

  test('exposures come back newest first, across sessions', () => {
    const h = history(
      [session('old', 30), session('mid', 14), session('new', 3)],
      [
        set({ session_id: 'old', actual_load: 90 }),
        set({ session_id: 'new', actual_load: 105 }),
        set({ session_id: 'mid', actual_load: 100 }),
      ],
    ).get('ex_back_squat');

    assert.deepEqual(h?.exposures.map(e => e.top_load), [105, 100, 90]);
  });

  test('anything older than the window is not current evidence', () => {
    const h = history(
      [session('recent', 5), session('ancient', EXPOSURE_WINDOW_DAYS + 1)],
      [set({ session_id: 'recent' }), set({ session_id: 'ancient' })],
    ).get('ex_back_squat');

    assert.equal(h?.exposures.length, 1);
  });

  test('two sessions on one day stay two exposures', () => {
    const h = history([session('am', 2), session('pm', 2)], [
      set({ session_id: 'am' }), set({ session_id: 'pm' }),
    ]).get('ex_back_squat');

    assert.equal(h?.exposures.length, 2);
  });

  test('session RPE stands in when no set carried its own', () => {
    const h = history([session('a', 7, 8)], [
      set({ session_id: 'a', rpe: null }),
    ]).get('ex_back_squat');

    assert.equal(h?.exposures[0].rpe, 8);
  });

  test('a set with no load is still a rep measurement', () => {
    const h = history([session('a', 7)], [
      set({ session_id: 'a', actual_load: null, actual_reps: 12 }),
    ]).get('ex_back_squat');

    assert.equal(h?.exposures[0].top_load, null);
    assert.equal(h?.exposures[0].total_reps, 12);
  });
});

describe('Comparability', () => {
  test('overlapping rep ranges compare; disjoint ones do not', () => {
    assert.equal(rangesOverlap({ reps_min: 5, reps_max: 5 }, { reps_min: 5, reps_max: 5 }), true);
    assert.equal(rangesOverlap({ reps_min: 8, reps_max: 10 }, { reps_min: 10, reps_max: 12 }), true);
    assert.equal(rangesOverlap({ reps_min: 5, reps_max: 5 }, { reps_min: 10, reps_max: 10 }), false);
  });

  test('a range with nothing to compare against compares to anything', () => {
    assert.equal(rangesOverlap({ reps_min: null, reps_max: null }, { reps_min: 5, reps_max: 5 }), true);
  });

  test('the most recent comparable exposure skips a different rep range', () => {
    // Last squat session was a set of ten. It is real training and it is not
    // evidence about a five-rep load, so it is skipped and the skip is reported.
    const h = history([session('fives', 21), session('tens', 7)], [
      set({ session_id: 'fives', actual_load: 100, prescribed_reps_min: 5, prescribed_reps_max: 5 }),
      set({ session_id: 'tens', actual_load: 80, prescribed_reps_min: 10, prescribed_reps_max: 10 }),
    ]).get('ex_back_squat');

    const found = mostRecentComparable(h, { reps_min: 5, reps_max: 5 });
    assert.equal(found?.exposure.top_load, 100);
    assert.equal(found?.skipped, 1);
  });

  test('no comparable exposure is null, not the nearest thing to one', () => {
    const h = history([session('tens', 7)], [
      set({ session_id: 'tens', prescribed_reps_min: 10, prescribed_reps_max: 10 }),
    ]).get('ex_back_squat');

    assert.equal(mostRecentComparable(h, { reps_min: 3, reps_max: 3 }), null);
    assert.equal(mostRecentComparable(undefined, { reps_min: 5, reps_max: 5 }), null);
  });
});
