import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whyUnavailable, type RefusalInput } from './unavailableReason.ts';

const input: RefusalInput = {
  technical_capacity: 2, low_impact_required: true, considerations: ['postpartum'],
  recovery_state: 'poor', energy: 'low', sleep_hours: 5, available_minutes: 20, symptom_flags: [],
};

test('the first constraint whose removal lets it build is the reason', () => {
  assert.deepEqual(whyUnavailable(input, i => i.technical_capacity == null), { reason: 'skill', hard: true });
  assert.deepEqual(whyUnavailable(input, i => !i.low_impact_required), { reason: 'impact', hard: true });
  assert.deepEqual(whyUnavailable(input, i => i.considerations.length === 0), { reason: 'considerations', hard: true });
  assert.deepEqual(whyUnavailable(input, i => i.available_minutes >= 60), { reason: 'today', hard: false });
  assert.deepEqual(whyUnavailable(input, () => false), { reason: 'equipment', hard: true });
});
