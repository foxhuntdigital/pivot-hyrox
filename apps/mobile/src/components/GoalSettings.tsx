/**
 * The goal a plan is built from, editable after onboarding.
 *
 * D03 asks this question once; this is the same question asked again later,
 * which is what `ready.tsx` has always promised ("everything below can be
 * changed later on Profile") and what an athlete on a block needs when they
 * finally enter a race.
 *
 * It writes through `createPlan`, the same endpoint onboarding uses. That is
 * the whole reason this is safe: the server supersedes the previous program and
 * takes a new version rather than mutating the old one, so completed sessions
 * keep the plan they were performed under and nothing already trained is lost
 * by changing what comes next.
 */
import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';

import { ChipRow, DateChooser } from '@/components/onboarding';
import { Label, ActionButton } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { localToday } from '@/lib/format';
import { createPlan, updateRaceDetails, type PlanTarget } from '@/data/planRepo';
import type { PlanView } from '@/data/plan';
import { useDialog } from '@/components/Dialog';

type Mode = 'race' | 'block';

const MODES: { value: Mode; label: string }[] = [
  { value: 'race', label: 'A race' },
  { value: 'block', label: 'No race yet' },
];

const DIVISIONS = [
  { value: 'open', label: 'Open' },
  { value: 'pro', label: 'Pro' },
  { value: 'doubles', label: 'Doubles' },
  { value: 'relay', label: 'Relay' },
];

const BLOCK_LENGTHS = [6, 8, 10, 12, 16, 20].map(weeks => ({
  value: weeks, label: `${weeks} weeks`,
}));

