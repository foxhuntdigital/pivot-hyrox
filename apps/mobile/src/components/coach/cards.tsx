/**
 * Coach's structured components (CC01–CC12).
 *
 * Cards are interactive objects, not screenshots embedded in chat: each one is
 * rendered from a typed payload built in `state/coachAnswer.ts`, and each one
 * says what data it was built from. Comparisons announce Current before
 * Proposed for screen readers, and no card relies on colour alone to carry
 * variant, direction or confidence (Coach brief §13).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Pressable, Text, View,
  type TextStyle, type ViewStyle,
} from 'react-native';

import { color, type as t, space } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import type { CoachCard, CoachAction } from '@/state/coachAnswer';
import type { CoachCommitment } from '@/state/coach';

/** 2px ink outline — the design's "this is a structured object" signal. */
const framed: ViewStyle = { borderWidth: 2, borderColor: color.ink, marginTop: 12 };

const micro: TextStyle = {
  fontFamily: t.labelSm.fontFamily, fontSize: 9, letterSpacing: 1.08,
  textTransform: 'uppercase',
};

const cardHeaderText: TextStyle = {
  fontFamily: t.eyebrow.fontFamily, fontSize: 9, letterSpacing: 1.44,
  textTransform: 'uppercase',
};

/** A row of the ink header every mutating card wears. */
function CardHeader({ title, note, tone = 'ink' }: {
  title: string; note?: string; tone?: 'ink' | 'red';
}) {
  const bg = tone === 'red' ? color.red : color.ink;
  return (
    <View style={{
      backgroundColor: bg, paddingVertical: 9, paddingHorizontal: 14,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    }}>
      <Text style={[cardHeaderText, { color: color.onDark, flexShrink: 1 }]}>{title}</Text>
      {note ? (
        <Text style={[micro, { color: tone === 'red' ? color.onDarkSoft : color.salmon }]}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** The grey footer strip that carries a caveat or a "rest of week" note. */
function CardFooter({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <View style={{
      borderTopWidth: 1, borderTopColor: color.rule, backgroundColor: color.card,
      paddingVertical: 11, paddingHorizontal: 14,
    }}>
      {label ? <Label size="sm" style={{ letterSpacing: 1.08, marginBottom: 2 }}>{label}</Label> : null}
      {typeof children === 'string'
        ? <Text style={[t.bodySm, { fontSize: 12.5, lineHeight: 17.5, color: color.ink }]}>{children}</Text>
        : children}
    </View>
  );
}

/* ------------------------------------------------------------------ CC01 --- */

/**
 * The context strip. Readiness is tappable because its confidence is the thing
 * an athlete most often wants explained, and it opens an answer rather than
 * expanding the page (brief §3.2).
 */
export function ContextStrip({ race, phase, readiness, confidence, onReadiness }: {
  race: string;
  phase: string;
  readiness: number;
  confidence: string;
  onReadiness: () => void;
}) {
  const cell: ViewStyle = { flex: 1, paddingVertical: 12, paddingHorizontal: 14 };
  return (
    <View style={{
      flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.rule,
    }}>
      <View style={[cell, { borderRightWidth: 1, borderRightColor: color.rule }]}>
        <Label size="sm" style={{ letterSpacing: 1.08 }}>Race</Label>
        <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 13, marginTop: 4, color: color.ink }]}>
          {race}
        </Text>
      </View>
      <View style={[cell, { borderRightWidth: 1, borderRightColor: color.rule }]}>
        <Label size="sm" style={{ letterSpacing: 1.08 }}>Phase</Label>
        <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 13, marginTop: 4, color: color.ink }]}>
          {phase}
        </Text>
      </View>
      <Pressable
        onPress={onReadiness}
        accessibilityRole="button"
        accessibilityLabel={`Readiness ${readiness}, ${confidence} confidence. Ask Coach about it.`}
        style={({ pressed }) => [cell, { backgroundColor: pressed ? color.hover : 'transparent' }]}
      >
        <Label size="sm" style={{ letterSpacing: 1.08 }}>Readiness</Label>
        <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 13, marginTop: 4, color: color.ink }]}>
          {readiness} · <Text style={{ color: color.redDark }}>{confidence} conf</Text>
        </Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ CC03 --- */

