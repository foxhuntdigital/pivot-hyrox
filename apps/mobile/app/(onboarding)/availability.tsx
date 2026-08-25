/**
 * D06 Availability — typical time and schedule predictability (PRD §6.1 step 6).
 *
 * Session length and predictability together decide whether the engine leans on
 * Full sessions or pre-generates Express and Micro variants, so this is the
 * screen that decides how the plan behaves on a bad week.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, ChipRow } from '@/components/onboarding';
import { Label } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding } from '@/state/onboarding';
// Shared with the Profile screen, which edits the same column: one list of
// answers means the chip picked here is the chip shown there.
import { PREDICTABILITY_CHOICES, preGeneratesVariants } from '@/data/profile';

/** Mirrors the adapt sheet's time options (PRD §6.3) so the two agree. */
const MINUTES = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min +' },
];

const IMPACT = [
  { value: 'normal' as const, label: 'Running is fine' },
  { value: 'low' as const, label: 'Prefer low impact' },
];

export default function AvailabilityScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();

  return (
    <OnboardingStep
      step={5}
      title="How much time do you have?"
      description="The plan is built around the session you can actually do, not the one you wish you had time for."
      onBack={() => router.back()}
      onContinue={() => router.push('/health' as never)}
    >
      <ChipRow
        label="Typical session"
        options={MINUTES}
        value={draft.typical_session_minutes}
        onChange={typical_session_minutes => update({ typical_session_minutes })}
      />

      <ChipRow
        label="How predictable is your week?"
        options={PREDICTABILITY_CHOICES.map(c => ({ value: c.value, label: c.label }))}
        value={draft.schedule_predictability}
        onChange={schedule_predictability => update({ schedule_predictability })}
      />

      <ChipRow
        label="Impact"
        options={IMPACT}
        value={draft.impact_tolerance}
        onChange={impact_tolerance => update({ impact_tolerance })}
      />

      <View style={{
        marginHorizontal: space.gutter,
        borderWidth: 1, borderColor: color.rule,
        paddingHorizontal: 13, paddingVertical: 12,
      }}>
        <Label tone="ink" size="sm" style={{ paddingBottom: 6 }}>
          {preGeneratesVariants(draft.schedule_predictability)
            ? 'Express and Micro ready' : 'Full sessions first'}
        </Label>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          {preGeneratesVariants(draft.schedule_predictability)
            ? 'Shorter variants are prepared alongside every session, so a compressed day still gets the stimulus rather than being skipped.'
            : 'Full sessions lead, with shorter variants available on demand from the adapt sheet.'}
        </Text>
      </View>
    </OnboardingStep>
  );
}
