/**
 * Comparable running sessions — the evidence behind any pace claim Coach makes.
 *
 * A trend is only honest between sessions that were actually alike, so the rule
 * is applied here rather than asserted in the answer (Coach brief §5.3):
 *
 *   * the same repeat distance, within a tolerance band, so a 400 m repeat and
 *     a 1 km repeat never sit on the same line;
 *   * the same exercise, so a treadmill km and a rowed km do not compare;
 *   * session RPE within one point of the set's median, because pace at a
 *     different effort is a different measurement.
 *
 * Sessions inside the window that fail the rule are counted, not dropped
 * silently. "Nine runs, four comparable" is the caveat that makes the number
 * mean something, and it can only be stated if the misses are known.
 *
 * Returns null when nothing qualifies. That is the answer, and Coach says so
 * rather than reaching for a weaker comparison.
 */
import { daysAgo, type CardioLogRow, type SessionRow } from './readiness-history.ts';

/** The window a pace claim is made over. */
export const COMPARABLE_WINDOW_DAYS = 28;

/** How far a repeat may sit from the band's centre and still be the same effort. */
const DISTANCE_TOLERANCE = 0.15;

/** Repeat distances worth trending, in metres. */
const BANDS = [400, 800, 1000, 2000, 5000];

/** At least this many efforts before a session counts as a repeat session. */
const MIN_EFFORTS = 1;

export interface ComparableRun {
  session_id: string;
  /** ISO date the session was performed. */
  date: string;
  /** Median seconds per kilometre across the session's qualifying efforts. */
  pace_seconds: number;
  rpe: number | null;
  /** Absent where the session was logged without a strap. */
  hr: number | null;
}

export interface ComparableSeries {
  exercise_id: string;
  /** The repeat distance these sessions share, in metres. */
  distance_meters: number;
  /** Oldest first, so a trend reads left to right. */
  runs: ComparableRun[];
  /**
   * Sessions in the window that ran this exercise but did not qualify — wrong
   * repeat distance, or an effort too far from the set's median RPE.
   */
  excluded: number;
  window_days: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const paceOf = (c: CardioLogRow): number | null => {
  if (c.pace_seconds_per_km && c.pace_seconds_per_km > 0) return c.pace_seconds_per_km;
  if (c.distance_meters && c.duration_seconds && c.distance_meters > 0) {
    return c.duration_seconds / (c.distance_meters / 1000);
  }
  return null;
};

/** The band a logged distance belongs to, or null when it sits between bands. */
function bandOf(meters: number): number | null {
  for (const band of BANDS) {
    if (Math.abs(meters - band) <= band * DISTANCE_TOLERANCE) return band;
  }
  return null;
}

/**
 * The strongest comparable set in the window: the exercise and repeat distance
 * the athlete has the most matched sessions at.
 */
export function comparableSeries(args: {
  today: string;
  sessions: SessionRow[];
  cardioLogs: CardioLogRow[];
}): ComparableSeries | null {
  const { today, sessions, cardioLogs } = args;
  const byId = new Map(sessions.map(s => [s.id, s]));

  /** Candidate sessions, grouped by exercise and repeat distance. */
  const groups = new Map<string, {
    exercise_id: string;
    distance_meters: number;
    sessions: Map<string, number[]>;   // session id → paces
    hr: Map<string, number[]>;
  }>();
  /** Sessions that ran an exercise in the window at all, per exercise. */
  const ranAtAll = new Map<string, Set<string>>();

  for (const log of cardioLogs) {
    const session = byId.get(log.session_id);
    if (!session || daysAgo(today, session.started_at) >= COMPARABLE_WINDOW_DAYS) continue;

    const seen = ranAtAll.get(log.exercise_id) ?? new Set<string>();
    seen.add(log.session_id);
    ranAtAll.set(log.exercise_id, seen);

    const pace = paceOf(log);
    const band = log.distance_meters ? bandOf(log.distance_meters) : null;
    if (!pace || pace <= 0 || band === null) continue;

    const key = `${log.exercise_id}:${band}`;
    const group = groups.get(key) ?? {
      exercise_id: log.exercise_id,
      distance_meters: band,
      sessions: new Map<string, number[]>(),
      hr: new Map<string, number[]>(),
    };
    group.sessions.set(log.session_id, [...(group.sessions.get(log.session_id) ?? []), pace]);
    if (log.avg_hr) {
      group.hr.set(log.session_id, [...(group.hr.get(log.session_id) ?? []), log.avg_hr]);
    }
    groups.set(key, group);
  }

  let best: ComparableSeries | null = null;

  for (const group of groups.values()) {
    // One line per session: the median of its own repeats, so a single blown
    // interval does not become the session's pace.
    const candidates = [...group.sessions.entries()]
      .filter(([, paces]) => paces.length >= MIN_EFFORTS)
      .map(([sessionId, paces]) => {
        const session = byId.get(sessionId)!;
        const hrs = group.hr.get(sessionId) ?? [];
        return {
          session_id: sessionId,
          date: (session.started_at ?? '').slice(0, 10),
          pace_seconds: Math.round(median(paces)),
          rpe: session.session_rpe ?? null,
          hr: hrs.length ? Math.round(median(hrs)) : null,
        };
      });
    if (!candidates.length) continue;

    // The RPE filter needs something to centre on. With no logged RPE at all
    // there is nothing to match against, so effort is simply not asserted.
    const rpes = candidates.map(c => c.rpe).filter((r): r is number => r !== null);
    const centre = rpes.length ? median(rpes) : null;
    const runs = centre === null
      ? candidates
      : candidates.filter(c => c.rpe === null || Math.abs(c.rpe - centre) <= 1);

    if (runs.length < 2) continue;   // a single point is not a trend

    runs.sort((a, b) => a.date.localeCompare(b.date));
    const ran = ranAtAll.get(group.exercise_id)?.size ?? runs.length;

    if (!best || runs.length > best.runs.length) {
      best = {
        exercise_id: group.exercise_id,
        distance_meters: group.distance_meters,
        runs,
        excluded: Math.max(0, ran - runs.length),
        window_days: COMPARABLE_WINDOW_DAYS,
      };
    }
  }

  return best;
}
