/**
 * D15 Completion.
 *
 * The tone here is deliberate: a shortened session is a completed session
 * (PRD §8.1 — Express and Micro are never communicated as failure states), so
 * the summary reports what was done without framing it as a shortfall.
 */
import React from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VARIANT_LABEL, supplementalOffer } from '@pivot/engine';
import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton, InkPanel, Chip } from '@/components/primitives';
import { useApp } from '@/state/store';
import { TEMPLATES, EXERCISES } from '@/data/content';
import { mmss } from '@/lib/format';
import { buildSplits, splitTotals, fastestAndSlowest } from '@/state/splits';
import { recordsIn } from '@/state/records';
import { LOW_SLEEP_HOURS } from '@/lib/format';

const RPE_CHOICES = [5, 6, 7, 8, 9];

/**
 * One correction. Empty means "the clock was right", never zero — a blank
 * field must leave the measured value standing rather than overwrite it with
 * nothing, which is why the value is null rather than 0 when cleared.
 */
function CorrectionField({
  label, value, suffix, placeholder, accessibilityLabel, onChange,
}: {
  label: string;
  value: number | null | undefined;
  suffix: string;
  placeholder?: string;
  accessibilityLabel: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Label size="sm">{label}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <TextInput
          accessibilityLabel={accessibilityLabel}
          value={value == null ? '' : String(value)}
          placeholder={placeholder ?? '—'}
          placeholderTextColor={color.muted2}
          keyboardType="numeric"
          returnKeyType="done"
          selectTextOnFocus
          onChangeText={text => {
            const cleaned = text.replace(/[^0-9.]/g, '');
            if (cleaned === '') return onChange(null);
            const n = Number(cleaned);
            onChange(Number.isFinite(n) ? n : null);
          }}
          style={[t.rowTitle, {
            fontSize: 15, color: color.ink, paddingVertical: 5, minWidth: 56,
            borderBottomWidth: 1, borderBottomColor: color.rule,
          }]}
        />
        <Text style={[t.meta, { color: color.muted, marginLeft: 5 }]}>{suffix}</Text>
      </View>
    </View>
  );
}

