/**
 * Cold-launch splash.
 *
 * Three lanes run straight up the page from the bottom edge, turn right at the
 * crown and wrap round into the bowl of a large P. The frame then splits down
 * the middle lane and opens onto the app — so the seam follows the mark rather
 * than the page, and the two doors are not the same width.
 *
 * ── The palette is the app icon's ────────────────────────────────────────────
 *
 * The icon is a monogram cut from three materials on a cool charcoal: a glossy
 * vermilion, a frosted face carrying fine engraved line work, and a granular
 * teal, with a cyan light-leak running the seam between them. Three materials
 * and three lanes was too close to ignore, so each lane is one of them and the
 * drawing head is the light-leak.
 *
 * The ground is `app.json`'s own `adaptiveIcon.backgroundColor`, not a sampled
 * approximation, so three things that must agree do: the icon on the home
 * screen, the native splash painted before any JavaScript runs, and this. The
 * launch reads as one surface from the tap onward, and the doors then part on a
 * dark frame to show a light app — which is a reveal rather than the seamless
 * paper-on-paper it used to be.
 *
 * `react-native-svg` is not a dependency and adding one would mean a native
 * rebuild, which this project cannot currently do, so every part of the mark is
 * a plain View:
 *
 *   - each lane's fill is a stack of flat strips sampled from a two-stop ramp at
 *     the strip's own y, and its material's grain is a modulation of those same
 *     strips — so the texture costs no views at all. The ramp is a function of absolute y, not of distance
 *     along the stroke, so the stem, the corner and the bend share one
 *     continuous fill and meet without a seam;
 *   - the bend is a fan of rotated rectangles, cut wide enough that no gap opens
 *     between them and then trimmed back to true circles by a paper ring outside
 *     it and a paper disc inside it;
 *   - the corner is a mitre, and a mitre is only nested squares: lane i owns
 *     everything at least i lanes in from both outer edges, so painting the
 *     three outermost-first cuts both diagonals without a rotated view;
 *   - the run up is a paper cover sliding off (a pure transform, so no layout
 *     runs per frame) and the bend is a rotating clip — the fan clipped to its
 *     right half, rotated inside a second clip pinned to the same half, so the
 *     arc sweeps in from the crown round to the foot.
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

/** Run the straight, wrap the bend, hold a beat, then open. */
const STEM_MS = 680;
/** The lanes leave in echelon, outside first — the outer one has furthest to go. */
const LANE_LAG = 40;
const RUN_MS = STEM_MS + 2 * LANE_LAG;
const SWEEP_AT = RUN_MS;
const SWEEP_MS = 640;
const HOLD_MS = 240;
const SPLIT_MS = 600;

/** The straight is taken at a constant speed; the bend carries its own momentum. */
const EASE_SWEEP = Easing.out(Easing.cubic);
/** Doors take a beat before they commit, then clear the frame quickly. */
const EASE_DOOR = Easing.bezier(0.7, 0, 0.3, 1);

/**
 * The flat charcoal, for the covers and trims that must match the ground.
 *
 * Taken from `app.json`'s `adaptiveIcon.backgroundColor` rather than sampled by
 * eye, so the splash and the Android icon cannot drift apart — and so the
 * native splash, which paints this same value before any JavaScript runs, hands
 * over to a screen of exactly its own colour.
 */
const GROUND = '#1F252C';

/**
 * Sampled from the app icon, so the first thing the athlete sees is the thing
 * they tapped.
 *
 * The icon is a monogram cut from three materials on a cool charcoal: a glossy
 * vermilion, a frosted pale face carrying fine engraved line work, and a
 * granular teal — with a cyan light-leak running the seam between them. Three
 * materials for three lanes is not a coincidence worth ignoring, so the lanes
 * stop being three tones of one red and become the icon's own three.
 *
 * The charcoal is deliberately not neutral. It carries a blue bias, which is
 * what stops the teal reading as grubby against it and what makes the vermilion
 * look lit rather than printed.
 */
const ICON = {
  groundTop: '#252b33',
  groundFoot: '#171c22',
  /** The light-leak along the icon's seam. The brightest thing in the mark. */
  glow: '#4ff7ea',
} as const;

/**
 * A lane per material, outside first — the order they sit in the icon, read
 * left to right. Every lane runs from `head` at the crown to `tail` at the
 * bottom of the screen, so the mark still reads as light gathering at the front
 * of the run; what changed is that the three are now different materials rather
 * than three temperatures of one.
 *
 * `grain` is how the material behaves under the ramp, and costs nothing: the
 * fill is already a stack of flat strips, so the texture is a modulation of
 * strips that are being painted anyway rather than anything drawn on top.
 */
