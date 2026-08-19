/**
 * The app shell: a fixed wordmark header, the active tab's content, and the
 * custom bottom bar.
 *
 * The design's tab bar is a 2px ink rule with four columns, each marked by an
 * 18x3 red bar above its label — not a platform tab bar, so it is drawn rather
 * than configured.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, type as t, space } from '@/theme/tokens';
import { Rule } from '@/components/primitives';
import { useApp } from '@/state/store';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'plan', label: 'Plan' },
  { key: 'progress', label: 'Progress' },
  { key: 'profile', label: 'Profile' },
] as const;

const HEADER_LABEL: Record<string, string> = {
  today: 'Wed 19 Aug',
  plan: 'Week 7 / 16',
  progress: '30 day window',
  profile: 'Account',
};

function Header({ active }: { active: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: color.paper }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingTop: 10, paddingBottom: 12,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 12, height: 12, backgroundColor: color.red }} />
          <Text style={[t.eyebrow, { color: color.ink }]}>PIVOT</Text>
        </View>
        <Text style={[t.labelSm, { color: color.muted, letterSpacing: 1.26 }]}>
          {HEADER_LABEL[active] ?? ''}
        </Text>
      </View>
      <Rule heavy />
    </View>
  );
}

function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const active = pathname.replace('/', '') || 'today';

  return (
    <View style={{ backgroundColor: color.paper }}>
      <Rule heavy />
      <View style={{ flexDirection: 'row', paddingBottom: Math.max(insets.bottom, 12) }}>
        {TABS.map(tab => {
          const isActive = active === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => router.replace(`/${tab.key}` as never)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={tab.label}
              style={({ pressed }) => ({
                flex: 1, minHeight: 52, paddingTop: 11, paddingBottom: 9,
                alignItems: 'center', justifyContent: 'center', gap: 6,
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              {/* Selection is marked by the bar AND the label weight/colour, so
                  it never depends on colour alone (PRD §18). */}
              <View style={{
                width: 18, height: 3,
                backgroundColor: isActive ? color.red : 'transparent',
              }} />
              <Text style={[t.label, {
                fontSize: 10, letterSpacing: 1,
                color: isActive ? color.ink : color.muted3,
              }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const pathname = usePathname();
  const active = pathname.replace('/', '') || 'today';
  const { state } = useApp();

  // The player and completion screens are their own routes; the shell hides
  // while one is on screen.
  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <Header active={active} />
      <Tabs
        tabBar={() => null}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.paper } }}
      >
        {TABS.map(tab => (
          <Tabs.Screen key={tab.key} name={tab.key} options={{ title: tab.label }} />
        ))}
      </Tabs>
      <TabBar />
    </View>
  );
}
