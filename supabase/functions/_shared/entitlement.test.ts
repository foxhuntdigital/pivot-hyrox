/**
 * The entitlement rule is one SQL predicate, and getting it wrong either cuts
 * off a paying athlete or gives the product away. These pin the cases that are
 * easy to get backwards.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors public.has_active_entitlement — kept beside the migration it
 * describes so the intent is testable without a database.
 */
const entitled = (s: { status: string; current_period_end: string | null } | null, now: Date) =>
  !!s && ['trialing', 'active', 'in_grace'].includes(s.status)
  && (s.current_period_end === null || Date.parse(s.current_period_end) > now.getTime());

const NOW = new Date('2026-03-01T12:00:00Z');
const future = '2026-03-28T00:00:00Z';
const past = '2026-02-01T00:00:00Z';

describe('Entitlement', () => {
  test('a trial is fully entitled despite nothing being paid yet', () => {
    assert.equal(entitled({ status: 'trialing', current_period_end: future }, NOW), true);
  });

  test('cancelling does not end access — the paid period does', () => {
    // RevenueCat reports CANCELLATION with auto-renew off and the period intact.
    assert.equal(entitled({ status: 'active', current_period_end: future }, NOW), true,
      'still inside the period they paid for');
    assert.equal(entitled({ status: 'active', current_period_end: past }, NOW), false,
      'the period has now run out');
  });

  test('a billing retry keeps access while the store retries the charge', () => {
    assert.equal(entitled({ status: 'in_grace', current_period_end: future }, NOW), true);
  });

  test('a refund removes access even mid-period', () => {
    assert.equal(entitled({ status: 'revoked', current_period_end: future }, NOW), false);
  });

  test('expired is expired', () => {
    assert.equal(entitled({ status: 'expired', current_period_end: past }, NOW), false);
  });

  test('no subscription row at all is not entitled', () => {
    assert.equal(entitled(null, NOW), false);
  });

  test('a lifetime purchase has no period end and does not expire', () => {
    assert.equal(entitled({ status: 'active', current_period_end: null }, NOW), true);
  });
});
