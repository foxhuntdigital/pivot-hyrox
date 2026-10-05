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

/**
 * Describes the two questions rather than promising what they do.
 *
 * The line this replaces — "your answer decides how much of your training is
 * general fitness versus race-day practice" — was a precise claim about an
 * input that reaches nothing. `goal_type` is stored on the race, shown back on
 * Today, and read by neither periodization nor the engine, so the screen was
 * describing an effect that does not happen. Overstating a control that does
 * nothing is the exact pattern the beta reports were about, and this one was
 * more specific than the experience questions ever were.
 *
 * If the primary outcome is wired up later, this can promise something again.
 * Until then it says what the two questions are and nothing more.
 */
const DESCRIPTION = "The sport you're training for, and what you want out of it.";

const SPORTS: { value: Sport; label: string; detail: string }[] = [
  {
    value: 'hyrox',
    label: 'HYROX',
    detail: 'Eight stations, eight runs, and the work that holds them together. The plan counts '
      + 'back from your race date.',
  },
  {
    value: 'hybrid',
    label: 'General hybrid fitness',
    /**
     * Deliberately does not name HYROX.
     *
     * The previous version said this was "built from the same HYROX library",
     * which is true and was the wrong thing to say: an athlete who has just
     * declined HYROX is being told they are getting it anyway, and the option
     * reads as a consolation prize rather than a choice. It also leaked the
     * shape of the content library into a question about the athlete.
     *
     * What they are owed is what the training will feel like, which this says
     * plainly — and the running note stays, because someone who picked this
     * while actually wanting a 5K plan should know one is coming. "Triathlon"
     * was carried over from older copy and is gone: nothing has been scoped for
     * it, and a roadmap promise nobody made is worse than no promise at all.
     */
    detail: 'Strength and conditioning on one plan, with no race required. Running, carries, '
      + 'sled work and lifting on tired legs — the same training, just not pointed at a start '
      + 'line. Dedicated running plans are on the way.',
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
      description={DESCRIPTION}
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
