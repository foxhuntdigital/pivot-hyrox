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
  recommend, ENGINE_VERSION, VARIANT_LABEL, type EngineInput, type VariantCode,
} from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  localDate, requireUser,
} from '../_shared/context.ts';

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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const db = clientFor(req);
    const user = await requireUser(db);
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
    const { data: openSession } = await db
      .from('workout_sessions')
      .select('id, revision, template_id, variant_code, status, snapshot_json')
      .eq('user_id', user.id)
      .eq('template_id', template.id)
      .in('status', OPEN_STATUSES)
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
      recovery_state: body.energy === 'low' ? 'poor' : body.energy === 'high' ? 'good' : 'okay',
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
    const queueItemId = await claimQueueItem(db, state.currentCycle?.id, template.id);

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
 * the week, and the one they picked is the one being performed.
 */
async function claimQueueItem(
  db: ReturnType<typeof clientFor>,
  cycleId: string | undefined,
  templateId: string,
): Promise<string | null> {
  if (!cycleId) return null;
  const { data: item } = await db
    .from('session_queue_items')
    .select('id')
    .eq('weekly_cycle_id', cycleId)
    .eq('workout_template_id', templateId)
    .in('state', ['queued', 'recommended'])
    .order('rank')
    .limit(1)
    .maybeSingle();
  if (!item) return null;

  await db.from('session_queue_items').update({ state: 'in_progress' }).eq('id', item.id);
  return item.id;
}