export function GoalSettings({ plan, onSaved }: {
  plan: PlanView;
  /** Called after a successful write so the caller can refetch Today. */
  onSaved: () => void;
}) {
  const [today] = useState(localToday);
  const dialog = useDialog();

  // Every field is seeded from the plan the athlete is actually on — including
  // the date, which is why `RaceView` carries the raw ISO value beside its
  // label. Opening this section and saving without touching anything is then a
  // no-op rather than a silent reset, and fixing a typo does not mean
  // re-entering a date that has not changed.
  const [mode, setMode] = useState<Mode>(plan.race ? 'race' : 'block');
  const [name, setName] = useState(plan.race?.name ?? '');
  const [date, setDate] = useState<string | null>(plan.race?.event_date ?? null);
  const [division, setDivision] = useState<string | null>(plan.race?.division ?? null);
  const [weeks, setWeeks] = useState(plan.phase?.total_weeks ?? 12);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'renamed' | 'rebuilt' | null>(null);

  const inPast = date != null && date < today;
  const canSave = !busy && (mode === 'block' || (date != null && !inPast));

  /**
   * Whether what changed moves a phase boundary.
   *
   * A race date, a block length and a switch between the two all change the
   * runway, and the runway is what every phase length is a proportion of — so
   * those have to be rebuilt. A name and a division change nothing the engine
   * reads. Splitting on that is the whole point: rebuilding supersedes the
   * program and starts the new one today, which costs an athlete in week 8 of
   * 16 their place in the plan, and no typo is worth that.
   */
  const startedOnRace = plan.race != null;
  const changesRunway = mode === 'race'
    ? !startedOnRace || date !== plan.race?.event_date
    : startedOnRace || weeks !== plan.phase?.total_weeks;

  async function rebuild() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const target: PlanTarget = mode === 'race'
        ? { race: { event_name: name.trim() || 'My race', event_date: date!, division } }
        : { block: { weeks } };
      await createPlan(target);
      setSaved('rebuilt');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your plan.');
    } finally {
      setBusy(false);
    }
  }

  async function renameOnly() {
    if (!plan.race) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await updateRaceDetails(plan.race.id, {
        event_name: name.trim() || 'My race',
        division,
      });
      setSaved('renamed');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your race.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The confirmation before a rebuild.
   *
   * It names the position being given up rather than asking a generic "are you
   * sure": "you are in week 8 of 16" is the fact that makes the decision, and
   * the athlete is the only one who can weigh it.
   */
  async function save() {
    if (!changesRunway) return renameOnly();

    const position = plan.phase
      ? `You're in week ${plan.phase.week} of ${plan.phase.total_weeks}. `
      : '';
    const ok = await dialog.confirm({
      eyebrow: 'Rebuild plan',
      title: 'Rebuild your plan?',
      body: `${position}The new plan starts today at week 1, built around what you've `
        + 'just set. Completed training is kept.',
      confirmLabel: 'Rebuild',
    });
    if (ok) await rebuild();
  }

  return (
    <View>
      <Text style={[t.bodySm, {
        paddingHorizontal: space.gutter, paddingBottom: 14, color: color.muted2,
      }]}>
        {plan.race
          ? `Training for ${plan.race.name}.`
          : plan.phase
            ? `On a ${plan.phase.total_weeks}-week block with no race entered.`
            : 'No plan yet.'}
        {' '}
        Changing this rebuilds the weeks ahead and leaves completed training untouched.
      </Text>

      <ChipRow
        label="What are you training for?"
        options={MODES}
        value={mode}
        onChange={setMode}
        columns
      />

      {mode === 'race' ? (
        <>
          <View style={{ paddingHorizontal: space.gutter, paddingBottom: 20 }}>
            <Label tone="ink" style={{ marginBottom: 7 }}>Event name</Label>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Boston HYROX"
              placeholderTextColor={color.muted3}
              style={{
                borderWidth: 1, borderColor: color.chipBorder,
                paddingHorizontal: 13, paddingVertical: 14,
                fontFamily: t.rowTitle.fontFamily, fontSize: 14, color: color.ink,
              }}
            />
          </View>

          <DateChooser value={date} onChange={setDate} minDate={today} />

          <ChipRow
            label="Division"
            options={DIVISIONS}
            value={division}
            onChange={setDivision}
          />
        </>
      ) : (
        <ChipRow
          label="Program length"
          options={BLOCK_LENGTHS}
          value={weeks}
          onChange={setWeeks}
        />
      )}

      {error ? (
        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, paddingBottom: 10, color: color.redDeep,
        }]}>
          {error}
        </Text>
      ) : null}

      {saved && !error ? (
        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, paddingBottom: 10, color: color.muted2,
        }]}>
          {saved === 'rebuilt'
            ? 'Plan rebuilt. Today and Plan now show the new weeks.'
            : 'Race details saved. Your plan is unchanged.'}
        </Text>
      ) : null}

      <ActionButton
        label={busy
          ? (changesRunway ? 'Rebuilding…' : 'Saving…')
          : (changesRunway ? 'Rebuild my plan' : 'Save details')}
        variant="outline"
        arrow={null}
        onPress={canSave ? save : undefined}
        style={{ marginHorizontal: space.gutter, opacity: canSave ? 1 : 0.5 }}
      />

      {/* Said before the tap, not after it. The button's own label changes too,
          but "this will not touch your plan" is the reassurance that makes a
          typo fix feel safe to make. */}
      <Text style={[t.meta, {
        fontSize: 11.5, lineHeight: 17, color: color.muted,
        paddingHorizontal: space.gutter, paddingTop: 10,
      }]}>
        {changesRunway
          ? 'Changing the runway rebuilds the weeks ahead, starting today. Completed training is kept.'
          : 'Name and division only — your plan and your place in it stay as they are.'}
      </Text>

      {mode === 'race' && date == null ? (
        <Text style={[t.meta, {
          fontSize: 11.5, lineHeight: 17, color: color.muted,
          paddingHorizontal: space.gutter, paddingTop: 10,
        }]}>
          Pick the race date to rebuild.
        </Text>
      ) : null}
      {inPast ? (
        <Text style={[t.meta, {
          fontSize: 11.5, lineHeight: 17, color: color.redDeep,
          paddingHorizontal: space.gutter, paddingTop: 10,
        }]}>
          That date has already passed. Pick a future race date.
        </Text>
      ) : null}
    </View>
  );
}
