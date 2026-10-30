/**
 * Cold-launch splash.
 *
 * A red runner comes up the middle of three lanes, makes one hard right-angle
 * turn at the top (the pivot), and runs out along the straight. Its tail
 * follows it round, so what the run leaves behind is the app header's mark: the
 * red square at the corner and PIVOT ENGINE along the straight. The ink ground
 * then wipes up off the screen like a lane being run, and the mark shrinks into
 * the header, where it sits on every screen. The splash ends where the app
 * begins.
 *
 * It is drawn in the app's own system (ink, paper, one red, Archivo, square
 * corners, flat colour) rather than the app icon's, so the first thing an
 * athlete sees is the same product they then use.
 *
 * Every part is a plain View or Text, so it needs no native module. Layout and
 * timing live in `splashLayout.ts`, which is tested.
 *
 * ── The native hand-over ─────────────────────────────────────────────────────
 *
 * The native splash paints `NATIVE_GROUND` before any JavaScript runs, and that
 * colour is baked into the binary. So this starts on it and fades to ink in the
 * first 300 ms instead of cutting. When the native splash is next rebuilt with
 * ink, the fade becomes a no-op.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, type LayoutChangeEvent, StyleSheet, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { color, font, space } from '@/theme/tokens';
import {
  DRAWN_AT, SQUARE, T, WORD_SIZE, WORD_TRACKING, splashLayout,
} from './splashLayout';

/** `app.json`'s expo-splash-screen background, painted natively before JS. */
const NATIVE_GROUND = '#1F252C';

/**
 * The header row (see `(tabs)/_layout.tsx`): 10 px of padding under the safe
 * area, and a row as tall as the 11 px eyebrow's line.
 */
const HEADER_PAD = 10;
const HEADER_ROW = 15;

/**
 * Used until the wordmark has been measured. Close enough that the runner's
 * path is right if the font is slow, and replaced by the measured width before
 * the word is revealed.
 */
const WORD_W_ESTIMATE = 196;

/** A sprinter's acceleration up the lane; the turn carries its momentum out. */
const EASE_UP = Easing.inOut(Easing.quad);
const EASE_OUT = Easing.out(Easing.cubic);
const EASE_WIPE = Easing.bezierFn(0.7, 0, 0.3, 1);

