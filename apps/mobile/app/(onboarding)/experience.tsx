/**
 * D04 Experience baseline — history and current capacity (PRD §6.1 step 4).
 *
 * Only the fields the engine actually reads are asked for. The PRD also lists
 * run capacity and working strength loads; those feed readiness rather than
 * selection, and asking for numbers an athlete has to guess at would put
 * invented precision into the plan.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, ChipRow, MultiChipRow } from '@/components/onboarding';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding } from '@/state/onboarding';
import { CONSIDERATION_CHOICES } from '@/data/athlete';

const LEVELS = [
  { value: 'beginner' as const, label: 'New to this' },
  { value: 'intermediate' as const, label: 'Some racing' },
  { value: 'advanced' as const, label: 'Experienced' },
];

const TRAINING_AGE = [
  { value: 1, label: 'Under 1 yr' },
  { value: 2, label: '1–3 yrs' },
  { value: 5, label: '3–7 yrs' },
  { value: 10, label: '7 yrs +' },
];

export default function ExperienceScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();

  function toggleConsideration(v: string) {
    update({
      considerations: draft.considerations.includes(v)
        ? draft.considerations.filter(c => c !== v)
        : [...draft.considerations, v],
    });
  }

  return (
    <OnboardingStep
      step={3}
      title="Where are you starting from?"
      description="This shapes how aggressively the plan progresses, not whether you are worth programming for."
      onBack={() => router.back()}
      onContinue={() => router.push('/equipment' as never)}
    >
      <ChipRow
        label="Race experience"
        options={LEVELS}
        value={draft.experience_level}
        onChange={experience_level => update({ experience_level })}
      />

      <ChipRow
        label="Training age"
        options={TRAINING_AGE}
        value={draft.training_age_years}
        onChange={training_age_years => update({ training_age_years })}
      />

      <MultiChipRow
        label="Anything to train around?"
        options={CONSIDERATION_CHOICES.map(c => ({ value: c, label: c }))}
        values={draft.considerations}
        onToggle={toggleConsideration}
      />

      <View style={{
        marginHorizontal: space.gutter,
        borderWidth: 1, borderColor: color.rule,
        paddingHorizontal: 13, paddingVertical: 12,
      }}>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          These constrain programming only — they are never shown in feeds, shared, or used for
          recommendations outside your plan. You can change them any time on Profile.
        </Text>
      </View>
    </OnboardingStep>
  );
}
