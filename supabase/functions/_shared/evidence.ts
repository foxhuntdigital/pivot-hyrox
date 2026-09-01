/**
 * What performance has shown about a capability — bounded, banded, and never
 * decided by one session.
 *
 * Migration 0013 says the constraint in its own comment and this is the code
 * that honours it: `athlete_capability_evidence` is append-only, one row per
 * completed session that produced a readable signal, and the athlete's current
 * state is *derived* from repeated rows rather than stored. A single
 * exceptional or terrible session writes one low-confidence row and changes
 * nothing on its own.
 *
 * ── Why bands and not numbers ───────────────────────────────────────────────
 *
 * A 5 lb jump on a dumbbell press is not a measurement precise enough to
 * justify a decimal, and storing one invites arithmetic nobody can defend —
 * "your upper body strength is up 3.2%" is a sentence with no evidence behind
 * it. Direction and magnitude band is the most this data can carry honestly.
 *
 * ── Why a change needs repeating ────────────────────────────────────────────
 *
 * Every input here is noisy: sleep, food, whether the athlete had a bad day at
 * work, whether they rounded the weight up because the 22.5s were taken. One
 * exposure moving is inside that noise. Two comparable exposures moving the
 * same way is a signal, and `capabilityState` will not report a change without
 * them — which is what stops the plan chasing a single good Tuesday.
 */
import { HYROX_STATION_EXERCISES } from '../../../packages/engine/src/index.ts';
import { rangesOverlap, type Exposure, type ExerciseHistory } from './exercise-history.ts';

/** Which rules read the evidence. Stored on the row; see 0013's `rules_version`. */
export const EVIDENCE_RULES_VERSION = '1.0.0';

/** At least this many rows pointing the same way before state moves. */
export const REPEATS_FOR_CHANGE = 2;

export type CapabilityKey =
  | 'lower_body_strength' | 'upper_body_strength' | 'running_threshold'
  | 'aerobic_durability' | 'loaded_movement' | 'muscular_endurance'
  | 'station_proficiency';

export type Direction = 'negative' | 'neutral' | 'positive';
export type Band = 'small' | 'moderate' | 'large';
export type Confidence = 'low' | 'medium' | 'high';

/**
 * Which capability a movement speaks to, by the movement family the ontology
 * gives it (migration 0014).
 *
 * Families that are absent are absent on purpose. A box jump is
 * `jump_plyometric` and a heavier box is not the progression, so a jump says
 * nothing this table can read; `running_threshold` and `aerobic_durability`
 * are read from cardio logs, not from sets, and are listed in the schema for
 * the services that will write them.
 */
const CAPABILITY_BY_FAMILY: Record<string, CapabilityKey> = {
  squat: 'lower_body_strength',
  hinge: 'lower_body_strength',
  lunge: 'lower_body_strength',
  horizontal_push: 'upper_body_strength',
  vertical_push: 'upper_body_strength',
  horizontal_pull: 'upper_body_strength',
  vertical_pull: 'upper_body_strength',
  carry: 'loaded_movement',
  sled_resisted_locomotion: 'loaded_movement',
  complex_total_body: 'loaded_movement',
  trunk: 'muscular_endurance',
  rotation: 'muscular_endurance',
  accessory_isolation: 'muscular_endurance',
};

const STATIONS = new Set<string>(HYROX_STATION_EXERCISES);

/** A row as it will be inserted into `athlete_capability_evidence`. */
export interface CapabilityEvidenceRow {
  capability_key: CapabilityKey;
  direction: Direction;
  magnitude_band: Band;
  confidence_band: Confidence;
  source_session_id: string;
  rules_version: string;
  /** Not a column — the movements the row was read from, for the report. */
  read_from: string[];
}

/** What the ontology says about one exercise, for the capability it maps to. */
export interface EvidenceOntology {
  movement_families?: string[] | null;
}

export function capabilityFor(
  exerciseId: string, ontology: EvidenceOntology | undefined,
): CapabilityKey | null {
  // A station is judged as a station first. Progress on the sled is progress at
  // the race, and filing it under lower-body strength would lose that.
  if (STATIONS.has(exerciseId)) return 'station_proficiency';
  for (const family of ontology?.movement_families ?? []) {
    const key = CAPABILITY_BY_FAMILY[family];
    if (key) return key;
  }
  return null;
}

/** How big a move is, as a band. Percentages of a load, never reported as one. */
function bandOf(changePct: number): Band {
  const size = Math.abs(changePct);
  if (size < 3) return 'small';
  if (size < 8) return 'moderate';
  return 'large';
}

/**
 * How much to trust one reading.
 *
 * Low is the default and the common case: two exposures is a comparison, not a
 * measurement. Confidence rises with the number of comparable exposures behind
 * the movement, and falls back to low whenever part of the session recorded
 * nothing — a set that logged nothing could have been the set that went badly.
 */
function confidenceOf(comparableCount: number, exposure: Exposure): Confidence {
  if (exposure.excluded_sets > 0) return 'low';
  if (comparableCount >= 5) return 'high';
  if (comparableCount >= 3) return 'medium';
  return 'low';
}

/**
 * The signal one exposure carries, against the comparable exposure before it.
 *
 * Load is compared only at an overlapping rep range, and reps only at the same
 * load, because those are the two comparisons that mean anything. Where the
 * exposure carries no load at all, reps at an unknown weight are not a
 * capability reading and nothing is written.
 */