export function InsightCard({ label, text, chips, cta, onPress, onDismiss }: {
  label: string;
  text: string;
  chips: string[];
  cta: string;
  onPress: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={{ backgroundColor: color.ink, paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <Label tone="salmon" size="sm" style={{ letterSpacing: 1.26 }}>{label}</Label>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss insight"
          hitSlop={16}
        >
          <Text style={{ fontFamily: t.eyebrow.fontFamily, fontSize: 11, color: color.muted3 }}>✕</Text>
        </Pressable>
      </View>
      <Text style={[t.body, { fontSize: 14, lineHeight: 20, color: color.onDarkSoft, marginTop: 4 }]}>
        {text}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {chips.map(c => (
          <View key={c} style={{ borderWidth: 1, borderColor: color.ruleDark2, paddingVertical: 5, paddingHorizontal: 8 }}>
            <Text style={[micro, { color: color.muted3 }]}>{c}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: 14, borderWidth: 1, borderColor: color.red, minHeight: 44,
          paddingVertical: 12, paddingHorizontal: 14,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: pressed ? color.inkPressed : 'transparent',
        })}
      >
        <Text style={[t.button as TextStyle, { fontSize: 12, letterSpacing: 1.2, color: color.salmon }]}>
          {cta}
        </Text>
        <Text style={{ fontSize: 14, color: color.salmon }}>→</Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ CC02 --- */

export function PromptRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: pressed ? color.ink : color.chipBorder,
        backgroundColor: pressed ? color.hover : 'transparent',
        minHeight: 48, paddingVertical: 13, paddingHorizontal: 14,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      })}
    >
      <Text style={{ fontFamily: t.greeting.fontFamily, fontSize: 13, color: color.ink, flexShrink: 1 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 12, color: color.muted3 }}>→</Text>
    </Pressable>
  );
}

export function RecentRow({ title, when, onPress }: {
  title: string; when: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${when}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
        minHeight: 44, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
        backgroundColor: pressed ? color.hover : 'transparent',
      })}
    >
      <Text style={{ fontFamily: t.greeting.fontFamily, fontSize: 13.5, color: color.ink, flexShrink: 1 }}>
        {title}
      </Text>
      <Text style={[micro, { letterSpacing: 1, color: color.muted3 }]}>{when}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------- thread anatomy --- */

/**
 * The design's `riseIn`: an answer arrives rather than appearing. Skipped when
 * the athlete has asked for reduced motion (brief §13), and driven by RN's own
 * Animated so it needs nothing at the bundler level.
 */
