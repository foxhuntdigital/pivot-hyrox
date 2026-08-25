/**
 * D20 Recovery check-in (FR-015).
 *
 * Five questions, none of them required. An athlete who only wants to say they
 * slept badly should be able to do that and leave — `recoverySignal` scores what
 * was answered rather than penalising the silence, so a partial check-in is a
 * first-class outcome rather than an incomplete form.
 *
 * Sleep is entered as hours and minutes rather than a slider or a bucket: it is
 * the one field the engine reasons about numerically (below five hours caps
 * recovery), and "6:45" is a thing people know about their night in a way that
 * "roughly 7" is not. Steppers keep it tap-based (PRD §6.3) and one-handed.
 *
 * The design follows the two moves the system already makes. Sleep gets the ink
 * treatment the workout player uses, because it is the one number here that
 * changes today's session — and the sheet ends by saying what the answers did,
 * the same way the completion screen explains what an RPE will do. Nothing is
 * decorative: the ruler exists to place the night against the five-hour rule,
 * and the meter exists so "why did my session shrink" is answered before it is
 * asked (PRD §2, explain the why).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { recoverySignal } from '@pivot/engine';
import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton, Chip, SquareCheck } from '@/components/primitives';
import { useApp } from '@/state/store';
import { EMPTY_CHECKIN, fromDecimalHours, toDecimalHours, type Checkin } from '@/data/recoveryRepo';
import { hoursToClock, LOW_SLEEP_HOURS } from '@/lib/format';

const ENERGY = ['low', 'normal', 'high'] as const;

/** The wash the Adapt sheet lays over the screen behind it: ink at 55%. */
const SCRIM = 'rgba(32,30,29,0.55)';

/** Both burden scales read the same way, so they are labelled the same way. */
const SCALES = [
  { key: 'stress', label: 'Stress', low: 'Calm', high: 'Frayed' },
  { key: 'soreness', label: 'Soreness', low: 'Fresh', high: 'Wrecked' },
  { key: 'motivation', label: 'Motivation', low: 'Flat', high: 'Keen' },
] as const;

/**
 * Symptoms the athlete can report, and the only place the app collects them.
 *
 * These are matched by the engine as lowercase substrings (`SEVERE_SYMPTOMS` in
 * guardrails.ts), so the labels are worded to contain the terms it looks for —
 * "chest", "dizz", "bleeding", "pelvic pressure", "shortness of breath",
 * "severe pain". Every one of these stops the hard-training flow outright;
 * "Something hurts" is the softer report, which lowers recovery rather than
 * ending the day.
 *
 * The app does not assess any of them. What it does is refuse to program
 * through them, and say so.
 */
const SYMPTOMS = [
  'Something hurts',
  'Chest pain or pressure',
  'Dizziness or feeling faint',
  'Shortness of breath',
  'Bleeding',
  'Pelvic pressure or leaking',
] as const;

/** Hours the ruler spans. Beyond ten is not a training problem. */
const RULER_HOURS = 10;

