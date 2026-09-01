import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSetScheme, rpeFrom } from './prescription.mjs';

test('reads the seed encoding back into sets and reps', () => {
  // Four sets of six. The old encoding showed the athlete "4 x6" and logged
  // prescribed_reps = 4.
  assert.deepEqual(parseSetScheme(4, 'x6'), {
    sets: 4, reps_min: 6, reps_max: 6, per_side: false,
    amrap_reserve: null, target_rpe: null, rest_seconds: null,
  });
});

test('a bare rep count reads the same as an x-prefixed one', () => {
  assert.deepEqual(parseSetScheme(3, '8'), parseSetScheme(3, 'x8'));
});

test('per-side work is marked, not doubled', () => {
  // Three sets of ten a side is three sets, not six, and ten reps, not twenty.
  // Doubling here would silently double the logged volume.
  for (const unit of ['x10/leg', 'x10/side', 'x10/arm']) {
    const p = parseSetScheme(3, unit);
    assert.equal(p.sets, 3, unit);
    assert.equal(p.reps_min, 10, unit);
    assert.equal(p.per_side, true, unit);
  }
});

test('an authored range stays a range', () => {
  assert.deepEqual(
    { min: parseSetScheme(4, 'x8-10').reps_min, max: parseSetScheme(4, 'x8-10').reps_max },
    { min: 8, max: 10 });
});

test('a backwards range is ordered rather than rejected', () => {
  // The DB constraint refuses reps_min > reps_max, so normalising here keeps an
  // authoring typo from failing the import for a recoverable reason.
  const p = parseSetScheme(4, 'x10-8');
  assert.equal(p.reps_min, 8);
  assert.equal(p.reps_max, 10);
});

test('AMRAP has no rep count and says so', () => {
  const p = parseSetScheme(3, 'AMRAP-2');
  assert.equal(p.sets, 3);
  assert.equal(p.reps_min, null, 'inventing a rep count for AMRAP would be a fabricated target');
  assert.equal(p.amrap_reserve, 2);
  assert.equal(parseSetScheme(3, 'AMRAP').amrap_reserve, 0);
});

test('rest is never derived', () => {
  // The field that separates strength from density work was not in the dump.
  // A guess here would sit behind every progression decision.
  for (const unit of ['x6', 'x8-10', 'AMRAP-2', 'x10/leg']) {
    assert.equal(parseSetScheme(4, unit).rest_seconds, null, unit);
  }
});

test('the RPE ceiling comes from the authored note', () => {
  assert.equal(parseSetScheme(4, 'x6', { intensityNote: 'RPE 7' }).target_rpe, 7);
  // The top of a range: the field is a ceiling progression must stay under.
  assert.equal(rpeFrom('RPE 3-4'), 4);
  assert.equal(rpeFrom('controlled'), null);
  // `intensity_note` is free text and holds numbers that are not efforts.
  // 'leave 2' is two reps in reserve on a set of pull-ups; reading it as RPE 2
  // would set an intensity ceiling no progression could ever clear.
  assert.equal(rpeFrom('leave 2'), null);
  assert.equal(rpeFrom('8 repeats'), null);
  assert.equal(parseSetScheme(3, 'AMRAP-2', { intensityNote: 'leave 2' }).target_rpe, null);
  assert.equal(rpeFrom(null), null);
  assert.equal(rpeFrom('RPE 47'), null, 'out of range is not an RPE');
});

test('non-set prescriptions fall through untouched', () => {
  assert.equal(parseSetScheme(800, 'm'), null);
  assert.equal(parseSetScheme(30, 'sec/side'), null);
  assert.equal(parseSetScheme(20, 'ft'), null);
  assert.equal(parseSetScheme(0, 'x6'), null);
  assert.equal(parseSetScheme(4, ''), null);
});
