import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditInputs, AUDIT_FORMAT } from './audit.ts';

const template = (id: string) => ({
  id, name: id, workout_family: 'run_base', primary_goal: 'aerobic_durability',
  estimated_minutes: 30, impact_level: 'medium' as const, hyrox_specificity: 0.5,
  postpartum_friendly: true, requires_running: true, requires_ski: false,
  tags: [], variants: [], blocks: [],
});

const input = () => ({
  local_date: '2026-03-02',
  phase_type: 'build' as const,
  days_to_race: 90,
  stimulus_requirements: [],
  recent_sessions: [],
  recovery_state: 'okay' as const,
  energy: 'normal' as const,
  sleep_hours: 7,
  available_minutes: 45,
  available_equipment: ['db'],
  low_impact_required: false,
  symptom_flags: ['tight calf'],
  athlete_override: true,
  considerations: ['Postpartum'],
  candidates: [template('wo_a'), template('wo_b')],
  substitutions: [{ exercise_id: 'ex_run', substitute_exercise_id: 'ex_rowerg', reason: 'x', priority: 1 }],
});

test('the candidate library is reduced to ids', () => {
  const audit = auditInputs(input(), 'v1');
  assert.deepEqual(audit.candidate_ids, ['wo_a', 'wo_b']);
  assert.equal(audit.candidate_count, 2);
  assert.equal('candidates' in audit, false);
});

test('everything that decides the outcome survives', () => {
  const audit = auditInputs(input());
  // Each of these changes what the engine returns, so a replay without them
  // would reproduce a different decision.
  assert.equal(audit.recovery_state, 'okay');
  assert.equal(audit.available_minutes, 45);
  assert.deepEqual(audit.available_equipment, ['db']);
  assert.deepEqual(audit.symptom_flags, ['tight calf']);
  assert.equal(audit.athlete_override, true);
  assert.deepEqual(audit.considerations, ['Postpartum']);
  assert.equal(audit.phase_type, 'build');
  assert.equal(audit.days_to_race, 90);
});

test('substitutions stay inline, because a swap is unreadable without them', () => {
  const audit = auditInputs(input());
  assert.equal(audit.substitutions.length, 1);
  assert.equal(audit.substitutions[0].substitute_exercise_id, 'ex_rowerg');
});

test('the row says which shape it is', () => {
  assert.equal(auditInputs(input(), 'v1').audit_format, AUDIT_FORMAT);
  assert.equal(auditInputs(input(), 'v1').content_version, 'v1');
  assert.equal(auditInputs(input()).content_version, null);
});

test('the reduction is the point', () => {
  const many = { ...input(), candidates: Array.from({ length: 203 }, (_, i) => template(`wo_${i}`)) };
  const before = JSON.stringify(many).length;
  const after = JSON.stringify(auditInputs(many)).length;
  assert.ok(after < before / 10, `expected an order of magnitude, got ${before} -> ${after}`);
});