export function Rise({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState<boolean | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (!cancelled) setReduced(v); })
      .catch(() => { if (!cancelled) setReduced(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (reduced === null) return;
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [progress, reduced]);

  return (
    <Animated.View style={{
      opacity: progress,
      transform: [{
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
      }],
    }}>
      {children}
    </Animated.View>
  );
}

export function AthleteMessage({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <View style={{ maxWidth: '82%', backgroundColor: color.ink, paddingVertical: 12, paddingHorizontal: 14 }}>
        <Text style={[t.body, { fontSize: 13.5, lineHeight: 19.5, color: color.onDark }]}>{text}</Text>
      </View>
    </View>
  );
}

export function CoachNarrative({ text, chips }: { text: string; chips: string[] }) {
  return (
    <View>
      <Label size="sm" style={{ letterSpacing: 1.44, fontFamily: t.eyebrow.fontFamily, marginBottom: 6 }}>
        Coach
      </Label>
      <Text style={[t.body, { fontSize: 14, lineHeight: 21, color: color.ink }]}>{text}</Text>
      {chips.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {chips.map(c => (
            <View key={c} style={{ borderWidth: 1, borderColor: color.chipBorder, paddingVertical: 5, paddingHorizontal: 8 }}>
              <Text style={[micro, { letterSpacing: 1, color: color.muted2 }]}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Pending() {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      accessibilityRole="progressbar"
      accessibilityLabel="Checking your plan"
    >
      <View style={{ width: 8, height: 8, backgroundColor: color.red }} />
      <Text style={{ fontFamily: t.rowTitle.fontFamily, fontSize: 12, color: color.muted }}>
        Checking your plan…
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ CC09 --- */

export function WhyDrawer({ open, rows, onToggle }: {
  open: boolean;
  rows: { k: string; v: string }[];
  onToggle: () => void;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Why this? Evidence Coach used."
        style={({ pressed }) => ({
          borderWidth: 1, borderColor: color.chipBorder, minHeight: 44,
          paddingVertical: 11, paddingHorizontal: 14,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: pressed ? color.hover : 'transparent',
        })}
      >
        <Text style={[t.button as TextStyle, { fontSize: 11, letterSpacing: 1.32, color: color.ink }]}>
          Why this?
        </Text>
        <Text style={{ fontFamily: t.eyebrow.fontFamily, fontSize: 13, color: color.ink }}>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? (
        <View style={{
          borderWidth: 1, borderTopWidth: 0, borderColor: color.rule,
          paddingVertical: 12, paddingHorizontal: 14,
        }}>
          {rows.map(row => (
            <View key={row.k} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: color.ruleFaint }}>
              <Label size="sm" style={{ letterSpacing: 1.08 }}>{row.k}</Label>
              <Text style={[t.bodySm, { fontSize: 12.5, lineHeight: 17.5, color: color.ink, marginTop: 2 }]}>
                {row.v}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- cards --- */

/** CC05 — current vs proposed, with the preserved stimulus stated. */
function AdaptationCard({ card }: { card: Extract<CoachCard, { kind: 'adaptation' }> }) {
  const side = (
    label: string,
    value: { name: string; variant: string; minutes: number },
    proposed: boolean,
  ) => (
    <View style={{
      flex: 1, paddingVertical: 12, paddingHorizontal: 14,
      backgroundColor: proposed ? color.tint : 'transparent',
      borderLeftWidth: proposed ? 1 : 0, borderLeftColor: color.tintBorder,
    }}>
      <Label size="sm" tone={proposed ? 'redDark' : 'muted'} style={{ letterSpacing: 1.08 }}>
        {label}
      </Label>
      <Text style={[t.rowTitle, { fontSize: 13, marginTop: 3, color: proposed ? color.redDeep : color.ink }]}>
        {value.name}
      </Text>
      <Text style={[t.statValue, { fontSize: 20, letterSpacing: -0.6, color: proposed ? color.redDark : color.ink }]}>
        {value.minutes}
        <Text style={[micro, { fontSize: 10, letterSpacing: 1 }]}> MIN</Text>
      </Text>
      <Text style={[micro, { fontSize: 10, letterSpacing: 1, color: proposed ? color.redDark : color.muted3 }]}>
        {value.variant}
      </Text>
    </View>
  );

  return (
    <View style={framed} accessibilityLabel={card.a11y}>
      <CardHeader title="Adaptation" note="Needs your OK" />
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {side('Current', card.current, false)}
        <View style={{ justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ fontFamily: t.statValue.fontFamily, fontSize: 16, color: color.red }}>→</Text>
        </View>
        {side('Proposed', card.proposed, true)}
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: color.rule, paddingVertical: 11, paddingHorizontal: 14 }}>
        {/* The label reports what actually happened to the stimulus: a swap
            that changes it must not be presented as a preserved one. */}
        <Label size="sm" tone={card.preserved ? 'muted' : 'redDark'} style={{ letterSpacing: 1.08 }}>
          {card.preserved ? 'Stimulus preserved' : 'Stimulus changed'}
        </Label>
        <Text style={[t.rowTitle, { fontSize: 13, marginTop: 2, color: color.ink }]}>{card.stimulus}</Text>
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: color.rule, paddingVertical: 11, paddingHorizontal: 14 }}>
        <Label size="sm" style={{ letterSpacing: 1.08, marginBottom: 6 }}>What changed</Label>
        {card.changes.map(change => (
          <View key={change} style={{ flexDirection: 'row', gap: 8, paddingVertical: 3 }}>
            <Text style={{ fontFamily: t.eyebrow.fontFamily, fontSize: 12, color: color.red, width: 8 }}>·</Text>
            <Text style={[t.bodySm, { flex: 1, fontSize: 12.5, lineHeight: 17.5, color: color.ink }]}>
              {change}
            </Text>
          </View>
        ))}
      </View>

      <CardFooter label="Rest of week">{card.week_impact}</CardFooter>
    </View>
  );
}

/** CC07 — a trend, with its window, sample size and confidence on the card. */
function TrendCard({ card }: { card: Extract<CoachCard, { kind: 'trend' }> }) {
  const arrow = card.direction === 'Improving' ? '↑' : card.direction === 'Slowing' ? '↓' : '→';
  const stat = (k: string, v: string, last?: boolean, tone?: string) => (
    <View style={{
      flex: 1, paddingVertical: 10, paddingHorizontal: 12,
      borderRightWidth: last ? 0 : 1, borderRightColor: color.rule,
    }}>
      <Label size="xs" style={{ letterSpacing: 0.96 }}>{k}</Label>
      <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 12, marginTop: 2, color: tone ?? color.ink }]}>
        {v}
      </Text>
    </View>
  );

  return (
    <View style={framed}>
      <View style={{ paddingTop: 12, paddingHorizontal: 14, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 13, color: color.ink }]}>
            {card.metric}
          </Text>
          <Text style={[t.statValue, { fontSize: 13, letterSpacing: 0, color: color.red }]}>
            {arrow} {card.direction}
          </Text>
        </View>

        {/* The chart is decoration for a claim the text already makes; the
            textual summary is what a screen reader gets (brief §13). */}
        <View
          style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 52, marginTop: 12 }}
          accessibilityLabel={card.a11y}
        >
          {card.bars.map((bar, i) => (
            <View
              key={i}
              style={{
                flex: 1, height: `${bar.height}%`,
                backgroundColor: bar.accent ? color.red : color.ink,
              }}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
          <Text style={[micro, { letterSpacing: 1, color: color.muted3 }]}>{card.from}</Text>
          <Text style={[micro, { letterSpacing: 1, color: color.muted3 }]}>{card.to}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.rule }}>
        {stat('Window', card.window)}
        {stat('Sessions', card.samples)}
        {stat(
          'Confidence',
          card.confidence.charAt(0).toUpperCase() + card.confidence.slice(1),
          true,
          color.redDark,
        )}
      </View>

      <CardFooter>{card.caveat}</CardFooter>
    </View>
  );
}

/** CC08 — validated substitutions, with what the swap costs. */
function SubstitutionCard({ card }: { card: Extract<CoachCard, { kind: 'substitution' }> }) {
  return (
    <View style={framed}>
      <CardHeader title={card.title} />
      {card.subs.map(sub => (
        <View
          key={`${sub.from}-${sub.to}`}
          style={{ paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: color.ruleFaint }}
          accessibilityLabel={`${sub.from} becomes ${sub.to}. ${sub.why}.`}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{
              fontFamily: t.greeting.fontFamily, fontSize: 12.5, color: color.muted,
              textDecorationLine: 'line-through',
            }}>
              {sub.from}
            </Text>
            <Text style={{ fontFamily: t.statValue.fontFamily, fontSize: 12, color: color.red }}>→</Text>
            <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 12.5, color: color.ink }]}>
              {sub.to}
            </Text>
          </View>
          <Text style={[t.meta, { color: color.muted, marginTop: 3 }]}>{sub.why}</Text>
        </View>
      ))}
      <CardFooter>{card.caveat}</CardFooter>
    </View>
  );
}

