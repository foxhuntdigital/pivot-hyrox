/**
 * Candidate ranking (PRD §9.2). Each component returns 0..1 and is combined
 * with the PRD's example weights. Weights live in one exported object so the
 * server can version them without touching the scoring logic.
 */
import type {
  EngineInput, RecoveryState, ScoreBreakdown, StimulusRequirement,
  Variant, WorkoutTemplate,
} from './types.ts';
import { recoveryRank, variantMinutes } from './guardrails.ts';

export const WEIGHTS = {
  stimulus_urgency: 0.24,
  /**
   * Demonstrated deficit. New in 2.0.0.
   *
   * Weighted below stimulus urgency on purpose: what the week still owes is a
   * statement about the plan, and a capability reading is a statement about
   * several sessions of evidence. The plan wins where they disagree, and this
   * moves the order within what the week already permits.
   */
  capability_need: 0.13,
  recovery_fit: 0.17,
  race_specificity: 0.12,
  progression_continuity: 0.12,
  /**
   * Stated deficit — what the athlete believes needs work. New in 2.1.0.
   *
   * Deliberately its own dimension, between evidence and preference, and the
   * three are kept apart because they are three different claims:
   *
   *   capability_need     what performance has demonstrated
   *   perceived_weakness  what the athlete believes
   *   preference          what the athlete wants
   *
   * Below `capability_need` because a belief is not a measurement. Above
   * `preference` because "I am bad at this" is a different statement from "I
   * enjoy this", and the plan should answer the first more readily.
   *
   * Disagreement is information and is not reconciled here. An athlete who says
   * their running is weak while the evidence says otherwise keeps both signals:
   * this dimension still gives the belief its small influence, and Coach is
   * handed both and can say the two disagree. Suppressing the belief because
   * evidence contradicts it, or letting the belief colour the evidence, would
   * destroy the distinction the athlete model exists to draw.
   */
  perceived_weakness: 0.08,
  time_fit: 0.07,
  equipment_fit: 0.03,
  preference: 0.04,
} as const;

/** Intensity cost of a template, 0..1, read from its authored RPE target. */
export function intensityCost(template: WorkoutTemplate): number {
  const target = template.intensity_target ?? '';
  const nums = target.match(/\d+/g)?.map(Number) ?? [];
  if (!nums.length) return 0.5;
  const peak = Math.max(...nums);
  return Math.min(1, peak / 10);
}

/**
 * How badly the week needs this template's stimulus.
 * A requirement with no exposures left contributes nothing; the most
 * under-served, highest-priority requirement dominates.
 */
export function stimulusUrgency(
  template: WorkoutTemplate,
  requirements: StimulusRequirement[],
): number {
  const matches = requirements.filter(r => matchesStimulus(template, r.stimulus_type));
  if (!matches.length) return 0;

  return Math.max(...matches.map(r => {
    const remaining = r.target_exposures - r.completed_exposures;
    if (remaining <= 0) return 0;
    const deficit = remaining / r.target_exposures;      // 0..1
    const priority = 1 / Math.max(1, r.priority);        // 1, 0.5, 0.33…
    return deficit * priority;
  }));
}

/**
 * A template serves a stimulus if any of its labels names it.
 *
 * Templates carry the taxonomy at two levels: `primary_goal` is the planner's
 * coarse goal, `stimulus` the authored one it rolls up to. Both are matched, so
 * widening what a phase asks for does not require re-labelling content.
 */
/**
 * The planner's five goals, said in the classification's vocabulary.
 *
 * `training_domain` and `primary_goal` are two different vocabularies, and the
 * reclassification is only safe because of this table. `aerobic` is not the
 * string `aerobic_durability`, and `hybrid` is not `race_specific`: matching
 * the domain directly would have silently emptied both goals. Measured before
 * the switch, that flip regressed 18 of 32 coverage cells and fixed none.
 *
 * `muscular_endurance` is deliberately absent. It is the honest home for the
 * eleven templates that carried load with no working sets — Sled Push
 * Strength-Power, Farmer Carry Micro, the sessions that used to satisfy the
 * week's strength exposures — and the planner has never asked for muscular
 * endurance. Mapping it to a goal to keep those counts up would be reinstating
 * the mislabel this release exists to remove. Measured both ways: identical
 * coverage, so the truthful reading costs nothing.
 */
const DOMAIN_TO_GOAL: Record<string, string> = {
  strength: 'strength',
  aerobic: 'aerobic_durability',
  threshold: 'threshold',
  recovery: 'recovery',
  hybrid: 'race_specific',
};

