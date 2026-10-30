/**
 * Capability evidence from cardio: what Running speed, Aerobic endurance and
 * the cardio race stations are read from.
 *
 * The same safeguards as the strength reader are pinned here, because a pace is
 * as noisy as a top set: a first session is a baseline, a reduced dose is not a
 * reading, and only comparable sessions (same exercise, same distance, similar
 * effort) are compared at all.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cardioCapabilityFor, cardioReadings, evidenceFromSession, type CardioSession,
} from './evidence.ts';
import type { CardioLogRow } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString();

const session = (id: string, daysAgo: number, over: Partial<CardioSession> = {}): CardioSession => ({
  id, started_at: at(daysAgo), session_rpe: 7, context: 'full', ...over,
});

/** One effort: `meters` in `seconds`. */
const effort = (session_id: string, meters: number, seconds: number, exercise_id = 'ex_run'): CardioLogRow => ({
  session_id, exercise_id, distance_meters: meters, duration_seconds: seconds,
});

const MODALITY = new Map<string, string | null>([
  ['ex_run', 'running'], ['ex_spin_bike', 'bike'], ['ex_skierg', 'ski'], ['ex_rowerg', 'row'],
  ['ex_boxing_bag', 'boxing'],
]);

const read = (sessionId: string, sessions: CardioSession[], logs: CardioLogRow[]) =>
  cardioReadings({ sessionId, sessions, cardioLogs: logs, modality: MODALITY });

describe('Which capability a cardio effort speaks to', () => {
  test('short run repeats are running speed', () => {
    assert.equal(cardioCapabilityFor('ex_run', 'running', 1000), 'running_threshold');
    assert.equal(cardioCapabilityFor('ex_run', 'running', 2000), 'running_threshold');
  });

  test('a long run is aerobic endurance', () => {
    assert.equal(cardioCapabilityFor('ex_run', 'running', 5000), 'aerobic_durability');
  });

  test('a cardio race station is judged as a station', () => {
    assert.equal(cardioCapabilityFor('ex_skierg', 'ski', 1000), 'station_proficiency');
    assert.equal(cardioCapabilityFor('ex_rowerg', 'row', 1000), 'station_proficiency');
  });

  test('other cardio is aerobic, and what is not cardio says nothing', () => {
    assert.equal(cardioCapabilityFor('ex_spin_bike', 'bike', 5000), 'aerobic_durability');
    assert.equal(cardioCapabilityFor('ex_boxing_bag', 'boxing', 1000), null);
  });
});

describe('Cardio readings', () => {
  test('a first session at a distance is a baseline and reads nothing', () => {
    assert.deepEqual(read('s1', [session('s1', 0)], [effort('s1', 1000, 300)]), []);
  });

  test('faster repeats than the last comparable session are positive running speed', () => {
    const r = read('s2', [session('s1', 7), session('s2', 0)], [
      effort('s1', 1000, 300), effort('s1', 1000, 302),
      effort('s2', 1000, 288), effort('s2', 1000, 290),
    ]);
    assert.equal(r.length, 1);
    assert.equal(r[0].capability_key, 'running_threshold');
    assert.equal(r[0].reading.direction, 'positive');
    assert.equal(r[0].reading.band, 'moderate');   // about 4% faster
    assert.equal(r[0].reading.confidence, 'low');  // two sessions is a comparison
  });

  test('slower is negative, and a change inside timing noise is neutral', () => {
    const slower = read('s2', [session('s1', 7), session('s2', 0)],
      [effort('s1', 1000, 300), effort('s2', 1000, 315)]);
    assert.equal(slower[0].reading.direction, 'negative');

    const same = read('s2', [session('s1', 7), session('s2', 0)],
      [effort('s1', 1000, 300), effort('s2', 1000, 299)]);
    assert.equal(same[0].reading.direction, 'neutral');
  });

  test('one blown interval does not become the session', () => {
    // Median of the session's repeats, as the pace trend reads it.
    const r = read('s2', [session('s1', 7), session('s2', 0)], [
      effort('s1', 1000, 300), effort('s1', 1000, 300), effort('s1', 1000, 300),
      effort('s2', 1000, 290), effort('s2', 1000, 291), effort('s2', 1000, 420),
    ]);
    assert.equal(r[0].reading.direction, 'positive');
  });

  test('a different distance is not a comparison', () => {
    const r = read('s2', [session('s1', 7), session('s2', 0)],
      [effort('s1', 400, 100), effort('s2', 1000, 290)]);
    assert.deepEqual(r, []);
  });

  test('a different effort is not a comparison', () => {
    // RPE 9 against RPE 6: a faster pace at a much harder effort is not a gain.
    const r = read('s2', [session('s1', 7, { session_rpe: 6 }), session('s2', 0, { session_rpe: 9 })],
      [effort('s1', 1000, 300), effort('s2', 1000, 280)]);
    assert.deepEqual(r, []);
  });

  test('a reduced session reads nothing and is never the baseline', () => {
    const sessions = [
      session('s1', 14), session('s2', 7, { context: 'reduced' }), session('s3', 0),
    ];
    // s3 is slower than the full s1 and faster than the reduced s2, so which
    // one it is compared against decides the answer.
    const logs = [effort('s1', 1000, 300), effort('s2', 1000, 330), effort('s3', 1000, 310)];
    assert.deepEqual(read('s2', sessions, logs), [], 'the reduced session itself');
    const r = read('s3', sessions, logs);
    assert.equal(r[0].reading.direction, 'negative', 'compared to s1, not the slow reduced s2');
  });

  test('a long run feeds aerobic endurance', () => {
    const r = read('s2', [session('s1', 7), session('s2', 0)],
      [effort('s1', 5000, 1650), effort('s2', 5000, 1590)]);
    assert.equal(r[0].capability_key, 'aerobic_durability');
    assert.equal(r[0].reading.direction, 'positive');
  });

  test('confidence rises with comparable sessions behind the reading', () => {
    const sessions = [0, 1, 2, 3, 4].map(i => session(`s${i}`, 28 - i * 7));
    const logs = sessions.map((s, i) => effort(s.id, 1000, 310 - i * 3));
    assert.equal(read('s4', sessions, logs)[0].reading.confidence, 'high');
    assert.equal(read('s2', sessions, logs)[0].reading.confidence, 'medium');
  });
});

describe('Cardio rows', () => {
  test('a run-only session writes its capability row', () => {
    const cardio = read('s2', [session('s1', 7), session('s2', 0)],
      [effort('s1', 1000, 300), effort('s2', 1000, 288)]);
    const rows = evidenceFromSession({ sessionId: 's2', exposures: [], ontology: new Map(), cardio });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].capability_key, 'running_threshold');
    assert.equal(rows[0].direction, 'positive');
    assert.equal(rows[0].source_session_id, 's2');
  });

  test('two stations that disagree write one neutral station row', () => {
    const cardio = read('s2', [session('s1', 7), session('s2', 0)], [
      effort('s1', 1000, 240, 'ex_skierg'), effort('s1', 1000, 230, 'ex_rowerg'),
      effort('s2', 1000, 225, 'ex_skierg'), effort('s2', 1000, 245, 'ex_rowerg'),
    ]);
    const rows = evidenceFromSession({ sessionId: 's2', exposures: [], ontology: new Map(), cardio });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].capability_key, 'station_proficiency');
    assert.equal(rows[0].direction, 'neutral');
  });
});
