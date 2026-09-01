/**
 * Optional work offered after a session is finished — and, far more often,
 * correctly not offered.
 *
 * A supplemental is a bonus for an athlete who completed what the plan asked
 * and still has something left. It is never scheduled, never chained, capped at
 * one a day, and it never credits a weekly stimulus requirement: the week asked
 * for a primary session and already got one. Skipping it writes nothing and
 * leaves no incomplete state, because nothing was ever pending.
 *
 * Pure over the same `EngineInput` snapshot the recommendation was made from,
 * and reusing `checkEligibility` rather than restating any of it, so a
 * supplemental cannot reach an athlete a primary could not.
 *
 * ── The refusal that matters most ───────────────────────────────────────────
 *
 * Poor recovery blocks the offer, and `athlete_override` does not lift it.
 *
 * Everywhere else in the engine an override is the athlete answering a question
 * about how hard today should be, and it is allowed to win. Here the question
 * is different: an athlete who has just finished a session, feels good about
 * it, and is asked whether they want more is in the worst possible position to
 * judge, and the cost of being wrong is carried by tomorrow. So this is the one
 * place motivation is not a valid input, which is exactly the QA scenario the
 * PRD names — poor recovery plus motivated must produce no offer.
 *
 * ── Load ceilings ───────────────────────────────────────────────────────────
 *
 * `supplemental_load` is never 'high'; migration 0013 refuses to store one.
 * What this adds is that the ceiling also falls with the day: a hard primary
 * spends the day's budget, and the supplemental that follows it has to be
 * smaller than one following an easy session.
 */
import {
  checkEligibility, eligibleVariants, effectiveRecovery, hasSevereSymptom,
  intensityCost, capabilityNeed, preference, variantMinutes,
  type EngineInput, type Exercise, type RecoveryState, type Variant,
  type WorkoutTemplate,
} from '../../../packages/engine/src/index.ts';

export type SupplementalType =
  | 'core' | 'muscular_endurance' | 'metcon' | 'accessory_strength'
  | 'resilience' | 'recovery' | 'boxing';

/** Ordered lightest first, which is also the order the ceiling relaxes in. */
export const SUPPLEMENTAL_LOADS = ['minimal', 'low', 'moderate'] as const;
export type SupplementalLoad = typeof SUPPLEMENTAL_LOADS[number];

/**
 * The longest a supplemental may be.
 *
 * Not a time budget the athlete states — a ceiling on the idea. Past twenty
 * minutes it stops being work bolted onto a finished session and becomes a
 * second session, which is the thing the one-per-day cap exists to prevent.
 */
export const SUPPLEMENTAL_MAX_MINUTES = 20;

export type SupplementalReason =
  /** An offer, and what it is bounded by. */
  | 'OFFERED'
  /** Nothing was finished today, so there is nothing to supplement. */
  | 'NO_PRIMARY_COMPLETED'
  /** The finished session was itself a supplemental. Never chained. */
  | 'WOULD_CHAIN'
  /** One a day. */
  | 'ALREADY_TAKEN_TODAY'
  /** Recovery is too low, and motivation does not lift this one. */
  | 'RECOVERY_TOO_LOW'
  /** A reported symptom stops the optional-extra flow the same way it stops the rest. */
  | 'SYMPTOMS_REPORTED'
  /** A taper sheds fatigue; adding optional volume to one is working against it. */
  | 'TAPER_WEEK'
  /** The primary was hard enough that the day is spent. */
  | 'PRIMARY_ALREADY_DEMANDING'
  /** Allowed, but the library has nothing that fits. */
  | 'NO_ELIGIBLE_SUPPLEMENTAL';

export interface SupplementalOption {
  template_id: string;
  name: string;
  supplemental_type: SupplementalType;
  supplemental_load: SupplementalLoad;
  variant_code: string;
  minutes: number;
}

export interface SupplementalOffer {
  offered: boolean;
  reason_code: SupplementalReason;
  rationale: string;
  /** Heaviest load permitted today. Null when nothing is offered. */
  max_load: SupplementalLoad | null;
  /** Ranked; empty whenever `offered` is false. */
  options: SupplementalOption[];
}

/** What the athlete finished, as the caller knows it. */
export interface CompletedPrimary {
  template: WorkoutTemplate;
  /** Their own rating of the session, where they gave one. */
  session_rpe?: number | null;
  /** True when the session was cut short; a shortened session spends less. */
  ended_early?: boolean;
}

const loadRank = (l: SupplementalLoad) => SUPPLEMENTAL_LOADS.indexOf(l);

