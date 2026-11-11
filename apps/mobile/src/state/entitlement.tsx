/**
 * The signed-in athlete's subscription, for the screens that show it and for
 * the gate that stops a lapsed athlete at a dead end.
 *
 * Read from the server (`fetchEntitlement`), never decided on the device.
 * `entitlement` is null while unknown — not signed in, no Supabase, or a read
 * that failed — and unknown never locks anyone out: only a definite answer
 * that access has ended does. A flaky network must not look like a lapsed
 * subscription.
 *
 * Refreshed on sign-in, whenever the app returns to the foreground (a renewal,
 * a cancellation or a refund made in Settings happens while the app is in the
 * background), and when RevenueCat reports a change on the device.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

import {
  awaitEntitlement, fetchEntitlement, restorePurchases, type Entitlement,
} from '@/data/subscriptionRepo';
import { isPurchasesConfigured, manageSubscriptions, onCustomerInfoChange } from '@/lib/purchases';
import { useSession } from '@/state/session';

/** What a subscribe or restore attempt came to, worded for the athlete. */
export type ActionOutcome =
  | { ok: true }
  | { ok: false; cancelled?: boolean; message?: string };

interface EntitlementStore {
  entitlement: Entitlement | null;
  /** True only when the server has said, definitely, that access has ended. */
  lapsed: boolean;
  refresh(): Promise<Entitlement | null>;
  /** RevenueCat's paywall, then waits for the server to confirm a purchase. */
  subscribe(): Promise<ActionOutcome>;
  restore(): Promise<ActionOutcome>;
  manage(): Promise<void>;
}

const Ctx = createContext<EntitlementStore | null>(null);

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const { status, session } = useSession();
  const userId = session?.user.id ?? null;
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);

  const refresh = useCallback(async () => {
    if (status !== 'signed_in') { setEntitlement(null); return null; }
    const e = await fetchEntitlement();
    // A failed read keeps what we knew rather than forgetting it: dropping to
    // unknown would lift the gate on a lapsed athlete every time the network
    // blipped, and setting it from nothing would lock out a paying one.
    if (e) setEntitlement(e);
    return e;
  }, [status]);

  useEffect(() => {
    setEntitlement(null);
    if (status === 'signed_in') void refresh();
  }, [status, userId, refresh]);

  useEffect(() => {
    if (status !== 'signed_in') return;
    const sub = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    const off = onCustomerInfoChange(() => { void refresh(); });
    return () => { sub.remove(); off(); };
  }, [status, refresh]);

  const subscribe = useCallback(async (): Promise<ActionOutcome> => {
    if (!isPurchasesConfigured()) return { ok: false, message: 'Purchases are not available in this build.' };
    try {
      const result = await RevenueCatUI.presentPaywall();
      if (result === PAYWALL_RESULT.CANCELLED || result === PAYWALL_RESULT.NOT_PRESENTED) {
        return { ok: false, cancelled: true };
      }
      if (result === PAYWALL_RESULT.ERROR) {
        return { ok: false, message: 'The store could not be reached. Nothing has been charged.' };
      }
      // Purchased or restored: the server hears from RevenueCat's webhook a
      // few seconds later, so wait for it rather than reading once and
      // telling a paying athlete nothing happened.
      const e = await awaitEntitlement();
      if (e) setEntitlement(e);
      if (e?.active) return { ok: true };
      return { ok: false, message: 'Your purchase went through, but we have not received confirmation '
        + 'yet. Tap Restore purchases in a moment. You will not be charged again.' };
    } catch {
      return { ok: false, message: 'Purchases are not available in this build.' };
    }
  }, []);

  const restore = useCallback(async (): Promise<ActionOutcome> => {
    const r = await restorePurchases();
    if (r.ok) { setEntitlement(r.entitlement); return { ok: true }; }
    if (r.reason === 'cancelled') return { ok: false, cancelled: true };
    return {
      ok: false,
      message: r.reason === 'pending' ? 'Purchase found. Waiting for it to be confirmed. Try again in a moment.'
        : r.reason === 'nothing_to_restore' ? 'No active PIVOT subscription found on this Apple ID.'
        : r.reason === 'unavailable' ? 'Purchases are not available in this build.'
        : 'The store could not be reached. Try again in a moment.',
    };
  }, []);

  const manage = useCallback(async () => {
    await manageSubscriptions();
    // Back from Apple's sheet: a cancellation or plan change made there
    // reaches us by webhook, so look again.
    void refresh();
  }, [refresh]);

  const value = useMemo<EntitlementStore>(() => ({
    entitlement,
    lapsed: status === 'signed_in' && entitlement !== null && !entitlement.active,
    refresh, subscribe, restore, manage,
  }), [entitlement, status, refresh, subscribe, restore, manage]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntitlement(): EntitlementStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEntitlement must be used inside EntitlementProvider');
  return v;
}