const LANES = [
  /** Glossy, like the icon's vermilion face. Smooth — gloss has no grain. */
  { head: '#e04a24', tail: '#7c2410', grain: 'gloss' },
  /** The frosted face, and its engraved hairlines. */
  { head: '#e4eef0', tail: '#7f969b', grain: 'etched' },
  /** The speckled teal. The noisiest material in the icon. */
  { head: '#46b5a8', tail: '#164e49', grain: 'granular' },
] as const;

/** Strips in a lane's gradient over the full drop, and segments per half-bend. */
const RAMP_STEPS = 30;
const ARC_SEGS = 24;

/** Where each lane's cover starts and finishes, as a fraction of `RUN_MS`. */
const LANE_IN = LANES.map((_, i) => (i * LANE_LAG) / RUN_MS);
const LANE_OUT = LANES.map((_, i) => (i * LANE_LAG + STEM_MS) / RUN_MS);

function mix(a: string, b: string, t: number, lift = 1) {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (ca >> shift) & 255;
    const v = va + (((cb >> shift) & 255) - va) * t;
    return Math.max(0, Math.min(255, Math.round(v * lift)));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/**
 * A stable pseudo-random number for one strip of one lane.
 *
 * Deterministic on purpose: the grain must not crawl between renders, and a
 * splash that reshuffles its own texture on a re-layout would draw the eye to
 * exactly the thing that should sit still. Same input, same speckle, every time.
 */
function noise(lane: number, k: number) {
  const h = Math.sin(lane * 12.9898 + k * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * How a material catches the light, as a multiplier on the strip's own colour.
 *
 * Gloss is flat — a polished face has no texture to find. Etched lifts one
 * strip in seven, which is the icon's engraved line work at the scale a lane
 * can carry it. Granular jitters every strip a few percent, which reads as the
 * icon's speckle without a single extra view.
 */
function materialLift(grain: string, lane: number, k: number) {
  if (grain === 'etched') return k % 7 === 3 ? 1.16 : 1;
  if (grain === 'granular') return 0.93 + noise(lane, k) * 0.14;
  return 1;
}

type Glyph = ReturnType<typeof useGlyph>;

/**
 * The P as three lanes: a stem `L` wide, and a half-annulus of the same width
 * whose centre sits on the stem's right edge. Putting the centre there is what
 * keeps the letter honest — the counter is bounded on the left by the stem
 * itself, and the corner square at the crown falls exactly against the bend, so
 * the mitre and the arc bands line up lane for lane with nothing to erase.
 */
function useGlyph(W: number, H: number) {
  return useMemo(() => {
    // Even, so the middle lane's centreline — where the frame splits — lands on
    // a whole pixel.
    const laneW = Math.max(6, 2 * Math.round((W * 0.056) / 2));
    const L = 3 * laneW;
    const ro = Math.round(W * 0.316);
    const ri = ro - L;
    const span = L + ro;

    // Optically centred, not box-centred. The bowl carries a counter and the
    // stem does not, so the head's weight sits left of the middle of its box —
    // centre the box and the mark reads as leaning left of the page. `bias` is
    // the gap between the two, measured off the head alone: the descender runs
    // to the bottom edge and would otherwise drag the whole balance onto the
    // stem. Nudging right by it puts the weight, rather than the box, on centre.
    const headA = L * 2 * ro;
    const bowlA = (Math.PI / 2) * (ro * ro - ri * ri);
    const bowlX = L + ((4 / (3 * Math.PI)) * (ro ** 3 - ri ** 3)) / (ro * ro - ri * ri);
    const bias = span / 2 - (headA * (L / 2) + bowlA * bowlX) / (headA + bowlA);

    const sx = Math.round((W - span) / 2 + bias);
    const bx = sx + L;
    // The frame splits down the middle lane's spine, wherever that lands.
    const cx = sx + L / 2;
    const top = Math.round(H * 0.17);
    const by = top + ro;
    const drop = H - top;

    // `k` is the strip's index within its stack, which is what a material's
    // grain is a function of. Absent — as it is on the bend — the material
    // reads smooth, which is right: the grain belongs to the long run, and
    // speckling the arc as well would turn texture into noise.
    const tone = (lane: number, y: number, k = -1) =>
      mix(
        LANES[lane].head,
        LANES[lane].tail,
        Math.min(1, Math.max(0, (y - top) / drop)),
        k < 0 ? 1 : materialLift(LANES[lane].grain, lane, k),
      );

    return { W, H, laneW, L, cx, sx, bx, ro, ri, top, by, drop, tone };
  }, [W, H]);
}

/**
 * `lane`'s gradient painted into a rect. The ramp is sampled against absolute y
 * rather than distance along the stroke, so any two rects that abut anywhere in
 * the mark meet without a seam.
 */
/**
 * The charcoal the mark sits on, with the icon's own falloff.
 *
 * Painted inside `Mark` rather than on the doors: both doors draw a full-width
 * copy of the mark and shift it, so a ground painted here registers across the
 * seam and the two halves cannot disagree about where the light is.
 */
function Ground({ g }: { g: Glyph }) {
  const steps = 12;
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: g.W, height: g.H }}>
      {Array.from({ length: steps }, (_, k) => (
        <View
          key={k}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: (k * g.H) / steps,
            height: g.H / steps + 1,
            backgroundColor: mix(ICON.groundTop, ICON.groundFoot, (k + 0.5) / steps),
          }}
        />
      ))}
    </View>
  );
}

