/**
 * The invariants that must hold whatever the model says.
 *
 * These run without an API key, because none of them are about answer quality —
 * they are about what the orchestration does with an answer. A model that
 * returns nonsense, refuses, or claims it changed the athlete's week must still
 * leave the athlete's week alone. `npm run coach:evals` covers the other half,
 * against the real models.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recommend, computeReadiness, type EngineDecision, type EngineInput } from '../../engine/src/index.ts';
import { route, trimDecision } from './tools.ts';
import { runCoachTurn } from './turn.ts';
import type { CoachContext, CoachServices, LlmClient } from './types.ts';

/* ------------------------------------------------------------ fixtures --- */

const EXERCISES = [
  { id: 'ex_run', name: 'Run', impact_level: 'medium' as const, postpartum_friendly: true, equipment: ['treadmill', 'outdoor'] },
  { id: 'ex_skierg', name: 'SkiErg', impact_level: 'low' as const, postpartum_friendly: true, equipment: ['ski'] },
];

const template = (id: string, goal: string, minutes: number, exerciseId: string) => ({
  id,
  name: id,
  workout_family: goal,
  primary_goal: goal,
  stimulus: goal,
  estimated_minutes: minutes,
  intensity_target: 'RPE 5',
  impact_level: 'medium' as const,
  hyrox_specificity: 0.5,
  postpartum_friendly: true,
  requires_running: false,
  requires_ski: false,
  description: id,
  coaching_notes: '',
  tags: [goal],
  variants: [
    { variant_code: 'green' as const, time_budget_minutes: minutes, recovery_state: 'good' as const, volume_multiplier: 1, intensity_modifier: 'full' },
    { variant_code: 'yellow' as const, time_budget_minutes: Math.round(minutes * 0.6), recovery_state: 'okay' as const, volume_multiplier: 0.65, intensity_modifier: 'reduce rounds' },
    { variant_code: 'red' as const, time_budget_minutes: Math.round(minutes * 0.3), recovery_state: 'poor' as const, volume_multiplier: 0.3, intensity_modifier: 'minimum dose' },
  ],
  blocks: [{
    id: `${id}_b1`, block_order: 1, block_type: 'continuous', title: 'Main',
    instructions: '', rounds: null, duration_minutes: minutes, rest_seconds: null,
    exercises: [{ exercise_id: exerciseId, sequence_order: 1, prescription_type: 'duration' as const, quantity: minutes, quantity_unit: 'min' }],
  }],
});

const TEMPLATES = [
  template('aerobic_60', 'aerobic_durability', 60, 'ex_run'),
  template('threshold_40', 'threshold', 40, 'ex_skierg'),
];

const input: EngineInput = {
  local_date: '2026-08-19',
  phase_type: 'build',
  days_to_race: 58,
  stimulus_requirements: [
    { stimulus_type: 'aerobic_durability', target_exposures: 2, completed_exposures: 0, priority: 1 },
  ],
  recent_sessions: [],
  recovery_state: 'good',
  energy: 'normal',
  sleep_hours: 8,
  available_minutes: 60,
  available_equipment: ['treadmill', 'outdoor', 'ski'],
  low_impact_required: false,
  symptom_flags: [],
  considerations: [],
  candidates: TEMPLATES,
  substitutions: [],
  variation_tolerance: 1,
};

const decision = recommend(input, EXERCISES);

const services: CoachServices = {
  today: decision,
  input,
  evaluate: overrides => recommend({ ...input, ...overrides }, EXERCISES),
  search: () => recommend(input, EXERCISES),
  readiness: computeReadiness({
    aerobic_minutes_14d: 100, threshold_sessions_14d: 1, run_sessions_7d: 1,
    longest_run_km: 8, strength_completion_rate: 0.5, stations_covered_21d: 3,
    stimulus_adherence_4w: 0.5, recovery_signal: 0.5, observed_days: 20,
  }),
  trends: () => null,
  progression: () => [],
  records: () => [],
  week: () => [{ day: 'Thursday', template: 'aerobic_60', minutes: 60, priority: 1, stimulus: 'aerobic_durability' }],
  raceDefinition: () => null,
};

const context: CoachContext = {
  request_id: 'test',
  athlete: { athlete_id: 'a', timezone: 'UTC', units: 'metric', flags: [] },
  active_race: null,
  program: null,
  today: { date_local: '2026-08-19', available_time_minutes: 60, reported_energy: 'normal', equipment_count: 3 },
  readiness: null,
  recent_summary: null,
};

/** An LLM that returns whatever it is told to, without a network call. */
function stubLlm(classification: unknown, composed: unknown, refusal?: string): LlmClient {
  let call = 0;
  return {
    async structured() {
      call += 1;
      return {
        parsed: call === 1 ? classification : composed,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        refusal: call === 2 ? refusal ?? null : null,
      };
    },
  };
}

const ok = { response_type: 'answer', message: 'Fine.' };

/* --------------------------------------------------------------- tests --- */

