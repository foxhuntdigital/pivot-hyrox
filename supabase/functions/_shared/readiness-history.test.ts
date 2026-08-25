/**
 * The readiness aggregation is the difference between a live account showing a
 * real score and showing four flat bars, so its arithmetic is pinned here.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readinessInputsFrom, WINDOWS, type TemplateFacts } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (daysAgo: number, h = 9) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86_400_000 + h * 3_600_000).toISOString();

const TEMPLATES = new Map<string, TemplateFacts>([
  ['t_aerobic', { primary_goal: 'aerobic_durability', requires_running: true, estimated_minutes: 45 }],
  ['t_threshold', { primary_goal: 'threshold', requires_running: false, estimated_minutes: 40 }],
  ['t_strength', { primary_goal: 'strength', requires_running: false, estimated_minutes: 50 }],
]);

const inputs = (over: Partial<Parameters<typeof readinessInputsFrom>[0]> = {}) =>
  readinessInputsFrom({
    today: TODAY, sessions: [], setLogs: [], cardioLogs: [],
    templates: TEMPLATES, stimulus_adherence_4w: 0, recovery_signal: 0, ...over,
  });

describe('Readiness history aggregation', () => {
  test('an athlete with no history scores zero without throwing', () => {
    const i = inputs();
    assert.equal(i.aerobic_minutes_14d, 0);
    assert.equal(i.observed_days, 0);
    assert.equal(i.strength_completion_rate, 0);
  });

  test('aerobic minutes use elapsed time, not the scheduled length', () => {
    const i = inputs({
      sessions: [{ id: 's1', template_id: 't_aerobic', started_at: at(2, 9), ended_at: at(2, 10) }],
    });
    assert.equal(i.aerobic_minutes_14d, 60);   // 45 was the prescription
  });

  test('a session with no end time falls back to its scheduled length', () => {
    const i = inputs({
      sessions: [{ id: 's1', template_id: 't_aerobic', started_at: at(2), ended_at: null }],
    });
    assert.equal(i.aerobic_minutes_14d, 45);
  });

  test('a timer left running overnight does not become a five hour session', () => {
    const i = inputs({
      sessions: [{ id: 's1', template_id: 't_aerobic', started_at: at(2, 9), ended_at: at(1, 9) }],
    });
    assert.equal(i.aerobic_minutes_14d, 45, 'implausible elapsed time is rejected');
  });

  test('each window only counts what falls inside it', () => {
    const sessions = [
      { id: 'a', template_id: 't_aerobic', started_at: at(3), ended_at: null },
      { id: 'b', template_id: 't_aerobic', started_at: at(20), ended_at: null },   // outside 14d
      { id: 'c', template_id: 't_threshold', started_at: at(5), ended_at: null },
      { id: 'd', template_id: 't_threshold', started_at: at(15), ended_at: null }, // outside 14d
    ];
    const i = inputs({ sessions });
    assert.equal(i.aerobic_minutes_14d, 45);
    assert.equal(i.threshold_sessions_14d, 1);
    assert.equal(i.run_sessions_7d, 1, 'only the aerobic run inside 7 days');
  });

  test('longest run is the longest single effort, not the weekly total', () => {
    const i = inputs({
      sessions: [{ id: 's1', template_id: 't_aerobic', started_at: at(2), ended_at: null }],
      cardioLogs: [
        { session_id: 's1', exercise_id: 'ex_run', distance_meters: 5000, duration_seconds: 1500 },
        { session_id: 's1', exercise_id: 'ex_run', distance_meters: 8200, duration_seconds: 2400 },
        { session_id: 's1', exercise_id: 'ex_rowerg', distance_meters: 20000, duration_seconds: 3000 },
      ],
    });
    assert.equal(i.longest_run_km, 8.2, 'not 13.2, and the row is not a run');
  });

  test('strength completion caps each set so overshooting cannot hide a miss', () => {
    const i = inputs({
      sessions: [{ id: 's1', template_id: 't_strength', started_at: at(2), ended_at: null }],
      setLogs: [
        { session_id: 's1', exercise_id: 'ex_back_squat', prescribed_reps: 10, actual_reps: 20 },
        { session_id: 's1', exercise_id: 'ex_back_squat', prescribed_reps: 10, actual_reps: 0 },
      ],
    });
    assert.equal(i.strength_completion_rate, 0.5, 'a doubled set and a missed set is half, not full');
  });

  test('stations count distinct race stations, from either log table', () => {
    const i = inputs({
      sessions: [{ id: 's1', template_id: 't_strength', started_at: at(10), ended_at: null }],
      setLogs: [
        { session_id: 's1', exercise_id: 'ex_wall_ball', prescribed_reps: 10, actual_reps: 10 },
        { session_id: 's1', exercise_id: 'ex_wall_ball', prescribed_reps: 10, actual_reps: 10 },
        { session_id: 's1', exercise_id: 'ex_back_squat', prescribed_reps: 5, actual_reps: 5 },
      ],
      cardioLogs: [{ session_id: 's1', exercise_id: 'ex_skierg', distance_meters: 1000, duration_seconds: 300 }],
    });
    assert.equal(i.stations_covered_21d, 2, 'wall ball once, skierg once, back squat is not a station');
  });

  test('confidence counts days trained, not sessions', () => {
    const i = inputs({
      sessions: [
        { id: 'a', template_id: 't_aerobic', started_at: at(3, 8), ended_at: null },
        { id: 'b', template_id: 't_strength', started_at: at(3, 18), ended_at: null },
        { id: 'c', template_id: 't_strength', started_at: at(4), ended_at: null },
      ],
    });
    assert.equal(i.observed_days, 2, 'two sessions in one day is one day of evidence');
  });

  test('logs belonging to a session outside the window are ignored', () => {
    const i = inputs({
      sessions: [{ id: 'old', template_id: 't_strength', started_at: at(WINDOWS.strength + 5), ended_at: null }],
      setLogs: [{ session_id: 'old', exercise_id: 'ex_back_squat', prescribed_reps: 10, actual_reps: 10 }],
    });
    assert.equal(i.strength_completion_rate, 0);
  });

  test('adherence and recovery are passed through, not recomputed', () => {
    const i = inputs({ stimulus_adherence_4w: 0.83, recovery_signal: 0.6 });
    assert.equal(i.stimulus_adherence_4w, 0.83);
    assert.equal(i.recovery_signal, 0.6);
  });
});
