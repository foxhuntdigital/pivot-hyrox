/**
 * The four scenes of the pre-onboarding explainer.
 *
 * Each one animates on entry and answers a single question, in order: what this
 * app is for, what the three variants are, what Coach is, and what the app
 * measures instead of a calendar. The variant scene is the reason the sequence
 * exists — three sizes of the same session is the app's central idea and the
 * one thing an athlete cannot infer from the UI on their own.
 *
 * Drawn in the same vocabulary as the rest of the app: flat blocks, hairline
 * rules, one red accent. `react-native-svg` is not a dependency, so every
 * figure here is a plain View, the way `Splash` is.
 */
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';

import { color, type as t, space } from '@/theme/tokens';
import { Label } from '@/components/primitives';

const EASE = Easing.out(Easing.cubic);

/** Scenes are remounted on change, so entry animations run from zero. */
function useEntry(reduced: boolean, delay = 0, duration = 520) {
  const v = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { v.value = 1; return; }
    v.value = withDelay(delay, withTiming(1, { duration, easing: EASE }));
  }, [reduced, delay, duration, v]);
  return v;
}

/** Rises and fades in. The house's one entry gesture, used everywhere here. */
function Rise({
  reduced, delay = 0, children, style,
}: {
  reduced: boolean;
  delay?: number;
  children: React.ReactNode;
  style?: object;
}) {
  const v = useEntry(reduced, delay);
  const anim = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 14 }],
  }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/* ---------------------------------------------------------------- scene 1 --- */

/**
 * Race day is fixed; the days leading to it are not.
 *
 * The figure is a run of day columns of uneven height under a fixed red marker.
 * Uneven is the whole point — a plan that assumes seven identical days is the
 * thing this app exists to replace — so the heights are authored rather than
 * random, and they stay put between renders.
 */
const DAY_HEIGHTS = [0.9, 0.35, 0.7, 1, 0.2, 0.55, 0.85, 0.3, 0.95, 0.6, 0.45, 1];

export function SceneFixedDate({ reduced }: { reduced: boolean }) {
  return (
    <View>
      <Rise reduced={reduced}>
        <Label tone="redDark" size="sm">Event-based training</Label>
        <Text style={[t.h2, { color: color.ink, marginTop: 8 }]}>
          Race day doesn't move.{'\n'}Your days do.
        </Text>
      </Rise>

      <Rise reduced={reduced} delay={160} style={{ marginTop: 26 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 92 }}>
          {DAY_HEIGHTS.map((h, i) => (
            <Column key={i} reduced={reduced} height={h} index={i} />
          ))}
          <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: color.red }} />
        </View>
        <View style={{ height: 2, backgroundColor: color.ink, marginTop: 6 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}>
          <Label size="sm">Today</Label>
          <Label tone="redDark" size="sm">Race day</Label>
        </View>
      </Rise>

      <Rise reduced={reduced} delay={320} style={{ marginTop: 24 }}>
        <Text style={[t.body, { color: color.muted2 }]}>
          Some days you have an hour. Some days you have twenty minutes, five
          hours' sleep and nothing left. Pivot plans against the date you are
          training for, then works with the day you actually got.
        </Text>
      </Rise>
    </View>
  );
}

/** One day's capacity, growing to its own height in echelon. */
function Column({
  reduced, height, index,
}: { reduced: boolean; height: number; index: number }) {
  const v = useEntry(reduced, 220 + index * 45, 420);
  const anim = useAnimatedStyle(() => ({ height: `${v.value * height * 100}%` }));
  return (
    <View style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
      <Animated.View style={[{ backgroundColor: height > 0.6 ? color.ink : color.rule }, anim]} />
    </View>
  );
}

/* ---------------------------------------------------------------- scene 2 --- */

/**
 * The three variants — the scene the whole sequence is for.
 *
 * Three bars of the same session, stacked and staggered so they can be compared
 * at a glance rather than remembered across a loop. The red segment is the same
 * width and position in all three: that is the claim being made, and drawing it
 * any other way would undercut the sentence underneath.
 */
const VARIANTS = [
  { label: 'Full', minutes: 60, width: 1, note: 'The session as written' },
  { label: 'Express', minutes: 39, width: 0.63, note: 'Trimmed to the time you have' },
  { label: 'Micro', minutes: 18, width: 0.3, note: 'When the day got away from you' },
];

/** The protected work, as a fraction of the full bar. */
const CORE = 0.26;

export function SceneVariants({ reduced }: { reduced: boolean }) {
  return (
    <View>
      <Rise reduced={reduced}>
        <Label tone="redDark" size="sm">One session, three sizes</Label>
        <Text style={[t.h2, { color: color.ink, marginTop: 8 }]}>
          Full. Express. Micro.
        </Text>
      </Rise>

      <View style={{ marginTop: 22 }}>
        {VARIANTS.map((v, i) => (
          <VariantBar key={v.label} reduced={reduced} variant={v} index={i} />
        ))}
      </View>

      <Rise reduced={reduced} delay={720} style={{ marginTop: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 14, height: 8, backgroundColor: color.red }} />
          <Text style={[t.bodySm, { color: color.muted2, flex: 1 }]}>
            The red is the stimulus — the work the session exists to deliver. It is
            the same in all three. What gets cut is volume, never the point.
          </Text>
        </View>
      </Rise>
    </View>
  );
}

