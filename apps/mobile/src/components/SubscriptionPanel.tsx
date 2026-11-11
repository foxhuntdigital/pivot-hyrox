/**
 * The subscription, and what can be done about it: used by Settings ›
 * Subscription and by the "subscription ended" screen, so both say the same
 * thing and offer the same ways forward.
 *
 * Subscribing opens RevenueCat's paywall, the same one onboarding shows.
 * Managing an App Store subscription (change plan, cancel) opens Apple's own
 * sheet: Apple requires cancellation to happen there, and anything we built
 * would be a second place to get it wrong. Restore is always offered, because
 * the athlete on a new phone is the one who needs it and cannot tell us so.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { color, space, type as t } from '@/theme/tokens';
import { ActionButton, Label } from '@/components/primitives';
import { LegalLinks } from '@/components/LegalLinks';
import { describeSubscription } from '@/data/subscriptionView';
import { useEntitlement } from '@/state/entitlement';
import { RedeemCodeLink } from '@/components/RedeemCodeLink';

export function SubscriptionPanel({ onActive }: {
  /** Called when a subscribe or restore leaves the athlete entitled. */
  onActive?: () => void;
}) {
  const { entitlement, subscribe, restore, manage, redeemCode } = useEntitlement();
  const [busy, setBusy] = useState<null | 'subscribe' | 'restore'>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A redeemed code arrives as a RevenueCat update that EntitlementProvider
  // confirms with the server; this only notices the result.
  const [redeeming, setRedeeming] = useState(false);
  const active = entitlement?.active ?? false;
  useEffect(() => {
    if (!redeeming || !active) return;
    setRedeeming(false);
    setMessage('Code redeemed.');
    onActive?.();
  }, [redeeming, active, onActive]);

  if (!entitlement) {
    return (
      <View style={{ paddingVertical: 40, alignItems: 'center' }}>
        <ActivityIndicator color={color.red} />
      </View>
    );
  }

  const s = describeSubscription(entitlement);
  const canManage = entitlement.active && s.managedByApple;
  const offerPlans = !entitlement.active || entitlement.product_id === 'beta_comp';

  const run = async (kind: 'subscribe' | 'restore') => {
    setBusy(kind);
    setMessage(null);
    const r = await (kind === 'subscribe' ? subscribe() : restore());
    setBusy(null);
    if (r.ok) {
      setMessage(kind === 'restore' ? 'Subscription restored.' : null);
      onActive?.();
    } else if (!r.cancelled && r.message) {
      setMessage(r.message);
    }
  };

  return (
    <View>
      <View style={{
        marginHorizontal: space.gutter, marginTop: 14, borderWidth: 2, borderColor: color.ink,
        paddingHorizontal: 14, paddingVertical: 14, gap: 6,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Label tone="ink">{s.headline}</Label>
          {s.plan ? <Text style={[t.meta, { color: color.muted2 }]}>{s.plan}</Text> : null}
        </View>
        <Text style={[t.bodySm, { color: color.ink }]}>{s.detail}</Text>
      </View>

      {message ? (
        <View style={{
          marginHorizontal: space.gutter, marginTop: 12,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Text style={[t.bodySm, { color: color.ink }]}>{message}</Text>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 16, gap: 10 }}>
        {offerPlans ? (
          <ActionButton
            label={busy === 'subscribe' ? 'Confirming…' : 'See plans'}
            onPress={busy ? undefined : () => run('subscribe')}
            style={{ opacity: busy && busy !== 'subscribe' ? 0.5 : 1 }}
          />
        ) : null}
        {canManage ? (
          <ActionButton
            label={entitlement.status === 'in_grace' ? 'Update payment in the App Store' : 'Manage in the App Store'}
            variant={offerPlans ? 'outline' : 'primary'}
            arrow={null}
            onPress={busy ? undefined : () => { void manage(); }}
          />
        ) : null}
      </View>

      <Pressable
        onPress={busy ? undefined : () => run('restore')}
        accessibilityRole="button"
        accessibilityLabel="Restore purchases"
        style={{ paddingVertical: 16, alignItems: 'center' }}
      >
        {busy === 'restore' ? <ActivityIndicator color={color.ink} /> : (
          <Text style={[t.bodySm, { color: color.muted2 }]}>
            Bought on another device?{' '}
            <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>Restore purchases</Text>
          </Text>
        )}
      </Pressable>

      {offerPlans ? (
        <RedeemCodeLink
          style={{ paddingTop: 0 }}
          onPress={async () => {
            setMessage(null);
            if (await redeemCode()) setRedeeming(true);
            else setMessage('Codes cannot be redeemed in this build.');
          }}
        />
      ) : null}

      <Text style={[t.meta, { color: color.muted, lineHeight: 17, marginHorizontal: space.gutter }]}>
        {canManage
          ? 'Changing plan or cancelling happens in your Apple ID settings. If you cancel, you keep '
            + 'access until the end of the period you have paid for.'
          : 'Subscriptions renew automatically until cancelled in your Apple ID settings. Payment is '
            + 'taken by Apple, not by us.'}
      </Text>
      <LegalLinks style={{ paddingHorizontal: space.gutter, paddingTop: 12, paddingBottom: 24 }} />
    </View>
  );
}
