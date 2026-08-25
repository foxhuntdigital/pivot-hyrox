/**
 * These stats replaced a fixture, so what is pinned here is mostly the rule
 * that made replacing it worthwhile: nothing is shown that is not measured.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { metricDetailFrom } from './metric-detail.ts';
import type { TemplateFacts } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString();
const TEMPLATES = new Map<string, TemplateFacts>([
  ['t_aero', { primary_goal: 'aerobic_durability', requires_running: true, estimated_minutes: 45 }],
  ['t_thr', { primary_goal: 'threshold', requires_running: true, estimated_minutes: 40 }],
]);
const detail = (over: Partial<Parameters<typeof metricDetailFrom>[0]> = {}) =>
  metricDetailFrom({
    today: TODAY, sessions: [], setLogs: [], cardioLogs: [],
    templates: TEMPLATES, checkins: [], queue: [], ...over,
  });
const keys = (d: ReturnType<typeof detail>, k: string) => d[k].stats.map(s => s.k);
const val = (d: ReturnType<typeof detail>, k: string, stat: string) =>
  d[k].stats.find(s => s.k === stat)?.v;

describe('Progress metric detail', () => {
  test('an athlete with no history gets no stats at all, not zeroes', () => {
    const d = detail();
    for (const k of ['aerobic', 'running', 'strength', 'stations', 'consistency', 'recovery']) {
      assert.deepEqual(d[k].stats, [], `${k} should be empty`);
    }
  });

  test('Z2 pace uses easy aerobic runs only, and is a median', () => {
    const sessions = [
      { id: 'a', template_id: 't_aero', started_at: at(2), ended_at: null },
      { id: 'b', template_id: 't_aero', started_at: at(4), ended_at: null },
      { id: 'c', template_id: 't_thr', started_at: at(3), ended_at: null },
    ];
    const d = detail({
      sessions,
      cardioLogs: [
        { session_id: 'a', exercise_id: 'ex_run', distance_meters: 5000, duration_seconds: 5 * 330 },
        { session_id: 'b', exercise_id: 'ex_run', distance_meters: 5000, duration_seconds: 5 * 350 },
        // A threshold run is faster and must not drag the easy-pace figure down.
        { session_id: 'c', exercise_id: 'ex_run', distance_meters: 5000, duration_seconds: 5 * 240 },
      ],
    });
    assert.equal(val(d, 'aerobic', 'Z2 pace'), '5:40/km');
  });

  test('station times normalise to the race distance so repeats compare', () => {
    const d = detail({
      sessions: [{ id: 'a', template_id: 't_aero', started_at: at(2), ended_at: null }],
      cardioLogs: [
        { session_id: 'a', exercise_id: 'ex_rowerg', distance_meters: 500, duration_seconds: 100 },
        { session_id: 'a', exercise_id: 'ex_rowerg', distance_meters: 1000, duration_seconds: 220 },
      ],
    });
    assert.equal(val(d, 'stations', 'Row 1k'), '3:20', '500m in 100s is the better 1k pace');
  });

  test('a lift with no logged load is left out rather than shown as zero', () => {
    const d = detail({
      sessions: [{ id: 'a', template_id: 't_aero', started_at: at(2), ended_at: null }],
      setLogs: [
        { session_id: 'a', exercise_id: 'ex_back_squat', prescribed_reps: 5, actual_reps: 5, actual_load: 120, load_unit: 'kg' },
        { session_id: 'a', exercise_id: 'ex_deadlift', prescribed_reps: 5, actual_reps: 5, actual_load: null, load_unit: 'kg' },
      ],
    });
    assert.deepEqual(keys(d, 'strength'), ['Squat']);
    assert.equal(val(d, 'strength', 'Squat'), '120 kg');
  });

  test('30d load needs a session RPE, and skips sessions without one', () => {
    const d = detail({
      sessions: [
        { id: 'a', template_id: 't_aero', started_at: at(2), ended_at: null, session_rpe: 5 },
        { id: 'b', template_id: 't_aero', started_at: at(3), ended_at: null, session_rpe: null },
      ],
    });
    assert.equal(val(d, 'aerobic', '30d load'), '225', '5 x 45 min, the unrated session excluded');
  });

  test('HR drift is never reported — one average per log cannot show drift', () => {
    const d = detail({
      sessions: [{ id: 'a', template_id: 't_aero', started_at: at(2), ended_at: null }],
      cardioLogs: [{ session_id: 'a', exercise_id: 'ex_run', distance_meters: 5000, duration_seconds: 1500, avg_hr: 150 }],
    });
    assert.ok(!keys(d, 'aerobic').includes('HR drift'));
  });

  test('recovery reports what was actually checked in', () => {
    const d = detail({
      checkins: [
        { local_date: '2026-02-28', sleep_hours: 7, energy: 'normal' },
        { local_date: '2026-02-27', sleep_hours: 6, energy: 'low' },
        { local_date: '2026-01-01', sleep_hours: 4, energy: 'low' },   // outside 14d
      ],
    });
    assert.equal(val(d, 'recovery', 'Sleep'), '6.5 h');
    assert.equal(val(d, 'recovery', 'Check-ins'), '2/14');
  });
});
