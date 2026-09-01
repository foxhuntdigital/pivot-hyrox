/**
 * What the athlete has actually lifted — the evidence any progression or
 * capability claim is allowed to read.
 *
 * `comparable.ts` answers the same question for running and this deliberately
 * mirrors it: a window, an explicit comparability rule, and a count of what was
 * seen but did not qualify. "Four exposures, one comparable" is the caveat that
 * makes a suggestion honest, and it can only be stated if the misses are known.
 *
 * ── Two exclusions that decide whether any of this means anything ────────────
 *
 * 1. `source = 'asserted'` is not evidence. Before the logging work in this
 *    release, `actuals.ts` set `actual_reps` from `step.quantity` — the
 *    prescription copied onto itself. Every such row says the athlete did
 *    exactly what was asked, because nothing else could ever have been
 *    written. Reading those back as performance would be a progression engine
 *    consuming its own output, and 0012's own column comment says it plainly:
 *    asserted "cannot show a miss". They are counted as excluded, never used.
 *
 * 2. A set with no load is not a load measurement. It may still be a rep
 *    measurement, so it is kept for rep progression and ignored for weight.
 *
 * ── Comparability ───────────────────────────────────────────────────────────
 *
 * Two exposures compare when they are the same movement AND their prescribed
 * rep ranges overlap. A back squat at 4x5 and a back squat at 3x10 are the
 * same exercise and not the same measurement: carrying load between them would
 * suggest adding weight to a set of ten because a set of five moved.
 *
 * Movement identity never widens on its own. `content.substitutions` can tell a
 * caller that two movements are linked, but an exposure is always returned
 * labelled with the exercise it was actually performed on — the decision about
 * whether a goblet squat informs a back squat belongs to the caller, with the
 * substitution reason in hand, not to a lookup that silently merges them.
 */
import { daysAgo, type SessionRow, type SetLogRow } from './readiness-history.ts';

/**
 * How far back a strength exposure still counts.
 *
 * Longer than the 28 days `comparable.ts` uses for pace, because the things
 * being compared move at different speeds: a month is several blocks of running
 * feedback and barely two exposures to a given lift. Short enough that a number
 * from a different phase of the athlete's year is not treated as current.
 */
export const EXPOSURE_WINDOW_DAYS = 120;

/**
 * Sources that record what happened rather than what was asked.
 *
 * `carried` is included: the player copies the first set's weight forward, so a
 * carried set is a real load the athlete kept using. `manual` is a typed value.
 * `asserted` is the prescription reflected back — see the header.
 */
export const EVIDENCE_SOURCES = ['manual', 'carried'] as const;

/**
 * Whether a session was the full prescription or a deliberately reduced dose.
 *
 * This is not a quality judgement and it is not an absence of training. It is
 * the difference between "the athlete lifted less" and "the session asked for
 * less", and every consumer here needs it: a maintenance session completed
 * exactly as written is lighter than the full version BY DESIGN, so comparing
 * it against a full exposure would read a deliberate deload as a loss of
 * strength — and then feed that reading into the plan.
 *
 * Reduced exposures stay in the history because they happened. They are simply
 * never the thing another exposure is measured against.
 */
export type SessionContext = 'full' | 'reduced';

/** A session row that knows which variant was performed. */
export interface VariantSessionRow extends SessionRow { variant_code?: string | null }

/**
 * The default reading: yellow and red are the Express and Micro transforms, and
 * both are the same session with volume removed. Green is the full dose.
 *
 * A caller with more to go on — a template whose whole family is a maintenance
 * family, say — should pass its own classifier rather than extend this one.
 */
export const reducedByVariant = (s: VariantSessionRow): SessionContext =>
  s.variant_code === 'yellow' || s.variant_code === 'red' ? 'reduced' : 'full';

/** A set as `set_logs` holds it after migrations 0002 and 0012. */
export interface StrengthSetRow extends SetLogRow {
  set_index: number;
  rpe?: number | null;
  prescribed_load?: number | null;
  prescribed_reps_min?: number | null;
  prescribed_reps_max?: number | null;
  prescribed_rpe?: number | null;
  source?: string | null;
}

