/**
 * How each readiness component is named and described.
 *
 * What used to live here was a fixture: a label, an authored sentence about how
 * the athlete was doing, and three invented stats — "Squat 215", "Z2 pace 8:52"
 * — that rendered as measurements of whoever was looking. Those are gone.
 *
 * What remains is the part that is true for everyone: the component's name, and
 * `FALLBACK_DETAIL` from the coach package, which states what the metric
 * measures rather than how it is going. A sentence about the athlete's own
 * numbers arrives from Coach's narration or not at all, and the supporting
 * stats come from the server computed against their own history.
 */
import { COMPONENT_KEYS, FALLBACK_DETAIL, type ComponentKey } from '@pivot/coach';

export type { ComponentKey };
export { COMPONENT_KEYS };

export const METRIC_LABEL: Record<ComponentKey, string> = {
  aerobic: 'Aerobic engine',
  running: 'Running',
  strength: 'Strength',
  stations: 'Stations',
  consistency: 'Consistency',
  recovery: 'Recovery',
};

export interface MetricDetail {
  label: string;
  /** What the component measures, or Coach's sentence about it once written. */
  detail: string;
  /** Measured supporting figures. Empty is the honest state, never a default. */
  stats: { k: string; v: string }[];
}

/**
 * Builds the per-component detail from what is actually known.
 *
 * Nothing here invents a figure: a component with no server stats carries an
 * empty list and the screen shows no chips, which is why an athlete who has
 * never logged a lift does not see a squat number.
 */
export function metricDetail(
  serverStats: Record<string, { stats: { k: string; v: string }[] }> | undefined,
  narration: Record<string, string> | null,
): Record<string, MetricDetail> {
  return Object.fromEntries(COMPONENT_KEYS.map(key => [key, {
    label: METRIC_LABEL[key],
    // The shipped sentence is the floor; Coach's replaces it only once it has
    // actually written one from this athlete's numbers.
    detail: narration?.[key] ?? FALLBACK_DETAIL[key],
    stats: serverStats?.[key]?.stats ?? [],
  }]));
}
