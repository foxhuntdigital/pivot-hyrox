/**
 * Today, redesigned: the session is the hero.
 *
 * Today's job is "what do I do now, and can I start it". The old screen put a
 * large check-in panel between the athlete and the answer. Here the order is
 * the job: where you are in the block (compact), today's session (the hero,
 * with its shape, its length and what it asks for in numbers), one Start and
 * one Adapt, then the supporting lines: the check-in as one row, readiness as
 * a word with its confidence, and the week as a strip that opens Plan.
 *
 * Everything the old screen did is still here (redesign plan, Today
 * preservation map): the resume banner, the error banner with retry, the
 * capacity prompt, the tour, check-in and editing it, Adapt, the done and
 * stacked states, no-session guidance and the closing line. The seven-day
 * stats moved to Progress.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { VARIANT_LABEL, variantMinutes, type VariantCode } from '@pivot/engine';

import { color, kindColor, numeralTrim, space, type as t, type SessionKind } from '@/theme/tokens';
import { ActionButton, InkPanel, Label } from '@/components/primitives';
import { AdaptSheet } from '@/components/AdaptSheet';
import { useDialog } from '@/components/Dialog';
import { TourSpot } from '@/components/Tour';
import { Chevron, SessionShape, TypeTag } from '@/components/system';
import { SessionRows } from '@/components/SessionRows';
import { lookOf, useWeek } from '@/components/plan/weekData';
import { useTour } from '@/state/tour';
import { useApp } from '@/state/store';
import { PHASE_MEANING, phaseTitle } from '@/data/plan';
import type { ShapeBar } from '@/data/sessionShape';
import { displayName, feelOf } from '@/data/planWeek';
import { LENGTH_NAME, checkinLine, readinessLine } from '@/data/todayView';
import { variantOverrideFailed, variantSource, variantStep, type VariantStep } from '@/data/variantChoice';
import { hoursToClock, mmss, isoDayLabel, clockTime, LOW_SLEEP_HOURS } from '@/lib/format';
import { track } from '@/lib/analytics';

const MOVEMENT_WORD = { run: 'Run', erg: 'Erg', station: 'Stations' } as const;

export function TodayView() {
  const router = useRouter();
  const dialog = useDialog();
  const {
    state, session, steps, readiness, sleep, plan, beginSession, discardSession,
    todayError, refreshToday, chooseVariant,
  } = useApp();
  const { week } = useWeek();
  const [sheetOpen, setSheetOpen] = useState(false);
  const scroller = useRef<ScrollView | null>(null);

  // The first-run tour points at this screen's own controls (see the old
  // screen for why it registers a scroller and starts only with a plan).
  const { registerScroller, maybeStart } = useTour();
  useEffect(() => {
    registerScroller(y => scroller.current?.scrollTo({ y: Math.max(0, y - 160), animated: true }));
    return () => registerScroller(null);
  }, [registerScroller]);
  const hasPlan = plan.phase !== null;
  useEffect(() => { if (hasPlan) maybeStart(); }, [hasPlan, maybeStart]);

  // Counted on every focus, as before: the decision-latency KPI measures from
  // Today opening, and Today stays mounted behind the other tabs.
  const phaseType = plan.phase?.type ?? 'unknown';
  const family = session.kind === 'session' ? session.template.workout_family : null;
  const variant = session.kind === 'session' ? session.variant.variant_code : null;
  useFocusEffect(useCallback(() => {
    track({ name: 'today_viewed', phase: phaseType, recommendation_family: family, variant });
  }, [phaseType, family, variant]));

  /* ── what the screen says ──────────────────────────────────────────────── */

  // A race counts down in days; a block in weeks left; only no program at
  // all gets a dash, because only then is there nothing to count.
  const goal = plan.race
    ? {
        label: [plan.race.name, plan.race.division].filter(Boolean).join(' · '),
        value: plan.race.days_remaining ?? '—', unit: plan.race.days_remaining === 1 ? 'day' : 'days',
        caption: 'to race day',
      }
    : plan.phase
      ? {
          label: `${plan.phase.total_weeks}-week block · no race entered`,
          value: Math.max(0, plan.phase.total_weeks - plan.phase.week + 1),
          unit: plan.phase.total_weeks - plan.phase.week + 1 === 1 ? 'week' : 'weeks',
          caption: 'left in the block',
        }
      : { label: 'No race set', value: '—' as const, unit: 'days', caption: 'Add a race to see a countdown' };

  const sleepClock = hoursToClock(sleep.hours);
  const isLowSleep = sleep.hours !== null && sleep.hours < LOW_SLEEP_HOURS;
  const finishedToday = plan.pendingCompletion || plan.week.completedToday.length > 0;
  const stacked = finishedToday && state.override_template_id != null && session.kind === 'session';

  const checkin = checkinLine({
    checkedIn: !!state.checkin, sleepClock, lowSleep: isLowSleep,
    energy: state.checkin ? state.energy : null, finishedToday,
  });
  const ready = readinessLine(readiness);

  // What was performed names what was performed (the old screen's rule):
  // the live decision has already moved on to the next session by now.
  const pending = plan.pendingSession;
  // Each one separately, in the order they were finished; the one finished on
  // this device and not yet on the server goes last, as the most recent.
  const doneToday = [
    ...[...plan.week.completedToday]
      .sort((a, b) => (a.finished_at ?? '').localeCompare(b.finished_at ?? ''))
      .map(c => ({ key: c.session_id, name: c.name, templateId: c.template_id, minutes: c.estimated_minutes, at: c.finished_at ?? undefined })),
    ...(pending ? [{ key: 'pending', name: pending.name, templateId: pending.template_id, minutes: pending.estimated_minutes, at: null as string | null | undefined }] : []),
  ];
  const doneMinutes = doneToday.reduce((n, d) => n + (d.minutes ?? 0), 0);

  const lastSession = plan.week.completed[0];
  const factoredIn = [
    sleep.hours !== null ? "Last night's sleep" : null,
    lastSession ? `your last session (${displayName(lastSession.name)})` : null,
  ].filter((s): s is string => s !== null);

  const start = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    beginSession();
    router.push('/active');
  };

  /** The length picker on the card: the same rules and copy as the Adapt sheet. */
  const show = async (step: VariantStep): Promise<boolean> => {
    if (step.kind === 'confirm') {
      return dialog.confirm({
        eyebrow: step.eyebrow, title: step.title, body: step.body,
        confirmLabel: step.confirmLabel, cancelLabel: step.cancelLabel,
      });
    }
    if (step.kind === 'alert') {
      await dialog.alert({ eyebrow: step.eyebrow, title: step.title, body: step.body });
      return false;
    }
    return true;
  };
  /**
   * The length the card is showing. Tapping a length only previews it; it is
   * chosen when the athlete starts it, so they can look at all three first.
   * Null is the session as decided.
   */
  const [picked, setPicked] = useState<VariantCode | null>(null);
  const templateId = session.kind === 'session' ? session.template.id : null;
  const decided = session.kind === 'session' ? session.variant.variant_code : null;
  // A new decision (another session, or a length chosen in Adapt) starts the
  // card on what was decided again.
  useEffect(() => { setPicked(null); }, [templateId, decided]);

  /** Commits a length, with the same rules and copy as the Adapt sheet. */
  const chooseLength = async (code: VariantCode): Promise<boolean> => {
    if (session.kind !== 'session') return false;
    if (code === session.variant.variant_code) return true;
    const label = VARIANT_LABEL[code];
    const result = chooseVariant(session.template.id, code);
    if (!result.ok) {
      const step = variantStep(result, label,
        variantSource({ checkedIn: !!state.checkin, energy: state.energy }));
      if (!(await show(step)) || step.kind !== 'confirm') return false;
      if (!chooseVariant(session.template.id, code, { override: true }).ok) {
        await show(variantOverrideFailed(label));
        return false;
      }
    }
    return true;
  };

  /**
   * Starting a length other than the decided one commits it first. The player
   * reads the decision as of the next render, so the start waits for the
   * session to become that length rather than opening the old one.
   */
  const [startOnce, setStartOnce] = useState<VariantCode | null>(null);
  useEffect(() => {
    if (startOnce && decided === startOnce) {
      setStartOnce(null);
      start();
    }
  }, [startOnce, decided]);

  const startPicked = async () => {
    if (!picked || picked === decided) { start(); return; }
    const code = picked;
    if (await chooseLength(code)) setStartOnce(code);
  };

  return (
    <>
      <ScrollView ref={scroller} contentContainerStyle={{ paddingBottom: 30 }}>
        {/* ── Banners: an unfinished session, a failed load ───────────────── */}
        {state.status !== 'ready' ? (
          <Banner
            label={state.status === 'completed_pending_review' ? 'Session finished' : 'Session in progress'}
            title={state.performed?.name ?? 'Your session'}
            body={state.status === 'completed_pending_review'
              ? 'It is saved. Add how it felt to finish the record.'
              : `Step ${Math.min(state.step_index + 1, steps.length || 1)}`
                + `${steps.length ? ` of ${steps.length}` : ''} · ${mmss(state.elapsed_seconds)}`}
          >
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                onPress={() => router.push(
                  (state.status === 'completed_pending_review' ? '/done' : '/active') as never)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingHorizontal: 18, paddingVertical: 12,
                  backgroundColor: pressed ? color.redPressed : color.red,
                })}
              >
                <Text style={[t.button, { color: color.onDark }]}>
                  {state.status === 'completed_pending_review' ? 'Finish' : 'Resume'}
                </Text>
              </Pressable>
              {state.status !== 'completed_pending_review' ? (
                <Pressable
                  onPress={discardSession}
                  accessibilityRole="button"
                  accessibilityLabel="Discard the unfinished session"
                  style={({ pressed }) => ({
                    paddingHorizontal: 18, paddingVertical: 12,
                    borderWidth: 1, borderColor: color.tintBorder, opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={[t.button, { color: color.redDeep }]}>Discard</Text>
                </Pressable>
              ) : null}
            </View>
          </Banner>
        ) : null}

        {todayError ? (
          <Banner label="Couldn't load today" body={todayError}>
            <Pressable
              onPress={refreshToday}
              accessibilityRole="button"
              accessibilityLabel="Try loading today again"
              style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.redDeep }]}>Try again</Text>
            </Pressable>
          </Banner>
        ) : null}

        {/* ── Where you are ───────────────────────────────────────────────────
            The countdown is the hero: a full-width ink block with the number
            large enough to read across a gym, its red offset echoing the old
            layout's shadow. It sits apart from the session card below, so
            "where you are in the block" and "what to do today" never compete. */}
        <TourSpot id="race">
          <View style={{ backgroundColor: color.ink, paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 22 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Label tone="salmon" style={{ flexShrink: 1 }}>{goal.label}</Label>
              {plan.race?.event_date ? <Label tone="onDarkMuted">{isoDayLabel(plan.race.event_date)}</Label> : null}
            </View>
            <View
              accessible
              accessibilityLabel={goal.value === '—' ? goal.caption : `${goal.value} ${goal.unit} ${goal.caption}`}
              style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 6 }}
            >
              <View>
                {/* The red copy behind is the offset; drawn as text rather than
                    a text shadow, which Android will not render hard-edged. */}
                <Text style={[styles.countdown, { position: 'absolute', left: 5, top: 5, color: color.red }]}>{goal.value}</Text>
                <Text style={[styles.countdown, { color: color.onDark }]}>{goal.value}</Text>
              </View>
              <View style={{ paddingBottom: 12, flexShrink: 1 }}>
                {goal.value !== '—' ? (
                  <Text style={[t.h4, { fontSize: 20, lineHeight: 22, color: color.onDark }]}>{goal.unit}</Text>
                ) : null}
                <Label tone="onDarkMuted" style={{ marginTop: 4 }}>{goal.caption}</Label>
              </View>
            </View>
            {plan.phase ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18 }}>
                  <Text style={[t.rowTitle, { fontFamily: t.eyebrow.fontFamily, fontSize: 15, color: color.onDark }]}>
                    {phaseTitle(plan.phase.type)} phase
                  </Text>
                  <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.onDarkSoft }]}>
                    Week {plan.phase.week} of {plan.phase.total_weeks}
                  </Text>
                </View>
                {/* One program bar, the same one Plan draws, in ink's colours. */}
                {plan.phase.total_weeks > 0 ? (
                  <View style={{ flexDirection: 'row', gap: 3, marginTop: 9 }}
                    accessibilityLabel={`Week ${plan.phase.week} of ${plan.phase.total_weeks}`}>
                    {Array.from({ length: plan.phase.total_weeks }, (_, i) => {
                      const done = i < plan.phase!.week - 1;
                      const now = i === plan.phase!.week - 1;
                      return (
                        <View key={i} style={{
                          flex: 1, height: 7,
                          backgroundColor: now ? color.red : done ? color.onDark : 'transparent',
                          borderWidth: now || done ? 0 : 1, borderColor: color.muted2,
                        }} />
                      );
                    })}
                  </View>
                ) : null}
                {PHASE_MEANING[plan.phase.type] ? (
                  <Text style={[t.bodySm, { fontSize: 13, color: color.onDarkSoft, marginTop: 12 }]}>
                    {PHASE_MEANING[plan.phase.type]}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        </TourSpot>

        {/* The two capacity questions, for an athlete who predates them: an
            offer, not a gate (a null capacity is safe). */}
        {state.profile.load_capacity == null && plan.phase ? (
          <Pressable
            onPress={() => router.push('/capacity' as never)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginHorizontal: space.gutter, marginTop: 14, minHeight: 56,
              paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: pressed ? color.hover : color.mist, borderWidth: 1, borderColor: color.mistEdge,
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[t.rowTitle, { color: color.ink }]}>Two questions we didn't ask</Text>
              <Text style={[t.bodySm, { color: color.muted2 }]}>Your plan is sized for the middle. Two taps sizes it to you.</Text>
            </View>
            <Chevron dir="right" />
          </Pressable>
        ) : null}

        {/* ── Today ───────────────────────────────────────────────────────── */}
        <View style={{
          paddingHorizontal: space.gutter, paddingTop: 22, paddingBottom: 8,
          flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        }}>
          <Label tone="ink">Today</Label>
          <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>
            {finishedToday ? 'Done for today' : session.kind === 'session' ? 'Suggested for this week' : ''}
          </Text>
        </View>

        {/* Done for today: a light card under the ink hero, so the screen never
            stacks two dark blocks. One row per session, each with its own type,
            minutes and finish time, under the day's total; several sessions
            are never merged into one name. */}
        {finishedToday ? (
          <View style={{ marginHorizontal: space.gutter, borderWidth: 2, borderColor: color.ink, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 18, height: 18, backgroundColor: color.red, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: color.onDark, fontSize: 11, fontWeight: '900' }}>✓</Text>
              </View>
              <Label tone="redDark">
                {doneToday.length > 1 ? `Done today · ${doneToday.length} sessions` : 'Done today'}
              </Label>
            </View>
            {doneMinutes ? (
              <Text style={[t.h2, { fontSize: 38, lineHeight: 44, marginTop: 4, color: color.ink }]}>
                {doneMinutes}<Text style={[t.labelSm, { color: color.muted }]}> MIN</Text>
              </Text>
            ) : null}
            {doneToday.length ? doneToday.map((d, i) => {
              const look = lookOf(d.templateId);
              return (
                <View key={d.key} style={{ paddingVertical: 10, gap: 3, borderTopWidth: 1, borderTopColor: color.rule, marginTop: i === 0 ? 6 : 0 }}>
                  {look ? <TypeTag kind={look.kind} /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                    <Text style={[t.rowTitle, { flex: 1, fontSize: 16, fontFamily: t.eyebrow.fontFamily, color: color.ink }]}>
                      {displayName(d.name)}
                    </Text>
                    {d.minutes ? (
                      <Text style={[t.h4, { fontSize: 18, color: color.ink }]}>
                        {d.minutes}<Text style={[t.labelSm, { color: color.muted }]}> MIN</Text>
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[t.bodySm, { color: color.muted2 }]}>
                    {[look ? feelOf(look.kind, look.effort, look.circuit) : null, finishTime(d.at)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              );
            }) : (
              <Text style={[t.h3, { fontSize: 20, marginTop: 6, color: color.ink }]}>Session logged</Text>
            )}
            <Text style={[t.bodySm, { fontSize: 13, color: color.muted2, marginTop: 6 }]}>
              {stacked
                ? 'Logged. The session you added is below; start it when you are ready.'
                : "Counted for the week. Tomorrow's options are built around today."}
            </Text>
            {!stacked ? (
              <ActionButton label="Train again" variant="outline" arrow={null}
                onPress={() => router.replace('/plan' as never)} style={{ marginTop: 12 }} />
            ) : null}
          </View>
        ) : null}

        {stacked ? (
          <Label style={{ paddingHorizontal: space.gutter, paddingTop: 22, paddingBottom: 8 }}>Added today</Label>
        ) : null}

        {(!finishedToday || stacked) && (session.kind === 'session' ? (
          <SessionCard
            onStart={startPicked}
            onAdapt={() => setSheetOpen(true)}
            picked={picked}
            onLength={(code) => {
              if (code === (picked ?? decided)) return;
              Haptics.selectionAsync();
              setPicked(code === decided ? null : code);
            }}
          />
        ) : (
          <View style={{ marginHorizontal: space.gutter }}>
            <InkPanel label="No session today">
              <Text style={[t.body, { color: color.onDarkSoft }]}>{session.guidance}</Text>
            </InkPanel>
            <ActionButton label="Adjust what I have" variant="outline"
              onPress={() => setSheetOpen(true)} style={{ marginTop: 10 }} />
          </View>
        ))}

        {/* ── Supporting lines ────────────────────────────────────────────── */}
        <TourSpot id="stats" style={{ marginHorizontal: space.gutter, marginTop: 18 }}>
          <View style={{ borderWidth: 1, borderColor: color.chipBorder }}>
            <Pressable
              onPress={() => router.push('/checkin')}
              accessibilityRole="button"
              accessibilityLabel={`${checkin.title}. ${checkin.detail} ${checkin.action}.`}
              style={({ pressed }) => ({
                minHeight: 60, paddingHorizontal: 14, paddingVertical: 10,
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[t.rowTitle, { fontSize: 15, color: checkin.warn ? color.redDark : color.ink }]}>
                  {checkin.title}
                </Text>
                <Text style={[t.bodySm, { color: color.muted2 }]}>{checkin.detail}</Text>
              </View>
              <Text style={[t.button, { fontSize: 11, color: state.checkin ? color.ink : color.redDark }]}>
                {checkin.action}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/progress' as never)}
              accessibilityRole="button"
              accessibilityLabel={`Readiness: ${ready.headline}. ${ready.detail}.`}
              style={({ pressed }) => ({
                minHeight: 60, paddingHorizontal: 14, paddingVertical: 10,
                flexDirection: 'row', alignItems: 'center', gap: 12,
                borderTopWidth: 1, borderTopColor: color.rule,
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Label size="sm">Readiness</Label>
                <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>{ready.headline}</Text>
                <Text style={[t.bodySm, { color: color.muted2 }]}>{ready.detail}</Text>
              </View>
              <Chevron dir="right" />
            </Pressable>
          </View>
        </TourSpot>

        {week.tiles.length ? (
          <Pressable
            onPress={() => router.push('/plan' as never)}
            accessibilityRole="button"
            accessibilityLabel={`This week: ${week.done} of ${week.planned} done. See the week.`}
            style={({ pressed }) => ({
              marginHorizontal: space.gutter, marginTop: 18, paddingVertical: 12, gap: 8,
              borderTopWidth: 2, borderTopColor: color.ink,
              backgroundColor: pressed ? color.hover : 'transparent',
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label tone="ink">This week</Label>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, fontSize: 12, color: color.ink }]}>
                  {week.done} of {week.planned} done · See the week
                </Text>
                <Chevron dir="right" size={6} tint={color.ink} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {week.tiles.filter(x => x.state !== 'skipped').map(x => (
                <View key={x.key} style={{
                  flex: 1, height: 14, borderWidth: 2, borderColor: kindColor[x.kind],
                  backgroundColor: x.state === 'done' ? kindColor[x.kind] : 'transparent',
                }} />
              ))}
            </View>
          </Pressable>
        ) : null}

        {/* Names only what was actually read. */}
        <Text style={[t.bodySm, { paddingHorizontal: space.gutter, paddingTop: 16, color: color.muted2 }]}>
          {finishedToday
            ? "Today's session is done, and tomorrow's options are built around it. Nothing is marked missed."
            : factoredIn.length
            ? `${capitalise(factoredIn.join(' and '))} ${factoredIn.length > 1 ? 'are' : 'is'} `
              + "factored into today's options. Nothing is marked missed."
            : "Nothing is marked missed. Check in and today's options are recalculated from how you actually slept."}
        </Text>
      </ScrollView>

      <AdaptSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

/* ── The session card ─────────────────────────────────────────────────────── */

function SessionCard({ onStart, onAdapt, onLength, picked }: {
  onStart: () => void;
  onAdapt: () => void;
  onLength: (code: VariantCode) => void;
  /** The length being previewed, when it is not the decided one. */
  picked: VariantCode | null;
}) {
  const { session, state, previewVariant } = useApp();
  if (session.kind !== 'session') return null;
  const tpl = session.template;
  const decided = session.variant.variant_code;
  const current = picked ?? decided;
  // The decided session, or what the engine would build for the previewed
  // length: adapted blocks either way, not the template's.
  const preview = current === decided ? null : previewVariant(tpl.id, current);
  const unavailable = current !== decided && !preview;
  const blocks = current === decided ? session.blocks : preview?.blocks ?? [];
  const minutes = current === decided ? session.estimated_minutes
    : preview?.estimated_minutes ?? variantMinutes(tpl, tpl.variants.find(v => v.variant_code === current)!);
  const look = lookOf(tpl.id, blocks);
  const kind: SessionKind = look?.kind ?? 'strength';
  const bars: ShapeBar[] = look?.bars ?? [];
  const parts = [...new Set(bars.filter(b => b.effort > 0 && b.kind).map(b => b.kind!))];
  // Work that is none of run, erg or station wears the session's own colour,
  // so the legend has to say what that colour means here.
  const hasOther = parts.length > 0 && bars.some(b => b.effort > 0 && !b.kind);
  const lengths = [...tpl.variants].sort((a, b) => b.volume_multiplier - a.volume_multiplier);

  return (
    <TourSpot id="session" style={{ marginHorizontal: space.gutter }}>
      <View style={{ borderWidth: 2, borderColor: color.ink }}>
        <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TypeTag kind={kind} />
            <Text style={[t.labelXs, { fontFamily: t.eyebrow.fontFamily, color: kindColor[kind] }]}>
              · {LENGTH_NAME[current] ?? ''}
            </Text>
            {state.adapted && current === decided ? (
              <Text style={[t.labelXs, { fontFamily: t.eyebrow.fontFamily, color: color.redDark }]}>· Adapted</Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Text style={[t.h2, { flex: 1, fontSize: 26, lineHeight: 29, color: color.ink }]}>
              {displayName(tpl.name)}
            </Text>
            <Text style={[t.h2, { fontSize: 26, lineHeight: 29, color: color.ink }]}>
              {minutes}
              <Text style={[t.labelSm, { fontFamily: t.eyebrow.fontFamily, color: color.muted2 }]}> MIN</Text>
            </Text>
          </View>
          <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>
            {[look ? feelOf(kind, look.effort, look.circuit) : null, tpl.intensity_target]
              .filter(Boolean).join(' · ')}
          </Text>
        </View>

        {/* Every adaptation explains itself (PRD §2). */}
        {state.adapted && current === decided ? (
          <View style={{
            backgroundColor: color.tint, borderTopWidth: 1, borderBottomWidth: 1,
            borderColor: color.tintBorder, paddingVertical: 10, paddingHorizontal: 14,
          }}>
            <Label tone="redDark" size="sm" style={{ marginBottom: 4 }}>Adapted · still on track</Label>
            <Text style={[t.bodySm, { color: color.redDeep }]}>{session.rationale}</Text>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 14 }}>
          <SessionShape bars={bars} kind={kind} height={72} style={{ borderBottomWidth: 2 }} />
          {parts.length + (hasOther ? 1 : 0) > 1 ? (
            <View style={{ flexDirection: 'row', gap: 12, paddingTop: 8 }}>
              {parts.map(p => (
                <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, backgroundColor: kindColor[p] }} />
                  <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>
                    {MOVEMENT_WORD[p]}
                  </Text>
                </View>
              ))}
              {hasOther ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, backgroundColor: kindColor[kind] }} />
                  <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>
                    Other work
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* The quick path to a shorter session. A tap previews that length
            below; Start chooses it, under the same rules as Adapt's own
            choice. Adapt keeps the rest (time, equipment, low impact). */}
        {lengths.length > 1 ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Session length" style={{
            marginHorizontal: 14, marginTop: 14, flexDirection: 'row', borderWidth: 1, borderColor: color.ink,
          }}>
            {lengths.map((v, i) => {
              const on = v.variant_code === current;
              return (
                <Pressable
                  key={v.variant_code}
                  onPress={() => onLength(v.variant_code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${LENGTH_NAME[v.variant_code]}, about ${variantMinutes(tpl, v)} minutes`}
                  style={({ pressed }) => ({
                    flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2,
                    borderLeftWidth: i ? 1 : 0, borderLeftColor: color.ink,
                    backgroundColor: on ? color.ink : pressed ? color.hover : 'transparent',
                  })}
                >
                  <Text style={[t.labelSm, { fontFamily: t.eyebrow.fontFamily, fontSize: 11, color: on ? color.onDark : color.ink }]}>
                    {LENGTH_NAME[v.variant_code]}
                  </Text>
                  <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, fontSize: 12, color: on ? color.onDark : color.ink }]}>
                    {on ? `${minutes} min` : v.variant_code === decided
                      ? `${session.estimated_minutes} min` : `about ${variantMinutes(tpl, v)}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* What it asks for, in numbers. */}
        <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>
          {unavailable ? (
            <Text style={[t.bodySm, { color: color.muted2, paddingBottom: 8 }]}>
              {LENGTH_NAME[current]} can't be built from what you have reported today.
            </Text>
          ) : (
            <SessionRows blocks={blocks} kind={kind} />
          )}
        </View>

        <TourSpot id="actions" style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14 }}>
          <ActionButton
            label={current === decided ? 'Start workout' : `Start ${LENGTH_NAME[current]}`}
            onPress={onStart} style={{ flex: 1 }}
          />
          <ActionButton label="Adapt" variant="outline" arrow={null} onPress={onAdapt}
            style={{ width: 96, borderWidth: 2 }} />
        </TourSpot>
      </View>
    </TourSpot>
  );
}

/* ── A banner ─────────────────────────────────────────────────────────────── */

function Banner({ label, title, body, children }: {
  label: string;
  title?: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={{
      marginHorizontal: space.gutter, marginTop: 14,
      backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
      paddingHorizontal: 13, paddingVertical: 13,
    }}>
      <Label tone="redDark" size="sm" style={{ marginBottom: 5 }}>{label}</Label>
      {title ? <Text style={[t.rowTitle, { color: color.redDeep, marginBottom: 3 }]}>{title}</Text> : null}
      <Text style={[t.bodySm, { color: color.redDeep }]}>{body}</Text>
      {children}
    </View>
  );
}

/** Sentence case for a clause that may open the sentence or sit inside it. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = {
  /** The countdown: Archivo Black, sized to read across a gym. */
  countdown: { fontFamily: t.hero.fontFamily, fontSize: 124, lineHeight: 120, letterSpacing: -7 },
} as const;

/**
 * "Finished 11:05 AM" in the phone's own clock. Null is a session finished here
 * and not yet on the server ("Just now"); undefined is a server that does not
 * send times yet, which says nothing rather than something untrue.
 */
function finishTime(iso: string | null | undefined): string {
  if (iso === undefined) return '';
  if (iso === null) return 'Just now';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `Finished ${clockTime(d)}`;
}