function VariantBar({
  reduced, variant, index,
}: {
  reduced: boolean;
  variant: typeof VARIANTS[number];
  index: number;
}) {
  const v = useEntry(reduced, 180 + index * 190, 560);
  const bar = useAnimatedStyle(() => ({ width: `${v.value * variant.width * 100}%` }));
  const label = useAnimatedStyle(() => ({ opacity: v.value }));

  return (
    <View style={{ paddingBottom: 16 }}>
      <Animated.View style={[{
        flexDirection: 'row', alignItems: 'baseline',
        justifyContent: 'space-between', paddingBottom: 6,
      }, label]}>
        <Label tone="ink" size="sm">{variant.label}</Label>
        <Text style={[t.meta, { color: color.muted }]}>
          {variant.minutes} min · {variant.note}
        </Text>
      </Animated.View>

      {/* The track is the full session's length; the bar is this variant's. */}
      <View style={{ height: 26, backgroundColor: color.ruleFaint }}>
        <Animated.View style={[{ height: 26, backgroundColor: color.ink }, bar]}>
          {/* The protected work, sized against the full bar rather than this
              one, so it stays the same absolute width as the bar shortens. */}
          <View style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${(CORE / variant.width) * 100}%`,
            backgroundColor: color.red,
          }} />
        </Animated.View>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- scene 3 --- */

/** Coach, shown as the exchange it actually is. */
export function SceneCoach({ reduced }: { reduced: boolean }) {
  return (
    <View>
      <Rise reduced={reduced}>
        <Label tone="redDark" size="sm">Ask, don't guess</Label>
        <Text style={[t.h2, { color: color.ink, marginTop: 8 }]}>
          A coach that knows your plan.
        </Text>
      </Rise>

      <Rise reduced={reduced} delay={200} style={{ marginTop: 24, alignItems: 'flex-end' }}>
        <View style={{ backgroundColor: color.ink, paddingVertical: 11, paddingHorizontal: 14, maxWidth: '86%' }}>
          <Text style={[t.body, { color: color.onDark }]}>
            Slept badly and my knee is grumbling. Should I still run today?
          </Text>
        </View>
      </Rise>

      <Rise reduced={reduced} delay={620} style={{ marginTop: 14 }}>
        <Label size="sm" style={{ marginBottom: 5 }}>Coach</Label>
        <Text style={[t.body, { color: color.muted2 }]}>
          Not that one. I've swapped today's run for the Express row and left
          your threshold session on Thursday — the week keeps its stimuli either way.
        </Text>
      </Rise>

      <Rise reduced={reduced} delay={900} style={{ marginTop: 22 }}>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          Help, advice, or a straight judgement call on what to do today. It reads
          your plan, your recovery and your equipment before it answers.
        </Text>
      </Rise>
    </View>
  );
}

/* ---------------------------------------------------------------- scene 4 --- */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STIMULI = ['Aerobic', 'Threshold', 'Strength', 'Stations'];

/** The closing principle: what the week is counted in. */
export function SceneStimulus({ reduced }: { reduced: boolean }) {
  return (
    <View>
      <Rise reduced={reduced}>
        <Label tone="redDark" size="sm">How the week is measured</Label>
        <Text style={[t.h2, { color: color.ink, marginTop: 8 }]}>
          Stimulus, not schedule.
        </Text>
      </Rise>

      {/* The old way, greying out. */}
      <Rise reduced={reduced} delay={180} style={{ marginTop: 26 }}>
        <Label size="sm" style={{ marginBottom: 8 }}>Not this</Label>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {WEEKDAYS.map(d => (
            <View key={d} style={{
              flex: 1, paddingVertical: 9, alignItems: 'center',
              borderWidth: 1, borderColor: color.ruleFaint,
            }}>
              <Text style={[t.meta, { fontSize: 9.5, color: color.muted3 }]}>{d}</Text>
            </View>
          ))}
        </View>
      </Rise>

      <Rise reduced={reduced} delay={420} style={{ marginTop: 20 }}>
        <Label tone="ink" size="sm" style={{ marginBottom: 8 }}>This</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {STIMULI.map((s, i) => (
            <Rise key={s} reduced={reduced} delay={520 + i * 110}>
              <View style={{
                paddingVertical: 9, paddingHorizontal: 12,
                borderWidth: 1, borderColor: color.ink,
              }}>
                <Text style={[t.rowTitle, { fontSize: 12.5, color: color.ink }]}>{s}</Text>
              </View>
            </Rise>
          ))}
        </View>
      </Rise>

      <Rise reduced={reduced} delay={980} style={{ marginTop: 24 }}>
        <Text style={[t.body, { color: color.muted2 }]}>
          A session landing a day late doesn't put you behind, and nothing is ever
          marked missed. The week asks for stimuli; you decide which day each one
          lands on.
        </Text>
      </Rise>
    </View>
  );
}

export const INTRO_SCENES = [
  { id: 'date', Scene: SceneFixedDate },
  { id: 'variants', Scene: SceneVariants },
  { id: 'coach', Scene: SceneCoach },
  { id: 'stimulus', Scene: SceneStimulus },
] as const;

export const INTRO_GUTTER = space.gutter;
