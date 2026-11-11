/**
 * Where a signed-in athlete whose subscription has ended lands, instead of an
 * app whose every request is refused (402) with nothing to say why.
 *
 * Reached only from AuthGate, and only on a definite answer from the server
 * that access has ended. The way out is any of: subscribing, restoring, or
 * signing out. Account settings stay reachable from here, because deleting an
 * account must never require paying first.
 */
import React from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, space, type as t } from '@/theme/tokens';
import { SubscriptionPanel } from '@/components/SubscriptionPanel';
import { SignOutEscape } from '@/components/onboarding';

export default function SubscribeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.gutter, paddingBottom: 18 }}>
        <View style={{ width: 12, height: 12, backgroundColor: color.red }} />
        <Text style={[t.eyebrow, { color: color.ink }]}>PIVOT ENGINE</Text>
      </View>
      <View style={{ paddingHorizontal: space.gutter, gap: 10 }}>
        <Text style={[t.h1, { color: color.ink }]}>{'Your plan is\nwaiting'}</Text>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          Your subscription has ended. Your plan, your history and your readiness are all still
          here. Choose a plan to pick up where you left off.
        </Text>
      </View>

      <SubscriptionPanel onActive={() => router.replace('/today' as never)} />

      <Pressable
        onPress={() => router.push('/settings/account' as never)}
        accessibilityRole="button"
        style={{ paddingVertical: 10, alignItems: 'center' }}
      >
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          Account settings, including{' '}
          <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>delete account</Text>
        </Text>
      </Pressable>
      <SignOutEscape />
    </ScrollView>
  );
}
