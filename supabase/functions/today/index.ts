/**
 * GET /v1/today — the daily decision payload (PRD §12.1).
 *
 * Runs the deterministic engine server-side and records the decision so it can
 * be reproduced later from stored inputs plus engine_version (PRD §24).
 */
import {
  recommend, recoveryFromEnergy, ENGINE_VERSION, READINESS_MODEL_VERSION,
  VARIANT_LABEL, type EngineInput,
} from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  localDate, requireEntitlement, requireUser,
} from '../_shared/context.ts';
import { auditInputs } from '../_shared/audit.ts';
import { loadProgressSnapshot } from '../_shared/progress.ts';
import { exerciseHistory, loadPerformanceLogs } from '../_shared/exercise-history.ts';
import { guidanceFor } from '../_shared/guidance.ts';
import { performanceTrend } from '../_shared/trends.ts';
import { daysAgo, sessionMinutes } from '../_shared/readiness-history.ts';
import { ensureWeekQueue } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    const db = clientFor(req);
    const user = await requireUser(db);
    await requireEntitlement(db, user.id);
    const today = localDate(user.timezone);

    const [content, state] = await Promise.all([
      loadContent(db),
      loadAthleteState(db, user.id, today),
    ]);

    const templateIndex = new Map(content.templates.map(t => [t.id, t]));

    // Recent sessions arrive without their family/goal; fill from content so
    // the spacing and continuity rules have what they need.
    const recent_sessions = state.recent_sessions.map(s => {
      const tpl = templateIndex.get(s.template_id);
      return {
        ...s,
        workout_family: tpl?.workout_family ?? '',
        primary_goal: tpl?.primary_goal ?? '',
        impact_level: tpl?.impact_level ?? 'medium',
      };
    });

    const checkin = state.checkin;
    const input: EngineInput = {
      local_date: today,
      phase_type: state.currentPhase?.phase_type ?? 'build',
      days_to_race: state.daysToRace,
      stimulus_requirements: state.stimulus_requirements,
      recent_sessions,
      recovery_state: recoveryFromEnergy(checkin?.energy),
      energy: checkin?.energy ?? 'normal',
      sleep_hours: checkin?.sleep_hours ?? null,
      available_minutes: state.profile?.typical_session_minutes ?? 45,
      available_equipment: state.available_equipment,
      low_impact_required: state.profile?.impact_tolerance === 'low',
      symptom_flags: Object.keys(checkin?.symptom_json ?? {}),
      considerations: state.profile?.considerations ?? [],
      candidates: content.candidates,
      substitutions: content.substitutions,
      // Stated preference and demonstrated deficit. Both are scoring inputs and
      // neither is a filter: every hard constraint has already run by the time
      // anything here is read (rank.ts).
      preferred_families: state.preferred_families,
      avoided_families: state.avoided_families,
      capability_needs: state.capability_needs,
      perceived_weaknesses: state.perceived_weaknesses,
    };

    const decision = recommend(input, content.exercises);

    /**
     * The week's queue, filled on first sight.
     *
     * Programs generated before there was a planner have phases, cycles and
     * stimulus requirements but no sessions naming them — which left Plan empty
     * and every finished session crediting nothing. Filling it here covers both
     * those athletes and each new week as it becomes active, without the client
     * having to ask for it.
     */
    let queueItems = (state.currentCycle?.session_queue_items ?? []) as any[];
    if (state.currentCycle?.id && !queueItems.length) {
      const planned = await ensureWeekQueue({
        db,
        cycleId: state.currentCycle.id,
        requirements: state.stimulus_requirements,
        templates: content.templates,
        exercises: content.exercises,
        input,
      });
      if (planned.length) {
        // Re-read so the payload carries the rows' real ids: the client sends
        // them back to `reshape-week`, which resolves them against the table.
        const { data } = await db.from('session_queue_items')
          .select('*').eq('weekly_cycle_id', state.currentCycle.id).order('rank');
        queueItems = data ?? [];
      }
    }

    // Readiness and the stats behind it, computed from stored history by the
    // same helper Coach narrates from — so the sentence and the number cannot
    // drift apart (PRD §9.5).
    const { readiness, metric_detail, comparable } = await loadProgressSnapshot({
      db, userId: user.id, today, content, state,
    });

    /**
     * Last exposure and suggested load for today's movements.
     *
     * Loaded separately from the readiness history rather than sharing it: that
     * loader selects a shorter window and omits `source`, and without `source`
     * every row reads as an unverified Complete tap and is correctly excluded
     * as evidence — which would silently produce guidance for nobody.
     *
     * Skipped entirely on a no_session day. There is no session to guide, and
     * the queries are not worth making to answer that.
     */
    const [{ setLogs }, rulesRes] = await Promise.all([
      loadPerformanceLogs(db, state.sessionRows.map((s: any) => s.id)),
      db.schema('content').from('progression_rules').select('*'),
    ]);
    const strengthHistories = exerciseHistory({
      today, sessions: state.sessionRows, setLogs,
    });

    let exercise_guidance: Record<string, unknown> = {};
    if (decision.kind === 'session') {
      exercise_guidance = guidanceFor({
        today,
        template: decision.template as any,
        histories: strengthHistories,
        rules: rulesRes.data ?? [],
        exercises: new Map(content.exercises.map((e: any) => [e.id, e])),
      });
    }

    /**
     * The one trend Progress may state, chosen from whichever evidence is
     * strongest. Null when nothing qualifies, which the screen renders as
     * "not enough comparable sessions yet" rather than hiding — an athlete
     * with no history is the common case for months, and an empty card that
     * explains itself is better than a card that vanishes.
     */
    const exerciseNames = new Map(content.exercises.map((e: any) => [e.id, e.name]));
    const performance_trend = performanceTrend({
      runs: comparable,
      strength: strengthHistories,
      nameFor: (id: string) => exerciseNames.get(id) ?? id,
    });

    /**
     * The week's queue, in the order the engine holds it. Names and durations
     * come from the content index rather than the queue row, which stores only
     * the template id — one source for what a session is called.
     */
    const queueRows = (queueItems as any[])
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .filter(q => q.state !== 'expired')
      .map(q => {
        const tpl = templateIndex.get(q.workout_template_id);
        return {
          id: q.id,
          template_id: q.workout_template_id,
          name: tpl?.name ?? q.workout_template_id,
          stimulus_type: q.stimulus_type,
          rank: q.rank,
          state: q.state,
          estimated_minutes: tpl?.estimated_minutes ?? null,
        };
      });

    /**
     * What the athlete completed this week. `snapshot_json` is the prescription
     * as it stood when the session started, so the minutes and stimulus here
     * are the ones actually performed rather than today's template values.
     */
    const completedRows = state.completed_this_week.map((s: any) => {
      const snapshot = (s.snapshot_json ?? {}) as Record<string, unknown>;
      const tpl = templateIndex.get(s.template_id);
      return {
        session_id: s.id,
        /**
         * The id the device that performed this session gave it.
         *
         * Sent so a client can recognise its own finished session in the week
         * without having had to hear back from Start — which is exactly the
         * case an offline session is in, and exactly why the optimistic
         * "completed today" counter could never retire itself there.
         */
        client_session_id: s.client_session_id ?? null,
        template_id: s.template_id,
        name: (snapshot.name as string) ?? tpl?.name ?? s.template_id,
        stimulus: (snapshot.primary_stimulus as string) ?? null,
        estimated_minutes: (snapshot.estimated_minutes as number)
          ?? tpl?.estimated_minutes ?? null,
        variant: s.variant_code,
        session_rpe: s.session_rpe,
        ended_early: s.ended_early,
        completed_on: (s.ended_at ?? s.started_at ?? '').slice(0, 10),
      };
    });

    /**
     * The last seven days of training, as volume rather than as a load score.
     *
     * Deliberately not an intensity-weighted figure: the app has no defended
     * load model, and a number an athlete would train against has to mean
     * something. Sessions and minutes are both measured, so both are honest.
     *
     * Minutes come from `sessionMinutes`, the same helper readiness uses — one
     * definition of how long a session took, including its guard against a
     * timer left running overnight.
     */
    const sevenDay = (state.sessionRows as any[])
      .filter(s => daysAgo(today, s.started_at) < 7);
    const training_7d = {
      sessions: sevenDay.length,
      minutes: Math.round(sevenDay.reduce((total, s) => {
        const snapshot = (s.snapshot_json ?? {}) as Record<string, unknown>;
        return total + sessionMinutes(s, {
          primary_goal: '',
          requires_running: false,
          estimated_minutes: (snapshot.estimated_minutes as number)
            ?? templateIndex.get(s.template_id)?.estimated_minutes ?? 0,
        });
      }, 0)),
    };

    // Audit row. Written on every decision, not only on adaptations.
    await db.from('adaptation_events').insert({
      user_id: user.id,
      selected_template_id: decision.kind === 'session' ? decision.template.id : null,
      selected_variant: decision.kind === 'session' ? decision.variant.variant_code : null,
      inputs_json: auditInputs(input),
      reason_codes: decision.reason_codes,
      rationale: decision.rationale,
      engine_version: ENGINE_VERSION,
    });

    return json({
      date_local: today,
      active_race: state.race && {
        id: state.race.id,
        name: state.race.event_name,
        // Date and division travel with the race. Today prints all three, and
        // was reading the last two from a fixture.
        event_date: state.race.event_date,
        division: state.race.division ?? null,
        goal_type: state.race.goal_type ?? null,
        days_remaining: state.daysToRace,
      },
      phase: state.currentPhase && {
        type: state.currentPhase.phase_type,
        order: state.currentPhase.phase_order,
        /** Week within this phase. */
        week: state.weekInPhase,
        weeks: state.phaseSequence
          .find(p => p.order === state.currentPhase.phase_order)?.weeks ?? 0,
        /** Week within the whole program — the "7 of 16" the roadmap draws. */
        program_week: state.programWeek,
        program_total_weeks: state.programTotalWeeks,
        /** Every phase in order, so the ribbon is the athlete's own plan. */
        sequence: state.phaseSequence,
        start_date: state.currentPhase.start_date,
        end_date: state.currentPhase.end_date,
      },
      /**
       * The current week as the Plan tab renders it: what is queued, and what
       * has already been done. Both were authored arrays in the client.
       */
      week: {
        start_date: state.weekStart,
        end_date: state.weekEnd,
        queue: queueRows,
        completed: completedRows,
      },
      /** Seven-day volume. See the note where it is computed. */
      training_7d,
      /**
       * The comparable running sessions behind a pace claim, or null when the
       * window holds nothing that qualifies. Coach says so rather than
       * comparing sessions that were not alike.
       */
      comparable_runs: comparable,
      /**
       * Last exposure and the suggested load, per movement in today's session.
       *
       * Sent with the recommendation because the player cannot compute it: the
       * input is the athlete's whole logged history. Empty when today is a
       * no_session, or when nothing prescribes working sets — a distance carry
       * has no load to progress, and an empty entry would invite the screen to
       * render a blank where a number should be.
       */
      exercise_guidance,
      performance_trend,
      /**
       * What performance has demonstrated, as PIVOT determined it — direction,
       * confidence and the sample behind each. Bands, never numbers: the
       * schema stores them that way so nobody renders "82% confident", and the
       * screen has to honour that or the safeguard was pointless.
       */
      capability_state: state.capability_state,
      /** What the athlete says needs work. A different claim, kept separate. */
      perceived_weaknesses: state.perceived_weaknesses,
      // Self-reported recovery, carried with its source and the day it was
      // logged (PRD §11.1 — health-derived values never arrive anonymous).
      // `source` is always self_reported until HealthKit ingestion lands.
      recovery: checkin ? {
        sleep_hours: checkin.sleep_hours ?? null,
        energy: checkin.energy ?? null,
        source: 'self_reported' as const,
        observed_on: checkin.local_date,
      } : null,
      readiness: {
        overall: readiness.overall,
        confidence: readiness.confidence,
        components: readiness.components,
        observed: readiness.observed,
        model_version: READINESS_MODEL_VERSION,
        metric_detail,
      },
      // The decision is returned as the engine produced it rather than
      // flattened for the wire. The client renders `Recommendation` already, so
      // reshaping here would force it to rebuild what it was just sent — and
      // `template` carries fields (intensity_target) the steps list needs.
      recommendation: decision.kind === 'session' ? {
        ...decision,
        variant_label: VARIANT_LABEL[decision.variant.variant_code],
      } : null,
      no_session: decision.kind === 'no_session' ? {
        reason_codes: decision.reason_codes,
        rationale: decision.rationale,
        guidance: decision.guidance,
      } : null,
      // Engine inputs the client also renders (Plan's weekly stimuli, Progress's
      // history). Sent alongside the decision so one round trip fills Today,
      // Plan and Progress rather than three.
      stimulus_requirements: state.stimulus_requirements,
      recent_sessions,
      engine_version: ENGINE_VERSION,
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});
