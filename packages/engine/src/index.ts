/**
 * The adaptive training engine (PRD §9).
 *
 * A pure function: same input, same decision. It ranks curated templates and
 * applies validated transformations — it never invents a workout, and the AI
 * coach can only call it, not bypass it (PRD §13).
 */
import type {
  EngineDecision, EngineInput, Exercise, NoSessionResult, ReasonCode,
  Recommendation, Variant, WorkoutTemplate,
} from './types.ts';
import {
  checkEligibility, effectiveRecovery, eligibleVariants, hasSevereSymptom,
  variantMinutes,
} from './guardrails.ts';
import { score } from './rank.ts';
import { transformBlocks, preservesPrimaryStimulus } from './transform.ts';

export const ENGINE_VERSION = '1.0.0';

export * from './types.ts';
export * from './guardrails.ts';
export * from './rank.ts';
export * from './transform.ts';
export * from './readiness.ts';

/** Days without training that trigger re-entry rather than backlog (PRD §20). */
const REENTRY_GAP_DAYS = 7;

export function recommend(
  input: EngineInput,
  exercises: Exercise[],
): EngineDecision {
  // Concerning symptoms stop the hard-training flow before anything else is
  // considered. The engine does not diagnose and does not negotiate here.
  if (hasSevereSymptom(input.symptom_flags)) {
    return {
      kind: 'no_session',
      reason_codes: ['NO_VALID_HARD_SESSION'],
      rationale: 'You reported a symptom that training through would not be reasonable.',
      guidance:
        "No session today. Rest, and if this persists or worsens, please get it "
        + "looked at by a qualified professional. I'm not able to assess symptoms, "
        + "and your week stays intact without today's training.",
    };
  }

  const recovery = effectiveRecovery(input);
  const exerciseIndex = new Map(
    exercises.map(e => [e.id, { equipment: e.equipment, impact_level: e.impact_level }]));

  type Candidate = {
    template: WorkoutTemplate;
    variant: Variant;
    swaps: { from: string; to: string; reason: string }[];
    codes: ReasonCode[];
    breakdown: ReturnType<typeof score>;
  };

  const candidates: Candidate[] = [];

  for (const template of input.candidates) {
    const eligibility = checkEligibility(template, input, exerciseIndex, recovery);
    if (!eligibility.eligible) continue;

    for (const variant of eligibleVariants(template, input, recovery)) {
      // A transformation that loses the primary stimulus is not a valid
      // adaptation, however well it scores (PRD §19.2).
      const blocks = transformBlocks(template, variant, eligibility.swaps, recovery);
      if (!preservesPrimaryStimulus(template, blocks)) continue;

      candidates.push({
        template,
        variant,
        swaps: eligibility.swaps,
        codes: eligibility.codes,
        breakdown: score(template, variant, input, recovery, eligibility.swaps.length),
      });
    }
  }

  if (!candidates.length) {
    return noValidSession(input, recovery);
  }

  // Deterministic ordering: score, then a stable key so equal scores never
  // depend on input array order.
  candidates.sort((a, b) =>
    b.breakdown.total - a.breakdown.total
    || a.template.id.localeCompare(b.template.id)
    || a.variant.variant_code.localeCompare(b.variant.variant_code));

  const best = candidates[0];
  const blocks = transformBlocks(best.template, best.variant, best.swaps, recovery);
  const codes = buildReasonCodes(best, input, recovery);

  return {
    kind: 'session',
    template: best.template,
    variant: best.variant,
    blocks,
    estimated_minutes: variantMinutes(best.template, best.variant),
    primary_stimulus: best.template.primary_goal,
    score: best.breakdown,
    reason_codes: codes,
    rationale: buildRationale(best, input, recovery, codes),
    substitutions_applied: best.swaps,
  };
}

