/**
 * POST /v1/weekly-cycles/current/replan — bring this week's queue in line with
 * the athlete's equipment after they change it.
 *
 * The week is planned once, when it is first opened, against the equipment
 * saved at that moment. Today's decision and Start already read the current
 * equipment, so nobody is handed a session they cannot do; but Plan went on
 * listing sessions planned around kit the athlete had just said they do not
 * have, and a need nothing could meet (strength work, before a barbell) stayed
 * unmet after they added one.
 *
 * Replaces only what is no longer possible (see `replanWeekQueue`): finished,
 * started and dropped sessions are left alone, a session still possible keeps
 * its place, and a replacement takes the rank of the session it replaces.
 *
 * Takes no body: the equipment is read from the saved profile, so what the
 * week is planned against is what was actually stored.
 */
import { recoveryFromEnergy, type EngineInput } from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  localDate, requireEntitlement, requireUser,
} from '../_shared/context.ts';
import { CLAIMABLE_STATES, replanWeekQueue, type QueueItem } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const db = clientFor(req);
    const user = await requireUser(db);
    // A change to the plan, as `reshape-week` is.
    await requireEntitlement(db, user.id);
    const today = localDate(user.timezone);

    const [content, state] = await Promise.all([
      loadContent(db),
      loadAthleteState(db, user.id, today),
    ]);

    const cycleId = state.currentCycle?.id;
    // No week yet: `today` plans it against the saved equipment when it opens,
    // so there is nothing stale to correct.
    if (!cycleId) return json({ weekly_cycle_id: null, expired: 0, added: 0, local_date: today }, 200, origin);

    // The planning context, as `today` builds it. Only what eligibility reads
    // matters here; the planner neutralises recovery and recent sessions
    // itself, so a bad night does not reshape the rest of the week.
    const input: EngineInput = {
      local_date: today,
      phase_type: state.currentPhase?.phase_type ?? 'build',
      days_to_race: state.daysToRace,
      stimulus_requirements: state.stimulus_requirements,
      recent_sessions: [],
      recovery_state: recoveryFromEnergy(undefined),
      energy: 'normal',
      sleep_hours: null,
      available_minutes: state.profile?.typical_session_minutes ?? 45,
      available_equipment: state.available_equipment,
      low_impact_required: state.profile?.impact_tolerance === 'low',
      load_capacity: state.effective_load_capacity,
      technical_capacity: state.profile?.technical_capacity ?? null,
      symptom_flags: [],
      considerations: state.profile?.considerations ?? [],
      candidates: content.candidates,
      substitutions: content.substitutions,
    };

    const { expire, add } = replanWeekQueue({
      items: (state.currentCycle?.session_queue_items ?? []) as QueueItem[],
      requirements: state.stimulus_requirements,
      templates: content.templates,
      exercises: content.exercises,
      input,
      rotation: (state.programWeek ?? 1) - 1,
    });

    // Additions first. If the second write fails the week briefly holds both
    // the old session and its replacement, which the next replan settles; the
    // other order could leave it with neither.
    if (add.length) {
      const { error } = await db.from('session_queue_items').insert(
        add.map(i => ({
          weekly_cycle_id: cycleId,
          workout_template_id: i.workout_template_id,
          stimulus_type: i.stimulus_type,
          rank: i.rank,
          state: 'queued',
        })),
      );
      if (error) throw new HttpError(500, `Could not add the replacement sessions: ${error.message}`);
    }

    if (expire.length) {
      // Only while still open: a session started since the week was read is
      // the athlete's now, whatever it needs.
      const { error } = await db.from('session_queue_items')
        .update({ state: 'expired' })
        .in('id', expire)
        .in('state', CLAIMABLE_STATES);
      if (error) throw new HttpError(500, `Could not retire the old sessions: ${error.message}`);
    }

    return json({
      weekly_cycle_id: cycleId,
      expired: expire.length,
      added: add.length,
      local_date: today,
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});
