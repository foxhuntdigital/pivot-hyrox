/**
 * Splits — the session as a stopwatch records it.
 *
 * Every Next is a lap. The player already measures how long each step took
 * (`step_seconds`, advanced by the tick), but until now that time survived only
 * where it happened to fit an existing log: a cardio step kept its duration, a
 * strength step's time was measured and discarded, and rest was recorded
 * nowhere. An athlete who wants to know what the third station cost them could
 * not be told.
 *
 * A split is therefore its own record rather than a field on one of the log
 * tables: it is per step, it includes rest, and it is ordered, which is what
 * makes "800 m in 4:12, then 1:30 rest, then lunges in 2:48" reconstructable
 * afterwards.
 *
 * Two properties worth stating because they are decisions, not accidents:
 *
 *   * Splits are **moving time**. The tick only runs while the status is
 *     `active_block`, so a paused clock counts against neither the split nor
 *     the session, and `cumulative_seconds` therefore matches the elapsed time
 *     on screen rather than wall clock.
 *   * A step never reached has **no split**, rather than a zero. Ending early
 *     leaves the rest of the session unrecorded, which is the same rule the
 *     set and cardio logs follow.
 *
 * Pure, and — like `actuals.ts` — importing nothing but the `Step` type, which
 * is erased at runtime. That is what lets it be tested directly: `steps.ts`
 * itself reaches for the content library to name exercises, and a test of what
 * the clock recorded should not need the library to run.
 */
import type { Step } from './steps.ts';

export interface Split {
  /** Position in the session, 0-based, in the order performed. */
  index: number;
  block_order: number;
  round: number;
  /** Null for rest, which belongs to no movement. */
  exercise_id: string | null;
  /** What the athlete was doing: 'Run', 'DB Thruster', 'Recover'. */
  label: string;
  /** What the step asked for, as the player showed it: '800 m', '12 reps'. */
  prescribed: string;
  /** Section this split sits in: 'Warm-up', 'Work', 'Rest'. */
  kind: string;
  /** Moving seconds on this step. */
  seconds: number;
  /** Session time at the end of this split. */
  cumulative_seconds: number;
  /** Rest is a lap too, but it is not work — the UI and the totals separate it. */
  rest: boolean;
}

/**
 * The laps recorded so far.
 *
 * `completedCount` is the number of steps the athlete has finished, so the step
 * currently under way is deliberately not a split yet: it has no final time.
 * The live screen shows that one separately, still running.
 */
export function buildSplits(
  steps: Step[],
  stepSeconds: number[],
  completedCount: number,
): Split[] {
  const splits: Split[] = [];
  let cumulative = 0;

  for (const [index, step] of steps.slice(0, Math.max(0, completedCount)).entries()) {
    const seconds = Math.round(stepSeconds[index] ?? 0);
    cumulative += seconds;
    splits.push({
      index,
      block_order: step.block_order,
      round: step.round,
      exercise_id: step.exercise_id || null,
      label: step.label,
      prescribed: step.qty,
      kind: step.kind,
      seconds,
      cumulative_seconds: cumulative,
      rest: step.rest,
    });
  }

  return splits;
}

/** Working time and rest time, split apart. Rest is structure, not work. */
export function splitTotals(splits: Split[]): { work: number; rest: number; total: number } {
  let work = 0;
  let rest = 0;
  for (const s of splits) {
    if (s.rest) rest += s.seconds;
    else work += s.seconds;
  }
  return { work, rest, total: work + rest };
}

/**
 * The fastest and slowest comparable laps.
 *
 * "Comparable" is doing real work here: a session's splits are not a set of
 * repeats unless they prescribe the same thing, so rounds of the same movement
 * at the same prescription are compared and everything else is left alone.
 * Marking a 5-minute run as "slowest" against a 30-second rest would be a
 * comparison the athlete never asked for and cannot act on.
 */
export function fastestAndSlowest(
  splits: Split[],
): { fastest: number | null; slowest: number | null } {
  const groups = new Map<string, Split[]>();
  for (const s of splits) {
    if (s.rest || !s.seconds) continue;
    const key = `${s.exercise_id}|${s.prescribed}`;
    const group = groups.get(key) ?? [];
    group.push(s);
    groups.set(key, group);
  }

  let fastest: Split | null = null;
  let slowest: Split | null = null;
  for (const group of groups.values()) {
    if (group.length < 2) continue;      // one exposure is not a repeat
    for (const s of group) {
      if (!fastest || s.seconds < fastest.seconds) fastest = s;
      if (!slowest || s.seconds > slowest.seconds) slowest = s;
    }
  }

  // Every comparable lap taking the same time is a fact about the athlete, not
  // a fastest and a slowest.
  if (fastest && slowest && fastest.seconds === slowest.seconds) return { fastest: null, slowest: null };
  return { fastest: fastest?.index ?? null, slowest: slowest?.index ?? null };
}
