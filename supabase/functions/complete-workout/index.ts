/**
 * POST /v1/workout-sessions/{id}/complete — finalise a session and reconcile
 * the plan (PRD §6.2 step 7).
 *
 * Idempotent by construction: completion carries a client-generated event id
 * and a monotonic revision, so a replayed offline event updates the same row
 * rather than double-counting a stimulus (PRD §15.1).
 *
 * The writes themselves are one transaction (`complete_workout_tx`, migration
 * 0022), and the replay and revision guards live inside it behind a row lock.
 * Everything that follows from a session being finished — its logs, its splits,
 * the week's credit — commits with the status change or not at all, so there is
 * no state in which the session reads as completed and the week disagrees.
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

    /**
     * Which week this session credits, resolved before the transaction opens.
     *
     * A read, and it does not need to be inside the transaction to be correct:
     * the worst a concurrent change could do is credit the week the athlete was
     * in a moment ago, which is the same answer the old code gave. Keeping it
     * here keeps the periodisation rules in one language rather than half of
     * them in plpgsql.
     *
     * The queue item is preferred — it names the exact requirement the session
     * was queued against. Without one, the athlete's current cycle is resolved
     * the same way `today` resolves it, so the counter this credits is the
     * counter they saw. Crediting used to *require* the queue item, which made
     * the week's counter a measure of queue adherence rather than of training
     * done: a session started off plan completed and credited nothing, and the
     * athlete read "0 / 7 stimuli" after finishing a workout.
     */
    const snapshot = session.snapshot_json as { primary_stimulus?: string } | null;

    /**
     * A supplemental credits nothing, however well it matches.
     *
     * It carries a stimulus like any session, and the fallback below matches a
     * session's own stimulus against the week when there is no queue item to
     * name a requirement — which a supplemental never has. Without this it would
     * land squarely in that branch and count the optional extra as the week's
     * work, which inverts what a supplemental is.
     */
    const isSupplemental = (session.workout_role ?? 'primary') === 'supplemental';
    const stimulus = isSupplemental ? null : (snapshot?.primary_stimulus ?? null);

    let cycleId: string | null = null;
    if (stimulus) {
      if (session.queue_item_id) {
        const { data: queueItem } = await db
          .from('session_queue_items')
          .select('weekly_cycle_id')
          .eq('id', session.queue_item_id)
          .maybeSingle();
        cycleId = queueItem?.weekly_cycle_id ?? null;
      }
      if (!cycleId) {
        const state = await loadAthleteState(db, user.id, today);
        cycleId = state.currentCycle?.id ?? null;
      }
    }

    /**
     * Everything that follows from the session being finished, committed
     * together or not at all (migration 0022).
     *
     * This used to be six sequential writes. The session was marked `completed`
     * first and the week credited last, so anything that threw between them
     * returned 500 with the session already finished — and the retry then hit
     * the replay guard, reported success, and credited nothing. The athlete had
     * trained, the app agreed, and the week's counter disagreed permanently.
     */
    const { data: result, error: txError } = await db.rpc('complete_workout_tx', {
      p_session_id: body.session_id,
      p_revision: body.revision,
      p_session_rpe: body.session_rpe ?? null,
      p_notes: body.notes ?? null,
      p_ended_early: body.ended_early ?? false,
      p_blocks: body.blocks ?? [],
      p_set_logs: body.set_logs ?? [],
      p_cardio_logs: body.cardio_logs ?? [],
      p_splits: body.splits ?? null,
      p_cycle_id: cycleId,
      p_stimulus: stimulus,
    });

    if (txError) {
      // The two the function raises deliberately, mapped back to the answers
      // the client already knows how to read.
      if (txError.message?.includes('stale_revision')) {
        throw new HttpError(409, 'Stale revision');
      }
      if (txError.message?.includes('session_not_found')) {
        throw new HttpError(404, 'Session not found');
      }
      throw new HttpError(500, txError.message);
    }

    const outcome = result as {
      session_id: string; status: string;
      credited_stimulus: string | null; replayed: boolean;
    };

    if (outcome.replayed) {
      return json({
        session_id: outcome.session_id,
        status: outcome.status,
        replayed: true,
      }, 200, origin);
    }

    /**
     * Derived after the fact, and deliberately outside the transaction.
     *
     * Capability evidence is computed from the logs once they have landed, by
     * rules that live in TypeScript, and it is rebuilt from scratch on every
     * finish — so a failure here is a gap the next session repairs rather than a
     * lost record. It must never be able to fail a request that has already
     * completed the session and credited the week.
     */
    await writeCapabilityEvidence(db, user.id, body.session_id, today);

    return json({
      session_id: outcome.session_id,
      status: 'completed',
      local_date: today,
      credited_stimulus: outcome.credited_stimulus,
      engine_version: ENGINE_VERSION,
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});


/**
 * What this session showed about the athlete's capabilities.
 *
 * Runs after the logs are written, because it reads them back: the evidence is
 * derived from what landed, not from what the client claimed, so a set that was
 * rejected on the way in cannot become a capability reading on the way out.
 *
 * Deleted before inserting, for the same reason the logs are. A finish is a
 * statement about the whole session, and a corrected finish that left the first
 * reading in place would let one session write evidence twice — which is
 * exactly the arithmetic `capabilityState` counts.
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
