/**
 * Recognising a personal record at the moment the athlete finishes.
 *
 * `_shared/prs.ts` is the authority on what a record is, and this deliberately
 * mirrors its two rules rather than inventing softer ones:
 *
 *   * a heavier top set than the best comparable exposure, at an overlapping
 *     rep range;
 *   * the plateau record — the same top load held for more reps than it has
 *     been held for before.
 *
 * And the rule that matters most: a movement with no prior comparable exposure
 * sets no record. A novel movement's first number is simultaneously the
 * athlete's best and their worst, and announcing it is how the word stops
 * meaning anything three sessions later when the real best arrives.
 *
 * ── Why this is computed here at all ────────────────────────────────────────
 *
 * The finish is queued through the outbox, so when the completion screen
 * renders the server does not yet know the session ended — the same reason the
 * supplemental offer is decided locally. What makes it safe to decide here is
 * that the comparison target arrives from the server: `guidance.best` is the
 * heaviest COMPARABLE exposure, already filtered to an overlapping rep range
 * and to full sessions, with the count of exposures behind it. The client
 * compares; it does not decide what counts as comparable.
 */

/** One working set as the player recorded it. */
export interface LoggedSet {
  exercise_id: string;
  /** Null when the athlete typed no weight — which is not a zero. */
  load: number | null;
  reps: number | null;
}

/** The target to beat, as `_shared/guidance.ts` sends it. */
export interface RecordTarget {
  exercise: string;
  best: {
    load: number | null;
    load_unit: string | null;
    reps: number | null;
    count: number;
  } | null;
}

export interface NewRecord {
  exercise_id: string;
  exercise: string;
  kind: 'load' | 'reps';
  value: number;
  unit: string | null;
  /** What it beat. A record that cannot show its working is a claim. */
  previous: number;
}

/**
 * Records set in this session, one per movement at most.
 *
 * The heaviest set the athlete logged is what competes: a session's best
 * effort is its best set, not its last.
 */
export function recordsIn(
  sets: LoggedSet[],
  targets: Record<string, RecordTarget | undefined>,
): NewRecord[] {
  const byExercise = new Map<string, LoggedSet[]>();
  for (const s of sets) {
    if (!s.exercise_id) continue;
    byExercise.set(s.exercise_id, [...(byExercise.get(s.exercise_id) ?? []), s]);
  }

  const out: NewRecord[] = [];
  for (const [exercise_id, logged] of byExercise) {
    const target = targets[exercise_id];
    const best = target?.best;
    // No comparable history is not a record, however good the number.
    if (!best || !best.count || best.load == null) continue;

    const loaded = logged.filter(s => s.load != null && s.load > 0);
    if (!loaded.length) continue;
    const top = loaded.reduce((a, b) => (b.load! > a.load! ? b : a));

    if (top.load! > best.load) {
      out.push({
        exercise_id, exercise: target!.exercise, kind: 'load',
        value: top.load!, unit: best.load_unit, previous: best.load,
      });
      continue;
    }

    // Same weight, more reps. The record an athlete on a long plateau actually
    // gets, and the one a load-only rule would never award.
    if (top.load === best.load && top.reps != null && best.reps != null
        && top.reps > best.reps) {
      out.push({
        exercise_id, exercise: target!.exercise, kind: 'reps',
        value: top.reps, unit: null, previous: best.reps,
      });
    }
  }

  return out.sort((a, b) => a.exercise.localeCompare(b.exercise));
}
