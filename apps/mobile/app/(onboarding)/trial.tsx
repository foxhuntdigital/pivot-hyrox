/**
 * The trial offer, shown once the explainer has said what the app is for.
 *
 * Placement is the point: asking for a card before the four scenes would be
 * asking someone to pay for something they have not been told about. By here
 * they have seen the fixed date, the three variants, the coach and the stimulus
 * model, so the offer answers a question they now have.
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
import { fetchEntitlement, restorePurchases } from '@/data/subscriptionRepo';
import { ENTITLEMENT_ID, isPurchasesConfigured, isTestStore } from '@/lib/purchases';

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
  const [phase, setPhase] = useState<'checking' | 'paywall' | 'fallback'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presented = useRef(false);

  const proceed = useCallback(() => router.replace('/goal' as never), [router]);

  /** The server decides, not the device — a refund can outrank a local receipt. */
  const settleFromServer = useCallback(async () => {
    const e = await fetchEntitlement();
    if (e?.active) { proceed(); return true; }
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
          if (await settleFromServer()) return;
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
  }, [settleFromServer]);

  /** Re-opens RevenueCat's paywall from the fallback screen. */
  async function openPaywall() {
    setBusy(true);
    setError(null);
    try {
      const result = await RevenueCatUI.presentPaywall();
      if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
        if (await settleFromServer()) return;
        setError('Purchase received. Waiting for it to be confirmed — try again in a moment.');
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
    if (r.ok) { proceed(); return; }
    if (r.reason === 'cancelled') return;
    setError(r.reason === 'pending'
      ? 'Purchase found. Waiting for it to be confirmed — try again in a moment.'
      : 'No previous purchase found on this Apple ID.');
  }

  if (phase === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator color={color.red} />
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
          <Text style={[t.h1, { color: color.ink }]}>Start your trial</Text>
          <Text style={[t.bodySm, { color: color.muted2, paddingTop: 10 }]}>
            Long enough to see the plan adapt around a real week — a missed day, a
            short day, a day you feel strong.
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
          {isTestStore ? (
            <Text style={[t.meta, { color: color.redDark, marginTop: 10 }]}>
              Test store build — purchases are simulated and nothing is charged.
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
      </View>
    </View>
  );
}
