/**
 * D02 Goal selection — sport and primary outcome (PRD §6.1 step 2, §8.2).
 *
 * MVP prioritises HYROX. The general option runs the same library rather than
 * a thinner one — it is a different description of the athlete, not a different
 * plan — so a beta athlete who does not race is not stopped at step one by a
 * sport they do not compete in.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, ChipRow } from '@/components/onboarding';
import { Label } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding, type Goal, type Sport } from '@/state/onboarding';

const SPORTS: { value: Sport; label: string; detail: string }[] = [
  {
    value: 'hyrox',
    label: 'HYROX',
    detail: 'Built around the eight stations and the runs between them. This is what the plan '
      + 'library does best.',
  },
  {
    value: 'hybrid',
    label: 'General hybrid fitness',
    detail: 'Strength and engine on one plan, with no entry assumed. It is built from the same '
      + 'HYROX library — running, sled and compromised strength — so expect that shape of week. '
      + 'Dedicated running and triathlon plans are still on the way.',
  },
];

const GOALS: { value: Goal; label: string; detail: string }[] = [
  {
    value: 'finish_healthy',
    label: 'Finish healthy',
    detail: 'Cross the line feeling strong. Training builds you up steadily rather than chasing the clock.',
  },
  {
    value: 'performance',
    label: 'Performance',
    detail: 'Going after a time or a placing. Expect harder sessions and sharper race-day work.',
  },
  {
    value: 'custom',
    label: 'Something else',
    detail: 'Tell us your goal in your own words. Until you do, we keep training steady and safe.',
  },
];

export default function GoalScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();

  const selectedSport = SPORTS.find(s => s.value === draft.sport);
  const selected = GOALS.find(g => g.value === draft.goal_type);

  return (
    <OnboardingStep
      step={1}
      title="What are you training for?"
      description="Your answer decides how much of your training is general fitness versus race-day practice."
      onContinue={() => router.push('/race' as never)}
    >
      <ChipRow
        label="Sport"
        options={SPORTS.map(s => ({ value: s.value, label: s.label }))}
        value={draft.sport}
        onChange={sport => update({ sport })}
      />
      {selectedSport ? (
        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, color: color.muted, paddingBottom: 24, marginTop: -12,
        }]}>
          {selectedSport.detail}
        </Text>
      ) : null}

      <ChipRow
        label="Primary outcome"
        options={GOALS.map(g => ({ value: g.value, label: g.label }))}
        value={draft.goal_type}
        onChange={goal_type => update({ goal_type })}
      />

      {selected ? (
        <View style={{
          marginHorizontal: space.gutter,
          borderWidth: 1, borderColor: color.rule,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Label tone="ink" size="sm" style={{ paddingBottom: 6 }}>{selected.label}</Label>
          <Text style={[t.bodySm, { color: color.muted2 }]}>{selected.detail}</Text>
        </View>
      ) : null}
    </OnboardingStep>
  );
}
