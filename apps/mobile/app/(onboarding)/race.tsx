/**
 * D03 Race setup — date, division, goal (PRD §6.1 step 3, §8.2).
 *
 * The race date is the single input the whole plan is derived from: every phase
 * boundary is counted back from it. It is the only required answer in the flow.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, ChipRow, DateChooser } from '@/components/onboarding';
import { Label } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding } from '@/state/onboarding';

/** HYROX divisions as the athlete describes their own entry, not as seeded. */
const DIVISIONS = [
  { value: 'open', label: 'Open' },
  { value: 'pro', label: 'Pro' },
  { value: 'doubles', label: 'Doubles' },
  { value: 'relay', label: 'Relay' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function weeksBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(1, Math.ceil((Math.round(ms / 86_400_000) + 1) / 7));
}

export default function RaceScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();
  const [today] = useState(todayISO);

  const runway = useMemo(
    () => (draft.event_date ? weeksBetween(today, draft.event_date) : null),
    [draft.event_date, today],
  );

  const inPast = draft.event_date != null && draft.event_date < today;

  return (
    <OnboardingStep
      step={2}
      title="When is the race?"
      description="Every phase is counted back from this date, so it is the one answer worth getting right."
      onBack={() => router.back()}
      onContinue={() => router.push('/experience' as never)}
      canContinue={draft.event_date != null && !inPast}
      error={inPast ? 'That date has already passed. Pick a future race date.' : null}
    >
      <View style={{ paddingHorizontal: space.gutter, paddingBottom: 20 }}>
        <Label tone="ink" style={{ marginBottom: 7 }}>Event name</Label>
        <TextInput
          value={draft.event_name}
          onChangeText={event_name => update({ event_name })}
          placeholder="Boston HYROX"
          placeholderTextColor={color.muted3}
          style={{
            borderWidth: 1, borderColor: color.chipBorder,
            paddingHorizontal: 13, paddingVertical: 14,
            fontFamily: t.rowTitle.fontFamily, fontSize: 14, color: color.ink,
          }}
        />
      </View>

      <DateChooser
        value={draft.event_date}
        onChange={event_date => update({ event_date })}
        minDate={today}
      />

      <ChipRow
        label="Division"
        options={DIVISIONS}
        value={draft.division}
        onChange={division => update({ division })}
      />

      {runway != null && !inPast ? (
        <View style={{
          marginHorizontal: space.gutter,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>
            {`${runway} week${runway === 1 ? '' : 's'} to build`}
          </Label>
          <Text style={[t.bodySm, { color: color.redDeep }]}>
            {runway >= 6
              ? 'Enough runway for a full progression through foundation, build, specific work, a peak and a taper.'
              : 'A short runway. The plan will start at race-specific work and taper rather than pretend there is time to build a base.'}
          </Text>
        </View>
      ) : null}
    </OnboardingStep>
  );
}
