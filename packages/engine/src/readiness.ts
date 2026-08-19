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
}

export const READINESS_MODEL_VERSION = '1.0.0';

const COMPONENT_WEIGHTS = {
  aerobic: 0.2,
  running: 0.2,
  strength: 0.15,
  stations: 0.15,
  consistency: 0.15,
  recovery: 0.15,
} as const;

export interface ReadinessResult {
  overall: number;
  components: Record<keyof typeof COMPONENT_WEIGHTS, number>;
  confidence: Confidence;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

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

  const overall = (Object.keys(COMPONENT_WEIGHTS) as (keyof typeof COMPONENT_WEIGHTS)[])
    .reduce((sum, k) => sum + components[k] * COMPONENT_WEIGHTS[k], 0);

  return {
    // Whole numbers only — decimals would imply precision this does not have.
    overall: Math.round(overall * 100),
    components: Object.fromEntries(
      Object.entries(components).map(([k, v]) => [k, Math.round(v * 100)]),
    ) as ReadinessResult['components'],
    confidence: i.observed_days >= 21 ? 'high' : i.observed_days >= 10 ? 'medium' : 'low',
  };
}
