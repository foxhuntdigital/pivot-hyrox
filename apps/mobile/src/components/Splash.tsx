/**
 * Cold-launch splash.
 *
 * A race lane is drawn from the bottom edge of the view, runs up the centre of
 * the screen, turns at the top into the bowl of a large P, and then the whole
 * frame splits down the lane's centreline and opens onto the app.
 *
 * The glyph is built from plain Views rather than an SVG path: `react-native-svg`
 * is not a dependency and adding one would mean a native rebuild, which this
 * project cannot currently do. Every stroke here is a rectangle or a bordered
 * circle, and the two "drawing" motions are done with masks instead:
 *
 *   - the stem is revealed by a paper-coloured cover sliding up (a pure
 *     transform, so no layout runs per frame), and
 *   - the bowl is revealed by a rotating clip — a ring clipped to its right
 *     half, rotated inside a second clip pinned to the right half, so the arc
 *     sweeps into view from the top round to the bottom.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { color, rule } from '../theme/tokens';

/** Draw the straightaway, then the bend, hold a beat, then open. */
const STEM_MS = 760;
const SWEEP_AT = 620;
const SWEEP_MS = 640;
const HOLD_MS = 260;
const SPLIT_MS = 620;

const EASE_DRAW = Easing.bezier(0.4, 0, 0.2, 1);
const EASE_SWEEP = Easing.out(Easing.cubic);
/** Doors take a beat before they commit, then clear the frame quickly. */
const EASE_DOOR = Easing.bezier(0.7, 0, 0.3, 1);

type Glyph = ReturnType<typeof useGlyph>;

/**
 * The P as a lane: a band of width `lane` running up `cx`, turning into a
 * half-annulus whose centreline circle is tangent to the top of the stem.
 *
 * The junction offsets matter. The stem's right edge crosses the bowl twice,
 * and left as-is would put a rule straight across the lane at each crossing —
 * so the bend erases those two spans as it passes, leaving the middle one to
 * bound the counter and the lowest to carry on as the P's shin.
 */
function useGlyph(W: number, H: number) {
  return useMemo(() => {
    const lane = Math.round(W * 0.132);
    const half = lane / 2;
    const ro = Math.round(W * 0.355);
    const ri = ro - lane;
    const rc = ro - half;
    const cx = Math.round(W / 2);
    const top = Math.round(H * 0.17);
    const cy = top + ro;

    const dashThick = Math.max(4, Math.round(lane * 0.1));
    const dashLen = Math.round(lane * 0.42);
    const period = dashLen + Math.round(lane * 0.46);

    // The stem's right edge is one unbroken rule; the bowl erases the two spans
    // it crosses. Both crossings are chords of the circles at the edge's own x,
    // hence the square roots rather than plain radii.
    const inset = half - rule.heavy;

    return {
      W,
      H,
      stroke: rule.heavy,
      lane,
      half,
      inset,
      ro,
      ri,
      rc,
      cx,
      top,
      cy,
      /** Half-height of the counter: where the inner circle meets that edge. */
      counterHalf: Math.sqrt(ri * ri - inset * inset),
      /** Where the outer circle meets it — below this the edge is the P's shin. */
      outerHalf: Math.sqrt(ro * ro - inset * inset),
      dashThick,
      dashLen,
      period,
      stemDashes: Math.ceil((H - (cy - rc)) / period) + 1,
      arcDashes: Math.max(5, Math.round((Math.PI * rc) / period)),
    };
  }, [W, H]);
}

/** Ink rectangle — every straight edge of the glyph is one of these. */
function Stroke({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <View style={{ position: 'absolute', left: x, top: y, width: w, height: h, backgroundColor: color.ink }} />;
}

/** One of the bowl's two edges, in art-local coordinates centred on (ro, ro). */
function Ring({ g, r }: { g: Glyph; r: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: g.ro - r,
        top: g.ro - r,
        width: 2 * r,
        height: 2 * r,
        borderRadius: r,
        borderWidth: g.stroke,
        borderColor: color.ink,
      }}
    />
  );
}

