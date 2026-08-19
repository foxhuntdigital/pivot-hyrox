/**
 * D12 Active workout — the execution state machine (PRD §8.4).
 *
 * Design constraints from §6.4 and §18: large one-handed controls, minimum
 * 16sp body text, the screen stays awake, and every haptic is duplicated
 * visually so nothing is conveyed by feel alone.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';

import { VARIANT_LABEL } from '@pivot/engine';
import { color, type as t, space } from '@/theme/tokens';
import { ActionButton, Label } from '@/components/primitives';
import { useApp } from '@/state/store';
import { mmss } from '@/state/steps';

export default function ActiveScreen() {
  // A workout screen that sleeps mid-interval is useless.
  useKeepAwake();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, session, steps } = useApp();
  const [endPrompt, setEndPrompt] = useState(false);

  if (session.kind !== 'session' || !steps.length) {
    router.replace('/today');
    return null;
  }

  const index = Math.min(state.step_index, steps.length - 1);
  const step = steps[index];
  const isPaused = state.status === 'paused';
  const isLast = index >= steps.length - 1;

  const complete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isLast) {
      dispatch({ type: 'next_step', total: steps.length });
      router.replace('/done');
    } else {
      dispatch({ type: 'next_step', total: steps.length });
    }
  };

  const saveAndExit = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dispatch({ type: 'end_and_save' });
    setEndPrompt(false);
    router.replace('/done');
  };

  const discard = () => {
    dispatch({ type: 'end_and_discard' });
    setEndPrompt(false);
    router.replace('/today');
  };

  const percent = Math.round((100 * (index + 1)) / steps.length);

  return (
    <View style={{ flex: 1, backgroundColor: color.ink, paddingTop: insets.top }}>
      <StatusBar style="light" />

      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingVertical: 12,
      }}>
        <Text style={[t.labelSm, { fontSize: 11, letterSpacing: 1.32, color: color.muted3 }]}>
          {session.template.name} · {VARIANT_LABEL[session.variant.variant_code]}
        </Text>
        <Text style={[t.labelSm, { fontSize: 11, letterSpacing: 1.32, color: color.muted3 }]}>
          {step.phase}
        </Text>
      </View>

      {/* Segment bars: done, current, upcoming. */}
      <View
        style={{ flexDirection: 'row', gap: 2, paddingHorizontal: space.gutter }}
        accessibilityLabel={`Step ${index + 1} of ${steps.length}`}
      >
        {steps.map((_, i) => (
          <View key={i} style={{
            flex: 1, height: 4,
            backgroundColor: i < index ? color.red : i === index ? color.onDark : color.ruleDark,
          }} />
        ))}
      </View>

      {isPaused && (
        <View style={{ alignItems: 'center', paddingTop: 14 }}>
          <View style={{ backgroundColor: color.onDark, paddingVertical: 8, paddingHorizontal: 14 }}>
            <Text style={[t.labelSm, { fontSize: 11, letterSpacing: 1.54, color: color.ink }]}>
              Paused
            </Text>
          </View>
        </View>
      )}

      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space.gutter }}>
        <Text style={[t.eyebrow, { color: color.salmon }]}>{step.kind}</Text>
        <Text style={[t.stepQty, { color: color.onDark, marginTop: 8 }]}>{step.qty}</Text>
        <Text style={[t.h2, { fontSize: 26, color: color.onDarkSoft }]}>{step.label}</Text>

        <View style={{ height: 2, backgroundColor: color.ruleDark2, marginTop: 22 }} />
        <View style={{ flexDirection: 'row' }}>
          <View style={{
            flex: 1, paddingVertical: 14,
            borderRightWidth: 1, borderRightColor: color.ruleDark,
          }}>
            <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.26 }}>
              {step.targetKey}
            </Label>
            <Text style={[t.h2, { color: color.onDark, marginTop: 2 }]}>{step.target}</Text>
          </View>
          <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 16 }}>
            <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.26 }}>
              Heart rate
            </Label>
            {/* No HR source connected yet; showing a number would be inventing
                data. PRD §8.3 requires a neutral state over false precision. */}
            <Text style={[t.h2, { color: color.muted3, marginTop: 2, fontSize: 20 }]}>
              —<Text style={[t.meta, { color: color.muted3 }]}>  not connected</Text>
            </Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: color.ruleDark }} />

        <View style={{
          flexDirection: 'row', alignItems: 'baseline',
          justifyContent: 'space-between', paddingTop: 14,
        }}>
          <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.26 }}>Elapsed</Label>
          <Text style={[t.h2, { fontSize: 22, color: color.onDark }]}>
            {mmss(state.elapsed_seconds)}
          </Text>
        </View>

        <Text style={[t.bodySm, { fontSize: 12.5, color: color.muted3, marginTop: 18 }]}>
          {step.note}
        </Text>
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingBottom: Math.max(insets.bottom, 24) }}>
        <ActionButton
          size="lg"
          label={isLast ? 'Finish' : 'Complete Section'}
          onPress={complete}
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <ActionButton
            variant="outlineDark" arrow={null} label={isPaused ? 'Resume' : 'Pause'}
            onPress={() => {
              Haptics.selectionAsync();
              dispatch({ type: 'toggle_pause' });
            }}
            style={{ flex: 1, paddingVertical: 19 }}
          />
          <ActionButton
            variant="outlineDark" arrow={null} label="End early"
            onPress={() => setEndPrompt(true)}
            style={{ flex: 1, paddingVertical: 19 }}
          />
        </View>
      </View>

      {/* Ending early is a first-class outcome, not a failure. */}
      <Modal visible={endPrompt} transparent animationType="slide" onRequestClose={() => setEndPrompt(false)}>
        <Pressable
          onPress={() => setEndPrompt(false)}
          style={{ flex: 1, backgroundColor: 'rgba(16,15,14,0.7)' }}
        />
        <View style={{ backgroundColor: color.paper, borderTopWidth: 2, borderTopColor: color.ink }}>
          <Text style={[t.h4, {
            paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 4, color: color.ink,
          }]}>
            End early?
          </Text>
          <Text style={[t.bodySm, {
            paddingHorizontal: space.gutter, paddingBottom: 14, fontSize: 12.5, color: color.muted2,
          }]}>
            You're {percent}% through — {mmss(state.elapsed_seconds)} logged. Saving still
            counts today's stimulus toward the week.
          </Text>
          <View style={{ height: 1, backgroundColor: color.rule }} />
          <View style={{
            paddingHorizontal: space.gutter, paddingTop: 14, gap: 8,
            paddingBottom: Math.max(insets.bottom, 20),
          }}>
            <ActionButton label="Save what I did" onPress={saveAndExit} style={{ paddingVertical: 18 }} />
            <ActionButton
              label="Discard session" variant="outline" arrow={null}
              onPress={discard} style={{ paddingVertical: 18 }}
            />
            <Pressable onPress={() => setEndPrompt(false)} style={{ padding: 16 }}>
              <Text style={[t.button, { textAlign: 'center', color: color.muted, fontSize: 12 }]}>
                Keep going
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
