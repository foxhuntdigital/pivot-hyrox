/**
 * D03 Race setup — date, division, goal (PRD §6.1 step 3, §8.2).
 *
 * A plan needs a runway, and there are two ways to have one. An athlete with an
 * entry gets phases counted back from the date, which is what the PRD describes.
 * An athlete with no entry picks a number of weeks instead and gets the same
 * progression counted forward, minus the taper and race week — there is nothing
 * to taper for.
 *
 * The one thing not on offer is a plan with no end. Every phase length in this
 * program is a proportion of the runway, so "keep going indefinitely" is not a
 * longer plan, it is the absence of one.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, ChipRow, DateChooser } from '@/components/onboarding';
import { Label } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding, type PlanMode } from '@/state/onboarding';
import { localToday } from '@/lib/format';

/** HYROX divisions as the athlete describes their own entry, not as seeded. */
const DIVISIONS = [
  { value: 'open', label: 'Open' },
  { value: 'pro', label: 'Pro' },
  { value: 'doubles', label: 'Doubles' },
  { value: 'relay', label: 'Relay' },
];

const MODES: { value: PlanMode; label: string }[] = [
  { value: 'race', label: "I have a race" },
  { value: 'block', label: 'No race yet' },
];

/**
 * Block lengths on offer. Short enough at the bottom that every phase still
 * gets a week, long enough at the top to be a real build — and all of them
 * finite, which is the point.
 */
const BLOCK_LENGTHS = [6, 8, 10, 12, 16, 20].map(weeks => ({
  value: weeks, label: `${weeks} weeks`,
}));



function weeksBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(1, Math.ceil((Math.round(ms / 86_400_000) + 1) / 7));
}

/** The tinted note under the inputs, saying what the runway buys. */
function Runway({ title, children }: { title: string; children: string }) {
  return (
    <View style={{
      marginHorizontal: space.gutter,
      backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
      paddingHorizontal: 13, paddingVertical: 12,
    }}>
      <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>{title}</Label>
      <Text style={[t.bodySm, { color: color.redDeep }]}>{children}</Text>
    </View>
  );
}

export default function RaceScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();
  const [today] = useState(localToday);

  const isRace = draft.plan_mode === 'race';

  const runway = useMemo(
    () => (draft.event_date ? weeksBetween(today, draft.event_date) : null),
    [draft.event_date, today],
  );

  const inPast = draft.event_date != null && draft.event_date < today;

  return (
    <OnboardingStep
      step={2}
      title={isRace ? 'When is the race?' : 'How long is this block?'}
      description={isRace
        ? 'Every phase is counted back from this date, so it is the one answer worth getting right.'
        : 'Training without an entry still needs an end, because every phase is a share of the whole. Pick a length and the same progression is built inside it.'}
      onBack={() => router.back()}
      onContinue={() => router.push('/experience' as never)}
      canContinue={isRace ? draft.event_date != null && !inPast : true}
      error={isRace && inPast ? 'That date has already passed. Pick a future race date.' : null}
    >
      <ChipRow
        label="What are you training for?"
        options={MODES}
        value={draft.plan_mode}
        onChange={plan_mode => update({ plan_mode })}
        columns
      />

      {isRace ? (
        <>
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
            <Runway title={`${runway} week${runway === 1 ? '' : 's'} to build`}>
              {runway >= 6
                ? 'Enough runway for a full progression through foundation, build, specific work, a peak and a taper.'
                : 'A short runway. The plan will start at race-specific work and taper rather than pretend there is time to build a base.'}
            </Runway>
          ) : null}
        </>
      ) : (
        <>
          <ChipRow
            label="Program length"
            options={BLOCK_LENGTHS}
            value={draft.block_weeks}
            onChange={block_weeks => update({ block_weeks })}
          />

          <Runway title={`${draft.block_weeks} weeks to build`}>
            {'Foundation, build, specific work and a peak — the same progression a '
            + 'race plan runs, without the taper and race week. Add a race any time '
            + 'on Profile and the weeks ahead are rebuilt around the date.'}
          </Runway>
        </>
      )}
    </OnboardingStep>
  );
}
