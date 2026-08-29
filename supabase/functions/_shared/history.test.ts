/**
 * History is a record, so what is pinned here is that it reports what happened
 * rather than what was planned, and that a template edited since cannot rewrite
 * it.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { historyEntriesFrom, type HistorySessionRow } from './history.ts';

const NAMES = new Map([
  ['ex_run', 'Run'], ['ex_rowerg', 'RowErg'], ['ex_wall_ball', 'Wall Ball'],
]);
const session = (over: Partial<HistorySessionRow> = {}): HistorySessionRow => ({
  id: 's1', template_id: 'wo_x', variant_code: 'green',
  started_at: '2026-02-20T09:00:00Z', ended_at: '2026-02-20T09:45:00Z',
  session_rpe: 7, ended_early: false,
  snapshot_json: {
    name: 'Row 5x1000', variant_label: 'Full', primary_stimulus: 'threshold',
    started_local_date: '2026-02-20',
    blocks: [{ rounds: 5, exercises: [{ exercise_id: 'ex_rowerg', quantity: 1000, quantity_unit: 'm' }] }],
  },
  ...over,
});
const one = (over = {}, logs = {}) => historyEntriesFrom({
  sessions: [session(over)], setLogs: [], cardioLogs: [], exerciseNames: NAMES, ...logs,
})[0];

describe('Training history', () => {
  test('a rounds block prescribes its per-round work times the rounds', () => {
    assert.equal(one().movements[0].prescribed, '5000 m', 'not 1000 m');
  });

  test('what was performed is reported next to what was asked for', () => {
    const e = one({}, {
      cardioLogs: [
        { session_id: 's1', exercise_id: 'ex_rowerg', distance_meters: 4500, duration_seconds: 1100 },
      ],
    });
    assert.equal(e.movements[0].prescribed, '5000 m');
    assert.equal(e.movements[0].actual, '4500 m');
  });

  test('a movement with nothing logged shows no actual rather than a zero', () => {
    assert.equal(one().movements[0].actual, null);
  });

  test('the date is the athlete\'s local day as recorded, not the timestamp', () => {
    // Started 23:30 local on the 19th, which is the 20th in UTC.
    const e = one({
      started_at: '2026-02-20T07:30:00Z',
      snapshot_json: { ...session().snapshot_json, started_local_date: '2026-02-19' },
    });
    assert.equal(e.date, '2026-02-19');
  });

  test('a session logged against a movement never prescribed still appears', () => {
    const e = one({}, {
      setLogs: [{ session_id: 's1', exercise_id: 'ex_wall_ball', prescribed_reps: null, actual_reps: 30 }],
    });
    const wb = e.movements.find(m => m.exercise_id === 'ex_wall_ball')!;
    assert.equal(wb.prescribed, null);
    assert.equal(wb.actual, '30 reps');
  });

  test('duration is elapsed, and an overnight timer is rejected', () => {
    assert.equal(one().minutes, 45);
    assert.equal(one({ ended_at: '2026-02-21T09:00:00Z' }).minutes, null);
    assert.equal(one({ ended_at: null }).minutes, null);
  });

  test('an unnamed exercise falls back to its id rather than blanking', () => {
    const e = historyEntriesFrom({
      sessions: [session()], setLogs: [], cardioLogs: [], exerciseNames: new Map(),
    })[0];
    assert.equal(e.movements[0].exercise, 'ex_rowerg');
  });

  test('the entry reads from the snapshot, so a renamed template cannot rewrite it', () => {
    const e = one();
    assert.equal(e.name, 'Row 5x1000');
    assert.equal(e.variant_label, 'Full');
    assert.equal(e.stimulus, 'threshold');
  });

  test('splits come back in the order performed, whatever order they arrive in', () => {
    const split = (i: number, over = {}) => ({
      session_id: 's1', split_index: i, label: 'RowErg', prescribed: '1000 m',
      kind: 'Work', seconds: 200 + i, cumulative_seconds: (200 + i) * (i + 1),
      rest: false, ...over,
    });
    // Deliberately shuffled: PostgREST makes no promise about row order, and
    // the order is the whole point of a split list.
    const e = historyEntriesFrom({
      sessions: [session()], setLogs: [], cardioLogs: [], exerciseNames: NAMES,
      splits: [split(2), split(0), split(1)],
    })[0];

    assert.deepEqual(e.splits.map(s => s.index), [0, 1, 2]);
    assert.deepEqual(e.splits.map(s => s.seconds), [200, 201, 202]);
  });

  test('rest laps survive as rest', () => {
    const e = historyEntriesFrom({
      sessions: [session()], setLogs: [], cardioLogs: [], exerciseNames: NAMES,
      splits: [
        { session_id: 's1', split_index: 0, label: 'RowErg', prescribed: '1000 m', kind: 'Work', seconds: 200, cumulative_seconds: 200, rest: false },
        { session_id: 's1', split_index: 1, label: 'Recover', prescribed: '0:90', kind: 'Rest', seconds: 90, cumulative_seconds: 290, rest: true },
      ],
    })[0];

    assert.equal(e.splits[1].rest, true);
    assert.equal(e.splits[1].label, 'Recover');
  });

  test('a session finished before splits existed has none, not an empty-looking one', () => {
    // The screen branches on this: no laps means "not recorded", which is a
    // different statement from a session whose laps were all zero.
    assert.deepEqual(one().splits, []);
  });

  test("one session's laps never leak into another's", () => {
    const entries = historyEntriesFrom({
      sessions: [session(), session({ id: 's2' })],
      setLogs: [], cardioLogs: [], exerciseNames: NAMES,
      splits: [
        { session_id: 's2', split_index: 0, label: 'RowErg', prescribed: '1000 m', kind: 'Work', seconds: 210, cumulative_seconds: 210, rest: false },
      ],
    });

    assert.deepEqual(entries[0].splits, []);
    assert.equal(entries[1].splits.length, 1);
  });
});
