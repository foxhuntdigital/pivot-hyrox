import assert from 'node:assert/strict';
import { test } from 'node:test';

import { athleteCapacity } from './athlete.ts';

test('the capacity answers reach Coach as the labels the athlete picked', () => {
  assert.deepEqual(athleteCapacity({ load_capacity: 2, technical_capacity: 4 }), {
    fitness: 'Intermediate', training_experience: 'Highly experienced',
  });
});

test('an unanswered or out-of-range capacity is unknown, not the middle', () => {
  const unknown = { fitness: null, training_experience: null };
  assert.deepEqual(athleteCapacity(null), unknown);
  assert.deepEqual(athleteCapacity({ load_capacity: null, technical_capacity: undefined }), unknown);
  assert.deepEqual(athleteCapacity({ load_capacity: 0, technical_capacity: 5 }), unknown);
  assert.deepEqual(athleteCapacity({ load_capacity: 2.5, technical_capacity: 1 }), {
    fitness: null, training_experience: 'New to it',
  });
});
