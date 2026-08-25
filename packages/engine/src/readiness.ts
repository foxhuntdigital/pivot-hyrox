/**
 * Readiness model (PRD §9.5).
 *
 * This is a product score, not a physiological measurement. It exposes its
 * components and a confidence flag, rounds to whole numbers, and must never be
 * described as clinically validated (PRD §13.2).
 */

export type Confidence = 'low' | 'medium' | 'high';

export interface ReadinessInputs {
  /** Easy aerobic minutes in the last 14 days. */
  aerobic_minutes_14d: number;
  /** Threshold sessions completed in the last 14 days. */
  threshold_sessions_14d: number;
  /** Run exposures and longest continuous run (km) in the last 7 days. */
  run_sessions_7d: number;
  longest_run_km: number;
  /** Prescribed-load completion rate, 0..1. */
  strength_completion_rate: number;
  /** Distinct race stations touched in the last 21 days, out of 8. */
  stations_covered_21d: number;
  /** Required stimuli completed / prescribed over a rolling 4 weeks, 0..1. */
  stimulus_adherence_4w: number;
  /** Manual or connected recovery, 0..1. */
  recovery_signal: number;
  /** How many of the above came from real data rather than defaults. */
  observed_days: number;
  /**
   * Which components the athlete has actually been measured on.
   *
   * A zero is ambiguous on its own: no strength sets logged and every set
   * missed both arrive as `strength_completion_rate: 0`, and only one of those
   * is a fact about the athlete. Anything omitted here is dropped from the
   * score rather than counted as a zero, and the remaining weights are
   * renormalised. Absent entirely means "all observed", which keeps a caller
   * that supplies complete inputs behaving exactly as before.
   */
  observed?: Partial<Record<ComponentKey, boolean>>;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export const READINESS_MODEL_VERSION = '1.0.0';

/** A manual recovery check-in (PRD §6.3, FR-015). Every field is optional. */
export interface RecoveryCheckin {
  /** Hours slept, as reported. */
  sleep_hours?: number | null;
  energy?: 'low' | 'normal' | 'high' | null;
  /** 1–5, where 5 is the most stressed. */
  stress?: number | null;
  /** 1–5, where 5 is the most sore. */
  soreness?: number | null;
  /** 1–5, where 5 is the most motivated. */
  motivation?: number | null;
}

/** Eight hours is a full score; the scale is linear below it. */
const SLEEP_TARGET_HOURS = 8;

/**
 * The `recovery` component's 0..1 input, from what the athlete reported.
 *
 * Stress and soreness are inverted — 5 means "worst", so a 5 contributes 0.
 * Only the fields actually reported count toward the average, so a check-in
 * that answers two of five questions is scored on those two rather than being
 * penalised for the silence. Null when nothing was reported at all: the caller
 * then has no recovery signal, which is not the same as a bad one.
 */
export function recoverySignal(checkin: RecoveryCheckin | null | undefined): number | null {
  if (!checkin) return null;
  const parts: number[] = [];

  if (typeof checkin.sleep_hours === 'number' && Number.isFinite(checkin.sleep_hours)) {
    parts.push(clamp01(checkin.sleep_hours / SLEEP_TARGET_HOURS));
  }
  if (checkin.energy) {
    parts.push({ low: 0, normal: 0.6, high: 1 }[checkin.energy]);
  }
  // 1..5 → 1..0 for the two that measure a burden.
  for (const value of [checkin.stress, checkin.soreness]) {
    if (typeof value === 'number') parts.push(clamp01((5 - value) / 4));
  }
  if (typeof checkin.motivation === 'number') {
    parts.push(clamp01((checkin.motivation - 1) / 4));
  }

  if (!parts.length) return null;
  return parts.reduce((sum, v) => sum + v, 0) / parts.length;
}

/**
 * The eight HYROX stations, as exercise ids. `stations_covered_21d` is scored
 * out of this set, so it lives beside the model that consumes it rather than
 * being re-listed wherever history is aggregated.
 */
export const HYROX_STATION_EXERCISES = [
  'ex_skierg', 'ex_sled_push', 'ex_sled_pull', 'ex_burpee_broad_jump',
  'ex_rowerg', 'ex_farmer_carry', 'ex_sandbag_walking_lunge', 'ex_wall_ball',
] as const;

const COMPONENT_WEIGHTS = {
  aerobic: 0.2,
  running: 0.2,
  strength: 0.15,
  stations: 0.15,
  consistency: 0.15,
  recovery: 0.15,
} as const;

export type ComponentKey = keyof typeof COMPONENT_WEIGHTS;

export interface ReadinessResult {
  /**
   * Weighted over observed components only. Null when nothing has been
   * measured yet — an athlete with no history has no readiness score, which is
   * a different statement from a readiness of zero.
   */
  overall: number | null;
  components: Record<ComponentKey, number>;
  /** Components with data behind them. The rest are not part of `overall`. */
  observed: ComponentKey[];
  confidence: Confidence;
}

export function computeReadiness(i: ReadinessInputs): ReadinessResult {
  const components = {
    // 300 min of easy aerobic work over two weeks is a full score.
    aerobic: clamp01(i.aerobic_minutes_14d / 300) * 0.7
           + clamp01(i.threshold_sessions_14d / 4) * 0.3,
    running: clamp01(i.run_sessions_7d / 3) * 0.6
           + clamp01(i.longest_run_km / 12) * 0.4,
    strength: clamp01(i.strength_completion_rate),
    stations: clamp01(i.stations_covered_21d / 8),
    consistency: clamp01(i.stimulus_adherence_4w),
    recovery: clamp01(i.recovery_signal),
  };

  const keys = Object.keys(COMPONENT_WEIGHTS) as ComponentKey[];
  // Providing the record at all means it is the whole truth: a key left out of
  // it is unobserved, not defaulted back in.
  const observed = i.observed ? keys.filter(k => i.observed![k]) : keys;

  // Renormalise over what was measured, so an unobserved component neither
  // drags the score down nor quietly counts as a pass.
  const totalWeight = observed.reduce((sum, k) => sum + COMPONENT_WEIGHTS[k], 0);
  const overall = totalWeight
    ? observed.reduce((sum, k) => sum + components[k] * COMPONENT_WEIGHTS[k], 0) / totalWeight
    : null;

  return {
    // Whole numbers only — decimals would imply precision this does not have.
    overall: overall === null ? null : Math.round(overall * 100),
    components: Object.fromEntries(
      Object.entries(components).map(([k, v]) => [k, Math.round(v * 100)]),
    ) as ReadinessResult['components'],
    observed,
    confidence: i.observed_days >= 21 ? 'high' : i.observed_days >= 10 ? 'medium' : 'low',
  };
}
