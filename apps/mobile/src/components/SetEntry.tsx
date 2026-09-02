/**
 * What the athlete lifted, asked once per working set.
 *
 * This is the field the whole adaptation loop was missing. `set_logs` has
 * carried `actual_load` since the first migration and it has never once been
 * written, because nothing ever asked — so every set on record is the
 * prescription copied onto itself, and no progression could read it without
 * reading its own instructions back.
 *
 * Three rules shape the design:
 *
 *   * **Nothing here blocks Next.** RPE is optional by contract, and an athlete
 *     mid-set is not filling in a form. A set with no entry still completes and
 *     still counts; it is recorded as `asserted` rather than as evidence.
 *   * **Reps are prefilled, weight is not.** The prescription is a real answer
 *     for reps until the athlete says otherwise, so it shows as a placeholder
 *     they can accept by doing nothing. Nobody can guess the weight, so the
 *     field starts empty rather than pretending.
 *   * **Carry-forward comes from this session only.** The weight from the
 *     previous set of the same movement is something that actually happened
 *     twenty seconds ago. A cross-session "last time" needs comparable history
 *     the server does not serve yet, and inventing one here would be exactly
 *     the fabricated prior the performance rules forbid.
 */
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Label } from './primitives';
import { color, type as t } from '../theme/tokens';
import type { SetEntry as Entry } from '../state/actuals';

/** RPE values worth one tap. Below 5 an athlete types it or leaves it. */
const RPE_CHOICES = [6, 7, 8, 9, 10];

function Field({
  label, value, placeholder, suffix, onChange, accessibilityLabel,
}: {
  label: string;
  value: number | null | undefined;
  placeholder?: string;
  suffix?: string;
  onChange: (v: number | null) => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.26 }}>{label}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <TextInput
          accessibilityLabel={accessibilityLabel}
          value={value == null ? '' : String(value)}
          placeholder={placeholder}
          placeholderTextColor={color.muted3}
          keyboardType="numeric"
          returnKeyType="done"
          selectTextOnFocus
          onChangeText={text => {
            const cleaned = text.replace(/[^0-9.]/g, '');
            if (cleaned === '') return onChange(null);
            const n = Number(cleaned);
            onChange(Number.isFinite(n) ? n : null);
          }}
          style={[
            t.h2,
            {
              color: color.onDark,
              marginTop: 2,
              paddingVertical: 6,
              paddingRight: 4,
              minWidth: 52,
              // The system has no rounded corners anywhere; an input is a
              // number sitting on a rule, like every other value on this screen.
              borderBottomWidth: 1,
              borderBottomColor: color.ruleDark,
            },
          ]}
        />
        {suffix ? (
          <Text style={[t.meta, { color: color.muted3, marginLeft: 6 }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function SetEntryRow({
  entry, prescribedReps, targetRpe, carryWeight, unit, logsLoad, onChange,
}: {
  entry: Entry;
  /** Shown as the reps placeholder, so accepting it costs nothing. */
  prescribedReps: number | null;
  targetRpe: number | null;
  /** The weight from the previous set of this movement, this session. */
  carryWeight: number | null;
  unit: 'lb' | 'kg';
  /** False for bodyweight work, which has nothing to put on the bar. */
  logsLoad: boolean;
  onChange: (patch: Entry) => void;
}) {
  const showCarry = logsLoad && carryWeight != null && entry.weight == null;

  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ height: 1, backgroundColor: color.ruleDark }} />

      <View style={{ flexDirection: 'row', paddingTop: 12, gap: 16 }}>
        {logsLoad ? (
          <Field
            label="Weight"
            accessibilityLabel="Weight lifted"
            value={entry.weight}
            placeholder="—"
            suffix={unit}
            onChange={v => onChange({ weight: v, unit })}
          />
        ) : null}
        <Field
          label="Reps"
          accessibilityLabel="Reps completed"
          value={entry.reps}
          placeholder={prescribedReps == null ? '—' : String(prescribedReps)}
          onChange={v => onChange({ reps: v })}
        />
      </View>

      {showCarry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Use ${carryWeight} ${unit}, the same as your last set`}
          onPress={() => onChange({ weight: carryWeight, unit })}
          style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}
        >
          {/* Sized and weighted as the control it is: at 11pt regular it read
              as a caption under the field, and the one tap that fills the
              weight in looked like something the screen was telling you. The
              leading arrow is the same cue "See all ›" carries in the header. */}
          <Text style={[t.meta, {
            fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.salmon,
          }]}>
            → Same as last set · {carryWeight} {unit}
          </Text>
        </Pressable>
      ) : null}

      {/* RPE last and visibly optional: it is the field most likely to be
          skipped, and the one that must never look like it is holding up the
          session. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 10, gap: 8 }}>
        <Label tone="onDarkMuted" size="sm" style={{ letterSpacing: 1.26 }}>
          RPE{targetRpe ? ` · target ${targetRpe}` : ''}
        </Label>
        <View style={{ flexDirection: 'row', gap: 6, marginLeft: 'auto' }}>
          {RPE_CHOICES.map(n => {
            const on = entry.rpe === n;
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`RPE ${n}`}
                // Tapping the chosen value again clears it: a mis-tap must be
                // undoable without a separate control.
                onPress={() => onChange({ rpe: on ? null : n })}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderWidth: 1,
                  borderColor: on ? color.salmon : color.ruleDark,
                  backgroundColor: on ? color.salmon : 'transparent',
                }}
              >
                <Text style={[t.meta, { color: on ? color.ink : color.muted3 }]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
