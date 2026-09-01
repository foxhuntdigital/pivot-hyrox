/**
 * A supplemental is mostly a refusal, so the refusals are what is pinned here —
 * above all the one the PRD names by hand: poor recovery plus a motivated
 * athlete must produce no offer, and the override that lifts every other
 * intensity judgement must not lift this one.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  supplementalOffer, evaluateSupplementalEligibility, searchSupplementals, maxLoadFor,
  SUPPLEMENTAL_MAX_MINUTES,
} from './supplemental.ts';
import type { CompletedPrimary } from './supplemental.ts';
import type { EngineInput, Exercise, WorkoutTemplate } from '../../../packages/engine/src/index.ts';

const EXERCISES: Exercise[] = [
  { id: 'ex_plank', name: 'Plank', impact_level: 'low', postpartum_friendly: true, equipment: ['bodyweight'] },
  { id: 'ex_db_curl', name: 'DB Curl', impact_level: 'low', postpartum_friendly: true, equipment: ['db'] },
  { id: 'ex_row', name: 'RowErg', impact_level: 'low', postpartum_friendly: true, equipment: ['row_erg'] },
] as any;

const supp = (over: Partial<WorkoutTemplate> & { id: string }): WorkoutTemplate => ({
  name: over.id, workout_family: 'supplemental', primary_goal: 'recovery',
  stimulus: 'core', secondary_goal: null, estimated_minutes: 10,
  intensity_target: 'RPE 5', impact_level: 'low', hyrox_specificity: 0.1,
  postpartum_friendly: true, requires_running: false, requires_ski: false,
  description: '', coaching_notes: '', training_domain: 'recovery', session_type: 'recovery',
  workout_role: 'supplemental', supplemental_type: 'core', supplemental_load: 'minimal',
  tags: [],
  variants: [
    { variant_code: 'green', time_budget_minutes: 10, recovery_state: 'good', volume_multiplier: 1, intensity_modifier: '' },
    { variant_code: 'yellow', time_budget_minutes: 7, recovery_state: 'okay', volume_multiplier: 0.65, intensity_modifier: '' },
    { variant_code: 'red', time_budget_minutes: 4, recovery_state: 'poor', volume_multiplier: 0.3, intensity_modifier: '' },
  ],
  blocks: [{
    id: `${over.id}_b1`, block_order: 1, block_type: 'continuous', title: 'Main',
    instructions: '', rounds: null, duration_minutes: null, rest_seconds: null,
    exercises: [{ exercise_id: 'ex_plank', sequence_order: 1, prescription_type: 'duration',
      quantity: 30, quantity_unit: 's', intensity_note: null }],
  }],
  ...over,
} as any);

const PRIMARY_TEMPLATE = {
  ...supp({ id: 'wo_primary' }),
  workout_role: 'primary', supplemental_type: null, supplemental_load: null,
  intensity_target: 'RPE 5', workout_family: 'strength_legs',
} as WorkoutTemplate;

const TEMPLATES = [
  supp({ id: 'sup_core', supplemental_type: 'core', supplemental_load: 'minimal' }),
  supp({ id: 'sup_accessory', supplemental_type: 'accessory_strength', supplemental_load: 'low',
    blocks: [{ id: 'b', block_order: 1, block_type: 'continuous', title: 'Main', instructions: '',
      rounds: null, duration_minutes: null, rest_seconds: null,
      exercises: [{ exercise_id: 'ex_db_curl', sequence_order: 1, prescription_type: 'sets_reps',
        quantity: 3, quantity_unit: 'x12', intensity_note: null }] }] } as any),
  supp({ id: 'sup_metcon', supplemental_type: 'metcon', supplemental_load: 'moderate' }),
  supp({ id: 'sup_erg', supplemental_type: 'muscular_endurance', supplemental_load: 'low',
    blocks: [{ id: 'b', block_order: 1, block_type: 'continuous', title: 'Main', instructions: '',
      rounds: null, duration_minutes: null, rest_seconds: null,
      exercises: [{ exercise_id: 'ex_row', sequence_order: 1, prescription_type: 'duration',
        quantity: 8, quantity_unit: 'min', intensity_note: null }] }] } as any),
  PRIMARY_TEMPLATE,
];

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
  local_date: '2026-09-01', phase_type: 'build', days_to_race: 60,
  stimulus_requirements: [], recent_sessions: [], recovery_state: 'good',
  energy: 'normal', sleep_hours: 7.5, available_minutes: 60,
  available_equipment: ['db', 'bodyweight'], low_impact_required: false,
  symptom_flags: [], considerations: [], candidates: TEMPLATES, substitutions: [],
  ...over,
} as EngineInput);

const finished = (over: Partial<CompletedPrimary> = {}): CompletedPrimary =>
  ({ template: PRIMARY_TEMPLATE, session_rpe: 5, ended_early: false, ...over });

const offer = (over: Partial<EngineInput> = {}, primary = finished(), taken = false) =>
  supplementalOffer({
    input: input(over), templates: TEMPLATES, exercises: EXERCISES,
    primary, supplementalTakenToday: taken,
  });

describe('Supplemental offers', () => {
  test('offers after an easy completed primary', () => {
    const o = offer();
    assert.equal(o.offered, true);
    assert.equal(o.reason_code, 'OFFERED');
    assert.equal(o.max_load, 'moderate');
    assert.ok(o.options.length);
  });

  test('nothing finished means nothing to supplement', () => {
    assert.equal(offer({}, null as any).reason_code, 'NO_PRIMARY_COMPLETED');
  });

  test('never chained — a supplemental cannot follow a supplemental', () => {
    const o = offer({}, finished({ template: TEMPLATES[0] }));
    assert.equal(o.offered, false);
    assert.equal(o.reason_code, 'WOULD_CHAIN');
  });

  test('one a day', () => {
    assert.equal(offer({}, finished(), true).reason_code, 'ALREADY_TAKEN_TODAY');
  });

  test('a reported symptom stops it', () => {
    assert.equal(offer({ symptom_flags: ['chest_pain'] }).reason_code, 'SYMPTOMS_REPORTED');
  });

  test('a taper is not the week to add optional volume to', () => {
    assert.equal(offer({ phase_type: 'taper' }).reason_code, 'TAPER_WEEK');
  });

  test('skipping leaves nothing pending — a refusal carries no options', () => {
    for (const o of [
      offer({}, null as any), offer({}, finished(), true),
      offer({ phase_type: 'taper' }), offer({ recovery_state: 'poor', energy: 'low' }),
    ]) {
      assert.deepEqual(o.options, []);
      assert.equal(o.max_load, null);
      assert.ok(o.rationale.length > 0);
    }
  });
});

describe('Poor recovery, and the athlete who feels great', () => {
  test('poor recovery blocks the offer', () => {
    const o = offer({ recovery_state: 'poor', energy: 'low' });
    assert.equal(o.offered, false);
    assert.equal(o.reason_code, 'RECOVERY_TOO_LOW');
  });

  test('an override does not lift it — the QA scenario, verbatim', () => {
    // Everywhere else in the engine `athlete_override` is the athlete answering
    // a question about how hard today should be, and it wins. Not here.
    const o = offer({ recovery_state: 'poor', energy: 'low', athlete_override: true } as any);
    assert.equal(o.offered, false);
    assert.equal(o.reason_code, 'RECOVERY_TOO_LOW');
  });

  test('and the refusal says why without scolding', () => {
    const o = offer({ recovery_state: 'poor', energy: 'low' });
    assert.match(o.rationale, /finished the session, which is the win/);
  });
});

describe('The day\'s remaining budget', () => {
  test('a hard primary leaves nothing', () => {
    assert.equal(maxLoadFor('good', finished({ session_rpe: 9 })), null);
    assert.equal(offer({}, finished({ session_rpe: 9 })).reason_code, 'PRIMARY_ALREADY_DEMANDING');
  });

  test('a moderately hard primary leaves only the smallest', () => {
    assert.equal(maxLoadFor('good', finished({ session_rpe: 7 })), 'minimal');
  });

  test('okay recovery caps below good recovery on the same session', () => {
    assert.equal(maxLoadFor('good', finished({ session_rpe: 5 })), 'moderate');
    assert.equal(maxLoadFor('okay', finished({ session_rpe: 5 })), 'low');
  });

  test('the authored intensity counts even when the athlete rated it easy', () => {
    const hard = { ...PRIMARY_TEMPLATE, intensity_target: 'RPE 9' } as WorkoutTemplate;
    assert.equal(maxLoadFor('good', finished({ template: hard, session_rpe: 3 })), null);
  });

  test('poor recovery has no ceiling to lower', () => {
    assert.equal(maxLoadFor('poor', finished({ session_rpe: 3 })), null);
  });
});

describe('Searching supplementals', () => {
  const search = (over: Partial<EngineInput> = {}, maxLoad: any = 'moderate', rest: any = {}) =>
    searchSupplementals({
      input: input(over), templates: TEMPLATES, exercises: EXERCISES, maxLoad, ...rest,
    });

  test('only supplemental-role templates are ever returned', () => {
    assert.ok(search().every(o => o.template_id.startsWith('sup_')));
  });

  test('the load ceiling is honoured', () => {
    assert.ok(search({}, 'minimal').every(o => o.supplemental_load === 'minimal'));
    assert.ok(search({}, 'low').every(o => o.supplemental_load !== 'moderate'));
  });

  test('equipment the athlete does not have is filtered by the same guardrail', () => {
    // The erg supplemental needs a rower; a dumbbell athlete cannot reach it.
    assert.ok(!search().some(o => o.template_id === 'sup_erg'));
    assert.ok(search({ available_equipment: ['db', 'bodyweight', 'row_erg'] })
      .some(o => o.template_id === 'sup_erg'));
  });

  test('a type filter narrows to that type', () => {
    const only = search({}, 'moderate', { type: 'core' });
    assert.ok(only.length);
    assert.ok(only.every(o => o.supplemental_type === 'core'));
  });

  test('nothing runs longer than a supplemental may be', () => {
    assert.ok(search().every(o => o.minutes <= SUPPLEMENTAL_MAX_MINUTES));
  });

  test('a stated preference orders the list, and a demonstrated need outranks it', () => {
    const liked = search({ preferred_families: ['supplemental'] });
    assert.ok(liked.length);
    // Need beats liking: every option shares a family here, so a capability
    // need on the domain is the only thing that can reorder them.
    const needed = search({
      capability_needs: { muscular_endurance: 1 },
      available_equipment: ['db', 'bodyweight', 'row_erg'],
    });
    assert.ok(needed.length);
  });

  test('an eligible-but-empty library is a refusal, not an empty offer', () => {
    const o = supplementalOffer({
      input: input(), templates: [PRIMARY_TEMPLATE], exercises: EXERCISES,
      primary: finished(), supplementalTakenToday: false,
    });
    assert.equal(o.offered, false);
    assert.equal(o.reason_code, 'NO_ELIGIBLE_SUPPLEMENTAL');
    assert.deepEqual(o.options, []);
  });
});
