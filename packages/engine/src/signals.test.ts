/**
 * Three signals about one athlete, and the rules that keep them apart.
 *
 *   capability_need     what performance has demonstrated
 *   perceived_weakness  what the athlete believes needs work
 *   preference          what the athlete wants to do
 *
 * They are separate columns, separate inputs and separate scoring dimensions
 * because they are separate claims, and the failure this file exists to catch
 * is any one of them quietly becoming another. A belief that raises a
 * capability band would be the product inventing evidence; evidence that
 * silences a belief would be the product telling the athlete they are wrong
 * about themselves. Disagreement between them is information, and is kept.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { WEIGHTS, capabilityNeed, perceivedWeakness, preference } from './rank.ts';
import type { EngineInput, WorkoutTemplate } from './types.ts';

const template = (over: Partial<WorkoutTemplate> = {}): WorkoutTemplate => ({
  id: 'wo_legs', name: 'Legs', workout_family: 'strength_legs',
  primary_goal: 'strength', stimulus: 'strength', secondary_goal: null,
  estimated_minutes: 60, intensity_target: 'RPE 7', impact_level: 'low',
  hyrox_specificity: 0.5, postpartum_friendly: true,
  requires_running: false, requires_ski: false,
  description: '', coaching_notes: '', training_domain: 'strength',
  session_type: 'strength', workout_role: 'primary', tags: [],
  variants: [], blocks: [],
  ...over,
} as WorkoutTemplate);

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
  local_date: '2026-09-02', phase_type: 'build', days_to_race: 60,
  stimulus_requirements: [], recent_sessions: [], recovery_state: 'good',
  energy: 'normal', sleep_hours: 7.5, available_minutes: 60,
  available_equipment: ['db'], low_impact_required: false,
  symptom_flags: [], considerations: [], candidates: [], substitutions: [],
  ...over,
} as EngineInput);

describe('The weights', () => {
  test('sum to one, so a total is a proportion of a whole', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(Number(sum.toFixed(6)), 1);
  });

  test('belief ranks below evidence and above preference', () => {
    // The ordering is the ruling, not an accident of tuning: a belief is not a
    // measurement, and "I am bad at this" is a stronger claim on the plan than
    // "I enjoy this".
    assert.ok(WEIGHTS.perceived_weakness < WEIGHTS.capability_need);
    assert.ok(WEIGHTS.perceived_weakness > WEIGHTS.preference);
  });
});

describe('Belief and evidence stay apart', () => {
  const legs = template();

  test('a stated weakness ranks on its own, with no evidence at all', () => {
    const scored = perceivedWeakness(legs, input({
      perceived_weaknesses: ['lower_body_strength'],
    }));
    assert.equal(scored, 1);
    // And it produced no capability need: belief is not evidence.
    assert.equal(capabilityNeed(legs, input({
      perceived_weaknesses: ['lower_body_strength'],
    })), 0);
  });

  test('evidence ranks on its own, with no belief at all', () => {
    const scored = capabilityNeed(legs, input({
      capability_needs: { lower_body_strength: 1 },
    }));
    assert.ok(scored > 0);
    assert.equal(perceivedWeakness(legs, input({
      capability_needs: { lower_body_strength: 1 },
    })), 0);
  });

  test('evidence that disagrees does not silence the belief', () => {
    // The athlete says their lower body is weak. The evidence says their
    // running is. Both are kept, and both still rank the work that addresses
    // them — the product does not decide the athlete is wrong about themselves.
    const both = input({
      perceived_weaknesses: ['lower_body_strength'],
      capability_needs: { running_threshold: 1 },
    });
    assert.equal(perceivedWeakness(legs, both), 1);
    assert.equal(capabilityNeed(legs, both), 0);

    const intervals = template({
      workout_family: 'threshold', primary_goal: 'threshold', training_domain: 'threshold',
    });
    assert.equal(perceivedWeakness(intervals, both), 0);
    assert.ok(capabilityNeed(intervals, both) > 0);
  });

  test('agreement does not double-count into one signal', () => {
    // When both point the same way each still reports its own value; the
    // weighting decides how much each is worth, not the dimension itself.
    const agreeing = input({
      perceived_weaknesses: ['lower_body_strength'],
      capability_needs: { lower_body_strength: 1 },
    });
    assert.equal(perceivedWeakness(legs, agreeing), 1);
    assert.equal(capabilityNeed(legs, agreeing), 1);
  });

  test('a belief has no magnitude — stated is stated', () => {
    // `capability_needs` is scaled by band and confidence. A belief is not, and
    // must not acquire one: the athlete either said it or did not.
    const one = perceivedWeakness(legs, input({ perceived_weaknesses: ['lower_body_strength'] }));
    const many = perceivedWeakness(legs, input({
      perceived_weaknesses: ['lower_body_strength', 'upper_body_strength', 'loaded_movement'],
    }));
    assert.equal(one, many);
  });

  test('an unrecognised capability key ranks nothing rather than everything', () => {
    assert.equal(perceivedWeakness(legs, input({ perceived_weaknesses: ['vibes'] })), 0);
  });
});

describe('Preference is the third thing, and the softest', () => {
  test('wanting a session is not believing you are bad at it', () => {
    const legs = template();
    const wanted = input({ preferred_families: ['strength'] });
    assert.ok(preference(legs, wanted) > 0.5);
    // Wanting it creates no belief and no evidence.
    assert.equal(perceivedWeakness(legs, wanted), 0);
    assert.equal(capabilityNeed(legs, wanted), 0);
  });

  test('a dislike is a smaller penalty than a preference is a reward', () => {
    const legs = template();
    const base = preference(legs, input());
    const liked = preference(legs, input({ preferred_families: ['strength'] }));
    const disliked = preference(legs, input({ avoided_families: ['strength'] }));
    assert.ok(liked - base > base - disliked);
  });
});
