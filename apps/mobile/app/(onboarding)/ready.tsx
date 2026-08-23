/**
 * D08 Plan ready — initial phase and first-week summary (PRD §6.1 step 9).
 *
 * The plan is generated here rather than earlier: this is the first point where
 * every answer exists, and generating on entry would write a program the
 * athlete might still back out of. The summary rendered is whatever the server
 * returned, so what is shown is what was actually stored.
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep } from '@/components/onboarding';
import { Label, Rule } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding } from '@/state/onboarding';
import type { PlanSummary } from '@/data/planRepo';

const PHASE_LABEL: Record<string, string> = {
  foundation: 'Foundation',
  build: 'Build',
  specific: 'Specific',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race',
};

/** `aerobic_durability` reads as a column heading, not as something to do. */
function stimulusLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export default function ReadyScreen() {
  const router = useRouter();
  const { draft, submit } = useOnboarding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanSummary | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setPlan(await submit());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your plan.');
    } finally {
      setBusy(false);
    }
  }

  if (!plan) {
    return (
      <OnboardingStep
        step={7}
        title="Ready to build your plan"
        description="Everything below can be changed later on Profile. Changing the race date rebuilds the weeks ahead and leaves completed training untouched."
        onBack={() => router.back()}
        onContinue={generate}
        continueLabel="Build my plan"
        busy={busy}
        error={error}
      >
        <Summary
          rows={[
            ['Race', draft.event_name.trim() || 'My race'],
            ['Date', draft.event_date ?? '—'],
            ['Division', draft.division ?? 'Not set'],
            ['Goal', draft.goal_type.replace(/_/g, ' ')],
            ['Experience', draft.experience_level],
            ['Session length', `${draft.typical_session_minutes} min`],
            ['Equipment', `${draft.equipment.length} selected`],
            ['Training around', draft.considerations.length
              ? draft.considerations.join(', ') : 'Nothing noted'],
          ]}
        />
      </OnboardingStep>
    );
  }

  return (
    <OnboardingStep
      step={7}
      title="Your plan is ready"
      description={`${plan.total_weeks} week${plan.total_weeks === 1 ? '' : 's'} to ${plan.race.event_name}.`}
      onContinue={() => router.replace('/today' as never)}
      continueLabel="Go to today"
    >
      {plan.current_phase ? (
        <View style={{
          marginHorizontal: space.gutter, marginBottom: 22,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 14,
        }}>
          <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>Starting phase</Label>
          <Text style={[t.h3, { color: color.ink, paddingBottom: 4 }]}>
            {PHASE_LABEL[plan.current_phase.phase_type] ?? plan.current_phase.phase_type}
          </Text>
          <Text style={[t.bodySm, { color: color.redDeep }]}>
            {`Week ${plan.current_phase.week} of ${plan.current_phase.total_weeks} in this phase.`}
          </Text>
        </View>
      ) : null}

      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingBottom: 10 }}>
        This week asks for
      </Label>
      <Summary
        rows={plan.first_week_stimuli.map(s => [
          stimulusLabel(s.stimulus_type),
          `${s.target_exposures}×`,
        ])}
      />

      <Label tone="ink" style={{
        paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 10,
      }}>
        The shape of it
      </Label>
      <Summary
        rows={plan.phases.map(p => [
          PHASE_LABEL[p.phase_type] ?? p.phase_type,
          `${p.weeks} week${p.weeks === 1 ? '' : 's'}`,
        ])}
      />
    </OnboardingStep>
  );
}

/** Key/value rows on hairline separators — the app's standard list idiom. */
function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <View>
      <Rule faint />
      {rows.map(([k, v]) => (
        <View key={k}>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: space.gutter, paddingVertical: 13,
          }}>
            <Text style={[t.bodySm, { color: color.muted2 }]}>{k}</Text>
            <Text style={[t.rowTitle, { color: color.ink, textTransform: 'capitalize' }]}>{v}</Text>
          </View>
          <Rule faint />
        </View>
      ))}
    </View>
  );
}
