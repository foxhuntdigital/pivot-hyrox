/**
 * Shared chrome for the onboarding flow (D02–D08).
 *
 * Seven screens that differ only in their middle: the step counter, heading and
 * footer are identical, so they live here rather than being re-typed and
 * drifting apart.
 */
import React from 'react';
import { ScrollView, Text, View, Pressable, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, Chip, Label, Rule } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { toISODate } from '@/data/profile';
import { useSession } from '@/state/session';

/** D02–D08 inclusive: the steps an athlete actually walks through. */
export const TOTAL_STEPS = 8;

/**
 * The way out of onboarding.
 *
 * Creating an account signs the athlete straight in, and the gate then sends
 * them here — so an account made by mistake, or made when they meant to sign
 * in to an existing one, left them with nowhere to go: `intro` and `trial`
 * both `replace`, so even Back is gone by the second screen, and the only
 * sign-out in the app lives in Profile behind the flow they are stuck in.
 *
 * Signing out is enough on its own. `AuthGate` sends a signed-out athlete to
 * `/sign-in`, so this needs no navigation of its own and cannot disagree with
 * the gate about where they end up.
 *
 * Worded as a question rather than a command: most people seeing it are not
 * trying to leave, and "Sign out" alone reads as an instruction on a screen
 * that is otherwise asking them to continue.
 */
export function SignOutEscape({ style }: { style?: ViewStyle }) {
  const { signOut, status } = useSession();
  if (status !== 'signed_in') return null;

  return (
    <Pressable
      onPress={() => { signOut(); }}
      accessibilityRole="button"
      accessibilityLabel="Not your account? Sign out and go back to sign in"
      style={[{ paddingVertical: 14 }, style]}
    >
      <Text style={[t.bodySm, { color: color.muted2, textAlign: 'center' }]}>
        Not you?{' '}
        <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>
          Sign out
        </Text>
      </Text>
    </Pressable>
  );
}

/**
 * A hairline bar rather than a percentage: the flow is short enough that
 * counting steps is more useful than estimating completion.
 */
function Progress({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: space.gutter }}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 2,
            backgroundColor: i < step ? color.ink : color.rule,
          }}
        />
      ))}
    </View>
  );
}

export function OnboardingStep({
  step,
  title,
  description,
  children,
  onContinue,
  continueLabel = 'Continue',
  canContinue = true,
  onBack,
  onSkip,
  skipLabel,
  busy,
  error,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  onContinue: () => void;
  continueLabel?: string;
  canContinue?: boolean;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  busy?: boolean;
  error?: string | null;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View style={{ paddingTop: insets.top + 12, paddingBottom: 14 }}>
        <Progress step={step} />
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: space.gutter, paddingTop: 14,
        }}>
          <Label tone="muted">{`Step ${step} of ${TOTAL_STEPS}`}</Label>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12}>
              <Label tone="muted">Back</Label>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        // Taps already worked; dragging did not put the keyboard away, which
        // is the gesture people reach for on a form.
        keyboardDismissMode="on-drag"
      >
        <Text style={[t.h1, {
          paddingHorizontal: space.gutter, color: color.ink, paddingBottom: description ? 8 : 18,
        }]}>
          {title}
        </Text>
        {description ? (
          <Text style={[t.bodySm, {
            paddingHorizontal: space.gutter, color: color.muted2, paddingBottom: 18,
          }]}>
            {description}
          </Text>
        ) : null}

        <Rule />
        <View style={{ paddingTop: 18 }}>{children}</View>
      </ScrollView>

      <View style={{
        paddingHorizontal: space.gutter,
        paddingTop: 12,
        paddingBottom: insets.bottom + 12,
        borderTopWidth: 1,
        borderTopColor: color.rule,
      }}>
        {error ? (
          <View style={{
            backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
            paddingHorizontal: 13, paddingVertical: 12, marginBottom: 12,
          }}>
            <Text style={[t.bodySm, { color: color.redDeep }]}>{error}</Text>
          </View>
        ) : null}

        <ActionButton
          label={busy ? 'Working…' : continueLabel}
          variant="primary"
          onPress={canContinue && !busy ? onContinue : undefined}
          style={{ opacity: canContinue && !busy ? 1 : 0.45 }}
        />

        {onSkip ? (
          <Pressable onPress={onSkip} style={{ paddingVertical: 16 }}>
            <Text style={[t.bodySm, { color: color.muted2, textAlign: 'center' }]}>
              {skipLabel ?? 'Skip for now'}
            </Text>
          </Pressable>
        ) : null}

        {/* Present on every step, because the athlete does not always realise
            they are on the wrong account at step one. */}
        <SignOutEscape style={onSkip ? { paddingTop: 2 } : undefined} />
      </View>
    </View>
  );
}

