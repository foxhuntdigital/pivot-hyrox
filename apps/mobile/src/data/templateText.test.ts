import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableDescription } from './templateText.ts';

test('provenance stamps read as no description', () => {
  for (const d of [
    'Adaptive Athlete Follow-up v2 workout.',
    'Adaptive Athlete Authored v1 workout.',
    'Adaptive Athlete Running Expansion v1 workout.',
    'Adaptive Athlete RowErg Expansion v1',
  ]) assert.equal(readableDescription(d), null, d);
});

test('a real description is kept, and empty is none', () => {
  assert.equal(readableDescription(' Steady rows to build the engine. '), 'Steady rows to build the engine.');
  assert.equal(readableDescription(''), null);
  assert.equal(readableDescription(null), null);
  assert.equal(readableDescription(undefined), null);
});
