/**
 * The explainer that runs before onboarding starts.
 *
 * Onboarding asks seven screens of questions without ever saying what the
 * answers are for, and the three variants — the app's central idea — were left
 * to be inferred from a card on Today. Four scenes, skippable, shown once
 * before the first question.
 *
 * It sits inside the onboarding stack rather than in the tabs because it is
 * part of the same arrival: the athlete has an account and no plan, and this is
 * the first thing they see.
 */
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, Label, Rule } from '@/components/primitives';
import { INTRO_SCENES } from '@/components/IntroScenes';
import { useReduceMotion } from '@/lib/motion';
import { color, space, type as t } from '@/theme/tokens';
import { SignOutEscape } from '@/components/onboarding';

export default function IntroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const reduced = useReduceMotion();

  // Held until the platform answers: starting an animation and then correcting
  // it is the thing Reduce Motion exists to prevent. The wait is a frame or two.
  if (reduced === null) return <View style={{ flex: 1, backgroundColor: color.paper }} />;

  const total = INTRO_SCENES.length;
  const isLast = index >= total - 1;
  const { id, Scene } = INTRO_SCENES[index];

  // The offer comes after the explainer, never before it: by here the athlete
  // has been told what the thing is, so the trial answers a question rather
  // than interrupting one. Skip lands in the same place — skipping the scenes
  // is not opting out of the offer.
  const begin = () => router.replace('/trial' as never);
  const next = () => (isLast ? begin() : setIndex(i => i + 1));

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View style={{ paddingTop: insets.top + 12, paddingBottom: 14 }}>
        {/* The same hairline progress the onboarding steps use, so the two read
            as one flow rather than as an ad before it. */}
        <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: space.gutter }}>
          {INTRO_SCENES.map((s, i) => (
            <View key={s.id} style={{
              flex: 1, height: 2,
              backgroundColor: i <= index ? color.ink : color.rule,
            }} />
          ))}
        </View>
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: space.gutter, paddingTop: 14,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, backgroundColor: color.red }} />
            <Text style={[t.eyebrow, { color: color.ink }]}>PIVOT ENGINE</Text>
          </View>
          <Pressable
            onPress={begin}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Skip the introduction and start setting up"
          >
            <Label tone="muted">Skip</Label>
          </Pressable>
        </View>
      </View>
      <Rule />

      {/* Keyed on the scene id so each one mounts fresh and its entry
          animation runs, rather than cross-fading between two live scenes. */}
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space.gutter }}>
        <Scene key={id} reduced={reduced} />
      </View>

      <View style={{
        paddingHorizontal: space.gutter,
        paddingBottom: Math.max(insets.bottom, 20), paddingTop: 10,
      }}>
        <ActionButton
          label={isLast ? 'Build my plan' : 'Next'}
          onPress={next}
          style={{ paddingVertical: 19 }}
        />
        {!isLast ? (
          <Text style={[t.meta, {
            textAlign: 'center', color: color.muted3, paddingTop: 12,
          }]}>
            {index + 1} of {total}
          </Text>
        ) : null}

        {/* This screen and `trial` both `replace` their way forward, so neither
            has a Back and the account just created has no other exit. */}
        <SignOutEscape />
      </View>
    </View>
  );
}