function readExposure(
  history: ExerciseHistory, exposure: Exposure,
): { direction: Direction; band: Band; comparable: number } | null {
  /**
   * A reduced dose says nothing about capability, in either direction.
   *
   * A maintenance session is lighter because the session asked for less, so
   * reading it against a full exposure would record a deliberate deload as a
   * loss of strength — and then feed that into the plan, which would reduce the
   * work further. Completing the reduced session exactly as written is a fact
   * about adherence, not about what the athlete can do.
   */
  if (exposure.context === 'reduced') return null;

  const prior = history.exposures
    .filter(e => e.context === 'full' && e.date < exposure.date && rangesOverlap(e, exposure));
  if (!prior.length) return null;   // A first exposure is a baseline, not a result.

  const last = prior[0];
  if (exposure.top_load != null && last.top_load != null && last.top_load > 0) {
    const changePct = ((exposure.top_load - last.top_load) / last.top_load) * 100;
    const direction: Direction = changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'neutral';
    return { direction, band: bandOf(changePct), comparable: prior.length + 1 };
  }
  if (exposure.top_load == null && last.top_load == null && last.total_reps > 0) {
    const changePct = ((exposure.total_reps - last.total_reps) / last.total_reps) * 100;
    const direction: Direction = changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'neutral';
    return { direction, band: bandOf(changePct), comparable: prior.length + 1 };
  }
  // One exposure loaded and the other not is not a comparison.
  return null;
}

/**
 * The evidence one completed session produced — at most one row per capability.
 *
 * A session that trained four lower-body movements has still only shown one
 * thing about lower-body strength, and writing four rows would let a single
 * session outvote a month of them the moment anything counts rows. Where the
 * movements within a capability disagree, the row is neutral: that disagreement
 * is the reading.
 */
export function evidenceFromSession(args: {
  sessionId: string;
  /** The exposures logged in this session, and the history each sits in. */
  exposures: { exposure: Exposure; history: ExerciseHistory }[];
  ontology: Map<string, EvidenceOntology>;
}): CapabilityEvidenceRow[] {
  const { sessionId, exposures, ontology } = args;

  const byCapability = new Map<CapabilityKey, {
    readings: { direction: Direction; band: Band; comparable: number }[];
    read_from: string[];
  }>();

  for (const { exposure, history } of exposures) {
    if (exposure.session_id !== sessionId) continue;
    const key = capabilityFor(exposure.exercise_id, ontology.get(exposure.exercise_id));
    if (!key) continue;
    const reading = readExposure(history, exposure);
    if (!reading) continue;
    const bucket = byCapability.get(key) ?? { readings: [], read_from: [] };
    bucket.readings.push(reading);
    bucket.read_from.push(exposure.exercise_id);
    byCapability.set(key, bucket);
  }

  const rows: CapabilityEvidenceRow[] = [];
  for (const [key, { readings, read_from }] of byCapability) {
    const directions = new Set(readings.map(r => r.direction));
    const direction: Direction = directions.size === 1 ? readings[0].direction : 'neutral';
    // The most cautious band the readings support, so a single large outlier
    // among small moves does not become the session's headline.
    const band: Band = direction === 'neutral' ? 'small'
      : readings.map(r => r.band).sort(byCaution)[0];
    const comparable = Math.min(...readings.map(r => r.comparable));
    const exposure = exposures.find(e => e.exposure.exercise_id === read_from[0])!.exposure;

    rows.push({
      capability_key: key,
      direction,
      magnitude_band: band,
      confidence_band: confidenceOf(comparable, exposure),
      source_session_id: sessionId,
      rules_version: EVIDENCE_RULES_VERSION,
      read_from,
    });
  }
  return rows;
}

const CAUTION: Band[] = ['small', 'moderate', 'large'];
const byCaution = (a: Band, b: Band) => CAUTION.indexOf(a) - CAUTION.indexOf(b);

/** A row as it comes back out of `athlete_capability_evidence`. */
export interface StoredEvidence {
  capability_key: CapabilityKey;
  direction: Direction;
  magnitude_band: Band;
  confidence_band: Confidence;
  created_at: string;
}

export interface CapabilityState {
  capability_key: CapabilityKey;
  /** `neutral` until repeated evidence says otherwise. */
  direction: Direction;
  confidence: Confidence;
  /** Rows behind the answer, so the claim can carry its own sample size. */
  samples: number;
  /** Rows pointing the way the answer points. */
  agreeing: number;
}

/**
 * The athlete's current state for each capability, derived from the log.
 *
 * Nothing moves off one row. A direction is reported only when at least
 * `REPEATS_FOR_CHANGE` of the most recent rows agree, and the confidence
 * reported is the *lowest* of the agreeing rows rather than the best of them —
 * a high-confidence row does not launder the low-confidence one beside it.
 */
export function capabilityState(rows: StoredEvidence[]): CapabilityState[] {
  const byKey = new Map<CapabilityKey, StoredEvidence[]>();
  for (const row of rows) {
    byKey.set(row.capability_key, [...(byKey.get(row.capability_key) ?? []), row]);
  }

  const out: CapabilityState[] = [];
  for (const [key, all] of byKey) {
    const recent = [...all].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const moving = recent.filter(r => r.direction !== 'neutral');
    const agreeing = moving.filter(r => r.direction === moving[0]?.direction);

    if (!moving.length || agreeing.length < REPEATS_FOR_CHANGE) {
      out.push({
        capability_key: key, direction: 'neutral',
        confidence: 'low', samples: all.length, agreeing: agreeing.length,
      });
      continue;
    }
    out.push({
      capability_key: key,
      direction: moving[0].direction,
      confidence: agreeing.map(r => r.confidence_band).sort(byTrust)[0],
      samples: all.length,
      agreeing: agreeing.length,
    });
  }
  return out;
}

const TRUST: Confidence[] = ['low', 'medium', 'high'];
const byTrust = (a: Confidence, b: Confidence) => TRUST.indexOf(a) - TRUST.indexOf(b);
