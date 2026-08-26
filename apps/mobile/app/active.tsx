/**
 * D12 Active workout — the execution state machine (PRD §8.4).
 *
 * Design constraints from §6.4 and §18: large one-handed controls, minimum
 * 16sp body text, the screen stays awake, and every haptic is duplicated
 * visually so nothing is conveyed by feel alone.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';

import { VARIANT_LABEL } from '@pivot/engine';
import { color, numeralTrim, type as t, space } from '@/theme/tokens';
import { ActionButton, Label } from '@/components/primitives';
import { useApp } from '@/state/store';
import { mmss } from '@/state/steps';
import { track, elapsedMinutes } from '@/lib/analytics';

export default function ActiveScreen() {
  // A workout screen that sleeps mid-interval is useless.
  useKeepAwake();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, session, steps } = useApp();
  const [endPrompt, setEndPrompt] = useState(false);
  const [showList, setShowList] = useState(false);

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
    // Per step rather than per tap (PRD §16): a HYROX session is single digits
    // to low tens of these, and the index pair is what makes drop-off within a
    // session readable without a second event.
    track({
      name: 'workout_step_completed',
      block_type: step.kind,
      exercise_id: step.exercise_id || null,
      step_index: index,
      total_steps: steps.length,
    });
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
    track({
      name: 'workout_abandoned',
      elapsed_minutes: elapsedMinutes(state.elapsed_seconds),
      block_index: index,
    });
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

      {/* Segment bars: done, current, upcoming.
          
          Also the way into the whole session. The bars already say how far
          through the athlete is but not what is coming, and mid-workout is
          exactly when "how many rounds left, and what is after this" is worth
          knowing — the player otherwise reveals the session one step at a time
          with no way to look ahead. Tapping them is the affordance because they
          are already the progress object and already a large target. */}
      <Pressable
        onPress={() => setShowList(true)}
        accessibilityRole="button"
        accessibilityLabel={`Step ${index + 1} of ${steps.length}. See the whole session.`}
        style={({ pressed }) => ({
          paddingHorizontal: space.gutter, paddingTop: 2, paddingBottom: 8,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {steps.map((_, i) => (
            <View key={i} style={{
              flex: 1, height: 4,
              backgroundColor: i < index ? color.red : i === index ? color.onDark : color.ruleDark,
            }} />
          ))}
        </View>
        <View style={{
          flexDirection: 'row', justifyContent: 'space-between', paddingTop: 7,
        }}>
          <Text style={[t.meta, { color: color.muted3 }]}>
            Step {index + 1} of {steps.length}
          </Text>
          <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.salmon }]}>
            See all ›
          </Text>
        </View>
      </Pressable>

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
        <Text style={[t.stepQty, numeralTrim.stepQty, { color: color.onDark, marginTop: 1 }]}>
          {step.qty}
        </Text>
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
          label={isLast ? 'Finish' : 'Next'}
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

      {/* The whole session, with the athlete's place in it.
          
          Read-only: tapping a row does not jump to it. Skipping ahead would
          write a log claiming work that was never performed, and the steps in
          between would be recorded as done rather than as missed. This answers
          "what is left" without becoming a way to change it. */}
      <Modal
        visible={showList}
        transparent
        animationType="slide"
        onRequestClose={() => setShowList(false)}
      >
        <Pressable
          onPress={() => setShowList(false)}
          accessibilityLabel="Dismiss"
          style={{ flex: 1, backgroundColor: 'rgba(16,15,14,0.7)' }}
        />
        <View style={{
          maxHeight: '82%', backgroundColor: color.ink,
          borderTopWidth: 2, borderTopColor: color.red,
        }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 12,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={[t.h4, { color: color.onDark }]}>{session.template.name}</Text>
              <Text style={[t.meta, { color: color.muted3, marginTop: 2 }]}>
                {steps.length} steps · {session.estimated_minutes} min planned
              </Text>
            </View>
            <Pressable
              onPress={() => setShowList(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              style={{
                width: 32, height: 32, borderWidth: 1, borderColor: color.ruleDark2,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontFamily: t.rowTitle.fontFamily, color: color.onDark }}>
                ✕
              </Text>
            </Pressable>
          </View>
          <View style={{ height: 1, backgroundColor: color.ruleDark }} />

          <ScrollView contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingBottom: Math.max(insets.bottom, 24),
          }}>
            {steps.map((s, i) => {
              const isDone = i < index;
              const isCurrent = i === index;
              return (
                <View
                  key={`${s.exercise_id}-${i}`}
                  accessibilityLabel={`${isDone ? 'Done' : isCurrent ? 'Current' : 'Upcoming'}: `
                    + `${s.qty} ${s.label}`}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: color.ruleDark,
                  }}
                >
                  {/* Where the athlete is, marked by a bar rather than by
                      colour alone (PRD §18). */}
                  <View style={{
                    width: 3, alignSelf: 'stretch',
                    backgroundColor: isCurrent ? color.red : 'transparent',
                  }} />
                  <Text style={[t.meta, {
                    width: 20, color: isDone ? color.red : color.muted3,
                  }]}>
                    {isDone ? '✓' : i + 1}
                  </Text>
                  <Text style={[t.rowTitle, {
                    width: 62, fontSize: 13,
                    color: isCurrent ? color.onDark : isDone ? color.muted3 : color.onDarkSoft,
                  }]}>
                    {s.qty}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontFamily: t.greeting.fontFamily, fontSize: 13,
                      color: isCurrent ? color.onDark : isDone ? color.muted3 : color.onDarkSoft,
                    }}>
                      {s.label}
                    </Text>
                    <Text style={[t.meta, { color: color.muted3, marginTop: 1 }]}>
                      {s.rest ? 'Rest' : s.phase.toLowerCase()}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <Text style={[t.labelXs, { color: color.salmon, letterSpacing: 1.2 }]}>
                      Now
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

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