function Ramp({ g, lane, x, y, w, h }: { g: Glyph; lane: number; x: number; y: number; w: number; h: number }) {
  const steps = Math.max(1, Math.round((h / g.drop) * RAMP_STEPS));
  const band = h / steps;
  return (
    <View style={{ position: 'absolute', left: x, top: y, width: w, height: h, overflow: 'hidden' }}>
      {Array.from({ length: steps }, (_, k) => (
        <View
          key={k}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: k * band,
            // A hair of overlap: adjacent strips must not leave a sub-pixel seam.
            height: band + 1,
            backgroundColor: g.tone(lane, y + (k + 0.5) * band, k),
          }}
        />
      ))}
    </View>
  );
}

/**
 * The paper that hides a lane until it has been run. It covers everything above
 * its own bottom edge, so sliding that edge from the bottom of the view up to
 * the crown lays the lane down behind it — including the lane's share of the
 * mitre, which is why the covers are painted last.
 */
function Cover({ g, lane, stem }: { g: Glyph; lane: number; stem: SharedValue<number> }) {
  const a = LANE_IN[lane];
  const b = LANE_OUT[lane];
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(stem.value, [a, b], [g.H, g.top], 'clamp') }],
  }));
  const head = useAnimatedStyle(() => ({
    opacity: interpolate(stem.value, [a, a + (b - a) * 0.04, a + (b - a) * 0.92, b], [0, 1, 1, 0], 'clamp'),
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: g.sx + lane * g.laneW,
          width: g.laneW,
          top: -2 * g.H,
          height: 2 * g.H,
          backgroundColor: GROUND,
        },
        slide,
      ]}
    >
      <Animated.View
        style={[
          { position: 'absolute', bottom: 0, left: 0, width: g.laneW, height: 2, backgroundColor: ICON.glow },
          head,
        ]}
      />
    </Animated.View>
  );
}

/**
 * The turn at the crown. Coming up the stem the outside of a right-hander is the
 * left edge; going out along the bend it is the top edge. Lane i therefore owns
 * every point at least i lanes in from *both*, which is exactly the square
 * anchored at the corner's inner corner — so three nested squares painted
 * outermost-first cut the mitre's diagonals for free, with no rotated view and
 * nothing to erase.
 *
 * It is static, and sits under the covers rather than over them: each lane then
 * uncovers its own stepped share of the corner as it arrives, so the fan opens
 * in echelon with the run instead of needing a reveal of its own.
 */
function Mitre({ g }: { g: Glyph }) {
  return (
    <>
      {LANES.map((_, lane) => {
        const d = g.L - lane * g.laneW;
        return (
          <Ramp
            key={lane}
            g={g}
            lane={lane}
            x={g.sx + lane * g.laneW}
            y={g.top + lane * g.laneW}
            w={d}
            h={d}
          />
        );
      })}
    </>
  );
}

/**
 * The bend, in art-local coordinates centred on (ro, ro). Each lane is a fan of
 * rectangles set tangent to its own centreline and cut to the chord that
 * circumscribes its outer radius, so the fan never gaps; the paper ring and disc
 * then trim both edges back to true circles.
 */