/**
 * The rotating reveal: content clipped to the region right of `inset`, rotated
 * inside a second clip pinned to the same region. At -180° the two regions do
 * not overlap and nothing shows; at 0° they coincide and all of it does, so the
 * arc sweeps in from the top round to the bottom.
 *
 * `inset` is how far right of the centreline the clip starts. The outer edge
 * runs to the centreline and closes the top of the P (0); the inner edge stops
 * at the stem's right rule, which is what bounds the counter.
 */
function Sweep({
  g,
  inset,
  sweep,
  children,
}: {
  g: Glyph;
  inset: number;
  sweep: SharedValue<number>;
  children: React.ReactNode;
}) {
  const rot = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(sweep.value, [0, 1], [-180, 0])}deg` }],
  }));
  const d = 2 * g.ro;
  const w = g.ro - inset;
  return (
    <View style={{ position: 'absolute', left: g.cx + inset, top: g.cy - g.ro, width: w, height: d, overflow: 'hidden' }}>
      <Animated.View style={[{ position: 'absolute', left: -(g.ro + inset), top: 0, width: d, height: d }, rot]}>
        <View style={{ position: 'absolute', left: g.ro + inset, top: 0, width: w, height: d, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: -(g.ro + inset), top: 0, width: d, height: d }}>{children}</View>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * One full-width copy of the glyph. Two are rendered — one per door — both
 * reading the same shared values, so the halves stay in step as they part.
 */
function Lane({ g, stem, sweep }: { g: Glyph; stem: SharedValue<number>; sweep: SharedValue<number> }) {
  // The cover hides everything above the drawing front; sliding it up to the
  // top of the P uncovers the stem from the bottom edge of the view.
  const cover = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(stem.value, [0, 1], [g.H, g.top]) }],
  }));
  const head = useAnimatedStyle(() => ({
    opacity: interpolate(stem.value, [0, 0.02, 0.88, 1], [0, 1, 1, 0]),
  }));
  const bend = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(sweep.value, [0, 1], [0, 180])}deg` }],
  }));
  const bendHead = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [0, 0.05, 0.9, 1], [0, 1, 1, 0]),
  }));
  // The arc crosses the stem's right edge within a few degrees of the apex and
  // again near the foot; the two erasers open exactly as it passes, so the bend
  // reads as eating the edge rather than being drawn over it.
  const eraseTop = useAnimatedStyle(() => ({
    height: interpolate(sweep.value, [0.01, 0.12], [0, g.cy - g.counterHalf - g.top], 'clamp'),
  }));
  const eraseFoot = useAnimatedStyle(() => ({
    height: interpolate(sweep.value, [0.87, 0.99], [0, g.outerHalf - g.counterHalf], 'clamp'),
  }));

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: g.W, height: g.H }}>
      {/* Both edges of the lane, full height, plus the cap it arrives at. */}
      <Stroke x={g.cx - g.half} y={g.top} w={g.stroke} h={g.H - g.top} />
      <Stroke x={g.cx + g.inset} y={g.top} w={g.stroke} h={g.H - g.top} />
      <Stroke x={g.cx - g.half} y={g.top} w={g.lane} h={g.stroke} />

      {/* Paper, not absence: these sit under the bowl and over the stem. */}
      <Animated.View
        style={[{ position: 'absolute', left: g.cx, top: g.top, width: g.half, backgroundColor: color.paper }, eraseTop]}
      />
      <Animated.View
        style={[
          { position: 'absolute', left: g.cx, top: g.cy + g.counterHalf, width: g.half, backgroundColor: color.paper },
          eraseFoot,
        ]}
      />

      {/* Centreline, drawn after the erasers so they only take ink off the edge. */}
      {Array.from({ length: g.stemDashes }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: g.cx - g.dashThick / 2,
            top: g.cy - g.rc + i * g.period,
            width: g.dashThick,
            height: g.dashLen,
            backgroundColor: color.red,
          }}
        />
      ))}

      <Animated.View
        style={[
          { position: 'absolute', left: 0, width: g.W, top: -2 * g.H, height: 2 * g.H, backgroundColor: color.paper },
          cover,
        ]}
      >
        <Animated.View
          style={[
            { position: 'absolute', bottom: 0, left: g.cx - g.half, width: g.lane, height: 3, backgroundColor: color.red },
            head,
          ]}
        />
      </Animated.View>

      <Sweep g={g} inset={0} sweep={sweep}>
        <Ring g={g} r={g.ro} />
        {Array.from({ length: g.arcDashes }, (_, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: g.ro - g.dashLen / 2,
              top: g.ro - g.dashThick / 2,
              width: g.dashLen,
              height: g.dashThick,
              backgroundColor: color.red,
              // Rotate about the circle's centre, then step out to the lane's
              // centreline: the dash lands on the arc already tangent to it.
              transform: [{ rotate: `${(180 / g.arcDashes) * (i + 0.5)}deg` }, { translateY: -g.rc }],
            }}
          />
        ))}
      </Sweep>
      <Sweep g={g} inset={g.inset} sweep={sweep}>
        <Ring g={g} r={g.ri} />
      </Sweep>

      {/* The drawing head carries on round the bend. */}
      <Animated.View
        style={[{ position: 'absolute', left: g.cx - g.ro, top: g.cy - g.ro, width: 2 * g.ro, height: 2 * g.ro }, bend]}
      >
        <Animated.View
          style={[{ position: 'absolute', left: g.ro - 1.5, top: 0, width: 3, height: g.lane, backgroundColor: color.red }, bendHead]}
        />
      </Animated.View>
    </View>
  );
}

