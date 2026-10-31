/**
 * Profile, redesigned (redesign plan, Profile tab).
 *
 * Shows what the athlete has told the app, in plain words: the goal first, as
 * a card with the week strip, then four groups of rows that each say their
 * current value. Every row opens its own edit page (`app/settings/[page]`).
 * Edits that change sessions are drafts there with a save bar that says what
 * will happen; edits that only re-rank save on tap, as before.
 */
import React, { useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { color, space, type as t } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { Chevron } from '@/components/system';
import { phaseTitle } from '@/data/plan';
import { PREFERENCE_OPTIONS, WEAKNESS_OPTIONS } from '@/data/preferencesRepo';
import {
  IMPACT_CHOICES, LOAD_CAPACITY_CHOICES, TECHNICAL_CAPACITY_CHOICES, capacityLabel, descriptorOf,
  initialsOf, nearestPredictability, postpartumPhrase, preGeneratesVariants,
} from '@/data/profile';
import {
  enjoySummary, equipmentSummary, fitnessSummary, healthSummary, lengthSummary, needsWorkSummary,
  trainingSince, weekSummary, weeksUntil,
} from '@/data/profileView';
import { localToday } from '@/lib/format';
import { useProgress } from '@/state/progress';
import { useSession } from '@/state/session';
import { useApp } from '@/state/store';
import { useTour } from '@/state/tour';
import { useEquipmentCatalogue } from '@/state/equipmentCatalogue';
import { ProfileError } from './ProfileError';

const DIVISION: Record<string, string> = { open: 'Open', pro: 'Pro', doubles: 'Doubles', relay: 'Relay' };

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

interface Row { label: string; value: string; onPress: () => void }

export function ProfileView({ footer }: { footer?: React.ReactNode }) {
  const router = useRouter();
  const { state, plan, preferences, weaknesses } = useApp();
  const { email, status } = useSession();
  const tour = useTour();
  const { data } = useProgress();
  const { choices: equipmentChoices } = useEquipmentCatalogue();
  const { profile } = state;
  const now = new Date();

  /** Progress's "You said this needs work" lands on the page that changes it. */
  const params = useLocalSearchParams<{ open?: string }>();
  useFocusEffect(useCallback(() => {
    if (params.open !== 'weaknesses') return;
    router.setParams({ open: undefined } as never);
    router.push('/settings/needs-work' as never);
  }, [params.open, router]));

  const go = (page: string) => () => router.push(`/settings/${page}` as never);
  const predictability = nearestPredictability(profile.schedule_predictability);

  const groups: { title: string; note: string; lock?: boolean; rows: Row[] }[] = [
    { title: 'Your training', note: 'Shapes every session', rows: [
      { label: 'Equipment', value: equipmentSummary(state.equipment, equipmentChoices), onPress: go('equipment') },
      { label: 'Session length', value: lengthSummary(profile.typical_session_minutes), onPress: go('length') },
      { label: 'Your week', value: weekSummary(predictability.label, preGeneratesVariants(profile.schedule_predictability)), onPress: go('week') },
      { label: 'Running', value: IMPACT_CHOICES.find(c => c.value === profile.impact_tolerance)?.label ?? 'Running is fine', onPress: go('running') },
      { label: 'Fitness and experience',
        value: fitnessSummary(capacityLabel(LOAD_CAPACITY_CHOICES, profile.load_capacity),
          capacityLabel(TECHNICAL_CAPACITY_CHOICES, profile.technical_capacity)),
        onPress: () => router.push('/capacity' as never) },
    ] },
    { title: 'What you like', note: 'Ranks sessions, never overrules', rows: [
      { label: 'What you enjoy', value: enjoySummary(preferences, PREFERENCE_OPTIONS), onPress: go('enjoy') },
      { label: 'What needs work', value: needsWorkSummary(weaknesses, WEAKNESS_OPTIONS), onPress: go('needs-work') },
    ] },
    { title: 'Health', note: 'Private · only shapes your plan', lock: true, rows: [
      { label: 'Things to train around',
        value: healthSummary(profile.considerations, postpartumPhrase(profile.postpartum_birth_date, now)),
        onPress: go('health') },
    ] },
    { title: 'Account', note: '', rows: [
      { label: 'Name', value: profile.display_name.trim() || 'Not set', onPress: go('name') },
      { label: 'Account',
        value: status === 'signed_in' ? `${email ?? 'Signed in'} · log out or delete` : 'Not signed in on this device',
        onPress: go('account') },
      { label: 'Replay the app tour', value: 'Walks through Today again',
        onPress: () => { tour.restart(); router.replace('/today' as never); } },
    ] },
  ];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 16 }}>
        <View style={{ width: 56, height: 56, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[t.h4, { fontSize: 20, color: color.onDark }]}>{initialsOf(profile.display_name)}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[t.h4, { fontSize: 22, color: color.ink }]}>{profile.display_name.trim() || 'Unnamed athlete'}</Text>
          <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>
            {trainingSince(data?.sessions ?? []) ?? descriptorOf(profile, now)}
          </Text>
        </View>
      </View>

      <ProfileError />
      <GoalCard />

      {groups.map(g => (
        <View key={g.title} style={{ marginTop: 22 }}>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
            marginHorizontal: space.gutter, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink,
          }}>
            <Label tone="ink">{g.title}</Label>
            {g.note ? <Text style={[t.meta, { color: color.muted2 }]}>{g.lock ? 'Private' : g.note}</Text> : null}
          </View>
          {g.lock ? (
            <Text style={[t.meta, { marginHorizontal: space.gutter, marginTop: 6, color: color.muted2 }]}>
              Only shapes your plan. Never shown, shared or used for anything else.
            </Text>
          ) : null}
          {g.rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              accessibilityRole="button"
              accessibilityLabel={`${r.label}, ${r.value}`}
              style={({ pressed }) => ({
                marginHorizontal: space.gutter, minHeight: 62, paddingVertical: 11,
                flexDirection: 'row', alignItems: 'center', gap: 12,
                borderBottomWidth: i === g.rows.length - 1 ? 0 : 1, borderBottomColor: color.rule,
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>{r.label}</Text>
                <Text numberOfLines={2} style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>{r.value}</Text>
              </View>
              <Chevron dir="right" />
            </Pressable>
          ))}
        </View>
      ))}
      {footer}
    </ScrollView>
  );
}