function buildReasonCodes(
  best: { template: WorkoutTemplate; variant: Variant; codes: ReasonCode[]; breakdown: { stimulus_urgency: number; progression_continuity: number } },
  input: EngineInput,
  recovery: 'good' | 'okay' | 'poor',
): ReasonCode[] {
  const codes = new Set<ReasonCode>(best.codes);

  if (best.breakdown.stimulus_urgency > 0) codes.add('STIMULUS_DUE');

  codes.add(recovery === 'good' ? 'RECOVERY_HIGH'
    : recovery === 'okay' ? 'RECOVERY_NORMAL' : 'RECOVERY_LOW');

  if (best.variant.variant_code !== 'green') codes.add('TIME_LIMIT');
  if (best.breakdown.progression_continuity >= 1) codes.add('PROGRESSION_CONTINUITY');
  if (input.days_to_race !== null && input.days_to_race <= 60) codes.add('RACE_SPECIFICITY');
  if (input.phase_type === 'taper') codes.add('TAPER_OVERRIDE');

  const gap = input.recent_sessions.length
    ? Math.min(...input.recent_sessions.map(s => s.days_ago))
    : Infinity;
  if (gap >= REENTRY_GAP_DAYS) codes.add('REENTRY_AFTER_GAP');

  const heavyLowerRecently = input.recent_sessions.some(
    s => s.workout_family === 'strength_legs' && s.days_ago <= 2);
  if (heavyLowerRecently) codes.add('RECENT_LOWER_LOAD');

  return [...codes];
}

/**
 * The human-readable "why". PRD §2 requires every adaptation to expose a short
 * rationale naming the stimulus being preserved.
 */
function buildRationale(
  best: { template: WorkoutTemplate; variant: Variant },
  input: EngineInput,
  recovery: 'good' | 'okay' | 'poor',
  codes: ReasonCode[],
): string {
  const stimulus = best.template.primary_goal.replace(/_/g, ' ');
  const parts: string[] = [];

  if (codes.includes('REENTRY_AFTER_GAP')) {
    parts.push(`You've had a gap, so this rebuilds ${stimulus} rather than picking up where the plan left off`);
  } else if (codes.includes('STIMULUS_DUE')) {
    parts.push(`${capitalise(stimulus)} is the highest-priority stimulus still open this week`);
  } else {
    parts.push(`This keeps ${stimulus} moving`);
  }

  if (best.variant.variant_code === 'yellow') {
    parts.push('trimmed to fit the time you have while keeping the key work intact');
  } else if (best.variant.variant_code === 'red') {
    parts.push('cut to a minimum effective dose that still counts toward the week');
  }

  if (recovery === 'poor') parts.push('and held well below your usual load given how you\'re recovering');
  else if (recovery === 'okay') parts.push('at a controlled intensity given your recovery');

  if (codes.includes('IMPACT_REDUCTION')) parts.push('with high-impact movements swapped out');
  else if (codes.includes('EQUIPMENT_SUBSTITUTION')) parts.push('with substitutions for the kit you don\'t have');

  return parts.join(', ').replace(/,([^,]*)$/, '$1') + '.';
}

/**
 * Returned when nothing valid exists. PRD §9.4: return recovery/no-session
 * rather than forcing a recommendation.
 */
function noValidSession(input: EngineInput, recovery: 'good' | 'okay' | 'poor'): NoSessionResult {
  const codes: ReasonCode[] = ['NO_VALID_HARD_SESSION'];
  if (recovery === 'poor') codes.push('RECOVERY_LOW');
  if (input.available_minutes < 15) codes.push('TIME_LIMIT');

  const why = input.available_minutes < 15
    ? `${input.available_minutes} minutes isn't enough to deliver a real stimulus`
    : recovery === 'poor'
      ? 'nothing in the library is a good idea at your current recovery'
      : 'no session in the library fits today\'s constraints';

  return {
    kind: 'no_session',
    reason_codes: codes,
    rationale: `No session today — ${why}.`,
    guidance:
      'Take the rest or do something easy and unstructured. Your week is measured '
      + 'in stimuli, not days, so nothing is marked missed and tomorrow picks up normally.',
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
