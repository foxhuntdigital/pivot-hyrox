/**
 * What the athlete actually did, from what the player observed.
 *
 * Separate from `steps.ts` on purpose: building the step list needs the content
 * library to name exercises, while recording what happened to those steps needs
 * nothing but the steps themselves. Keeping the recording side dependency-free
 * is what lets it be tested directly.
 */
import type { Step } from './steps.ts';

/** One block's outcome, as `session_blocks` records it. */
export interface BlockActual {
  block_order: number;
  actual_json: {
    rounds_completed: number;
    seconds: number;
    steps_completed: number;
    steps_prescribed: number;
  };
  completed_at?: string;
  skipped?: boolean;
}

/**
 * What the athlete typed for one working set.
 *
 * Every field optional and every field independent: an athlete who logs the
 * weight and not the reps has told us something true, and an RPE left blank
 * must never block finishing the set (PRD §11, "Optional RPE/notes never block
 * completion").
 */
export interface SetEntry {
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null;
  unit?: 'lb' | 'kg';
  /**
   * Corrections to a measured effort, for the cases where the clock was not
   * the truth: a treadmill run the phone never saw, a timer left running
   * through a water stop, a distance the athlete cut short.
   *
   * `distance_meters` and `seconds` override what the player observed rather
   * than adding to it. The timer remains one source of a run, not the only one
   * — a manual entry has to work with no timer at all, or an athlete who
   * forgot to tap has no way to record the session they actually did.
   */
  distance_meters?: number | null;
  seconds?: number | null;
}

/** Entered values by step index. Steps with no entry are absent, not empty. */
export type SetEntries = Record<number, SetEntry>;

/** One set performed, as `set_logs` records it. */
export interface SetActual {
  block_order: number;
  exercise_id: string;
  set_index: number;
  prescribed_reps: number | null;
  actual_reps: number | null;
  /** The authored range this set was performed against (migration 0012). */
  prescribed_reps_min?: number | null;
  prescribed_reps_max?: number | null;
  prescribed_rpe?: number | null;
  actual_load?: number | null;
  load_unit?: string | null;
  rpe?: number | null;
  /**
   * Where the numbers came from.
   *
   * `asserted` is a row that exists only because the athlete tapped Complete.
   * It cannot show a miss — the prescription is the only thing it knows — so
   * trending it would read the library back as achievement. `manual` is a row
   * the athlete typed, and is the only kind that is evidence.
   */
  source: 'asserted' | 'manual';
}

/** One cardio effort performed, as `cardio_logs` records it. */
export interface CardioActual {
  block_order: number;
  exercise_id: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  rpe?: number | null;
  /**
   * Where the numbers came from. Unlike a set, the default here is a real
   * measurement: a distance step is timed by the player whether or not anyone
   * typed anything, which is why `comparable.ts` has been able to trend running
   * all along. `manual` marks a row the athlete corrected or entered outright.
   */
  source: 'timer' | 'manual';
}

export interface SessionActuals {
  blocks: BlockActual[];
  set_logs: SetActual[];
  cardio_logs: CardioActual[];
}

