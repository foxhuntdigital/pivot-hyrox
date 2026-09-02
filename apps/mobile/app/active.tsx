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
import { SetEntryRow } from '@/components/SetEntry';
import { useApp } from '@/state/store';
import type { ExerciseGuidance } from '@/data/todayRepo';
import { mmss } from '@/lib/format';
import { buildSplits } from '@/state/splits';
import { track, elapsedMinutes } from '@/lib/analytics';

/**
 * "135 lb x 6 @ 7 - 8 days ago", with every part optional.
 *
 * A set logged without a weight is still a rep count worth showing, and one
 * logged without an RPE is still a load. Nothing is invented to fill a gap.
 */
function lastLine(last: NonNullable<ExerciseGuidance['last']>): string {
  const parts: string[] = [];
  if (last.load != null) parts.push(`${last.load}${last.load_unit ? ` ${last.load_unit}` : ''}`);
  if (last.reps != null) parts.push(`${parts.length ? '\u00d7 ' : ''}${last.reps}`);
  if (last.rpe != null) parts.push(`@ ${last.rpe}`);
  const when = last.days_ago === 0 ? 'today'
    : last.days_ago === 1 ? 'yesterday'
    : `${last.days_ago} days ago`;
  return `${parts.join(' ')}  \u00b7  ${when}`;
}

/** The suggestion, or nothing at all when the engine is holding. */
function suggestionLine(s: ExerciseGuidance['suggestion']): string | null {
  if (s.dimension === 'load' && s.load != null) {
    return `${s.load}${s.load_unit ? ` ${s.load_unit}` : ''} suggested`;
  }
  if (s.dimension === 'reps' && s.reps != null) return `${s.reps} reps suggested`;
  // A hold, a density track, or no rule: the reason line below says why, and a
  // repeated number here would read as a change when nothing changed.
  return null;
}