/**
 * Whether a template serves the stimulus the week is asking for.
 *
 * ENGINE 2.0.0: this reads `training_domain` — what the session structurally
 * IS — where it used to read `primary_goal`, which is what someone called it.
 * Twenty-five templates claimed the strength goal and four were resistance
 * sessions; the planner asked for two strength exposures a week and was handed
 * *SkiErg — Strength-Power*.
 *
 * Falls back to `primary_goal` for a template the classification pass has not
 * reached, so an unclassified row degrades to the old behaviour rather than
 * matching nothing.
 *
 * The other three clauses are unchanged and still carry the authored detail:
 * a week asking for a named stimulus or a specific family still finds it.
 */
export function matchesStimulus(template: WorkoutTemplate, stimulusType: string): boolean {
  const domain = template.training_domain ?? null;
  const goal = domain ? (DOMAIN_TO_GOAL[domain] ?? null) : template.primary_goal;

  return goal === stimulusType
    || template.stimulus === stimulusType
    || template.secondary_goal === stimulusType
    || template.workout_family === stimulusType;
}

/**
 * Compatibility between the session's intensity and the athlete's state.
 * Good recovery tolerates anything; poor recovery scores easy work highest.
 */
export function recoveryFit(template: WorkoutTemplate, recovery: RecoveryState): number {
  const cost = intensityCost(template);
  const capacity = (recoveryRank(recovery) + 1) / 3;   // poor .33, okay .67, good 1
  if (cost <= capacity) return 1 - (capacity - cost) * 0.3;  // mild penalty for being too easy
  return Math.max(0, 1 - (cost - capacity) * 2);              // steep penalty for too hard
}

/** Specificity matters more as the race approaches. */
export function raceSpecificity(template: WorkoutTemplate, daysToRace: number | null): number {
  if (daysToRace === null) return template.hyrox_specificity * 0.5;
  // Ramps from 0.3 at ~6 months out to 1.0 inside three weeks.
  const proximity = Math.min(1, Math.max(0.3, 1 - daysToRace / 180));
  return template.hyrox_specificity * proximity;
}

/**
 * Rewards continuing a family the athlete has an established thread in, so
 * progression has something to build on — but only once the spacing guardrail
 * has already cleared the template.
 */
export function progressionContinuity(template: WorkoutTemplate, input: EngineInput): number {
  const inFamily = input.recent_sessions.filter(s => s.workout_family === template.workout_family);
  if (!inFamily.length) return 0.3;                 // new thread: neutral-low

  const mostRecent = Math.min(...inFamily.map(s => s.days_ago));
  if (mostRecent <= 2) return 0.5;                  // very fresh; spacing already checked
  if (mostRecent <= 10) return 1;                   // the sweet spot for the next exposure
  return 0.6;                                        // stale thread, worth restarting
}

/**
 * Rewards using the available time well. A session that fills most of the
 * window scores highest; one that barely uses it is a wasted opportunity, and
 * one that overruns was already filtered out.
 */
export function timeFit(
  template: WorkoutTemplate, variant: Variant, availableMinutes: number,
): number {
  const minutes = variantMinutes(template, variant);
  if (minutes > availableMinutes) return 0;
  return Math.max(0.2, minutes / availableMinutes);
}

/**
 * Which work addresses which capability.
 *
 * Families rather than exercises, because the planner selects sessions and a
 * session is the unit an athlete trains. Prefixes rather than an exhaustive
 * list, so a family added by a future content pack is covered by the naming
 * convention it already follows instead of silently scoring zero.
 *
 * The training domain is the fallback: it is broader — every strength session
 * trains strength — and the family is what distinguishes an upper-body deficit
 * from a lower-body one, which is the distinction this dimension exists to act
 * on. A domain match therefore scores less than a family match rather than the
 * same.
 */
const CAPABILITY_TARGETS: Record<string, { families: RegExp[]; domains: string[] }> = {
  lower_body_strength: {
    families: [/^strength_(legs|total|maintenance_lower)/], domains: ['strength'],
  },
  upper_body_strength: {
    families: [/^strength_(push|pull|total|maintenance_upper)/], domains: ['strength'],
  },
  running_threshold: {
    families: [/^(threshold|tempo|one_k|short_intervals|run_quality|hills|race_pace)/],
    domains: ['threshold'],
  },
  aerobic_durability: {
    families: [/^(run_base|long_run|easy_base|long_engine|low_impact|progression|row_base|ski_base|erg_engine|treadmill)/],
    domains: ['aerobic'],
  },
  muscular_endurance: {
    families: [/^(density|micro|compromised)/], domains: ['muscular_endurance'],
  },
  loaded_movement: {
    families: [/^station_(farmer_carry|sled_push|sled_pull|sandbag_lunge)/],
    domains: ['muscular_endurance', 'strength'],
  },
  station_proficiency: {
    families: [/^(station_|hybrid|run_to_station|station_to_run)/], domains: ['hybrid'],
  },
};

