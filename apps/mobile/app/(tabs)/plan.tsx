/**
 * D16 Plan week + D17 Race roadmap.
 *
 * The organising idea (PRD §2): completion is measured against required weekly
 * stimuli, not weekdays. Sessions carry a stimulus label rather than a day, and
 * an unscheduled session is "unscheduled", never "missed".
 */
import React from 'react';
import { View, Text, ScrollView } from 'react-native';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton, SquareCheck } from '@/components/primitives';
import { useApp } from '@/state/store';
import { PHASE, WEEK_STIMULI } from '@/data/athlete';
import { templateById } from '@/data/content';

/** Completed work this week, plus what the queue still holds. */
const COMPLETED = [
  { name: 'Ski Zone 2 30', note: 'Completed · aerobic base', mins: '30 min' },
  { name: 'HYROX Legs A', note: 'Completed · strength', mins: '65 min' },
  { name: 'Zone 2 Run 45', note: 'Completed · aerobic base', mins: '45 min' },
  { name: 'Ski 5x500', note: 'Completed · threshold', mins: '35 min' },
];

const QUEUE_DEFAULT = [
  { id: 'wo_hyrox_pull_a', note: 'Ski + sled pull + pulling volume' },
  { id: 'wo_long_hybrid_60', note: 'Run / station alternating' },
  { id: 'wo_recovery_spin_mobility', note: 'Z1 flush' },
];

const QUEUE_REORDERED = [
  { id: 'wo_recovery_spin_mobility', note: 'Moved up — yesterday’s load ran 18% high', flag: true },
  { id: 'wo_long_hybrid_60', note: 'Now later this week' },
  { id: 'wo_hyrox_pull_a', note: 'After the flush' },
];

export default function PlanScreen() {
  const { state, dispatch, session } = useApp();

  const weekDone = WEEK_STIMULI.reduce((n, r) => n + r.completed_exposures, 0)
    + (state.completed_today ? 1 : 0);
  const weekTarget = WEEK_STIMULI.reduce((n, r) => n + r.target_exposures, 0);
  const queue = state.queue_reordered ? QUEUE_REORDERED : QUEUE_DEFAULT;

  const todayRow = session.kind === 'session'
    ? {
        name: session.template.name,
        note: state.completed_today ? 'Completed today' : 'Today',
        mins: `${session.estimated_minutes} min`,
        done: state.completed_today,
      }
    : null;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 14 }}>
        <Label>Current block</Label>
        <Text style={[t.h2, { marginTop: 4, color: color.ink }]}>{PHASE.name}</Text>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          Week {PHASE.week} of {PHASE.total_weeks} · {PHASE.type} phase
        </Text>
      </View>

      {/* Race roadmap: one bar per week of the program. */}
      <View
        style={{ flexDirection: 'row', gap: 3, paddingHorizontal: space.gutter, paddingBottom: 16 }}
        accessibilityLabel={`Week ${PHASE.week} of ${PHASE.total_weeks}`}
      >
        {Array.from({ length: PHASE.total_weeks }, (_, i) => (
          <View key={i} style={{
            flex: 1, height: 22,
            backgroundColor: i < PHASE.week - 1 ? color.ink
              : i === PHASE.week - 1 ? color.red : color.rule,
          }} />
        ))}
      </View>
      <Rule heavy />

      <View style={{
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 8,
      }}>
        <Label tone="ink">This week</Label>
        <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
          {weekDone} / {weekTarget} completed
        </Text>
      </View>

      <View style={{ paddingHorizontal: space.gutter }}>
        {[...COMPLETED.map(c => ({ ...c, done: true })), ...(todayRow ? [todayRow] : [])].map((s, i) => (
          <View key={`${i}-${s.name}`} style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
            borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
          }}>
            <View style={{ width: 22 }}><SquareCheck on={s.done} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[t.rowTitle, { color: s.done ? color.ink : color.muted2 }]}>
                {s.name}
              </Text>
              <Text style={[t.meta, { color: color.muted }]}>{s.note}</Text>
            </View>
            <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
              {s.mins}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 8 }}>
        <Rule heavy />
      </View>
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 4 }}>
        Up next
      </Label>

      <View style={{ paddingHorizontal: space.gutter }}>
        {queue.map((q, i) => {
          const tpl = templateById.get(q.id);
          return (
            <View key={q.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
              borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
            }}>
              <Text style={[t.labelSm, { width: 20, fontSize: 11, color: color.muted }]}>
                {i + 1}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[t.rowTitle, { color: color.ink }]}>{tpl?.name ?? q.id}</Text>
                <Text style={[t.meta, { color: 'flag' in q && q.flag ? color.redDark : color.muted }]}>
                  {q.note}
                </Text>
              </View>
              <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
                {tpl?.estimated_minutes} min
              </Text>
            </View>
          );
        })}
      </View>

      <ActionButton
        variant="outline"
        arrow="↕"
        label={state.queue_reordered ? 'Restore original order' : 'Let the engine reorder'}
        onPress={() => dispatch({ type: 'toggle_queue_order' })}
        style={{ margin: 16, marginHorizontal: space.gutter, paddingVertical: 15 }}
      />

      <Text style={[t.bodySm, {
        paddingHorizontal: space.gutter, paddingTop: 14, color: color.muted2,
      }]}>
        Stimuli, not weekdays. A session landing a day late doesn't put you behind.
      </Text>
    </ScrollView>
  );
}
