/**
 * Hard constraints (PRD §9.4). These run before scoring: a template that fails
 * any of them is not a low-ranked candidate, it is not a candidate at all.
 *
 * The engine never infers medical clearance. Concerning symptoms produce
 * conservative handling and safety messaging, never a diagnosis.
 */
import type {
  EngineInput, RecoveryState, WorkoutTemplate, Variant, ReasonCode,
} from './types.ts';

/**
 * Symptoms that stop the hard-training flow entirely (PRD §9.4). Matched as
 * lowercase substrings so the adapt sheet's chips and the coach classifier's
 * structured output both land here.
 */
export const SEVERE_SYMPTOMS = [
  'chest', 'dizz', 'faint', 'bleeding', 'pelvic pressure', 'leaking',
  'prolapse', 'shortness of breath', 'severe pain',
] as const;

/** Families that constitute maximal testing; barred on poor recovery. */
export const MAXIMAL_FAMILIES = ['simulation', 'benchmark'] as const;

/** Tags marking a session as high-intensity for spacing purposes. */
const HIGH_INTENSITY_TAGS = ['threshold', 'race_pace', 'intervals', 'density', 'simulation'];

/** Families that load the lower body heavily. */
const HEAVY_LOWER_FAMILIES = ['strength_legs'];

const RECOVERY_RANK: Record<RecoveryState, number> = { poor: 0, okay: 1, good: 2 };

/**
 * Intensity ceiling by recovery state (PRD §6.3 — energy sets an "intensity
 * ceiling"). This is a hard constraint, not a scoring input: an urgent stimulus
 * must never be able to outvote it and hand a depleted athlete threshold work.
 * Values are normalised RPE (peak authored RPE / 10).
 */
export const INTENSITY_CEILING: Record<RecoveryState, number> = {
  poor: 0.6,   // nothing above RPE 6
  okay: 0.8,   // controlled threshold is still on the table
  good: 1.0,
};

export function recoveryRank(state: RecoveryState): number {
  return RECOVERY_RANK[state];
}

export function hasSevereSymptom(flags: string[]): boolean {
  return flags.some(f =>
    SEVERE_SYMPTOMS.some(s => f.toLowerCase().includes(s)));
}

/**
 * Effective recovery after folding in the athlete's self-reported energy and
 * sleep. Connected data and manual check-ins arrive as `recovery_state`; this
 * only ever moves it downward, never up — optimism is not a safe default.
 */
export function effectiveRecovery(input: EngineInput): RecoveryState {
  let rank = recoveryRank(input.recovery_state);

  if (input.energy === 'low') rank = Math.min(rank, 1);
  if (input.sleep_hours !== null && input.sleep_hours < 5) rank = Math.min(rank, 1);
  if (input.sleep_hours !== null && input.sleep_hours < 4) rank = 0;
  if (input.symptom_flags.some(f => /hurt|pain|sore/i.test(f))) rank = Math.min(rank, 1);

  return (['poor', 'okay', 'good'] as const)[rank];
}

/** Equipment ids that stand in for "no equipment needed". */
const BODYWEIGHT = new Set(['bodyweight', 'outdoor']);

/**
 * Whether every exercise in the template can be performed, either directly or
 * through the validated substitution graph. Returns the swaps required.
 */
export function resolveEquipment(
  template: WorkoutTemplate,
  input: EngineInput,
  exerciseIndex: Map<string, { equipment: string[]; impact_level: string }>,
): { ok: boolean; swaps: { from: string; to: string; reason: string }[] } {
  const available = new Set([...input.available_equipment, 'bodyweight']);
  const swaps: { from: string; to: string; reason: string }[] = [];

  const satisfied = (exId: string): boolean => {
    const ex = exerciseIndex.get(exId);
    if (!ex) return false;
    if (ex.equipment.length === 0) return true;
    // Any one listed option is enough — the seed lists alternatives, not a set.
    return ex.equipment.some(e => available.has(e) || BODYWEIGHT.has(e));
  };

  for (const block of template.blocks) {
    for (const be of block.exercises) {
      if (satisfied(be.exercise_id)) continue;

      const options = input.substitutions
        .filter(s => s.exercise_id === be.exercise_id)
        .sort((a, b) => a.priority - b.priority);

      const swap = options.find(o => satisfied(o.substitute_exercise_id));
      if (!swap) return { ok: false, swaps: [] };

      swaps.push({
        from: be.exercise_id,
        to: swap.substitute_exercise_id,
        reason: swap.reason,
      });
    }
  }
  return { ok: true, swaps };
}

/**
 * Whether the template's impact can be brought within the athlete's constraint,
 * substituting high-impact movements where the graph allows.
 */
