/**
 * The trial offer, shown after "Your plan is ready".
 *
 * Placement is the point: by here the athlete has answered the questions and
 * seen the plan built from them, so the offer is to start training on that
 * plan, not to pay before knowing what the app does. An athlete who leaves
 * here keeps the plan; AuthGate brings them back to this screen next time.
 *
 * The paywall itself is RevenueCat's, so pricing, copy and the yearly/monthly
 * split are changed in the dashboard rather than in a release. The screen below
 * is the fallback for when there is no offering configured, no network, or no
 * SDK key in the build — an athlete must never reach a dead end here, because
 * this is the only route into the app.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

import { ActionButton, Label, Rule } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { SignOutEscape } from '@/components/onboarding';
import { awaitEntitlement, fetchEntitlement, restorePurchases } from '@/data/subscriptionRepo';
import { ENTITLEMENT_ID, isPurchasesConfigured, isTestStore } from '@/lib/purchases';
import { LegalLinks } from '@/components/LegalLinks';
import { useEntitlement } from '@/state/entitlement';

/** What the subscription buys, in the app's own terms. Fallback screen only. */
const INCLUDED = [
  ['An adapting plan', 'Rebuilt around your race date, your week, and what you actually completed.'],
  ['Full, Express and Micro', 'Every session in three lengths, so a short day keeps the stimulus.'],
  ['Coach', 'Ask why a session is what it is, or change it in a sentence.'],
  ['Readiness', 'Six measures from your own training, with the confidence behind them.'],
] as const;

