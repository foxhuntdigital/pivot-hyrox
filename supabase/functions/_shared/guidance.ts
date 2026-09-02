/**
 * What the athlete lifted last time, and what to put on the bar now — shaped
 * for the player.
 *
 * `app/active.tsx` has carried a comment since it was written explaining why it
 * could not show a cross-session prior: "a cross-session comparable needs
 * history the server does not serve yet, and showing a number from a different
 * day as if it were today's would be the fabricated prior the performance rules
 * exist to prevent." The server computes it now. This is the serving.
 *
 * ── Why the server does this and not the client ─────────────────────────────
 *
 * `supplemental.ts` moved into the engine so the app could decide offers
 * locally, because the finish is queued and the server does not yet know the
 * session ended. This is the opposite case. The input here is the athlete's
 * whole logged history, which the client does not hold and should not have to;
 * and a suggestion is advisory rather than the prescription, so it does not
 * need to survive a dropped connection. Where it is absent the player shows
 * nothing, which is exactly what that comment demanded.
 *
 * ── Only movements that prescribe working sets ──────────────────────────────
 *
 * A distance carry and an erg interval have no load to progress, and offering
 * an empty guidance object for them invites the screen to render a blank where
 * a number should be. They are simply absent from the map.
 */
import {
  mostRecentComparable, rangesOverlap, type ExerciseHistory,
} from './exercise-history.ts';
import {
  progressionFor, type ProgressionRuleRow, type ExerciseOntology,
} from './progression.ts';

/** One movement's history and suggestion, as the player renders them. */
export interface ExerciseGuidance {
  exercise_id: string;
  exercise: string;
  /** The most recent comparable exposure, or null when there is none. */
  last: {
    date: string;
    /** Days between that session and today, so the screen can say "8 days ago". */
    days_ago: number;
    load: number | null;
    load_unit: string | null;
    reps: number | null;
    rpe: number | null;
    sets: number;
  } | null;
  /**
   * The best comparable exposure on record, and how many there are.
   *
   * Sent so the completion screen can recognise a record the moment the
   * athlete finishes, without asking a server that does not yet know the
   * session ended — the finish is queued through the outbox. `count` is what
   * makes the recognition safe: a first exposure has nothing to beat, and
   * `prs.ts` refuses one for exactly that reason.
   */
  best: {
    load: number | null;
    load_unit: string | null;
    /** Reps achieved at that best load — what a plateau record has to beat. */
    reps: number | null;
    date: string;
    /** Comparable exposures behind it. Zero means no record is possible. */
    count: number;
  } | null;
  /**
   * What to do about it. Always present, because "I have nothing comparable to
   * go on" is an answer the product is required to be able to give — the reason
   * code carries it.
   */
  suggestion: {
    dimension: 'load' | 'reps' | 'density' | 'none';
    load: number | null;
    load_unit: string | null;
    reps: number | null;
    reason_code: string;
    /**
     * The reason in the product's own voice, not the code.
     *
     * Held here so Coach and the player say the same sentence about the same
     * decision. Without it a suggestion is a spreadsheet that prefilled a
     * number; the reason is what makes it a coach.
     */
    reason: string;
    caveat: string | null;
  };
}

/** One sentence per outcome. Plain, and never congratulatory about a hold. */
const REASON: Record<string, string> = {
  PROGRESS_ALL_SETS_BELOW_RPE_CEILING:
    'Progressed — you completed the target reps inside the target effort.',
  HOLD_LOAD_TARGET_RPE_REACHED:
    'Holding — last time was already at the target effort.',
  HOLD_LAST_EXPOSURE_INCOMPLETE:
    'Holding — last time came up short. Repeat it before judging the load.',
  HOLD_MAINTENANCE_SESSION:
    'Maintenance session. The load holds by design; completing it earns no jump.',
  REGRESS_RECENT_REPEATED_FAILURE:
    'Backing off — the last two attempts at this load came up short.',
  NO_COMPARABLE_HISTORY:
    'No comparable set to go on yet. Pick a weight you can finish cleanly.',
  NO_PROGRESSION_RULE:
    'No progression rule covers this session yet, so the load holds.',
};

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/**
 * Guidance for every movement in one session that prescribes working sets,
 * keyed by exercise id.
 *
 * The prescription comes from the template's own block exercises, so the rep
 * range the history is compared against is the one the athlete is about to
 * perform — comparing against anything else is how a set of five ends up
 * carrying a load earned at ten.
 */
export function guidanceFor(args: {
  today: string;
  template: {
    workout_family: string;
    blocks: { exercises: Record<string, any>[] }[];
  };
  histories: Map<string, ExerciseHistory>;
  rules: ProgressionRuleRow[];
  /** Names and ontology, by exercise id. */
  exercises: Map<string, { name: string } & ExerciseOntology>;
}): Record<string, ExerciseGuidance> {
  const { today, template, histories, rules, exercises } = args;
  const out: Record<string, ExerciseGuidance> = {};

  for (const block of template.blocks ?? []) {
    for (const be of block.exercises ?? []) {
      if (be.sets == null || be.sets <= 0) continue;
      if (out[be.exercise_id]) continue;   // first prescription of it wins

      const prescription = {
        exercise_id: be.exercise_id,
        workout_family: template.workout_family,
        sets: be.sets ?? null,
        reps_min: be.reps_min ?? null,
        reps_max: be.reps_max ?? null,
        target_rpe: be.target_rpe ?? null,
      };

      const history = histories.get(be.exercise_id);
      const found = mostRecentComparable(history, prescription);

      /**
       * The heaviest comparable exposure, not the most recent one.
       *
       * `last` answers "what did I do", and this answers "what is there to
       * beat" — different questions, and a record measured against the most
       * recent set would hand out a PR for repeating a light day.
       */
      const comparable = (history?.exposures ?? [])
        .filter(e => e.context === 'full' && rangesOverlap(e, prescription));
      const loaded = comparable.filter(e => e.top_load != null);
      const bestExposure = loaded.length
        ? loaded.reduce((a, b) => (b.top_load! > a.top_load! ? b : a))
        : null;
      const suggestion = progressionFor({
        prescription,
        history,
        ontology: exercises.get(be.exercise_id),
        rules,
      });

      out[be.exercise_id] = {
        exercise_id: be.exercise_id,
        exercise: exercises.get(be.exercise_id)?.name ?? be.exercise_id,
        last: found ? {
          date: found.exposure.date,
          days_ago: daysBetween(found.exposure.date, today),
          load: found.exposure.top_load,
          load_unit: found.exposure.load_unit,
          reps: found.exposure.top_reps,
          rpe: found.exposure.rpe,
          sets: found.exposure.sets,
        } : null,
        best: bestExposure ? {
          load: bestExposure.top_load,
          load_unit: bestExposure.load_unit,
          reps: bestExposure.top_reps,
          date: bestExposure.date,
          count: comparable.length,
        } : null,
        suggestion: {
          dimension: suggestion.dimension,
          load: suggestion.suggested_load,
          load_unit: suggestion.load_unit,
          reps: suggestion.suggested_reps,
          reason_code: suggestion.reason_code,
          reason: REASON[suggestion.reason_code] ?? 'The load holds.',
          caveat: suggestion.caveat,
        },
      };
    }
  }

  return out;
}
