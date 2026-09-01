/**
 * Personal records, which are only records against something.
 *
 * The rule this module exists to hold: a movement performed for the first time
 * is not a personal best. A novel workout has no history, so every number in it
 * is simultaneously the athlete's best and their worst, and announcing the
 * first one as a PR is the fastest way to make the word mean nothing. Three
 * sessions later, when the real best arrives, it has to compete with a
 * celebration that was never earned.
 *
 * So a record requires a prior comparable exposure to beat, at an overlapping
 * rep range — five reps at 100 kg does not take the record from ten reps at
 * 90 kg, because they were never the same measurement.
 */
import { rangesOverlap, type Exposure, type ExerciseHistory } from './exercise-history.ts';

export interface PersonalRecord {
  exercise_id: string;
  session_id: string;
  date: string;
  /** What moved: a heavier top set, or more reps at a load already held. */
  kind: 'load' | 'reps';
  value: number;
  unit: string | null;
  /** The rep range it was set at — a record is only a record at a rep range. */
  reps_min: number | null;
  reps_max: number | null;
  /** The best before it, so the claim shows its working. */
  previous: number;
  /** Comparable exposures behind the record, including this one. */
  comparable_exposures: number;
}

/**
 * Records set in one session.
 *
 * Reads each movement's own history, which has already excluded everything that
 * was never evidence — so a Complete tap cannot set a personal best.
 */
export function personalRecordsIn(args: {
  sessionId: string;
  histories: Map<string, ExerciseHistory>;
}): PersonalRecord[] {
  const { sessionId, histories } = args;
  const records: PersonalRecord[] = [];

  for (const history of histories.values()) {
    const exposure = history.exposures.find(e => e.session_id === sessionId);
    // A reduced dose is not a record attempt. It is lighter by design, so it
    // will not beat a full session, and a record set inside one would be a
    // record against a different question.
    if (!exposure || exposure.context === 'reduced') continue;

    const prior = history.exposures.filter(e =>
      e.session_id !== sessionId && e.context === 'full'
      && e.date <= exposure.date && rangesOverlap(e, exposure));
    if (!prior.length) continue;   // Nothing to beat. Not a record.

    const record = recordFrom(exposure, prior);
    if (record) records.push({ ...record, comparable_exposures: prior.length + 1 });
  }

  return records.sort((a, b) => a.exercise_id.localeCompare(b.exercise_id));
}

function recordFrom(
  exposure: Exposure, prior: Exposure[],
): Omit<PersonalRecord, 'comparable_exposures'> | null {
  const base = {
    exercise_id: exposure.exercise_id,
    session_id: exposure.session_id,
    date: exposure.date,
    unit: exposure.load_unit,
    reps_min: exposure.reps_min,
    reps_max: exposure.reps_max,
  };

  const loads = prior.map(e => e.top_load).filter((n): n is number => n != null);
  if (exposure.top_load != null && loads.length) {
    const best = Math.max(...loads);
    if (exposure.top_load > best) {
      return { ...base, kind: 'load', value: exposure.top_load, previous: best };
    }
    // A heavier set was not reached. More reps at the same top load still is a
    // record, and it is the one an athlete on a long plateau actually gets.
    if (exposure.top_load === best && exposure.top_reps != null) {
      const repsAtBest = prior
        .filter(e => e.top_load === best)
        .map(e => e.top_reps)
        .filter((n): n is number => n != null);
      const bestReps = repsAtBest.length ? Math.max(...repsAtBest) : null;
      if (bestReps != null && exposure.top_reps > bestReps) {
        return { ...base, kind: 'reps', value: exposure.top_reps, previous: bestReps };
      }
    }
    return null;
  }

  // Unloaded work: the record is total reps, and only against other unloaded
  // exposures. Bodyweight volume and a loaded set are not the same measurement.
  const unloadedPrior = prior.filter(e => e.top_load == null).map(e => e.total_reps);
  if (exposure.top_load == null && unloadedPrior.length) {
    const best = Math.max(...unloadedPrior);
    if (exposure.total_reps > best) {
      return { ...base, kind: 'reps', value: exposure.total_reps, previous: best };
    }
  }
  return null;
}
