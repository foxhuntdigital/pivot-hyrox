/**
 * D22 Profile + D23 Equipment profiles.
 *
 * The considerations section is the sensitive one. It is used only to constrain
 * programming, is stored owner-only under RLS, and is excluded from analytics
 * (PRD §16) and from the AI coach's context beyond its granted purpose
 * (PRD §13.2). The copy says exactly that, and the copy is accurate.
 *
 * Profile edits are optimistic: local state updates on the keystroke and the
 * write follows. A failed write surfaces as a banner rather than snapping the
 * field back to its old value under the athlete's cursor.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, Chip, SquareCheck, ActionButton } from '@/components/primitives';
import { useApp } from '@/state/store';
import { PREFERENCE_OPTIONS } from '@/data/preferencesRepo';
import { useSession } from '@/state/session';
import { useTour } from '@/state/tour';
import { GoalSettings } from '@/components/GoalSettings';
import { useDialog } from '@/components/Dialog';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  CONSIDERATION_CHOICES, EXPERIENCE_LEVELS, PREDICTABILITY_CHOICES, descriptorOf, initialsOf, levelLabel,
  monthsPostpartum, nearestPredictability, parseISODate, postpartumPhrase,
  preGeneratesVariants, SESSION_MINUTES, toISODate,
} from '@/data/profile';
import { EQUIPMENT_CHOICES } from '@/data/content';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Section divider used between every block on this screen. */
function Divider() {
  return (
    <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
      <Rule />
    </View>
  );
}

/**
 * Disclosure caret. The design has no icon set, so this is the same
 * typographic arrow the steppers and action rows use, rotated a quarter turn
 * when the section is open.
 */
function Caret({ open }: { open: boolean }) {
  return (
    <Text style={{
      fontFamily: t.rowTitle.fontFamily, fontSize: 15, color: color.muted,
      transform: [{ rotate: open ? '90deg' : '0deg' }],
    }}>
      ›
    </Text>
  );
}

/**
 * A collapsible block. The whole header is the target rather than the caret
 * alone — a 15px glyph is well under the 44pt minimum, and the caret states
 * what the row does instead of being the only way to do it.
 *
 * Every block on the screen is one of these and all of them start closed, so
 * the screen opens as a short index rather than a wall of controls. Closing
 * hides no state: what the athlete has set shows in the header badge, and the
 * identity fields are already summarised at the top of the screen.
 */
/**
 * The three statements worth offering. `neutral` is the fourth rating in the
 * schema and is not a button: it is what no answer means, so clearing a choice
 * expresses it exactly.
 */
const RATINGS = [
  { key: 'love' as const, label: 'Love it' },
  { key: 'like' as const, label: 'Like it' },
  { key: 'rather_not' as const, label: 'Rather not' },
];

function Section({
  title, open, onToggle, badge, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        accessibilityHint={open ? `Collapse ${title}` : `Expand ${title}`}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: space.gutter, paddingTop: 12, paddingBottom: 10,
          backgroundColor: pressed ? color.hover : 'transparent',
        })}
      >
        <Label tone="ink">{title}</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {badge}
          <Caret open={open} />
        </View>
      </Pressable>
      {open ? children : null}
    </>
  );
}

/** `‹ value ›` — a flat stepper, since the design has no wheels or dropdowns. */
function Stepper({
  value, onPrev, onNext, prevEnabled = true, nextEnabled = true, label,
}: {
  value: string;
  onPrev: () => void;
  onNext: () => void;
  prevEnabled?: boolean;
  nextEnabled?: boolean;
  label: string;
}) {
  const Arrow = ({ dir, on, press }: { dir: string; on: boolean; press: () => void }) => (
    <Pressable
      onPress={on ? press : undefined}
      disabled={!on}
      accessibilityRole="button"
      accessibilityLabel={`${dir === '‹' ? 'Previous' : 'Next'} ${label}`}
      style={({ pressed }) => ({
        paddingHorizontal: 14, paddingVertical: 13,
        backgroundColor: pressed && on ? color.hover : 'transparent',
      })}
    >
      <Text style={{ fontFamily: t.rowTitle.fontFamily, fontSize: 16,
        color: on ? color.ink : color.muted3 }}>{dir}</Text>
    </Pressable>
  );

  return (
    <View style={{
      flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1, borderColor: color.chipBorder,
    }}>
      <Arrow dir="‹" on={prevEnabled} press={onPrev} />
      <Text
        accessibilityLabel={`${label} ${value}`}
        style={{ fontFamily: t.statValue.fontFamily, fontSize: 15, color: color.ink }}
      >
        {value}
      </Text>
      <Arrow dir="›" on={nextEnabled} press={onNext} />
    </View>
  );
}

