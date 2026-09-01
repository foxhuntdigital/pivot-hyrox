/**
 * GET /v1/supplemental — the optional extra on offer after today's session,
 * or the reason there isn't one.
 *
 * Deliberately its own endpoint rather than a field on the finish response.
 * `complete-workout` is the hot path an athlete waits on with their thumb over
 * the screen, and it already writes logs, splits, capability evidence and the
 * week's credit; loading the whole content library onto it to answer a question
 * about an optional extra would slow the one request that must not be slow.
 * The done screen asks for this separately, and an athlete who closes the app
 * instead has lost nothing — a supplemental that is never fetched was never
 * pending.
 *
 * Read-only. Taking one goes through `start-workout` like any other session,
 * because that is what it is: the same player, the same logging, the same
 * completion path. What differs is only that it credits no requirement.
 */
import {
  recoveryFromEnergy, type EngineInput,
} from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  loadTodaySessions, localDate, requireEntitlement, requireUser,
} from '../_shared/context.ts';
import {
  supplementalOffer, SUPPLEMENTAL_MAX_MINUTES, type SupplementalType,
} from '../_shared/supplemental.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

    const db = clientFor(req);
    const user = await requireUser(db);
    await requireEntitlement(db, user.id);
    const today = localDate(user.timezone);

    const url = new URL(req.url);
    const minutesParam = Number(url.searchParams.get('minutes'));
    const minutes = Number.isFinite(minutesParam) && minutesParam > 0
      ? Math.min(minutesParam, SUPPLEMENTAL_MAX_MINUTES)
      : SUPPLEMENTAL_MAX_MINUTES;
    const type = (url.searchParams.get('type') ?? undefined) as SupplementalType | undefined;

    const [content, state] = await Promise.all([
      loadContent(db),
      loadAthleteState(db, user.id, today),
    ]);
    const templateIndex = new Map(content.templates.map(t => [t.id, t]));

    const { completedPrimary, supplementalTakenToday } =
      await loadTodaySessions(db, user.id, today);

    const checkin = state.checkin;
    const input: EngineInput = {
      local_date: today,
      phase_type: state.currentPhase?.phase_type ?? 'build',
      days_to_race: state.daysToRace,
      stimulus_requirements: state.stimulus_requirements,
      recent_sessions: state.recent_sessions.map((s: any) => {
        const tpl = templateIndex.get(s.template_id);
        return {
          ...s,
          workout_family: tpl?.workout_family ?? '',
          primary_goal: tpl?.primary_goal ?? '',
          impact_level: tpl?.impact_level ?? 'medium' as const,
        };
      }),
      recovery_state: recoveryFromEnergy(checkin?.energy),
      energy: checkin?.energy ?? 'normal',
      sleep_hours: checkin?.sleep_hours ?? null,
      available_minutes: minutes,
      available_equipment: state.available_equipment,
      low_impact_required: state.profile?.impact_tolerance === 'low',
      symptom_flags: Object.keys(checkin?.symptom_json ?? {}),
      considerations: state.profile?.considerations ?? [],
      candidates: content.candidates,
      substitutions: content.substitutions,
      preferred_families: state.preferred_families,
      avoided_families: state.avoided_families,
      capability_needs: state.capability_needs,
    };

    const primaryTemplate = completedPrimary
      ? templateIndex.get(completedPrimary.template_id)
      : undefined;

    const offer = supplementalOffer({
      input,
      // Every template, not the planner's pool: `candidates` deliberately
      // excludes supplementals, which is exactly what this endpoint offers.
      // Retired ones are filtered inside searchSupplementals by eligibility,
      // and a retired supplemental carries `status` the same way.
      templates: content.templates.filter((t: any) => t.status !== 'retired'),
      exercises: content.exercises,
      // A completed session whose template has since been retired still counts
      // as the day's primary — the athlete trained. Looked up in `templates`
      // rather than `candidates` for exactly that reason.
      primary: completedPrimary && primaryTemplate
        ? {
          template: primaryTemplate,
          session_rpe: completedPrimary.session_rpe,
          ended_early: completedPrimary.ended_early ?? false,
        }
        : null,
      supplementalTakenToday,
      minutes,
      type,
    });

    return json({ ...offer, local_date: today, minutes }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});
