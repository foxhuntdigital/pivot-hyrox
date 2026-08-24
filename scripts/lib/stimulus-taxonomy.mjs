/**
 * The two-level training taxonomy.
 *
 * `content.workout_templates.primary_goal` is what the planner asks for, and it
 * only ever emits five names (see BASE_STIMULI in periodization.ts). The content
 * packs speak a much richer vocabulary — 51 distinct strings across the library,
 * the RowErg expansion, the station matrix and the running expansion.
 *
 * Rather than discard that detail, a template carries both: `stimulus` holds the
 * authored value, `primary_goal` holds the planner-facing goal it rolls up to.
 * The richer value is deliberately NOT called `secondary_goal` — these are not a
 * lower-priority second objective, they are the specific name for the same one.
 *
 * Several stimuli genuinely resolve differently depending on the session, so
 * resolution takes context rather than being a flat string map. `power_endurance`
 * on a RowErg interval is threshold work; on a heavy sled it is strength.
 */

/** The only goals the planner ever requests. */
export const PLANNER_GOALS = ['aerobic_durability', 'threshold', 'strength', 'race_specific', 'recovery'];

/**
 * Unambiguous roll-ups. `source: 'specified'` entries were given directly; the
 * rest are proposed and reported by the importer so they can be reviewed
 * rather than silently trusted.
 */
const DIRECT = {
  // → aerobic_durability
  aerobic_base:               ['aerobic_durability', 'specified'],
  aerobic_capacity:           ['aerobic_durability', 'specified'],
  aerobic_durability:         ['aerobic_durability', 'specified'],
  running_economy:            ['aerobic_durability', 'specified'],
  impact_tolerance:           ['aerobic_durability', 'specified'],
  aerobic_maintenance:        ['aerobic_durability', 'specified'],
  aerobic_local_durability:   ['aerobic_durability', 'proposed'],
  repeated_submax_durability: ['aerobic_durability', 'proposed'],
  return_to_run:              ['aerobic_durability', 'proposed'],
  skill_economy:              ['aerobic_durability', 'proposed'],

  // → threshold
  tempo_endurance:            ['threshold', 'specified'],
  lactate_threshold:          ['threshold', 'specified'],
  speed_endurance:            ['threshold', 'specified'],
  threshold:                  ['threshold', 'identity'],
  sustainable_high_output:    ['threshold', 'proposed'],

  // → strength
  force_power_reserve:        ['strength', 'specified'],
  strength_endurance:         ['strength', 'specified'],
  strength:                   ['strength', 'identity'],
  strength_maintenance:       ['strength', 'specified'],
  grip_posterior:             ['strength', 'proposed'],

  // → race_specific
  race_pacing:                ['race_specific', 'specified'],
  hyrox_run_pacing:           ['race_specific', 'specified'],
  compromised_running:        ['race_specific', 'specified'],
  transition_running:         ['race_specific', 'specified'],
  station_durability:         ['race_specific', 'specified'],
  sled_efficiency:            ['race_specific', 'specified'],
  race_specific:              ['race_specific', 'identity'],
  race_pace:                  ['race_specific', 'specified'],
  hyrox_race_pacing:          ['race_specific', 'proposed'],
  hyrox_maintenance:          ['race_specific', 'specified'],
  hyrox_capacity:             ['race_specific', 'proposed'],
  race_sharpening:            ['race_specific', 'proposed'],
  pace_control:               ['race_specific', 'proposed'],
  repeatable_test:            ['race_specific', 'proposed'],
  run_benchmark:              ['race_specific', 'proposed'],
  work_density:               ['race_specific', 'specified'],
  complementary_hybrid:       ['race_specific', 'proposed'],
  run_station_hybrid:         ['race_specific', 'proposed'],
  compromised_station_work:   ['race_specific', 'proposed'],
  transition_efficiency:      ['race_specific', 'proposed'],
  pacing:                     ['race_specific', 'proposed'],
  sled_lunge:                 ['race_specific', 'proposed'],
  wall_ball:                  ['race_specific', 'proposed'],

  // → recovery
  active_recovery:            ['recovery', 'specified'],
  recovery:                   ['recovery', 'identity'],
};

/**
 * Values that describe the *dose* of a session, not its physiological goal.
 *
 * `minimum_effective_dose` is what a Micro variant is, not what it trains: a
 * Micro threshold session is still threshold work, a Micro aerobic session is
 * still aerobic durability. Mapping it globally to one goal would mislabel
 * every session that used it. So it resolves from the session's own evidence,
 * and `needsDeclaredStimulus` marks the template as wanting a real stimulus
 * declared in its pack rather than leaning on this fallback forever.
 */
