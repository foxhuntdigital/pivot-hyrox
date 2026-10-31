/**
 * Line charts for Progress, drawn with Views.
 *
 * The app has no SVG library, and three small charts are not worth a native
 * dependency: a line is a run of rotated bars, a dashed line is the same bar
 * with gaps, and a dot is a square with a radius. Each chart sizes itself to
 * its container on layout, so the geometry is in real points.
 */
import React, { useState } from 'react';
import { View, Text, type ViewStyle } from 'react-native';

import { color, type as t } from '@/theme/tokens';

export interface Pt { x: number; y: number }

/** One straight stroke from a to b. */
function Segment({ a, b, stroke, width, dashed }: {
  a: Pt; b: Pt; stroke: string; width: number; dashed?: boolean;
}) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.5) return null;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const dashes = dashed ? Math.max(1, Math.floor(len / 8)) : 0;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - width / 2,
        width: len, height: width,
        flexDirection: 'row', gap: 4,
        backgroundColor: dashed ? 'transparent' : stroke,
        transform: [{ rotate: `${angle}rad` }],
      }}
    >
      {Array.from({ length: dashes }, (_, i) => (
        <View key={i} style={{ width: 4, height: width, backgroundColor: stroke }} />
      ))}
    </View>
  );
}

export function Polyline({ points, stroke = color.ink, width = 2.5, dashed }: {
  points: Pt[]; stroke?: string; width?: number; dashed?: boolean;
}) {
  return (
    <>
      {points.slice(1).map((p, i) => (
        <Segment key={i} a={points[i]} b={p} stroke={stroke} width={width} dashed={dashed} />
      ))}
      {/* Round joins, so the bends read as one line rather than separate bars. */}
      {dashed ? null : points.slice(1, -1).map((p, i) => (
        <Dot key={`j${i}`} at={p} size={width} fill={stroke} />
      ))}
    </>
  );
}

export function Dot({ at, size, fill, edge }: { at: Pt; size: number; fill: string; edge?: string }) {
  return (
    <View pointerEvents="none" style={{
      position: 'absolute', left: at.x - size / 2, top: at.y - size / 2,
      width: size, height: size, borderRadius: size / 2, backgroundColor: fill,
      borderWidth: edge ? 2 : 0, borderColor: edge,
    }} />
  );
}

/** A box that reports its width, so a chart can lay out in points. */
export function Measured({ height, style, children, accessibilityLabel }: {
  height: number;
  style?: ViewStyle;
  accessibilityLabel?: string;
  children: (width: number) => React.ReactNode;
}) {
  const [width, setWidth] = useState(0);
  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={[{ height }, style]}
    >
      {width > 0 ? children(width) : null}
    </View>
  );
}

const axis = { fontFamily: t.labelXs.fontFamily, fontSize: 10, color: color.muted } as const;

/**
 * Readiness over time toward race day.
 *
 * `points` are weekly averages with x as a 0..1 share of the span. The race-
 * ready zone and the dashed projection are drawn only when there is a race to
 * aim at; without one the chart ends at this week.
 */
export function ReadinessChart({
  points, projection, raceX, zone = [72, 85], leftLabel, rightLabel, height = 150, label, large,
}: {
  points: { x: number; v: number }[];
  projection?: { x: number; v: number } | null;
  raceX?: number | null;
  zone?: [number, number];
  leftLabel?: string | null;
  rightLabel?: string | null;
  height?: number;
  label: string;
  large?: boolean;
}) {
  const plot = height - 26;
  return (
    <Measured height={height} accessibilityLabel={label}>
      {width => {
        const px = (x: number) => 6 + x * (width - 12);
        const py = (v: number) => plot - 4 - (v / 100) * (plot - 12);
        const now = points[points.length - 1];
        return (
          <>
            {raceX != null ? (
              <>
                <View style={{
                  position: 'absolute', left: 0, right: 0, top: py(zone[1]), height: py(zone[0]) - py(zone[1]),
                  backgroundColor: color.ink, opacity: 0.07,
                }} />
                <Text style={[axis, { position: 'absolute', left: 4, top: py(zone[1]) - 15, fontWeight: '700' }]}>
                  {large ? `Race-ready zone ${zone[0]} to ${zone[1]}` : 'Race-ready zone'}
                </Text>
                <Polyline points={[{ x: px(raceX), y: 8 }, { x: px(raceX), y: plot }]} width={1} dashed />
              </>
            ) : null}
            {large ? (
              <>
                <View style={{ position: 'absolute', left: 0, right: 0, top: py(50), height: 1, backgroundColor: color.rule }} />
                <Text style={[axis, { position: 'absolute', left: 0, top: py(50) - 13, fontSize: 9 }]}>50</Text>
              </>
            ) : null}
            {now && projection ? (
              <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.45 }}>
                <Polyline points={[{ x: px(now.x), y: py(now.v) }, { x: px(projection.x), y: py(projection.v) }]} width={2} dashed />
              </View>
            ) : null}
            <Polyline points={points.map(p => ({ x: px(p.x), y: py(p.v) }))} />
            {now ? <Dot at={{ x: px(now.x), y: py(now.v) }} size={large ? 11 : 10} fill={color.red} /> : null}
            <View style={{ position: 'absolute', left: 0, right: 0, top: plot, height: 1.5, backgroundColor: color.ink }} />
            {leftLabel ? <Text style={[axis, { position: 'absolute', left: 0, top: plot + 8, fontWeight: '700' }]}>{leftLabel}</Text> : null}
            {now && now.x > 0.12 && now.x < 0.85 ? (
              <Text style={[axis, {
                position: 'absolute', left: px(now.x) - 20, width: 40, textAlign: 'center',
                top: plot + 8, color: color.ink, fontWeight: '800',
              }]}>Now</Text>
            ) : null}
            {rightLabel ? <Text style={[axis, { position: 'absolute', right: 0, top: plot + 8, fontWeight: '700' }]}>{rightLabel}</Text> : null}
          </>
        );
      }}
    </Measured>
  );
}

/** A small trend line with no axes. `invert` puts lower values at the top (pace). */
export function Sparkline({ values, stroke = color.ink, height = 32, invert, width: fixed }: {
  values: number[]; stroke?: string; height?: number; invert?: boolean; width?: number;
}) {
  const draw = (width: number) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pts = values.map((v, i) => {
      let k = (v - lo) / ((hi - lo) || 1);
      if (invert) k = 1 - k;
      return { x: 2 + i * ((width - 4) / Math.max(1, values.length - 1)), y: height - 3 - k * (height - 6) };
    });
    return <Polyline points={pts} stroke={stroke} width={2} />;
  };
  if (values.length < 2) return <View style={{ height }} />;
  return fixed
    ? <View style={{ width: fixed, height }}>{draw(fixed)}</View>
    : <Measured height={height}>{draw}</Measured>;
}