export default function DoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    state, dispatch, session, steps, plan, sleep, finishSession,
    engineInput, startSupplemental, guidance,
  } = useApp();

  if (session.kind !== 'session') {
    router.replace('/today');
    return null;
  }

  /**
   * Sections the athlete completed — the same count the logs and the splits
   * use. Ending early stops at the step they were on rather than counting it:
   * a station abandoned halfway is not a section done, and the number here has
   * to agree with the number of laps listed below it.
   */
  const sectionsDone = state.ended_early ? state.step_index : steps.length;
  const splits = buildSplits(steps, state.step_seconds, sectionsDone);
  const totals = splitTotals(splits);
  const { fastest, slowest } = fastestAndSlowest(splits);
  /**
   * The efforts worth offering a correction on.
   *
   * A distance step is timed by the player and its distance is asserted by the
   * Complete tap, which is right most of the time and wrong in the cases that
   * matter: a treadmill the phone never saw, a timer left running through a
   * water stop, a rep cut short. The split timer is one source of a run, not
   * the only one (PRD §11 — "manual entry works without timer"), and this is
   * the other one.
   *
   * Only completed, non-rest, measurable steps: there is nothing to correct
   * about work that was never performed, and rest belongs to no movement.
   */
  const correctable = steps
    .map((step, i) => ({ step, i }))
    .filter(({ step, i }) =>
      i < sectionsDone
      && !step.rest
      && step.exercise_id
      && (step.prescription_type === 'distance' || step.prescription_type === 'duration'));

  // `plan.week` already counts the session just finished — the store adds it
  // the moment the workout completes rather than waiting for a refetch.
  const { done: weekDone, target: weekTarget } = plan.week;

  /**
   * The coach note reflects what actually happened. It reads from logged
   * outcomes only — it never claims a physiological result the app did not
   * measure.
   */
  const hardSession = (state.session_rpe ?? 0) >= 8;
  const shortSleep = sleep.hours !== null && sleep.hours < LOW_SLEEP_HOURS;

  const coachNote = state.ended_early
    ? 'Cut short and logged. You got the first sections in, which is enough to hold '
      + "the stimulus — the remainder rolls into the week's queue rather than being "
      + 'marked missed.'
    : hardSession
      // Short sleep is named only when it was actually reported, and the note
      // no longer promises a change to tomorrow that nothing schedules. What it
      // says is what the engine will do: read this session as an input.
      ? `Logged at RPE ${state.session_rpe}, harder than this session intended`
        + `${shortSleep ? ' on the sleep you reported' : ''}. `
        + "Tomorrow's recommendation reads that back as recovery load."
      : `${session.template.name} completed as ${VARIANT_LABEL[session.variant.variant_code]}. `
        + 'The week stays intact and your next exposure builds from here.';

  /**
   * Records set today, recognised here for the same reason the supplemental
   * offer is: the finish is queued through the outbox, so the server does not
   * yet know the session ended.
   *
   * What makes it safe to decide locally is that the target came from the
   * server — `guidance.best` is the heaviest COMPARABLE exposure, already
   * filtered to an overlapping rep range, with the count of exposures behind
   * it. The client compares; it never decides what counts as comparable, and a
   * movement with no prior comparable exposure sets no record.
   */
  const records = React.useMemo(() => recordsIn(
    steps
      .map((step, i) => ({ step, entry: state.entries[i] }))
      .filter(({ step }) => step.set_number != null && !step.rest)
      .map(({ step, entry }) => ({
        exercise_id: step.exercise_id,
        load: entry?.weight ?? null,
        reps: entry?.reps ?? null,
      })),
    guidance,
  ), [steps, state.entries, guidance]);

  /**
   * The optional extra, decided here rather than asked of the server.
   *
   * The finish is queued through the outbox rather than awaited, so at the
   * moment this screen renders the server does not yet know the session is
   * over — asking it would reliably answer NO_PRIMARY_COMPLETED. The decision
   * is the identical `supplementalOffer` the Edge Function runs, which is why
   * it lives in the engine, and `start-workout` re-runs the gate server-side
   * before opening anything. An offer is a suggestion; the gate is the
   * enforcement.
   *
   * It recomputes as the athlete taps an RPE, which is the honest behaviour:
   * rating the session a 9 spends the day and withdraws the offer, and the
   * screen says so rather than leaving a button that would be refused.
   *
   * `supplementalTakenToday` is false because this client does not track it.
   * The server does, in the one-per-day index and in the gate — so the worst
   * case is an offer that is declined on tap, not a second one performed.
   */
  const offer = React.useMemo(() => supplementalOffer({
    input: engineInput,
    templates: TEMPLATES,
    exercises: EXERCISES,
    primary: {
      template: session.template,
      session_rpe: state.session_rpe,
      ended_early: state.ended_early,
    },
    supplementalTakenToday: false,
  }), [engineInput, session, state.session_rpe, state.ended_early]);

  /**
   * Refusals worth saying out loud.
   *
   * These four are coaching statements about the athlete's day and belong on a
   * screen that has just told them they finished. The rest — no content fits
   * their equipment, one already taken, nothing completed — are facts about the
   * library or about state they can see, and printing them under a completed
   * session is noise dressed as feedback.
   */
  const SPOKEN_REFUSALS = ['RECOVERY_TOO_LOW', 'PRIMARY_ALREADY_DEMANDING',
    'TAPER_WEEK', 'SYMPTOMS_REPORTED'];
  const showRefusal = !offer.offered && SPOKEN_REFUSALS.includes(offer.reason_code);

  const finish = () => {
    // RPE is captured on this screen, so the finish is written here rather
    // than when the last block ended — the record carries what the athlete
    // actually reported.
    finishSession();
    router.replace('/today');
  };

  /**
   * Take one. The primary is written first and unconditionally: the session
   * they completed is recorded whether or not the extra opens.
   */
  const takeSupplemental = (templateId: string) => {
    finishSession();
    if (startSupplemental(templateId)) router.replace('/active');
    else router.replace('/today');
  };

  return (
    <ScrollView
      style={{ backgroundColor: color.paper }}
      contentContainerStyle={{ paddingTop: insets.top + 22, paddingBottom: 40 }}
      // The split corrections open a numeric pad, which has no return key.
      // Dragging puts it away, and a tap on an RPE chip or on Done fires first
      // time instead of being swallowed closing it.
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ paddingHorizontal: space.gutter }}>
        <View style={{
          width: 44, height: 44, backgroundColor: color.red,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 22, color: color.onDark, fontFamily: t.h1.fontFamily }}>✓</Text>
        </View>
        <Text style={[t.h1, { marginTop: 16, color: color.ink }]}>Strong session.</Text>
        <Text style={[t.body, { color: color.muted2, marginTop: 6 }]}>
          {session.template.name} · {VARIANT_LABEL[session.variant.variant_code]}
        </Text>
      </View>

      {/* A record, when there is one. Placed here because it is the most
          significant thing that happened, and kept to one line per movement
          because a celebration that fills the screen stops reading as one. It
          always states what was beaten: a record that cannot show its working
          is a claim. */}
      {records.length ? (
        <View style={{
          marginHorizontal: space.gutter, marginTop: 18,
          backgroundColor: color.tint,
          borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 14, paddingVertical: 12,
        }}>
          <Label tone="ink" size="sm" style={{ color: color.redDark }}>
            {records.length > 1 ? `${records.length} personal bests` : 'Personal best'}
          </Label>
          {records.map(r => (
            <Text
              key={r.exercise_id}
              style={[t.body, { color: color.redDeep, marginTop: 5 }]}
            >
              {r.exercise} — {r.kind === 'load'
                ? `${r.value}${r.unit ? ` ${r.unit}` : ''}, up from ${r.previous}`
                : `${r.value} reps, up from ${r.previous}`}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
        <Rule heavy />
      </View>

      {/* Duration and sections are measured. HR and training load would need a
          connected source and a validated model, so they are not shown. */}
      {/* Everything in this row was measured — the clock ran, the sections were
          counted — so the row carries the accent that means exactly that. */}
      <View style={{
        flexDirection: 'row', backgroundColor: color.mist,
        borderBottomWidth: 1, borderBottomColor: color.mistEdge,
      }}>
        {[
          { k: 'Duration', v: mmss(state.elapsed_seconds) },
          { k: 'Sections', v: `${sectionsDone}/${steps.length}` },
          { k: 'Variant', v: VARIANT_LABEL[session.variant.variant_code] },
        ].map((s, i) => (
          <View key={s.k} style={{
            flex: 1, paddingVertical: 14, paddingHorizontal: 14,
            borderRightWidth: i === 2 ? 0 : 1, borderRightColor: color.mistEdge,
          }}>
            <Label size="sm">{s.k}</Label>
            {/* One line, always. "EXPRESS" is seven characters in a cell sized
                for "1:15" and broke across two lines as "EXPRE / SS". Shrinking
                to fit keeps the three cells on a common baseline and leaves the
                two short numerals at their full weight, which a fixed smaller
                size for the whole row would not. */}
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={[t.statValue, { marginTop: 3, color: color.ink }]}
            >
              {s.v}
            </Text>
          </View>
        ))}
      </View>

      {/* Splits.
          
          The session as the stopwatch saw it, in the order it happened. Rest is
          listed rather than folded into the work around it — it is time the
          athlete spent and time they chose, and a round that took 4:10 with 90
          seconds of rest after it is a different round from one with 30.
          
          Fastest and slowest are marked only where laps are comparable (same
          movement, same prescription), so a warm-up is never "slowest". */}
      {splits.length ? (
        <>
          <View style={{
            flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
            paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6,
          }}>
            <Label>Splits</Label>
            <Text style={[t.meta, { color: color.muted }]}>
              {mmss(totals.work)} work{totals.rest ? ` · ${mmss(totals.rest)} rest` : ''}
            </Text>
          </View>

          <View style={{ paddingHorizontal: space.gutter }}>
            {splits.map(sp => {
              const isFastest = sp.index === fastest;
              const isSlowest = sp.index === slowest;
              return (
                <View
                  key={sp.index}
                  accessibilityLabel={`${sp.rest ? 'Rest' : sp.label}, ${mmss(sp.seconds)}`
                    + `${isFastest ? ', fastest' : isSlowest ? ', slowest' : ''}`
                    + `, ${mmss(sp.cumulative_seconds)} elapsed`}
                  style={{
                    flexDirection: 'row', alignItems: 'baseline', gap: 10,
                    paddingVertical: 9,
                    borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                  }}
                >
                  <Text style={[t.meta, { width: 18, color: color.muted }]}>{sp.index + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.rowTitle, {
                      fontSize: 13, color: sp.rest ? color.muted2 : color.ink,
                    }]}>
                      {sp.rest ? 'Rest' : sp.label}
                    </Text>
                    <Text style={[t.meta, { color: color.muted, marginTop: 1 }]}>
                      {sp.prescribed}
                      {isFastest ? ' · fastest' : isSlowest ? ' · slowest' : ''}
                    </Text>
                  </View>
                  <Text style={[t.rowTitle, {
                    fontSize: 15, color: sp.rest ? color.muted2 : color.ink,
                  }]}>
                    {mmss(sp.seconds)}
                  </Text>
                  <Text style={[t.meta, { width: 46, textAlign: 'right', color: color.muted }]}>
                    {mmss(sp.cumulative_seconds)}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {correctable.length ? (
        <>
          <View style={{
            flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
            paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 2,
          }}>
            <Label>Correct what was measured</Label>
            <Text style={[t.meta, { color: color.muted }]}>optional</Text>
          </View>
          <Text style={[t.meta, {
            paddingHorizontal: space.gutter, color: color.muted, paddingBottom: 6,
          }]}>
            Leave these alone if the clock had it right.
          </Text>

          <View style={{ paddingHorizontal: space.gutter }}>
            {correctable.map(({ step, i }) => {
              const entry = state.entries[i] ?? {};
              const measured = state.step_seconds[i] ?? 0;
              const patch = (p: { distance_meters?: number | null; seconds?: number | null }) =>
                dispatch({ type: 'set_entry', step: i, entry: p });
              return (
                <View
                  key={i}
                  style={{
                    paddingVertical: 10,
                    borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                  }}
                >
                  <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>
                    {step.label}
                  </Text>
                  <Text style={[t.meta, { color: color.muted, marginTop: 1 }]}>
                    {step.qty} prescribed · {mmss(measured)} on the clock
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 18, marginTop: 6 }}>
                    <CorrectionField
                      label="Distance"
                      suffix="m"
                      accessibilityLabel={`Actual distance for ${step.label}, in metres`}
                      value={entry.distance_meters}
                      onChange={v => patch({ distance_meters: v })}
                    />
                    <CorrectionField
                      label="Time"
                      suffix="sec"
                      accessibilityLabel={`Actual time for ${step.label}, in seconds`}
                      value={entry.seconds}
                      placeholder={String(measured || '')}
                      onChange={v => patch({ seconds: v })}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      <Label style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
        How hard was that?
      </Label>
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
        {RPE_CHOICES.map(v => (
          <Chip
            key={v} flex size="lg" label={String(v)}
            active={state.session_rpe === v}
            onPress={() => dispatch({ type: 'set_rpe', rpe: v })}
          />
        ))}
      </View>
      <Text style={[t.meta, { paddingHorizontal: space.gutter, paddingTop: 8, color: color.muted }]}>
        RPE · shapes tomorrow's load
      </Text>

      <InkPanel
        label="Coach"
        style={{ margin: 18, marginHorizontal: space.gutter, marginBottom: 0 }}
      >
        <Text style={[t.body, { color: color.onDarkSoft }]}>{coachNote}</Text>
      </InkPanel>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
        <Rule />
      </View>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 6 }}>
        {[
          { k: 'Stimulus logged', v: session.primary_stimulus.replace(/_/g, ' ') },
          { k: 'Week', v: `${weekDone} of ${weekTarget} stimuli` },
          // The race row states the countdown. It used to assert "On track"
          // alongside it, which nothing measured.
          ...(plan.race ? [{
            k: plan.race.name,
            v: plan.race.days_remaining === null
              ? 'No date set' : `${plan.race.days_remaining} days`,
          }] : []),
        ].map(row => (
          <View key={row.k} style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
            paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
          }}>
            <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>{row.k}</Text>
            <Text style={[t.bodySm, { color: color.muted2 }]}>{row.v}</Text>
          </View>
        ))}
      </View>

      {offer.offered || showRefusal ? (
        <>
          <Label style={{ paddingHorizontal: space.gutter, paddingTop: 22, paddingBottom: 6 }}>
            Something extra?
          </Label>
          {showRefusal ? (
            <Text style={[t.body, {
              paddingHorizontal: space.gutter, color: color.muted2, paddingBottom: 2,
            }]}>
              {offer.rationale}
            </Text>
          ) : (
            <>
              <Text style={[t.meta, {
                paddingHorizontal: space.gutter, color: color.muted, paddingBottom: 8,
              }]}>
                Optional · skipping records nothing
              </Text>
              <View style={{ paddingHorizontal: space.gutter }}>
                {offer.options.map(option => (
                  <Pressable
                    key={option.template_id}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `${option.name}, ${option.minutes} minutes, ${option.supplemental_load} load`}
                    onPress={() => takeSupplemental(option.template_id)}
                    style={{
                      flexDirection: 'row', justifyContent: 'space-between',
                      alignItems: 'baseline', paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                    }}
                  >
                    <Text style={[t.rowTitle, { fontSize: 13, color: color.ink, flex: 1 }]}>
                      {option.name}
                    </Text>
                    <Text style={[t.bodySm, { color: color.muted2, marginLeft: 12 }]}>
                      {option.minutes} min · {option.supplemental_type.replace(/_/g, ' ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </>
      ) : null}

      <ActionButton
        label="Done" onPress={finish}
        style={{ margin: 20, marginHorizontal: space.gutter, marginTop: 20 }}
      />
    </ScrollView>
  );
}