test('trimDecision drops the template body the model has no business discussing', () => {
  const trimmed = trimDecision(decision) as Record<string, unknown>;
  assert.equal(trimmed.kind, 'session');
  assert.ok(!('template_id' in trimmed));
  assert.ok(!JSON.stringify(trimmed).includes('variants'));
  assert.ok(!JSON.stringify(trimmed).includes('sequence_order'));
  // The whole point: an order of magnitude smaller than the engine object.
  assert.ok(JSON.stringify(trimmed).length < JSON.stringify(decision).length / 2);
});

test('a weekly change always requires confirmation', () => {
  const { action } = route('request_plan_change', {}, services);
  assert.equal(action?.action_type, 'propose_plan_change');
  assert.equal(action?.requires_confirmation, true);
  assert.equal(action?.status, 'proposed');
});

test('a today-only adaptation does not', () => {
  const { action } = route('adapt_today', { available_time_minutes: 25 }, services);
  assert.equal(action?.action_type, 'adapt_today');
  assert.equal(action?.requires_confirmation, false);
});

test('a time limit reaches the engine, and the engine respects it', () => {
  const { tools } = route('adapt_today', { available_time_minutes: 25 }, services);
  const proposed = tools.proposed as { kind: string; minutes?: number };
  if (proposed.kind === 'session') assert.ok(proposed.minutes! <= 25);
});

test('symptom language becomes a symptom flag, never an energy level', () => {
  const { tools } = route('report_pain_or_symptom', { body_area: 'knee', symptom_severity: 'moderate' }, services);
  const applied = (tools as { engine_result: unknown }).engine_result;
  assert.ok(applied);
  // The flag path is what the engine treats as a hard constraint; the entity
  // must not have been folded into recovery instead.
  const { tools: adaptTools } = route('adapt_today', { body_area: 'knee' }, services);
  const constraints = (adaptTools as { constraints_applied: Record<string, unknown> }).constraints_applied;
  assert.ok(Array.isArray(constraints.symptom_flags));
  assert.equal(constraints.energy, undefined);
  assert.equal(constraints.recovery_state, undefined);
});

test('no race definition means none is offered to talk about', () => {
  const { tools } = route('race_strategy', {}, services);
  assert.equal((tools as { race: unknown }).race, null);
});

test('a symptom report is typed safety and carries no action, whatever the model returns', async () => {
  const turn = await runCoachTurn({
    llm: stubLlm(
      { intent: 'report_pain_or_symptom', confidence: 0.9, entities: { body_area: 'knee' } },
      { response_type: 'adaptation', message: "Here's a harder session." },
    ),
    services, context, message: 'my knee hurts',
  });
  assert.equal(turn.response.response_type, 'safety');
  assert.equal(turn.action, null);
});

test('a refusal degrades to a safe reply instead of throwing', async () => {
  const turn = await runCoachTurn({
    llm: stubLlm({ intent: 'other', confidence: 0.2 }, null, 'declined'),
    services, context, message: 'something odd',
  });
  assert.equal(turn.response.response_type, 'clarification');
  assert.match(turn.response.message, /plan is unchanged/i);
  assert.equal(turn.action, null);
});

test('unparseable model output degrades rather than reaching the athlete', async () => {
  const turn = await runCoachTurn({
    llm: stubLlm({ intent: 'explain_today', confidence: 0.9 }, 'not an object'),
    services, context, message: 'why this?',
  });
  assert.equal(turn.response.response_type, 'clarification');
  assert.match(turn.response.message, /nothing in your plan changed/i);
});

test('a junk classification falls through to the no-tools branch', async () => {
  const turn = await runCoachTurn({
    llm: stubLlm({ nonsense: true }, ok),
    services, context, message: 'hello',
  });
  assert.equal(turn.classification.intent, 'other');
  assert.equal(turn.action, null);
});

test('every turn carries the versions a Coach request has to log', async () => {
  const turn = await runCoachTurn({
    llm: stubLlm({ intent: 'explain_today', confidence: 1 }, ok),
    services, context, message: 'why this?',
  });
  for (const key of ['prompt', 'safety', 'schema', 'engine', 'classifier_model', 'composer_model']) {
    assert.ok((turn.versions as Record<string, string>)[key], `missing ${key}`);
  }
});

test('the cached prefix holds nothing per-request', async () => {
  const seen: string[] = [];
  const spy: LlmClient = {
    async structured({ system }) {
      seen.push(system);
      return {
        parsed: seen.length === 1 ? { intent: 'explain_today', confidence: 1 } : ok,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
    },
  };
  await runCoachTurn({ llm: spy, services, context, message: 'why this?' });
  await runCoachTurn({ llm: spy, services, context: { ...context, request_id: 'different' }, message: 'and now?' });
  assert.equal(seen[0], seen[2], 'classifier prefix drifted between requests');
  assert.equal(seen[1], seen[3], 'composer prefix drifted between requests');
});

test('an unknown decision shape does not crash the trim', () => {
  const none: EngineDecision = {
    kind: 'no_session', reason_codes: [], rationale: 'none', guidance: 'rest',
  };
  const trimmed = trimDecision(none) as { kind: string; guidance: string };
  assert.equal(trimmed.kind, 'no_session');
  assert.equal(trimmed.guidance, 'rest');
});
