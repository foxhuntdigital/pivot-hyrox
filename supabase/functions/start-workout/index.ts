/**
 * POST /v1/workout-sessions — open the session the athlete is about to perform
 * (PRD §6.2 step 6).
 *
 * This is the row every later record hangs off: `complete-workout` finalises
 * it, readiness is measured from it, and the week's stimulus is credited
 * through the queue item it points at. Nothing downstream exists until it does.
 *
 * The chosen template is run through the engine rather than accepted as sent —
 * the same rule `adapt` follows. A client naming a template does not get to
 * skip eligibility, substitution or the stimulus check, and a request the
 * guardrails refuse opens no session at all.
 *
 * Starting twice is not two sessions. A tapped-twice Start, or a retry after a
 * dropped response, finds the session already open for this template and
 * returns it (PRD §15.1).
 */
import {
  recommend, recoveryFromEnergy, evaluateSupplementalEligibility,
  ENGINE_VERSION, VARIANT_LABEL,
  type EngineInput, type VariantCode,
} from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  loadTodaySessions, localDate, requireEntitlement, requireUser,
} from '../_shared/context.ts';
import { claimableFor, type QueueItem } from '../_shared/queue.ts';

interface StartBody {
  template_id: string;
  /** The variant the athlete accepted. Omitted lets the engine choose. */
  variant_code?: VariantCode;
  /** Adapt-sheet inputs, when the session was started from an adaptation. */
  available_minutes?: number;
  energy?: 'low' | 'normal' | 'high';
  sleep_hours?: number | null;
  low_impact?: boolean;
  symptom_flags?: string[];
  unavailable_equipment?: string[];
}

/** Sessions that are still the athlete's to perform. */
const OPEN_STATUSES = ['ready', 'active', 'paused', 'completed_pending_review'];

/**
 * How long an open session stays resumable.
 *
 * Resuming exists for a tapped-twice Start and for a retry after a dropped
 * response — both measured in seconds. It was unbounded, which turned every
 * session the athlete never finished into a permanent trap: the row stayed
 * `active`, and the next Start on that template returned it *before* the engine
 * ran, so a fortnight-old prescription was handed back with its original
 * `started_at` and its original snapshot. The athlete's logs were then written
 * against that snapshot's block rows, and history dated the entry from
 * `snapshot_json.started_local_date` — a workout they never did, on a day they
 * did not train.
 *
 * Twelve hours is longer than any session and shorter than any gap between two,
 * so it resumes what resuming is for and opens a fresh row for everything else.
 */