/**
 * The heaviest supplemental the day can carry.
 *
 * Recovery sets the ceiling and the primary lowers it. An RPE 8 session
 * followed by a moderate supplemental is two hard efforts in a day wearing one
 * session's name; the same supplemental after an easy aerobic hour is what the
 * feature is for. Ending early raises nothing — a session cut short may have
 * been cut short because the athlete was struggling.
 */
export function maxLoadFor(
  recovery: RecoveryState, primary: CompletedPrimary,
): SupplementalLoad | null {
  if (recovery === 'poor') return null;
  const ceiling: SupplementalLoad = recovery === 'good' ? 'moderate' : 'low';

  // The session's own authored intensity, and the athlete's rating of it where
  // they gave one — whichever says the day was harder.
  const authored = intensityCost(primary.template);
  const reported = primary.session_rpe != null ? primary.session_rpe / 10 : 0;
  const demand = Math.max(authored, reported);

  if (demand >= 0.85) return null;                       // nothing more today
  if (demand >= 0.7) return 'minimal';
  if (demand >= 0.55) {
    return loadRank(ceiling) > loadRank('low') ? 'low' : ceiling;
  }
  return ceiling;
}

/**
 * Whether to offer anything at all, and how much.
 *
 * Every refusal carries a code, because "no supplemental today" is a sentence
 * the product has to be able to explain — and because a silent absence is
 * indistinguishable from a bug.
 */
export function evaluateSupplementalEligibility(args: {
  input: EngineInput;
  primary: CompletedPrimary | null;
  /** A supplemental already recorded for this athlete today. */
  supplementalTakenToday: boolean;
}): { allowed: boolean; reason_code: SupplementalReason; max_load: SupplementalLoad | null } {
  const { input, primary, supplementalTakenToday } = args;

  if (!primary) {
    return { allowed: false, reason_code: 'NO_PRIMARY_COMPLETED', max_load: null };
  }
  if ((primary.template.workout_role ?? 'primary') === 'supplemental') {
    return { allowed: false, reason_code: 'WOULD_CHAIN', max_load: null };
  }
  if (supplementalTakenToday) {
    return { allowed: false, reason_code: 'ALREADY_TAKEN_TODAY', max_load: null };
  }
  if (hasSevereSymptom(input.symptom_flags)) {
    return { allowed: false, reason_code: 'SYMPTOMS_REPORTED', max_load: null };
  }
  if (input.phase_type === 'taper') {
    return { allowed: false, reason_code: 'TAPER_WEEK', max_load: null };
  }

  // Deliberately reads the athlete's state, not `effectiveRecovery` with an
  // override applied. See the header: this is the one refusal motivation does
  // not lift.
  const recovery = effectiveRecovery({ ...input, athlete_override: false });
  if (recovery === 'poor') {
    return { allowed: false, reason_code: 'RECOVERY_TOO_LOW', max_load: null };
  }

  const max_load = maxLoadFor(recovery, primary);
  if (!max_load) {
    return { allowed: false, reason_code: 'PRIMARY_ALREADY_DEMANDING', max_load: null };
  }
  return { allowed: true, reason_code: 'OFFERED', max_load };
}

/**
 * Supplemental templates the athlete could do right now, best first.
 *
 * Ranked by what the evidence says they need, then by what they have said they
 * like, then lightest first — a tie between two options the athlete needs
 * equally should break toward the smaller one, because this is optional work
 * at the end of a day that already did its job.
 */