/**
 * How much this session addresses a deficit the evidence has demonstrated.
 *
 * Additive demand, never authority. Every hard constraint — safety, the
 * recovery intensity ceiling, equipment, impact, postpartum, spacing — has
 * already run in `checkEligibility` before anything is scored, so a capability
 * need can only reorder candidates that were all independently allowed. An
 * athlete with a large strength deficit and poor recovery still gets no
 * strength session above their intensity ceiling; they get the best of what
 * remains, ordered by what they most need.
 *
 * The strongest single need wins rather than the sum: a session that happens
 * to touch three mild deficits is not more urgent than one squarely addressing
 * a large one, and summing would make breadth beat depth.
 */
export function capabilityNeed(template: WorkoutTemplate, input: EngineInput): number {
  const needs = input.capability_needs;
  if (!needs) return 0;

  const domain = template.training_domain ?? template.primary_goal ?? '';
  let best = 0;
  for (const [key, need] of Object.entries(needs)) {
    if (!(need > 0)) continue;
    const target = CAPABILITY_TARGETS[key];
    if (!target) continue;
    const match = target.families.some(re => re.test(template.workout_family)) ? 1
      : target.domains.includes(domain) ? 0.6
      : 0;
    best = Math.max(best, match * Math.min(1, need));
  }
  return best;
}

/**
 * How much this session addresses a deficit the athlete has TOLD us about.
 *
 * The same target map as `capabilityNeed`, and deliberately not the same input.
 * Migration 0013 states the reason on the table itself: a belief has no
 * confidence band — the athlete either said it or did not — so there is no
 * magnitude to scale by and every stated weakness counts the same.
 *
 * It reads `perceived_weaknesses` and never `capability_needs`. Nothing here
 * consults the evidence, in either direction: a belief the evidence contradicts
 * is still the athlete's belief and still ranks, and no belief ever becomes
 * evidence, alters a capability band or moves a confidence band.
 */
export function perceivedWeakness(template: WorkoutTemplate, input: EngineInput): number {
  const stated = input.perceived_weaknesses;
  if (!stated?.length) return 0;

  const domain = template.training_domain ?? template.primary_goal ?? '';
  let best = 0;
  for (const key of stated) {
    const target = CAPABILITY_TARGETS[key];
    if (!target) continue;
    const match = target.families.some(re => re.test(template.workout_family)) ? 1
      : target.domains.includes(domain) ? 0.6
      : 0;
    best = Math.max(best, match);
  }
  return best;
}

/** Full marks for a direct match; substitutions cost a little confidence. */
export function equipmentFit(swapCount: number): number {
  return Math.max(0, 1 - swapCount * 0.25);
}

/** Modality preference and variation. Never overrides safety (PRD §9.2). */
export function preference(template: WorkoutTemplate, input: EngineInput): number {
  let score = 0.5;

  /**
   * An athlete states a preference in whichever vocabulary they think in, so a
   * stated key is compared against the family, the domain and the planner goal
   * alike. "I like strength" and "I like leg day" are both answerable.
   */
  const describes = [
    template.workout_family,
    template.training_domain ?? '',
    template.primary_goal,
  ].filter(Boolean);
  const stated = (list?: string[]) => list?.some(k => describes.includes(k)) ?? false;

  if (stated(input.preferred_families)) score += 0.3;
  // Soft, and deliberately smaller than the reward. A dislike is a reason to
  // offer something else where something else exists, not a reason to leave a
  // requirement unmet — the athlete who would rather not run still has to.
  if (stated(input.avoided_families)) score -= 0.2;

  // Variation: penalise repeating the exact template the athlete just did.
  const repeated = input.recent_sessions.some(
    s => s.template_id === template.id && s.days_ago <= 7);
  if (repeated) score -= 0.3 * (input.variation_tolerance ?? 1);

  return Math.min(1, Math.max(0, score));
}

export function score(
  template: WorkoutTemplate,
  variant: Variant,
  input: EngineInput,
  recovery: RecoveryState,
  swapCount: number,
): ScoreBreakdown {
  const parts = {
    stimulus_urgency: stimulusUrgency(template, input.stimulus_requirements),
    capability_need: capabilityNeed(template, input),
    perceived_weakness: perceivedWeakness(template, input),
    recovery_fit: recoveryFit(template, recovery),
    race_specificity: raceSpecificity(template, input.days_to_race),
    progression_continuity: progressionContinuity(template, input),
    time_fit: timeFit(template, variant, input.available_minutes),
    equipment_fit: equipmentFit(swapCount),
    preference: preference(template, input),
  };

  const total = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[])
    .reduce((sum, k) => sum + parts[k] * WEIGHTS[k], 0);

  return { ...parts, total };
}
