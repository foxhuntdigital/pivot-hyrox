/**
 * POST /v1/workout-sessions/{id}/complete — finalise a session and reconcile
 * the plan (PRD §6.2 step 7).
 *
 * Idempotent by construction: completion carries a client-generated event id
 * and a monotonic revision, so a replayed offline event updates the same row
 * rather than double-counting a stimulus (PRD §15.1).
 */
import { ENGINE_VERSION } from '../../../packages/engine/src/index.ts';
import { exerciseHistory, loadPerformanceLogs } from '../_shared/exercise-history.ts';
import { evidenceFromSession } from '../_shared/evidence.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, localDate,
  requireEntitlement, requireUser,
} from '../_shared/context.ts';

interface CompleteBody {
  session_id: string;
  client_event_id: string;
  revision: number;
  session_rpe?: number;
  notes?: string;
  ended_early?: boolean;
  /** Per-block actuals captured during execution. */
  blocks?: { block_order: number; actual_json: unknown; completed_at?: string; skipped?: boolean }[];
  /**
   * What was performed, per set and per cardio effort. Written against the
   * session's own block rows, which `start-workout` created.
   *
   * These are replaced rather than appended: a finish states the whole session,
   * so a corrected or re-sent one must not double-count. `client_event_id` is
   * assigned here rather than by the client — the tables require a uuid, and
   * replacement is what makes the write idempotent, not the id.
   */
  set_logs?: {
    block_order: number; exercise_id: string; set_index: number;
    prescribed_reps?: number | null; actual_reps?: number | null;
    prescribed_load?: number | null; actual_load?: number | null;
    load_unit?: string | null; rpe?: number | null;
    /** The range and ceiling this set was performed against (migration 0012). */
    prescribed_reps_min?: number | null; prescribed_reps_max?: number | null;
    prescribed_rpe?: number | null; notes?: string | null;
    /**
     * 'manual' where the athlete typed something, 'asserted' where the row
     * exists only because they tapped Complete. Only the first is evidence: an
     * asserted row restates the prescription and cannot show a miss, so
     * trending it would read the library back as achievement. Absent means
     * asserted, matching the column default.
     */
    source?: 'asserted' | 'manual' | 'carried' | 'timer' | null;
  }[];
  cardio_logs?: {
    block_order: number; exercise_id: string;
    duration_seconds?: number | null; distance_meters?: number | null;
    avg_hr?: number | null; calories?: number | null; rpe?: number | null;
    /**
     * 'timer' where the player measured it, 'manual' where the athlete
     * corrected or entered it. Defaults to 'timer' because a distance step is
     * timed whether or not anyone typed anything — the opposite of a set,
     * which knows nothing unless asked.
     */
    source?: 'timer' | 'manual' | 'integration' | null;
  }[];
  /**
   * The laps the player's clock recorded, in order — one per completed step,
   * rest included. Keyed by `split_index` rather than by block, because a split
   * is a position in the session rather than a position in the prescription.
   *
   * Replaced on every finish for the same reason the logs are: a finish states
   * the whole session, and a re-sent one must not leave the previous ordering
   * interleaved with the new.
   */
  splits?: {
    index: number; block_order: number; round: number;
    exercise_id?: string | null; label: string; prescribed?: string | null;
    kind?: string | null; seconds: number; cumulative_seconds: number;
    rest?: boolean;
  }[];
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    const db = clientFor(req);
    const user = await requireUser(db);
    await requireEntitlement(db, user.id);
    const today = localDate(user.timezone);
    const body = await req.json() as CompleteBody;

    if (!body.session_id || !body.client_event_id) {
      throw new HttpError(400, 'session_id and client_event_id are required');
    }

    const { data: session, error } = await db
      .from('workout_sessions')
      .select('*')
      .eq('id', body.session_id)
      .single();
    if (error || !session) throw new HttpError(404, 'Session not found');

    // Replay of an event we already applied: return the current state rather
    // than reconciling twice.
    if (session.status === 'completed' && session.revision >= body.revision) {
      return json({ session_id: session.id, status: session.status, replayed: true }, 200, origin);
    }

    // A stale revision means another device already advanced this session.
    if (body.revision < session.revision) {
      throw new HttpError(409, 'Stale revision');
    }

    /**
     * Whether this session had already been counted.
     *
     * The replay guard above catches a resend at the same revision, which is
     * what a retrying outbox produces. It does not catch a *later* finish for a
     * session already completed — a correction — and that used to be harmless
     * because crediting required a queue item, which was marked `completed` on
     * the first pass and could not be claimed twice. Crediting by stimulus has
     * no such marker, so the guard has to be explicit or a corrected finish
     * would increment the week a second time.
     */
    const alreadyCounted = session.status === 'completed';