/** CC04 — a validated workout, with why it fits. */
function WorkoutCard({ card }: { card: Extract<CoachCard, { kind: 'workout' }> }) {
  return (
    <View style={framed}>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.rule }}>
        <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 14 }}>
          <Label size="sm" style={{ letterSpacing: 1.44, fontFamily: t.eyebrow.fontFamily }}>
            {card.source}
          </Label>
          <Text style={[t.h4, { fontSize: 18, marginTop: 4, color: color.ink }]}>{card.name}</Text>
          <Text style={[t.meta, { fontSize: 11.5, color: color.muted2, marginTop: 2 }]}>{card.goal}</Text>
        </View>
        <View style={{
          width: 74, borderLeftWidth: 1, borderLeftColor: color.rule,
          justifyContent: 'center', paddingLeft: 12,
        }}>
          <Text style={[t.statValue, { fontSize: 26, letterSpacing: -1, color: color.ink }]}>
            {card.minutes}
          </Text>
          <Label size="sm" style={{ letterSpacing: 1.26 }}>Min</Label>
        </View>
      </View>

      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 6,
        paddingTop: 10, paddingHorizontal: 14,
      }}>
        {[card.variant, card.intensity, card.equipment].filter(Boolean).map(meta => (
          <View key={meta} style={{ borderWidth: 1, borderColor: color.chipBorder, paddingVertical: 4, paddingHorizontal: 7 }}>
            <Text style={[micro, { letterSpacing: 1, color: color.muted2 }]}>{meta}</Text>
          </View>
        ))}
      </View>

      <View style={{ paddingTop: 6, paddingHorizontal: 14, paddingBottom: 10 }}>
        {card.blocks.map((block, i) => (
          <View
            key={`${block.label}-${i}`}
            style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.ruleFaint }}
          >
            <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 12.5, width: 50, color: color.ink }]}>
              {block.qty}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: t.greeting.fontFamily, fontSize: 12.5, color: color.ink }}>
                {block.label}
              </Text>
              <Text style={[t.meta, { color: color.muted }]}>{block.note}</Text>
            </View>
          </View>
        ))}
      </View>

      <CardFooter label="Why it fits">{card.fits}</CardFooter>
    </View>
  );
}

