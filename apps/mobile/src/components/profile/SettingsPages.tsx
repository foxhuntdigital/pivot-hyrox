/**
 * Profile's edit pages, one per row (redesign plan, Profile, edit pages).
 *
 * Two kinds. Edits that change sessions (equipment, running, the goal) are
 * drafts: nothing is saved until the athlete confirms, a bar at the bottom
 * counts the changes and says what saving does, and changed items carry a red
 * dot. Edits that only re-rank (session length, your week, what you enjoy,
 * what needs work, health, name) save on tap, as they always have. Fitness and
 * experience keeps its own screen (`/capacity`), which already works this way.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, space, type as t } from '@/theme/tokens';
import { ActionButton, Chip, Label, SquareCheck } from '@/components/primitives';
import { DraftSaveBar, SubpageHeader } from '@/components/system';
import { ChipRow, DateChooser } from '@/components/onboarding';
import { useDialog } from '@/components/Dialog';
import { Stepper } from '@/components/profile/ProfileLegacy';
import { ProfileError } from '@/components/profile/ProfileError';
import { EQUIPMENT_CHOICES } from '@/data/content';
import { saveEquipment } from '@/data/equipmentRepo';
import { createPlan, updateRaceDetails, type PlanTarget } from '@/data/planRepo';
import { PREFERENCE_OPTIONS, WEAKNESS_OPTIONS } from '@/data/preferencesRepo';
import {
  CONSIDERATION_CHOICES, IMPACT_CHOICES, PREDICTABILITY_CHOICES, SESSION_MINUTES, monthsPostpartum,
  nearestPredictability, parseISODate, postpartumPhrase, preGeneratesVariants, toISODate,
  type ImpactTolerance,
} from '@/data/profile';
import { saveProfile } from '@/data/profileRepo';
import {
  changedIds, changesTitle, equipmentGroups, goalChange, rebuildConsequence, weeksUntil,
  type GoalDraft,
} from '@/data/profileView';
import { replanWeek } from '@/data/weekRepo';
import { localToday } from '@/lib/format';
import { isSupabaseConfigured } from '@/lib/supabase';
import { canPickMore, needsWorkNote, toggleNeedsWork } from '@/state/needsWork';
import { useProgress } from '@/state/progress';
import { useSession } from '@/state/session';
import { useApp } from '@/state/store';

export const PAGES = ['equipment', 'length', 'week', 'running', 'enjoy', 'needs-work', 'health', 'name', 'account', 'goal'] as const;
export type Page = (typeof PAGES)[number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RATINGS = [
  { key: 'love' as const, label: 'Love it' },
  { key: 'like' as const, label: 'Like it' },
  { key: 'rather_not' as const, label: 'Rather not' },
];

export function SettingsPage({ page }: { page: Page }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Body = BODIES[page];
  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <SubpageHeader backTo="Profile" onBack={() => router.back()} />
      <Body />
    </View>
  );
}

function Title({ title, intro }: { title: string; intro?: string }) {
  return (
    <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6, gap: 6 }}>
      <Text style={[t.h2, { color: color.ink }]}>{title}</Text>
      {intro ? <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>{intro}</Text> : null}
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <Text style={[t.meta, { fontSize: 12, lineHeight: 17, color: color.muted2, marginHorizontal: space.gutter, marginTop: 14 }]}>{children}</Text>;
}

/** Sessions still to come this week: what a session-changing save rebuilds. */
function useSessionsLeft() {
  const { plan } = useApp();
  return plan.week.queue.filter(q => q.state === 'queued' || q.state === 'recommended').length;
}

