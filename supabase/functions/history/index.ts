/**
 * GET /v1/history — completed training, newest first.
 *
 * This is the athlete's own record of what they did. It reads only from stored
 * sessions and their logs: no engine call, no content beyond exercise names, no
 * decision to record. That is deliberate — it is the one surface that stays
 * available when a subscription lapses, so it must not depend on anything the
 * paywall gates.
 */
import {
  clientFor, corsHeaders, HttpError, json, requireUser,
} from '../_shared/context.ts';
import { historyEntriesFrom, loadHistory } from '../_shared/history.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    const db = clientFor(req);
    const user = await requireUser(db);

    const url = new URL(req.url);
    const limit = Math.min(MAX_LIMIT,
      Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
    const before = url.searchParams.get('before');

    const page = await loadHistory(db, user.id, { limit, before });

    // Names only — the prescription comes from each session's own snapshot, so
    // a template edited since cannot rewrite what the athlete did.
    const ids = [...new Set(page.sessions.flatMap(s =>
      (s.snapshot_json?.blocks ?? []).flatMap((b: any) =>
        (b.exercises ?? []).map((e: any) => e.exercise_id))))];
    const { data: exercises } = ids.length
      ? await db.schema('content').from('exercises').select('id, name').in('id', ids)
      : { data: [] as { id: string; name: string }[] };

    const entries = historyEntriesFrom({
      sessions: page.sessions,
      setLogs: page.setLogs,
      cardioLogs: page.cardioLogs,
      splits: page.splits,
      exerciseNames: new Map((exercises ?? []).map((e: any) => [e.id, e.name])),
    });

    return json({
      sessions: entries,
      has_more: page.has_more,
      /** Cursor for the next page: the oldest row on this one. */
      next_before: page.has_more
        ? page.sessions[page.sessions.length - 1].started_at : null,
    }, 200, origin);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : 'unknown' }, status, origin);
  }
});
