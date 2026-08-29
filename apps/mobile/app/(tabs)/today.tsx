/**
 * D09 Today — the daily decision surface.
 *
 * Acceptance criteria (PRD §8.3): race and days remaining above the fold;
 * recommendation name, purpose, duration and variant visible without
 * scrolling; Start is the dominant CTA and Adapt is obviously available; a
 * neutral state instead of fabricated precision when data is thin.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { VARIANT_LABEL } from '@pivot/engine';
import { color, numeralTrim, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton, InkPanel, Slab } from '@/components/primitives';
import { AdaptSheet } from '@/components/AdaptSheet';
import { FullWorkout } from '@/components/FullWorkout';
import { TourSpot } from '@/components/Tour';
import { useTour } from '@/state/tour';
import { useApp } from '@/state/store';
import { PHASE_LABEL, type PhaseView } from '@/data/plan';
import { firstNameOf } from '@/data/profile';
import { exerciseById } from '@/data/content';
import { hoursToClock, LOW_SLEEP_HOURS } from '@/lib/format';
import { track } from '@/lib/analytics';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * The phase ribbon: completed dark, current red, upcoming grey.
 *
 * One bar per phase of this athlete's program rather than a fixed six — a
 * shorter build has fewer phases, and the ribbon should show the plan they
 * actually have. Bars are weighted by the weeks each phase holds, so the
 * ribbon reads as a timeline rather than as six equal steps.
 */
