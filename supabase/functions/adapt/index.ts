/**
 * POST /v1/adapt — recalculate today's recommendation from the adapt sheet.
 *
 * Body: { available_minutes, energy, low_impact, symptom_flags[],
 *         unavailable_equipment[], force_template_id?, force_variant? }
 *
 * A forced choice is still run through the engine rather than accepted
 * directly, so the guardrails apply equally to a session the athlete picked.
 */
import {
  recommend, ENGINE_VERSION, VARIANT_LABEL, type EngineInput,
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
    const body = await req.json().catch(() => ({}));

    const [content, state] = await Promise.all([
      loadContent(db),
      loadAthleteState(db, user.id, today),
    ]);

    const templateIndex = new Map(content.templates.map(t => [t.id, t]));
    const recent_sessions = state.recent_sessions.map(s => {
      const tpl = templateIndex.get(s.template_id);
      return {
        ...s,
        workout_family: tpl?.workout_family ?? '',
        primary_goal: tpl?.primary_goal ?? '',
        impact_level: tpl?.impact_level ?? 'medium',
      };
    });

    const unavailable = new Set<string>(body.unavailable_equipment ?? []);
    const available_equipment = state.available_equipment.filter(e => !unavailable.has(e));

    const forced = body.force_template_id ? templateIndex.get(body.force_template_id) : null;
    if (body.force_template_id && !forced) throw new HttpError(400, 'Unknown template');

    const input: EngineInput = {
      local_date: today,
      phase_type: state.currentPhase?.phase_type ?? 'build',
      days_to_race: state.daysToRace,
      stimulus_requirements: state.stimulus_requirements,
      recent_sessions,
      recovery_state: body.energy === 'low' ? 'poor' : body.energy === 'high' ? 'good' : 'okay',
      energy: body.energy ?? 'normal',
      sleep_hours: body.sleep_hours ?? state.checkin?.sleep_hours ?? null,
      available_minutes: body.available_minutes ?? 45,
      available_equipment: available_equipment.length ? available_equipment : ['bodyweight'],
      low_impact_required: Boolean(body.low_impact),
      symptom_flags: body.symptom_flags ?? [],
      considerations: state.profile?.considerations ?? [],
      candidates: forced ? [forced] : content.templates,
      substitutions: content.substitutions,
    };

    const decision = recommend(input, content.exercises);

    await db.from('adaptation_events').insert({
      user_id: user.id,
      original_template_id: body.original_template_id ?? null,
      original_variant: body.original_variant ?? null,
      selected_template_id: decision.kind === 'session' ? decision.template.id : null,
      selected_variant: decision.kind === 'session' ? decision.variant.variant_code : null,
      inputs_json: input,
      reason_codes: decision.reason_codes,
      rationale: decision.rationale,
      engine_version: ENGINE_VERSION,
    });

    return json(
      decision.kind === 'session'
        ? {
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
            engine_version: ENGINE_VERSION,
          }
        : {
            recommendation: null,
            reason_codes: decision.reason_codes,
            rationale: decision.rationale,
            guidance: decision.guidance,
            engine_version: ENGINE_VERSION,
          },
      200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});
