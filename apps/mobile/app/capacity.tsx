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
 * Profile opens the same screen to change an answer, which is why it reads as
 * an edit when both are already set.
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
import { LOAD_CAPACITY_CHOICES, TECHNICAL_CAPACITY_CHOICES } from '@/data/profile';
import { useApp } from '@/state/store';

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

  // Opened from Profile by an athlete who has already answered, this is an
  // edit, not the catch-up prompt Today shows to those who never were asked.
  const [editing] = useState(
    state.profile.load_capacity != null && state.profile.technical_capacity != null);
  const changed = load !== state.profile.load_capacity
    || technical !== state.profile.technical_capacity;
  const ready = load != null && technical != null && (!editing || changed);

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
        <Label tone="ink">{editing ? 'Fitness and experience' : 'Sizing your training'}</Label>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Label tone="muted">{editing ? 'Cancel' : 'Not now'}</Label>
        </Pressable>
      </View>
      <Rule heavy />

      <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: insets.bottom + 30 }}>
        <Text style={[t.h3, { paddingHorizontal: space.gutter, color: color.ink }]}>
          {editing ? 'Fitness and experience' : "Two questions we didn't ask you"}
        </Text>
        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 22, color: color.muted2,
        }]}>
          {editing
            ? 'These decide how much training a week holds. Changing them rebuilds the weeks '
              + "you haven't started. This week is left as it is."
            : 'They decide how much training a week holds. Your plan was built before we asked, '
              + "so it is currently sized for the middle. Answering rebuilds the weeks you haven't "
              + 'started. This week is left as it is.'}
        </Text>

        <ChipRow
          label="How would you describe your fitness right now?"
          options={LOAD_CAPACITY_CHOICES.map(o => ({ value: o.value, label: o.label }))}
          value={load}
          onChange={setLoad}
          columns={2}
        />
        <Detail options={LOAD_CAPACITY_CHOICES} value={load} />

        <ChipRow
          label="How experienced are you with structured performance training?"
          options={TECHNICAL_CAPACITY_CHOICES.map(o => ({ value: o.value, label: o.label }))}
          value={technical}
          onChange={setTechnical}
          columns={2}
        />
        <Detail options={TECHNICAL_CAPACITY_CHOICES} value={technical} />

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
                {ready ? 'Rebuild my plan'
                  : editing ? 'Change an answer to rebuild' : 'Answer both to continue'}
              </Text>
            )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
