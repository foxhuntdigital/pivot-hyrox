/**
 * A progression rule nobody exercises is the rule that puts a weight on a box
 * jump. What is pinned here is each branch returning its own reason code, the
 * cap holding, and every refusal refusing — including the two that matter most:
 * a movement that must not be loaded, and an increment that does not exist.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { progressionFor, dimensionFor, steppedLoad } from './progression.ts';
import type { ProgressionRuleRow, Prescription } from './progression.ts';
import { exerciseHistory } from './exercise-history.ts';
import type { StrengthSetRow } from './exercise-history.ts';
import type { SessionRow } from './readiness-history.ts';

const TODAY = '2026-03-01';
const at = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString();

/** The rule as `content.progression_rules` seeds it. */
const RULES: ProgressionRuleRow[] = [{
  id: 'pr_4', workout_family: 'strength_legs', metric: 'load',
  trigger_condition: 'all work sets completed at RPE <=7',
  action: 'increase 2.5-5%', max_change_pct: 5.0, notes: 'Autoregulated',
}];

const PRESCRIPTION: Prescription = {
  exercise_id: 'ex_back_squat', workout_family: 'strength_legs',
  sets: 4, reps_min: 5, reps_max: 5, target_rpe: 7,
};

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

const ANCHOR = { progression_class: 'anchor', progression_tracks: ['load', 'reps'] };

function suggest(
  sessions: SessionRow[], logs: StrengthSetRow[],
  over: Partial<Prescription> = {}, ontology = ANCHOR, rules = RULES,
) {
  const history = exerciseHistory({ today: TODAY, sessions, setLogs: logs })
    .get('ex_back_squat');
  return progressionFor({
    prescription: { ...PRESCRIPTION, ...over }, history, ontology, rules,
  });
}

describe('Progression', () => {
  test('advances only when every set completed inside the effort ceiling', () => {
    const s = suggest([session('a', 7)], [
      set({ session_id: 'a', set_index: 1, rpe: 6 }),
      set({ session_id: 'a', set_index: 2, rpe: 6 }),
    ]);
    assert.equal(s.reason_code, 'PROGRESS_ALL_SETS_BELOW_RPE_CEILING');
    assert.equal(s.dimension, 'load');
    // 5% of 100 kg is 5 kg, which is two 2.5 kg steps.
    assert.equal(s.suggested_load, 105);
    assert.equal(s.rule_id, 'pr_4');
  });

  test('holds the load when the target effort was already reached', () => {
    const s = suggest([session('a', 7)], [set({ session_id: 'a', rpe: 9 })]);
    assert.equal(s.reason_code, 'HOLD_LOAD_TARGET_RPE_REACHED');
    assert.equal(s.dimension, 'none');
    assert.equal(s.suggested_load, 100);
  });

  test('one short session holds rather than regressing', () => {
    const s = suggest([session('a', 7)], [
      set({ session_id: 'a', actual_reps: 3, rpe: 6 }),
    ]);
    assert.equal(s.reason_code, 'HOLD_LAST_EXPOSURE_INCOMPLETE');
  });

  test('two failures at the same load back it off, capped by the rule', () => {
    const s = suggest(
      [session('first', 14), session('second', 7)],
      [
        set({ session_id: 'first', actual_reps: 3, actual_load: 100, rpe: 6 }),
        set({ session_id: 'second', actual_reps: 3, actual_load: 100, rpe: 6 }),
      ],
    );
    assert.equal(s.reason_code, 'REGRESS_RECENT_REPEATED_FAILURE');
    assert.equal(s.dimension, 'load');
    assert.equal(s.suggested_load, 95);
  });

  test('no history at all is an answer, not a default weight', () => {
    const s = suggest([], []);
    assert.equal(s.reason_code, 'NO_COMPARABLE_HISTORY');
    assert.equal(s.suggested_load, null);
    assert.equal(s.dimension, 'none');
  });

  test('history at a different rep range does not carry load, and says so', () => {
    const s = suggest(
      [session('tens', 7)],
      [set({ session_id: 'tens', prescribed_reps_min: 10, prescribed_reps_max: 10, actual_reps: 10 })],
    );
    assert.equal(s.reason_code, 'NO_COMPARABLE_HISTORY');
    assert.match(s.caveat ?? '', /different rep range/);
  });

  test('a family with no seeded rule holds instead of borrowing one', () => {
    // hybrid_engine is a real family in the library and the seed writes no rule
    // for it. Advancing it on the shape of the strength rule would be inventing
    // the rule rather than reading one.
    const s = suggest([session('a', 7)], [set({ session_id: 'a', rpe: 6 })],
      { workout_family: 'hybrid_engine' });
    assert.equal(s.reason_code, 'NO_PROGRESSION_RULE');
    assert.equal(s.suggested_load, null);
    assert.match(s.caveat ?? '', /hybrid_engine/);
  });

  test('an asserted-only history is no history — the prescription is not evidence', () => {
    const s = suggest([session('a', 7)], [
      set({ session_id: 'a', source: 'asserted', actual_load: null }),
    ]);
    assert.equal(s.reason_code, 'NO_COMPARABLE_HISTORY');
  });
});

