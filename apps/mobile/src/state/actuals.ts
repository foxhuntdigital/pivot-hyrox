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

/** One set performed, as `set_logs` records it. */
export interface SetActual {
  block_order: number;
  exercise_id: string;
  set_index: number;
  prescribed_reps: number | null;
  actual_reps: number | null;
}

/** One cardio effort performed, as `cardio_logs` records it. */
export interface CardioActual {
  block_order: number;
  exercise_id: string;
  duration_seconds: number | null;
  distance_meters: number | null;
}

export interface SessionActuals {
  blocks: BlockActual[];
  set_logs: SetActual[];
  cardio_logs: CardioActual[];
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
 * the session unrecorded rather than logged as a failure. Load is not inferred
 * at all — nothing here knows what was on the bar, so `actual_load` stays null
 * until there is a way to ask.
 */
export function buildLogs(
  steps: Step[],
  stepSeconds: number[],
  completedCount: number,
  finishedAt: Date = new Date(),
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
        set_logs.push({
          block_order: step.block_order,
          exercise_id: step.exercise_id,
          set_index: index,
          prescribed_reps: step.quantity,
          actual_reps: step.quantity,
        });
        break;
      }
      case 'distance':
        // Distance prescribed, duration measured — a real pace, because the
        // clock ran and the tap says the distance was covered.
        cardio_logs.push({
          block_order: step.block_order,
          exercise_id: step.exercise_id,
          duration_seconds: seconds || null,
          distance_meters: meters(step.quantity, step.quantity_unit),
        });
        break;
      case 'duration':
      case 'calories':
        // Time is known, distance is not. Logged without one rather than with
        // an estimate, which is what keeps it out of any pace claim.
        cardio_logs.push({
          block_order: step.block_order,
          exercise_id: step.exercise_id,
          duration_seconds: seconds || step.duration_seconds,
          distance_meters: null,
        });
        break;
      default:
        break;
    }
  }

  return { blocks: [...blocks.values()], set_logs, cardio_logs };
}
