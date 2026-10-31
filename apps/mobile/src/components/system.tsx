/**
 * The redesign's shared pieces (PIVOT UI redesign plan, design system).
 *
 * Every approved screen is built from these, so each is defined once here
 * rather than restated per tab. They follow two rules the plan records:
 *
 *   - Chevrons mean one thing. A right chevron goes to another screen. A
 *     section that opens in place says Show or Hide beside a down chevron.
 *     A row that goes nowhere has no chevron at all.
 *   - A kind colour always travels with its word. Erg and station sit close
 *     in lightness, so nothing is told apart by colour alone.
 *
 * Nothing here holds data. Screens pass in what to show and what to do.
 */
import React, { useMemo } from 'react';
import { Pressable, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { EXERCISES } from '@/data/content';
import {
  sessionKind, sessionShape, type ShapeBar, type ShapeBlock,
} from '@/data/sessionShape';
import {
  color, kindColor, kindLabel, space, type as t, type SessionKind,
} from '@/theme/tokens';
import { deltaWords } from '@/lib/format';
import { ActionButton, InkPanel, Label } from './primitives';

/* ── kind ─────────────────────────────────────────────────────────────────── */

const exerciseIndex = new Map(EXERCISES.map(e => [e.id, e]));

/**
 * A session's shape and kind, computed once per template. Pass `blocks` to
 * draw a variant (Express, Micro) rather than the full prescription.
 */
export function useSessionLook(template: {
  id: string;
  session_type?: string | null;
  workout_family?: string | null;
  intensity_target?: string | null;
  blocks: ShapeBlock[];
} | null | undefined, blocks?: ShapeBlock[]): { bars: ShapeBar[]; kind: SessionKind } | null {
  return useMemo(() => {
    if (!template) return null;
    const bars = sessionShape(blocks ?? template.blocks, {
      exercises: exerciseIndex, intensityTarget: template.intensity_target,
    });
    return { bars, kind: sessionKind(template, bars) };
  }, [template, blocks]);
}

/** A square of the kind's colour and its word: "■ STATION". */
export function TypeTag({ kind, size = 'sm', style }: {
  kind: SessionKind;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}) {
  const square = size === 'md' ? 9 : 8;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, style]}>
      <View style={{ width: square, height: square, backgroundColor: kindColor[kind] }} />
      <Text style={[(size === 'md' ? t.labelSm : t.labelXs) as TextStyle, {
        color: kindColor[kind], fontFamily: t.eyebrow.fontFamily,
      }]}>
        {kindLabel[kind]}
      </Text>
    </View>
  );
}

/**
 * The session-shape graphic. Bars stand on a baseline: width is time, height
 * is effort, a gap is rest. A bar for a movement that is a kind by itself (a
 * run inside a hybrid) takes that kind's colour; the rest take the session's.
 *
 * Decorative to assistive technology: the session's name, kind and minutes
 * are always written beside it, and that is what a screen reader should read.
 */
export function SessionShape({ bars, kind, height = 28, muted, tint, style }: {
  bars: ShapeBar[];
  kind: SessionKind;
  height?: number;
  /** Drawn as an outline-weight grey, for a session that is not on offer. */
  muted?: boolean;
  /** One colour for every bar, for a shape drawn on a dark card. */
  tint?: string;
  style?: ViewStyle;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{
        height, flexDirection: 'row', alignItems: 'flex-end', gap: 1,
        borderBottomWidth: 1.5, borderBottomColor: color.ink,
      }, style]}
    >
      {bars.map((b, i) => (
        <View
          key={i}
          style={{
            flexGrow: b.grow, flexShrink: 1, flexBasis: 0,
            height: `${Math.round(b.effort * 100)}%`,
            backgroundColor: b.effort === 0 ? 'transparent'
              : tint ?? (muted ? color.chipBorder : kindColor[b.kind ?? kind]),
          }}
        />
      ))}
    </View>
  );
}

/* ── chevrons and rows ────────────────────────────────────────────────────── */

/**
 * A chevron drawn as two edges of a rotated square, so it is a crisp line at
 * any size without an icon set. `right` goes somewhere; `down` and `up` open
 * and close something in place.
 */
export function Chevron({ dir = 'right', size = 8, tint = color.muted, weight = 1.6 }: {
  dir?: 'right' | 'down' | 'up' | 'left';
  size?: number;
  tint?: string;
  weight?: number;
}) {
  const turn = { right: '-45deg', down: '45deg', left: '135deg', up: '-135deg' }[dir];
  // The square's corner is the point, so nudge it back toward the centre of
  // its box along the direction it points.
  const nudge = size * 0.2;
  const shift = {
    right: { left: -nudge }, left: { left: nudge }, down: { top: -nudge }, up: { top: nudge },
  }[dir];
  return (
    <View style={{ width: size * 1.5, height: size * 1.5, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: size, height: size, ...shift,
        borderRightWidth: weight, borderBottomWidth: weight, borderColor: tint,
        transform: [{ rotate: turn }],
      }} />
    </View>
  );
}

/**
 * A row that goes to another screen: title, its current value in words
 * underneath, and a right chevron. The whole row is the target.
 */
export function NavRow({ title, value, onPress, tone = 'ink', last, style }: {
  title: string;
  value?: string | null;
  onPress: () => void;
  tone?: 'ink' | 'danger';
  /** Drops the bottom rule on the last row of a group. */
  last?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      style={({ pressed }) => [{
        minHeight: 60, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: color.rule,
        backgroundColor: pressed ? color.hover : 'transparent',
      }, style]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[t.rowTitle, { fontSize: 15, color: tone === 'danger' ? color.redDark : color.ink }]}>
          {title}
        </Text>
        {value ? (
          <Text numberOfLines={1} style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>{value}</Text>
        ) : null}
      </View>
      <Chevron dir="right" />
    </Pressable>
  );
}