/** Saves a session-changing edit, then rebuilds the rest of the week against it. */
function useApplyAndReplan() {
  const router = useRouter();
  const { refreshToday } = useApp();
  const { status } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (save: () => Promise<void>, local: () => void) => {
    setBusy(true);
    setError(null);
    try {
      // On a device with no account the change is local only: there is no
      // stored plan to rebuild.
      if (status === 'signed_in') {
        await save();
        await replanWeek();
        refreshToday();
      }
      local();
      router.back();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not save. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/* ── equipment (draft) ─────────────────────────────────────────────────── */

function EquipmentPage() {
  const { state, dispatch } = useApp();
  const left = useSessionsLeft();
  const [draft, setDraft] = useState<string[]>(state.equipment);
  const changed = changedIds(state.equipment, draft);
  const groups = useMemo(() => equipmentGroups(EQUIPMENT_CHOICES), []);
  const { busy, error, run } = useApplyAndReplan();

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Title title="Equipment" intro="What you can use this week. Sessions only use what's ticked." />
        {groups.map(g => (
          <View key={g.title} style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: space.gutter, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
              <Label tone="ink">{g.title}</Label>
              <Text style={[t.meta, { color: color.muted2 }]}>
                {g.items.filter(i => draft.includes(i.id)).length} of {g.items.length}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: space.gutter, marginTop: 10 }}>
              {g.items.map(item => {
                const on = draft.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setDraft(on ? draft.filter(id => id !== item.id) : [...draft, item.id])}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${item.name}${changed.has(item.id) ? ', changed' : ''}`}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 11,
                      borderWidth: 1, borderColor: on ? color.ink : color.chipBorder,
                      backgroundColor: on ? color.ink : 'transparent',
                    }}
                  >
                    <View style={{ width: 12, height: 12, borderWidth: 1.5, borderColor: on ? color.paper : color.muted, backgroundColor: on ? color.paper : 'transparent' }} />
                    <Text style={[t.rowTitle, { fontSize: 13, color: on ? color.onDark : color.ink }]}>{item.name}</Text>
                    {changed.has(item.id) ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.red }} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {error ? <Text style={[t.bodySm, { color: color.redDeep, marginHorizontal: space.gutter, marginTop: 14 }]}>{error}</Text> : null}
      </ScrollView>
      <DraftSaveBar
        changes={changed.size}
        consequence={rebuildConsequence(left, 'with what you have')}
        idleNote={`${draft.length} items ticked. Tap to change. Nothing is saved until you confirm.`}
        confirmLabel="Save and update this week"
        busy={busy}
        onConfirm={() => run(() => saveEquipment(draft), () => dispatch({ type: 'hydrate_equipment', equipment: draft }))}
        onDiscard={() => setDraft(state.equipment)}
      />
    </>
  );
}

/* ── running (draft) ───────────────────────────────────────────────────── */

function RunningPage() {
  const { state, dispatch } = useApp();
  const left = useSessionsLeft();
  const saved: ImpactTolerance = state.profile.impact_tolerance === 'low' ? 'low' : 'normal';
  const [draft, setDraft] = useState<ImpactTolerance>(saved);
  const { busy, error, run } = useApplyAndReplan();

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Title title="Running" intro="Whether sessions can include running and other impact." />
        <View style={{ marginHorizontal: space.gutter, marginTop: 12 }}>
          {IMPACT_CHOICES.map(c => {
            const on = draft === c.value;
            return (
              <Pressable
                key={c.value}
                onPress={() => setDraft(c.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={{ flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.rule }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: color.ink, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                  {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.ink }} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>{c.label}</Text>
                    {on && draft !== saved ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.red }} /> : null}
                  </View>
                  <Text style={[t.bodySm, { color: color.muted2 }]}>{c.detail}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Note>For a day when running is off, use Adapt on Today instead. This sets every week.</Note>
        {error ? <Text style={[t.bodySm, { color: color.redDeep, marginHorizontal: space.gutter, marginTop: 14 }]}>{error}</Text> : null}
      </ScrollView>
      <DraftSaveBar
        changes={draft === saved ? 0 : 1}
        consequence={rebuildConsequence(left, draft === 'low' ? 'without running' : 'with running back in')}
        idleNote="Nothing is saved until you confirm."
        confirmLabel="Save and update this week"
        busy={busy}
        onConfirm={() => run(() => saveProfile({ impact_tolerance: draft }),
          () => dispatch({ type: 'hydrate_profile', profile: { ...state.profile, impact_tolerance: draft } }))}
        onDiscard={() => setDraft(saved)}
      />
    </>
  );
}

/* ── goal (draft, three states) ────────────────────────────────────────── */

const DIVISIONS = [
  { value: 'open', label: 'Open' }, { value: 'pro', label: 'Pro' },
  { value: 'doubles', label: 'Doubles' }, { value: 'relay', label: 'Relay' },
];
const BLOCK_LENGTHS = [6, 8, 10, 12, 16, 20].map(weeks => ({ value: weeks, label: `${weeks} weeks` }));

function Strip({ label, week, total, caption }: { label: string; week: number; total: number; caption: string }) {
  return (
    <View style={{ gap: 5 }}>
      <Label size="sm">{label}</Label>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {Array.from({ length: Math.max(1, total) }, (_, i) => (
          <View key={i} style={{
            flex: 1, height: 9,
            backgroundColor: i + 1 === week ? color.red : i + 1 < week ? color.ink : 'transparent',
            borderWidth: 1, borderColor: i + 1 === week ? color.red : i + 1 < week ? color.ink : color.chipBorder,
          }} />
        ))}
      </View>
      <Text style={[t.meta, { color: color.muted2 }]}>{caption}</Text>
    </View>
  );
}

function GoalPage() {
  const router = useRouter();
  const { plan, refreshToday } = useApp();
  const { data } = useProgress();
  const [today] = useState(localToday);
  const fresh = (): GoalDraft => ({
    mode: plan.race ? 'race' : 'block',
    name: plan.race?.name ?? '',
    date: plan.race?.event_date ?? null,
    division: plan.race?.division ?? null,
    weeks: plan.phase?.total_weeks ?? 12,
  });
  const [d, setD] = useState<GoalDraft>(fresh);
  const set = (patch: Partial<GoalDraft>) => setD(prev => ({ ...prev, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSupabaseConfigured) {
    return (
      <>
        <Title title="Your goal" />
        <Note>No account is connected to this build, so the plan is the bundled sample one and cannot be rebuilt here.</Note>
      </>
    );
  }

  const change = goalChange({ race: plan.race, total_weeks: plan.phase?.total_weeks ?? null }, d);
  const inPast = d.mode === 'race' && d.date != null && d.date < today;
  const ready = d.mode === 'block' || (d.date != null && !inPast);
  const afterWeeks = d.mode === 'race' && d.date ? Math.max(1, weeksUntil(today, d.date)) : d.weeks;
  const finished = data?.sessions.length ?? null;

  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); refreshToday(); router.back(); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Could not update your plan.'); }
    finally { setBusy(false); }
  };
  const rebuild = () => save(() => createPlan((d.mode === 'race'
    ? { race: { event_name: d.name.trim() || 'My race', event_date: d.date!, division: d.division } }
    : { block: { weeks: d.weeks } }) as PlanTarget));
  const details = () => save(() => updateRaceDetails(plan.race!.id, { event_name: d.name.trim() || 'My race', division: d.division }));

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Title title="Your goal" intro="A new race date or program length starts a new plan at week 1. A name or division just updates the details." />
        <ChipRow label="Training for" options={[{ value: 'race' as const, label: 'A race' }, { value: 'block' as const, label: 'No race yet' }]}
          value={d.mode} onChange={mode => set({ mode })} columns />
        {d.mode === 'race' ? (
          <>
            <View style={{ paddingHorizontal: space.gutter, paddingBottom: 20 }}>
              <Label tone="ink" style={{ marginBottom: 7 }}>Event name</Label>
              <TextInput
                value={d.name} onChangeText={name => set({ name })} placeholder="Boston HYROX"
                placeholderTextColor={color.muted3} accessibilityLabel="Event name"
                style={{ borderWidth: 1, borderColor: color.chipBorder, paddingHorizontal: 13, paddingVertical: 14, fontFamily: t.rowTitle.fontFamily, fontSize: 14, color: color.ink }}
              />
            </View>
            <DateChooser value={d.date} onChange={date => set({ date })} minDate={today} />
            {d.date ? (
              <Text style={[t.bodySm, { fontSize: 13, color: inPast ? color.redDeep : color.ink, marginHorizontal: space.gutter, marginTop: -8, marginBottom: 16 }]}>
                {inPast ? 'That date has passed.' : `${weeksUntil(today, d.date)} weeks away`}
                {plan.race && d.date !== plan.race.event_date && !inPast ? ` · was ${weeksUntil(today, plan.race.event_date)}` : ''}
              </Text>
            ) : null}
            <ChipRow label="Division" options={DIVISIONS} value={d.division} onChange={division => set({ division })} />
          </>
        ) : (
          <>
            <ChipRow label="Program length" options={BLOCK_LENGTHS} value={d.weeks} onChange={weeks => set({ weeks })} />
            <Note>Enter a race any time and the plan rebuilds around it.</Note>
          </>
        )}
        {error ? <Text style={[t.bodySm, { color: color.redDeep, marginHorizontal: space.gutter, marginTop: 14 }]}>{error}</Text> : null}
      </ScrollView>

      <View style={{ borderTopWidth: 2, borderTopColor: color.ink, paddingHorizontal: space.gutter, paddingVertical: 14, gap: 10, backgroundColor: color.paper }}>
        {change === 'none' || (change === 'rebuild' && !ready) ? (
          <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>
            {change === 'none' ? 'Nothing changes until you confirm.' : 'Pick a race date to see what changes.'}
          </Text>
        ) : change === 'details' ? (
          <>
            <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>Details only. Your plan and your place in it stay as they are.</Text>
            <ActionButton label={busy ? 'Saving…' : 'Save details'} arrow={null} onPress={busy ? undefined : details} />
            <Pressable onPress={() => setD(fresh())} accessibilityRole="button" style={{ alignItems: 'center', minHeight: 36, justifyContent: 'center' }}>
              <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.ink, textDecorationLine: 'underline' }]}>Discard changes</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, color: color.redDark }]}>This rebuilds your plan</Text>
            {plan.phase ? (
              <Strip label="Now" week={plan.phase.week} total={plan.phase.total_weeks}
                caption={`Week ${plan.phase.week} of ${plan.phase.total_weeks}`} />
            ) : null}
            <Strip label="After" week={1} total={afterWeeks}
              caption={`Week 1 of ${afterWeeks}${d.mode === 'race' && d.date ? `, race ${new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}`} />
            <Text style={[t.bodySm, { fontSize: 13, color: color.ink }]}>
              Starts today at week 1. {finished != null ? `Your ${finished} finished ${finished === 1 ? 'session stays' : 'sessions stay'}` : 'Your finished sessions stay'} in your history.
            </Text>
            <ActionButton label={busy ? 'Rebuilding…' : 'Rebuild my plan'} arrow={null} onPress={busy ? undefined : rebuild} />
            <Pressable onPress={() => setD(fresh())} accessibilityRole="button" style={{ alignItems: 'center', minHeight: 36, justifyContent: 'center' }}>
              <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.ink, textDecorationLine: 'underline' }]}>Keep my current plan</Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
}

/* ── re-rank pages: save on tap ────────────────────────────────────────── */

function LengthPage() {
  const { state, dispatch, commitProfile } = useApp();
  const minutes = state.profile.typical_session_minutes;
  return (
    <ScrollView>
      <ProfileErrorTop />
      <Title title="Session length" intro="The length your sessions are built around. Saved as you tap." />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter, marginTop: 10 }}>
        {SESSION_MINUTES.map(v => (
          <Chip key={v} flex label={v === 90 ? '90+' : String(v)} active={minutes === v}
            onPress={() => { dispatch({ type: 'set_typical', minutes: v }); commitProfile({ typical_session_minutes: v }); }}
            style={{ paddingVertical: 12 }} />
        ))}
      </View>
      <Note>On a shorter day, Adapt on Today trims that session without changing this.</Note>
    </ScrollView>
  );
}

function WeekPage() {
  const { state, dispatch, commitProfile } = useApp();
  const value = state.profile.schedule_predictability;
  const chosen = nearestPredictability(value);
  return (
    <ScrollView>
      <ProfileErrorTop />
      <Title title="Your week" intro="How regular your training time is. Saved as you tap." />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter, marginTop: 10 }}>
        {PREDICTABILITY_CHOICES.map(c => (
          <Chip key={c.value} flex size="sm" label={c.label} active={chosen.value === c.value}
            onPress={() => { dispatch({ type: 'set_predictability', value: c.value }); commitProfile({ schedule_predictability: c.value }); }}
            style={{ paddingVertical: 13 }} />
        ))}
      </View>
      <Note>
        {preGeneratesVariants(value)
          ? 'Every session comes with an Express and a Micro version ready in advance, so a short day is one tap.'
          : 'Full sessions lead. Shorter versions are there when you ask, from Adapt on Today.'}
      </Note>
    </ScrollView>
  );
}

