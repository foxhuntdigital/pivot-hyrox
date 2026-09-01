/**
 * What to do about the load next time — decided, not guessed.
 *
 * Every number this returns is one the athlete has already produced, moved by a
 * step the seeded rules allow. Nothing here invents a weight, and nothing here
 * asks a model to pick one: the LLM layer is given this output and may only
 * restate it (`packages/coach` — the model cannot emit loads or paces itself).
 *
 * ── One dimension per exposure ──────────────────────────────────────────────
 *
 * `content.progression_rules` says it in its own notes column — "Do not raise
 * intensity and volume together", "One variable at a time". A suggestion that
 * moved weight and reps at once would also destroy the next reading: when the
 * following session goes badly there would be no way to say which change did
 * it. So exactly one dimension moves, and which one is decided by the movement
 * rather than by the session.
 *
 * ── Which dimension, and why it is not always load ──────────────────────────
 *
 * The ontology (migration 0014, addendum §3) exists for this decision.
 * `progression_class` says what kind of thing a movement is and
 * `progression_tracks` says how it may be advanced:
 *
 *   anchor / accessory_anchor  stable and measurable — load is the track
 *   developmental              technique-limited — reps and quality, not weight
 *   variable_complex           output work — density and pace, never a heavier bar
 *
 * Last-weight-plus-five applied to everything is wrong for most of the library
 * and dangerous for the plyometric and Olympic-derivative work the addendum
 * adds. A box jump has a progression; it is not a heavier box.
 *
 * ── Never an invented weight ────────────────────────────────────────────────
 *
 * A percentage of a load is a real number and rarely a real weight. 40 kg plus
 * the 5% the rule permits is 42 kg, which is not a jump anyone can make with
 * the plates in the room. So an increment is rounded DOWN to something that
 * exists, and where nothing exists inside the cap the load holds and the reps
 * move instead. That is the same answer a coach gives: add a rep before you add
 * a plate you do not have.
 */
import type { Exposure, ExerciseHistory } from './exercise-history.ts';
import { mostRecentComparable } from './exercise-history.ts';

/**
 * Which rules produced a suggestion. Stored alongside evidence for the same
 * reason `adaptation_events` stores `engine_version`: these rules will change,
 * and a suggestion made under the old ones must stay interpretable rather than
 * silently re-meaning.
 */
export const PROGRESSION_RULES_VERSION = '1.0.0';

/**
 * The smallest real change in load, by unit.
 *
 * A kilo bar takes 1.25 kg plates in pairs; a pound bar takes 2.5 lb plates in
 * pairs. Dumbbells and machine stacks move in larger steps than either, so this
 * is the floor of what might be available rather than a promise it is.
 */
const LOAD_STEP: Record<string, number> = { kg: 2.5, lb: 5 };

export type ProgressionReason =
  /** Nothing comparable to read. The honest answer, and Coach says so. */
  | 'NO_COMPARABLE_HISTORY'
  /** No rule covers this family, so nothing is advanced on a guess. */
  | 'NO_PROGRESSION_RULE'
  /** Everything completed inside the effort ceiling — the one case that advances. */
  | 'PROGRESS_ALL_SETS_BELOW_RPE_CEILING'
  /** Completed, but at or above the target effort. The work got harder; the load stays. */
  | 'HOLD_LOAD_TARGET_RPE_REACHED'
  /** One short session is not a trend. Repeat the prescription before judging it. */
  | 'HOLD_LAST_EXPOSURE_INCOMPLETE'
  /** Missed twice at this load. Backing off is the suggestion. */
  | 'REGRESS_RECENT_REPEATED_FAILURE'
  /**
   * This session is a reduced dose by design, so it holds — a fact about the
   * session, not about the athlete. Completing a maintenance day exactly as
   * written earns no heavier prescription, and says nothing about capability.
   */
  | 'HOLD_MAINTENANCE_SESSION';

/** The axis a suggestion moves. `none` is a real answer, not a failure. */
export type ProgressionDimension = 'load' | 'reps' | 'density' | 'none';

/** A row of `content.progression_rules`, as seeded. */
export interface ProgressionRuleRow {
  id: string;
  workout_family: string;
  metric: string;
  trigger_condition: string;
  action: string;
  max_change_pct: number;
  notes?: string | null;
}

/** The ontology fields migration 0014 added, for one exercise. */
export interface ExerciseOntology {
  progression_class?: string | null;
  progression_tracks?: string[] | null;
}

/** What today's session asks of one movement. */
export interface Prescription {
  exercise_id: string;
  workout_family: string;
  sets: number | null;
  reps_min: number | null;
  reps_max: number | null;
  target_rpe: number | null;
}