    const { error: updateError } = await db
      .from('workout_sessions')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        session_rpe: body.session_rpe ?? null,
        notes: body.notes ?? null,
        ended_early: body.ended_early ?? false,
        revision: body.revision,
      })
      .eq('id', body.session_id);
    if (updateError) throw new HttpError(500, updateError.message);

    for (const b of body.blocks ?? []) {
      await db.from('session_blocks')
        .update({
          actual_json: b.actual_json,
          completed_at: b.completed_at ?? null,
          skipped: b.skipped ?? false,
        })
        .eq('session_id', body.session_id)
        .eq('block_order', b.block_order);
    }

    await writeLogs(db, body);
    await writeSplits(db, body);
    await writeCapabilityEvidence(db, user.id, body.session_id, today);

    // Reconcile the week. A completed session credits its stimulus once,
    // whatever day it landed on (PRD §2, FR-012).
    //
    // Crediting used to require `queue_item_id`, which made the week's counter
    // a measure of *queue adherence* rather than of training done: a session
    // started off plan, or one whose queue item could not be claimed, was
    // completed and credited nothing. The athlete saw "0 / 7 stimuli" after
    // finishing a workout, which is the counter calling them a liar.
    //
    // The queue item is still preferred — it names the exact requirement the
    // session was queued against. Without one, the session's own stimulus is
    // matched against the current week's requirements, which is the same
    // question asked from the other end.
    const snapshot = session.snapshot_json as { primary_stimulus?: string } | null;
    const stimulus = snapshot?.primary_stimulus;
    let creditedStimulus: string | null = null;

    /**
     * A supplemental credits nothing, however well it matches.
     *
     * It carries a stimulus like any session, and the fallback below matches a
     * session's own stimulus against the week when there is no queue item to
     * name a requirement — which a supplemental never has. Without this it
     * would land squarely in that branch and count the optional extra as the
     * week's work, which inverts what a supplemental is: the week asked for a
     * primary session and already got one.
     */
    const isSupplemental = (session.workout_role ?? 'primary') === 'supplemental';

    if (stimulus && !alreadyCounted && !isSupplemental) {
      let cycleId: string | null = null;

      if (session.queue_item_id) {
        const { data: queueItem } = await db
          .from('session_queue_items')
          .select('weekly_cycle_id')
          .eq('id', session.queue_item_id)
          .maybeSingle();
        cycleId = queueItem?.weekly_cycle_id ?? null;
      }

      if (!cycleId) {
        // The week the athlete is actually in, resolved the same way `today`
        // resolves it, so the counter this credits is the counter they saw.
        const state = await loadAthleteState(db, user.id, today);
        cycleId = state.currentCycle?.id ?? null;
      }

      if (cycleId) {
        const { data: requirement } = await db
          .from('stimulus_requirements')
          .select('id, completed_exposures, target_exposures')
          .eq('weekly_cycle_id', cycleId)
          .eq('stimulus_type', stimulus)
          .maybeSingle();

        if (requirement) {
          await db.from('stimulus_requirements')
            .update({
              completed_exposures: Math.min(
                requirement.target_exposures, requirement.completed_exposures + 1),
            })
            .eq('id', requirement.id);
          creditedStimulus = stimulus;
        }
      }

      if (session.queue_item_id) {
        await db.from('session_queue_items')
          .update({ state: 'completed' })
          .eq('id', session.queue_item_id);
      }
    }

    return json({
      session_id: session.id,
      status: 'completed',
      local_date: today,
      credited_stimulus: creditedStimulus,
      engine_version: ENGINE_VERSION,
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});


/**
 * Writes what was performed against this session's block rows.
 *
 * Logs are keyed by `block_order` on the wire because that is what the client
 * knows: the prescription's shape, not the row ids the server minted. They are
 * resolved to `session_blocks.id` here.
 *
 * Existing logs for the session are cleared first. A finish is a statement
 * about the whole session, so re-sending one has to replace what it said before
 * rather than add to it — the alternative is a corrected finish doubling every
 * set the athlete performed.
 */
async function writeLogs(db: ReturnType<typeof clientFor>, body: CompleteBody) {
  const sets = body.set_logs ?? [];
  const cardio = body.cardio_logs ?? [];
  if (!sets.length && !cardio.length) return;

  const { data: blockRows } = await db
    .from('session_blocks')
    .select('id, block_order')
    .eq('session_id', body.session_id);

  const blockId = new Map<number, string>(
    (blockRows ?? []).map((b: { id: string; block_order: number }) => [b.block_order, b.id]));
  if (!blockId.size) return;

  const ids = [...blockId.values()];
  await db.from('set_logs').delete().in('session_block_id', ids);
  await db.from('cardio_logs').delete().in('session_block_id', ids);

  const setRows = sets
    .filter(l => blockId.has(l.block_order))
    .map(l => ({
      session_block_id: blockId.get(l.block_order)!,
      exercise_id: l.exercise_id,
      set_index: l.set_index,
      prescribed_reps: l.prescribed_reps ?? null,
      actual_reps: l.actual_reps ?? null,
      prescribed_load: l.prescribed_load ?? null,
      actual_load: l.actual_load ?? null,
      load_unit: l.load_unit ?? null,
      rpe: l.rpe ?? null,
      prescribed_reps_min: l.prescribed_reps_min ?? null,
      prescribed_reps_max: l.prescribed_reps_max ?? null,
      prescribed_rpe: l.prescribed_rpe ?? null,
      notes: l.notes ?? null,
      // Defaulted rather than trusted blank: a client that does not send it is
      // an older build whose rows are asserted by construction.
      source: l.source ?? 'asserted',
      client_event_id: crypto.randomUUID(),
    }));

  const cardioRows = cardio
    .filter(l => blockId.has(l.block_order))
    .map(l => ({
      session_block_id: blockId.get(l.block_order)!,
      exercise_id: l.exercise_id,
      duration_seconds: l.duration_seconds ?? null,
      distance_meters: l.distance_meters ?? null,
      avg_hr: l.avg_hr ?? null,
      calories: l.calories ?? null,
      rpe: l.rpe ?? null,
      source: l.source ?? 'timer',
      client_event_id: crypto.randomUUID(),
    }));

  // A failed log write must not fail the finish. The session is completed and
  // the week is credited either way; losing the detail is the smaller harm,
  // and it is recorded here rather than swallowed.
  if (setRows.length) {
    const { error } = await db.from('set_logs').insert(setRows);
    if (error) console.error('set_logs insert failed', error.message);
  }
  if (cardioRows.length) {
    const { error } = await db.from('cardio_logs').insert(cardioRows);
    if (error) console.error('cardio_logs insert failed', error.message);
  }
}