/** Sub-heading inside a section, for the fields grouped under one header. */
function FieldLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <Label size="sm" tone="ink" style={{ marginTop: first ? 0 : 22, marginBottom: 8 }}>
      {children}
    </Label>
  );
}

export default function ProfileScreen() {
  const {
    state, dispatch, commitProfile, commitEquipment, profileError, refreshProfile,
    plan, refreshToday, preferences, setPreference,
  } = useApp();

  /** Only what the athlete actually said; neutral is the absence of a row. */
  const statedCount = Object.keys(preferences).length;
  const { email, signOut, deleteAccount, status } = useSession();
  const dialog = useDialog();
  const tour = useTour();
  const router = useRouter();
  const { profile } = state;

  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Screen-local presentation state. It is deliberately not in the reducer:
  // nothing outside this screen reads it and no engine input depends on it.
  const [open, setOpen] = useState({
    about: false, goal: false, equipment: false, schedule: false,
    length: false, preferences: false, considerations: false, account: false,
  });
  const toggle = (k: keyof typeof open) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const now = new Date();
  const birth = profile.postpartum_birth_date
    ? parseISODate(profile.postpartum_birth_date) : null;
  const months = monthsPostpartum(profile.postpartum_birth_date, now);
  const minYear = now.getFullYear() - 10;
  const predictability = nearestPredictability(profile.schedule_predictability);

  /**
   * The choices this app offers, plus anything already stored that is not one
   * of them. A consideration set elsewhere still constrains programming, so it
   * has to be visible and removable here rather than silently in force.
   */
  const considerationRows = [
    ...CONSIDERATION_CHOICES,
    ...profile.considerations.filter(c => !CONSIDERATION_CHOICES.includes(c)),
  ];

  function setBirth(year: number, month0: number) {
    const date = toISODate(year, month0 + 1);
    dispatch({ type: 'set_postpartum_date', date });
    commitProfile({ postpartum_birth_date: date });
  }

  function clearBirth() {
    dispatch({ type: 'set_postpartum_date', date: null });
    commitProfile({ postpartum_birth_date: null });
  }

  async function confirmSignOut() {
    const ok = await dialog.confirm({
      eyebrow: 'Account',
      title: 'Log out?',
      body: 'Your training data stays on your account. You can sign back in any time.',
      confirmLabel: 'Log out',
    });
    if (!ok) return;

    setSigningOut(true);
    try {
      await signOut();
      // No navigation: the session listener clears status and the auth gate
      // routes to sign-in, so there is one way out of the app.
    } catch (e) {
      await dialog.alert({
        title: 'Could not log out',
        body: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setSigningOut(false);
    }
  }

  /**
   * Account deletion, in two prompts.
   *
   * The first says what goes; the second is the point of no return, and is
   * separate because the two questions are different. "Do you want to delete
   * your account" is answered by reading; "there is no undo" is answered by
   * deciding, and a single dialog collapses them into one tap that is easy to
   * make by accident from a list of settings rows.
   *
   * Nothing navigates on success: the account is gone, so the session listener
   * sees the cleared token and the auth gate routes to sign-in — the same exit
   * logging out uses.
   */
  async function confirmDeleteAccount() {
    const understood = await dialog.confirm({
      eyebrow: 'Delete account',
      title: 'Delete your account?',
      body: 'This removes your account and everything in it — your plan, your '
        + 'completed sessions, your check-ins and your profile. It cannot be undone.',
      confirmLabel: 'Continue',
    });
    if (!understood) return;

    const sure = await dialog.confirm({
      eyebrow: 'Delete account',
      title: 'This cannot be undone',
      body: 'Your training history will be permanently deleted.',
      confirmLabel: 'Delete permanently',
      cancelLabel: 'Keep my account',
    });
    if (!sure) return;

    setDeleting(true);
    try {
      await deleteAccount();
      // No `finally`: on success this component is about to be unmounted by the
      // auth gate, and clearing the flag there would set state on a screen that
      // is going away.
    } catch (e) {
      await dialog.alert({
        title: 'Could not delete your account',
        body: e instanceof Error ? e.message : 'Please try again.',
      });
      setDeleting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 16,
      }}>
        <View style={{
          width: 56, height: 56, backgroundColor: color.ink,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={[t.h4, { fontSize: 20, color: color.onDark }]}>
            {initialsOf(profile.display_name)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[t.h4, { fontSize: 20, color: color.ink }]}>
            {profile.display_name.trim() || 'Unnamed athlete'}
          </Text>
          <Text style={[t.bodySm, { color: color.muted2 }]}>{descriptorOf(profile, now)}</Text>
        </View>
      </View>
      <Rule heavy />

      {/* A failed read and a failed write are different news. This said "Not
          saved" over both, so an athlete whose profile merely failed to load
          was told their answers had been dropped — while the fields below
          showed those same answers, correctly, from the last good read. The
          heading now names which happened, and a read offers the retry. */}
      {profileError ? (
        <View style={{
          marginHorizontal: space.gutter, marginTop: 14,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Label tone="redDark" size="sm" style={{ marginBottom: 4 }}>
            {profileError.kind === 'save' ? 'Not saved' : "Couldn't refresh"}
          </Label>
          <Text style={[t.bodySm, { color: color.redDeep }]}>{profileError.message}</Text>
          {profileError.kind === 'load' ? (
            <>
              <Text style={[t.bodySm, { color: color.redDeep, marginTop: 6 }]}>
                What is shown below is the last version this device read. Nothing
                you have saved has been lost.
              </Text>
              <Pressable
                onPress={refreshProfile}
                accessibilityRole="button"
                accessibilityLabel="Try loading your profile again"
                style={({ pressed }) => ({
                  alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={[t.bodySm, {
                  fontFamily: t.rowTitle.fontFamily, color: color.redDeep,
                }]}>
                  Try again
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      {/* ── About you ────────────────────────────────────
          Name, level and postpartum are one disclosure: they are the fields
          that describe the athlete rather than the training, and all three are
          already summarised in the header above. */}
      <Section
        title="About you"
        open={open.about}
        onToggle={() => toggle('about')}
        // Kept visible whether or not the section is open: the privacy marker
        // describes the stored postpartum field, not the disclosure state.
        badge={<Label size="sm" style={{ letterSpacing: 0.9 }}>Private</Label>}
      >
      <View style={{ paddingHorizontal: space.gutter, paddingBottom: 4 }}>
        <FieldLabel first>Name</FieldLabel>
        <TextInput
          value={profile.display_name}
          onChangeText={name => dispatch({ type: 'set_name', name })}
          // Committed on blur rather than per keystroke: a half-typed name is
          // not a saved name, and it keeps one write per edit.
          onEndEditing={() => commitProfile({ display_name: profile.display_name.trim() })}
          placeholder="Your name"
          placeholderTextColor={color.muted3}
          autoCapitalize="words"
          accessibilityLabel="Name"
          style={{
            borderWidth: 1, borderColor: color.chipBorder,
            paddingHorizontal: 13, paddingVertical: 14,
            fontFamily: t.rowTitle.fontFamily, fontSize: 14, color: color.ink,
          }}
        />

        <FieldLabel>Fitness level</FieldLabel>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {EXPERIENCE_LEVELS.map(level => (
            <Chip
              key={level} flex size="sm" label={levelLabel(level)}
              active={profile.experience_level === level}
              onPress={() => {
                dispatch({ type: 'set_experience', level });
                commitProfile({ experience_level: level });
              }}
              style={{ paddingVertical: 13 }}
            />
          ))}
        </View>
        <Text style={[t.meta, { paddingTop: 10, color: color.muted }]}>
          Sets the starting point for progression. Session difficulty still follows
          your readiness and the day's stimulus.
        </Text>

        <FieldLabel>Postpartum</FieldLabel>
        {birth ? (
          <View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Stepper
                label="month"
                value={MONTHS[birth.getMonth()]}
                onPrev={() => {
                  const m = birth.getMonth() - 1;
                  setBirth(m < 0 ? birth.getFullYear() - 1 : birth.getFullYear(), (m + 12) % 12);
                }}
                onNext={() => {
                  const m = birth.getMonth() + 1;
                  setBirth(m > 11 ? birth.getFullYear() + 1 : birth.getFullYear(), m % 12);
                }}
                prevEnabled={
                  birth.getMonth() > 0 || birth.getFullYear() - 1 >= minYear}
                nextEnabled={
                  birth.getFullYear() < now.getFullYear() ||
                  birth.getMonth() < now.getMonth()}
              />
              <Stepper
                label="year"
                value={String(birth.getFullYear())}
                onPrev={() => setBirth(birth.getFullYear() - 1, birth.getMonth())}
                onNext={() => setBirth(birth.getFullYear() + 1, birth.getMonth())}
                prevEnabled={birth.getFullYear() > minYear}
                nextEnabled={
                  birth.getFullYear() < now.getFullYear() &&
                  // Stepping a year must not land in the future.
                  new Date(birth.getFullYear() + 1, birth.getMonth(), 1) <= now}
              />
            </View>

            {/* Recomputed on every render — the reason a date is stored rather
                than a "9 months postpartum" string. */}
            <View style={{
              flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12,
            }}>
              <Text style={[t.statValue, { color: color.ink }]}>{months ?? 0}</Text>
              <Text style={[t.bodySm, { color: color.muted2 }]}>
                {postpartumPhrase(profile.postpartum_birth_date, now)?.replace(/^\d+\s/, '') ??
                  'months postpartum'}
              </Text>
            </View>

            <Pressable onPress={clearBirth} style={{ paddingVertical: 12 }}>
              <Text style={[t.bodySm, {
                fontFamily: t.rowTitle.fontFamily, color: color.muted2,
              }]}>
                Remove date
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <Chip
              label="Add birth date"
              active={false}
              size="sm"
              onPress={() => setBirth(now.getFullYear(), now.getMonth())}
            />
          </View>
        )}

        <Text style={[t.meta, {
          paddingTop: 10, fontSize: 11.5, lineHeight: 17, color: color.muted,
        }]}>
          Used to track where you are in your return, not to decide what you are
          cleared for. Programming limits stay with the considerations below, and
          only you change those.
        </Text>
      </View>
      </Section>

      <Divider />

      {/* ── Equipment ────────────────────────────────────── */}
      <Section
        title="Equipment"
        open={open.equipment}
        onToggle={() => toggle('equipment')}
        badge={<Label size="sm">{state.equipment.length} selected</Label>}
      >
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: space.gutter, paddingBottom: 4,
      }}>
        {EQUIPMENT_CHOICES.map(e => {
          const on = state.equipment.includes(e.id);
          return (
            <Pressable
              key={e.id}
              onPress={() => {
                dispatch({ type: 'toggle_equipment', id: e.id });
                // The next set, computed here: the reducer's copy is not
                // readable until the next render and the write needs it now.
                commitEquipment(on
                  ? state.equipment.filter(id => id !== e.id)
                  : [...state.equipment, e.id]);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={e.name}
              style={{
                width: '31.5%', minHeight: 56, padding: 12, paddingHorizontal: 10,
                justifyContent: 'flex-end',
                borderWidth: 1, borderColor: on ? color.ink : color.chipBorder,
                backgroundColor: on ? color.ink : 'transparent',
              }}
            >
              <Text style={{
                fontFamily: t.rowTitle.fontFamily, fontSize: 11.5,
                color: on ? color.onDark : color.muted,
              }}>
                {e.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[t.meta, { paddingHorizontal: space.gutter, paddingTop: 10, color: color.muted }]}>
        {state.equipment.length} selected · tap to toggle what you have this week
      </Text>
      </Section>

      <Divider />

      {/* ── Schedule predictability ──────────────────────
          The same 0–1 column onboarding writes (D06). Editing here saves
          straight through, so the answer given once is the answer shown — and
          changing it changes whether shorter variants are built in advance. */}
      <Section
        title="Schedule predictability"
        open={open.schedule}
        onToggle={() => toggle('schedule')}
        badge={<Label size="sm">{predictability.label}</Label>}
      >
      <View style={{ paddingHorizontal: space.gutter }}>
        {/* The bar is the scale the column actually is; the chips are the
            points on it the athlete can pick. */}
        <View style={{ height: 8, backgroundColor: color.rule, marginVertical: 8 }}>
          <View style={{
            height: 8, width: `${Math.round(profile.schedule_predictability * 100)}%`,
            backgroundColor: color.ink,
          }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label size="xs" style={{ letterSpacing: 0.6 }}>Very predictable</Label>
          <Label size="xs" style={{ letterSpacing: 0.6 }}>Unpredictable</Label>
        </View>

        <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
          {PREDICTABILITY_CHOICES.map(c => (
            <Chip
              key={c.value} flex size="sm" label={c.label}
              active={predictability.value === c.value}
              onPress={() => {
                dispatch({ type: 'set_predictability', value: c.value });
                commitProfile({ schedule_predictability: c.value });
              }}
              style={{ paddingVertical: 13 }}
            />
          ))}
        </View>

        <Text style={[t.bodySm, { color: color.muted2, marginTop: 12 }]}>
          Set to <Text style={{ fontFamily: t.rowTitle.fontFamily }}>{predictability.phrase}</Text>.
          {preGeneratesVariants(profile.schedule_predictability)
            ? ' Plans are generated with an Express and a Micro version of every session in advance.'
            : ' Full sessions lead, with shorter variants available on demand from the adapt sheet.'}
        </Text>
      </View>
      </Section>

      <Divider />

      <Section
        title="Typical session length"
        open={open.length}
        onToggle={() => toggle('length')}
        badge={
          <Label size="sm">
            {profile.typical_session_minutes === 90
              ? '90+ min' : `${profile.typical_session_minutes} min`}
          </Label>
        }
      >
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
        {SESSION_MINUTES.map(v => (
          <Chip
            key={v} flex label={v === 90 ? '90+' : String(v)}
            active={profile.typical_session_minutes === v}
            onPress={() => {
              dispatch({ type: 'set_typical', minutes: v });
              commitProfile({ typical_session_minutes: v });
            }}
            style={{ paddingVertical: 12 }}
          />
        ))}
      </View>
      </Section>

      <Divider />

      {/* ── Preferences ──────────────────────────────────── */}
      <Section
        title="What you enjoy"
        open={open.preferences}
        onToggle={() => toggle('preferences')}
        badge={statedCount ? (
          <Label size="sm" style={{ letterSpacing: 0.9 }}>{statedCount} set</Label>
        ) : undefined}
      >
        <View style={{ paddingHorizontal: space.gutter }}>
          {PREFERENCE_OPTIONS.map(option => {
            const rating = preferences[option.value];
            return (
              <View
                key={option.value}
                style={{
                  paddingVertical: 13,
                  borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                }}
              >
                <Text style={{
                  fontFamily: t.greeting.fontFamily, fontSize: 13.5,
                  color: rating ? color.ink : color.muted2,
                }}>
                  {option.label}
                </Text>
                <Text style={[t.meta, { fontSize: 11.5, color: color.muted, marginTop: 1 }]}>
                  {option.hint}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 9 }}>
                  {RATINGS.map(({ key, label }) => (
                    <Chip
                      key={key}
                      flex
                      label={label}
                      active={rating === key}
                      accessibilityLabel={`${option.label}: ${label}`}
                      // Tapping the active choice clears it. Neutral is the
                      // absence of an opinion, which is what no row means and
                      // what the engine already assumes.
                      onPress={() => setPreference(option.value, rating === key ? null : key)}
                    />
                  ))}
                </View>
              </View>
            );
          })}
          <Text style={[t.meta, {
            fontSize: 11.5, lineHeight: 17, color: color.muted, marginTop: 12,
          }]}>
            Preference ranks sessions your plan already allows. It never overrules
            recovery, equipment, or what your race needs — a week short on
            threshold still gives you threshold.
          </Text>
        </View>
      </Section>

      {/* ── Considerations ───────────────────────────────── */}
      <Section
        title="Considerations"
        open={open.considerations}
        onToggle={() => toggle('considerations')}
        badge={<Label size="sm" style={{ letterSpacing: 0.9 }}>Private</Label>}
      >
      <View style={{ paddingHorizontal: space.gutter }}>
        {considerationRows.map(name => {
          const on = profile.considerations.includes(name);
          return (
            <Pressable
              key={name}
              onPress={() => {
                dispatch({ type: 'toggle_consideration', name });
                commitProfile({
                  considerations: on
                    ? profile.considerations.filter(c => c !== name)
                    : [...profile.considerations, name],
                });
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={name}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
              }}
            >
              <Text style={{
                fontFamily: t.greeting.fontFamily, fontSize: 13.5,
                color: on ? color.ink : color.muted2,
              }}>
                {name}
              </Text>
              <SquareCheck on={on} />
            </Pressable>
          );
        })}
        <Text style={[t.meta, { fontSize: 11.5, lineHeight: 17, color: color.muted, marginTop: 12 }]}>
          Used only to shape programming. Never shown in feeds, shared, or used for
          recommendations outside your plan.
        </Text>
      </View>
      </Section>

      <Divider />

      {/* ── Goal ─────────────────────────────────────────── */}
      <Section
        title="Goal"
        open={open.goal}
        onToggle={() => toggle('goal')}
        badge={
          <Label size="sm">
            {plan.race
              ? plan.race.name
              : plan.phase ? `${plan.phase.total_weeks}-week block` : 'Not set'}
          </Label>
        }
      >
        {isSupabaseConfigured ? (
          <GoalSettings plan={plan} onSaved={refreshToday} />
        ) : (
          <Text style={[t.bodySm, {
            paddingHorizontal: space.gutter, color: color.muted2,
          }]}>
            No account is connected to this build, so the plan is the bundled sample
            one and cannot be rebuilt here.
          </Text>
        )}
      </Section>

      <Divider />

      {/* ── Account ──────────────────────────────────────── */}
      <Section
        title="Account"
        open={open.account}
        onToggle={() => toggle('account')}
        badge={
          <Label size="sm">{status === 'signed_in' ? 'Signed in' : 'This device'}</Label>
        }
      >
      {/* The tour runs once and then never again, which leaves an athlete who
          skipped it — or who comes back to the app a month later — with no way
          to see it. It replays from here, on the screen where "how does this
          work" is already the question being asked. */}
      <ActionButton
        label="Replay the app tour"
        variant="outline"
        arrow={null}
        onPress={() => {
          // Today hosts every highlighted element, so the tour runs there.
          tour.restart();
          router.replace('/today' as never);
        }}
        style={{ marginHorizontal: space.gutter, marginBottom: 14 }}
      />

      {status === 'signed_in' ? (
        <>
          <Text style={[t.bodySm, {
            paddingHorizontal: space.gutter, paddingBottom: 14, color: color.muted2,
          }]}>
            Signed in as <Text style={{ fontFamily: t.rowTitle.fontFamily }}>{email}</Text>
          </Text>
          <ActionButton
            label={signingOut ? 'Logging out…' : 'Log out'}
            variant="outline"
            arrow={null}
            onPress={signingOut ? undefined : confirmSignOut}
            style={{ marginHorizontal: space.gutter, opacity: signingOut ? 0.5 : 1 }}
          />

          <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
            <Rule faint />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete your account"
            accessibilityHint="Permanently deletes your account and all of your training data"
            disabled={deleting}
            onPress={confirmDeleteAccount}
            style={{
              marginHorizontal: space.gutter, marginTop: 14,
              paddingVertical: 14, alignItems: 'center',
              borderWidth: 1, borderColor: color.redDeep,
              opacity: deleting ? 0.5 : 1,
            }}
          >
            <Text style={[t.rowTitle, { fontSize: 14, color: color.redDeep }]}>
              {deleting ? 'Deleting…' : 'Delete account'}
            </Text>
          </Pressable>

          <Text style={[t.meta, {
            fontSize: 11.5, lineHeight: 17, color: color.muted,
            paddingHorizontal: space.gutter, paddingTop: 10,
          }]}>
            Deletes your account and all of your training data for good. There is no
            undo and no recovery period.
          </Text>
        </>
      ) : (
        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, color: color.muted2,
        }]}>
          {isSupabaseConfigured
            ? 'Not signed in. Profile changes stay on this device.'
            : 'No account is connected to this build, so profile changes stay on this device and there is nothing to log out of.'}
        </Text>
      )}
      </Section>
    </ScrollView>
  );
}