export interface ProgressionSuggestion {
  exercise_id: string;
  reason_code: ProgressionReason;
  dimension: ProgressionDimension;
  /** Only ever a load the athlete has produced, moved by an allowed step. */
  suggested_load: number | null;
  load_unit: string | null;
  /** Where rep progression is the track, the reps to aim for. */
  suggested_reps: number | null;
  /** The exposure this was read from — the "last time you did this" line. */
  basis: {
    session_id: string; date: string;
    top_load: number | null; top_reps: number | null; rpe: number | null;
  } | null;
  /** The seeded rule that permitted the change, so a suggestion can cite itself. */
  rule_id: string | null;
  /** Stated whenever the answer is weaker than it looks. */
  caveat: string | null;
  rules_version: string;
}

/**
 * The effort ceiling a set had to stay under to earn more weight.
 *
 * Every seeded strength rule says "all work sets completed at RPE <= 7" and the
 * templates carry the same number as `target_rpe`. The prescription wins where
 * it states one, because a session authored at RPE 6 is a session that was
 * meant to feel like six.
 */
const ceilingFor = (prescription: Prescription, rule: ProgressionRuleRow): number => {
  if (prescription.target_rpe != null) return prescription.target_rpe;
  const stated = rule.trigger_condition.match(/RPE\s*<?=?\s*(\d+)/i);
  return stated ? Number(stated[1]) : 7;
};

/**
 * The dimension this movement advances on.
 *
 * `progression_tracks` is the authored answer and is trusted where it is
 * present; `progression_class` is the guard on it, because a track list that
 * happens to include `load` does not make a variable_complex movement
 * something to add weight to.
 */
export function dimensionFor(ontology: ExerciseOntology | undefined): ProgressionDimension {
  const cls = ontology?.progression_class ?? null;
  const tracks = ontology?.progression_tracks ?? [];

  if (cls === 'variable_complex') {
    // Sleds, thrusters, carries at pace. These progress by output — more work
    // in the same time — and a heavier sled is not the same request.
    return tracks.includes('density') || tracks.includes('work_rest') ? 'density' : 'none';
  }
  if (cls === 'developmental') return 'reps';
  if (cls === 'anchor' || cls === 'accessory_anchor') {
    return tracks.length && !tracks.includes('load') ? 'reps' : 'load';
  }
  // No ontology. Reps is the answer that cannot hurt anyone: it never puts a
  // weight on a movement nobody has classified.
  return 'reps';
}

/**
 * The next load up, or null when no real weight sits inside the cap.
 *
 * Rounded down to a step that exists, so the suggestion is always a jump the
 * athlete can actually make and always within what the rule permits.
 */
export function steppedLoad(
  from: number, unit: string | null, maxChangePct: number, direction: 1 | -1,
): number | null {
  const step = LOAD_STEP[unit ?? ''] ?? null;
  if (step == null || from <= 0) return null;
  const room = from * (maxChangePct / 100);
  const steps = Math.floor(room / step);
  if (steps < 1) return null;
  const next = from + direction * steps * step;
  return next > 0 ? Number(next.toFixed(2)) : null;
}

const hold = (
  prescription: Prescription, reason: ProgressionReason, exposure: Exposure | null,
  rule: ProgressionRuleRow | null, caveat: string | null,
): ProgressionSuggestion => ({
  exercise_id: prescription.exercise_id,
  reason_code: reason,
  dimension: 'none',
  suggested_load: exposure?.top_load ?? null,
  load_unit: exposure?.load_unit ?? null,
  suggested_reps: null,
  basis: exposure ? basisOf(exposure) : null,
  rule_id: rule?.id ?? null,
  caveat,
  rules_version: PROGRESSION_RULES_VERSION,
});

const basisOf = (e: Exposure) => ({
  session_id: e.session_id, date: e.date,
  top_load: e.top_load, top_reps: e.top_reps, rpe: e.rpe,
});

/**
 * What to suggest for one movement in today's session.
 *
 * Reads the most recent comparable exposure, applies the rule that covers the
 * family, and returns a reason code in every branch — including the branches
 * that decline. "I do not have anything comparable to go on" is an answer the
 * product is required to be able to give.
 */
