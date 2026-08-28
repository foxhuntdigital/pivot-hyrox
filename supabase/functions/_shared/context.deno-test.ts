/**
 * What the athlete's state is derived from, and what it must not invent.
 *
 * `loadAthleteState` does arithmetic no table stores: which phase today falls
 * in, which week of the program that is, and the date window the current weekly
 * cycle covers. `weekly_cycles` holds no dates at all — the window is the
 * phase's start date plus the cycle's index — so this is the one place a wrong
 * assumption would quietly mis-attribute an athlete's whole week.
 *
 * These run against a stub client, so what is proved is the reasoning and the
 * queries, not the database. RLS, constraints and the SQL itself need a live
 * run; see `scripts/smoke.mjs`.
 *
 * Named `.deno-test.ts` because this module imports the Supabase client from
 * `jsr:`, which Node cannot resolve. Deno runs these (`functions:test:deno`);
 * Node runs the `.test.ts` files beside them, which have no such import.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAthleteState } from './context.ts';
import { stubDb } from './testing.ts';

const USER = 'user-1';

/** A three-phase program: 4 weeks foundation, 4 build, 2 taper. */
function program(over: Record<string, unknown> = {}) {
  const weeks = (n: number, activeIndex?: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `cycle-${i + 1}`,
      week_index: i + 1,
      status: activeIndex === i + 1 ? 'active' : 'pending',
      stimulus_requirements: [],
      session_queue_items: [],
    }));

  return {
    id: 'program-1',
    program_phases: [
      {
        id: 'p2', phase_type: 'build', phase_order: 2,
        start_date: '2026-04-01', end_date: '2026-04-28',
        weekly_cycles: weeks(4, 2),
      },
      {
        id: 'p1', phase_type: 'foundation', phase_order: 1,
        start_date: '2026-03-04', end_date: '2026-03-31',
        weekly_cycles: weeks(4),
      },
      {
        id: 'p3', phase_type: 'taper', phase_order: 3,
        start_date: '2026-04-29', end_date: '2026-05-12',
        weekly_cycles: weeks(2),
      },
    ],
    ...over,
  };
}

const load = (today: string, rows: Record<string, unknown[]> = {}) =>
  loadAthleteState(stubDb({ programs: [program()], ...rows }) as never, USER, today);

