/**
 * D02 Goal selection — sport and primary outcome (PRD §6.1 step 2, §8.2).
 *
 * MVP prioritises HYROX. The other sports are shown but inert rather than
 * hidden, so the athlete can see where this is going without being offered a
 * plan the content library cannot build.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, ChipRow } from '@/components/onboarding';
import { Label } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding, type Goal } from '@/state/onboarding';

const GOALS: { value: Goal; label: string; detail: string }[] = [
  {
    value: 'finish_healthy',
    label: 'Finish healthy',
    detail: 'Complete the race well, with training that protects capacity over chasing a time.',
  },
  {
    value: 'performance',
    label: 'Performance',
    detail: 'Train for a time or placing, accepting the higher intensity that requires.',
  },
  {
    value: 'custom',
    label: 'Something else',
    detail: 'You will describe the goal yourself. Programming stays conservative until you do.',
  },
];

export default function GoalScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();

  const selected = GOALS.find(g => g.value === draft.goal_type);

  return (
    <OnboardingStep
      step={1}
      title="What are you training for?"
      description="This sets how the plan balances building capacity against race-specific work."
      onContinue={() => router.push('/race' as never)}
    >
      <ChipRow
        label="Sport"
        options={[{ value: 'hyrox', label: 'HYROX' }]}
        value={draft.sport}
        onChange={sport => update({ sport })}
      />
      <Text style={[t.bodySm, {
        paddingHorizontal: space.gutter, color: color.muted, paddingBottom: 24, marginTop: -12,
      }]}>
        Running, triathlon and hybrid programming come later. HYROX is the only library built out
        today, and offering the others would be offering a plan we cannot yet write.
      </Text>

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
