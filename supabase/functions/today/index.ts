/**
 * GET /v1/today — the daily decision payload (PRD §12.1).
 *
 * Runs the deterministic engine server-side and records the decision so it can
 * be reproduced later from stored inputs plus engine_version (PRD §24).
 */
import {
  recommend, ENGINE_VERSION, READINESS_MODEL_VERSION,
  VARIANT_LABEL, type EngineInput,
} from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  localDate, requireUser,
} from '../_shared/context.ts';
import { loadProgressSnapshot } from '../_shared/progress.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    const db = clientFor(req);
    const user = await requireUser(db);
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
      recovery_state: checkin?.energy === 'low' ? 'poor'
        : checkin?.energy === 'high' ? 'good' : 'okay',
      energy: checkin?.energy ?? 'normal',
      sleep_hours: checkin?.sleep_hours ?? null,
      available_minutes: state.profile?.typical_session_minutes ?? 45,
      available_equipment: state.available_equipment,
      low_impact_required: state.profile?.impact_tolerance === 'low',
      symptom_flags: Object.keys(checkin?.symptom_json ?? {}),
      considerations: state.profile?.considerations ?? [],
      candidates: content.templates,
      substitutions: content.substitutions,
    };

    const decision = recommend(input, content.exercises);

    // Readiness and the stats behind it, computed from stored history by the
    // same helper Coach narrates from — so the sentence and the number cannot
    // drift apart (PRD §9.5).
    const { readiness, metric_detail } = await loadProgressSnapshot({
      db, userId: user.id, today, content, state,
    });

    // Audit row. Written on every decision, not only on adaptations.
    await db.from('adaptation_events').insert({
      user_id: user.id,
      selected_template_id: decision.kind === 'session' ? decision.template.id : null,
      selected_variant: decision.kind === 'session' ? decision.variant.variant_code : null,
      inputs_json: input,
      reason_codes: decision.reason_codes,
      rationale: decision.rationale,
      engine_version: ENGINE_VERSION,
    });

    return json({
      date_local: today,
      active_race: state.race && {
        id: state.race.id,
        name: state.race.event_name,
        days_remaining: state.daysToRace,
      },
      phase: state.currentPhase && {
        type: state.currentPhase.phase_type,
        week: state.currentCycle?.week_index ?? 1,
      },
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
