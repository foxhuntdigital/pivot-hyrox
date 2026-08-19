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
  stimulus_urgency: 0.30,
  recovery_fit: 0.20,
  race_specificity: 0.15,
  progression_continuity: 0.15,
  time_fit: 0.10,
  equipment_fit: 0.05,
  preference: 0.05,
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

/** A template serves a stimulus if either of its goals names it. */
export function matchesStimulus(template: WorkoutTemplate, stimulusType: string): boolean {
  return template.primary_goal === stimulusType
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

/** Full marks for a direct match; substitutions cost a little confidence. */
export function equipmentFit(swapCount: number): number {
  return Math.max(0, 1 - swapCount * 0.25);
}

/** Modality preference and variation. Never overrides safety (PRD §9.2). */
export function preference(template: WorkoutTemplate, input: EngineInput): number {
  let score = 0.5;

  if (input.preferred_families?.includes(template.workout_family)) score += 0.3;

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