/**
 * Writes the session's splits, replacing whatever a previous finish recorded.
 *
 * Deleted before inserting rather than upserted: a session re-sent after ending
 * early is *shorter* than the one before it, and an upsert would leave the
 * earlier laps past its end in place — a session that ended at lap 6 still
 * claiming laps 7 through 12.
 *
 * Splits hang off the session, not off `session_blocks`, so unlike the logs
 * they can be written even when the block rows are missing.
 */
async function writeSplits(db: ReturnType<typeof clientFor>, body: CompleteBody) {
  if (!body.splits) return;

  await db.from('session_splits').delete().eq('session_id', body.session_id);
  if (!body.splits.length) return;

  const rows = body.splits.map(s => ({
    session_id: body.session_id,
    split_index: s.index,
    block_order: s.block_order,
    round: s.round ?? 1,
    exercise_id: s.exercise_id || null,
    label: s.label,
    prescribed: s.prescribed ?? null,
    kind: s.kind ?? null,
    seconds: Math.max(0, Math.round(s.seconds)),
    cumulative_seconds: Math.max(0, Math.round(s.cumulative_seconds)),
    rest: s.rest ?? false,
  }));

  // As with the logs: losing the detail must not fail a finish that has already
  // completed the session and credited the week.
  const { error } = await db.from('session_splits').insert(rows);
  if (error) console.error('session_splits insert failed', error.message);
}


/**
 * What this session showed about the athlete's capabilities.
 *
 * Runs after the logs are written, because it reads them back: the evidence is
 * derived from what landed, not from what the client claimed, so a set that was
 * rejected on the way in cannot become a capability reading on the way out.
 *
 * Deleted before inserting, for the same reason the logs are (see `writeLogs`).
 * A finish is a statement about the whole session, and a corrected finish that
 * left the first reading in place would let one session write evidence twice —
 * which is exactly the arithmetic `capabilityState` counts.
 *
 * Failures are logged and swallowed. An athlete who has finished their session
 * has finished it; a capability row that could not be derived is a gap in an
 * append-only log that the next session repairs, and is not a reason to fail
 * the request that credits their week.
 */
async function writeCapabilityEvidence(
  db: any, userId: string, sessionId: string, today: string,
): Promise<void> {
  try {
    const { data: sessions } = await db
      .from('workout_sessions')
      .select('id, template_id, variant_code, started_at, ended_at, session_rpe')
      .eq('user_id', userId).eq('status', 'completed')
      .order('started_at', { ascending: false }).limit(40);
    if (!sessions?.length) return;

    const { setLogs } = await loadPerformanceLogs(db, sessions.map((s: any) => s.id));
    if (!setLogs.length) return;

    const histories = exerciseHistory({ today, sessions, setLogs });
    const exposures = [...histories.values()].flatMap(history =>
      history.exposures.map(exposure => ({ exposure, history })));

    const { data: exercises } = await db.schema('content')
      .from('exercises').select('id, movement_families');
    const ontology = new Map<string, { movement_families?: string[] | null }>(
      (exercises ?? []).map((e: any) => [e.id, { movement_families: e.movement_families }]));

    const rows = evidenceFromSession({ sessionId, exposures, ontology });

    await db.from('athlete_capability_evidence').delete().eq('source_session_id', sessionId);
    if (!rows.length) return;

    const { error } = await db.from('athlete_capability_evidence').insert(
      rows.map(r => ({
        user_id: userId,
        capability_key: r.capability_key,
        direction: r.direction,
        magnitude_band: r.magnitude_band,
        confidence_band: r.confidence_band,
        source_session_id: r.source_session_id,
        rules_version: r.rules_version,
      })));
    if (error) console.error('capability evidence insert failed', error.message);
  } catch (err) {
    console.error('capability evidence failed', (err as Error).message);
  }
}