function PhaseBars({ phase }: { phase: PhaseView }) {
  const currentIndex = phase.sequence.findIndex(p => p.type === phase.type);
  if (!phase.sequence.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter, paddingBottom: 16 }}>
      {phase.sequence.map((p, i) => {
        const isCurrent = i === currentIndex;
        const isDone = currentIndex >= 0 && i < currentIndex;
        return (
          <View key={`${p.type}-${p.order}`} style={{ flex: Math.max(1, p.weeks), gap: 5 }}>
            <View style={{
              height: 4,
              backgroundColor: isCurrent ? color.red : isDone ? color.ink : color.rule,
            }} />
            <Text numberOfLines={1} style={[t.labelXs, {
              color: isCurrent ? color.red : isDone ? color.ink : color.muted3,
            }]}>
              {PHASE_LABEL[p.type] ?? p.type}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function StatCell({ label, children, last }: {
  label: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <View style={{
      flex: 1, paddingTop: 12, paddingBottom: 14, paddingHorizontal: 14,
      borderRightWidth: last ? 0 : 1, borderRightColor: color.rule,
    }}>
      <Label size="sm">{label}</Label>
      <View style={{ marginTop: 4 }}>{children}</View>
    </View>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const {
    state, session, readiness, sleep, plan, beginSession, todayError, refreshToday,
  } = useApp();
  const [sheetOpen, setSheetOpen] = useState(false);
  const scroller = useRef<ScrollView | null>(null);

  /**
   * The first-run tour points at this screen's own controls, so this screen
   * both hosts it and lends it a way to scroll a target into view. It runs at
   * most once per athlete; `maybeStart` is safe to call on every render.
   */
  const tour = useTour();
  const { registerScroller, maybeStart } = tour;
  useEffect(() => {
    registerScroller(y => scroller.current?.scrollTo({
      // Leave the header and a little context above the highlighted element
      // rather than pinning it to the very top of the viewport.
      y: Math.max(0, y - 160), animated: true,
    }));
    return () => registerScroller(null);
  }, [registerScroller]);

  // Only once there is a plan to explain: a tour of an empty Today would point
  // at "No race set" and a session that is not there.
  const hasPlan = plan.phase !== null;
  useEffect(() => {
    if (hasPlan) maybeStart();
  }, [hasPlan, maybeStart]);

  /**
   * On focus rather than on mount: Today is a tab, so it stays mounted while
   * the athlete is on Plan or Coach, and a mount effect would count the day's
   * first open and nothing after it. §16.1's decision-latency KPI measures from
   * Today opening, which means every return counts.
   */
  const phase = plan.phase?.type ?? 'unknown';
  const family = session.kind === 'session' ? session.template.workout_family : null;
  const variant = session.kind === 'session' ? session.variant.variant_code : null;
  useFocusEffect(
    useCallback(() => {
      track({
        name: 'today_viewed',
        phase,
        recommendation_family: family,
        variant,
      });
    }, [phase, family, variant]),
  );

  /**
   * What the goal line and the big numeral say.
   *
   * Three states, not two. A race counts down in days. A block has no date to
   * count to, so it counts the weeks it has left — the honest equivalent, and
   * the reason this is not a dash: an athlete on a 12-week block has a plan
   * with a horizon, and printing "—" would tell them they have nothing. Only an
   * athlete with no program at all gets the dash, because that is the only one
   * for whom it is true.
   */
  const goal = plan.race
    ? {
        label: 'Next goal',
        title: plan.race.name,
        detail: [plan.race.date_label, plan.race.division].filter(Boolean).join(' · ')
          || 'Add a race to see a countdown',
        value: plan.race.days_remaining ?? '—',
        unit: 'Days',
      }
    : plan.phase
      ? {
          label: 'Current block',
          title: `${plan.phase.total_weeks}-week block`,
          detail: `Week ${plan.phase.week} of ${plan.phase.total_weeks} · no race entered`,
          value: Math.max(0, plan.phase.total_weeks - plan.phase.week + 1),
          unit: 'Weeks left',
        }
      : {
          label: 'Next goal',
          title: 'No race set',
          detail: 'Add a race to see a countdown',
          value: '—' as const,
          unit: 'Days',
        };

  const sleepClock = hoursToClock(sleep.hours);
  // The accent is tied to the engine's own threshold, so red means "this
  // changed today's session" rather than being decorative.
  const isLowSleep = sleep.hours !== null && sleep.hours < LOW_SLEEP_HOURS;

  /**
   * What the daily panel says, and where its buttons go.
   *
   * No check-in yet → it is the way into one, named for what it collects.
   * Checked in → it becomes the adapt offer, and quotes the night back only
   * because the athlete reported it.
   */
  const openCheckin = () => router.push('/checkin');
  const prompt = !state.checkin
    ? {
        label: 'Recovery',
        body: "Tell me how you slept and how you're feeling. It takes about twenty "
          + "seconds, and today's session is recalculated from it.",
        primary: 'Check in',
        onPrimary: openCheckin,
        secondary: 'Adapt today',
        onSecondary: () => setSheetOpen(true),
      }
    : isLowSleep
      ? {
          label: 'Adapt today',
          body: `You logged ${sleepClock} and today's session is `
            + `${session.kind === 'session' ? `${session.estimated_minutes} minutes` : 'long'}. `
            + "Tell me what you actually have and I'll rebuild it.",
          primary: 'Adapt',
          onPrimary: () => setSheetOpen(true),
          secondary: 'Check-in',
          onSecondary: openCheckin,
        }
      : {
          label: 'Adapt today',
          body: `Logged ${sleepClock} sleep. If today looks different from the plan, `
            + "tell me the time you have and I'll rebuild the session.",
          primary: 'Adapt today',
          onPrimary: () => setSheetOpen(true),
          secondary: 'Check-in',
          onSecondary: openCheckin,
        };

  /**
   * The inputs today's options were actually built from, named individually so
   * the sentence below can only claim what is there.
   */
  const lastSession = plan.week.completed[0];
  const factoredIn = [
    sleep.hours !== null ? "Last night's sleep" : null,
    lastSession ? `your last session (${lastSession.name})` : null,
  ].filter((s): s is string => s !== null);

  /**
   * Whether today's training is already done.
   *
   * Two sources, because they cover different moments. `pendingCompletion` is
   * the gap between finishing and the refetch landing, when the server has not
   * heard yet; `completedToday` is the server's own record, filtered to today's
   * local date so an app left open overnight does not keep saying "done".
   */
  const finishedToday = plan.pendingCompletion || plan.week.completedToday.length > 0;
  const doneNames = plan.week.completedToday.length
    ? plan.week.completedToday.map(c => c.name)
    : session.kind === 'session' ? [session.template.name] : [];
  const doneMinutes = plan.week.completedToday.reduce(
    (n, c) => n + (c.estimated_minutes ?? 0), 0)
    || (session.kind === 'session' ? session.estimated_minutes : 0);

  const start = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    beginSession();
    router.push('/active');
  };

  return (
    <>
      <ScrollView ref={scroller} contentContainerStyle={{ paddingBottom: 30 }}>
        <View style={{ paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 16 }}>
          <Text style={[t.greeting, { color: color.ink }]}>
            {greeting()}, {firstNameOf(state.profile.display_name)}
          </Text>
        </View>
        <Rule />

        {/* Why the plan is missing, when it is.
            
            `todayError` was set and never rendered, so a failed fetch looked
            exactly like an athlete with no plan: "No race set", a dash for the
            countdown, no session. Two very different states cannot share one
            silent screen — this one says which it is and offers the retry. */}
        {todayError ? (
          <View style={{
            marginHorizontal: space.gutter, marginTop: 14,
            backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
            paddingHorizontal: 13, paddingVertical: 12,
          }}>
            <Label tone="redDark" size="sm" style={{ marginBottom: 4 }}>
              Couldn't load today
            </Label>
            <Text style={[t.bodySm, { color: color.redDeep }]}>{todayError}</Text>
            <Pressable
              onPress={refreshToday}
              accessibilityRole="button"
              accessibilityLabel="Try loading today again"
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
          </View>
        ) : null}

        {/* Race + countdown, above the fold by construction. */}
        <TourSpot id="race">
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', gap: 12,
          paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 14,
        }}>
          <View style={{ flex: 1 }}>
            <Label style={{ marginBottom: 6 }}>{goal.label}</Label>
            <Text style={[t.h4, { color: color.ink, lineHeight: 21 }]}>
              {goal.title}
            </Text>
            {/* Division is optional on the race, so the separator between the
                date and it is only drawn when both are there. */}
            <Text style={[t.bodySm, { color: color.muted2, marginTop: 2 }]}>
              {goal.detail}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {/* paddingRight offsets the trailing negative letter-spacing, which
                RN subtracts from the measured width and clips the last digit. */}
            <Text style={[t.countdown, numeralTrim.countdown, { color: color.ink, paddingRight: 3 }]}>
              {goal.value}
            </Text>
            <Label>{goal.unit}</Label>
          </View>
        </View>

        {plan.phase ? <PhaseBars phase={plan.phase} /> : null}
        </TourSpot>
        <Rule heavy />

        <TourSpot id="stats">
        <View style={{ flexDirection: 'row' }}>
          {/* This used to read "ON TRACK" as a literal, which it would have
              said however far behind the athlete was. The ratio it was standing
              in front of is the thing worth showing. */}
          <StatCell label="This week">
            <Text style={[t.h4, { fontSize: 15, color: color.ink }]}>
              {plan.week.done}
              <Text style={[t.meta, { color: color.muted }]}>/{plan.week.target} stimuli</Text>
            </Text>
          </StatCell>
          <StatCell label="Readiness">
            <Text style={[t.h4, { fontSize: 15, color: color.ink }]}>
              {readiness.overall ?? '—'}
              <Text style={[t.meta, { color: color.muted }]}>/100</Text>
            </Text>
          </StatCell>
          {/* Self-reported until a wearable is connected (PRD §6.3). With no
              check-in there is nothing to show, and a neutral dash is the
              honest state — not a number (§8.3). */}
          <Pressable
            onPress={() => router.push('/checkin')}
            accessibilityRole="button"
            accessibilityLabel={sleepClock
              ? `Sleep ${sleepClock}, self-reported. Edit your check-in.`
              : 'No check-in yet. Log your recovery.'}
            style={({ pressed }) => ({
              flex: 1, paddingTop: 12, paddingBottom: 14, paddingHorizontal: 14,
              backgroundColor: pressed ? color.hover : 'transparent',
            })}
          >
            <Label size="sm">Sleep</Label>
            <Text style={[t.h4, {
              fontSize: 15, marginTop: 4,
              color: sleepClock === null ? color.muted3
                : isLowSleep ? color.red : color.ink,
            }]}>
              {sleepClock ?? '—'}
            </Text>
          </Pressable>
        </View>
        </TourSpot>
        <Rule />

        {/* The daily prompt, and the way into the check-in.
            
            It used to be labelled "Check in" while opening the Adapt sheet, and
            to open by asserting sleep was low whether or not it was. Both are
            fixed here: the panel asks for the check-in when there isn't one,
            offers to adapt when there is, and only mentions the night when the
            athlete has actually reported it. */}
        {/* Hidden once there is nothing left to offer: the athlete has both
            checked in and adapted, or the session is done. */}
        {!state.completed_today && (!state.checkin || !state.adapted) && (
          <InkPanel label={prompt.label} style={{ paddingHorizontal: space.gutter }}>
            <Text style={[t.body, { color: color.onDarkSoft, maxWidth: 320 }]}>
              {prompt.body}
            </Text>
            {/* Side by side, the way Start/Adapt sits under the session card.
                Equal halves rather than primary-plus-remainder: both labels are
                verbs of similar weight, and an uneven split reads as one of
                them being an afterthought. */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <ActionButton
                label={prompt.primary}
                onPress={prompt.onPrimary}
                style={{ flex: 1, paddingHorizontal: 12 }}
              />
              <ActionButton
                label={prompt.secondary}
                variant="outlineDark"
                arrow={null}
                onPress={prompt.onSecondary}
                style={{ flex: 1, paddingHorizontal: 12 }}
              />
            </View>
          </InkPanel>
        )}

        <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
          <Label>Today's training</Label>
        </View>

        {finishedToday ? (
          /* Done for today. The Start button is withheld rather than offering a
             second session under a heading the athlete has already satisfied —
             and the card states what was logged instead of restating a plan. */
          <View style={{ marginHorizontal: space.gutter, marginTop: 10 }}>
            <Slab>
            <View style={{ borderWidth: 2, borderColor: color.ink }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                padding: 14, paddingHorizontal: 16,
              }}>
                <View style={{
                  width: 26, height: 26, backgroundColor: color.red,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: color.onDark, fontSize: 14 }}>✓</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Label tone="redDark" size="sm" style={{ letterSpacing: 1.26 }}>
                    Completed today
                  </Label>
                  <Text style={[t.h3, { color: color.ink, marginTop: 2 }]}>
                    {doneNames.join(' · ') || 'Session logged'}
                  </Text>
                </View>
                {doneMinutes ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[t.sessionMins, numeralTrim.sessionMins, { color: color.ink }]}>
                      {doneMinutes}
                    </Text>
                    <Label size="sm" style={{ letterSpacing: 1.26 }}>Min</Label>
                  </View>
                ) : null}
              </View>
              <View style={{
                borderTopWidth: 1, borderTopColor: color.rule,
                paddingHorizontal: 16, paddingVertical: 12,
              }}>
                <Text style={[t.bodySm, { color: color.muted2 }]}>
                  Today's stimulus is logged and the week keeps the rest of its
                  sessions. Nothing else is asked of you today.
                </Text>
              </View>
            </View>
            </Slab>
            <ActionButton
              label="See the week"
              variant="outline"
              onPress={() => router.replace('/plan' as never)}
              style={{ marginTop: 10 }}
            />
          </View>
        ) : session.kind === 'session' ? (
          <>
            <TourSpot id="session" style={{
              margin: 10, marginHorizontal: space.gutter, marginBottom: 0,
            }}>
            {/* The one card the screen is built around, lifted off the page.
                The slab is offset down-right in flat colour rather than blurred:
                a soft shadow would be the only soft edge in the app. */}
            <Slab>
            <View style={{ borderWidth: 2, borderColor: color.ink }}>
              <View style={{
                flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.rule,
              }}>
                <View style={{ flex: 1, padding: 14, paddingHorizontal: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <View style={{
                      width: 8, height: 8,
                      backgroundColor: state.adapted ? color.red : color.ink,
                    }} />
                    <Text style={[t.labelSm, {
                      fontSize: 9, letterSpacing: 1.44,
                      color: state.adapted ? color.red : color.ink,
                    }]}>
                      {VARIANT_LABEL[session.variant.variant_code]}
                    </Text>
                  </View>
                  <Text style={[t.h3, { color: color.ink }]}>{session.template.name}</Text>
                  <Text style={[t.bodySm, { color: color.muted2, marginTop: 3 }]}>
                    {session.primary_stimulus.replace(/_/g, ' ')} · {session.template.description}
                  </Text>
                </View>
                <View style={{
                  width: 92, borderLeftWidth: 1, borderLeftColor: color.rule,
                  justifyContent: 'center', paddingLeft: 14,
                }}>
                  <Text style={[t.sessionMins, numeralTrim.sessionMins, { color: color.ink }]}>
                    {session.estimated_minutes}
                  </Text>
                  <Label size="sm" style={{ letterSpacing: 1.26 }}>Min</Label>
                </View>
              </View>

              {/* Rationale. Every adaptation must explain itself (PRD §2). */}
              {state.adapted && (
                <View style={{
                  backgroundColor: color.tint, borderBottomWidth: 1,
                  borderBottomColor: color.tintBorder, padding: 12, paddingHorizontal: 16,
                }}>
                  <Label tone="redDark" size="sm" style={{ letterSpacing: 1.26, marginBottom: 4 }}>
                    Adapted · still on track
                  </Label>
                  <Text style={[t.bodySm, { color: color.redDeep, fontSize: 12.5 }]}>
                    {session.rationale}
                  </Text>
                </View>
              )}

              <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 }}>
                {session.blocks.map((b, i) => (
                  <View key={b.id ?? i} style={{
                    flexDirection: 'row', gap: 12, paddingVertical: 9,
                    borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                  }}>
                    <Text style={[t.rowTitle, { fontSize: 13, width: 56, color: color.ink }]}>
                      {b.rounds && b.rounds > 1 ? `${b.rounds} ×` : `${b.duration_minutes ?? ''} min`}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[t.body, { fontFamily: t.greeting.fontFamily, fontSize: 13, color: color.ink }]}>
                        {b.title ?? b.block_type}
                      </Text>
                      <Text style={[t.meta, { color: color.muted }]}>
                        {b.exercises.map(e =>
                          exerciseById.get(e.exercise_id)?.name ?? e.exercise_id).join(' · ')}
                      </Text>
                    </View>
                  </View>
                ))}
                <Label style={{ paddingTop: 10, letterSpacing: 1.32, fontSize: 11 }}>
                  Total {session.estimated_minutes} min · {session.template.coaching_notes}
                </Label>
              </View>

              {/* The rows above name what the session touches; this is what it
                  actually asks for. Collapsed by default so the card stays a
                  decision surface, but the athlete can read every set before
                  committing rather than meeting the numbers one at a time
                  inside the player. */}
              <FullWorkout
                blocks={session.blocks}
                intensity={session.template.intensity_target ?? null}
                totalMinutes={session.estimated_minutes}
              />
            </View>
            </Slab>
            </TourSpot>

            <TourSpot id="actions" style={{
              flexDirection: 'row', gap: 10,
              paddingHorizontal: space.gutter, paddingTop: 14,
            }}>
              <ActionButton label="Start workout" onPress={start} style={{ flex: 1 }} />
              <ActionButton
                label="Adapt" variant="outline" arrow={null}
                onPress={() => setSheetOpen(true)}
              />
            </TourSpot>
          </>
        ) : (
          /* No valid session. Recovery guidance, not a forced recommendation. */
          <View style={{ marginHorizontal: space.gutter, marginTop: 10 }}>
            <InkPanel label="No session today">
              <Text style={[t.body, { color: color.onDarkSoft }]}>{session.guidance}</Text>
            </InkPanel>
            <ActionButton
              label="Adjust what I have" variant="outline"
              onPress={() => setSheetOpen(true)} style={{ marginTop: 10 }}
            />
          </View>
        )}

        <View style={{ paddingHorizontal: space.gutter, paddingTop: 22, paddingBottom: 8 }}>
          <Rule heavy />
        </View>
        {/* Seven days of training as volume, not as a load score: the app has
            no load model it could defend, and both of these are measured. */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.rule }}>
          <View style={{
            flex: 1, paddingTop: 12, paddingBottom: 14, paddingHorizontal: space.gutter,
            borderRightWidth: 1, borderRightColor: color.rule,
          }}>
            <Label size="sm">Trained 7d</Label>
            <Text style={[t.h4, { fontSize: 20, marginTop: 4, color: color.ink }]}>
              {plan.training7d?.sessions ?? '—'}
              <Text style={[t.bodySm, { color: color.muted }]}> sessions</Text>
            </Text>
          </View>
          <View style={{ flex: 1, paddingTop: 12, paddingBottom: 14, paddingHorizontal: space.gutter }}>
            <Label size="sm">Time 7d</Label>
            <Text style={[t.h4, { fontSize: 20, marginTop: 4, color: color.ink }]}>
              {plan.training7d?.minutes ?? '—'}
              <Text style={[t.bodySm, { color: color.muted }]}> min</Text>
            </Text>
          </View>
        </View>

        {/* Names only what was actually read. The old copy cited "Tuesday's
            session" whether or not one existed, and claimed sleep was factored
            in with no check-in to factor. */}
        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, paddingTop: 14, color: color.muted2,
        }]}>
          {factoredIn.length
            ? `${factoredIn.join(' and ')} ${factoredIn.length > 1 ? 'are' : 'is'} `
              + 'factored into today\'s options. Nothing is marked missed.'
            : 'Nothing is marked missed. Check in and today\'s options are '
              + 'recalculated from how you actually slept.'}
        </Text>
      </ScrollView>

      <AdaptSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