describe('Which dimension moves', () => {
  test('a variable_complex movement never gets a heavier bar', () => {
    assert.equal(dimensionFor({
      progression_class: 'variable_complex',
      progression_tracks: ['load', 'distance', 'work_rest'],
    }), 'density');
  });

  test('a developmental movement progresses on reps', () => {
    assert.equal(dimensionFor({ progression_class: 'developmental', progression_tracks: ['reps'] }), 'reps');
  });

  test('an unclassified movement gets the answer that cannot hurt anyone', () => {
    assert.equal(dimensionFor(undefined), 'reps');
    assert.equal(dimensionFor({ progression_class: null, progression_tracks: null }), 'reps');
  });

  test('a sled that completed cleanly is advanced by density, not by load', () => {
    const s = suggest([session('a', 7)], [set({ session_id: 'a', rpe: 6 })], {},
      { progression_class: 'variable_complex', progression_tracks: ['load', 'work_rest'] });
    assert.equal(s.reason_code, 'PROGRESS_ALL_SETS_BELOW_RPE_CEILING');
    assert.equal(s.dimension, 'density');
    assert.equal(s.suggested_load, null);
  });
});

describe('Never an invented weight', () => {
  test('an increment smaller than a real plate moves the reps instead', () => {
    // 5% of 40 kg is 2 kg. The smallest pair of plates is 2.5 kg, so there is
    // no jump to make and the reps move first.
    const s = suggest([session('a', 7)], [
      set({ session_id: 'a', actual_load: 40, rpe: 6 }),
    ]);
    assert.equal(s.dimension, 'reps');
    assert.equal(s.suggested_load, 40);
    assert.equal(s.suggested_reps, 6);
    assert.match(s.caveat ?? '', /cap/);
  });

  test('a completed exposure with no load recorded moves the reps', () => {
    const s = suggest([session('a', 7)], [
      set({ session_id: 'a', actual_load: null, rpe: 6 }),
    ]);
    assert.equal(s.dimension, 'reps');
    assert.match(s.caveat ?? '', /No load was recorded/);
  });

  test('steps are real and stay inside the cap', () => {
    assert.equal(steppedLoad(100, 'kg', 5, 1), 105);
    assert.equal(steppedLoad(100, 'lb', 5, 1), 105);
    // 2.5% of 100 kg is one 2.5 kg step; 2.4% is none.
    assert.equal(steppedLoad(100, 'kg', 2.5, 1), 102.5);
    assert.equal(steppedLoad(100, 'kg', 2.4, 1), null);
    assert.equal(steppedLoad(100, 'stone', 5, 1), null);
    assert.equal(steppedLoad(0, 'kg', 5, 1), null);
  });
});

describe('A reduced dose is a fact about the session', () => {
  /** The maintenance rule as the seed now carries it: no change permitted. */
  const MAINTENANCE: ProgressionRuleRow[] = [{
    id: 'pr_9', workout_family: 'strength_maintenance_lower', metric: 'load',
    trigger_condition: 'never - reduced dose by design', action: 'hold', max_change_pct: 0,
    notes: 'A reduced dose by design.',
  }];

  const reduced = (id: string, daysAgo: number): SessionRow & { variant_code: string } => ({
    ...session(id, daysAgo), variant_code: 'red',
  });

  test('completing a maintenance session earns no heavier prescription', () => {
    const s = suggest([session('a', 7)], [set({ session_id: 'a', rpe: 5 })],
      { workout_family: 'strength_maintenance_lower', target_rpe: 6 }, ANCHOR, MAINTENANCE);

    assert.equal(s.reason_code, 'HOLD_MAINTENANCE_SESSION');
    assert.equal(s.dimension, 'none');
    assert.equal(s.rule_id, 'pr_9');
  });

  test('a reduced session is not the baseline the next load is read from', () => {
    // Last week was a Micro at 60 kg. Progressing 5% off that would prescribe
    // 63 kg to an athlete whose real working weight is 100.
    const s = suggest(
      [session('full', 21), reduced('micro', 5)],
      [
        set({ session_id: 'full', actual_load: 100, rpe: 6 }),
        set({ session_id: 'micro', actual_load: 60, rpe: 5 }),
      ]);

    assert.equal(s.reason_code, 'PROGRESS_ALL_SETS_BELOW_RPE_CEILING');
    assert.equal(s.basis?.top_load, 100);
    assert.equal(s.suggested_load, 105);
    assert.match(s.caveat ?? '', /reduced dose/);
  });

  test('a short set inside a reduced session is not a failure to regress from', () => {
    const s = suggest(
      [session('full', 21), reduced('micro1', 10), reduced('micro2', 5)],
      [
        set({ session_id: 'full', actual_load: 100, actual_reps: 5, rpe: 6 }),
        set({ session_id: 'micro1', actual_load: 100, actual_reps: 2, rpe: 6 }),
        set({ session_id: 'micro2', actual_load: 100, actual_reps: 2, rpe: 6 }),
      ]);

    assert.notEqual(s.reason_code, 'REGRESS_RECENT_REPEATED_FAILURE');
    assert.equal(s.basis?.session_id, 'full');
  });
});