/** CC06 summary — a plan change, visibly not applied. */
function PlanCard({ card }: { card: Extract<CoachCard, { kind: 'plan' }> }) {
  const { proposal } = card;
  return (
    <View style={[framed, { borderColor: color.red }]}>
      <CardHeader title="Weekly plan change · not applied" tone="red" />
      <View style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Label size="sm" style={{ letterSpacing: 1.08 }}>{proposal.current.label}</Label>
            <Text style={[t.statValue, { fontSize: 22, letterSpacing: -0.66, color: color.ink }]}>
              {proposal.current.value}
              <Text style={[micro, { fontSize: 11, letterSpacing: 0.66 }]}> {proposal.current.unit}</Text>
            </Text>
          </View>
          <Text style={{ fontFamily: t.statValue.fontFamily, fontSize: 16, color: color.red }}>→</Text>
          <View style={{ flex: 1 }}>
            <Label size="sm" tone="redDark" style={{ letterSpacing: 1.08 }}>{proposal.proposed.label}</Label>
            <Text style={[t.statValue, { fontSize: 22, letterSpacing: -0.66, color: color.redDark }]}>
              {proposal.proposed.value}
              <Text style={[micro, { fontSize: 11, letterSpacing: 0.66 }]}> {proposal.proposed.unit}</Text>
            </Text>
          </View>
        </View>
        <Text style={[t.bodySm, { fontSize: 12.5, lineHeight: 17.5, color: color.redDeep, marginTop: 10 }]}>
          {proposal.lede}
        </Text>
      </View>
    </View>
  );
}

