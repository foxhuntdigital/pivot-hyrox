/**
 * Variant transformation (PRD §9.3).
 *
 * The rule that matters most: the primary quality survives every compression.
 * Express and Micro are shorter expressions of the same training intent, not
 * lesser workouts — which is why the accessory work is what gets cut, and why
 * intensity is never raised to buy back lost volume.
 */
import type {
  BlockExercise, RecoveryState, Variant, WorkoutBlock, WorkoutTemplate,
} from './types.ts';

export type BlockRole = 'warmup' | 'primary' | 'accessory' | 'cooldown';

/** Classifies a block so the right compression rule applies to it. */
export function blockRole(block: WorkoutBlock): BlockRole {
  const text = `${block.block_type} ${block.title ?? ''} ${block.instructions ?? ''}`.toLowerCase();
  if (/warm/.test(text)) return 'warmup';
  if (/cool|flush/.test(text)) return 'cooldown';
  if (/accessor|core|finisher/.test(text)) return 'accessory';
  return 'primary';
}

/** Exercises that only ever serve as accessory work, cut first under Micro. */
const ACCESSORY_PATTERNS = [
  'ex_pallof_press', 'ex_side_plank', 'ex_glute_bridge',
  'ex_landmine_rotation', 'ex_mobility_flow', 'ex_breathing_core_reset',
];

function scaleQuantity(be: BlockExercise, multiplier: number): BlockExercise {
  // Rep- and distance-based work scales; a sets×reps prescription scales its
  // set count, which the quantity field holds.
  const scaled = Math.max(1, Math.round(be.quantity * multiplier));
  return { ...be, quantity: be.prescription_type === 'load' ? be.quantity : scaled };
}

/**
 * Applies a variant to a template's blocks.
 *
 * `swaps` come from the equipment/impact resolution and are applied as exercise
 * replacements so the returned blocks are directly executable.
 */
export function transformBlocks(
  template: WorkoutTemplate,
  variant: Variant,
  swaps: { from: string; to: string }[] = [],
  recovery: RecoveryState = 'good',
): WorkoutBlock[] {
  const m = variant.volume_multiplier;
  const isMicro = variant.variant_code === 'red';
  const isExpress = variant.variant_code === 'yellow';
  const swapMap = new Map(swaps.map(s => [s.from, s.to]));

  const out: WorkoutBlock[] = [];

  for (const block of template.blocks) {
    const role = blockRole(block);

    // Micro removes accessory work outright; Express reduces it first.
    if (role === 'accessory' && isMicro) continue;

    const accessoryFactor = role === 'accessory' && isExpress ? 0.5 : 1;

    // Warm-up keeps movement-specific prep under Express and drops to minimum
    // safe prep under Micro, rather than scaling linearly to nothing.
    const factor =
      role === 'warmup' ? (isMicro ? 0.4 : isExpress ? 0.7 : 1)
      : role === 'cooldown' ? (isMicro ? 0.3 : isExpress ? 0.6 : 1)
      : m * accessoryFactor;

    let exercises = block.exercises.map(be => {
      const swapped = swapMap.has(be.exercise_id)
        ? { ...be, exercise_id: swapMap.get(be.exercise_id)! }
        : be;
      return scaleQuantity(swapped, factor);
    });

    // Micro drops accessory movements even inside a primary block, so the one
    // high-value dose is what remains.
    if (isMicro) {
      const core = exercises.filter(be => !ACCESSORY_PATTERNS.includes(be.exercise_id));
      if (core.length) exercises = core;
    }

    out.push({
      ...block,
      rounds: block.rounds != null ? Math.max(1, Math.round(block.rounds * factor)) : block.rounds,
      duration_minutes: block.duration_minutes != null
        ? Math.max(1, Math.round(block.duration_minutes * factor))
        : block.duration_minutes,
      // Rest may compress modestly under Express, but Micro keeps enough rest
      // for the remaining work to stay high quality.
      rest_seconds: block.rest_seconds != null && isExpress
        ? Math.round(block.rest_seconds * 0.85)
        : block.rest_seconds,
      exercises,
    });
  }

  return out;
}

/**
 * Checks a transformation kept the session's reason for existing — the
 * automated content validation required by PRD §19.2.
 */
export function preservesPrimaryStimulus(
  template: WorkoutTemplate,
  transformed: WorkoutBlock[],
): boolean {
  const primaryBlocks = template.blocks.filter(b => blockRole(b) === 'primary');
  if (!primaryBlocks.length) return true;

  const survivingPrimary = transformed.filter(b => blockRole(b) === 'primary');
  if (!survivingPrimary.length) return false;

  // Every primary block must still carry at least one exercise.
  return survivingPrimary.every(b => b.exercises.length > 0);
}