export function searchSupplementals(args: {
  input: EngineInput;
  templates: WorkoutTemplate[];
  exercises: Exercise[];
  maxLoad: SupplementalLoad;
  /** Minutes the athlete says they have, capped by SUPPLEMENTAL_MAX_MINUTES. */
  minutes?: number;
  type?: SupplementalType;
  limit?: number;
}): SupplementalOption[] {
  const { input, templates, exercises, maxLoad, type, limit = 3 } = args;
  const minutes = Math.min(args.minutes ?? SUPPLEMENTAL_MAX_MINUTES, SUPPLEMENTAL_MAX_MINUTES);

  const exerciseIndex = new Map(
    exercises.map(e => [e.id, { equipment: e.equipment, impact_level: e.impact_level }]));

  // The same guardrails the primary cleared, against a snapshot that says how
  // much time is actually left rather than how much the day started with.
  const context: EngineInput = { ...input, available_minutes: minutes };
  const recovery = effectiveRecovery({ ...context, athlete_override: false });

  const scored: { option: SupplementalOption; need: number; liking: number; load: number }[] = [];

  for (const template of templates) {
    if ((template.workout_role ?? 'primary') !== 'supplemental') continue;
    const load = template.supplemental_load as SupplementalLoad | undefined;
    const kind = template.supplemental_type as SupplementalType | undefined;
    // 0013 refuses a supplemental with no type, so one here means the row was
    // written outside the schema. It is skipped rather than guessed at.
    if (!load || !kind) continue;
    if (loadRank(load) > loadRank(maxLoad)) continue;
    if (type && kind !== type) continue;

    if (!checkEligibility(template, context, exerciseIndex, recovery).eligible) continue;

    /**
     * The fullest version that fits, not the shortest one available.
     *
     * `eligibleVariants` has already dropped anything too long for the time or
     * too hard for the recovery, so everything left is allowed — and picking
     * the smallest of those handed an athlete on good recovery with twenty
     * minutes free the two-minute Micro cut of an eight-minute routine. If the
     * work is offered at all, it should be the version worth doing.
     */
    const variant = eligibleVariants(template, context, recovery)
      .sort((a: Variant, b: Variant) =>
        variantMinutes(template, b) - variantMinutes(template, a))[0];
    if (!variant) continue;

    scored.push({
      option: {
        template_id: template.id,
        name: template.name,
        supplemental_type: kind,
        supplemental_load: load,
        variant_code: variant.variant_code,
        minutes: variantMinutes(template, variant),
      },
      need: capabilityNeed(template, context),
      liking: preference(template, context),
      load: loadRank(load),
    });
  }

  /**
   * Need, then liking, then lightest, then id.
   *
   * POLISH (first Phase 6 tuning pass, after the done screen is visible): the
   * last two keys make alphabetical order into accidental product behaviour. An
   * athlete with no capability need and no stated preference falls straight
   * through to load-then-id, and every boxing template is `minimal` and sorts
   * before core, metcon and recovery — so a new athlete sees the same three
   * boxing sessions every day until they take one. Variation does exist after
   * that, because `preference` penalises a template performed in the last seven
   * days and it is the second key. What is missing is day one.
   *
   * The fix is probably type diversity or a deterministic rotation ahead of raw
   * id order, and it is deliberately not being guessed at before anyone has
   * seen the screen. Determinism is not negotiable whatever replaces it: two
   * calls with the same inputs must return the same list.
   */
  scored.sort((a, b) =>
    b.need - a.need
    || b.liking - a.liking
    || a.load - b.load
    || a.option.template_id.localeCompare(b.option.template_id));

  return scored.slice(0, limit).map(s => s.option);
}

/** Whether to offer, and what — the whole decision in one call. */
export function supplementalOffer(args: {
  input: EngineInput;
  templates: WorkoutTemplate[];
  exercises: Exercise[];
  primary: CompletedPrimary | null;
  supplementalTakenToday: boolean;
  minutes?: number;
  type?: SupplementalType;
}): SupplementalOffer {
  const gate = evaluateSupplementalEligibility(args);
  if (!gate.allowed || !gate.max_load) {
    return {
      offered: false, reason_code: gate.reason_code,
      rationale: RATIONALE[gate.reason_code], max_load: null, options: [],
    };
  }

  const options = searchSupplementals({ ...args, maxLoad: gate.max_load });
  if (!options.length) {
    return {
      offered: false, reason_code: 'NO_ELIGIBLE_SUPPLEMENTAL',
      rationale: RATIONALE.NO_ELIGIBLE_SUPPLEMENTAL, max_load: gate.max_load, options: [],
    };
  }
  return {
    offered: true, reason_code: 'OFFERED', rationale: RATIONALE.OFFERED,
    max_load: gate.max_load, options,
  };
}

/**
 * What each answer means, in the product's own voice.
 *
 * Held here rather than composed at the call site so the reason a supplemental
 * was withheld reads the same everywhere it is shown, and so Coach restates it
 * rather than inventing a reason of its own.
 */
const RATIONALE: Record<SupplementalReason, string> = {
  OFFERED: 'Session done. If you have a little left, here is something optional.',
  NO_PRIMARY_COMPLETED: 'Supplemental work is offered after a session, not instead of one.',
  WOULD_CHAIN: 'That was already the extra. One a day.',
  ALREADY_TAKEN_TODAY: 'You have already done today\'s extra.',
  RECOVERY_TOO_LOW: 'Not today. You finished the session, which is the win; '
    + 'adding to it on this recovery would cost you tomorrow.',
  SYMPTOMS_REPORTED: 'Not while you are reporting a symptom.',
  TAPER_WEEK: 'You are tapering. Shedding fatigue is the training right now.',
  PRIMARY_ALREADY_DEMANDING: 'That was a hard session. It is enough for today.',
  NO_ELIGIBLE_SUPPLEMENTAL: 'Nothing optional fits today\'s equipment and time.',
};
