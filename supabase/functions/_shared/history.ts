/**
 * Completed training history — what the athlete actually did.
 *
 * The prescription comes from `workout_sessions.snapshot_json`, never from the
 * template: templates get edited, and a record of last month's session must not
 * change because the library did (PRD §11.1). What was *performed* comes from
 * the logs, so an entry can show both — prescribed 500 m, did 450.
 *
 * Shaping is a pure function over rows so it can be tested without a database.
 */
import type { CardioLogRow, SessionRow, SetLogRow } from './readiness-history.ts';

export interface HistorySessionRow extends SessionRow {
  variant_code: string | null;
  session_rpe: number | null;
  ended_early: boolean | null;
  snapshot_json: Record<string, any> | null;
}

export interface HistoryMovement {
  exercise_id: string;
  exercise: string;
  /** What the snapshot asked for, summed across the session. */
  prescribed: string | null;
  /** What the logs recorded. Null when nothing was logged for it. */
  actual: string | null;
}

export interface HistoryEntry {
  id: string;
  /** The athlete's own local date, taken from the snapshot, not the server. */
  date: string;
  name: string;
  variant_label: string | null;
  stimulus: string | null;
  minutes: number | null;
  session_rpe: number | null;
  ended_early: boolean;
  movements: HistoryMovement[];
}

const round = (n: number) => Math.round(n * 10) / 10;

/** "500 m", "12 reps", "30 min" — one unit per movement, summed. */
function quantity(total: number, unit: string): string {
  if (unit === 's') return total >= 60 ? `${round(total / 60)} min` : `${Math.round(total)} s`;
  return `${round(total)} ${unit}`;
}

/**
 * Adds up one movement across every block and round of a session.
 *
 * A movement inside a `rounds` block is performed once per round, so the
 * prescription is the per-round quantity times the rounds — otherwise a 5 x
 * 1000 m session reads as 1000 m.
 */
function prescribedTotals(snapshot: Record<string, any> | null) {
  const totals = new Map<string, { unit: string; total: number }>();
  for (const block of snapshot?.blocks ?? []) {
    const rounds = block.rounds ?? 1;
    for (const be of block.exercises ?? []) {
      const key = be.exercise_id;
      const unit = be.quantity_unit ?? '';
      const entry = totals.get(key) ?? { unit, total: 0 };
      // Mixed units for one movement cannot be summed; the first wins and the
      // rest are dropped rather than added into a meaningless number.
      if (entry.unit !== unit && entry.total > 0) continue;
      entry.unit = unit;
      entry.total += (be.quantity ?? 0) * rounds;
      totals.set(key, entry);
    }
  }
  return totals;
}

export function historyEntriesFrom(args: {
  sessions: HistorySessionRow[];
  setLogs: SetLogRow[];
  cardioLogs: CardioLogRow[];
  exerciseNames: Map<string, string>;
}): HistoryEntry[] {
  const { sessions, setLogs, cardioLogs, exerciseNames } = args;

  const setsBySession = new Map<string, SetLogRow[]>();
  for (const l of setLogs) {
    if (!setsBySession.has(l.session_id)) setsBySession.set(l.session_id, []);
    setsBySession.get(l.session_id)!.push(l);
  }
  const cardioBySession = new Map<string, CardioLogRow[]>();
  for (const l of cardioLogs) {
    if (!cardioBySession.has(l.session_id)) cardioBySession.set(l.session_id, []);
    cardioBySession.get(l.session_id)!.push(l);
  }

  return sessions.map(s => {
    const snap = s.snapshot_json;
    const prescribed = prescribedTotals(snap);

    // What was actually logged, by movement.
    const actual = new Map<string, { unit: string; total: number }>();
    for (const l of setsBySession.get(s.id) ?? []) {
      if (l.actual_reps == null) continue;
      const e = actual.get(l.exercise_id) ?? { unit: 'reps', total: 0 };
      e.total += l.actual_reps;
      actual.set(l.exercise_id, e);
    }
    for (const l of cardioBySession.get(s.id) ?? []) {
      const e = actual.get(l.exercise_id) ?? { unit: l.distance_meters != null ? 'm' : 's', total: 0 };
      if (l.distance_meters != null) { e.unit = 'm'; e.total += l.distance_meters; }
      else if (l.duration_seconds != null) { e.unit = 's'; e.total += l.duration_seconds; }
      else continue;
      actual.set(l.exercise_id, e);
    }

    const ids = new Set([...prescribed.keys(), ...actual.keys()]);
    const movements: HistoryMovement[] = [...ids].map(id => {
      const p = prescribed.get(id);
      const a = actual.get(id);
      return {
        exercise_id: id,
        exercise: exerciseNames.get(id) ?? id,
        prescribed: p && p.total > 0 ? quantity(p.total, p.unit) : null,
        actual: a && a.total > 0 ? quantity(a.total, a.unit) : null,
      };
    });

    const minutes = s.started_at && s.ended_at
      ? (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60_000
      : null;

    return {
      id: s.id,
      // The snapshot recorded the athlete's own local date at the time; the
      // server's clock and today's timezone are both the wrong answer here.
      date: snap?.started_local_date ?? (s.started_at ?? '').slice(0, 10),
      name: snap?.name ?? s.template_id,
      variant_label: snap?.variant_label ?? null,
      stimulus: snap?.primary_stimulus ?? null,
      minutes: minutes != null && minutes > 0 && minutes < 300 ? Math.round(minutes) : null,
      session_rpe: s.session_rpe ?? null,
      ended_early: !!s.ended_early,
      movements,
    };
  });
}

/** One page of completed sessions, newest first. */
export async function loadHistory(db: any, userId: string, opts: { limit: number; before?: string | null }) {
  let q = db.from('workout_sessions')
    .select('id, template_id, started_at, ended_at, session_rpe, ended_early, variant_code, snapshot_json')
    .eq('user_id', userId).eq('status', 'completed')
    .order('started_at', { ascending: false })
    .limit(opts.limit + 1);          // one extra to know whether more exist
  if (opts.before) q = q.lt('started_at', opts.before);

  const { data } = await q;
  const rows: HistorySessionRow[] = data ?? [];
  const has_more = rows.length > opts.limit;
  const page = has_more ? rows.slice(0, opts.limit) : rows;
  if (!page.length) return { sessions: page, setLogs: [], cardioLogs: [], has_more };

  const { data: blocks } = await db.from('session_blocks')
    .select('id, session_id').in('session_id', page.map(s => s.id));
  const blockToSession = new Map((blocks ?? []).map((b: any) => [b.id, b.session_id]));
  const blockIds = [...blockToSession.keys()];
  if (!blockIds.length) return { sessions: page, setLogs: [], cardioLogs: [], has_more };

  const [setRes, cardioRes] = await Promise.all([
    db.from('set_logs').select('session_block_id, exercise_id, prescribed_reps, actual_reps').in('session_block_id', blockIds),
    db.from('cardio_logs').select('session_block_id, exercise_id, distance_meters, duration_seconds').in('session_block_id', blockIds),
  ]);
  const attach = (r: any) => ({ ...r, session_id: blockToSession.get(r.session_block_id) });
  return {
    sessions: page,
    setLogs: (setRes.data ?? []).map(attach) as SetLogRow[],
    cardioLogs: (cardioRes.data ?? []).map(attach) as CardioLogRow[],
    has_more,
  };
}