export default function ActiveScreen() {
  // A workout screen that sleeps mid-interval is useless.
  useKeepAwake();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, session, steps, guidance } = useApp();
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

  /**
   * Every Next is a lap. The laps already banked, and the one still running.
   *
   * The current step is deliberately not in `splits` — it has no final time yet
   * — so it is shown on its own clock beside the session's. That is the pair a
   * stopwatch shows and the pair an athlete mid-station actually wants: how
   * long this station has taken, and how long they have been going.
   */
  const splits = buildSplits(steps, state.step_seconds, index);
  const splitSeconds = state.step_seconds[index] ?? 0;
  const lastSplit = splits.length ? splits[splits.length - 1] : null;

  /** Cross-session history for this movement, when the server had any. */
  const guide = step.exercise_id ? guidance[step.exercise_id] : undefined;

  /**
   * The weight from the previous set of this same movement, THIS session.
   *
   * Distinct from the cross-session prior shown above it, and both are there
   * because they answer different questions: this prefills the field from the
   * set just done, and `guidance` says what was lifted on a different day and
   * what the engine makes of it. This used to be the only prior the screen
   * could honestly offer, because the server did not serve the other one. It
   * does now (`_shared/guidance.ts`).
   */
  const carryWeight = (() => {
    if (step.set_number == null) return null;
    for (let i = index - 1; i >= 0; i--) {
      const prev = steps[i];
      if (prev.exercise_id !== step.exercise_id) continue;
      const w = state.entries[i]?.weight;
      if (typeof w === 'number') return w;
    }
    return null;
  })();

  const entry = state.entries[index] ?? {};

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

      {/* Read at arm's length, mid-effort, on a phone propped against a water
          bottle — so this row is sized for glancing rather than for reading.
          The session name yields first: which round you are on survives
          truncation, the name is the part you already know. */}
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
        gap: 12, paddingHorizontal: space.gutter, paddingVertical: 12,
      }}>
        <Text
          numberOfLines={1}
          style={[t.labelSm, {
            flexShrink: 1, fontSize: 13, letterSpacing: 1.2, color: color.muted3,
          }]}
        >
          {session.template.name} · {VARIANT_LABEL[session.variant.variant_code]}
        </Text>
        <Text
          numberOfLines={1}
          style={[t.labelSm, { fontSize: 13, letterSpacing: 1.2, color: color.onDarkSoft }]}
        >
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
          paddingHorizontal: space.gutter, paddingTop: 2, paddingBottom: 14,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {steps.map((_, i) => (
            <View key={i} style={{
              // Taller alongside the larger type — a 4pt bar under 14pt text
              // reads as a hairline rather than as the progress it is.
              flex: 1, height: 6,
              backgroundColor: i < index ? color.red : i === index ? color.onDark : color.ruleDark,
            }} />
          ))}
        </View>
        <View style={{
          flexDirection: 'row', alignItems: 'baseline',
          justifyContent: 'space-between', paddingTop: 9,
        }}>
          <Text style={[t.meta, { fontSize: 14, color: color.muted3 }]}>
            Step {index + 1} of {steps.length}
          </Text>
          {/* The only way into the session list, so it is sized as the control
              it is rather than as a caption next to it. */}
          <Text style={[t.meta, {
            fontFamily: t.rowTitle.fontFamily, fontSize: 15, color: color.salmon,
          }]}>
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

        {/* Only on a working set, and never on rest. Placed directly under the
            movement because during a set it is the thing the athlete came here
            to do; the clocks below matter more between sets than during one. */}
        {/* What they lifted last time, and what the engine makes of it. Absent
            when the server has nothing comparable — an answer, and better than
            a number borrowed from a different day. */}
        {step.set_number != null && !step.rest && guide ? (
          <View style={{
            marginTop: 14, paddingTop: 12,
            borderTopWidth: 1, borderTopColor: color.ruleDark,
          }}>
            {guide.last ? (
              <Text style={[t.bodySm, { color: color.onDarkSoft }]}>
                <Text style={{ color: color.muted3 }}>Last  </Text>
                {lastLine(guide.last)}
              </Text>
            ) : null}
            {suggestionLine(guide.suggestion) ? (
              <Text style={[t.bodySm, { color: color.onDark, marginTop: 2 }]}>
                <Text style={{ color: color.muted3 }}>Today  </Text>
                {suggestionLine(guide.suggestion)}
              </Text>
            ) : null}
            <Text style={[t.meta, { color: color.muted3, marginTop: 4 }]}>
              {guide.suggestion.reason}
            </Text>
          </View>
        ) : null}

        {step.set_number != null && !step.rest ? (
          <SetEntryRow
            entry={entry}
            prescribedReps={step.prescribed_reps_min ?? null}
            targetRpe={step.target_rpe ?? null}
            carryWeight={carryWeight}
            unit="lb"
            logsLoad={step.logs_load !== false}
            onChange={patch => dispatch({ type: 'set_entry', step: index, entry: patch })}
          />
        ) : null}

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

        {/* Split beside elapsed, the split first: it is the number that
            changes what the athlete does next, and the one they are pacing
            against. Both are moving time — a pause stops them together. */}
        <View style={{ flexDirection: 'row', paddingTop: 14 }}>
          <View style={{
            flex: 1, borderRightWidth: 1, borderRightColor: color.ruleDark, paddingRight: 12,
          }}>
            <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.26 }}>
              {step.rest ? 'Rest split' : 'Split'}
            </Label>
            <Text
              accessibilityLabel={`This section: ${mmss(splitSeconds)}`}
              style={[t.h2, { fontSize: 22, color: color.onDark, marginTop: 2 }]}
            >
              {mmss(splitSeconds)}
            </Text>
          </View>
          <View style={{ flex: 1, paddingLeft: 16 }}>
            <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.26 }}>Elapsed</Label>
            <Text style={[t.h2, { fontSize: 22, color: color.muted3, marginTop: 2 }]}>
              {mmss(state.elapsed_seconds)}
            </Text>
          </View>
        </View>

        {/* The lap just banked. One line, because the whole list is a tap away
            and mid-workout is not the moment to read a table. */}
        {lastSplit ? (
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'baseline', paddingTop: 10,
          }}>
            <Text style={[t.meta, { color: color.muted3 }]} numberOfLines={1}>
              Last · {lastSplit.rest ? 'rest' : lastSplit.label}
            </Text>
            <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.salmon }]}>
              {mmss(lastSplit.seconds)}
            </Text>
          </View>
        ) : null}

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
                {splits.length ? ' · split / elapsed' : ''}
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
                  {/* The list doubles as the lap table: a completed step
                      carries the time it took, the current one carries the
                      clock still running on it. */}
                  {isCurrent ? (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[t.rowTitle, { fontSize: 13, color: color.onDark }]}>
                        {mmss(splitSeconds)}
                      </Text>
                      <Text style={[t.labelXs, { color: color.salmon, letterSpacing: 1.2 }]}>
                        Now
                      </Text>
                    </View>
                  ) : isDone ? (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[t.rowTitle, { fontSize: 13, color: color.onDarkSoft }]}>
                        {mmss(splits[i]?.seconds ?? 0)}
                      </Text>
                      <Text style={[t.meta, { color: color.muted3 }]}>
                        {mmss(splits[i]?.cumulative_seconds ?? 0)}
                      </Text>
                    </View>
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
