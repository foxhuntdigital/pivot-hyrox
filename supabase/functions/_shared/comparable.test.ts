/**
 * The comparable-session rule is what makes a pace claim honest, so what is
 * pinned here is the rule refusing: sessions that were not alike must not end
 * up on the same trend line, and a set that does not qualify must come back
 * null rather than as a weaker comparison.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { comparableSeries } from './comparable.ts';
import type { CardioLogRow, SessionRow } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString();

const session = (id: string, daysAgo: number, rpe: number | null): SessionRow => ({
  id, template_id: 't_thr', started_at: at(daysAgo), ended_at: at(daysAgo), session_rpe: rpe,
});

const log = (
  session_id: string, distance_meters: number, pace: number, avg_hr: number | null = null,
): CardioLogRow => ({
  session_id,
  exercise_id: 'ex_run',
  distance_meters,
  duration_seconds: Math.round(pace * (distance_meters / 1000)),
  pace_seconds_per_km: pace,
  avg_hr,
});

const run = (sessions: SessionRow[], cardioLogs: CardioLogRow[]) =>
  comparableSeries({ today: TODAY, sessions, cardioLogs });

describe('Comparable sessions', () => {
  test('trends repeats at the same distance and effort', () => {
    const set = run(
      [session('a', 14, 7), session('b', 7, 7)],
      [log('a', 1000, 271), log('b', 1000, 258)],
    );
    assert.ok(set);
    assert.equal(set.runs.length, 2);
    assert.equal(set.distance_meters, 1000);
    // Oldest first, so a trend reads left to right.
    assert.equal(set.runs[0].pace_seconds, 271);
    assert.equal(set.runs[1].pace_seconds, 258);
  });

  test('a single session is not a trend', () => {
    const set = run([session('a', 7, 7)], [log('a', 1000, 264)]);
    assert.equal(set, null);
  });

  test('a different repeat distance is a different measurement', () => {
    const set = run(
      [session('a', 14, 7), session('b', 7, 7)],
      [log('a', 1000, 271), log('b', 400, 230)],
    );
    // One qualifying session per band, so neither band reaches two.
    assert.equal(set, null);
  });

  test('a session at a different effort is excluded, and counted', () => {
    const set = run(
      [session('a', 20, 7), session('b', 14, 7), session('c', 5, 3)],
      [log('a', 1000, 271), log('b', 1000, 265), log('c', 1000, 320)],
    );
    assert.ok(set);
    assert.equal(set.runs.length, 2, 'the easy run does not join the threshold trend');
    assert.equal(set.excluded, 1, 'and it is counted rather than dropped silently');
  });

  test('a session outside the window does not count', () => {
    const set = run(
      [session('a', 40, 7), session('b', 7, 7)],
      [log('a', 1000, 271), log('b', 1000, 258)],
    );
    assert.equal(set, null);
  });

  test('one blown interval does not become the session pace', () => {
    const set = run(
      [session('a', 14, 7), session('b', 7, 7)],
      [log('a', 1000, 270), log('b', 1000, 260), log('b', 1000, 262), log('b', 1000, 400)],
    );
    assert.ok(set);
    assert.equal(set.runs[1].pace_seconds, 262, 'the median of the three, not the mean');
  });

  test('distance near a band still counts as that band', () => {
    const set = run(
      [session('a', 14, 7), session('b', 7, 7)],
      // A GPS-measured "1 km" repeat rarely lands on exactly 1000 m.
      [log('a', 1012, 271), log('b', 994, 258)],
    );
    assert.ok(set);
    assert.equal(set.distance_meters, 1000);
    assert.equal(set.runs.length, 2);
  });

  test('pace is derived when the log did not carry one', () => {
    const noPace = (id: string): CardioLogRow => ({
      session_id: id,
      exercise_id: 'ex_run',
      distance_meters: 1000,
      duration_seconds: 260,
      pace_seconds_per_km: null,
      avg_hr: null,
    });
    const set = run([session('a', 14, 7), session('b', 7, 7)], [noPace('a'), noPace('b')]);
    assert.ok(set);
    assert.equal(set.runs[0].pace_seconds, 260);
  });

  test('heart rate is carried where it was logged, and null where it was not', () => {
    const set = run(
      [session('a', 14, 7), session('b', 7, 7)],
      [log('a', 1000, 271, 172), log('b', 1000, 258)],
    );
    assert.ok(set);
    assert.equal(set.runs[0].hr, 172);
    assert.equal(set.runs[1].hr, null);
  });

  test('with no RPE logged anywhere, effort is simply not asserted', () => {
    const set = run(
      [session('a', 14, null), session('b', 7, null)],
      [log('a', 1000, 271), log('b', 1000, 258)],
    );
    assert.ok(set, 'a set with no RPE still trends — it just cannot claim matched effort');
    assert.equal(set.runs.length, 2);
  });
});