/** 0 → 1 across [a, b] of the timeline, clamped. */
function seg(t: number, [a, b]: readonly [number, number]) {
  'worklet';
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

/**
 * `ready` is the app behind the splash, not the animation: the run always
 * finishes, but the hand-off waits for fonts and the session so it never
 * reveals a spinner.
 */
export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [wordW, setWordW] = useState<number | null>(null);
  const L = splashLayout({
    W, H, wordW: wordW ?? WORD_W_ESTIMATE,
    gutter: space.gutter, headerTop: insets.top + HEADER_PAD, headerRowH: HEADER_ROW,
  });

  /** Milliseconds along the run, driven linearly; each part eases its own segment. */
  const clock = useSharedValue(0);
  const wipe = useSharedValue(0);

  const [drawn, setDrawn] = useState(false);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const opened = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (alive) setReduced(v); })
      .catch(() => { if (alive) setReduced(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduced === null) return;
    // Reduce Motion still gets the mark, just not the run: the lock-up is
    // already drawn, and the splash dissolves rather than wiping.
    if (reduced) {
      clock.value = DRAWN_AT;
      setDrawn(true);
      return;
    }
    clock.value = withTiming(DRAWN_AT, { duration: DRAWN_AT, easing: Easing.linear });
    const t = setTimeout(() => setDrawn(true), DRAWN_AT);
    return () => clearTimeout(t);
  }, [reduced, clock]);

  useEffect(() => {
    if (!drawn || !ready || opened.current) return;
    opened.current = true;
    const finish = () => done.current();
    wipe.value = withDelay(
      reduced ? 0 : T.hold,
      // Linear: the parts read the wipe through their own easing below.
      withTiming(1, { duration: reduced ? T.reducedFade : T.handOff, easing: Easing.linear },
        (f) => {
          'worklet';
          if (f) runOnJS(finish)();
        }),
    );
  }, [drawn, ready, reduced, wipe]);

  const slide = reduced ? 0 : 1;
  const { sqX, sqY, wordX, runEnd, lineXs, linesTop, handOff } = L;
  const laneH = H - linesTop;

  const nativeGround = useAnimatedStyle(() => ({
    opacity: 1 - seg(clock.value, T.groundFade),
  }));

  // The ground leaves upward from the bottom edge: the app is revealed from the
  // foot first and the header last, by which time the mark has arrived there.
  const ground = useAnimatedStyle(() => ({
    opacity: slide === 0 ? 1 - wipe.value : 1,
    transform: [{ translateY: -EASE_WIPE(wipe.value) * H * slide }],
  }));

  const lines = useAnimatedStyle(() => ({
    opacity: 1 - seg(clock.value, T.linesOut),
    transform: [{ translateY: (1 - EASE_OUT(seg(clock.value, T.lines))) * laneH }],
  }));

  // The stem runs from the head down to the tail; both travel up the lane.
  const stem = useAnimatedStyle(() => {
    const head = H + (sqY - H) * EASE_UP(seg(clock.value, T.headUp));
    const tail = H + (sqY - H) * EASE_UP(seg(clock.value, T.tailUp));
    return { top: head, height: Math.max(0, tail - head) };
  });

  // The straight along the top: the head runs out to the end of the word, the
  // tail follows from the corner, and the word is left in its wake.
  const run = useAnimatedStyle(() => {
    const head = sqX + SQUARE + (runEnd - sqX - SQUARE) * EASE_OUT(seg(clock.value, T.headOut));
    const tail = sqX + SQUARE + (runEnd - sqX - SQUARE) * EASE_OUT(seg(clock.value, T.tailOut));
    return { left: tail, width: Math.max(0, head - tail) };
  });

  // The square appears as the head reaches the corner and stays.
  const square = useAnimatedStyle(() => ({
    opacity: clock.value >= T.headUp[1] ? 1 : 0,
  }));

  const wordReveal = useAnimatedStyle(() => {
    const tail = sqX + SQUARE + (runEnd - sqX - SQUARE) * EASE_OUT(seg(clock.value, T.tailOut));
    return { width: Math.max(0, tail - wordX) };
  });

  // The mark rides up into the header at half size, arriving just as the
  // ground's rising edge passes it. Until then it is over ink; after, it is on
  // the app's paper over the header's own identical mark, so it turns to ink
  // and gives way to it.
  const lockUp = useAnimatedStyle(() => {
    const e = EASE_WIPE(wipe.value);
    const p = slide === 0 ? 0 : Math.min(1, e / handOff.landAt);
    return {
      opacity: slide === 0
        ? 1 - wipe.value
        : interpolate(e, [handOff.landAt, 1], [1, 0], 'clamp'),
      transform: [
        { translateX: handOff.dx * p },
        { translateY: handOff.dy * p },
        { scale: 1 + (handOff.scale - 1) * p },
      ],
    };
  });
  const wordColour = useAnimatedStyle(() => ({
    color: interpolateColor(
      slide === 0 ? 0 : EASE_WIPE(wipe.value),
      [handOff.landAt - 0.02, handOff.landAt],
      [color.paper, color.ink],
    ),
  }));

  function measure(e: LayoutChangeEvent) {
    const w = Math.ceil(e.nativeEvent.layout.width);
    if (w > 0 && w !== wordW) setWordW(w);
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color.ink }, ground]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: NATIVE_GROUND }, nativeGround]} />

        <View style={{ position: 'absolute', left: 0, top: linesTop, width: W, height: laneH, overflow: 'hidden' }}>
          <Animated.View style={[StyleSheet.absoluteFill, lines]}>
            {lineXs.map(x => (
              <View key={x} style={[styles.line, { left: x, height: laneH }]} />
            ))}
          </Animated.View>
        </View>

        <Animated.View style={[styles.red, { left: sqX, width: SQUARE }, stem]} />
        <Animated.View style={[styles.red, { top: sqY, height: SQUARE }, run]} />
      </Animated.View>

      <Animated.View
        style={[{ position: 'absolute', left: sqX, top: sqY, width: L.lockW, height: SQUARE }, lockUp]}
      >
        <Animated.View style={[styles.red, { left: 0, top: 0, width: SQUARE, height: SQUARE }, square]} />
        <Animated.View
          style={[{ position: 'absolute', left: wordX - sqX, top: 0, height: SQUARE, overflow: 'hidden' }, wordReveal]}
        >
          {/* Its own width, so the narrowing clip reveals it rather than
              squeezing it onto a second line. */}
          <Animated.Text
            style={[styles.word, { position: 'absolute', left: 0, top: 0, width: (wordW ?? WORD_W_ESTIMATE) + 4 }, wordColour]}
          >
            PIVOT ENGINE
          </Animated.Text>
        </Animated.View>
      </Animated.View>

      {/* Measured off-screen at full width, so the reveal's clip never
          truncates the measurement. */}
      <Animated.Text
        onLayout={measure}
        style={[styles.word, { position: 'absolute', left: -9999, top: 0, opacity: 0 }]}
      >
        PIVOT ENGINE
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', top: 0, width: 2, backgroundColor: 'rgba(243,242,242,0.16)' },
  red: { position: 'absolute', backgroundColor: color.red },
  word: {
    fontFamily: font.extrabold,
    fontSize: WORD_SIZE,
    letterSpacing: WORD_TRACKING,
    lineHeight: SQUARE,
    includeFontPadding: false,
    color: color.paper,
  },
});
