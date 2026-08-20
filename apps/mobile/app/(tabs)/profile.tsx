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
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, Chip, SquareCheck, ActionButton } from '@/components/primitives';
import { useApp } from '@/state/store';
import { useSession } from '@/state/session';
import { isSupabaseConfigured } from '@/lib/supabase';
import { CONSIDERATION_CHOICES } from '@/data/athlete';
import {
  EXPERIENCE_LEVELS, descriptorOf, initialsOf, levelLabel, monthsPostpartum,
  parseISODate, postpartumPhrase, toISODate,
} from '@/data/profile';
import { EQUIPMENT_CHOICES } from '@/data/content';

const TIME_CHOICES = [15, 30, 45, 60, 90];

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

export default function ProfileScreen() {
  const { state, dispatch, commitProfile, profileError } = useApp();
  const { email, signOut, status } = useSession();
  const { profile } = state;

  const [signingOut, setSigningOut] = useState(false);

  const now = new Date();
  const birth = profile.postpartum_birth_date
    ? parseISODate(profile.postpartum_birth_date) : null;
  const months = monthsPostpartum(profile.postpartum_birth_date, now);
  const minYear = now.getFullYear() - 10;

  function setBirth(year: number, month0: number) {
    const date = toISODate(year, month0 + 1);
    dispatch({ type: 'set_postpartum_date', date });
    commitProfile({ postpartum_birth_date: date });
  }

  function clearBirth() {
    dispatch({ type: 'set_postpartum_date', date: null });
    commitProfile({ postpartum_birth_date: null });
  }

  function confirmSignOut() {
    Alert.alert(
      'Log out?',
      'Your training data stays on your account. You can sign back in any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await signOut();
              // No navigation: the session listener clears status and the auth
              // gate routes to sign-in, so there is one way out of the app.
            } catch (e) {
              Alert.alert('Could not log out',
                e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setSigningOut(false);
            }
          },
        },
      ],
    );
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

      {profileError ? (
        <View style={{
          marginHorizontal: space.gutter, marginTop: 14,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Label tone="redDark" size="sm" style={{ marginBottom: 4 }}>Not saved</Label>
          <Text style={[t.bodySm, { color: color.redDeep }]}>{profileError}</Text>
        </View>
      ) : null}

      {/* ── Name ─────────────────────────────────────────── */}
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 7 }}>
        Name
      </Label>
      <View style={{ paddingHorizontal: space.gutter }}>
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
      </View>

      <Divider />

      {/* ── Experience level ─────────────────────────────── */}
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6 }}>
        Fitness level
      </Label>
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
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
      <Text style={[t.meta, { paddingHorizontal: space.gutter, paddingTop: 10, color: color.muted }]}>
        Sets the starting point for progression. Session difficulty still follows
        your readiness and the day's stimulus.
      </Text>

      <Divider />

      {/* ── Postpartum ───────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6,
      }}>
        <Label tone="ink">Postpartum</Label>
        <Label size="sm" style={{ letterSpacing: 0.9 }}>Private</Label>
      </View>

      {birth ? (
        <View style={{ paddingHorizontal: space.gutter }}>
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
        <View style={{ paddingHorizontal: space.gutter }}>
          <Chip
            label="Add birth date"
            active={false}
            size="sm"
            onPress={() => setBirth(now.getFullYear(), now.getMonth())}
          />
        </View>
      )}

      <Text style={[t.meta, {
        paddingHorizontal: space.gutter, paddingTop: 10, fontSize: 11.5,
        lineHeight: 17, color: color.muted,
      }]}>
        Used to track where you are in your return, not to decide what you are
        cleared for. Programming limits stay with the considerations below, and
        only you change those.
      </Text>

      <Divider />

      {/* ── Equipment ────────────────────────────────────── */}
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6 }}>
        Equipment
      </Label>
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: space.gutter, paddingBottom: 4,
      }}>
        {EQUIPMENT_CHOICES.map(e => {
          const on = state.equipment.includes(e.id);
          return (
            <Pressable
              key={e.id}
              onPress={() => dispatch({ type: 'toggle_equipment', id: e.id })}
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

      <Divider />

      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6 }}>
        Schedule predictability
      </Label>
      <View style={{ paddingHorizontal: space.gutter }}>
        <View style={{ height: 8, backgroundColor: color.rule, marginVertical: 8 }}>
          <View style={{
            height: 8, width: `${state.typical_minutes > 45 ? 60 : 28}%`,
            backgroundColor: color.ink,
          }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label size="xs" style={{ letterSpacing: 0.6 }}>Very predictable</Label>
          <Label size="xs" style={{ letterSpacing: 0.6 }}>Unpredictable</Label>
        </View>
        <Text style={[t.bodySm, { color: color.muted2, marginTop: 10 }]}>
          Set to <Text style={{ fontFamily: t.rowTitle.fontFamily }}>mostly unpredictable</Text>.
          Plans are generated with an Express and a Micro version of every session in advance.
        </Text>
      </View>

      <Divider />

      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6 }}>
        Typical session length
      </Label>
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
        {TIME_CHOICES.map(v => (
          <Chip
            key={v} flex label={v === 90 ? '90+' : String(v)}
            active={state.typical_minutes === v}
            onPress={() => dispatch({ type: 'set_typical', minutes: v })}
            style={{ paddingVertical: 12 }}
          />
        ))}
      </View>

      <Divider />

      {/* ── Considerations ───────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6,
      }}>
        <Label tone="ink">Considerations</Label>
        <Label size="sm" style={{ letterSpacing: 0.9 }}>Private</Label>
      </View>
      <View style={{ paddingHorizontal: space.gutter }}>
        {CONSIDERATION_CHOICES.map(name => {
          const on = state.considerations.includes(name);
          return (
            <Pressable
              key={name}
              onPress={() => dispatch({ type: 'toggle_consideration', name })}
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

      <Divider />

      {/* ── Account ──────────────────────────────────────── */}
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6 }}>
        Account
      </Label>
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
    </ScrollView>
  );
}