/** One movement, on one day, as it was performed. */
export interface Exposure {
  session_id: string;
  /** ISO date the session was performed. */
  date: string;
  exercise_id: string;
  /** Heaviest working set, in the unit it was logged in. Null if none carried load. */
  top_load: number | null;
  load_unit: string | null;
  /** Reps completed at `top_load`. */
  top_reps: number | null;
  /** Working sets that counted as evidence. */
  sets: number;
  /** Total reps across those sets, which is the rep-progression measure. */
  total_reps: number;
  /** The rep range this exposure was prescribed at — the comparability key. */
  reps_min: number | null;
  reps_max: number | null;
  /** Median RPE across the logged sets, falling back to the session's own. */
  rpe: number | null;
  /** Whether every counted set met the bottom of its prescribed rep range. */
  all_sets_completed: boolean;
  /** Sets seen for this movement in this session that were not evidence. */
  excluded_sets: number;
  /** Full prescription, or a reduced dose that must not be compared against. */
  context: SessionContext;
}

export interface ExerciseHistory {
  exercise_id: string;
  /** Newest first, so "last time" is `exposures[0]`. */
  exposures: Exposure[];
  /** Exposures in the window dropped entirely for carrying no evidence. */
  excluded: number;
  window_days: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const isEvidence = (row: StrengthSetRow): boolean =>
  (EVIDENCE_SOURCES as readonly string[]).includes(row.source ?? 'asserted');

/** The bottom of a set's prescribed range, whichever column carries it. */
const floorOf = (r: StrengthSetRow): number | null =>
  r.prescribed_reps_min ?? r.prescribed_reps ?? null;

/**
 * The rep range an exposure was prescribed at.
 *
 * 0012 added `prescribed_reps_min`/`max`; rows written before it carry a single
 * `prescribed_reps`, which is a range of one. Neither present means the set was
 * logged without a prescription to compare against — it can still count as a
 * rep measurement while comparing to nothing.
 */
function prescribedRange(rows: StrengthSetRow[]): { min: number | null; max: number | null } {
  const mins = rows.map(floorOf).filter((n): n is number => n != null);
  const maxes = rows
    .map(r => r.prescribed_reps_max ?? r.prescribed_reps ?? null)
    .filter((n): n is number => n != null);
  return {
    min: mins.length ? Math.min(...mins) : null,
    max: maxes.length ? Math.max(...maxes) : null,
  };
}

/**
 * Every exposure to every movement in the window, newest first.
 *
 * Grouped by (session, exercise) because that is what an exposure is: one
 * movement on one day. Two sessions on the same date stay separate — they were
 * separate sessions, and merging them would invent a set count nobody performed.
 */
export function exerciseHistory(args: {
  today: string;
  sessions: VariantSessionRow[];
  setLogs: StrengthSetRow[];
  /** How to tell a full prescription from a reduced dose. See `SessionContext`. */
  contextOf?: (session: VariantSessionRow) => SessionContext;
}): Map<string, ExerciseHistory> {
  const { today, sessions, setLogs, contextOf = reducedByVariant } = args;
  const byId = new Map(sessions.map(s => [s.id, s]));

  /** (session, exercise) -> the sets logged for it. */
  const groups = new Map<string, StrengthSetRow[]>();
  for (const row of setLogs) {
    const session = byId.get(row.session_id);
    if (!session || daysAgo(today, session.started_at) >= EXPOSURE_WINDOW_DAYS) continue;
    const key = `${row.session_id} ${row.exercise_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const out = new Map<string, ExerciseHistory>();
  for (const [key, rows] of groups) {
    const [sessionId, exerciseId] = key.split(' ');
    const session = byId.get(sessionId)!;
    const history = out.get(exerciseId) ?? {
      exercise_id: exerciseId, exposures: [], excluded: 0, window_days: EXPOSURE_WINDOW_DAYS,
    };
    out.set(exerciseId, history);

    const evidence = rows.filter(isEvidence);
    if (!evidence.length) {
      // The movement was performed and nothing readable was recorded. That is a
      // gap in the evidence rather than an absence of training, and saying
      // which it is costs one integer.
      history.excluded += 1;
      continue;
    }

    const loaded = evidence.filter(r => r.actual_load != null && r.actual_load > 0);
    const top = loaded.length
      ? loaded.reduce((a, b) => (b.actual_load! > a.actual_load! ? b : a))
      : null;
    const rpes = evidence.map(r => r.rpe).filter((n): n is number => n != null);
    const range = prescribedRange(evidence);
    const reps = evidence.map(r => r.actual_reps).filter((n): n is number => n != null);

    history.exposures.push({
      session_id: sessionId,
      date: (session.started_at ?? '').slice(0, 10),
      exercise_id: exerciseId,
      top_load: top?.actual_load ?? null,
      load_unit: top?.load_unit ?? null,
      top_reps: top?.actual_reps ?? null,
      sets: evidence.length,
      total_reps: reps.reduce((a, b) => a + b, 0),
      reps_min: range.min,
      reps_max: range.max,
      rpe: rpes.length ? median(rpes) : (session.session_rpe ?? null),
      // A set that fell short of the bottom of its range is a miss, and a miss
      // is the signal REGRESS is read from. A set with nothing to compare
      // against cannot be a miss.
      all_sets_completed: evidence.every(r =>
        r.actual_reps == null || floorOf(r) == null || r.actual_reps >= floorOf(r)!),
      excluded_sets: rows.length - evidence.length,
      context: contextOf(session),
    });
  }

  for (const history of out.values()) {
    history.exposures.sort((a, b) => b.date.localeCompare(a.date));
  }
  return out;
}

/** Whether two rep ranges overlap. An open range compares against anything. */
export function rangesOverlap(
  a: { reps_min: number | null; reps_max: number | null },
  b: { reps_min: number | null; reps_max: number | null },
): boolean {
  if (a.reps_min == null || b.reps_min == null) return true;
  const aMax = a.reps_max ?? a.reps_min;
  const bMax = b.reps_max ?? b.reps_min;
  return a.reps_min <= bMax && b.reps_min <= aMax;
}

/**
 * The most recent exposure that can honestly be compared to what is prescribed
 * today, and how many were passed over to reach it.
 *
 * The skip count is the caveat: "your last squat session was at ten reps" is
 * why no weight is being suggested off it, and a caller that cannot see the
 * skip has no way to say so.
 */
export function mostRecentComparable(
  history: ExerciseHistory | undefined,
  prescription: { reps_min: number | null; reps_max: number | null },
): { exposure: Exposure; skipped: number; skipped_reduced: number } | null {
  if (!history?.exposures.length) return null;
  let skipped = 0, skipped_reduced = 0;
  for (const exposure of history.exposures) {
    // A reduced dose is never the baseline. Progressing off it would suggest a
    // weight lighter than the athlete's real one; regressing off it would call
    // a deload a decline.
    if (exposure.context === 'reduced') { skipped_reduced += 1; continue; }
    if (rangesOverlap(exposure, prescription)) return { exposure, skipped, skipped_reduced };
    skipped += 1;
  }
  return null;
}

/**
 * The logs behind a set of sessions, keyed the way the shapers above expect.
 *
 * `set_logs` and `cardio_logs` hang off `session_blocks`, not off the session,
 * so the block table is the join and `session_id` is attached on the way out —
 * the same two-step `loadHistory` makes, for the same reason: evidence is read
 * across sessions and the log tables are indexed within one.
 *
 * Both kinds come back from one pass because the caller that wants lifted loads
 * almost always wants run paces too, and asking twice would be two round trips
 * for one question.
 */
export async function loadPerformanceLogs(
  db: any, sessionIds: string[],
): Promise<{ setLogs: StrengthSetRow[]; cardioLogs: any[] }> {
  if (!sessionIds.length) return { setLogs: [], cardioLogs: [] };

  const { data: blocks } = await db.from('session_blocks')
    .select('id, session_id').in('session_id', sessionIds);
  const blockToSession = new Map((blocks ?? []).map((b: any) => [b.id, b.session_id]));
  const blockIds = [...blockToSession.keys()];
  if (!blockIds.length) return { setLogs: [], cardioLogs: [] };

  const [setRes, cardioRes] = await Promise.all([
    db.from('set_logs')
      .select('session_block_id, exercise_id, set_index, prescribed_reps, prescribed_reps_min, '
        + 'prescribed_reps_max, actual_reps, prescribed_load, actual_load, load_unit, rpe, source')
      .in('session_block_id', blockIds),
    db.from('cardio_logs')
      .select('session_block_id, exercise_id, distance_meters, duration_seconds, '
        + 'pace_seconds_per_km, avg_hr')
      .in('session_block_id', blockIds),
  ]);

  const attach = (r: any) => ({ ...r, session_id: blockToSession.get(r.session_block_id) });
  return {
    setLogs: (setRes.data ?? []).map(attach) as StrengthSetRow[],
    cardioLogs: (cardioRes.data ?? []).map(attach),
  };
}