/** Editorial numbering, so five stacked questions have a rhythm. */
function Section({ index, label, hint, children }: {
  index: string; label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <View style={{ paddingTop: 22 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'baseline', gap: 8,
        paddingHorizontal: space.gutter, paddingBottom: 8,
      }}>
        <Text style={[t.labelXs, { color: color.red, letterSpacing: 0.96 }]}>{index}</Text>
        <Label>{label}</Label>
        {hint ? (
          <Text style={[t.meta, { color: color.muted3, marginLeft: 'auto' }]}>{hint}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * The night, placed against the rule that matters. Each segment is an hour; the
 * marker sits at five, where the engine starts capping intensity — so the
 * athlete can see which side of it they are on without reading a number.
 */
function SleepRuler({ hours, answered }: { hours: number; answered: boolean }) {
  const low = hours < LOW_SLEEP_HOURS;
  return (
    <View style={{ paddingTop: 14 }}>
      <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 26 }}>
        {Array.from({ length: RULER_HOURS }, (_, i) => {
          const filled = answered && i < Math.round(hours);
          const isThreshold = i === LOW_SLEEP_HOURS - 1;
          return (
            <View key={i} style={{ flex: 1, gap: 3 }}>
              <View style={{
                height: isThreshold ? 22 : 14,
                backgroundColor: filled
                  ? (low ? color.red : color.onDark)
                  : color.ruleDark,
              }} />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 3, paddingTop: 5 }}>
        {Array.from({ length: RULER_HOURS }, (_, i) => (
          <View key={i} style={{ flex: 1 }}>
            <Text style={[t.labelXs, {
              fontSize: 7,
              color: i === LOW_SLEEP_HOURS - 1 ? color.salmon : 'transparent',
            }]}>
              5H
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A −/+ pair around a value. 44pt targets, per §8.1. */
function Stepper({ label, value, onChange, min, max, step, format }: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number; max: number; step: number;
  format: (v: number) => string;
}) {
  const button = (delta: number, symbol: string, enabled: boolean) => (
    <Pressable
      onPress={() => { if (!enabled) return; Haptics.selectionAsync(); onChange(value + delta); }}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? 'Increase' : 'Decrease'} ${label}`}
      style={({ pressed }) => ({
        width: 52, height: 46, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: enabled ? color.ruleDark2 : color.ruleDark,
        backgroundColor: pressed && enabled ? color.inkPressed : 'transparent',
      })}
    >
      <Text style={{
        fontFamily: t.statValue.fontFamily, fontSize: 20,
        color: enabled ? color.onDark : color.ruleDark2,
      }}>
        {symbol}
      </Text>
    </Pressable>
  );

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 9,
    }}>
      <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.08 }}>{label}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {button(-step, '−', value - step >= min)}
        <Text
          style={[t.h4, { fontSize: 20, minWidth: 48, textAlign: 'center', color: color.onDark }]}
          accessibilityLabel={`${label} ${format(value)}`}
        >
          {format(value)}
        </Text>
        {button(step, '+', value + step <= max)}
      </View>
    </View>
  );
}

/**
 * A 1–5 scale as a stepped bar rather than five identical chips: the shape says
 * "level" before the number does, and the selected bar takes the accent so the
 * answer is unmistakable. Each bar carries a full-height target above it, so the
 * touch area is 44pt even though the bar is 12.
 */
function LevelBars({ value, onSelect, label }: {
  value: number | null; onSelect: (n: number | null) => void; label: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
      {[1, 2, 3, 4, 5].map(n => {
        const filled = value !== null && n <= value;
        const selected = value === n;
        return (
          <Pressable
            key={n}
            onPress={() => { Haptics.selectionAsync(); onSelect(value === n ? null : n); }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label} ${n} of 5`}
            style={({ pressed }) => ({
              flex: 1, height: 72, justifyContent: 'flex-end',
              backgroundColor: pressed ? color.hover : 'transparent',
            })}
          >
            <Text style={[t.labelXs, {
              textAlign: 'center', paddingBottom: 6,
              color: selected ? color.red : filled ? color.ink : color.muted3,
            }]}>
              {n}
            </Text>
            <View style={{
              height: 10 + n * 8,
              backgroundColor: selected ? color.red : filled ? color.ink : color.rule,
            }} />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function CheckinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, commitCheckin } = useApp();

  const existing = state.checkin ?? EMPTY_CHECKIN;
  const seeded = fromDecimalHours(existing.sleep_hours);
  const [hours, setHours] = useState(seeded.hours);
  const [minutes, setMinutes] = useState(seeded.minutes);
  // Sleep counts only once the athlete has touched it, so an untouched form
  // does not record the default as an answer.
  const [sleepAnswered, setSleepAnswered] = useState(existing.sleep_hours !== null);
  const [energy, setEnergy] = useState<Checkin['energy']>(existing.energy);
  const [scales, setScales] = useState<Record<string, number | null>>({
    stress: existing.stress, soreness: existing.soreness, motivation: existing.motivation,
  });
  const [symptoms, setSymptoms] = useState<string[]>(existing.symptoms ?? []);

  const sleepDecimal = sleepAnswered ? toDecimalHours(hours, minutes) : null;
  const lowSleep = sleepDecimal !== null && sleepDecimal < LOW_SLEEP_HOURS;

  const draft: Checkin = {
    sleep_hours: sleepDecimal,
    energy,
    stress: scales.stress ?? null,
    soreness: scales.soreness ?? null,
    motivation: scales.motivation ?? null,
    symptoms,
  };
  // Symptoms are excluded from the count: the five squares track the recovery
  // questions, and reporting nothing wrong is not a missing answer.
  const answers = [draft.sleep_hours, draft.energy, draft.stress, draft.soreness,
    draft.motivation].filter(v => v !== null).length;
  const severe = symptoms.some(s => s !== 'Something hurts');

  // The same function the server scores with, run here so the athlete sees the
  // consequence while answering rather than after saving.
  const signal = recoverySignal(draft);
  const band = signal === null ? null
    : signal >= 0.66 ? 'Good' : signal >= 0.4 ? 'Moderate' : 'Low';

  const save = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    commitCheckin(draft);
    router.back();
  };

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      {/* Tapping away closes without saving, and the dim keeps Today visible
          behind — the athlete is adding to that screen, not leaving it. */}
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={{ flex: 1, backgroundColor: SCRIM }}
      />
      <View style={{
        maxHeight: '88%', backgroundColor: color.paper,
        borderTopWidth: 2, borderTopColor: color.ink,
      }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingVertical: 12,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={[t.eyebrow, { fontSize: 11, letterSpacing: 1.54, color: color.ink }]}>
            Recovery check-in
          </Text>
          <Text style={[t.meta, { color: color.muted, marginTop: 2 }]}>
            Answer what you know. Skipping a question is fine.
          </Text>
        </View>
        {/* Answered count as filled squares — the same mark the Plan screen
            uses for a completed stimulus. */}
        <View style={{ flexDirection: 'row', gap: 4, marginRight: 12 }}>
          {[0, 1, 2, 3, 4].map(i => <SquareCheck key={i} on={i < answers} size={8} />)}
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close without saving"
          hitSlop={10}
          style={({ pressed }) => ({
            width: 32, height: 32, borderWidth: 1, borderColor: color.ink,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? color.hover : 'transparent',
          })}
        >
          <Text style={{ fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.ink }}>✕</Text>
        </Pressable>
      </View>
      <Rule heavy />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {/* Sleep carries the ink treatment: it is the only answer here the
            engine reads as a number, and the only one that can shorten today. */}
        <View style={{ backgroundColor: color.ink, paddingHorizontal: space.gutter, paddingVertical: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={[t.labelXs, { color: color.red, letterSpacing: 0.96 }]}>01</Text>
            <Label tone="salmon" size="sm" style={{ letterSpacing: 1.26 }}>Sleep</Label>
            {sleepAnswered ? (
              <Pressable
                onPress={() => setSleepAnswered(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear sleep"
                style={{ marginLeft: 'auto' }}
              >
                <Text style={[t.meta, { color: color.muted3 }]}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 6 }}>
            <Text style={[t.countdown, {
              fontSize: 52, lineHeight: 52, paddingRight: 3,
              color: !sleepAnswered ? color.ruleDark2 : lowSleep ? color.red : color.onDark,
            }]}>
              {sleepAnswered ? hoursToClock(sleepDecimal) : '--:--'}
            </Text>
            <Text style={[t.bodySm, {
              paddingBottom: 8, flex: 1,
              color: lowSleep ? color.salmon : color.muted3,
            }]}>
              {!sleepAnswered ? 'Not logged yet'
                : lowSleep ? 'Under 5h — today’s intensity is capped'
                : 'Hours slept last night'}
            </Text>
          </View>

          <SleepRuler hours={sleepDecimal ?? 0} answered={sleepAnswered} />

          <View style={{ height: 1, backgroundColor: color.ruleDark, marginTop: 16 }} />
          <Stepper
            label="Hours" value={hours} min={0} max={14} step={1}
            format={v => String(v)}
            onChange={next => { setHours(next); setSleepAnswered(true); }}
          />
          <View style={{ height: 1, backgroundColor: color.ruleDark }} />
          <Stepper
            label="Minutes" value={minutes} min={0} max={45} step={15}
            format={v => v.toString().padStart(2, '0')}
            onChange={next => { setMinutes(next); setSleepAnswered(true); }}
          />
        </View>

        <Section index="02" label="Energy" hint="How you feel right now">
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
            {ENERGY.map(value => (
              <Chip
                key={value} flex size="sm" label={value.toUpperCase()}
                active={energy === value}
                onPress={() => { Haptics.selectionAsync(); setEnergy(energy === value ? null : value); }}
                style={{ paddingVertical: 16 }}
              />
            ))}
          </View>
        </Section>

        {SCALES.map((scale, i) => (
          <Section
            key={scale.key}
            index={`0${i + 3}`}
            label={scale.label}
            hint={`${scale.low} → ${scale.high}`}
          >
            <LevelBars
              label={scale.label}
              value={scales[scale.key] ?? null}
              onSelect={n => setScales(prev => ({ ...prev, [scale.key]: n }))}
            />
          </Section>
        ))}

        {/* The safety question, last because it is the one that overrides the
            rest: anything reported here decides the day regardless of how well
            the athlete slept. */}
        <Section
          index="06"
          label="Anything wrong"
          hint="Only if it applies — most days this is empty"
        >
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: 6,
            paddingHorizontal: space.gutter,
          }}>
            {SYMPTOMS.map(name => (
              <Chip
                key={name}
                label={name}
                size="sm"
                active={symptoms.includes(name)}
                onPress={() => setSymptoms(prev => prev.includes(name)
                  ? prev.filter(s => s !== name)
                  : [...prev, name])}
                style={{ paddingVertical: 12 }}
              />
            ))}
          </View>
          {severe ? (
            <View style={{
              marginHorizontal: space.gutter, marginTop: 12,
              backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
              paddingHorizontal: 13, paddingVertical: 12,
            }}>
              <Label tone="redDark" size="sm" style={{ marginBottom: 4 }}>No session today</Label>
              <Text style={[t.bodySm, { color: color.redDeep }]}>
                Training through this is not something I can program around, so today
                becomes rest and your week stays intact. If it persists or worsens,
                please get it looked at — I am not able to assess symptoms.
              </Text>
            </View>
          ) : (
            <Text style={[t.meta, {
              paddingHorizontal: space.gutter, paddingTop: 10, color: color.muted,
            }]}>
              Kept with today's check-in and read by tomorrow's session too. Private,
              like the rest of your considerations.
            </Text>
          )}
        </Section>

        {/* What the answers did — the same courtesy the completion screen pays
            an RPE ("shapes tomorrow's load"), computed from the real function. */}
        <View style={{ paddingHorizontal: space.gutter, paddingTop: 26 }}>
          <Rule heavy />
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 14, paddingBottom: 10,
          }}>
            <Label>Recovery signal</Label>
            <Text style={[t.rowTitle, {
              fontFamily: t.eyebrow.fontFamily, fontSize: 13,
              color: band === null ? color.muted3 : band === 'Low' ? color.red : color.ink,
            }]}>
              {band ?? 'Not enough answers'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <View key={i} style={{
                flex: 1,
                backgroundColor: signal !== null && i < Math.round(signal * 10)
                  ? (band === 'Low' ? color.red : color.ink)
                  : color.rule,
              }} />
            ))}
          </View>
          <Text style={[t.bodySm, { color: color.muted2, paddingTop: 12 }]}>
            {answers === 0
              ? 'Answer at least one question to save. Nothing here is required.'
              : `${answers} of 5 answered${lowSleep
                  ? ' · under five hours, so today’s session will come back shorter'
                  : ' · today’s recommendation is recalculated from this'}.`}
          </Text>
        </View>

        <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
          <ActionButton
            label={answers ? 'Save check-in' : 'Nothing to save yet'}
            onPress={answers ? save : () => {}}
            variant={answers ? 'primary' : 'outline'}
            arrow={answers ? '→' : null}
            style={{ paddingVertical: 18, opacity: answers ? 1 : 0.45 }}
          />
        </View>
      </ScrollView>
      </View>
    </View>
  );
}