function EnjoyPage() {
  const { preferences, setPreference } = useApp();
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <Title title="What you enjoy" intro="Ranks sessions your plan already allows. Saved as you tap." />
      <View style={{ paddingHorizontal: space.gutter }}>
        {PREFERENCE_OPTIONS.map(option => {
          const rating = preferences[option.value];
          return (
            <View key={option.value} style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.ruleFaint }}>
              <Text style={[t.rowTitle, { fontSize: 14, color: rating ? color.ink : color.muted2 }]}>{option.label}</Text>
              <Text style={[t.meta, { fontSize: 11.5, color: color.muted, marginTop: 1 }]}>{option.hint}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 9 }}>
                {RATINGS.map(({ key, label }) => (
                  <Chip key={key} flex label={label} active={rating === key}
                    accessibilityLabel={`${option.label}: ${label}`}
                    onPress={() => setPreference(option.value, rating === key ? null : key)} />
                ))}
              </View>
            </View>
          );
        })}
      </View>
      <Note>It never overrules recovery, equipment, or what your race needs: a week short on threshold still gives you threshold.</Note>
    </ScrollView>
  );
}

function NeedsWorkPage() {
  const { weaknesses, setWeakness } = useApp();
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <Title title="What needs work" intro="Up to three. Your own read, kept beside what your training shows. Saved as you tap." />
      <View style={{ paddingHorizontal: space.gutter }}>
        {WEAKNESS_OPTIONS.map(option => {
          const on = weaknesses.includes(option.value);
          const disabled = !on && !canPickMore(weaknesses);
          return (
            <Pressable
              key={option.value}
              onPress={() => { const r = toggleNeedsWork(weaknesses, option.value); if (!r.blocked) setWeakness(option.value, r.picked); }}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled }}
              accessibilityLabel={option.label}
              style={{ opacity: disabled ? 0.45 : 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.ruleFaint }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[t.rowTitle, { fontSize: 14, color: on ? color.ink : color.muted2 }]}>{option.label}</Text>
                <Text style={[t.meta, { fontSize: 11.5, color: color.muted, marginTop: 1 }]}>{option.hint}</Text>
              </View>
              <SquareCheck on={on} />
            </Pressable>
          );
        })}
      </View>
      <Text style={[t.meta, { fontSize: 12, color: color.ink, marginHorizontal: space.gutter, marginTop: 12 }]}>{needsWorkNote(weaknesses)}</Text>
      <Note>Where your read and your training disagree, PIVOT keeps both, and Progress shows where they part company.</Note>
    </ScrollView>
  );
}

