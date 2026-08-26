/**
 * The Progress snapshot: readiness plus the stats behind each component.
 *
 * Two functions need this — `today` returns it with the daily payload, and
 * `coach` needs the same figures to narrate them. Computing it twice would let
 * the sentence and the number drift apart, which is the failure this whole
 * change exists to fix.
 */
import { computeReadiness,
  recoverySignal, type RecoveryCheckin,
} from '../../../packages/engine/src/index.ts';
import { loadReadinessHistory, readinessInputsFrom } from './readiness-history.ts';
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
}

export async function loadProgressSnapshot(args: {
  db: any;
  userId: string;
  today: string;
  content: { templates: any[] };
  state: {
    stimulus_requirements: { completed_exposures: number; target_exposures: number }[];
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

  const readiness = computeReadiness(readinessInputsFrom({
    today,
    sessions: history.sessions,
    setLogs: history.setLogs,
    cardioLogs: history.cardioLogs,
    templates,
    stimulus_adherence_4w: state.stimulus_requirements.length
      ? state.stimulus_requirements.reduce((n, r) =>
          n + Math.min(1, r.completed_exposures / r.target_exposures), 0)
        / state.stimulus_requirements.length
      : 0,
    // What the athlete reported, rather than a flat 0.6 for having checked in
    // at all. Null (no check-in) scores 0, and `confidence` is what tells the
    // athlete that 15% of the score is resting on nothing.
    recovery_signal: recoverySignal(state.checkin as RecoveryCheckin | null) ?? 0,
  }));

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

  return { readiness, metric_detail, lowest, comparable };
}