/** CC11 — the boundary, stated without alarm, plus what did not change. */
function SafetyCard({ card }: { card: Extract<CoachCard, { kind: 'safety' }> }) {
  return (
    <View style={[framed, { backgroundColor: color.card }]}>
      <View style={{ paddingTop: 12, paddingHorizontal: 14, paddingBottom: 12 }}>
        <Label size="sm" style={{ letterSpacing: 1.44, fontFamily: t.eyebrow.fontFamily, marginBottom: 4 }}>
          What I can't do here
        </Label>
        <Text style={[t.body, { fontSize: 13, lineHeight: 19.5, color: color.ink }]}>{card.boundary}</Text>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: color.rule, paddingVertical: 11, paddingHorizontal: 14 }}>
        <Text style={[t.bodySm, { fontSize: 12.5, lineHeight: 17.5, color: color.muted2 }]}>
          {card.unchanged}
        </Text>
      </View>
    </View>
  );
}

export function StructuredCard({ card }: { card: CoachCard }) {
  switch (card.kind) {
    case 'adaptation': return <AdaptationCard card={card} />;
    case 'trend': return <TrendCard card={card} />;
    case 'substitution': return <SubstitutionCard card={card} />;
    case 'workout': return <WorkoutCard card={card} />;
    case 'plan': return <PlanCard card={card} />;
    case 'safety': return <SafetyCard card={card} />;
  }
}

/* ---------------------------------------------------------- action footer --- */

/** One primary action, up to two secondaries (brief §4.1). */
export function ActionFooter({ actions, onAction }: {
  actions: CoachAction[];
  onAction: (action: CoachAction) => void;
}) {
  return (
    <View style={{ gap: 6, marginTop: 12 }}>
      {actions.map(action => (
        <Pressable
          key={action.id}
          onPress={() => onAction(action)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            minHeight: 48, paddingVertical: 15, paddingHorizontal: 14,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: action.primary
              ? (pressed ? color.redPressed : color.red)
              : (pressed ? color.hover : 'transparent'),
            borderWidth: 1,
            borderColor: action.primary ? color.red : color.ink,
          })}
        >
          <Text style={[t.button as TextStyle, {
            fontSize: 12, letterSpacing: 1.44, flexShrink: 1,
            color: action.primary ? color.onDark : color.ink,
          }]}>
            {action.label}
          </Text>
          {action.primary ? (
            <Text style={{ fontSize: 14, color: color.onDark }}>→</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/** CC12 — what happened, where it landed, and how to take it back. */
export function Committed({ commitment, onPrimary, onUndo }: {
  commitment: CoachCommitment;
  onPrimary: () => void;
  onUndo: () => void;
}) {
  return (
    <View style={{
      marginTop: 12, borderWidth: 2, borderColor: color.red,
      backgroundColor: color.tint, paddingVertical: 12, paddingHorizontal: 14,
    }}>
      <Label size="sm" tone="redDark" style={{ letterSpacing: 1.44, fontFamily: t.eyebrow.fontFamily }}>
        Applied
      </Label>
      <Text style={[t.body, { fontSize: 13, lineHeight: 19, color: color.redDeep, marginTop: 3 }]}>
        {commitment.text}
      </Text>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
        <Pressable
          onPress={onPrimary}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? color.redPressed : color.red,
          })}
        >
          <Text style={[t.button as TextStyle, { fontSize: 11.5, letterSpacing: 1.15, color: color.onDark }]}>
            {commitment.cta}
          </Text>
        </Pressable>
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo this change"
          style={({ pressed }) => ({
            minHeight: 48, paddingVertical: 14, paddingHorizontal: 16,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: color.ink,
            backgroundColor: pressed ? color.hover : 'transparent',
          })}
        >
          <Text style={[t.button as TextStyle, { fontSize: 11.5, letterSpacing: 1.15, color: color.ink }]}>
            Undo
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
