/**
 * D07b Preferences — what the athlete enjoys, before the first plan is built.
 *
 * `athlete_preferences` has existed since migration 0013 and the engine has
 * scored it since ENGINE 2.0.0. Until this screen nothing wrote a row, so the
 * `preference` dimension was inert for every athlete and ranked them all
 * identically.
 *
 * Placed last among the questions because it is the only optional one. Goal,
 * race, equipment and health all change what the plan CAN contain; this changes
 * only the order of what it already allows, and an athlete who skips it loses
 * nothing they cannot set later in Profile.
 *
 * Written straight through the repo rather than the app store: onboarding runs
 * before the main store's data is loaded, and the row belongs to the athlete
 * whether or not they finish the flow.
 */
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep } from '@/components/onboarding';
import { Chip, Label, Rule, SquareCheck } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import {
  PREFERENCE_OPTIONS, WEAKNESS_OPTIONS, savePreference, saveWeakness,
  type PreferenceRating, type Preferences,
} from '@/data/preferencesRepo';

/** `neutral` is not a button — it is what no answer means. */
const RATINGS: { key: PreferenceRating; label: string }[] = [
  { key: 'love', label: 'Love it' },
  { key: 'like', label: 'Like it' },
  { key: 'rather_not', label: 'Rather not' },
];

export default function PreferencesScreen() {
  const router = useRouter();
  const [chosen, setChosen] = useState<Preferences>({});
  const [weak, setWeak] = useState<string[]>([]);

  const toggleWeak = (value: string) => {
    const stated = !weak.includes(value);
    setWeak(prev => (stated ? [...prev, value] : prev.filter(v => v !== value)));
    saveWeakness(value, stated).catch(() => {});
  };

  const set = (value: string, rating: PreferenceRating) => {
    const next = chosen[value] === rating ? null : rating;
    setChosen(prev => {
      const out = { ...prev };
      if (next === null) delete out[value];
      else out[value] = next;
      return out;
    });
    // Best-effort, one row at a time. A dropped write costs one answer, and
    // the athlete can set it again in Profile without repeating the flow.
    savePreference(value, next).catch(() => {});
  };

  const stated = Object.keys(chosen).length;

  return (
    <OnboardingStep
      step={7}
      title="What you enjoy, and what needs work"
      description="Two different questions. Neither overrules recovery, your equipment, or what your race needs — they order the sessions your plan already allows."
      onBack={() => router.back()}
      onContinue={() => router.push('/ready' as never)}
      continueLabel={stated || weak.length ? 'Continue' : 'Skip for now'}
    >
      <View style={{ paddingHorizontal: space.gutter }}>
        {PREFERENCE_OPTIONS.map(option => {
          const rating = chosen[option.value];
          return (
            <View
              key={option.value}
              style={{
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderBottomColor: color.ruleFaint,
              }}
            >
              <Text style={{
                fontFamily: t.greeting.fontFamily,
                fontSize: 13.5,
                color: rating ? color.ink : color.muted2,
              }}>
                {option.label}
              </Text>
              <Text style={[t.meta, { fontSize: 11.5, color: color.muted, marginTop: 1 }]}>
                {option.hint}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 9 }}>
                {RATINGS.map(({ key, label }) => (
                  <Chip
                    key={key}
                    flex
                    size="sm"
                    label={label}
                    active={rating === key}
                    accessibilityLabel={`${option.label}: ${label}`}
                    onPress={() => set(option.value, key)}
                  />
                ))}
              </View>
            </View>
          );
        })}

        <Text style={[t.meta, {
          fontSize: 11.5, lineHeight: 17, color: color.muted, marginTop: 12,
        }]}>
          Anything you skip stays neutral, and you can change all of it later.
        </Text>
      </View>

      <Rule faint />

      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 2 }}>
        What do you think needs work?
      </Label>
      <Text style={[t.meta, {
        paddingHorizontal: space.gutter, fontSize: 11.5, lineHeight: 17,
        color: color.muted, paddingBottom: 8,
      }]}>
        Your read on yourself. Kept separate from what your training actually shows —
        when the two disagree, PIVOT keeps both and says so.
      </Text>

      <View style={{ paddingHorizontal: space.gutter }}>
        {WEAKNESS_OPTIONS.map(option => {
          const on = weak.includes(option.value);
          return (
            <Pressable
              key={option.value}
              onPress={() => toggleWeak(option.value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={option.label}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 13,
                borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{
                  fontFamily: t.greeting.fontFamily, fontSize: 13.5,
                  color: on ? color.ink : color.muted2,
                }}>
                  {option.label}
                </Text>
                <Text style={[t.meta, { fontSize: 11.5, color: color.muted, marginTop: 1 }]}>
                  {option.hint}
                </Text>
              </View>
              <SquareCheck on={on} />
            </Pressable>
          );
        })}
      </View>
    </OnboardingStep>
  );
}
