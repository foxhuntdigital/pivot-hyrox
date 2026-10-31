/**
 * What a session asks for, in numbers: each block's rounds or clock, then
 * every movement with its quantity ("1000 m Run", "4 × 5 Back Squat"). Shared
 * by Today's session card and Coach's workout answer, so a session reads the
 * same wherever it is offered.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { WorkoutBlock } from '@pivot/engine';

import { color, kindColor, type as t, type SessionKind } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { exerciseById } from '@/data/content';
import { movementKind } from '@/data/sessionShape';
import { blockLabel, formatPrescription } from '@/state/steps';

export function SessionRows({ blocks, kind }: { blocks: WorkoutBlock[]; kind: SessionKind }) {
  return (
    <>
      {blocks.map((b, bi) => (
        <View key={b.id ?? bi} style={{ paddingBottom: 6 }}>
          <Label tone="ink" style={{ paddingBottom: 6 }}>
            {[b.rounds && b.rounds > 1 ? `${b.rounds} rounds` : b.duration_minutes ? `${b.duration_minutes} min` : null,
              blockLabel(b)].filter(Boolean).join(' · ')}
          </Label>
          {b.exercises.map((e, ei) => {
            const ex = exerciseById.get(e.exercise_id);
            const mk = movementKind(ex);
            return (
              <View key={`${e.exercise_id}-${ei}`} style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8,
                borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
              }}>
                {/* A movement that is a kind by itself (a run in a hybrid)
                    wears that kind's colour; the rest wear the session's. */}
                <View style={{ width: 8, height: 8, backgroundColor: kindColor[mk ?? kind] }} />
                <Text style={[t.rowTitle, { width: 78, color: color.ink }]}>{formatPrescription(e)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[t.body, { fontSize: 14, color: color.ink }]}>{ex?.name ?? e.exercise_id}</Text>
                  {e.intensity_note ? (
                    <Text style={[t.meta, { color: color.muted2 }]}>{e.intensity_note}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}
