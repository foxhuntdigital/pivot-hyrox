/**
 * Progress lays out what the logs and the evidence already say. What is pinned
 * here is that the layout cannot say more: a lift is measured only against its
 * own comparable sessions, a reduced dose never counts, and a highlight needs
 * two comparable sessions before it draws a line.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Exposure, ExerciseHistory } from './exercise-history.ts';
import {
  capabilityDetails, cardioBaselines, highlightsFrom, sessionIndex, trendFrom, weekOf,
} from './progress-view.ts';

const exposure = (over: Partial<Exposure>): Exposure => ({
  session_id: 's', date: '2026-09-07', exercise_id: 'ex_back_squat',
  top_load: 100, load_unit: 'kg', top_reps: 5, sets: 3, total_reps: 15,
  reps_min: 5, reps_max: 5, rpe: 8, all_sets_completed: true, excluded_sets: 0,
  context: 'full', ...over,
});
const historyOf = (id: string, exposures: Exposure[]): ExerciseHistory =>
  ({ exercise_id: id, exposures, excluded: 0, window_days: 120 });

const ONTOLOGY = new Map([
  ['ex_back_squat', { movement_families: ['squat'] }],
  ['ex_rdl', { movement_families: ['hinge'] }],
]);
const NAMES = new Map([['ex_back_squat', 'Back squat'], ['ex_rdl', 'Romanian deadlift']]);
const SESSIONS = new Map([['a', 'Lower A'], ['b', 'Lower B'], ['c', 'Lower C'], ['d', 'Micro']]);

describe('Progress view', () => {
  test('weeks start on Monday', () => {
    assert.equal(weekOf('2026-10-31'), '2026-10-26');   // a Saturday
    assert.equal(weekOf('2026-10-26'), '2026-10-26');
    assert.equal(weekOf('2026-11-01'), '2026-10-26');   // a Sunday
  });

  test('the session index uses the clock, then the plan, and the local date', () => {
    const [clocked, planned] = sessionIndex([
      { id: '1', template_id: 't', started_at: '2026-10-30T23:30:00Z', ended_at: '2026-10-31T00:15:00Z',
        local_date: '2026-10-30', name: 'Run', estimated_minutes: 40 },
      { id: '2', template_id: 't', started_at: '2026-10-29T10:00:00Z', ended_at: null,
        estimated_minutes: '30', workout_role: 'supplemental' },
    ]);
    assert.equal(clocked.minutes, 45);
    assert.equal(clocked.date, '2026-10-30');
    assert.equal(planned.minutes, 30);
    assert.equal(planned.supplemental, true);
    assert.equal(planned.name, 't');
  });

  test('the trend is oldest first', () => {
    const t = trendFrom([
      { local_date: '2026-10-02', overall: 50, confidence: 'low', components_json: null },
      { local_date: '2026-10-01', overall: 47, confidence: 'low',
        components_json: { components: { aerobic: 40 }, observed: ['aerobic'] } },
    ]);
    assert.deepEqual(t.map(p => p.overall), [47, 50]);
    assert.deepEqual(t[0].observed, ['aerobic']);
  });

  test('each lift is measured on its own baseline, and a reduced dose never counts', () => {
    const histories = new Map([
      ['ex_back_squat', historyOf('ex_back_squat', [
        exposure({ session_id: 'a', date: '2026-09-07', top_load: 100 }),
        exposure({ session_id: 'b', date: '2026-09-14', top_load: 105 }),
        // Lighter by design; would read as a dip if it counted.
        exposure({ session_id: 'd', date: '2026-09-16', top_load: 60, context: 'reduced' }),
        exposure({ session_id: 'c', date: '2026-09-21', top_load: 110 }),
      ])],
      ['ex_rdl', historyOf('ex_rdl', [
        exposure({ session_id: 'b', date: '2026-09-14', exercise_id: 'ex_rdl', top_load: 80, reps_min: 8, reps_max: 8, top_reps: 8 }),
        exposure({ session_id: 'c', date: '2026-09-21', exercise_id: 'ex_rdl', top_load: 84, reps_min: 8, reps_max: 8, top_reps: 8 }),
      ])],
    ]);
    const detail = capabilityDetails({
      histories, ontology: ONTOLOGY, exerciseNames: NAMES, sessionNames: SESSIONS, evidence: [],
    }).lower_body_strength;

    assert.deepEqual(detail.series.map(p => p.pct), [0, 3, 8]);   // (5+0)/2, (10+5)/2
    assert.equal(detail.baseline?.session_name, 'Lower A');
    assert.equal(detail.lifts[0].name, 'Back squat');
    assert.equal(detail.lifts[0].start, 100);
    assert.equal(detail.lifts[0].now, 110);
    assert.match(detail.series[1].detail, /Back squat 100 to 105 kg for 5/);
    assert.match(detail.series[1].detail, /Romanian deadlift 80 kg for 8, the first time/);
  });

  test('a session at a different rep range is not compared', () => {
    const histories = new Map([['ex_back_squat', historyOf('ex_back_squat', [
      exposure({ session_id: 'a', date: '2026-09-07', top_load: 100 }),
      exposure({ session_id: 'b', date: '2026-09-14', top_load: 70, reps_min: 15, reps_max: 15 }),
    ])]]);
    const detail = capabilityDetails({
      histories, ontology: ONTOLOGY, exerciseNames: NAMES, sessionNames: SESSIONS, evidence: [],
    }).lower_body_strength;
    assert.deepEqual(detail.series.map(p => p.pct), [0]);
  });

  test('readings carry the session they were read from', () => {
    const detail = capabilityDetails({
      histories: new Map(), ontology: ONTOLOGY, exerciseNames: NAMES, sessionNames: SESSIONS,
      evidence: [{ capability_key: 'running_threshold', direction: 'positive', magnitude_band: 'small',
        confidence_band: 'low', source_session_id: 'a', created_at: '2026-10-01T10:00:00Z' }],
    }).running_threshold;
    assert.deepEqual(detail.readings[0], {
      date: '2026-10-01', direction: 'positive', band: 'small', confidence: 'low',
      session_id: 'a', session_name: 'Lower A',
    });
    assert.deepEqual(detail.series, []);
  });

  test('a highlight needs two comparable sessions', () => {
    const one = new Map([['ex_back_squat', historyOf('ex_back_squat', [exposure({ session_id: 'a' })])]]);
    const none = highlightsFrom({
      comparable: null, histories: one, ontology: ONTOLOGY, exerciseNames: NAMES, sessions: [],
    });
    assert.equal(none.lift, null);
    assert.equal(none.pace, null);

    const two = new Map([['ex_back_squat', historyOf('ex_back_squat', [
      exposure({ session_id: 'a', date: '2026-09-07', top_load: 100 }),
      exposure({ session_id: 'b', date: '2026-09-14', top_load: 105 }),
    ])]]);
    const some = highlightsFrom({
      comparable: null, histories: two, ontology: ONTOLOGY, exerciseNames: NAMES,
      sessions: [{ id: 'b', date: '2026-09-14' }, { id: 'a', date: '2026-09-07' }],
    });
    assert.deepEqual(some.lift?.points.map(p => p.load), [100, 105]);
    assert.equal(some.record?.exercise, 'Back squat');
    assert.equal(some.record?.previous, 100);
  });
  test('a first full cardio session is a baseline, so the tracker can say so', () => {
    const run = (id: string, day: string, variant = 'green') =>
      ({ id, template_id: 't', variant_code: variant, started_at: `${day}T09:00:00Z`, ended_at: null });
    const lap = (session_id: string, meters: number) =>
      ({ session_id, exercise_id: 'ex_run', distance_meters: meters, duration_seconds: meters * 0.28 });
    const baselines = cardioBaselines({
      // The reduced session is earlier, and never a baseline.
      sessions: [run('micro', '2026-10-20', 'red'), run('a', '2026-10-29'), run('b', '2026-10-30')],
      cardioLogs: [lap('micro', 1000), lap('a', 1000), lap('b', 1000), lap('b', 5000)],
      modality: new Map([['ex_run', 'running']]),
    });
    assert.deepEqual(baselines.get('running_threshold'), { date: '2026-10-29', session_id: 'a' });
    assert.deepEqual(baselines.get('aerobic_durability'), { date: '2026-10-30', session_id: 'b' });

    const detail = capabilityDetails({
      histories: new Map(), ontology: ONTOLOGY, exerciseNames: NAMES, sessionNames: new Map([['a', 'Tempo 3x6']]),
      evidence: [], cardio: baselines,
    }).running_threshold;
    assert.deepEqual(detail.baseline, { date: '2026-10-29', session_id: 'a', session_name: 'Tempo 3x6' });
  });
});
