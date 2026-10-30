/**
 * D04 Capacity — what this athlete can absorb, and how technical a session they
 * can perform well (PRD §6.1 step 4).
 *
 * ── Why these two questions and not the two that were here ────────────────
 *
 * This screen used to ask about race experience and training age, and neither
 * ever reached the planner: they were not sent to the server, the engine had no
 * field to receive them, and no template carried anything to match them
 * against. A beta athlete who answered "new to race training" got a week
 * byte-identical to a seasoned racer's.
 *
 * Wiring those two up would not have been enough, because both were the wrong
 * question. They measured race *history*, and history is a poor proxy for
 * either thing the planner needs to know. Someone with eight years under a
 * barbell and no race entries has a large capacity for work and no
 * race-specific skill; "beginner" and "advanced" are each half right about them
 * and wholly wrong as an instruction.
 *
 * So the two questions are asked directly, and kept apart all the way down:
 *
 *   load_capacity       how much training this athlete can absorb
 *   technical_capacity  how complex a movement they can perform well
 *
 * Capacity describes the athlete. A template's `load_demand` and
 * `technical_demand` describe the workout. The pair is the match, and they are
 * never collapsed into one "level" — a single number cannot express the athlete
 * above, which is the most common athlete we have.
 *
 * Both are priors. They are the athlete's own estimate, taken at the one moment
 * we have nothing better, and shaped to be refined by observed performance
 * later rather than treated as settled fact.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, ChipRow, MultiChipRow } from '@/components/onboarding';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding } from '@/state/onboarding';
import {
  CONSIDERATION_CHOICES, LOAD_CAPACITY_CHOICES, TECHNICAL_CAPACITY_CHOICES,
} from '@/data/profile';

/** The chosen option's own sentence, so a four-way choice is not four labels. */
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
      description="These two size your training. They are a starting point, not a verdict. The plan adjusts as it sees what you actually do."
      onBack={() => router.back()}
      onContinue={() => router.push('/equipment' as never)}
    >
      <ChipRow
        label="How would you describe your fitness right now?"
        options={LOAD_CAPACITY_CHOICES.map(o => ({ value: o.value, label: o.label }))}
        value={draft.load_capacity}
        onChange={load_capacity => update({ load_capacity })}
        columns={2}
      />
      <Detail options={LOAD_CAPACITY_CHOICES} value={draft.load_capacity} />

      <ChipRow
        label="How experienced are you with structured performance training?"
        options={TECHNICAL_CAPACITY_CHOICES.map(o => ({ value: o.value, label: o.label }))}
        value={draft.technical_capacity}
        onChange={technical_capacity => update({ technical_capacity })}
        columns={2}
      />
      <Detail options={TECHNICAL_CAPACITY_CHOICES} value={draft.technical_capacity} />

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
          These constrain programming only. They are never shown in feeds, shared, or used for
          recommendations outside your plan. You can change them any time on Profile.
        </Text>
      </View>
    </OnboardingStep>
  );
}