/** The goal: race or block, the date and weeks to go, and where the athlete is in the plan. */
function GoalCard() {
  const router = useRouter();
  const { plan } = useApp();
  const today = localToday();
  const race = plan.race;
  const phase = plan.phase;

  return (
    <Pressable
      onPress={() => router.push('/settings/goal' as never)}
      accessibilityRole="button"
      accessibilityLabel={`Your goal: ${race ? race.name : phase ? `${phase.total_weeks}-week block` : 'not set'}. Change goal.`}
      style={({ pressed }) => ({
        marginHorizontal: space.gutter, padding: 16, gap: 12,
        backgroundColor: pressed ? color.inkPressed : color.ink,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label tone="salmon">Your goal</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={[t.rowTitle, { fontSize: 13, color: color.onDark }]}>Change</Text>
          <Chevron dir="right" size={7} tint={color.onDark} />
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={[t.h4, { fontSize: 21, color: color.onDark }]}>
          {race ? `${race.name}${race.division ? ` · ${DIVISION[race.division] ?? race.division}` : ''}`
            : phase ? `${phase.total_weeks}-week block` : 'No plan yet'}
        </Text>
        <Text style={[t.bodySm, { fontSize: 13, color: color.onDarkSoft }]}>
          {race
            ? `${longDate(race.event_date)} · ${race.days_remaining != null
              ? `${Math.max(0, Math.ceil(race.days_remaining / 7))} weeks to go`
              : `${weeksUntil(today, race.event_date)} weeks to go`}`
            : phase ? 'No race yet. Enter one any time and the plan rebuilds around it.' : 'Set a goal to build your plan.'}
        </Text>
      </View>
      {phase && phase.total_weeks > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {Array.from({ length: phase.total_weeks }, (_, i) => {
              const w = i + 1;
              const done = w < phase.week;
              const nowWeek = w === phase.week;
              return (
                <View key={i} style={{
                  flex: 1, height: 10,
                  backgroundColor: nowWeek ? color.red : done ? color.onDark : 'transparent',
                  borderWidth: 1, borderColor: nowWeek ? color.red : done ? color.onDark : color.muted3,
                }} />
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[t.meta, { color: color.onDarkSoft }]}>
              Week {phase.week} of {phase.total_weeks} · {phaseTitle(phase.type)} phase
            </Text>
            <Text style={[t.meta, { color: color.onDarkSoft }]}>{race ? 'Race week' : 'Last week'}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}