/** A labelled row of chips — the flow's only input idiom besides free text. */
export function ChipRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  columns,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: boolean;
}) {
  return (
    <View style={{ paddingBottom: 20 }}>
      {label ? (
        <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingBottom: 10 }}>
          {label}
        </Label>
      ) : null}
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: space.gutter,
      }}>
        {options.map(o => (
          <Chip
            key={String(o.value)}
            label={o.label}
            active={value === o.value}
            onPress={() => onChange(o.value)}
            size="sm"
            flex={columns}
          />
        ))}
      </View>
    </View>
  );
}

/** The same, for answers that are not mutually exclusive. */
export function MultiChipRow<T extends string>({
  label,
  options,
  values,
  onToggle,
}: {
  label?: string;
  options: { value: T; label: string }[];
  values: T[];
  onToggle: (v: T) => void;
}) {
  return (
    <View style={{ paddingBottom: 20 }}>
      {label ? (
        <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingBottom: 10 }}>
          {label}
        </Label>
      ) : null}
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: space.gutter,
      }}>
        {options.map(o => (
          <Chip
            key={o.value}
            label={o.label}
            active={values.includes(o.value)}
            onPress={() => onToggle(o.value)}
            size="sm"
          />
        ))}
      </View>
    </View>
  );
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Days in a month, so February never offers a 30th. */
function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Year/month/day chosen from chips.
 *
 * Deliberately not `@react-native-community/datetimepicker`: that is a native
 * module, and adding one forces a new development build before anyone can see
 * this screen. Chips cost more taps and no rebuild.
 */
export function DateChooser({
  value,
  onChange,
  minDate,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  minDate: string;
}) {
  const today = new Date(`${minDate}T00:00:00Z`);
  const thisYear = today.getUTCFullYear();
  const years = [thisYear, thisYear + 1];

  const parsed = value ? new Date(`${value}T00:00:00Z`) : null;
  const year = parsed?.getUTCFullYear() ?? thisYear;
  const month = parsed ? parsed.getUTCMonth() + 1 : null;
  const day = parsed?.getUTCDate() ?? null;

  function set(y: number, m: number | null, d: number | null) {
    if (m == null) return;
    // Clamp rather than reject: moving from the 31st to February should land on
    // the 28th, not silently clear the answer.
    const maxDay = daysInMonth(y, m);
    onChange(toISODate(y, m, Math.min(d ?? 1, maxDay)));
  }

  return (
    <View>
      <ChipRow
        label="Year"
        options={years.map(y => ({ value: y, label: String(y) }))}
        value={year}
        onChange={y => set(y, month, day)}
      />
      <ChipRow
        label="Month"
        options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
        value={month}
        onChange={m => set(year, m, day)}
      />
      {month ? (
        <ChipRow
          label="Day"
          options={Array.from({ length: daysInMonth(year, month) }, (_, i) => ({
            value: i + 1, label: String(i + 1),
          }))}
          value={day}
          onChange={d => set(year, month, d)}
        />
      ) : null}
    </View>
  );
}
