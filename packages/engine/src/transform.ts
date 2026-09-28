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
/**
 * Roles that state outright that a movement is support, not the session.
 *
 * The strongest signal in the ontology, and the only one that drops a movement
 * regardless of what else it is eligible for. All six ids the old hardcoded
 * list named carry one of these.
 */
const SUPPORT_ROLES = ['accessory', 'primer'];

/**
 * Roles that claim a movement as work.
 *
 * The first three carry the session's stimulus. `trunk_carry` is here by a
 * coaching ruling rather than by that logic: a loaded carry is real work and
 * belongs in a twenty-minute session.
 */
const WORK_ROLES = [
  'primary_strength', 'secondary_strength', 'power', 'trunk_carry',
];

/**
 * A weak signal, and deliberately the last one consulted.
 *
 * "Can close a session" is true of a great deal of real work — sled pushes,
 * walking lunges, farmer carries are all eligible as finishers — so a movement
 * is only dropped for it when nothing else claims it.
 */
const CLOSING_ROLES = ['finisher'];

/**
 * Whether Micro should drop this movement from inside a primary block.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * A hardcoded list of six exercise ids — `ex_pallof_press`, `ex_side_plank`,
 * `ex_glute_bridge`, `ex_landmine_rotation`, `ex_mobility_flow`,
 * `ex_breathing_core_reset` — against a library of 245 movements. Anything not
 * named was treated as the stimulus, so a Micro strength session kept Face
 * Pull, Hammer Curl, Preacher Curl and Calf Raise at full count and scaled the
 * squat and deadlift *down* around them. The one high-value dose the variant
 * exists to protect was the thing being compressed.
 *
 * ── Why this is a precedence and not a set difference ────────────────────
 *
 * `exercise_role_eligibility` lists the roles a movement *can* serve, not the
 * one it is serving here, so the roles routinely overlap and the order they are
 * consulted in decides the answer. Three real cases force the ordering:
 *
 *   * `ex_pallof_press` is `['trunk_carry', 'accessory']`. It is core work, not
 *     a loaded carry, and the old list named it explicitly as something Micro
 *     drops. So `accessory` has to outrank `trunk_carry`.
 *   * `ex_sandbag_carry` is `['trunk_carry', 'finisher']`. It is a carry, and
 *     carries stay. So `trunk_carry` has to outrank `finisher`.
 *   * `ex_sled_push` is `['finisher', 'power']`. It is the session. So any work
 *     role has to outrank `finisher`.
 *
 * Hence: a definite statement of support wins, then any claim on the movement
 * as work, then the weak closing signal, then keep.
 *
 * A movement with no role data is kept. Unknown is not accessory, and the 25
 * exercises still missing the ontology should not be silently deleted from a
 * session because of it.
 *
 * ── The classification this exposes ──────────────────────────────────────
 *
 * `ex_wall_ball` is eligible as `finisher` and nothing else, so this drops it —
 * from 36 templates, 27 of them hybrid. A wall ball in a HYROX session is not a
 * finisher, it is a race station and it is the stimulus. The rule is behaving
 * correctly on data that is wrong, and the fix belongs on the exercise rather
 * than in an exception here: carving out one id would rebuild, one entry at a
 * time, the hardcoded list this replaced.
 */
function isSupporting(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  if (roles.some(r => SUPPORT_ROLES.includes(r))) return true;
  if (roles.some(r => WORK_ROLES.includes(r))) return false;
  return roles.some(r => CLOSING_ROLES.includes(r));
}

/**
 * Scales one prescribed movement by a variant's volume multiplier.
 *
 * Rep- and distance-based work scales; a sets×reps prescription scales its set
 * count, which the quantity field holds.
 */
function scaleQuantity(be: BlockExercise, multiplier: number): BlockExercise {
  const scaled = Math.max(1, Math.round(be.quantity * multiplier));
  const out: BlockExercise = {
    ...be,
    quantity: be.prescription_type === 'load' ? be.quantity : scaled,
  };

  /**
   * `sets` carries the same count as `quantity` on a sets×reps row and must
   * scale with it (migration 0011). The player reads `sets` in preference to
   * `quantity` because it is the field that can be trusted, so leaving it
   * unscaled would hand an athlete on a 20-minute Micro the full four working
   * sets while every other part of the session compressed around them.
   *
   * Reps are deliberately NOT scaled. Volume comes off in whole sets: cutting
   * a 4×6 to 2×6 is a shorter session at the same quality, where 4×3 is a
   * different and worse stimulus.
   */
  if (be.sets != null && be.prescription_type !== 'load') {
    out.sets = Math.max(1, Math.round(be.sets * multiplier));
  }
  return out;
}

export function transformBlocks(
  template: WorkoutTemplate,
  variant: Variant,
  swaps: { from: string; to: string }[] = [],
  recovery: RecoveryState = 'good',
  /**
   * Movement roles, for deciding what Micro may drop.
   *
   * Optional, and an absent index means nothing is dropped rather than
   * everything: a caller without role data gets a Micro that scales volume and
   * keeps every movement, which is the conservative failure and not a session
   * stripped to its warm-up.
   */
  roleIndex?: Map<string, { exercise_role_eligibility?: string[] }>,
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

    // Micro drops supporting movements even inside a primary block, so the one
    // high-value dose is what remains.
    if (isMicro && roleIndex) {
      const core = exercises.filter(be =>
        !isSupporting(roleIndex.get(be.exercise_id)?.exercise_role_eligibility));
      // Never empty a block. A block whose every movement reads as supporting
      // is a block whose roles are wrong, and an empty session is a worse
      // answer than an uncompressed one.
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
