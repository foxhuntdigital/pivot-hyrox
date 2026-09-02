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
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, SquareCheck, InkPanel } from '@/components/primitives';
import { useDialog } from '@/components/Dialog';
import { WorkoutDetailSheet } from '@/components/WorkoutDetailSheet';
import { useApp } from '@/state/store';
import { phaseTitle } from '@/data/plan';
import type { QueuedSession } from '@/data/todayRepo';

export default function PlanScreen() {
  const router = useRouter();
  const dialog = useDialog();
  const { state, session, plan, switchToQueued } = useApp();

  /** The queued row being read. Null when the detail sheet is closed. */
  const [detail, setDetail] = useState<QueuedSession | null>(null);

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
  // A race plan ends at the event, which announces itself. A block just runs
  // out, so its last week has to say so.
  const isFinalBlockWeek = plan.race === null && plan.phase !== null
    && plan.phase.total_weeks > 0 && plan.phase.week >= plan.phase.total_weeks;

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
   * What is left after today — which is what "Up next" means.
   *
   * Today's session sits in the queue like any other, at whatever rank the week
   * gave it, so it was being listed twice: once above as today's, and again
   * partway down the queue under a "Today's session" label. Position 3 of 7 is
   * not where the athlete is, and a list they read as "what's coming" was
   * quietly counting the thing they are doing now.
   *
   * Labelling it was the earlier attempt at this and it fixed the wrong half:
   * the duplication is the problem, not the ambiguity about which row is which.
   *
   * Only one queue item is removed, and it is the one the server would claim —
   * the lowest-ranked open item for that template (`queue.ts`). A week that
   * genuinely holds the same session twice keeps the second one, because the
   * athlete does still have it to do.
   */
  const claimedToday = todayTemplateId
    ? [...plan.week.queue]
        .sort((a, b) => a.rank - b.rank)
        .find(q => q.template_id === todayTemplateId)
    : undefined;
  const upNext = plan.week.queue.filter(q => q.id !== claimedToday?.id);

  /**
   * Makes a queued session today's.
   *
   * The week is stimuli in rank order, not a calendar, so the queue is a set of
   * things owed rather than a schedule — which makes "do this one instead" a
   * legitimate answer and not a deviation.
   *
   * Called from the detail sheet rather than from the row. The confirmation
   * that used to sit here has been removed rather than relocated: the sheet
   * states what this does directly above its own button, and a dialog asking
   * the same question after the athlete has read the whole prescription would
   * be a step that tells them nothing they have not just read.
   */
  const chooseQueued = async (templateId: string, name: string) => {
    setDetail(null);

    const result = switchToQueued(templateId);

    if (!result.ok && result.reason === 'recovery') {
      // Advice, not a limit — so it is put to the athlete rather than enforced.
      // Same rule as the Adapt sheet's variant choice, because it is the same
      // question: they are asking for more than today's check-in suggests.
      const proceed = await dialog.confirm({
        eyebrow: 'Are you sure?',
        title: `${name} is more than today supports`,
        body: "Based on your check-in, this asks for more than today's "
          + 'recommendation. You can still do it — you know how you feel better '
          + 'than the check-in does. Ease off if it stops feeling right.',
        confirmLabel: 'Do it anyway',
        cancelLabel: 'Not today',
      });
      if (!proceed) return;

      if (!switchToQueued(templateId, { override: true }).ok) {
        await dialog.alert({
          eyebrow: 'Not today',
          title: `${name} could not be applied`,
          body: 'Something about today changed while you were deciding. Try again.',
        });
        return;
      }
    } else if (!result.ok) {
      await dialog.alert({
        eyebrow: 'Not today',
        title: `${name} doesn't fit today`,
        body: result.reason === 'symptom'
          ? 'You reported a symptom that training hard through would not be '
            + 'reasonable. This one is not something to push past — rest today, '
            + 'and get it looked at if it persists.'
          : `${name} isn't something this can build from the equipment and `
            + 'constraints you have reported today. Adapt from the Today tab and '
            + 'it will offer what fits.',
      });
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/today' as never);
  };

  return (
    <>
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 14 }}>
        <Label>Current block</Label>
        <Text style={[t.h2, { marginTop: 4, color: color.ink }]}>
          {plan.phase ? phaseTitle(plan.phase.type) : 'No plan yet'}
        </Text>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          {plan.phase
            ? `Week ${plan.phase.week} of ${plan.phase.total_weeks}`
              + (plan.race ? ` · ${plan.race.name}` : ' · no race entered')
            : 'Set a race, or pick a block length, to generate a program.'}
        </Text>
      </View>

      {/* The last week of a block.
          
          A block ends on a date rather than at an event, so nothing else marks
          the end for the athlete — and a plan that simply stops is the failure
          mode this prompt exists to avoid. It appears only in the final week,
          only without a race, and it decides nothing: both ways out are on
          Profile, where the same controls built the plan in the first place. */}
      {isFinalBlockWeek ? (
        <View style={{
          marginHorizontal: space.gutter, marginBottom: 16,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>Last week of this block</Label>
          <Text style={[t.bodySm, { color: color.redDeep, paddingBottom: 10 }]}>
            Your block ends this week. Enter a race and the next weeks are built
            around the date, or start another block to keep training.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose what comes next, on Profile"
            onPress={() => router.push('/profile' as never)}
            style={({ pressed }) => ({
              alignSelf: 'flex-start', paddingVertical: 6, opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[t.bodySm, {
              fontFamily: t.rowTitle.fontFamily, color: color.redDeep,
            }]}>
              Choose what's next ›
            </Text>
          </Pressable>
        </View>
      ) : null}

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
            A program is built from a runway — the weeks, the phases and what each
            week asks for all come from how long it is. Set a race date, or pick a
            block length if you have nothing entered, and this fills in.
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
        {upNext.length ? upNext.map((q, i) => {
          return (
            <Pressable
              key={q.id}
              onPress={() => setDetail(q)}
              accessibilityRole="button"
              accessibilityLabel={`${q.name}, ${q.stimulus_type.replace(/_/g, ' ')}. `
                + 'View the workout and choose whether to do it today.'}
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
                <Text style={[t.meta, { color: color.muted }]}>
                  {q.stimulus_type.replace(/_/g, ' ')}
                </Text>
              </View>
              <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted }]}>
                {q.estimated_minutes ? `${q.estimated_minutes} min` : ''}
              </Text>
            </Pressable>
          );
        }) : (
          <Text style={[t.bodySm, { color: color.muted2, paddingVertical: 10 }]}>
            {claimedToday
              // The queue is not empty — today's session is the last of it, and
              // saying "nothing queued" under a week that still has a session in
              // it would read as the plan having run out.
              ? "Today's session is the last one this week."
              : "Nothing queued. The week's remaining stimuli are chosen as you train."}
          </Text>
        )}
      </View>

      {upNext.length > 1 ? (
        <Text style={[t.meta, {
          paddingHorizontal: space.gutter, paddingTop: 10, color: color.muted,
        }]}>
          Tap any of these to read the workout and choose whether to do it today.
        </Text>
      ) : null}

      <Text style={[t.bodySm, {
        paddingHorizontal: space.gutter, paddingTop: 18, color: color.muted2,
      }]}>
        Stimuli, not weekdays. A session landing a day late doesn't put you behind.
        {'\n\n'}
        Feeling like something different from what's above? Ask Coach, and the session
        adapts to what you're after today.
      </Text>
      </>
      )}
    </ScrollView>

    {/* Outside the scroller, the way Today mounts the adapt sheet: a Modal
        nested in scrolling content measures against it rather than the screen. */}
    <WorkoutDetailSheet
      queued={detail}
      isToday={detail?.template_id === todayTemplateId}
      onClose={() => setDetail(null)}
      onDoToday={chooseQueued}
    />
    </>
  );
}
