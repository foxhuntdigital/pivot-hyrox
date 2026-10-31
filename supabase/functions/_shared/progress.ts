/**
 * The Progress snapshot: readiness plus the stats behind each component.
 *
 * Two functions need this — `today` returns it with the daily payload, and
 * `coach` needs the same figures to narrate them. Computing it twice would let
 * the sentence and the number drift apart, which is the failure this whole
 * change exists to fix.
 */
import {
  computeReadiness, READINESS_MODEL_VERSION, type ReadinessInputs, type RecoveryCheckin,
} from '../../../packages/engine/src/index.ts';
import {
  loadReadinessHistory, readinessInputsFrom, recoveryOverDays, stationsCovered, stimulusAdherence,
  type WeekNeed,
} from './readiness-history.ts';
import { comparableSeries, type ComparableSeries } from './comparable.ts';
import { metricDetailFrom, type MetricDetail } from './metric-detail.ts';

export interface ProgressSnapshot {
  readiness: ReturnType<typeof computeReadiness>;
  metric_detail: Record<string, MetricDetail>;
  /**
   * The lowest-scoring *measured* component — what Progress calls the biggest
   * opportunity. Null when nothing has been measured, which is an athlete with
   * no limiter yet rather than an athlete whose limiter is everything.
   */
  lowest: string | null;
  /**
   * The comparable-session set behind any pace claim, or null when nothing in
   * the window qualifies. Computed here so Coach's sentence and the card under
   * it are the same evidence.
   */
  comparable: ComparableSeries | null;
  /** What the score was computed from, so Readiness can show each input against its target. */
  inputs: ReadinessInputs;
  /** The race stations trained in the stations window, as exercise ids. */
  stations_covered: string[];
}

export async function loadProgressSnapshot(args: {
  db: any;
  userId: string;
  today: string;
  content: { templates: any[] };
  state: {
    stimulus_requirements: { completed_exposures: number; target_exposures: number }[];
    /** Earlier weeks' needs, most recent first (`loadAthleteState`). */
    previous_weeks_needs?: WeekNeed[][];
    checkin: unknown;
    checkins: { local_date: string; sleep_hours: number | null; energy: string | null }[];
    queue: { state: string }[];
  };
}): Promise<ProgressSnapshot> {
  const { db, userId, today, content, state } = args;
  const history = await loadReadinessHistory(db, userId, today);

  const templates = new Map(content.templates.map((t: any) => [t.id, {
    primary_goal: t.primary_goal,
    requires_running: t.requires_running,
    estimated_minutes: t.estimated_minutes,
  }]));

  const inputs = readinessInputsFrom({
    today,
    sessions: history.sessions,
    setLogs: history.setLogs,
    cardioLogs: history.cardioLogs,
    templates,
    // The last four completed weeks, not this one alone, which reset the
    // score every Monday (`stimulusAdherence`).
    stimulus_adherence_4w: stimulusAdherence({
      previousWeeks: state.previous_weeks_needs ?? [],
      currentWeek: state.stimulus_requirements,
    }),
    // What the athlete reported over the last week, rather than whichever
    // check-in happened to be latest. None in the window scores 0, which the
    // model reads as unmeasured (`recoveryOverDays`).
    recovery_signal: recoveryOverDays({
      today,
      checkins: state.checkins as (RecoveryCheckin & { local_date: string })[],
    }),
  });
  const readiness = computeReadiness(inputs);

  const metric_detail = metricDetailFrom({
    today,
    sessions: history.sessions,
    setLogs: history.setLogs,
    cardioLogs: history.cardioLogs,
    templates,
    checkins: state.checkins,
    queue: state.queue,
  });

  /**
   * The limiter, over measured components only.
   *
   * This ranked all six, so a component the athlete has no data for — scored 0
   * because nothing was observed, not because they are weak at it — came out
   * "lowest" and was handed to Coach as the thing to work on. Progress computes
   * its own limiter the same way; the two have to name the same component or
   * the panel and the sentence under it disagree.
   */
  const observed = new Set<string>(readiness.observed);
  const measured = Object.entries(readiness.components).filter(([k]) => observed.has(k));
  const lowest = measured.length
    ? measured.reduce((a, b) => (b[1] < a[1] ? b : a))[0]
    : null;

  const comparable = comparableSeries({
    today,
    sessions: history.sessions,
    cardioLogs: history.cardioLogs,
  });

  const stations_covered = [...stationsCovered({
    today, sessions: history.sessions, setLogs: history.setLogs, cardioLogs: history.cardioLogs,
  })];

  await saveReadinessSnapshot(db, userId, today, readiness);

  return { readiness, metric_detail, lowest, comparable, inputs, stations_covered };
}

/**
 * Keeps one readiness row per day, so Progress can draw the line over time.
 *
 * `readiness_snapshots` existed from the start with nothing writing to it.
 * Written here because every caller that computes readiness (Today, Coach,
 * Progress) comes through this function: the first one of the day creates the
 * row and later ones refresh it, so the stored value is the day's latest.
 *
 * A failed write costs one point on a chart, never the screen that asked for
 * readiness, so the error is dropped. No score, no row: an athlete with nothing
 * measured has no point to plot, which is not the same as a zero.
 */
export async function saveReadinessSnapshot(
  db: any, userId: string, today: string, readiness: ReturnType<typeof computeReadiness>,
): Promise<void> {
  if (readiness.overall === null) return;
  try {
    await db.from('readiness_snapshots').upsert({
      user_id: userId,
      local_date: today,
      overall: readiness.overall,
      components_json: { components: readiness.components, observed: readiness.observed },
      confidence: readiness.confidence,
      model_version: READINESS_MODEL_VERSION,
    }, { onConflict: 'user_id,local_date' });
  } catch {
    // See above: the chart loses a point, nothing else.
  }
}
