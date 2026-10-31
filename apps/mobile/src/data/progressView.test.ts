import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  areaInputs, capabilityTile, changeText, gapReason, hoursText, monthGrid, monthSummary, monthTotals,
  projectTo, readinessChange, roundTable, weekOf, weeklyMinutes, weeklyReadiness,
} from './progressView.ts';
import type { IndexSession, ReadinessInputs, TrendPoint } from './progressRepo.ts';

const s = (date: string, minutes: number | null, template_id = 'run'): IndexSession => ({
  id: `${date}-${template_id}`, date, template_id, variant_code: 'green', name: template_id,
  minutes, rpe: null, ended_early: false, supplemental: false,
});
const point = (date: string, overall: number): TrendPoint =>
  ({ date, overall, confidence: 'medium', components: {}, observed: [] });
const TARGETS = {
  aerobic_minutes_14d: 300, threshold_sessions_14d: 4, run_sessions_7d: 3,
  longest_run_km: 12, stations_covered_21d: 8,
};
const INPUTS: ReadinessInputs = {
  aerobic_minutes_14d: 228, threshold_sessions_14d: 2, run_sessions_7d: 2, longest_run_km: 7.2,
  strength_completion_rate: 0.58, stations_covered_21d: 3, stimulus_adherence_4w: 0.79,
  recovery_signal: 0.61, observed_days: 22,
};

describe('Progress view', () => {
  test('hours read as minutes under an hour, then h and mm', () => {
    assert.equal(hoursText(42), '42 min');
    assert.equal(hoursText(197), '3 h 17');
    assert.equal(hoursText(60), '1 h 00');
  });

  test('the month grid starts on Monday and marks today', () => {
    // October 2026 starts on a Thursday.
    const grid = monthGrid('2026-10', [s('2026-10-29', 41)], '2026-10-30');
    assert.equal(grid.length % 7, 0);
    assert.equal(grid.findIndex(c => c.day === 1), 3);
    assert.equal(grid.find(c => c.day === 29)!.sessions.length, 1);
    assert.equal(grid.find(c => c.day === 30)!.isToday, true);
    assert.equal(grid.find(c => c.day === 31)!.future, true);
    assert.equal(monthGrid('2026-12', [], '2026-12-01').filter(c => c.day).length, 31);
  });

  test('the month summary counts the month only', () => {
    const list = [s('2026-10-29', 41), s('2026-10-02', 30), s('2026-09-30', 60)];
    assert.equal(monthSummary('2026-10', list).text, '2 sessions · 1 h 11');
    assert.equal(monthSummary('2026-11', list).text, 'No sessions yet');
  });

  test('weekly minutes stack by kind, oldest first, and include empty weeks', () => {
    const list = [s('2026-10-29', 40, 'run'), s('2026-10-27', 60, 'lift'), s('2026-10-20', 30, 'run')];
    const kindOf = (x: IndexSession) => (x.template_id === 'lift' ? 'strength' : 'run') as const;
    const weeks = weeklyMinutes(list, '2026-10-30', kindOf, 3);
    assert.deepEqual(weeks.map(w => w.week), ['2026-10-12', '2026-10-19', '2026-10-26']);
    assert.deepEqual(weeks.map(w => w.total), [0, 30, 100]);
    assert.deepEqual(weeks[2].byKind.map(k => k.kind), ['run', 'strength']);
  });

  test('readiness change compares week averages, never single days', () => {
    const trend = [
      point('2026-09-28', 46), point('2026-09-30', 48),   // week of Sep 28: 47
      point('2026-10-26', 60), point('2026-10-29', 64),   // this week: 62
    ];
    const change = readinessChange(trend, '2026-10-30');
    assert.deepEqual(change, { now: 62, from: 47, delta: 15, weeks: 4 });
    assert.equal(changeText(change!), '↑ 15 in 4 weeks');
    assert.equal(changeText({ delta: -3, weeks: 4 }), '↓ 3 in 4 weeks');
    assert.equal(readinessChange([point('2026-10-29', 64)], '2026-10-30'), null);
  });

  test('the projection needs three weeks and stays on the scale', () => {
    const weekly = weeklyReadiness([point('2026-10-12', 50), point('2026-10-19', 55), point('2026-10-26', 60)]);
    assert.equal(projectTo(weekly.slice(0, 2), '2026-12-28'), null);
    assert.equal(projectTo(weekly, '2026-11-09'), 70);
    assert.equal(projectTo(weekly, '2027-06-07'), 100);
  });

  test('each area shows its inputs against the model\'s own targets', () => {
    const aerobic = areaInputs('aerobic', INPUTS, TARGETS);
    assert.deepEqual(aerobic.inputs.map(i => [i.value, i.pct]), [['228 of 300', 76], ['2 of 4', 50]]);
    assert.deepEqual(areaInputs('running', INPUTS, TARGETS).inputs[1].value, '7.2 of 12 km');
    assert.match(gapReason('stations', INPUTS, TARGETS), /^3 of 8 race stations.*other 5/);
  });

  test('a capability shows a direction only with two readings behind it', () => {
    assert.deepEqual(capabilityTile(undefined, undefined), { kind: 'building', steps: 0, note: 'Needs a first session' });
    const baseline = { readings: [], lifts: [], series: [],
      baseline: { date: '2026-10-29', session_id: 'a', session_name: 'Lower' } };
    assert.equal((capabilityTile(undefined, baseline) as any).steps, 1);
    const one = { ...baseline, readings: [{ date: '2026-10-30', direction: 'positive' as const,
      band: 'small' as const, confidence: 'low' as const, session_id: 'b', session_name: null }] };
    assert.equal((capabilityTile({ capability_key: 'lower_body_strength', direction: 'neutral',
      confidence: 'low', samples: 1, agreeing: 0 }, one) as any).note, 'First reading · 1 more');
    assert.deepEqual(capabilityTile({ capability_key: 'lower_body_strength', direction: 'positive',
      confidence: 'medium', samples: 3, agreeing: 2 }, one),
      { kind: 'direction', dir: 'up', dots: 2, word: 'Improving' });
  });

  test('month totals follow the filter', () => {
    const list = [s('2026-10-29', 40, 'run'), s('2026-10-27', 60, 'lift')];
    const kindOf = (x: IndexSession) => (x.template_id === 'lift' ? 'strength' : 'run') as const;
    assert.equal(monthTotals('2026-10', list, kindOf, 'all'), '2 sessions · 1 h 40');
    assert.equal(monthTotals('2026-10', list, kindOf, 'run'), '1 session · 40 min');
  });

  test('round splits group laps by round and say where the time went', () => {
    const lap = (round: number, label: string, seconds: number) =>
      ({ label, seconds, rest: false, block_order: 2, round });
    const splits = [
      { label: 'Warm-up', seconds: 300, rest: false, block_order: 1, round: 1 },
      lap(1, 'Run', 292), lap(1, 'Wall balls', 120), { label: 'Rest', seconds: 60, rest: true, block_order: 2, round: 1 },
      lap(2, 'Run', 300), lap(2, 'Wall balls', 170),
    ];
    const table = roundTable(splits, x => (x.label === 'Run' ? 'Run' : 'Stations'))!;
    assert.deepEqual(table.columns, ['Run', 'Stations']);
    assert.deepEqual(table.rows.map(r => r.total), [412, 470]);
    assert.equal(table.summary, 'Round 2 was 0:58 slower than round 1, and 50 s of that was the stations.');
    assert.equal(roundTable([splits[0]], () => 'Run'), null);
  });

  test('weeks start on Monday', () => {
    assert.equal(weekOf('2026-11-01'), '2026-10-26');
  });
});
