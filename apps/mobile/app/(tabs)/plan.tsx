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
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, SquareCheck, InkPanel } from '@/components/primitives';
import { useApp } from '@/state/store';
import { phaseTitle } from '@/data/plan';

export default function PlanScreen() {
  const router = useRouter();
  const { state, session, plan, switchToQueued } = useApp();

  const travelDays = state.travel?.days.length ?? 0;

  /**
   * Whether there is a program to describe a week of.
   *
   * Without one the screen still drew its whole structure — "This week",
   * "0 / 0 completed", "Up next", "Nothing queued. The week's remaining stimuli
   * are chosen as you train" — under the heading "No plan yet". Every one of
   * those sentences describes a week the athlete does not have, and the
   * completion ratio reads as progress against a target rather than as the
   * absence of one.
   */
  const hasPlan = plan.phase !== null;

  /**
   * Today's session, shown in the completed list once it is done and as the
   * session in progress before that. It is the one row the queue cannot
   * describe, because it is the decision rather than the plan.
   *
   * The tick used to hang on `state.completed_today` alone — "a session was
   * finished today" — and label *whatever the engine now recommends* as
   * completed. Those are the same workout only until the refetch lands: once
   * the finished session is credited, the engine moves to the next stimulus and
   * this row became a workout the athlete had never seen, ticked and dated
   * today. It now follows `plan.pendingCompletion`, which is true only while
   * the session finished here is genuinely missing from the server's week — the
   * one window in which this row and that session are the same thing.
   */
  const todayRow = session.kind === 'session'
    ? {
        key: 'today',
        name: session.template.name,
        note: plan.pendingCompletion ? 'Completed today' : 'Today',
        minutes: session.estimated_minutes,
        done: plan.pendingCompletion,
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

  const todayTemplateId = session.kind === 'session' ? session.template.id : null;

  /**
   * Makes a queued session today's.
   *
   * The week is stimuli in rank order, not a calendar, so the queue is a set of
   * things owed rather than a schedule — which makes "do this one instead"
   * a legitimate answer and not a deviation. Confirmed rather than applied on
   * the tap: it changes what Today offers, and Plan is not where the athlete is
   * looking when it does.
   */
  const chooseQueued = (templateId: string, name: string) => {
    Alert.alert(
      `Do ${name} today?`,
      'It becomes today\'s session. Nothing is marked missed — the rest of the '
      + 'week keeps the same stimuli, in the same order.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Do it today',
          onPress: () => {
            if (!switchToQueued(templateId)) {
              // The engine declined it under today's inputs — low sleep, an
              // impact flag, equipment it cannot substitute around. Saying so
              // beats an override that resolves back to the original session
              // and looks like the tap did nothing.
              Alert.alert(
                'Not today',
                `${name} isn't something this can build from today's check-in and `
                + 'equipment. Adapt today from the Today tab and it will offer what fits.',
              );
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.replace('/today' as never);
          },
        },
      ],
    );
  };

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

      {!hasPlan ? (
        <InkPanel label="Nothing to plan yet" style={{ margin: 20, marginHorizontal: space.gutter }}>
          <Text style={[t.body, { color: color.onDarkSoft }]}>
            A program is built from a race date — the weeks, the phases and what
            each week asks for all come from how long there is until it. Add one
            and this fills in.
          </Text>
        </InkPanel>
      ) : (
      <>
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
        {plan.week.queue.length ? plan.week.queue.map((q, i) => {
          const isToday = q.template_id === todayTemplateId;
          return (
            <Pressable
              key={q.id}
              onPress={isToday ? undefined : () => chooseQueued(q.template_id, q.name)}
              disabled={isToday}
              accessibilityRole={isToday ? 'text' : 'button'}
              accessibilityLabel={isToday
                ? `${q.name}, already today's session`
                : `${q.name}, ${q.stimulus_type.replace(/_/g, ' ')}. Do this one today instead.`}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
                borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              <Text style={[t.labelSm, { width: 20, fontSize: 11, color: color.muted }]}>
                {i + 1}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[t.rowTitle, { color: color.ink }]}>{q.name}</Text>
                <Text style={[t.meta, { color: isToday ? color.red : color.muted }]}>
                  {/* The queue used to list today's session again, at its full
                      duration, directly under the scaled version of itself in
                      "This week" — the same workout twice with two lengths. */}
                  {isToday
                    ? "Today's session"
                    : q.stimulus_type.replace(/_/g, ' ')}
                </Text>
              </View>
              <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
                {q.estimated_minutes ? `${q.estimated_minutes} min` : ''}
              </Text>
            </Pressable>
          );
        }) : (
          <Text style={[t.bodySm, { color: color.muted2, paddingVertical: 10 }]}>
            Nothing queued. The week's remaining stimuli are chosen as you train.
          </Text>
        )}
      </View>

      {plan.week.queue.length > 1 ? (
        <Text style={[t.meta, {
          paddingHorizontal: space.gutter, paddingTop: 10, color: color.muted,
        }]}>
          Tap any of these to do it today instead.
        </Text>
      ) : null}

      <Text style={[t.bodySm, {
        paddingHorizontal: space.gutter, paddingTop: 18, color: color.muted2,
      }]}>
        Stimuli, not weekdays. A session landing a day late doesn't put you behind.
      </Text>
      </>
      )}
    </ScrollView>
  );
}
