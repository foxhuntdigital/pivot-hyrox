/**
 * The two capacity questions, asked of an athlete who already has a plan.
 *
 * Onboarding asks these as step four. This is the same two questions for
 * everyone who onboarded before they existed — they carry a null capacity, so
 * they are getting the base week whether or not it suits them, and nothing on
 * their screen says so.
 *
 * It is a screen rather than a route gate on purpose. Trapping an athlete
 * behind a questionnaire to reach a plan they already have would be a worse
 * failure than the one being fixed, and a null capacity is safe: it means "not
 * known", every rule ignores it, and the plan they have today is the plan they
 * keep until they answer.
 *
 * Answering re-sizes the weeks they have not started. That is the whole point —
 * a question whose answer changes nothing is the thing this project exists to
 * stop shipping.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label } from '@/components/primitives';
import { ChipRow } from '@/components/onboarding';
import { saveCapacity } from '@/data/profileRepo';
import { useApp } from '@/state/store';

const FITNESS = [
  { value: 1, label: 'Beginner', detail: "I'm building or rebuilding my fitness base." },
  { value: 2, label: 'Intermediate', detail: 'I train consistently and handle challenging workouts comfortably.' },
  { value: 3, label: 'Advanced', detail: 'I have a strong fitness base and regularly train hard.' },
  { value: 4, label: 'Competitive', detail: 'I train seriously for performance and competition.' },
];

const TECHNICAL = [
  { value: 1, label: 'New to it', detail: "I'm still learning how to train for performance." },
  { value: 2, label: 'Some experience', detail: 'I’m comfortable with common strength, conditioning and endurance workouts.' },
  { value: 3, label: 'Experienced', detail: 'I’ve trained seriously across strength and/or endurance for several years.' },
  { value: 4, label: 'Highly experienced', detail: 'I’m comfortable with advanced programming, technical movements and demanding training.' },
];

function Detail({ options, value }: {
  options: { value: number; label: string; detail: string }[];
  value: number | null;
}) {
  const chosen = options.find(o => o.value === value);
  if (!chosen) return null;
  return (
    <Text style={[t.bodySm, {
      paddingHorizontal: space.gutter, color: color.muted, paddingBottom: 24, marginTop: -12,
    }]}>
      {chosen.detail}
    </Text>
  );
}

export default function CapacityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, commitProfile, refreshToday } = useApp();

  const [load, setLoad] = useState<number | null>(state.profile.load_capacity);
  const [technical, setTechnical] = useState<number | null>(state.profile.technical_capacity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = load != null && technical != null;

  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveCapacity(load!, technical!);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Local state first so Profile reflects the answer immediately, then a
    // refetch because the weeks ahead have just been rebuilt server-side.
    commitProfile({ load_capacity: load, technical_capacity: technical });
    refreshToday();
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View style={{
        paddingTop: insets.top + 12, paddingBottom: 14, paddingHorizontal: space.gutter,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Label tone="ink">Sizing your training</Label>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Label tone="muted">Not now</Label>
        </Pressable>
      </View>
      <Rule heavy />

      <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: insets.bottom + 30 }}>
        <Text style={[t.h3, { paddingHorizontal: space.gutter, color: color.ink }]}>
          Two questions we didn't ask you
        </Text>
        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 22, color: color.muted2,
        }]}>
          They decide how much training a week holds. Your plan was built before we asked, so
          it is currently sized for the middle. Answering rebuilds the weeks you haven't
          started — this week is left as it is.
        </Text>

        <ChipRow
          label="How would you describe your fitness right now?"
          options={FITNESS.map(o => ({ value: o.value, label: o.label }))}
          value={load}
          onChange={setLoad}
          columns
        />
        <Detail options={FITNESS} value={load} />

        <ChipRow
          label="How experienced are you with structured performance training?"
          options={TECHNICAL.map(o => ({ value: o.value, label: o.label }))}
          value={technical}
          onChange={setTechnical}
          columns
        />
        <Detail options={TECHNICAL} value={technical} />

        {error ? (
          <View style={{
            marginHorizontal: space.gutter, marginBottom: 16,
            backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
            paddingHorizontal: 13, paddingVertical: 12,
          }}>
            <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>Not saved</Label>
            <Text style={[t.bodySm, { color: color.redDeep }]}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={!ready || saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || saving }}
          style={({ pressed }) => ({
            marginHorizontal: space.gutter,
            paddingVertical: 18, alignItems: 'center',
            backgroundColor: !ready ? color.chipBorder
              : pressed ? color.redPressed : color.red,
          })}
        >
          {saving
            ? <ActivityIndicator color={color.onDark} />
            : (
              <Text style={[t.button, { color: color.onDark }]}>
                {ready ? 'Rebuild my plan' : 'Answer both to continue'}
              </Text>
            )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