/** A number the athlete could plausibly have meant, or null. */
function entered(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Prescribed distances arrive in whatever unit the block was authored in. */
function meters(quantity: number, unit: string): number | null {
  const u = unit.toLowerCase();
  if (u.startsWith('km')) return quantity * 1000;
  if (u.startsWith('m')) return quantity;
  if (u.startsWith('mi')) return quantity * 1609.34;
  return null;
}

/**
 * What the athlete actually did, from what the player observed.
 *
 * Two sources, and only two. The clock measured how long each step took. The
 * Complete tap is the athlete stating they performed what that step prescribed
 * — the same assertion any checkbox in a training app carries — so prescribed
 * reps and prescribed distance are recorded as performed for steps they
 * completed, and for nothing else.
 *
 * Steps never reached are absent, not zeroed: ending early leaves the rest of
 * the session unrecorded rather than logged as a failure.
 *
 * There is now a way to ask. `entries` carries what the athlete typed for a
 * working set, and where they typed something it is recorded as `manual` — the
 * only kind of row that is evidence. Where they typed nothing the old rule
 * still holds and the row is `asserted`: the prescription, restated, marked as
 * what it is so no trend ever reads the library back as achievement.
 */
export function buildLogs(
  steps: Step[],
  stepSeconds: number[],
  completedCount: number,
  finishedAt: Date = new Date(),
  entries: SetEntries = {},
): SessionActuals {
  const done = steps.slice(0, Math.max(0, completedCount));
  const blocks = new Map<number, BlockActual>();
  const set_logs: SetActual[] = [];
  const cardio_logs: CardioActual[] = [];
  /** `set_logs` is unique on (block, set_index), so the counter is per block. */
  const setIndex = new Map<number, number>();

  for (const [i, step] of steps.entries()) {
    const seconds = Math.round(stepSeconds[i] ?? 0);
    const completed = i < done.length;

    const block = blocks.get(step.block_order) ?? {
      block_order: step.block_order,
      actual_json: {
        rounds_completed: 0, seconds: 0, steps_completed: 0, steps_prescribed: 0,
      },
      skipped: true,
    };
    // Rest counts toward the block's elapsed time but is not work: it is
    // neither a step performed nor a round completed.
    if (!step.rest) block.actual_json.steps_prescribed += 1;
    if (completed) {
      block.actual_json.seconds += seconds;
      if (!step.rest) {
        block.actual_json.steps_completed += 1;
        block.actual_json.rounds_completed = Math.max(
          block.actual_json.rounds_completed, step.round);
        block.skipped = false;
        block.completed_at = finishedAt.toISOString();
      }
    }
    blocks.set(step.block_order, block);

    if (!completed || step.rest || !step.exercise_id) continue;

    switch (step.prescription_type) {
      case 'reps':
      case 'sets_reps': {
        const index = setIndex.get(step.block_order) ?? 0;
        setIndex.set(step.block_order, index + 1);

        const entry = entries[i] ?? {};
        const weight = entered(entry.weight);
        const reps = entered(entry.reps);
        const rpe = entered(entry.rpe);

        /**
         * What this set asked for.
         *
         * On a structured prescription (migration 0011) that is `reps_min`, the
         * rep target. On an unstructured `sets_reps` row `step.quantity` is the
         * SET COUNT — reading it as reps is the bug that made every historical
         * `set_log` say "4 reps" for a set of six — so it is only used where
         * the step genuinely has no structure, which is a plain `reps` step.
         */
        const prescribedReps = step.set_number != null
          ? step.prescribed_reps_min ?? null
          : step.prescription_type === 'reps' ? step.quantity : null;

        set_logs.push({
          block_order: step.block_order,
          exercise_id: step.exercise_id,
          set_index: index,
          prescribed_reps: prescribedReps,
          // The typed value wins. Falling back to the prescription keeps the
          // Complete tap meaning what it has always meant, and `source` is what
          // stops the two being confused later.
          actual_reps: reps ?? prescribedReps,
          prescribed_reps_min: step.prescribed_reps_min ?? null,
          prescribed_reps_max: step.prescribed_reps_max ?? null,
          prescribed_rpe: step.target_rpe ?? null,
          actual_load: weight,
          load_unit: weight === null ? null : (entry.unit ?? 'lb'),
          rpe,
          source: (weight !== null || reps !== null || rpe !== null) ? 'manual' : 'asserted',
        });
        break;
      }
      case 'distance': {
        // Distance prescribed, duration measured — a real pace, because the
        // clock ran and the tap says the distance was covered. A correction
        // replaces either half: the athlete knows what the treadmill said.
        const entry = entries[i] ?? {};
        const correctedDistance = entered(entry.distance_meters);
        const correctedSeconds = entered(entry.seconds);
        cardio_logs.push({
          block_order: step.block_order,
          exercise_id: step.exercise_id,
          duration_seconds: correctedSeconds ?? (seconds || null),
          distance_meters: correctedDistance ?? meters(step.quantity, step.quantity_unit),
          rpe: entered(entry.rpe),
          source: (correctedDistance !== null || correctedSeconds !== null) ? 'manual' : 'timer',
        });
        break;
      }
      case 'duration':
      case 'calories': {
        // Time is known, distance is not. Logged without one rather than with
        // an estimate, which is what keeps it out of any pace claim — unless
        // the athlete supplies the distance, which makes the pace real.
        const entry = entries[i] ?? {};
        const correctedDistance = entered(entry.distance_meters);
        const correctedSeconds = entered(entry.seconds);
        cardio_logs.push({
          block_order: step.block_order,
          exercise_id: step.exercise_id,
          duration_seconds: correctedSeconds ?? (seconds || step.duration_seconds),
          distance_meters: correctedDistance,
          rpe: entered(entry.rpe),
          source: (correctedDistance !== null || correctedSeconds !== null) ? 'manual' : 'timer',
        });
        break;
      }
      default:
        break;
    }
  }

  return { blocks: [...blocks.values()], set_logs, cardio_logs };
}
