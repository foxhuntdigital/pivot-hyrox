/**
 * The rebuilding ceiling — how much an athlete returning from injury is asked
 * for, and when that goes up.
 *
 * Product signoff, 28 Sep 2026. Two rules carry the whole design:
 *
 *   * The stated capacity is never mutated. An athlete six weeks back from
 *     injury has not become a beginner — they have the training age and the
 *     technique they had before, and only what they can absorb right now is
 *     reduced. Overwriting `load_capacity` would destroy the number they are
 *     rebuilding towards, and leave nothing to know when the rebuild is done.
 *   * Nothing is time-based. A rebuild ends when the athlete tolerates the work,
 *     not when a fortnight has passed, and a ceiling that lifted itself on a
 *     timer would raise the dose of someone who had not trained at all.
 */

/** The ceiling a rebuild starts at, one level below the athlete's own capacity. */
export function startingCeiling(loadCapacity: number): number {
  return Math.max(1, loadCapacity - 1);
}

/**
 * What the planner should actually use.
 *
 * Every read of `load_capacity` has to go through this or the ceiling does
 * nothing: it constrains by being the smaller of the two, and a caller that
 * reads the raw column simply ignores it.
 */
export function effectiveLoadCapacity(
  loadCapacity: number | null | undefined,
  ceiling: number | null | undefined,
): number | null {
  if (loadCapacity == null) return null;
  if (ceiling == null) return loadCapacity;
  return Math.min(loadCapacity, ceiling);
}

/** How many tolerated exposures a step forward needs. */
export const EXPOSURES_TO_PROGRESS = 2;
/** And the span they must cover, in days. */
export const DAYS_TO_PROGRESS = 7;

/** One completed session, as the progression check reads it. */
export interface ToleratedExposure {
  /** ISO timestamp the session was performed. */
  at: string;
  /**
   * What the session actually demanded. Null for an ungraded template, which
   * cannot count toward a step at a particular level — the level is the whole
   * claim being made.
   */
  load_demand: number | null;
  /** False for a session the athlete abandoned partway. */
  completed: boolean;
  /** True when they stopped early. Finishing is what "tolerated" means here. */
  ended_early: boolean;
}

export type ProgressionVerdict =
  | { eligible: true; next_ceiling: number; clears_rebuild: boolean }
  | { eligible: false; reason: 'not_rebuilding' | 'at_capacity' | 'too_few' | 'too_soon' };

/**
 * Whether the athlete may be offered a step up, and to what.
 *
 * Offered, not applied. The signoff says the athlete *confirms* progression, so
 * this answers whether the evidence exists — the decision stays theirs, which
 * matters most for exactly the athlete this exists for.
 *
 * "Tolerated" is read as completed and not ended early, at a template graded to
 * the current ceiling. Two of them, at least seven days apart. Both halves are
 * load-bearing: two sessions in two days is not evidence a body has absorbed
 * anything, and one session a fortnight ago is not evidence of repeatability.
 */
export function progressionVerdict(args: {
  loadCapacity: number | null;
  ceiling: number | null;
  /** When the current ceiling level was set. */
  ceilingSetAt: string | null;
  /** Completed sessions since the ceiling was set, in any order. */
  exposures: ToleratedExposure[];
  now: Date;
}): ProgressionVerdict {
  const { loadCapacity, ceiling, ceilingSetAt, exposures, now } = args;

  if (loadCapacity == null || ceiling == null) {
    return { eligible: false, reason: 'not_rebuilding' };
  }
  // The rebuild is over; the ceiling should already have been cleared.
  if (ceiling >= loadCapacity) return { eligible: false, reason: 'at_capacity' };

  const tolerated = exposures.filter(e =>
    e.completed && !e.ended_early && e.load_demand === ceiling);

  if (tolerated.length < EXPOSURES_TO_PROGRESS) {
    return { eligible: false, reason: 'too_few' };
  }

  /**
   * The span is measured across the exposures themselves, and from the ceiling
   * being set where that is longer.
   *
   * Using only the ceiling date would let an athlete who trained twice on day
   * six of a seven-day-old ceiling qualify on the calendar rather than on
   * repeatability; using only the exposures would let two sessions eight days
   * apart qualify a ceiling set yesterday.
   */
  const times = tolerated.map(e => Date.parse(e.at)).filter(Number.isFinite);
  if (!times.length) return { eligible: false, reason: 'too_few' };

  const earliest = Math.min(...times, ...(ceilingSetAt && Number.isFinite(Date.parse(ceilingSetAt))
    ? [Date.parse(ceilingSetAt)] : []));
  const spanDays = (now.getTime() - earliest) / 86_400_000;
  if (spanDays < DAYS_TO_PROGRESS) return { eligible: false, reason: 'too_soon' };

  const next = ceiling + 1;
  return {
    eligible: true,
    next_ceiling: next,
    // Reaching the stated capacity ends the rebuild rather than capping at it.
    clears_rebuild: next >= loadCapacity,
  };
}
