/**
 * The recovery check-in's contribution to readiness (FR-015).
 *
 * The direction of each scale is the thing worth pinning down: stress and
 * soreness measure a burden, so a 5 must lower the score, while motivation
 * measures a resource and a 5 must raise it. Getting one of them backwards
 * would be invisible in the number and wrong in the coaching.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recoverySignal } from './readiness.ts';

test('no check-in is null, not zero', () => {
  assert.equal(recoverySignal(null), null);
  assert.equal(recoverySignal(undefined), null);
  // A row with every field blank says nothing either.
  assert.equal(recoverySignal({}), null);
});

test('the ends of the scale reach 1 and 0', () => {
  assert.equal(recoverySignal({
    sleep_hours: 8, energy: 'high', stress: 1, soreness: 1, motivation: 5,
  }), 1);
  assert.equal(recoverySignal({
    sleep_hours: 0, energy: 'low', stress: 5, soreness: 5, motivation: 1,
  }), 0);
});

test('stress and soreness lower the score; motivation raises it', () => {
  const calm = recoverySignal({ stress: 1 })!;
  const stressed = recoverySignal({ stress: 5 })!;
  assert.ok(calm > stressed, 'more stress must score lower');

  const fresh = recoverySignal({ soreness: 1 })!;
  const sore = recoverySignal({ soreness: 5 })!;
  assert.ok(fresh > sore, 'more soreness must score lower');

  const keen = recoverySignal({ motivation: 5 })!;
  const flat = recoverySignal({ motivation: 1 })!;
  assert.ok(keen > flat, 'more motivation must score higher');
});

test('a partial check-in is scored on what was answered', () => {
  // Sleeping 7.5 of a target 8 should read high even though four fields are
  // blank — silence is not a bad answer.
  const sleepOnly = recoverySignal({ sleep_hours: 7.5 })!;
  assert.ok(sleepOnly > 0.9, `expected a high score, got ${sleepOnly}`);

  // And adding a bad field must move it down rather than being ignored.
  const withStress = recoverySignal({ sleep_hours: 7.5, stress: 5 })!;
  assert.ok(withStress < sleepOnly);
});

test('sleep beyond the target does not overflow the scale', () => {
  assert.equal(recoverySignal({ sleep_hours: 12 }), 1);
  assert.equal(recoverySignal({ sleep_hours: 8 }), 1);
});

test('out-of-range values are clamped rather than trusted', () => {
  assert.equal(recoverySignal({ stress: 9 }), 0);
  assert.equal(recoverySignal({ motivation: -3 }), 0);
  assert.equal(recoverySignal({ sleep_hours: -1 }), 0);
});