describe('Athlete state derivations', () => {
  test('phases are ordered by phase_order, not by how they arrived', () => {
    // The query returns them nested and unordered; the ribbon draws them in
    // sequence, so the order has to be imposed here.
    return load('2026-04-08').then(state => {
      assert.deepEqual(state.phaseSequence.map(p => p.type),
        ['foundation', 'build', 'taper']);
      assert.deepEqual(state.phaseSequence.map(p => p.weeks), [4, 4, 2]);
    });
  });

  test('the current phase is the one today falls inside', async () => {
    const state = await load('2026-04-08');
    assert.equal(state.currentPhase.phase_type, 'build');
  });

  test('the program week counts across phases, not within one', async () => {
    // Week 2 of build, with four foundation weeks behind it, is week 6 of 10.
    const state = await load('2026-04-08');
    assert.equal(state.weekInPhase, 2);
    assert.equal(state.programWeek, 6);
    assert.equal(state.programTotalWeeks, 10);
  });

  test('the week window comes from the phase start plus the cycle index', async () => {
    // Build starts 2026-04-01; week 2 begins seven days later and runs six more.
    const state = await load('2026-04-08');
    assert.equal(state.weekStart, '2026-04-08');
    assert.equal(state.weekEnd, '2026-04-14');
  });

  test('the current week follows the calendar, not the `active` flag', async () => {
    // Nothing advances weekly_cycles.status after onboarding sets it, so week 1
    // of the phase stays flagged `active` forever. Reading that flag reported
    // the same week for the life of the program; the date says otherwise.
    const state = await load('2026-04-22');
    assert.equal(state.weekInPhase, 4);
    assert.equal(state.programWeek, 8);
    assert.equal(state.weekStart, '2026-04-22');
  });

  test('the week is clamped to the phase it is in', async () => {
    // Past the end of the last phase — a block that has run out — the program
    // reports its final week rather than counting off the end of the plan.
    const state = await load('2026-06-30');
    assert.equal(state.programWeek, state.programTotalWeeks);
  });

  test('a date before the phase starts does not produce a week zero', async () => {
    const state = await load('2026-03-04');
    assert.equal(state.weekInPhase, 1);
    assert.equal(state.programWeek, 1);
  });

  test('the window does not drift across a month boundary', async () => {
    const state = await load('2026-04-29', {
      programs: [program({
        program_phases: [{
          id: 'p1', phase_type: 'build', phase_order: 1,
          start_date: '2026-04-29', end_date: '2026-05-26',
          weekly_cycles: [{
            id: 'c1', week_index: 1, status: 'active',
            stimulus_requirements: [], session_queue_items: [],
          }],
        }],
      })],
    });
    assert.equal(state.weekStart, '2026-04-29');
    assert.equal(state.weekEnd, '2026-05-05');
  });

  test('a session counts toward the week it ended in', async () => {
    const sessions = [
      { id: 's1', template_id: 't', started_at: '2026-04-09T09:00:00Z',
        ended_at: '2026-04-09T10:00:00Z', session_rpe: 7, snapshot_json: {} },
      // Last week: inside the phase, outside the cycle window.
      { id: 's2', template_id: 't', started_at: '2026-04-02T09:00:00Z',
        ended_at: '2026-04-02T10:00:00Z', session_rpe: 6, snapshot_json: {} },
      // The final day of the window still counts.
      { id: 's3', template_id: 't', started_at: '2026-04-14T18:00:00Z',
        ended_at: '2026-04-14T19:00:00Z', session_rpe: 5, snapshot_json: {} },
    ];
    const state = await load('2026-04-08', { workout_sessions: sessions });
    assert.deepEqual(state.completed_this_week.map((s: { id: string }) => s.id), ['s1', 's3']);
  });

  test('with no program there is no week to attribute anything to', async () => {
    const state = await loadAthleteState(stubDb({}) as never, USER, '2026-04-08');
    assert.equal(state.weekStart, null);
    assert.equal(state.weekEnd, null);
    assert.deepEqual(state.completed_this_week, []);
    assert.equal(state.programTotalWeeks, 0);
  });

  test('days to race is null when no race is set, not zero', async () => {
    const state = await load('2026-04-08');
    assert.equal(state.daysToRace, null);
  });

  test('days to race counts from today to the event', async () => {
    const state = await load('2026-04-08', {
      races: [{ id: 'r1', event_name: 'Boston', event_date: '2026-06-07', status: 'active' }],
    });
    assert.equal(state.daysToRace, 60);
  });

  test('only the caller’s own completed sessions are asked for', async () => {
    const db = stubDb({ programs: [program()] });
    await loadAthleteState(db as never, USER, '2026-04-08');
    const [q] = db.callsTo('workout_sessions');
    assert.ok(q.filters.includes(`eq:user_id=${USER}`), 'scoped to the athlete');
    assert.ok(q.filters.includes('eq:status=completed'), 'and to finished work');
    // The snapshot is what makes a completed session describable after the
    // fact — its name and minutes as prescribed then, not as the template
    // reads today.
    assert.match(q.select ?? '', /snapshot_json/);
  });

  test('the equipment profile read prefers the default one', async () => {
    const state = await load('2026-04-08', {
      equipment_profiles: [
        { id: 'e2', is_default: false, equipment_profile_items: [{ equipment_id: 'db' }] },
        { id: 'e1', is_default: true, equipment_profile_items: [{ equipment_id: 'ski' }] },
      ],
    });
    assert.deepEqual(state.available_equipment, ['ski']);
  });
});
