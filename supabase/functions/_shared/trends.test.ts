/**
 * `get_performance_trends` returning null is load-bearing: it is what makes
 * Coach say it lacks the data instead of estimating from session RPE. So the
 * refusal is pinned here alongside the claim, and so is the rule that a change
 * inside the noise floor is "holding" rather than a direction.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { performanceTrend } from './trends.ts';
import { exerciseHistory } from './exercise-history.ts';
import type { StrengthSetRow } from './exercise-history.ts';
import type { ComparableSeries } from './comparable.ts';
import type { SessionRow } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString();

const session = (id: string, daysAgo: number): SessionRow => ({
  id, template_id: 'wo_hyrox_legs_a', started_at: at(daysAgo), ended_at: at(daysAgo),
  session_rpe: 7,
});

const set = (over: Partial<StrengthSetRow> & { session_id: string }): StrengthSetRow => ({
  exercise_id: 'ex_back_squat', set_index: 1,
  prescribed_reps: 5, prescribed_reps_min: 5, prescribed_reps_max: 5,
  actual_reps: 5, actual_load: 100, load_unit: 'kg', rpe: 7, source: 'manual',
  ...over,
});

const NAMES: Record<string, string> = { ex_back_squat: 'Back Squat' };
const nameFor = (id: string) => NAMES[id] ?? id;

const strengthOf = (sessions: SessionRow[], logs: StrengthSetRow[]) =>
  exerciseHistory({ today: TODAY, sessions, setLogs: logs });

const runs = (paces: number[], excluded = 0): ComparableSeries => ({
  exercise_id: 'ex_run',
  distance_meters: 1000,
  runs: paces.map((pace_seconds, i) => ({
    session_id: `r${i}`, date: at(28 - i * 7).slice(0, 10), pace_seconds, rpe: 7, hr: null,
  })),
  excluded,
  window_days: 28,
});

describe('Performance trend', () => {
  test('no evidence at all is null, which is what makes Coach say so', () => {
    assert.equal(
      performanceTrend({ runs: null, strength: new Map(), nameFor }),
      null);
  });

  test('a single exposure is not a trend', () => {
    const strength = strengthOf([session('a', 3)], [set({ session_id: 'a' })]);
    assert.equal(performanceTrend({ runs: null, strength, nameFor }), null);
  });

  test('a rising top set reads as improving, first against last', () => {
    const strength = strengthOf(
      [session('a', 40), session('b', 20), session('c', 5)],
      [
        set({ session_id: 'a', actual_load: 100 }),
        set({ session_id: 'b', actual_load: 105 }),
        set({ session_id: 'c', actual_load: 110 }),
      ]);

    const trend = performanceTrend({ runs: null, strength, nameFor })!;
    assert.equal(trend.metric, 'Back Squat top set');
    assert.equal(trend.direction, 'improving');
    assert.equal(trend.samples, 3);
    assert.equal(trend.from, '100 kg');
    assert.equal(trend.to, '110 kg');
    assert.equal(trend.confidence, 'medium');
  });

  test('a change inside the noise floor is holding, not a direction', () => {
    const strength = strengthOf(
      [session('a', 30), session('b', 5)],
      [set({ session_id: 'a', actual_load: 100 }), set({ session_id: 'b', actual_load: 101 })]);

    assert.equal(performanceTrend({ runs: null, strength, nameFor })!.direction, 'holding');
  });

  test('a falling top set is slowing, and says the window it covers', () => {
    const strength = strengthOf(
      [session('a', 30), session('b', 5)],
      [set({ session_id: 'a', actual_load: 110 }), set({ session_id: 'b', actual_load: 100 })]);

    const trend = performanceTrend({ runs: null, strength, nameFor })!;
    assert.equal(trend.direction, 'slowing');
    assert.equal(trend.window_weeks, 17);
  });

  test('a faster pace is improving — lower is better for running', () => {
    const trend = performanceTrend({ runs: runs([271, 265, 258]), strength: new Map(), nameFor })!;
    assert.equal(trend.metric, '1000 m repeat pace');
    assert.equal(trend.direction, 'improving');
    assert.equal(trend.from, '4:31 /km');
    assert.equal(trend.to, '4:18 /km');
  });

  test('the source with more comparable sessions behind it wins', () => {
    const strength = strengthOf(
      [session('a', 40), session('b', 30), session('c', 20), session('d', 5)],
      [
        set({ session_id: 'a', actual_load: 100 }), set({ session_id: 'b', actual_load: 102.5 }),
        set({ session_id: 'c', actual_load: 105 }), set({ session_id: 'd', actual_load: 110 }),
      ]);

    const trend = performanceTrend({ runs: runs([271, 258]), strength, nameFor })!;
    assert.match(trend.metric, /Back Squat/);
    assert.equal(trend.samples, 4);
  });

  test('running takes a tie, having already passed the stricter rule', () => {
    const strength = strengthOf(
      [session('a', 30), session('b', 5)],
      [set({ session_id: 'a', actual_load: 100 }), set({ session_id: 'b', actual_load: 110 })]);

    const trend = performanceTrend({ runs: runs([271, 258]), strength, nameFor })!;
    assert.match(trend.metric, /repeat pace/);
  });

  test('the caveat carries what was left out', () => {
    const trend = performanceTrend({ runs: runs([271, 265, 258], 4), strength: new Map(), nameFor })!;
    assert.match(trend.caveat, /7 sessions ran this distance; 3 were comparable/);
    // More excluded than included is never a confident claim.
    assert.equal(trend.confidence, 'low');
  });

  test('exposures at a different rep range do not join the series', () => {
    const strength = strengthOf(
      [session('a', 40), session('b', 20), session('c', 5)],
      [
        set({ session_id: 'a', actual_load: 100 }),
        set({ session_id: 'b', actual_load: 80, prescribed_reps_min: 12, prescribed_reps_max: 12 }),
        set({ session_id: 'c', actual_load: 105 }),
      ]);

    const trend = performanceTrend({ runs: null, strength, nameFor })!;
    assert.equal(trend.samples, 2);
    assert.equal(trend.from, '100 kg');
    assert.equal(trend.to, '105 kg');
  });
});