const RESUMABLE_HOURS = 12;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const db = clientFor(req);
    const user = await requireUser(db);
    await requireEntitlement(db, user.id);
    const today = localDate(user.timezone);
    const body = await req.json().catch(() => null) as StartBody | null;

    if (!body?.template_id) throw new HttpError(400, 'template_id is required');

    const [content, state] = await Promise.all([
      loadContent(db),
      loadAthleteState(db, user.id, today),
    ]);

    const templateIndex = new Map(content.templates.map(t => [t.id, t]));
    const template = templateIndex.get(body.template_id);
    if (!template) throw new HttpError(400, 'Unknown template');

    // An already-open session for this template is the same session, not a
    // second one. Returning it keeps Start idempotent without a dedupe column.
    //
    // Bounded by `RESUMABLE_HOURS`: past that the row is not an in-flight
    // session, it is one that was never closed, and resuming it would return a
    // stale prescription for today's work.
    const resumableSince = new Date(Date.now() - RESUMABLE_HOURS * 3_600_000).toISOString();
    const { data: openSession } = await db
      .from('workout_sessions')
      .select('id, revision, template_id, variant_code, status, snapshot_json')
      .eq('user_id', user.id)
      .eq('template_id', template.id)
      .in('status', OPEN_STATUSES)
      .gte('created_at', resumableSince)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openSession) {
      const snapshot = openSession.snapshot_json as Record<string, unknown> | null;
      return json({
        session_id: openSession.id,
        revision: openSession.revision,
        status: openSession.status,
        template_id: openSession.template_id,
        variant: openSession.variant_code,
        resumed: true,
        primary_stimulus: snapshot?.primary_stimulus ?? null,
        engine_version: ENGINE_VERSION,
      }, 200, origin);
    }

    // Constrain the engine to the accepted variant by offering it only that
    // one. Every other guardrail still applies, so an accepted variant the
    // athlete is not eligible for today refuses rather than starts.
    const candidate = body.variant_code
      ? { ...template, variants: template.variants.filter(v => v.variant_code === body.variant_code) }
      : template;
    if (body.variant_code && !candidate.variants.length) {
      throw new HttpError(400, `Template has no ${body.variant_code} variant`);
    }

    const unavailable = new Set(body.unavailable_equipment ?? []);
    const equipment = state.available_equipment.filter(e => !unavailable.has(e));

    const input: EngineInput = {
      local_date: today,
      phase_type: state.currentPhase?.phase_type ?? 'build',
      days_to_race: state.daysToRace,
      stimulus_requirements: state.stimulus_requirements,
      recent_sessions: state.recent_sessions.map(s => {
        const tpl = templateIndex.get(s.template_id);
        return {
          ...s,
          workout_family: tpl?.workout_family ?? '',
          primary_goal: tpl?.primary_goal ?? '',
          impact_level: tpl?.impact_level ?? 'medium',
        };
      }),
      recovery_state: recoveryFromEnergy(body.energy),
      energy: body.energy ?? state.checkin?.energy ?? 'normal',
      sleep_hours: body.sleep_hours ?? state.checkin?.sleep_hours ?? null,
      available_minutes: body.available_minutes
        ?? state.profile?.typical_session_minutes ?? 45,
      available_equipment: equipment.length ? equipment : ['bodyweight'],
      low_impact_required: body.low_impact ?? state.profile?.impact_tolerance === 'low',
      symptom_flags: body.symptom_flags ?? [],
      considerations: state.profile?.considerations ?? [],
      candidates: [candidate],
      substitutions: content.substitutions,
    };

    /**
     * A supplemental is gated here as well as offered by /v1/supplemental.
     *
     * The offer endpoint is what the app reads, and a client that skips it — an
     * old build, a replayed request, a deep link — must not be able to open
     * work the athlete's recovery says no to. Checked before the engine runs,
     * because the answer does not depend on the engine: it depends on what they
     * already did today and how they are.
     */
    const role = template.workout_role ?? 'primary';
    if (role === 'supplemental') {
      const { completedPrimary, supplementalTakenToday } =
        await loadTodaySessions(db, user.id, today);
      const primaryTemplate = completedPrimary
        ? templateIndex.get(completedPrimary.template_id)
        : undefined;

      const gate = evaluateSupplementalEligibility({
        input,
        primary: completedPrimary && primaryTemplate
          ? {
            template: primaryTemplate,
            session_rpe: completedPrimary.session_rpe,
            ended_early: completedPrimary.ended_early ?? false,
          }
          : null,
        supplementalTakenToday,
      });
      if (!gate.allowed) {
        return json({
          session_id: null,
          refused: true,
          reason_codes: [gate.reason_code],
          rationale: 'Supplemental work is not on offer right now.',
          guidance: 'Finish the day here. Nothing is pending.',
          engine_version: ENGINE_VERSION,
        }, 409, origin);
      }
    }

    const decision = recommend(input, content.exercises);

    // The guardrails refused. That is an answer, not a failure — return it with
    // the engine's own guidance and open nothing.
    if (decision.kind !== 'session') {
      return json({
        session_id: null,
        refused: true,
        reason_codes: decision.reason_codes,
        rationale: decision.rationale,
        guidance: decision.guidance,
        engine_version: ENGINE_VERSION,
      }, 409, origin);
    }

    // The queued item this session performs, so completion credits the week's
    // stimulus. Absent when the athlete started something off-plan — the
    // session is still recorded, it just credits nothing.
    // A supplemental credits no requirement: the week asked for a primary
    // session and already got one. Claiming a queue item for it would count the
    // bonus as the work, which is the opposite of what it is.
    const queueItemId = role === 'supplemental'
      ? null
      : await claimQueueItem(
        db, (state.currentCycle?.session_queue_items ?? []) as QueueItem[], template.id);

    const snapshot = {
      template_id: decision.template.id,
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
      started_local_date: today,
    };

    const { data: session, error: insertError } = await db
      .from('workout_sessions')
      .insert({
        user_id: user.id,
        queue_item_id: queueItemId,
        template_id: decision.template.id,
        variant_code: decision.variant.variant_code,
        snapshot_json: snapshot,
        status: 'active',
        started_at: new Date().toISOString(),
        // Copied from the template, not joined from it later. A template
        // re-roled next month must not change what this athlete did today
        // (migration 0017).
        workout_role: role,
        revision: 0,
      })
      .select('id, revision')
      .single();
    if (insertError || !session) {
      throw new HttpError(500, `Could not open session: ${insertError?.message}`);
    }

    // Block rows are written up front so `complete-workout` has something to
    // attach each block's actuals to, and so an abandoned session still records
    // what was prescribed.
    if (decision.blocks.length) {
      const { error: blocksError } = await db.from('session_blocks').insert(
        decision.blocks.map((block, i) => ({
          session_id: session.id,
          block_order: i,
          block_type: block.block_type,
          prescribed_json: block,
        })),
      );
      // A missing block row costs per-block actuals, not the session. The
      // athlete is already training by the time this would surface.
      if (blocksError) console.error('session_blocks insert failed', blocksError.message);
    }

    return json({
      session_id: session.id,
      revision: session.revision,
      status: 'active',
      resumed: false,
      queue_item_id: queueItemId,
      template_id: decision.template.id,
      name: decision.template.name,
      variant: decision.variant.variant_code,
      variant_label: VARIANT_LABEL[decision.variant.variant_code],
      estimated_minutes: decision.estimated_minutes,
      primary_stimulus: decision.primary_stimulus,
      blocks: decision.blocks,
      reason_codes: decision.reason_codes,
      rationale: decision.rationale,
      local_date: today,
      engine_version: ENGINE_VERSION,
    }, 201, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});

/**
 * Marks the matching queued item in progress and returns its id.
 *
 * Matching on template rather than rank: the athlete may start any session in
 * the week, and the one they picked is the one being performed. The week's
 * items are already loaded with the athlete's state, so the choice is made
 * here rather than in a second query.
 */
async function claimQueueItem(
  db: ReturnType<typeof clientFor>,
  items: QueueItem[],
  templateId: string,
): Promise<string | null> {
  const item = claimableFor(items, templateId);
  if (!item) return null;

  await db.from('session_queue_items').update({ state: 'in_progress' }).eq('id', item.id);
  return item.id;
}
