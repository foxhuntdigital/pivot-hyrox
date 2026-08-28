/**
 * Subscription state, read from the server.
 *
 * The device never decides whether it is entitled. RevenueCat tells the server
 * by webhook, the server writes `public.subscriptions`, and this reads it back
 * so the UI can say what is running and when it renews. Access itself is
 * enforced in the Edge Functions — this is for presentation, not for gating.
 */
import { supabase } from '@/lib/supabase';
import { purchase, restore, type PurchaseOutcome } from '@/lib/purchases';

export type SubscriptionStatus =
  | 'trialing' | 'active' | 'in_grace' | 'expired' | 'revoked' | 'none';

export interface Entitlement {
  status: SubscriptionStatus;
  /** True while access is paid for — trials and grace periods included. */
  active: boolean;
  product_id: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  will_renew: boolean;
}

export const NO_ENTITLEMENT: Entitlement = {
  status: 'none', active: false, product_id: null,
  trial_ends_at: null, current_period_end: null, will_renew: false,
};

/**
 * Mirrors public.has_active_entitlement. Cancelling is not the end of access —
 * the paid period running out is.
 */
function isActive(row: { status: string; current_period_end: string | null }): boolean {
  if (!['trialing', 'active', 'in_grace'].includes(row.status)) return false;
  if (!row.current_period_end) return true;
  return Date.parse(row.current_period_end) > Date.now();
}

/** Null when there is no server to ask, which the caller reads as "unknown". */
export async function fetchEntitlement(): Promise<Entitlement | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('status, product_id, trial_ends_at, current_period_end, will_renew')
      .maybeSingle();
    if (error) return null;
    if (!data) return NO_ENTITLEMENT;
    return {
      status: data.status as SubscriptionStatus,
      active: isActive(data),
      product_id: data.product_id,
      trial_ends_at: data.trial_ends_at,
      current_period_end: data.current_period_end,
      will_renew: !!data.will_renew,
    };
  } catch {
    return null;
  }
}

/**
 * Buying and restoring, via RevenueCat.
 *
 * Each returns the server's view afterwards, not the SDK's. RevenueCat tells
 * the server by webhook and the server is what the Edge Functions gate on, so
 * believing the device here would let the two disagree — and the disagreement
 * that matters is a refund Apple has already clawed back.
 */
export type PurchaseResult =
  | { ok: true; entitlement: Entitlement }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'pending' | 'error'; message?: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Waits for the webhook to land. A purchase that succeeded on device but has
 * not reached us yet is 'pending', not a failure — the athlete has been
 * charged, and telling them it failed would be wrong.
 */
async function awaitEntitlement(attempts = 5): Promise<Entitlement | null> {
  for (let i = 0; i < attempts; i++) {
    const e = await fetchEntitlement();
    if (e?.active) return e;
    await sleep(600 * (i + 1));
  }
  return null;
}

async function settle(outcome: PurchaseOutcome): Promise<PurchaseResult> {
  if (outcome.kind === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (outcome.kind === 'unavailable') return { ok: false, reason: 'unavailable' };
  if (outcome.kind === 'error') return { ok: false, reason: 'error', message: outcome.message };

  const entitlement = await awaitEntitlement();
  if (entitlement) return { ok: true, entitlement };
  return { ok: false, reason: 'pending' };
}

/** Buys a package from the current offering. `packageId` is 'yearly' | 'monthly'. */
export async function purchasePlan(packageId: string): Promise<PurchaseResult> {
  return settle(await purchase(packageId));
}

export async function restorePurchases(): Promise<PurchaseResult> {
  return settle(await restore());
}