export function progressionFor(args: {
  prescription: Prescription;
  history: ExerciseHistory | undefined;
  ontology?: ExerciseOntology;
  rules: ProgressionRuleRow[];
}): ProgressionSuggestion {
  const { prescription, history, ontology, rules } = args;

  const rule = rules.find(r => r.workout_family === prescription.workout_family) ?? null;
  if (!rule) {
    // A family nobody has written a rule for. Advancing it on the shape of some
    // other family's rule would be inventing the rule, so this holds and says
    // which family is missing one.
    return hold(prescription, 'NO_PROGRESSION_RULE', null, null,
      `No progression rule covers ${prescription.workout_family}.`);
  }

  /**
   * A rule that permits no change is a ruling, not a gap.
   *
   * `content.progression_rules` carries `max_change_pct = 0` for the
   * maintenance families: a poor-recovery session exists to preserve the
   * stimulus, and successfully completing a reduced dose is not a reason to
   * prescribe more next time. This is read before any history, because the
   * answer does not depend on what the athlete lifted.
   */
  if (rule.max_change_pct === 0) {
    const last = mostRecentComparable(history, prescription);
    return hold(prescription, 'HOLD_MAINTENANCE_SESSION', last?.exposure ?? null, rule,
      rule.notes ?? 'A reduced dose by design; it holds.');
  }

  const found = mostRecentComparable(history, prescription);
  if (!found) {
    const skippedAll = (history?.exposures.length ?? 0) > 0;
    return hold(prescription, 'NO_COMPARABLE_HISTORY', null, rule,
      skippedAll
        ? 'Previous sessions on this movement were at a different rep range.'
        : null);
  }

  const { exposure, skipped, skipped_reduced } = found;
  const caveats: string[] = [];
  if (skipped) {
    caveats.push(`${skipped} more recent exposure(s) at a different rep range were passed over.`);
  }
  if (skipped_reduced) {
    caveats.push(`${skipped_reduced} more recent session(s) were a reduced dose and are not a baseline.`);
  }
  if (exposure.excluded_sets) {
    caveats.push(`${exposure.excluded_sets} set(s) that session recorded nothing to read.`);
  }
  const caveat = caveats.length ? caveats.join(' ') : null;

  // Repeated failure first: it is the only branch that overrides effort, and a
  // second miss at the same load is the clearest signal in the whole module.
  const comparablePrior = (history?.exposures ?? [])
    .filter(e => e.session_id !== exposure.session_id && e.context === 'full')
    .find(e => e.top_load != null && exposure.top_load != null && e.top_load >= exposure.top_load);
  if (!exposure.all_sets_completed && comparablePrior && !comparablePrior.all_sets_completed) {
    const dimension = dimensionFor(ontology);
    const down = dimension === 'load' && exposure.top_load != null
      ? steppedLoad(exposure.top_load, exposure.load_unit, rule.max_change_pct, -1)
      : null;
    return {
      exercise_id: prescription.exercise_id,
      reason_code: 'REGRESS_RECENT_REPEATED_FAILURE',
      dimension: down != null ? 'load' : 'none',
      suggested_load: down ?? exposure.top_load,
      load_unit: exposure.load_unit,
      suggested_reps: null,
      basis: basisOf(exposure),
      rule_id: rule.id,
      caveat,
      rules_version: PROGRESSION_RULES_VERSION,
    };
  }

  if (!exposure.all_sets_completed) {
    return hold(prescription, 'HOLD_LAST_EXPOSURE_INCOMPLETE', exposure, rule, caveat);
  }

  const ceiling = ceilingFor(prescription, rule);
  if (exposure.rpe != null && exposure.rpe > ceiling) {
    return hold(prescription, 'HOLD_LOAD_TARGET_RPE_REACHED', exposure, rule, caveat);
  }

  // Everything completed, inside the effort ceiling. This is the one branch
  // that advances, and what it advances is decided by the movement.
  const dimension = dimensionFor(ontology);
  const stepped = dimension === 'load' && exposure.top_load != null
    ? steppedLoad(exposure.top_load, exposure.load_unit, rule.max_change_pct, 1)
    : null;

  if (dimension === 'load' && stepped == null) {
    // Either nothing was loaded, or no plate fits inside the cap. Add a rep
    // before adding a weight that does not exist.
    const target = prescription.reps_max ?? prescription.reps_min;
    return {
      exercise_id: prescription.exercise_id,
      reason_code: 'PROGRESS_ALL_SETS_BELOW_RPE_CEILING',
      dimension: 'reps',
      suggested_load: exposure.top_load,
      load_unit: exposure.load_unit,
      suggested_reps: target != null ? target + 1 : null,
      basis: basisOf(exposure),
      rule_id: rule.id,
      caveat: [caveat, exposure.top_load == null
        ? 'No load was recorded, so the reps move rather than the weight.'
        : 'No available increment sits inside the rule\'s cap, so the reps move first.',
      ].filter(Boolean).join(' '),
      rules_version: PROGRESSION_RULES_VERSION,
    };
  }

  return {
    exercise_id: prescription.exercise_id,
    reason_code: 'PROGRESS_ALL_SETS_BELOW_RPE_CEILING',
    dimension,
    suggested_load: stepped,
    load_unit: exposure.load_unit,
    suggested_reps: dimension === 'reps'
      ? ((prescription.reps_max ?? prescription.reps_min) ?? null) != null
        ? (prescription.reps_max ?? prescription.reps_min)! + 1
        : null
      : null,
    basis: basisOf(exposure),
    rule_id: rule.id,
    caveat,
    rules_version: PROGRESSION_RULES_VERSION,
  };
}
