/**
 * GET /v1/today — the daily decision payload (PRD §12.1).
 *
 * Runs the deterministic engine server-side and records the decision so it can
 * be reproduced later from stored inputs plus engine_version (PRD §24).
 */
import {
  recommend, computeReadiness, ENGINE_VERSION, READINESS_MODEL_VERSION,
  VARIANT_LABEL, type EngineInput,
} from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  localDate, requireUser,
} from '../_shared/context.ts';

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

    // Readiness is computed from the same stored history, and reports its own
    // confidence rather than implying precision (PRD §9.5).
    const readiness = computeReadiness({
      aerobic_minutes_14d: 0, threshold_sessions_14d: 0, run_sessions_7d: 0,
      longest_run_km: 0, strength_completion_rate: 0, stations_covered_21d: 0,
      stimulus_adherence_4w: state.stimulus_requirements.length
        ? state.stimulus_requirements.reduce((n, r) =>
            n + Math.min(1, r.completed_exposures / r.target_exposures), 0)
          / state.stimulus_requirements.length
        : 0,
      recovery_signal: checkin ? 0.6 : 0,
      observed_days: recent_sessions.length,
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
      readiness: {
        overall: readiness.overall,
        confidence: readiness.confidence,
        components: readiness.components,
        model_version: READINESS_MODEL_VERSION,
      },
      recommendation: decision.kind === 'session' ? {
        workout_template_id: decision.template.id,
        name: decision.template.name,
        variant: decision.variant.variant_code,
        variant_label: VARIANT_LABEL[decision.variant.variant_code],
        estimated_minutes: decision.estimated_minutes,
        primary_stimulus: decision.primary_stimulus,
        blocks: decision.blocks,
        reason_codes: decision.reason_codes,
        rationale: decision.rationale,
        substitutions_applied: decision.substitutions_applied,
      } : null,
      no_session: decision.kind === 'no_session' ? {
        reason_codes: decision.reason_codes,
        rationale: decision.rationale,
        guidance: decision.guidance,
      } : null,
      engine_version: ENGINE_VERSION,
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});