/**
 * A section that opens in place. The header says what it holds and offers
 * Show or Hide beside a down chevron that turns up when open, so it never
 * reads as a link to somewhere else.
 */
export function Disclosure({ title, open, onToggle, children, style }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ borderTopWidth: 1, borderTopColor: color.rule }, style]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        accessibilityHint={open ? 'Hides this section' : 'Shows this section'}
        style={({ pressed }) => ({
          minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: pressed ? color.hover : 'transparent',
        })}
      >
        <Text style={[t.rowTitle, { color: color.ink }]}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, fontSize: 12, color: color.muted2 }]}>
            {open ? 'Hide' : 'Show'}
          </Text>
          <Chevron dir={open ? 'up' : 'down'} size={7} />
        </View>
      </Pressable>
      {open ? <View style={{ paddingBottom: 8 }}>{children}</View> : null}
    </View>
  );
}

/**
 * The bar under the app header on every subpage: a back arrow and the name of
 * where it goes back to. 44 pt target, as everywhere.
 */
export function SubpageHeader({ backTo, onBack, style }: {
  /** The screen the arrow returns to, in words: "Progress", "Profile". */
  backTo: string;
  onBack: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 8, paddingVertical: 4,
      borderBottomWidth: 1, borderBottomColor: color.rule,
    }, style]}>
      <Pressable
        onPress={onBack}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Back to ${backTo}`}
        style={({ pressed }) => ({
          width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
          backgroundColor: pressed ? color.hover : 'transparent',
        })}
      >
        <Chevron dir="left" size={10} tint={color.ink} weight={1.8} />
      </Pressable>
      <Text style={[t.rowTitle, { fontSize: 15, fontFamily: t.eyebrow.fontFamily, color: color.ink }]}>
        {backTo}
      </Text>
    </View>
  );
}

/* ── changes and next steps ───────────────────────────────────────────────── */

/**
 * The bottom bar for an edit that changes the plan (equipment, goal, running,
 * fitness and experience). Nothing is saved until it is confirmed, and the
 * bar says what will happen before the tap rather than after it.
 *
 * Edits that only re-rank (preferences, session length) save on tap and do
 * not use this.
 */
export function DraftSaveBar({
  changes, consequence, idleNote, confirmLabel, onConfirm, onDiscard, busy, style,
}: {
  /** How many things differ from what is saved. 0 shows `idleNote`. */
  changes: number;
  /** What saving will do: "Your 3 sessions left this week are rebuilt…" */
  consequence: string;
  idleNote: string;
  confirmLabel: string;
  onConfirm: () => void;
  onDiscard: () => void;
  busy?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[{
      borderTopWidth: 2, borderTopColor: color.ink, backgroundColor: color.paper,
      paddingHorizontal: space.gutter, paddingTop: 14, paddingBottom: 14, gap: 10,
    }, style]}>
      {changes === 0 ? (
        <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>{idleNote}</Text>
      ) : (
        <>
          <View style={{ gap: 4 }}>
            <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, color: color.ink }]}>
              {changes === 1 ? '1 change' : `${changes} changes`}
            </Text>
            <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>{consequence}</Text>
          </View>
          <ActionButton
            label={busy ? 'Saving…' : confirmLabel}
            arrow={null}
            onPress={busy ? undefined : onConfirm}
            style={{ opacity: busy ? 0.6 : 1 }}
          />
          <Pressable
            onPress={busy ? undefined : onDiscard}
            accessibilityRole="button"
            style={{ minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[t.bodySm, {
              fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.ink,
              textDecorationLine: 'underline',
            }]}>
              Discard changes
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/**
 * The dark "next step" card: what to do about what the screen just showed,
 * with one action. Built on InkPanel so it shares the coach-note look.
 */
export function NextStepCard({ label = 'Next step', body, actionLabel, onAction, style }: {
  label?: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  return (
    <InkPanel label={label} style={style}>
      <Text style={[t.body, { fontSize: 15, lineHeight: 22, color: color.onDark }]}>{body}</Text>
      {actionLabel && onAction ? (
        <ActionButton label={actionLabel} variant="outlineDark" arrow={null} onPress={onAction}
          style={{ marginTop: 12 }} />
      ) : null}
    </InkPanel>
  );
}

/** A change over time, with an arrow: "↑ 15 from 47, 4 weeks ago". Red only when it is bad. */
export function Delta({ now, from, since, goodWhen = 'up', unit = '', style }: {
  now: number;
  from: number;
  /** "4 weeks ago", "Sep 1". */
  since: string;
  goodWhen?: 'up' | 'down';
  unit?: string;
  style?: TextStyle;
}) {
  const { text, bad } = deltaWords({ now, from, since, goodWhen, unit });
  return (
    <Text style={[t.bodySm, {
      fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: bad ? color.redDark : color.ink,
    }, style]}>
      {text}
    </Text>
  );
}

/** A section heading in the system's micro-label voice, with an optional note right. */
export function SectionHead({ title, note, style }: { title: string; note?: string; style?: ViewStyle }) {
  return (
    <View style={[{
      flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
      paddingTop: 24, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink,
    }, style]}>
      <Label tone="ink">{title}</Label>
      {note ? <Text style={[t.meta, { color: color.muted2 }]}>{note}</Text> : null}
    </View>
  );
}