export const DOSE_DESCRIPTORS = new Set(['minimum_effective_dose']);

export const isDoseDescriptor = s => DOSE_DESCRIPTORS.has(s);

/** Exercises whose modality makes a session a loaded-strength effort. */
const LOADED_MODALITIES = new Set(['strength', 'strength_endurance', 'power']);

/** Erg and locomotion modalities — the engine-work end of the spectrum. */
const ENGINE_MODALITIES = new Set(['running', 'row', 'ski', 'bike']);

/**
 * Stimuli that resolve on the session rather than the name.
 *
 * Each returns [goal, basis]. `basis` names the evidence so the importer can
 * report how each call was made instead of asserting a bare answer.
 */
const CONTEXTUAL = {
  /** Erg intervals are threshold work; a heavy sled or carry is strength. */
  power_endurance(ctx) {
    if (ctx.modalities.some(m => LOADED_MODALITIES.has(m)) && !ctx.modalities.some(m => ENGINE_MODALITIES.has(m))) {
      return ['strength', 'loaded modality, no engine work'];
    }
    return ['threshold', 'erg/locomotion modality'];
  },

  /** Loaded aerobic work is strength-led; unloaded is durability. */
  aerobic_strength(ctx) {
    return ctx.modalities.some(m => LOADED_MODALITIES.has(m))
      ? ['strength', 'carries an external load']
      : ['aerobic_durability', 'unloaded engine work'];
  },

  /**
   * Efficiency work is usually race-specific, but a technique or base session
   * is building the pattern rather than rehearsing the race.
   */
  row_efficiency: efficiency,
  ski_efficiency: efficiency,
};

function efficiency(ctx) {
  if (/technique|skill|base/i.test(`${ctx.category ?? ''} ${ctx.family ?? ''}`)) {
    return ['aerobic_durability', 'technique/base session'];
  }
  return ['race_specific', 'default for efficiency work'];
}

/**
 * Rolls an authored stimulus up to the planner goal it serves.
 *
 * `ctx.modalities` are the modalities of the session's exercises; `ctx.family`
 * and `ctx.category` are the pack's own labels. Returns null for an unknown
 * stimulus rather than guessing — the caller decides whether that is fatal.
 */
export function resolveGoal(stimulus, ctx = {}) {
  const context = { modalities: [], exercises: [], ...ctx };

  if (DOSE_DESCRIPTORS.has(stimulus)) {
    const [goal, basis] = underlyingGoal(context);
    return {
      stimulus, primary_goal: goal, confidence: 'dose-descriptor',
      basis: `dose, not a goal — inherited from the session (${basis})`,
      needsDeclaredStimulus: true,
    };
  }
  if (CONTEXTUAL[stimulus]) {
    const [goal, basis] = CONTEXTUAL[stimulus](context);
    return { stimulus, primary_goal: goal, confidence: 'contextual', basis };
  }
  const direct = DIRECT[stimulus];
  if (!direct) return null;
  const [goal, confidence] = direct;
  return { stimulus, primary_goal: goal, confidence, basis: `${confidence} mapping` };
}

/**
 * What a session trains, read off the session itself. Used only when the
 * authored label describes the dose instead of the goal.
 *
 * Order matters: intensity is the strongest signal, then whether the work is
 * loaded, then whether it rehearses several race stations at once.
 */
function underlyingGoal(ctx) {
  const peak = Math.max(0, ...String(ctx.intensityTarget ?? '').match(/\d+/g)?.map(Number) ?? [0]);
  if (peak >= 7) return ['threshold', `intensity target peaks at RPE ${peak}`];

  const loaded = ctx.modalities.some(m => LOADED_MODALITIES.has(m));
  const engine = ctx.modalities.some(m => ENGINE_MODALITIES.has(m));
  if (loaded && !engine) return ['strength', 'loaded work only, no engine component'];

  const stations = ctx.exercises.filter(e => HYROX_STATIONS.has(e)).length;
  if (stations >= 2) return ['race_specific', `${stations} race stations in one session`];

  return ['aerobic_durability', 'unloaded engine work at sub-threshold intensity'];
}

/** The eight HYROX stations, for spotting race rehearsal. */
const HYROX_STATIONS = new Set([
  'ex_skierg', 'ex_sled_push', 'ex_sled_pull', 'ex_burpee_broad_jump',
  'ex_rowerg', 'ex_farmer_carry', 'ex_sandbag_walking_lunge', 'ex_wall_ball',
]);

/** Every stimulus the taxonomy knows, for coverage checks. */
export function knownStimuli() {
  return [...Object.keys(DIRECT), ...Object.keys(CONTEXTUAL), ...DOSE_DESCRIPTORS].sort();
}