function HealthPage() {
  const { state, dispatch, commitProfile } = useApp();
  const { profile } = state;
  const now = new Date();
  const birth = profile.postpartum_birth_date ? parseISODate(profile.postpartum_birth_date) : null;
  const minYear = now.getFullYear() - 10;
  const rows = [...CONSIDERATION_CHOICES, ...profile.considerations.filter(c => !CONSIDERATION_CHOICES.includes(c))];
  const setBirth = (year: number, month0: number) => {
    const date = toISODate(year, month0 + 1);
    dispatch({ type: 'set_postpartum_date', date });
    commitProfile({ postpartum_birth_date: date });
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <ProfileErrorTop />
      <Title title="Things to train around" intro="Private. Used only to shape your plan; never shown, shared or used for anything else. Saved as you tap." />
      <View style={{ paddingHorizontal: space.gutter }}>
        {rows.map(name => {
          const on = profile.considerations.includes(name);
          return (
            <Pressable
              key={name}
              onPress={() => {
                dispatch({ type: 'toggle_consideration', name });
                commitProfile({ considerations: on ? profile.considerations.filter(c => c !== name) : [...profile.considerations, name] });
              }}
              accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={name}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.ruleFaint }}
            >
              <Text style={[t.rowTitle, { fontSize: 14, color: on ? color.ink : color.muted2 }]}>{name}</Text>
              <SquareCheck on={on} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ marginHorizontal: space.gutter, marginTop: 24, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
        <Label tone="ink">Postpartum</Label>
      </View>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 12 }}>
        {birth ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Stepper label="month" value={MONTHS[birth.getMonth()]}
                onPrev={() => { const m = birth.getMonth() - 1; setBirth(m < 0 ? birth.getFullYear() - 1 : birth.getFullYear(), (m + 12) % 12); }}
                onNext={() => { const m = birth.getMonth() + 1; setBirth(m > 11 ? birth.getFullYear() + 1 : birth.getFullYear(), m % 12); }}
                prevEnabled={birth.getMonth() > 0 || birth.getFullYear() - 1 >= minYear}
                nextEnabled={birth.getFullYear() < now.getFullYear() || birth.getMonth() < now.getMonth()} />
              <Stepper label="year" value={String(birth.getFullYear())}
                onPrev={() => setBirth(birth.getFullYear() - 1, birth.getMonth())}
                onNext={() => setBirth(birth.getFullYear() + 1, birth.getMonth())}
                prevEnabled={birth.getFullYear() > minYear}
                nextEnabled={birth.getFullYear() < now.getFullYear() && new Date(birth.getFullYear() + 1, birth.getMonth(), 1) <= now} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
              <Text style={[t.statValue, { color: color.ink }]}>{monthsPostpartum(profile.postpartum_birth_date, now) ?? 0}</Text>
              <Text style={[t.bodySm, { color: color.muted2 }]}>
                {postpartumPhrase(profile.postpartum_birth_date, now)?.replace(/^\d+\s/, '') ?? 'months postpartum'}
              </Text>
            </View>
            <Pressable onPress={() => { dispatch({ type: 'set_postpartum_date', date: null }); commitProfile({ postpartum_birth_date: null }); }}
              accessibilityRole="button" style={{ paddingVertical: 12 }}>
              <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>Remove date</Text>
            </Pressable>
          </>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Add birth date" active={false} size="sm" onPress={() => setBirth(now.getFullYear(), now.getMonth())} />
          </View>
        )}
      </View>
      <Note>Used to track where you are in your return, not to decide what you are cleared for. Programming limits stay with the choices above, and only you change those.</Note>
    </ScrollView>
  );
}

