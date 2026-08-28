/**
 * The tour's two pieces: the wrapper that makes an element findable, and the
 * overlay that draws around it.
 *
 * The dimming is four rectangles around the target rather than a masked cutout.
 * The app has no SVG dependency and does not need one for this — four views
 * leave the highlighted element rendering exactly as it does underneath, at
 * full contrast, which is the whole point of a spotlight.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, Modal, useWindowDimensions, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, type as t, space } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { useTour, type TourRect } from '@/state/tour';

/** Breathing room around the highlight, so the outline never clips content. */
const PAD = 6;

/**
 * Wraps an element the tour points at.
 *
 * Renders a plain View — no layout of its own beyond what is passed in — so
 * adding one to a screen cannot change how that screen looks.
 */
export function TourSpot({
  id, children, style,
}: {
  id: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { register } = useTour();
  const ref = useRef<View | null>(null);

  useEffect(() => {
    register(id, () => new Promise<TourRect | null>(resolve => {
      const node = ref.current;
      if (!node) { resolve(null); return; }
      node.measureInWindow((x, y, width, height) => {
        // A collapsed or detached node measures as zero. Reporting null means
        // the overlay explains the step without pointing at the wrong place.
        if (!width || !height) resolve(null);
        else resolve({ x, y, width, height });
      });
    }));
    return () => register(id, null);
  }, [id, register]);

  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}

function Dim({ style }: { style: ViewStyle }) {
  return <View pointerEvents="none" style={[{ position: 'absolute', backgroundColor: 'rgba(16,15,14,0.78)' }, style]} />;
}

export function TourOverlay() {
  const tour = useTour();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const { active, step, rect, index, total } = tour;

  /**
   * Where the caption goes.
   *
   * The preferred side wins when it fits; otherwise it flips. With no rect at
   * all — an element that never registered, or one scrolled out of a list — the
   * card centres and the step is explained without a highlight, which is better
   * than an outline drawn around nothing.
   */
  const cardTop = useCallback((): number => {
    const CARD = 210;
    if (!rect) return Math.max(insets.top + 40, height / 2 - CARD / 2);
    const below = rect.y + rect.height + PAD + 14;
    const above = rect.y - PAD - 14 - CARD;
    if (step?.prefer === 'above') {
      return above > insets.top + 8 ? above : below;
    }
    return below + CARD < height - insets.bottom - 8 ? below : Math.max(insets.top + 8, above);
  }, [rect, step, height, insets]);

  if (!active || !step) return null;

  const isLast = index >= total - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={tour.end}>
      {/* Tapping the dimmed area advances, the way a lightbox does. The target
          itself is not tappable through the overlay: the tour describes the
          controls, it does not ask the athlete to operate them mid-explanation. */}
      <Pressable
        onPress={tour.next}
        accessibilityRole="button"
        accessibilityLabel={`${step.title}. ${step.body} Step ${index + 1} of ${total}. Tap to continue.`}
        style={{ flex: 1 }}
      >
        {rect ? (
          <>
            <Dim style={{ left: 0, right: 0, top: 0, height: Math.max(0, rect.y - PAD) }} />
            <Dim style={{ left: 0, right: 0, top: rect.y + rect.height + PAD, bottom: 0 }} />
            <Dim style={{
              left: 0, width: Math.max(0, rect.x - PAD),
              top: Math.max(0, rect.y - PAD), height: rect.height + PAD * 2,
            }} />
            <Dim style={{
              left: rect.x + rect.width + PAD, right: 0,
              top: Math.max(0, rect.y - PAD), height: rect.height + PAD * 2,
            }} />
            {/* The outline, in the accent that means "attention" everywhere
                else in the app. */}
            <View pointerEvents="none" style={{
              position: 'absolute',
              left: rect.x - PAD, top: rect.y - PAD,
              width: rect.width + PAD * 2, height: rect.height + PAD * 2,
              borderWidth: 2, borderColor: color.red,
            }} />
          </>
        ) : (
          <Dim style={{ left: 0, right: 0, top: 0, bottom: 0 }} />
        )}

        <View style={{
          position: 'absolute', top: cardTop(),
          left: space.gutter, right: space.gutter,
          backgroundColor: color.paper, borderWidth: 2, borderColor: color.ink,
        }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
            <Label tone="redDark" size="sm" style={{ marginBottom: 6 }}>
              {index + 1} of {total}
            </Label>
            <Text style={[t.h3, { color: color.ink }]}>{step.title}</Text>
            <Text style={[t.bodySm, { color: color.muted2, marginTop: 6 }]}>{step.body}</Text>
          </View>

          <View style={{ height: 1, backgroundColor: color.rule }} />
          <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
            <Pressable
              onPress={tour.end}
              accessibilityRole="button"
              accessibilityLabel="Skip the tour"
              style={({ pressed }) => ({
                paddingVertical: 15, paddingHorizontal: 16,
                borderRightWidth: 1, borderRightColor: color.rule,
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              <Text style={[t.button, { fontSize: 11, color: color.muted }]}>
                {isLast ? 'Close' : 'Skip'}
              </Text>
            </Pressable>
            <Pressable
              onPress={tour.next}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Finish the tour' : 'Next step'}
              style={({ pressed }) => ({
                flex: 1, paddingVertical: 15, paddingHorizontal: 16,
                alignItems: 'flex-end',
                backgroundColor: pressed ? color.redPressed : color.red,
              })}
            >
              <Text style={[t.button, { fontSize: 11, color: color.onDark }]}>
                {isLast ? "Got it  →" : 'Next  →'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
