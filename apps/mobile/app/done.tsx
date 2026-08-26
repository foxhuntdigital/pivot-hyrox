/**
 * D15 Completion.
 *
 * The tone here is deliberate: a shortened session is a completed session
 * (PRD §8.1 — Express and Micro are never communicated as failure states), so
 * the summary reports what was done without framing it as a shortfall.
 */
import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VARIANT_LABEL } from '@pivot/engine';
import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton, InkPanel, Chip } from '@/components/primitives';
import { useApp } from '@/state/store';
import { mmss } from '@/state/steps';
import { LOW_SLEEP_HOURS } from '@/lib/format';

const RPE_CHOICES = [5, 6, 7, 8, 9];

export default function DoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, session, steps, plan, sleep, finishSession } = useApp();

  if (session.kind !== 'session') {
    router.replace('/today');
    return null;
  }

  const sectionsDone = state.ended_early ? state.step_index + 1 : steps.length;
  // `plan.week` already counts the session just finished — the store adds it
  // the moment the workout completes rather than waiting for a refetch.
  const { done: weekDone, target: weekTarget } = plan.week;

  /**
   * The coach note reflects what actually happened. It reads from logged
   * outcomes only — it never claims a physiological result the app did not
   * measure.
   */
  const hardSession = (state.session_rpe ?? 0) >= 8;
  const shortSleep = sleep.hours !== null && sleep.hours < LOW_SLEEP_HOURS;

  const coachNote = state.ended_early
    ? 'Cut short and logged. You got the first sections in, which is enough to hold '
      + "the stimulus — the remainder rolls into the week's queue rather than being "
      + 'marked missed.'
    : hardSession
      // Short sleep is named only when it was actually reported, and the note
      // no longer promises a change to tomorrow that nothing schedules. What it
      // says is what the engine will do: read this session as an input.
      ? `Logged at RPE ${state.session_rpe}, harder than this session intended`
        + `${shortSleep ? ' on the sleep you reported' : ''}. `
        + "Tomorrow's recommendation reads that back as recovery load."
      : `${session.template.name} completed as ${VARIANT_LABEL[session.variant.variant_code]}. `
        + 'The week stays intact and your next exposure builds from here.';

  const finish = () => {
    // RPE is captured on this screen, so the finish is written here rather
    // than when the last block ended — the record carries what the athlete
    // actually reported.
    finishSession();
    router.replace('/today');
  };

  return (
    <ScrollView
      style={{ backgroundColor: color.paper }}
      contentContainerStyle={{ paddingTop: insets.top + 22, paddingBottom: 40 }}
    >
      <View style={{ paddingHorizontal: space.gutter }}>
        <View style={{
          width: 44, height: 44, backgroundColor: color.red,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 22, color: color.onDark, fontFamily: t.h1.fontFamily }}>✓</Text>
        </View>
        <Text style={[t.h1, { marginTop: 16, color: color.ink }]}>Strong session.</Text>
        <Text style={[t.body, { color: color.muted2, marginTop: 6 }]}>
          {session.template.name} · {VARIANT_LABEL[session.variant.variant_code]}
        </Text>
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
        <Rule heavy />
      </View>

      {/* Duration and sections are measured. HR and training load would need a
          connected source and a validated model, so they are not shown. */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.rule }}>
        {[
          { k: 'Duration', v: mmss(state.elapsed_seconds) },
          { k: 'Sections', v: `${sectionsDone}/${steps.length}` },
          { k: 'Variant', v: VARIANT_LABEL[session.variant.variant_code] },
        ].map((s, i) => (
          <View key={s.k} style={{
            flex: 1, paddingVertical: 14, paddingHorizontal: 14,
            borderRightWidth: i === 2 ? 0 : 1, borderRightColor: color.rule,
          }}>
            <Label size="sm">{s.k}</Label>
            {/* One line, always. "EXPRESS" is seven characters in a cell sized
                for "1:15" and broke across two lines as "EXPRE / SS". Shrinking
                to fit keeps the three cells on a common baseline and leaves the
                two short numerals at their full weight, which a fixed smaller
                size for the whole row would not. */}
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={[t.statValue, { marginTop: 3, color: color.ink }]}
            >
              {s.v}
            </Text>
          </View>
        ))}
      </View>

      <Label style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
        How hard was that?
      </Label>
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
        {RPE_CHOICES.map(v => (
          <Chip
            key={v} flex size="lg" label={String(v)}
            active={state.session_rpe === v}
            onPress={() => dispatch({ type: 'set_rpe', rpe: v })}
          />
        ))}
      </View>
      <Text style={[t.meta, { paddingHorizontal: space.gutter, paddingTop: 8, color: color.muted }]}>
        RPE · shapes tomorrow's load
      </Text>

      <InkPanel
        label="Coach"
        style={{ margin: 18, marginHorizontal: space.gutter, marginBottom: 0 }}
      >
        <Text style={[t.body, { color: color.onDarkSoft }]}>{coachNote}</Text>
      </InkPanel>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
        <Rule />
      </View>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 6 }}>
        {[
          { k: 'Stimulus logged', v: session.primary_stimulus.replace(/_/g, ' ') },
          { k: 'Week', v: `${weekDone} of ${weekTarget} stimuli` },
          // The race row states the countdown. It used to assert "On track"
          // alongside it, which nothing measured.
          ...(plan.race ? [{
            k: plan.race.name,
            v: plan.race.days_remaining === null
              ? 'No date set' : `${plan.race.days_remaining} days`,
          }] : []),
        ].map(row => (
          <View key={row.k} style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
            paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
          }}>
            <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>{row.k}</Text>
            <Text style={[t.bodySm, { color: color.muted2 }]}>{row.v}</Text>
          </View>
        ))}
      </View>

      <ActionButton
        label="Done" onPress={finish}
        style={{ margin: 20, marginHorizontal: space.gutter, marginTop: 20 }}
      />
    </ScrollView>
  );
}