export function resolveImpact(
  template: WorkoutTemplate,
  input: EngineInput,
  exerciseIndex: Map<string, { equipment: string[]; impact_level: string }>,
): { ok: boolean; swaps: { from: string; to: string; reason: string }[] } {
  if (!input.low_impact_required) return { ok: true, swaps: [] };

  const swaps: { from: string; to: string; reason: string }[] = [];

  for (const block of template.blocks) {
    for (const be of block.exercises) {
      const ex = exerciseIndex.get(be.exercise_id);
      if (!ex || ex.impact_level !== 'high') continue;

      const swap = input.substitutions
        .filter(s => s.exercise_id === be.exercise_id)
        .sort((a, b) => a.priority - b.priority)
        .find(o => exerciseIndex.get(o.substitute_exercise_id)?.impact_level !== 'high');

      if (!swap) return { ok: false, swaps: [] };
      swaps.push({ from: be.exercise_id, to: swap.substitute_exercise_id, reason: swap.reason });
    }
  }
  return { ok: true, swaps };
}

/**
 * Minimum spacing between repeat high-intensity or heavy lower-body exposures.
 * 48 hours in both cases; a session inside that window is ineligible today.
 */
export function violatesSpacing(template: WorkoutTemplate, input: EngineInput): boolean {
  const isHighIntensity = template.tags.some(t => HIGH_INTENSITY_TAGS.includes(t));
  const isHeavyLower = HEAVY_LOWER_FAMILIES.includes(template.workout_family);

  for (const s of input.recent_sessions) {
    if (s.days_ago > 1) continue;
    if (isHeavyLower && HEAVY_LOWER_FAMILIES.includes(s.workout_family)) return true;
    if (isHighIntensity && s.session_rpe != null && s.session_rpe >= 8) return true;
  }
  return false;
}

/** Considerations that bar exercises flagged not postpartum-friendly. */
const POSTPARTUM_CONSIDERATIONS = ['postpartum', 'pelvic-floor', 'pelvic floor'];

export function requiresPostpartumSafe(input: EngineInput): boolean {
  return input.considerations.some(c =>
    POSTPARTUM_CONSIDERATIONS.some(p => c.toLowerCase().includes(p)));
}

/**
 * Normalised peak intensity of a template, read from its authored RPE target.
 * Mirrors rank.ts#intensityCost; kept local so the hard-constraint path has no
 * dependency on the scoring layer.
 */
export function templateIntensity(template: WorkoutTemplate): number {
  const nums = (template.intensity_target ?? '').match(/\d+/g)?.map(Number) ?? [];
  if (!nums.length) return 0.5;
  return Math.min(1, Math.max(...nums) / 10);
}

export interface EligibilityResult {
  eligible: boolean;
  swaps: { from: string; to: string; reason: string }[];
  codes: ReasonCode[];
}

/** Runs every hard constraint against one template. */
export function checkEligibility(
  template: WorkoutTemplate,
  input: EngineInput,
  exerciseIndex: Map<string, { equipment: string[]; impact_level: string }>,
  recovery: RecoveryState,
): EligibilityResult {
  const codes: ReasonCode[] = [];

  if (requiresPostpartumSafe(input) && !template.postpartum_friendly) {
    return { eligible: false, swaps: [], codes };
  }

  // Intensity ceiling. Compression can shorten a session but must never be a
  // route to prescribing harder work than the athlete's state supports.
  if (templateIntensity(template) > INTENSITY_CEILING[recovery]) {
    return { eligible: false, swaps: [], codes };
  }

  // No maximal testing on poor recovery.
  if (recovery === 'poor' && MAXIMAL_FAMILIES.includes(template.workout_family as any)) {
    return { eligible: false, swaps: [], codes };
  }

  // Taper narrows to race-specific and recovery work; generic progression is
  // overridden (PRD §9.4).
  if (input.phase_type === 'taper' &&
      !['recovery', 'micro', 'run_quality', 'ski_quality'].includes(template.workout_family)) {
    return { eligible: false, swaps: [], codes };
  }

  if (violatesSpacing(template, input)) {
    return { eligible: false, swaps: [], codes };
  }

  const equip = resolveEquipment(template, input, exerciseIndex);
  if (!equip.ok) return { eligible: false, swaps: [], codes };

  const impact = resolveImpact(template, input, exerciseIndex);
  if (!impact.ok) return { eligible: false, swaps: [], codes };

  const swaps = [...equip.swaps, ...impact.swaps];
  if (equip.swaps.length) codes.push('EQUIPMENT_SUBSTITUTION');
  else codes.push('EQUIPMENT_MATCH');
  if (impact.swaps.length) codes.push('IMPACT_REDUCTION');

  return { eligible: true, swaps, codes };
}

/**
 * Variants the athlete can actually complete: the transformed session must fit
 * the time they have, and must not exceed what their recovery supports.
 */
export function eligibleVariants(
  template: WorkoutTemplate,
  input: EngineInput,
  recovery: RecoveryState,
): Variant[] {
  return template.variants.filter(v => {
    if (recoveryRank(recovery) < recoveryRank(v.recovery_state)) return false;
    return variantMinutes(template, v) <= input.available_minutes;
  });
}

/**
 * Duration of a transformed session. The seed's `time_budget_minutes` is the
 * bucket a variant was authored for, not its length — a 30-minute Zone 2 run
 * sits in the 45-minute green bucket — so length is derived from the template's
 * own estimate scaled by the variant's volume multiplier.
 */
export function variantMinutes(template: WorkoutTemplate, variant: Variant): number {
  return Math.max(1, Math.round(template.estimated_minutes * variant.volume_multiplier));
}
