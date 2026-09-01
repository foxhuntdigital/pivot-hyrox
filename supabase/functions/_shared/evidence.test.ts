/**
 * The safeguard in 0013 is that one session cannot move the athlete's state, so
 * that is what is pinned here: a first exposure writes nothing, a single moving
 * row derives no change, and a session that trained four lower-body movements
 * still writes one lower-body row.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evidenceFromSession, capabilityState, capabilityFor, REPEATS_FOR_CHANGE,
} from './evidence.ts';
import type { StoredEvidence } from './evidence.ts';
import { exerciseHistory } from './exercise-history.ts';
import type { StrengthSetRow } from './exercise-history.ts';
import { personalRecordsIn } from './prs.ts';
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

const ONTOLOGY = new Map([
  ['ex_back_squat', { movement_families: ['squat'] }],
  ['ex_romanian_deadlift', { movement_families: ['hinge'] }],
  ['ex_bench_press', { movement_families: ['horizontal_push'] }],
  ['ex_sled_push', { movement_families: ['sled_resisted_locomotion'] }],
]);

function evidence(sessionId: string, sessions: SessionRow[], logs: StrengthSetRow[]) {
  const histories = exerciseHistory({ today: TODAY, sessions, setLogs: logs });
  const exposures = [...histories.values()].flatMap(history =>
    history.exposures.map(exposure => ({ exposure, history })));
  return evidenceFromSession({ sessionId, exposures, ontology: ONTOLOGY });
}

describe('Capability mapping', () => {
  test('movement family decides the capability', () => {
    assert.equal(capabilityFor('ex_back_squat', { movement_families: ['squat'] }), 'lower_body_strength');
    assert.equal(capabilityFor('ex_bench_press', { movement_families: ['horizontal_push'] }), 'upper_body_strength');
  });

  test('a race station is judged as a station, whatever it also trains', () => {
    assert.equal(
      capabilityFor('ex_sled_push', { movement_families: ['sled_resisted_locomotion'] }),
      'station_proficiency');
  });

  test('an unmapped movement says nothing rather than guessing', () => {
    assert.equal(capabilityFor('ex_box_jump', { movement_families: ['jump_plyometric'] }), null);
    assert.equal(capabilityFor('ex_unknown', undefined), null);
  });
});

describe('Evidence from a session', () => {
  test('a first exposure is a baseline and writes nothing', () => {
    assert.deepEqual(evidence('a', [session('a', 1)], [set({ session_id: 'a' })]), []);
  });

  test('a heavier top set at the same rep range is positive evidence', () => {
    const rows = evidence('new',
      [session('old', 14), session('new', 3)],
      [set({ session_id: 'old', actual_load: 100 }), set({ session_id: 'new', actual_load: 110 })]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].capability_key, 'lower_body_strength');
    assert.equal(rows[0].direction, 'positive');
    assert.equal(rows[0].magnitude_band, 'large');   // 10%
    assert.equal(rows[0].confidence_band, 'low');    // two exposures is a comparison
    assert.equal(rows[0].source_session_id, 'new');
  });

  test('one row per capability, however many movements trained it', () => {
    const rows = evidence('new',
      [session('old', 14), session('new', 3)],
      [
        set({ session_id: 'old', exercise_id: 'ex_back_squat', actual_load: 100 }),
        set({ session_id: 'new', exercise_id: 'ex_back_squat', actual_load: 105 }),
        set({ session_id: 'old', exercise_id: 'ex_romanian_deadlift', actual_load: 80 }),
        set({ session_id: 'new', exercise_id: 'ex_romanian_deadlift', actual_load: 85 }),
      ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].capability_key, 'lower_body_strength');
    assert.deepEqual(rows[0].read_from.sort(), ['ex_back_squat', 'ex_romanian_deadlift']);
  });

  test('movements that disagree read as neutral — the disagreement is the reading', () => {
    const rows = evidence('new',
      [session('old', 14), session('new', 3)],
      [
        set({ session_id: 'old', exercise_id: 'ex_back_squat', actual_load: 100 }),
        set({ session_id: 'new', exercise_id: 'ex_back_squat', actual_load: 110 }),
        set({ session_id: 'old', exercise_id: 'ex_romanian_deadlift', actual_load: 100 }),
        set({ session_id: 'new', exercise_id: 'ex_romanian_deadlift', actual_load: 90 }),
      ]);

    assert.equal(rows[0].direction, 'neutral');
  });

  test('a session with an unreadable set is never high confidence', () => {
    const sessions = [session('s1', 40), session('s2', 30), session('s3', 20),
      session('s4', 10), session('new', 2)];
    const logs = sessions.map((s, i) => set({ session_id: s.id, actual_load: 100 + i * 5 }));
    logs.push(set({ session_id: 'new', set_index: 2, source: 'asserted', actual_load: null }));

    const rows = evidence('new', sessions, logs);
    assert.equal(rows[0].confidence_band, 'low');
  });
});

describe('Derived capability state', () => {
  const row = (
    direction: 'positive' | 'negative' | 'neutral', days: number,
    confidence: 'low' | 'medium' | 'high' = 'medium',
  ): StoredEvidence => ({
    capability_key: 'lower_body_strength', direction,
    magnitude_band: 'moderate', confidence_band: confidence, created_at: at(days),
  });

  test('one moving row changes nothing', () => {
    const [state] = capabilityState([row('positive', 3)]);
    assert.equal(state.direction, 'neutral');
    assert.equal(state.agreeing, 1);
  });

  test('repeated agreement is what moves it', () => {
    const [state] = capabilityState([row('positive', 3), row('positive', 10)]);
    assert.equal(state.direction, 'positive');
    assert.equal(state.agreeing, REPEATS_FOR_CHANGE);
  });

  test('the answer carries the lowest confidence behind it, not the best', () => {
    const [state] = capabilityState([row('positive', 3, 'high'), row('positive', 10, 'low')]);
    assert.equal(state.confidence, 'low');
  });

  test('a reversal does not inherit the old direction', () => {
    const [state] = capabilityState([row('negative', 2), row('positive', 20), row('positive', 30)]);
    // The most recent moving row disagrees with the older run, so nothing has
    // been shown twice in a row and the state holds.
    assert.equal(state.direction, 'neutral');
  });
});

describe('Personal records', () => {
  const histories = (sessions: SessionRow[], logs: StrengthSetRow[]) =>
    exerciseHistory({ today: TODAY, sessions, setLogs: logs });

  test('a novel movement sets no record', () => {
    assert.deepEqual(
      personalRecordsIn({ sessionId: 'a', histories: histories([session('a', 1)], [set({ session_id: 'a' })]) }),
      []);
  });

  test('a heavier top set at a comparable rep range is a record', () => {
    const prs = personalRecordsIn({
      sessionId: 'new',
      histories: histories([session('old', 14), session('new', 3)],
        [set({ session_id: 'old', actual_load: 100 }), set({ session_id: 'new', actual_load: 105 })]),
    });
    assert.equal(prs.length, 1);
    assert.equal(prs[0].kind, 'load');
    assert.equal(prs[0].value, 105);
    assert.equal(prs[0].previous, 100);
  });

  test('a different rep range does not take the record', () => {
    const prs = personalRecordsIn({
      sessionId: 'new',
      histories: histories([session('old', 14), session('new', 3)], [
        set({ session_id: 'old', actual_load: 90, prescribed_reps_min: 10, prescribed_reps_max: 10, actual_reps: 10 }),
        set({ session_id: 'new', actual_load: 100 }),
      ]),
    });
    assert.deepEqual(prs, []);
  });

  test('more reps at a load already held is the plateau record', () => {
    const prs = personalRecordsIn({
      sessionId: 'new',
      histories: histories([session('old', 14), session('new', 3)], [
        set({ session_id: 'old', actual_load: 100, actual_reps: 5, prescribed_reps_max: 8 }),
        set({ session_id: 'new', actual_load: 100, actual_reps: 7, prescribed_reps_max: 8 }),
      ]),
    });
    assert.equal(prs[0].kind, 'reps');
    assert.equal(prs[0].value, 7);
  });

  test('an asserted set cannot set a record', () => {
    const prs = personalRecordsIn({
      sessionId: 'new',
      histories: histories([session('old', 14), session('new', 3)], [
        set({ session_id: 'old', actual_load: 100 }),
        set({ session_id: 'new', actual_load: 200, source: 'asserted' }),
      ]),
    });
    assert.deepEqual(prs, []);
  });
});

describe('A reduced dose is never capability evidence', () => {
  const reduced = (id: string, daysAgo: number): SessionRow & { variant_code: string } => ({
    ...session(id, daysAgo), variant_code: 'red',
  });

  test('a lighter maintenance session does not record a loss of strength', () => {
    // The exact trap: same movement, same rep range, less weight, because the
    // session asked for less. Read naively this is a 30% decline.
    const rows = evidence('micro',
      [session('full', 21), reduced('micro', 3)],
      [
        set({ session_id: 'full', actual_load: 100 }),
        set({ session_id: 'micro', actual_load: 70 }),
      ]);

    assert.deepEqual(rows, []);
  });

  test('a full session is compared to the last full one, not to the deload between', () => {
    const rows = evidence('new',
      [session('old', 30), reduced('micro', 14), session('new', 3)],
      [
        set({ session_id: 'old', actual_load: 100 }),
        set({ session_id: 'micro', actual_load: 60 }),
        set({ session_id: 'new', actual_load: 105 }),
      ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].direction, 'positive');
  });

  test('a reduced session sets no personal record', () => {
    const histories = exerciseHistory({
      today: TODAY,
      sessions: [session('old', 21), reduced('micro', 3)],
      setLogs: [
        set({ session_id: 'old', actual_load: 100 }),
        set({ session_id: 'micro', actual_load: 120 }),
      ],
    });
    assert.deepEqual(personalRecordsIn({ sessionId: 'micro', histories }), []);
  });
});
