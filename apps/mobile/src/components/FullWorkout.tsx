/**
 * The prescription in full, collapsed by default, on any card that offers a
 * workout.
 *
 * The card summarised each block as its exercise names — "Run · SkiErg · Farmer
 * Carry · Sandbag Walking Lunge · Wall Ball" — which says what the session
 * touches but not what it asks for. There was nowhere in the app to read the
 * distances, reps, loads and rest before committing to Start; the first time an
 * athlete saw the actual numbers was one step at a time inside the player, by
 * which point they had already begun.
 *
 * Quantities are formatted by `formatPrescription` from `state/steps`, the same
 * function the player uses, so what is promised here and what is asked for
 * there cannot drift apart.
 */
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';

import type { WorkoutBlock } from '@pivot/engine';
import { color, type as t } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { exerciseById } from '@/data/content';
import { mmss } from '@/lib/format';
import { blockLabel, formatPrescription, titleCase } from '@/state/steps';

/** How the block's own volume reads at a glance: "3 rounds", "12 min". */
function blockVolume(block: WorkoutBlock): string | null {
  if (block.rounds && block.rounds > 1) return `${block.rounds} rounds`;
  if (block.duration_minutes) return `${block.duration_minutes} min`;
  return null;
}

function ExerciseRow({
  quantity, name, note,
}: { quantity: string; name: string; note: string | null }) {
  return (
    <View style={{
      flexDirection: 'row', gap: 12, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
    }}>
      {/* The number leads, the way it does on a whiteboard and in the player. */}
      <Text style={[t.rowTitle, { fontSize: 12.5, width: 62, color: color.ink }]}>
        {quantity}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: t.greeting.fontFamily, fontSize: 12.5, color: color.ink }}>
          {name}
        </Text>
        {note ? (
          <Text style={[t.meta, { color: color.muted, marginTop: 1 }]}>{note}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function FullWorkout({
  blocks, intensity, totalMinutes, defaultOpen = false,
}: {
  blocks: WorkoutBlock[];
  /** The template's authored intensity target, e.g. "RPE 6". */
  intensity: string | null;
  totalMinutes: number;
  /**
   * Start expanded. On a card the prescription is a disclosure, because the
   * card is a decision surface and the numbers are the detail behind it. In a
   * view whose whole purpose is the workout, the numbers are the point and
   * hiding them behind a tap would be a disclosure over a disclosure.
   */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!blocks.length) return null;

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: color.rule }}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Full workout as prescribed"
        accessibilityHint={open ? 'Collapse the prescription' : 'Expand to read every set before starting'}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingVertical: 12,
          backgroundColor: pressed ? color.hover : 'transparent',
        })}
      >
        <Label tone="ink" size="sm">Full workout</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Label size="sm">
            {open ? 'Hide' : `${blocks.length} block${blocks.length === 1 ? '' : 's'}`}
          </Label>
          {/* The same typographic caret Profile's disclosures use — the design
              has no icon set. */}
          <Text style={{
            fontFamily: t.rowTitle.fontFamily, fontSize: 15, color: color.muted,
            transform: [{ rotate: open ? '90deg' : '0deg' }],
          }}>
            ›
          </Text>
        </View>
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          {blocks.map((block, i) => {
            const volume = blockVolume(block);
            return (
              <View key={block.id ?? i} style={{ paddingTop: i === 0 ? 0 : 16 }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'baseline',
                  justifyContent: 'space-between', paddingBottom: 4,
                }}>
                  <Label tone="ink" size="sm">
                    {block.title ?? blockLabel(block)}
                  </Label>
                  {volume ? <Label size="sm">{volume}</Label> : null}
                </View>

                {block.instructions ? (
                  <Text style={[t.meta, { color: color.muted2, paddingBottom: 6 }]}>
                    {block.instructions}
                  </Text>
                ) : null}

                {block.exercises.map((be, j) => (
                  <ExerciseRow
                    key={`${be.exercise_id}-${j}`}
                    quantity={formatPrescription(be)}
                    name={exerciseById.get(be.exercise_id)?.name
                      ?? titleCase(be.exercise_id.replace(/^ex_/, ''))}
                    note={be.intensity_note ?? null}
                  />
                ))}

                {/* Rest is structure rather than work, so it sits under the
                    round it separates instead of being listed as an exercise. */}
                {block.rest_seconds && (block.rounds ?? 1) > 1 ? (
                  <Text style={[t.meta, { color: color.muted, paddingTop: 7 }]}>
                    {mmss(block.rest_seconds)} rest between rounds
                  </Text>
                ) : null}
              </View>
            );
          })}

          <View style={{
            flexDirection: 'row', justifyContent: 'space-between',
            borderTopWidth: 1, borderTopColor: color.rule, marginTop: 14, paddingTop: 10,
          }}>
            <Label size="sm">Total {totalMinutes} min</Label>
            {/* Named as the authored target rather than a pace: a pace claim
                needs a measured baseline this athlete may not have yet. */}
            {intensity ? <Label size="sm">Target {intensity}</Label> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