function NamePage() {
  const { state, dispatch, commitProfile } = useApp();
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <ProfileErrorTop />
      <Title title="Name" intro="Saved when you finish typing." />
      <View style={{ paddingHorizontal: space.gutter, marginTop: 8 }}>
        <TextInput
          value={state.profile.display_name}
          onChangeText={name => dispatch({ type: 'set_name', name })}
          onEndEditing={() => commitProfile({ display_name: state.profile.display_name.trim() })}
          placeholder="Your name" placeholderTextColor={color.muted3} autoCapitalize="words" autoFocus
          accessibilityLabel="Name"
          style={{ borderWidth: 1, borderColor: color.chipBorder, paddingHorizontal: 13, paddingVertical: 14, fontFamily: t.rowTitle.fontFamily, fontSize: 15, color: color.ink }}
        />
      </View>
    </ScrollView>
  );
}

function AccountPage() {
  const { email, signOut, deleteAccount, status } = useSession();
  const dialog = useDialog();
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const logOut = async () => {
    const ok = await dialog.confirm({ eyebrow: 'Account', title: 'Log out?',
      body: 'Your training data stays on your account. You can sign back in any time.', confirmLabel: 'Log out' });
    if (!ok) return;
    setSigningOut(true);
    try { await signOut(); }
    catch (e) { await dialog.alert({ title: 'Could not log out', body: e instanceof Error ? e.message : 'Please try again.' }); }
    finally { setSigningOut(false); }
  };

  /** Two prompts on purpose: one is read, the second is decided (see the old Profile). */
  const remove = async () => {
    const understood = await dialog.confirm({ eyebrow: 'Delete account', title: 'Delete your account?',
      body: 'This removes your account and everything in it — your plan, your completed sessions, your check-ins and your profile. It cannot be undone.',
      confirmLabel: 'Continue' });
    if (!understood) return;
    const sure = await dialog.confirm({ eyebrow: 'Delete account', title: 'This cannot be undone',
      body: 'Your training history will be permanently deleted.', confirmLabel: 'Delete permanently', cancelLabel: 'Keep my account' });
    if (!sure) return;
    setDeleting(true);
    try { await deleteAccount(); }
    catch (e) {
      await dialog.alert({ title: 'Could not delete your account', body: e instanceof Error ? e.message : 'Please try again.' });
      setDeleting(false);
    }
  };

  if (status !== 'signed_in') {
    return (
      <>
        <Title title="Account" />
        <Note>
          {isSupabaseConfigured
            ? 'Not signed in. Profile changes stay on this device.'
            : 'No account is connected to this build, so profile changes stay on this device and there is nothing to log out of.'}
        </Note>
      </>
    );
  }

  return (
    <ScrollView>
      <Title title="Account" intro={`Signed in as ${email ?? 'this account'}.`} />
      <ActionButton label={signingOut ? 'Logging out…' : 'Log out'} variant="outline" arrow={null}
        onPress={signingOut ? undefined : logOut} style={{ marginHorizontal: space.gutter, marginTop: 14, opacity: signingOut ? 0.5 : 1 }} />
      <Pressable
        accessibilityRole="button" accessibilityLabel="Delete your account"
        accessibilityHint="Permanently deletes your account and all of your training data"
        disabled={deleting} onPress={remove}
        style={{ marginHorizontal: space.gutter, marginTop: 28, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: color.redDeep, opacity: deleting ? 0.5 : 1 }}
      >
        {deleting ? <ActivityIndicator color={color.redDeep} />
          : <Text style={[t.rowTitle, { fontSize: 14, color: color.redDeep }]}>Delete account</Text>}
      </Pressable>
      <Note>Deletes your account and all of your training data for good. There is no undo and no recovery period.</Note>
    </ScrollView>
  );
}

function ProfileErrorTop() {
  const { profileError } = useApp();
  return profileError ? <View style={{ marginTop: 14 }}><ProfileError /></View> : null;
}

const BODIES: Record<Page, () => React.ReactElement> = {
  equipment: EquipmentPage, running: RunningPage, goal: GoalPage,
  length: LengthPage, week: WeekPage, enjoy: EnjoyPage, 'needs-work': NeedsWorkPage,
  health: HealthPage, name: NamePage, account: AccountPage,
};