/**
 * `ready` is the app behind the splash, not the animation: the lane always
 * finishes drawing, but the doors wait for fonts and the session so they never
 * open onto a spinner.
 */
export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const g = useGlyph(W, H);

  const stem = useSharedValue(0);
  const sweep = useSharedValue(0);
  const split = useSharedValue(0);

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
    // Reduce Motion still gets the mark, just not the run-up: the P is already
    // drawn and the splash dissolves instead of sliding apart.
    if (reduced) {
      stem.value = 1;
      sweep.value = 1;
      setDrawn(true);
      return;
    }
    stem.value = withTiming(1, { duration: STEM_MS, easing: EASE_DRAW });
    sweep.value = withDelay(SWEEP_AT, withTiming(1, { duration: SWEEP_MS, easing: EASE_SWEEP }));
    const t = setTimeout(() => setDrawn(true), SWEEP_AT + SWEEP_MS);
    return () => clearTimeout(t);
  }, [reduced, stem, sweep]);

  useEffect(() => {
    if (!drawn || !ready || opened.current) return;
    opened.current = true;
    const finish = () => done.current();
    split.value = withDelay(
      reduced ? 0 : HOLD_MS,
      withTiming(1, { duration: reduced ? 240 : SPLIT_MS, easing: reduced ? Easing.linear : EASE_DOOR }, (f) => {
        'worklet';
        if (f) runOnJS(finish)();
      }),
    );
  }, [drawn, ready, reduced, split]);

  const slide = reduced ? 0 : 1;
  const root = useAnimatedStyle(() => ({ opacity: slide === 0 ? 1 - split.value : 1 }));
  const left = useAnimatedStyle(() => ({ transform: [{ translateX: -split.value * g.cx * slide }] }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: split.value * (g.W - g.cx) * slide }] }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, root]}>
      <Animated.View style={[styles.door, { left: 0, width: g.cx, height: g.H }, left]}>
        <Lane g={g} stem={stem} sweep={sweep} />
      </Animated.View>
      <Animated.View style={[styles.door, { left: g.cx, width: g.W - g.cx, height: g.H }, right]}>
        {/* Shifted back by half a screen so the two copies register as one glyph. */}
        <View style={{ position: 'absolute', left: -g.cx, top: 0, width: g.W, height: g.H }}>
          <Lane g={g} stem={stem} sweep={sweep} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  door: { position: 'absolute', top: 0, overflow: 'hidden', backgroundColor: color.paper },
});