function Bend({ g }: { g: Glyph }) {
  const trim = Math.max(8, g.laneW);
  return (
    <>
      {LANES.map((_, lane) => {
        const rOut = g.ro - lane * g.laneW;
        const rc = rOut - g.laneW / 2;
        const chord = 2 * rOut * Math.tan(Math.PI / (2 * ARC_SEGS)) + 1;
        return Array.from({ length: ARC_SEGS }, (_, k) => {
          // 0 at the crown, π at the foot, so the ramp reads off the segment's
          // own y and picks up exactly where the stem left it.
          const th = (Math.PI * (k + 0.5)) / ARC_SEGS;
          return (
            <View
              key={`${lane}-${k}`}
              style={{
                position: 'absolute',
                left: g.ro - chord / 2,
                top: g.ro - g.laneW / 2 - 0.5,
                width: chord,
                height: g.laneW + 1,
                backgroundColor: g.tone(lane, g.by - rc * Math.cos(th)),
                // Rotate about the circle's centre, then step out to the lane's
                // centreline: the segment lands on the arc already tangent to it.
                transform: [{ rotate: `${(th * 180) / Math.PI}deg` }, { translateY: -rc }],
              }}
            />
          );
        });
      })}
      <View
        style={{
          position: 'absolute',
          left: -trim,
          top: -trim,
          width: 2 * (g.ro + trim),
          height: 2 * (g.ro + trim),
          borderRadius: g.ro + trim,
          borderWidth: trim,
          borderColor: GROUND,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: g.ro - g.ri,
          top: g.ro - g.ri,
          width: 2 * g.ri,
          height: 2 * g.ri,
          borderRadius: g.ri,
          backgroundColor: GROUND,
        }}
      />
    </>
  );
}

/**
 * The rotating reveal: the fan clipped to the half right of the bend's centre,
 * rotated inside a second clip pinned to the same half. At -180° the two regions
 * do not overlap and nothing shows; at 0° they coincide and all of it does, so
 * the arc sweeps in from the crown round to the foot.
 */
function Sweep({ g, sweep, children }: { g: Glyph; sweep: SharedValue<number>; children: React.ReactNode }) {
  const rot = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(sweep.value, [0, 1], [-180, 0])}deg` }],
  }));
  const d = 2 * g.ro;
  return (
    <View style={{ position: 'absolute', left: g.bx, top: g.by - g.ro, width: g.ro, height: d, overflow: 'hidden' }}>
      <Animated.View style={[{ position: 'absolute', left: -g.ro, top: 0, width: d, height: d }, rot]}>
        <View style={{ position: 'absolute', left: g.ro, top: 0, width: g.ro, height: d, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: -g.ro, top: 0, width: d, height: d }}>{children}</View>
        </View>
      </Animated.View>
    </View>
  );
}

/** The drawing head carries on round the bend, across all three lanes. */
function BendHead({ g, sweep }: { g: Glyph; sweep: SharedValue<number> }) {
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(sweep.value, [0, 1], [0, 180])}deg` }],
  }));
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [0, 0.06, 0.9, 1], [0, 1, 1, 0]),
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', left: g.bx - g.ro, top: g.by - g.ro, width: 2 * g.ro, height: 2 * g.ro }, spin]}
    >
      <Animated.View
        style={[
          { position: 'absolute', left: g.ro - 1, top: 0, width: 2, height: g.L, backgroundColor: ICON.glow },
          fade,
        ]}
      />
    </Animated.View>
  );
}

/**
 * One full-width copy of the mark. Two are rendered — one per door — both
 * reading the same shared values, so the halves stay in step as they part. The
 * bend lies wholly right of the split, so the left door does not draw it.
 */
function Mark({
  g,
  stem,
  sweep,
  bend,
}: {
  g: Glyph;
  stem: SharedValue<number>;
  sweep: SharedValue<number>;
  bend: boolean;
}) {
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: g.W, height: g.H }}>
      <Ground g={g} />
      {LANES.map((_, lane) => (
        <Ramp key={lane} g={g} lane={lane} x={g.sx + lane * g.laneW} y={g.top} w={g.laneW} h={g.drop} />
      ))}
      <Mitre g={g} />
      {LANES.map((_, lane) => (
        <Cover key={lane} g={g} lane={lane} stem={stem} />
      ))}
      {bend && (
        <>
          <Sweep g={g} sweep={sweep}>
            <Bend g={g} />
          </Sweep>
          <BendHead g={g} sweep={sweep} />
        </>
      )}
    </View>
  );
}

/**
 * `ready` is the app behind the splash, not the animation: the lanes always
 * finish drawing, but the doors wait for fonts and the session so they never
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
    // Reduce Motion still gets the mark, just not the run: the P is already
    // drawn and the splash dissolves instead of sliding apart.
    if (reduced) {
      stem.value = 1;
      sweep.value = 1;
      setDrawn(true);
      return;
    }
    stem.value = withTiming(1, { duration: RUN_MS, easing: Easing.linear });
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
        <Mark g={g} stem={stem} sweep={sweep} bend={false} />
      </Animated.View>
      <Animated.View style={[styles.door, { left: g.cx, width: g.W - g.cx, height: g.H }, right]}>
        {/* Shifted back by the seam so the two copies register as one mark. */}
        <View style={{ position: 'absolute', left: -g.cx, top: 0, width: g.W, height: g.H }}>
          <Mark g={g} stem={stem} sweep={sweep} bend />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  door: { position: 'absolute', top: 0, overflow: 'hidden', backgroundColor: GROUND },
});
