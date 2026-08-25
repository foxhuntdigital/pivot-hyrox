/**
 * D16 Plan week + D17 Race roadmap.
 *
 * The organising idea (PRD §2): completion is measured against required weekly
 * stimuli, not weekdays. Sessions carry a stimulus label rather than a day, and
 * an unscheduled session is "unscheduled", never "missed".
 *
 * The queue is rendered in the rank the engine holds it in. It used to show
 * weekdays — Thursday, Friday, Saturday — which the schema has no column for
 * and the engine has no concept of; they were authored alongside the fixture.
 * Rank is what the week actually is.
 */
import React from 'react';
import { View, Text, ScrollView } from 'react-native';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, SquareCheck } from '@/components/primitives';
import { useApp } from '@/state/store';
import { phaseTitle } from '@/data/plan';

export default function PlanScreen() {
  const { state, session, plan } = useApp();

  const travelDays = state.travel?.days.length ?? 0;

  /**
   * Today's session, shown in the completed list once it is done and as the
   * session in progress before that. It is the one row the queue cannot
   * describe, because it is the decision rather than the plan.
   */
  const todayRow = session.kind === 'session'
    ? {
        key: 'today',
        name: session.template.name,
        note: state.completed_today ? 'Completed today' : 'Today',
        minutes: session.estimated_minutes,
        done: state.completed_today,
      }
    : null;

  const completedRows = plan.week.completed.map(c => ({
    key: c.session_id,
    name: c.name,
    note: [
      'Completed',
      c.stimulus?.replace(/_/g, ' '),
      c.ended_early ? 'ended early' : null,
    ].filter(Boolean).join(' · '),
    minutes: c.estimated_minutes,
    done: true,
  }));

  const rows = [...completedRows, ...(todayRow ? [todayRow] : [])];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 14 }}>
        <Label>Current block</Label>
        <Text style={[t.h2, { marginTop: 4, color: color.ink }]}>
          {plan.phase ? phaseTitle(plan.phase.type) : 'No plan yet'}
        </Text>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          {plan.phase
            ? `Week ${plan.phase.week} of ${plan.phase.total_weeks}`
              + (plan.race ? ` · ${plan.race.name}` : '')
            : 'Set a race to generate a program.'}
        </Text>
      </View>

      {/* Race roadmap: one bar per week of the program. */}
      {plan.phase && plan.phase.total_weeks > 0 ? (
        <View
          style={{ flexDirection: 'row', gap: 3, paddingHorizontal: space.gutter, paddingBottom: 16 }}
          accessibilityLabel={`Week ${plan.phase.week} of ${plan.phase.total_weeks}`}
        >
          {Array.from({ length: plan.phase.total_weeks }, (_, i) => (
            <View key={i} style={{
              flex: 1, height: 22,
              backgroundColor: i < plan.phase!.week - 1 ? color.ink
                : i === plan.phase!.week - 1 ? color.red : color.rule,
            }} />
          ))}
        </View>
      ) : null}
      <Rule heavy />

      <View style={{
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 8,
      }}>
        <Label tone="ink">This week</Label>
        <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
          {plan.week.done} / {plan.week.target} completed
        </Text>
      </View>

      <View style={{ paddingHorizontal: space.gutter }}>
        {rows.length ? rows.map(row => (
          <View key={row.key} style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
            borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
          }}>
            <View style={{ width: 22 }}><SquareCheck on={row.done} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[t.rowTitle, { color: row.done ? color.ink : color.muted2 }]}>
                {row.name}
              </Text>
              <Text style={[t.meta, { color: color.muted }]}>{row.note}</Text>
            </View>
            <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
              {row.minutes ? `${row.minutes} min` : ''}
            </Text>
          </View>
        )) : (
          <Text style={[t.bodySm, { color: color.muted2, paddingVertical: 10 }]}>
            Nothing completed yet this week.
          </Text>
        )}
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 8 }}>
        <Rule heavy />
      </View>
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 4 }}>
        Up next
      </Label>

      {/* A travel change confirmed in Coach narrows equipment for the days it
          covers. It is stated once against the queue rather than pinned to a
          named day, which is not something the queue holds. */}
      {travelDays ? (
        <Text style={[t.meta, {
          paddingHorizontal: space.gutter, paddingBottom: 6, color: color.redDark,
        }]}>
          Travel equipment · applied from Coach for {travelDays} day{travelDays === 1 ? '' : 's'}
        </Text>
      ) : null}

      <View style={{ paddingHorizontal: space.gutter }}>
        {plan.week.queue.length ? plan.week.queue.map((q, i) => (
          <View key={q.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
            borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
          }}>
            <Text style={[t.labelSm, { width: 20, fontSize: 11, color: color.muted }]}>
              {i + 1}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[t.rowTitle, { color: color.ink }]}>{q.name}</Text>
              <Text style={[t.meta, { color: color.muted }]}>
                {q.stimulus_type.replace(/_/g, ' ')}
              </Text>
            </View>
            <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
              {q.estimated_minutes ? `${q.estimated_minutes} min` : ''}
            </Text>
          </View>
        )) : (
          <Text style={[t.bodySm, { color: color.muted2, paddingVertical: 10 }]}>
            Nothing queued. The week's remaining stimuli are chosen as you train.
          </Text>
        )}
      </View>

      <Text style={[t.bodySm, {
        paddingHorizontal: space.gutter, paddingTop: 18, color: color.muted2,
      }]}>
        Stimuli, not weekdays. A session landing a day late doesn't put you behind.
      </Text>
    </ScrollView>
  );
}
