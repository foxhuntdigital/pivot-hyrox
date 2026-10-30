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
  // Pace discipline and economy are aerobic development. A session that really
  // rehearses race pace should carry hyrox_race_pacing as its stimulus rather
  // than leaning on this one.
  pace_control:               ['aerobic_durability', 'specified'],

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
  // Authored by the strength expansion: a session organised around total-body
  // force production rather than one region. It rolls up to the same planner
  // goal as `strength` — the distinction it draws is about which muscles the
  // session covers, and the planner has never asked that question.
  total_body_strength:        ['strength', 'specified'],
  // The strength library expansion names its stimulus by the movement pattern
  // the session is built around. Every one is resistance work organised around
  // force production, so every one rolls up to the same planner goal — the
  // distinction they draw is which pattern leads, and the planner has never
  // asked that question. Left unmapped they would each become their own
  // `primary_goal`, which is not one of the five and which no planner goal
  // matches: thirty templates the week could never schedule.
  bilateral_squat_strength:     ['strength', 'specified'],
  squat_vertical_strength:      ['strength', 'specified'],
  hinge_strength:               ['strength', 'specified'],
  hinge_horizontal_strength:    ['strength', 'specified'],
  horizontal_push_pull_strength:['strength', 'specified'],
  vertical_push_strength:       ['strength', 'specified'],
  upper_body_strength:          ['strength', 'specified'],
  upper_body_strength_power:    ['strength', 'specified'],
  upper_body_power_strength:    ['strength', 'specified'],
  lower_body_strength:          ['strength', 'specified'],
  lower_body_strength_power:    ['strength', 'specified'],
  lower_body_power_strength:    ['strength', 'specified'],
  total_body_power_strength:    ['strength', 'specified'],
  unilateral_lower_strength:    ['strength', 'specified'],
  unilateral_total_strength:    ['strength', 'specified'],
  unilateral_power_strength:    ['strength', 'specified'],
  loaded_carry_strength:        ['strength', 'specified'],
  // The 48-session strength expansion (data/strength-expansion-48-v1.json)
  // names each session's stimulus for the pattern or tool it is organised
  // around. All are working sets of resistance training, and the pack authored
  // primary_goal strength for every one; the distinction each draws is which
  // pattern leads, which the planner has never asked.
  vertical_pull_strength:             ['strength', 'specified'],
  horizontal_pull_strength:           ['strength', 'specified'],
  vertical_horizontal_pull_strength:  ['strength', 'specified'],
  upper_back_strength:                ['strength', 'specified'],
  dumbbell_pull_strength:             ['strength', 'specified'],
  cable_pull_strength:                ['strength', 'specified'],
  hinge_pull_strength:                ['strength', 'specified'],
  unilateral_pull_strength:           ['strength', 'specified'],
  pull_carry_strength:                ['strength', 'specified'],
  posterior_chain_pull_strength:      ['strength', 'specified'],
  upper_back_hypertrophy_strength:    ['strength', 'specified'],
  pull_arm_strength:                  ['strength', 'specified'],
  explosive_lower_strength:           ['strength', 'specified'],
  lateral_lower_strength:             ['strength', 'specified'],
  hinge_power_strength:               ['strength', 'specified'],
  landing_unilateral_strength:        ['strength', 'specified'],
  upper_push_power_strength:          ['strength', 'specified'],
  upper_pull_power_strength:          ['strength', 'specified'],
  rotational_upper_strength:          ['strength', 'specified'],
  overhead_athletic_strength:         ['strength', 'specified'],
  dumbbell_power_strength:            ['strength', 'specified'],
  kettlebell_power_strength:          ['strength', 'specified'],
  multiplanar_strength:               ['strength', 'specified'],
  offset_lower_strength:              ['strength', 'specified'],
  front_rack_complex_strength:        ['strength', 'specified'],
  integrated_hinge_strength:          ['strength', 'specified'],
  landmine_lower_complex_strength:    ['strength', 'specified'],
  contralateral_upper_strength:       ['strength', 'specified'],
  integrated_press_strength:          ['strength', 'specified'],
  integrated_pull_strength:           ['strength', 'specified'],
  rotational_complex_strength:        ['strength', 'specified'],
  dumbbell_complex_strength:          ['strength', 'specified'],
  sandbag_complex_strength:           ['strength', 'specified'],
  advanced_unilateral_strength:       ['strength', 'specified'],
  landmine_total_strength:            ['strength', 'specified'],
  mixed_lower_strength:               ['strength', 'specified'],
  mixed_unilateral_strength:          ['strength', 'specified'],
  mixed_hinge_power_strength:         ['strength', 'specified'],
  mixed_multiplanar_lower_strength:   ['strength', 'specified'],
  mixed_upper_strength:               ['strength', 'specified'],
  mixed_upper_contralateral_strength: ['strength', 'specified'],
  mixed_overhead_rotational_strength: ['strength', 'specified'],
  mixed_pull_strength:                ['strength', 'specified'],
  mixed_total_power_strength:         ['strength', 'specified'],
  mixed_dumbbell_strength:            ['strength', 'specified'],
  mixed_athletic_total_strength:      ['strength', 'specified'],
  mixed_complex_total_strength:       ['strength', 'specified'],
  // The 24-session muscular endurance expansion rolls up to `threshold`:
  // sustained submaximal output under accumulating fatigue, scored by how long
  // the output holds rather than by the load. The pack authored `strength`;
  // threshold is the programming ruling. The muscular_endurance domain defers
  // to this goal in the engine (GOAL_FROM_TEMPLATE in rank.ts, 2.2.0).
  repeatable_muscular_output:         ['threshold', 'specified'],
  lower_body_fatigue_resistance:      ['threshold', 'specified'],
  upper_body_fatigue_resistance:      ['threshold', 'specified'],
  ballistic_muscular_endurance:       ['threshold', 'specified'],
  bodyweight_muscular_endurance:      ['threshold', 'specified'],
  push_pull_fatigue_resistance:       ['threshold', 'specified'],
  loaded_lower_endurance:             ['threshold', 'specified'],
  full_body_muscular_endurance:       ['threshold', 'specified'],
  descending_rep_endurance:           ['threshold', 'specified'],
  lower_body_volume_tolerance:        ['threshold', 'specified'],
  upper_body_volume_tolerance:        ['threshold', 'specified'],
  kettlebell_muscular_endurance:      ['threshold', 'specified'],
  bodyweight_work_capacity:           ['threshold', 'specified'],
  complex_muscular_endurance:         ['threshold', 'specified'],
  grip_trunk_leg_endurance:           ['threshold', 'specified'],
  benchmark_total_body_endurance:     ['threshold', 'specified'],
  benchmark_loaded_endurance:         ['threshold', 'specified'],
  benchmark_volume_endurance:         ['threshold', 'specified'],
  benchmark_carry_endurance:          ['threshold', 'specified'],
  benchmark_dumbbell_endurance:       ['threshold', 'specified'],
  benchmark_bodyweight_endurance:     ['threshold', 'specified'],
  benchmark_upper_body_endurance:     ['threshold', 'specified'],
  benchmark_power_endurance:          ['threshold', 'specified'],

  // → race_specific
  race_pacing:                ['race_specific', 'specified'],
  hyrox_run_pacing:           ['race_specific', 'specified'],
  compromised_running:        ['race_specific', 'specified'],
  transition_running:         ['race_specific', 'specified'],
  station_durability:         ['race_specific', 'specified'],
  sled_efficiency:            ['race_specific', 'specified'],
  race_specific:              ['race_specific', 'identity'],
  race_pace:                  ['race_specific', 'specified'],
  hyrox_race_pacing:          ['race_specific', 'specified'],
  hyrox_maintenance:          ['race_specific', 'specified'],
  hyrox_capacity:             ['race_specific', 'proposed'],
  race_sharpening:            ['race_specific', 'proposed'],
  repeatable_test:            ['race_specific', 'proposed'],
  run_benchmark:              ['race_specific', 'specified'],
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
  /**
   * Erg intervals are threshold work; a heavy sled or carry is strength. A
   * loaded session in a muscular endurance format (an EMOM, metcon or hero
   * benchmark) is held for time rather than for load, so it is threshold too.
   */
  power_endurance(ctx) {
    if (/^muscular_endurance/.test(ctx.family ?? '')) {
      return ['threshold', 'muscular endurance format: output held for time'];
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Classification (Workstream A)
// ─────────────────────────────────────────────────────────────────────────────
//
// `primary_goal` is the planner's five-name vocabulary. `training_domain` and
// `session_type` are the honest description of what a session *is*, and they
// exist because the five names cannot tell the truth about strength.
//
// Twenty-five templates carry `primary_goal = 'strength'`. Four of them are
// resistance sessions. The other twenty-one are sled pushes, erg intervals,
// hill repeats and carries — real training, correctly authored, wrongly
// filed. The planner asks for strength twice a week and is handed *SkiErg —
// Strength-Power*, and nothing in the data can see the difference.
//
// So the strength domain is decided STRUCTURALLY, not by name. A session is
// strength when it prescribes working sets with deliberate recovery between
// them (`sets` and `rest_seconds`, migration 0011) — the PRD's own definition.
// A name cannot promote a session into it, which is what stops the whole
// reclassification from being satisfied by find-and-replace.
//
// Everything that loses the strength label lands somewhere true rather than
// being demoted: loaded work without working sets is `muscular_endurance`,
// mixed loaded-plus-engine work is `hybrid`. Neither is a lesser session.

/** The physiological domains a session can belong to. */
export const TRAINING_DOMAINS = [
  'strength', 'aerobic', 'threshold', 'speed', 'power',
  'muscular_endurance', 'hybrid', 'skill', 'recovery',
];

/** Structural forms. What the session looks like, as opposed to what it develops. */
export const SESSION_TYPES = [
  'strength', 'strength_endurance', 'run', 'hybrid',
  'conditioning', 'recovery', 'skill', 'benchmark',
];

/** Families that are a test of current form rather than a dose of training. */
const BENCHMARK_FAMILIES = new Set(['benchmark', 'simulation']);

/**
 * How a planner goal reads as a domain when structure does not override it.
 * `strength` is deliberately absent: it is never reached by name.
 */
const DOMAIN_FROM_GOAL = {
  aerobic_durability: 'aerobic',
  threshold: 'threshold',
  race_specific: 'hybrid',
  recovery: 'recovery',
};

/**
 * The domain and structural form of a session.
 *
 * `ctx.hasWorkingSets` is the discriminator for strength and comes from the
 * template's own block exercises, not from any label. `ctx.modalities`,
 * `ctx.family` and `ctx.requiresRunning` describe the session the same way
 * `resolveGoal` uses them.
 *
 * `hasWorkingSets` is `sets != null` — whether the session prescribes working
 * sets at all. It deliberately does NOT also require `rest_seconds`, even
 * though the coverage gate does. The two are asking different questions:
 * classification asks what a session *is*, and a squat session is a strength
 * session whether or not anyone has yet written down how long to rest; the
 * gate asks whether the library is *complete enough to plan from*, and it is
 * not until rest is authored. Folding rest into this test would demote the
 * four genuine strength templates to muscular_endurance over a missing field,
 * and the reclassification would then be wrong in the opposite direction.
 *
 * Returns `{ training_domain, session_type, basis, ambiguous }`. `basis` names
 * the evidence so the classification report can show its working, and
 * `ambiguous` marks a call worth a human look rather than resolving it
 * silently — the PRD asks for exactly that bucket.
 */
export function resolveClassification(primaryGoal, ctx = {}) {
  const {
    hasWorkingSets = false,
    modalities = [],
    family = '',
    requiresRunning = false,
  } = ctx;

  const loaded = modalities.some(m => LOADED_MODALITIES.has(m));
  const engine = modalities.some(m => ENGINE_MODALITIES.has(m));

  // A test, whatever it trains. Classified first because a benchmark that is
  // also loaded is still a benchmark.
  if (BENCHMARK_FAMILIES.has(family)) {
    return {
      training_domain: DOMAIN_FROM_GOAL[primaryGoal] ?? 'hybrid',
      session_type: 'benchmark',
      basis: `${family} is a test of form, not a dose`,
      ambiguous: false,
    };
  }

  if (primaryGoal === 'recovery') {
    return {
      training_domain: 'recovery',
      session_type: 'recovery',
      basis: 'recovery goal',
      ambiguous: false,
    };
  }

  // ── The strength decision ──────────────────────────────────────────────────
  if (hasWorkingSets) {
    return {
      training_domain: 'strength',
      session_type: 'strength',
      basis: 'prescribes working sets with rest between them',
      ambiguous: false,
    };
  }

  // Claimed strength, no working sets. This is the reclassification: the
  // session keeps its real character and loses a label it never earned.
  if (primaryGoal === 'strength') {
    if (loaded && engine) {
      return {
        training_domain: 'hybrid',
        session_type: 'hybrid',
        basis: 'loaded work combined with engine work, and no working sets',
        // Worth a look: some of these are a strength session with a finisher
        // attached, and would be better split than reclassified.
        ambiguous: true,
      };
    }
    if (loaded) {
      return {
        training_domain: 'muscular_endurance',
        session_type: 'strength_endurance',
        basis: 'carries load but prescribes no working sets with rest',
        ambiguous: false,
      };
    }
    // Labelled strength while carrying no load at all — a hill repeat or an
    // erg interval. The label was never describing this session.
    return {
      training_domain: requiresRunning || engine ? 'aerobic' : 'muscular_endurance',
      session_type: 'conditioning',
      basis: 'labelled strength but carries no external load',
      ambiguous: true,
    };
  }

  // Threshold reached through loaded resistance alone — an EMOM, a metcon, a
  // chipper with no erg or run in it. The planner asks for it as threshold, but
  // what the session IS is muscular endurance, and the domain says what it is:
  // filed under `threshold` it would also answer a running-speed deficit
  // (CAPABILITY_TARGETS.running_threshold reads the domain), which a goblet
  // squat EMOM does not address. The engine reads this domain's goal from the
  // template (GOAL_FROM_TEMPLATE in rank.ts), so it is still scheduled as one.
  if (primaryGoal === 'threshold' && loaded && !engine && !requiresRunning) {
    return {
      training_domain: 'muscular_endurance',
      session_type: 'strength_endurance',
      basis: 'threshold through loaded resistance alone, no engine work',
      ambiguous: false,
    };
  }

  // ── Everything else ────────────────────────────────────────────────────────
  const domain = DOMAIN_FROM_GOAL[primaryGoal] ?? 'hybrid';

  const session_type =
    requiresRunning && !loaded ? 'run'
    : loaded && engine ? 'hybrid'
    : loaded ? 'strength_endurance'
    : 'conditioning';

  return {
    training_domain: domain,
    session_type,
    basis: `${primaryGoal} with ${loaded ? 'loaded' : 'unloaded'}`
      + `${engine ? ' engine' : ''} work`,
    ambiguous: false,
  };
}
