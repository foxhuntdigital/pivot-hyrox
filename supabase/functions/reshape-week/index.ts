/**
 * POST /v1/weekly-cycles/current/reshape — apply a change to this week's queue.
 *
 * Coach proposes week changes and reports them applied. Until this existed
 * there was nothing for that commitment to land on: the reorder lived in client
 * state, the Plan tab rendered it from a fixture, and a reopened app showed the
 * week the athlete thought they had changed.
 *
 * Two operations, both expressed against queue item ids the client already
 * holds from `today`:
 *
 *   * `keep` — the sessions that stay, in the order given. Rank is rewritten to
 *     that order, so what Plan shows next is what the athlete agreed to.
 *   * `drop` — the sessions that come out of the week. They are marked
 *     `skipped`, never deleted: a session that did not happen is still part of
 *     the record of what the week was (PRD §2 — unscheduled, never missed).
 *
 * A session already in progress or completed is never touched. The athlete
 * cannot un-train something, and a reshape that reopened a finished session
 * would corrupt the stimulus credit `complete-workout` already applied.
 */
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, localDate, requireUser,
} from '../_shared/context.ts';

interface ReshapeBody {
  /** Queue item ids that stay, in the order they should be performed. */
  keep?: string[];
  /** Queue item ids that come out of the week. */
  drop?: string[];
}

/**
 * States a reshape may move. `skipped` is included so a change can be taken
 * back: Coach's commitments carry an undo, and a session dropped from the week
 * has to be returnable to it. Anything else is already history — a session in
 * progress or completed is not the plan any more, it is what happened.
 */
const MUTABLE = ['queued', 'recommended', 'skipped'];

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const db = clientFor(req);
    const user = await requireUser(db);
    const today = localDate(user.timezone);
    const body = await req.json().catch(() => null) as ReshapeBody | null;

    const keep = body?.keep ?? [];
    const drop = body?.drop ?? [];
    if (!keep.length && !drop.length) {
      throw new HttpError(400, 'Nothing to change: send keep, drop, or both');
    }
    const overlap = keep.filter(id => drop.includes(id));
    if (overlap.length) {
      throw new HttpError(400, 'A session cannot be both kept and dropped');
    }

    const state = await loadAthleteState(db, user.id, today);
    const cycleId = state.currentCycle?.id;
    if (!cycleId) throw new HttpError(409, 'No active week to reshape');

    // Every id must belong to this athlete's current week. RLS would refuse a
    // foreign row anyway; this turns that into an answer rather than a silent
    // no-op that reports success.
    const items = new Map(
      ((state.currentCycle?.session_queue_items ?? []) as any[]).map(q => [q.id, q]));
    const unknown = [...keep, ...drop].filter(id => !items.has(id));
    if (unknown.length) throw new HttpError(400, 'Some sessions are not in this week');

    const immovable = [...keep, ...drop].filter(id => !MUTABLE.includes(items.get(id).state));
    if (immovable.length) {
      throw new HttpError(409, 'A session already started or finished cannot be moved');
    }

    // Ranks are rewritten below the untouched items, so a kept session never
    // jumps ahead of one already in progress.
    let rank = 0;
    for (const id of keep) {
      const { error } = await db.from('session_queue_items')
        .update({ rank, state: 'queued' })
        .eq('id', id);
      if (error) throw new HttpError(500, `Could not reorder the week: ${error.message}`);
      rank += 1;
    }

    if (drop.length) {
      const { error } = await db.from('session_queue_items')
        .update({ state: 'skipped' })
        .in('id', drop);
      if (error) throw new HttpError(500, `Could not drop those sessions: ${error.message}`);
    }

    return json({
      weekly_cycle_id: cycleId,
      kept: keep.length,
      dropped: drop.length,
      local_date: today,
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});
