/**
 * The columns `content.exercises` requires that a vocabulary review does not
 * provide.
 *
 * The review sheet describes movements the way a coach thinks about them —
 * family, quality, character, how they progress. The table also demands
 * category, movement_pattern, modality, default_unit, impact_level,
 * hyrox_relevance and postpartum_friendly, none of which anybody wrote down.
 *
 * Two of those are read by the engine and the rest are description, so they are
 * treated differently:
 *
 *   impact_level        drives the low-impact substitution path. Derived from
 *                       the ontology, conservatively: a movement that jumps is
 *                       high whatever else it is.
 *   postpartum_friendly gates content for athletes who set that consideration.
 *                       NOT derived. New exercises land `false`, because the
 *                       column withholds when false and exposes when true, and
 *                       nobody has assessed 180 new movements. A depth jump
 *                       defaulting to safe is the one failure mode here that
 *                       reaches an athlete's body.
 *
 * Everything derived is reported by the writer rather than applied quietly, so
 * a wrong guess is visible as a guess.
 */

/** Families whose defining feature is leaving the ground. */
const AIRBORNE = new Set(['jump_plyometric']);

/**
 * How hard this lands.
 *
 * Read conservatively and in that order: a movement that is airborne or
 * reactive is high impact whatever its family says, because the athlete asking
 * for low impact is asking about their joints, not about taxonomy.
 */
export function impactLevelFor({ movement_families = [], movement_characters = [] }) {
  const fam = new Set(movement_families);
  const chr = new Set(movement_characters);

  if ([...fam].some(f => AIRBORNE.has(f))) return 'high';
  if (chr.has('reactive') || chr.has('ballistic')) return 'high';
  if (chr.has('explosive')) return 'medium';
  if (fam.has('sled_resisted_locomotion') || fam.has('complex_total_body')) return 'medium';
  if (fam.has('ground_get_up')) return 'medium';
  return 'low';
}

/** What a single exposure is counted in. */
export function defaultUnitFor({ progression_tracks = [], movement_families = [] }) {
  const t = new Set(progression_tracks);
  if (movement_families.includes('carry') || movement_families.includes('sled_resisted_locomotion')) {
    return t.has('distance') ? 'm' : 'sec';
  }
  if (t.has('duration') && !t.has('reps')) return 'sec';
  if (t.has('distance') && !t.has('reps')) return 'm';
  return 'reps';
}

/** The coarse grouping the pre-ontology columns used. Kept in step with it. */
export function categoryFor({ methodology_bucket, movement_families = [] }) {
  if (movement_families.includes('accessory_isolation')) return 'accessory';
  if (methodology_bucket === 'athletic_power_plyometric') return 'power';
  if (methodology_bucket === 'complex_specific_novel') return 'conditioning';
  return 'strength';
}

/** The legacy single-value pattern column. The ontology's first family. */
export function movementPatternFor({ movement_families = [] }) {
  return movement_families[0] ?? 'full_body';
}

/** How the work is performed, from the kit it needs. */
export function modalityFor({ equipment = [] }) {
  const eq = new Set(equipment);
  if (eq.has('barbell') || eq.has('trap_bar')) return 'barbell';
  if (eq.has('db')) return 'dumbbell';
  if (eq.has('kb')) return 'kettlebell';
  if (eq.has('cable') || eq.has('machine')) return 'cable';
  if (eq.has('sled')) return 'sled';
  if (eq.has('sandbag')) return 'sandbag';
  if (eq.has('bands')) return 'bands';
  if (!equipment.length || eq.has('bodyweight')) return 'bodyweight';
  return 'mixed';
}

/**
 * Everything the table needs and the review did not say, with a note on how
 * each was arrived at so the writer can report it.
 */
export function deriveExerciseColumns(o) {
  return {
    category: categoryFor(o),
    movement_pattern: movementPatternFor(o),
    modality: modalityFor(o),
    default_unit: defaultUnitFor(o),
    impact_level: impactLevelFor(o),
    // Not read by the engine. Zero states "no assessed HYROX relevance" rather
    // than asserting a number nobody measured.
    hyrox_relevance: 0,
    // See the header. Withholds rather than exposes.
    postpartum_friendly: false,
  };
}
