import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSubscription, planName, type SubscriptionFacts } from './subscriptionView.ts';

const base: SubscriptionFacts = {
  status: 'active', active: true, product_id: 'pivot_yearly', store: 'app_store',
  trial_ends_at: null, current_period_end: '2027-03-12T12:00:00Z', will_renew: true,
};

test('an active, renewing plan says when it renews', () => {
  const s = describeSubscription(base);
  assert.equal(s.headline, 'Active');
  assert.match(s.detail, /^Renews \d+ Mar 2027\.$/);
  assert.equal(s.plan, 'Yearly');
  assert.equal(s.managedByApple, true);
});

test('cancelled is not ended: access runs to the period end', () => {
  const s = describeSubscription({ ...base, will_renew: false });
  assert.equal(s.headline, 'Cancelled');
  assert.match(s.detail, /keep full access until/);
});

test('a trial says when it ends and whether it converts', () => {
  const s = describeSubscription({ ...base, status: 'trialing', trial_ends_at: '2026-11-20T12:00:00Z' });
  assert.equal(s.headline, 'Free trial');
  assert.match(s.detail, /then your plan starts automatically/);
});

test('beta access is free and not managed by Apple', () => {
  const s = describeSubscription({ ...base, status: 'trialing', product_id: 'beta_comp', store: 'promotional', will_renew: false });
  assert.equal(s.headline, 'Beta access');
  assert.equal(s.managedByApple, false);
  assert.match(s.detail, /Nothing is charged/);
});

test('lapsed, refunded and never-subscribed each read differently', () => {
  assert.equal(describeSubscription({ ...base, status: 'expired', active: false }).headline, 'Ended');
  assert.equal(describeSubscription({ ...base, status: 'revoked', active: false }).headline, 'Refunded');
  assert.equal(describeSubscription({ ...base, status: 'none', active: false, product_id: null, store: null }).headline, 'No subscription');
  assert.equal(describeSubscription({ ...base, status: 'expired', active: false, product_id: 'beta_comp' }).headline, 'Beta access ended');
});

test('a billing problem is flagged while access continues', () => {
  assert.equal(describeSubscription({ ...base, status: 'in_grace' }).headline, 'Payment problem');
});

test('plan names from product ids', () => {
  assert.equal(planName('pivot_engine_pro_annual'), 'Yearly');
  assert.equal(planName('pivot.monthly'), 'Monthly');
  assert.equal(planName('something_else'), null);
});
