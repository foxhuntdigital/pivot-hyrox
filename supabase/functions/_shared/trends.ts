/**
 * The one trend Coach is allowed to state, chosen from the evidence that
 * actually exists.
 *
 * `get_performance_trends` has returned null since the coach layer was written,
 * and the README listed it as a known gap: there was no split-level history and
 * no logged load, so the honest answer was "I do not have that". Both now
 * exist, and this is what turns them into a claim — or, still, into a refusal.
 *
 * ── One metric, not a dashboard ─────────────────────────────────────────────
 *
 * The `trends()` contract returns a single metric because a coach answering
 * "how am I doing" names the strongest thing they can defend and then stops.
 * So the two sources compete on sample count: whichever has more comparable
 * sessions behind it wins, and running wins a tie because a pace series has
 * already survived the stricter comparability rule in `comparable.ts`.
 *
 * ── Direction is not a regression line ──────────────────────────────────────
 *
 * Two points and a subtraction. Fitting a line through four noisy sessions
 * produces a slope with a false air of precision, and the band it would need to
 * be honest is wider than the effect. First against last, over a stated window,
 * with the sample count attached, is a claim that can be checked by hand.
 */
import type { ComparableSeries } from './comparable.ts';
import { rangesOverlap, type ExerciseHistory } from './exercise-history.ts';

/** The shape `CoachServices.trends()` is contracted to return. */
export interface PerformanceTrend {
  metric: string;
  window_weeks: number;
  direction: 'improving' | 'holding' | 'slowing';
  samples: number;
  from: string;
  to: string;
  confidence: 'low' | 'medium' | 'high';
  caveat: string;
}

/** Below this, a change is the noise floor of a gym day rather than a trend. */
const MEANINGFUL_PCT = 2;

const confidenceFor = (samples: number, excluded: number): 'low' | 'medium' | 'high' => {
  if (excluded > samples) return 'low';
  if (samples >= 5) return 'high';
  if (samples >= 3) return 'medium';
  return 'low';
};

const directionFor = (changePct: number, higherIsBetter: boolean): PerformanceTrend['direction'] => {
  if (Math.abs(changePct) < MEANINGFUL_PCT) return 'holding';
  const better = higherIsBetter ? changePct > 0 : changePct < 0;
  return better ? 'improving' : 'slowing';
};

const paceLabel = (secondsPerKm: number) => {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
};

/** The pace trend, if the comparable-session rule found a series. */
function runningTrend(series: ComparableSeries | null): PerformanceTrend | null {
  if (!series || series.runs.length < 2) return null;
  const first = series.runs[0];
  const last = series.runs[series.runs.length - 1];
  const changePct = ((last.pace_seconds - first.pace_seconds) / first.pace_seconds) * 100;

  return {
    metric: `${series.distance_meters} m repeat pace`,
    window_weeks: Math.round(series.window_days / 7),
    direction: directionFor(changePct, false),
    samples: series.runs.length,
    from: paceLabel(first.pace_seconds),
    to: paceLabel(last.pace_seconds),
    confidence: confidenceFor(series.runs.length, series.excluded),
    caveat: series.excluded
      ? `${series.runs.length + series.excluded} sessions ran this distance; `
        + `${series.runs.length} were comparable on effort.`
      : `${series.runs.length} comparable sessions at the same distance and effort.`,
  };
}

/**
 * The strongest load trend across every movement with comparable history.
 *
 * Only exposures at an overlapping rep range are compared, and only ones that
 * recorded a load — the same rule `progression.ts` suggests weight under, so
 * Coach cannot describe a trend that the engine would refuse to act on.
 */
function strengthTrend(
  histories: Map<string, ExerciseHistory>,
  nameFor: (exerciseId: string) => string,
): PerformanceTrend | null {
  let best: { history: ExerciseHistory; series: typeof candidates } | null = null;
  let candidates: { date: string; load: number; unit: string | null }[] = [];

  for (const history of histories.values()) {
    const loaded = history.exposures.filter(e => e.top_load != null);
    if (loaded.length < 2) continue;

    // Anchor on the most recent exposure's rep range so the series is one
    // measurement rather than a mix of fives and tens.
    const anchor = loaded[0];
    const series = loaded
      .filter(e => rangesOverlap(e, anchor))
      .map(e => ({ date: e.date, load: e.top_load!, unit: e.load_unit }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (series.length < 2) continue;

    if (!best || series.length > best.series.length) {
      candidates = series;
      best = { history, series };
    }
  }
  if (!best) return null;

  const { history, series } = best;
  const first = series[0];
  const last = series[series.length - 1];
  const changePct = ((last.load - first.load) / first.load) * 100;
  const unit = last.unit ?? '';

  return {
    metric: `${nameFor(history.exercise_id)} top set`,
    window_weeks: Math.round(history.window_days / 7),
    direction: directionFor(changePct, true),
    samples: series.length,
    from: `${first.load}${unit && ` ${unit}`}`,
    to: `${last.load}${unit && ` ${unit}`}`,
    confidence: confidenceFor(series.length, history.excluded),
    caveat: history.excluded
      ? `${series.length} comparable exposures; ${history.excluded} session(s) logged nothing readable.`
      : `${series.length} comparable exposures at the same rep range.`,
  };
}

/**
 * The trend to answer with, or null when there is not enough to say anything.
 *
 * Null is a real answer and the tool contract already carries it: Coach is told
 * to say it lacks the data rather than estimating from session RPE.
 */
export function performanceTrend(args: {
  runs: ComparableSeries | null;
  strength: Map<string, ExerciseHistory>;
  nameFor: (exerciseId: string) => string;
}): PerformanceTrend | null {
  const running = runningTrend(args.runs);
  const lifting = strengthTrend(args.strength, args.nameFor);

  if (running && lifting) return lifting.samples > running.samples ? lifting : running;
  return running ?? lifting;
}
