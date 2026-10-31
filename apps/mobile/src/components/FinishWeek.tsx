/**
 * The week, as the finish screen shows it: Plan's tiles in a strip, with the
 * session just finished filling in (redesign plan, "the fill-the-tile moment").
 *
 * Finishing a session used to end on a summary, and the week only showed it
 * done the next time Plan was opened. This puts the two together: the tile the
 * athlete has been looking at all week fills in the session's colour, with a
 * success haptic as it lands, beside how much of the week is now done.
 *
 * Reduced motion skips the animation and shows the tile filled; the haptic
 * still fires, because it is feedback, not motion.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { color, kindColor, type as t, type SessionKind } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { useWeek } from '@/components/plan/weekData';

export function FinishWeek({ kind, extra }: {
  /** The finished session's kind, for the fill colour. */
  kind: SessionKind;
  /** True for optional work taken after a session: it is shown, not counted. */
  extra: boolean;
}) {
  const { week } = useWeek();
  const fill = useRef(new Animated.Value(0)).current;

  /**
   * The tile this session fills. By the time this screen shows, the store has
   * already put the finished session in the week as a done tile ('pending'),
   * so that is the one; before it lands, it is still today's tile. Neither
   * means the session was outside the week, and it gets a tile of its own.
   */
  const tiles = week.tiles.filter(x => x.state !== 'skipped');
  const target = tiles.find(x => x.key === 'pending') ?? tiles.find(x => x.state === 'today') ?? null;
  // A pending tile is already counted as done; today's tile is not yet.
  const done = week.done + (target?.state === 'today' && !extra ? 1 : 0);

  useEffect(() => {
    let live = true;
    const land = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); };
    AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (!live) return;
      if (reduce) { fill.setValue(1); land(); return; }
      Animated.timing(fill, { toValue: 1, duration: 650, delay: 350, useNativeDriver: false })
        .start(({ finished }) => { if (finished && live) land(); });
    }).catch(() => fill.setValue(1));
    return () => { live = false; };
  }, [fill]);

  const filling = (
    <Animated.View style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      height: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
      backgroundColor: kindColor[kind],
    }} />
  );
  const plus = (
    <Text style={{ position: 'absolute', top: 2, right: 4, fontSize: 11, fontWeight: '800', color: color.paper }}>+</Text>
  );

  const caption = extra
    ? "Extra session · your week's plan is unchanged"
    : week.planned ? `${done} of ${week.planned} this week` : 'Done for today';

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`This week: ${caption}`}
      style={{ borderWidth: 2, borderColor: color.ink, padding: 14, gap: 10 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <Label tone="ink">This week</Label>
        <Text style={[t.rowTitle, { flexShrink: 1, textAlign: 'right', fontSize: 13, color: color.ink }]}>{caption}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {tiles.map((tile, i) => {
          const isTarget = tile === target;
          const doneTile = tile.state === 'done' && !isTarget;
          return (
            <View key={tile.key ?? i} style={{
              flex: 1, maxWidth: 44, aspectRatio: 1,
              borderWidth: isTarget ? 2 : 1,
              borderColor: isTarget ? color.ink : doneTile ? kindColor[tile.kind] : color.chipBorder,
              backgroundColor: doneTile ? kindColor[tile.kind] : 'transparent',
              overflow: 'hidden',
            }}>
              {isTarget ? filling : null}
              {isTarget && extra ? plus : null}
            </View>
          );
        })}
        {!target ? (
          <View style={{ flex: 1, maxWidth: 44, aspectRatio: 1, borderWidth: 2, borderColor: color.ink, overflow: 'hidden' }}>
            {filling}
            {plus}
          </View>
        ) : null}
      </View>
    </View>
  );
}
