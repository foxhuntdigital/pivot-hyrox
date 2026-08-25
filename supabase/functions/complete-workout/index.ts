/**
 * POST /v1/workout-sessions/{id}/complete — finalise a session and reconcile
 * the plan (PRD §6.2 step 7).
 *
 * Idempotent by construction: completion carries a client-generated event id
 * and a monotonic revision, so a replayed offline event updates the same row
 * rather than double-counting a stimulus (PRD §15.1).
 */
import { ENGINE_VERSION } from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, localDate, requireUser,
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
  }[];
  cardio_logs?: {
    block_order: number; exercise_id: string;
    duration_seconds?: number | null; distance_meters?: number | null;
    avg_hr?: number | null; calories?: number | null; rpe?: number | null;
  }[];
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    const db = clientFor(req);
    const user = await requireUser(db);
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

    // Reconcile the week. A completed session credits its stimulus once,
    // whatever day it landed on (PRD §2, FR-012).
    const snapshot = session.snapshot_json as { primary_stimulus?: string } | null;
    const stimulus = snapshot?.primary_stimulus;
    let creditedStimulus: string | null = null;

    if (stimulus && session.queue_item_id) {
      const { data: queueItem } = await db
        .from('session_queue_items')
        .select('weekly_cycle_id')
        .eq('id', session.queue_item_id)
        .maybeSingle();

      if (queueItem) {
        const { data: requirement } = await db
          .from('stimulus_requirements')
          .select('id, completed_exposures, target_exposures')
          .eq('weekly_cycle_id', queueItem.weekly_cycle_id)
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