export default function TrialScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'checking' | 'confirming' | 'paywall' | 'fallback'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presented = useRef(false);

  const { refresh: refreshEntitlement } = useEntitlement();
  // The app-wide subscription state was read at sign-in, before this screen
  // granted anything. Refresh it on the way through, or the end of onboarding
  // would find a stale "no subscription" and send a paying athlete to the
  // subscription-ended screen.
  const proceed = useCallback(async () => {
    // Awaited: AuthGate holds a never-subscribed athlete on this screen, so
    // leaving before the shared state knows about the subscription would be
    // bounced straight back here.
    await refreshEntitlement();
    router.replace('/today' as never);
  }, [router, refreshEntitlement]);

  /** The server decides, not the device — a refund can outrank a local receipt. */
  const settleFromServer = useCallback(async () => {
    const e = await fetchEntitlement();
    if (e?.active) { await proceed(); return true; }
    return false;
  }, [proceed]);

  /**
   * After a purchase or restore, the server hears about it from RevenueCat's
   * webhook, which takes a few seconds. Checking once, straight away, missed
   * it every time and dropped a paying athlete back on this screen with no
   * explanation. So wait for it, and say what is happening while we do.
   */
  const confirmPurchase = useCallback(async () => {
    setPhase('confirming');
    const e = await awaitEntitlement();
    if (e?.active) { await proceed(); return true; }
    setPhase('fallback');
    setError('Your purchase went through, but we have not received confirmation yet. '
      + 'Tap Restore in a moment to continue. You will not be charged again.');
    return false;
  }, [proceed]);

  useEffect(() => {
    if (presented.current) return;
    presented.current = true;
    let cancelled = false;

    (async () => {
      // Someone reinstalling, or on a second device, already pays for this.
      if (await settleFromServer()) return;
      if (!isPurchasesConfigured()) { if (!cancelled) setPhase('fallback'); return; }

      try {
        const result = await RevenueCatUI.presentPaywallIfNeeded({
          requiredEntitlementIdentifier: ENTITLEMENT_ID,
        });
        if (cancelled) return;

        // NOT_PRESENTED means RevenueCat already considers them entitled, so
        // the server should agree; if it does not, the webhook is behind and
        // the fallback lets them retry rather than trapping them.
        if (result === PAYWALL_RESULT.PURCHASED
          || result === PAYWALL_RESULT.RESTORED
          || result === PAYWALL_RESULT.NOT_PRESENTED) {
          await confirmPurchase();
          return;
        }
        setPhase('fallback');
        if (result === PAYWALL_RESULT.ERROR) {
          setError('The store could not be reached. Nothing has been charged.');
        }
      } catch {
        if (!cancelled) setPhase('fallback');
      }
    })();

    return () => { cancelled = true; };
  }, [settleFromServer, confirmPurchase]);

  /** Re-opens RevenueCat's paywall from the fallback screen. */
  async function openPaywall() {
    setBusy(true);
    setError(null);
    try {
      const result = await RevenueCatUI.presentPaywall();
      if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
        await confirmPurchase();
        return;
      } else if (result === PAYWALL_RESULT.ERROR) {
        setError('The store could not be reached. Nothing has been charged.');
      }
    } catch {
      setError('Purchases are not available in this build yet.');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    const r = await restorePurchases();
    setBusy(false);
    if (r.ok) { await proceed(); return; }
    if (r.reason === 'cancelled') return;
    setError(
      r.reason === 'pending' ? 'Purchase found. Waiting for it to be confirmed. Try again in a moment.'
      : r.reason === 'nothing_to_restore' ? 'No active PIVOT subscription found on this Apple ID.'
      : r.reason === 'unavailable' ? 'Purchases are not available in this build.'
      : 'The store could not be reached. Try again in a moment.');
  }

  if (phase === 'checking' || phase === 'confirming') {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center', alignItems: 'center', gap: 14 }}>
        <ActivityIndicator color={color.red} />
        {phase === 'confirming' ? (
          <Text style={[t.bodySm, { color: color.muted2 }]}>Confirming your purchase…</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View style={{
        paddingTop: insets.top + 12, paddingBottom: 14,
        paddingHorizontal: space.gutter,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, backgroundColor: color.red }} />
          <Text style={[t.eyebrow, { color: color.ink }]}>PIVOT ENGINE</Text>
        </View>
        <Pressable onPress={busy ? undefined : restore} hitSlop={12} accessibilityRole="button"
          accessibilityLabel="Restore a previous purchase">
          <Label tone="muted">Restore</Label>
        </Pressable>
      </View>
      <Rule />

      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        <View style={{ paddingHorizontal: space.gutter, paddingTop: 22 }}>
          <Text style={[t.h1, { color: color.ink }]}>{'Start your\nplan free'}</Text>
          <Text style={[t.bodySm, { color: color.muted2, paddingTop: 10 }]}>
            Your plan is built and saved. The free trial is long enough to see it
            adapt around a real week: a missed day, a short day, a day you feel strong.
          </Text>
        </View>

        <View style={{ paddingTop: 22 }}>
          <Rule />
          {INCLUDED.map(([title, detail]) => (
            <View key={title} style={{
              paddingHorizontal: space.gutter, paddingVertical: 13,
              borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
            }}>
              <Text style={[t.rowTitle, { fontSize: 14, color: color.ink }]}>{title}</Text>
              <Text style={[t.bodySm, { color: color.muted2, marginTop: 3 }]}>{detail}</Text>
            </View>
          ))}
        </View>

        <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
          {/* Terms, length and price live on RevenueCat's paywall, which reads
              them from the store — repeating them here would be a second place
              to get them wrong. */}
          <Text style={[t.meta, { color: color.muted, lineHeight: 17 }]}>
            Subscriptions renew automatically until cancelled, which you can do any
            time in your Apple ID settings. Cancel before the trial ends and you are
            not charged. Payment is taken by Apple, not by us. Length, price and
            renewal period are shown before you confirm.
          </Text>
          <LegalLinks style={{ marginTop: 10 }} />
          {isTestStore ? (
            <Text style={[t.meta, { color: color.redDark, marginTop: 10 }]}>
              Test store build. Purchases are simulated and nothing is charged.
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={{
        paddingHorizontal: space.gutter, paddingTop: 12,
        paddingBottom: insets.bottom + 12,
        borderTopWidth: 1, borderTopColor: color.rule,
      }}>
        {error ? (
          <View style={{
            backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
            paddingHorizontal: 13, paddingVertical: 12, marginBottom: 12,
          }}>
            <Text style={[t.bodySm, { color: color.redDeep }]}>{error}</Text>
          </View>
        ) : null}
        <ActionButton
          label={busy ? 'Working…' : 'See plans'}
          variant="primary"
          onPress={busy ? undefined : openPaywall}
          style={{ opacity: busy ? 0.45 : 1 }}
        />
        {/* The paywall is the sharpest place to discover you signed up on the
            wrong account, and it was the one with no way out. */}
        <SignOutEscape />
      </View>
    </View>
  );
}
