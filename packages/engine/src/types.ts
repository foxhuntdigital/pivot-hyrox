/**
 * Engine domain types.
 *
 * These mirror the content schema rather than the database rows: the engine is
 * a pure function over an explicit input snapshot (PRD §15 — "Pure
 * deterministic functions where possible; unit-testable fixtures"), so nothing
 * here reaches for a connection.
 */

/** Stored vocabulary. The consumer UI renders these as Full/Express/Micro. */
export type VariantCode = 'green' | 'yellow' | 'red';

/** Consumer-facing labels (PRD §25). Never presented as failure states. */
export const VARIANT_LABEL: Record<VariantCode, string> = {
  green: 'FULL',
  yellow: 'EXPRESS',
  red: 'MICRO',
};

export type RecoveryState = 'good' | 'okay' | 'poor';
export type ImpactLevel = 'low' | 'medium' | 'high';
export type Energy = 'low' | 'normal' | 'high';

/** How a movement is allowed to progress (Strength addendum §11). */
export type ProgressionClass =
  /** Stable and repeatable: the primary home for deterministic overload. */
  | 'anchor'
  /** Technique, complexity or reactivity leads; load follows if at all. */
  | 'developmental'
  /** Density, work:rest and total output rather than a heavier bar. */
  | 'variable_complex'
  /** Progressed like an anchor, but weighted lower in capability inference. */
  | 'accessory_anchor';

export interface Exercise {
  id: string;
  name: string;
  impact_level: ImpactLevel;
  postpartum_friendly: boolean;
  /** Equipment ids that can satisfy this exercise. Empty = needs nothing. */
  equipment: string[];

  /**
   * Ontology (Strength addendum §3). Multi-valued because a Bulgarian split
   * squat is a lunge that is also unilateral and stability-demanding, and
   * trains functional strength and hypertrophy at once — forcing a primary
   * would discard the reason to carry the field.
   *
   * The engine does not rank on these. They exist so the progression service
   * can branch on `progression_class` — load-and-reps is the wrong track for a
   * box jump, a thruster and a sled push, for three different reasons — and so
   * library QA can report anchor and movement-family coverage.
   *
   * `progression_class` is null for movements the strength progression service
   * does not govern: runs, ergs and mobility progress through the running and
   * readiness paths instead. Null means "not ours", which is different from a
   * movement that has no valid progression.
   */
  movement_families?: string[];
  training_qualities?: string[];
  movement_characters?: string[];
  complexity_level?: 'basic' | 'intermediate' | 'advanced' | null;
  exercise_role_eligibility?: string[];
  progression_class?: ProgressionClass | null;
  progression_tracks?: string[];
  /** The variant tree: barbell RDL and dumbbell RDL are one family. */
  exercise_family_id?: string | null;
  /** Loads may only carry forward within this group. Narrower than a family. */
  history_comparability_group?: string | null;
}

export interface BlockExercise {
  exercise_id: string;
  sequence_order: number;
  prescription_type: 'duration' | 'distance' | 'reps' | 'sets_reps' | 'calories' | 'load';
  quantity: number;
  quantity_unit: string;
  intensity_note?: string | null;

  /**
   * Structured strength prescription (migration 0011).
   *
   * `sets` is the discriminator: non-null means this row prescribes working
   * sets, and `buildSteps` expands it into one step per set rather than the
   * single collapsed step `quantity`/`quantity_unit` used to produce. The old
   * encoding put the set count in `quantity` and the rep count in the *unit
   * string* — 4x6 was `quantity: 4, quantity_unit: '6'` — which is why a
   * strength session rendered as "4 6" and logged the set count as reps.
   *
   * Absent on distance, duration and calorie work, which `quantity` and
   * `quantity_unit` describe correctly.
   */
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  /** Rest between working sets. `WorkoutBlock.rest_seconds` is between rounds. */
  rest_seconds?: number | null;
  /** Authored RPE ceiling. Progression is allowed only while observed RPE is under it. */
  target_rpe?: number | null;
  load_basis?: 'absolute' | 'percent_1rm' | 'rpe' | 'bodyweight' | null;
  load_value?: number | null;

  /**
   * The role this movement plays in THIS session (addendum §6).
   *
   * On the prescription rather than the exercise: a goblet squat is a primary
   * lift for a beginner, a primer for a lifter and a finisher at the end of a
   * circuit. `Exercise.exercise_role_eligibility` says which roles the movement
   * can hold; this says which one it holds here.
   */
  exercise_role?:
    | 'primer' | 'power' | 'primary_strength' | 'secondary_strength'
    | 'accessory' | 'trunk_carry' | 'finisher' | null;
}

export interface WorkoutBlock {
  id: string;
  block_order: number;
  block_type: string;
  title?: string | null;
  instructions?: string | null;
  rounds?: number | null;
  duration_minutes?: number | null;
  rest_seconds?: number | null;
  exercises: BlockExercise[];
}

export interface Variant {
  variant_code: VariantCode;
  time_budget_minutes: number;
  recovery_state: RecoveryState;
  volume_multiplier: number;
  intensity_modifier?: string | null;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  workout_family: string;
  /**
   * The planner's goal, or null. Supplemental sessions have none: they are
   * chosen to sit alongside the day's stimulus rather than to carry one, so the
   * seed leaves the column NULL for all 34 of them. Typed non-null, this read
   * as a guarantee the content never made, and `buildRationale` crashed on the
   * first supplemental an athlete tapped. Use `stimulusOf` to render it.
   */
  primary_goal: string | null;
  /**
   * The authored training stimulus, which is finer-grained than the planner's
   * five goals — `lactate_threshold` rather than `threshold`. `primary_goal` is
   * the goal it rolls up to; both are matchable.
   */
  stimulus?: string | null;
  secondary_goal?: string | null;
  /**
   * How much work this session costs to absorb — volume, intensity, and the
   * recovery it demands afterwards (1-4, migration 0023).
   *
   * Null means ungraded, and every rule that reads it treats null as "do not
   * constrain". The library is being graded template by template, so an
   * ungraded one behaves exactly as it does today and starts being matched the
   * moment it is graded rather than on a flag day.
   */
  /**
   * What kind of session this is within its domain (migration 0024) —
   * `foundational`, `athletic`, `complex` or `mixed` for strength today.
   *
   * A rotation and programming axis, never an eligibility gate: it may change
   * which of the eligible templates is chosen and must never change whether one
   * is eligible. `technical_demand` and `load_demand` are the envelope, and
   * archetype cuts across them — complex and mixed carry identical technical
   * spreads — so treating it as difficulty would duplicate the concept and get
   * it wrong.
   *
   * Null means no rotation preference, which is every template written before
   * this existed.
   */
  workout_archetype?: string | null;
  load_demand?: number | null;
  /**
   * How much skill this session assumes (1-4, migration 0023).
   *
   * Separate from `load_demand` because the two fail differently, and matched
   * differently for the same reason: too much load makes an athlete tired, too
   * much technique under fatigue hurts them.
   */
  technical_demand?: number | null;
  /**
   * Physiological domain (migration 0013). Becomes the planner-facing match key
   * once the coverage gate proves there is enough true-strength content to
   * survive the switch; until then `matchesStimulus` still reads `primary_goal`
   * and this is written but unread.
   */
  training_domain?: string | null;
  /** Structural form — `strength` and `strength_endurance` are not the same session. */
  session_type?: string | null;
  /** How the work is performed. An array because a hybrid session is genuinely more than one. */
  modality?: string[];
  workout_role?: 'primary' | 'supplemental';
  supplemental_type?: string | null;
  supplemental_load?: 'minimal' | 'low' | 'moderate' | null;
  estimated_minutes: number;
  intensity_target?: string | null;
  impact_level: ImpactLevel;
  hyrox_specificity: number;
  postpartum_friendly: boolean;
  requires_running: boolean;
  requires_ski: boolean;
  description?: string | null;
  coaching_notes?: string | null;
  tags: string[];
  variants: Variant[];
  blocks: WorkoutBlock[];
}

/** A weekly stimulus the program still needs (PRD §11: stimulus_requirements). */
export interface StimulusRequirement {
  stimulus_type: string;
  target_exposures: number;
  completed_exposures: number;
  /** 1 = highest. */
  priority: number;
}

export interface CompletedSession {
  template_id: string;
  workout_family: string;
  primary_goal: string;
  /** Days before today. 0 = earlier today. */
  days_ago: number;
  impact_level: ImpactLevel;
  session_rpe?: number | null;
}

export interface Substitution {
  exercise_id: string;
  substitute_exercise_id: string;
  reason: string;
  priority: number;
}

/** Everything the engine is allowed to look at. Persisted verbatim on the
 *  adaptation_event so a decision can be replayed (PRD §11.1). */
export interface EngineInput {
  /** ISO date in the athlete's local timezone. */
  local_date: string;
  phase_type: 'foundation' | 'build' | 'specific' | 'peak' | 'taper' | 'race';
  days_to_race: number | null;

  stimulus_requirements: StimulusRequirement[];
  recent_sessions: CompletedSession[];

  recovery_state: RecoveryState;
  energy: Energy;
  /** Hours. Null when the athlete has neither connected health nor checked in. */
  sleep_hours: number | null;

  /** Minutes the athlete says they have. */
  available_minutes: number;
  /** Equipment ids currently available. */
  available_equipment: string[];

  /**
   * How much training this athlete can absorb (1-4), from what they said at
   * onboarding. Null for an athlete who has not answered.
   *
   * Capacity describes the athlete; `load_demand` describes the workout. The
   * pair is the whole of the match, and keeping them named apart is what stops
   * the two collapsing into one "level" that answers neither question — an
   * athlete with eight years under a barbell and no race experience has high
   * capacity for load and low capacity for race-specific skill, and one number
   * cannot say that.
   */
  load_capacity?: number | null;
  /**
   * How complex a movement this athlete can perform well (1-4). Null when
   * unanswered.
   *
   * A broad prior taken from a questionnaire, and explicitly not final truth —
   * which is why it is used to *exclude* rather than to rank. Where it is
   * wrong it is wrong in one direction at a time, and observed performance is
   * meant to refine it later.
   */
  technical_capacity?: number | null;

  low_impact_required: boolean;
  /** Free-text-free flags from the adapt sheet. */
  symptom_flags: string[];
  /**
   * The athlete has explicitly asked for a session their recovery state would
   * otherwise have filtered out, and confirmed it.
   *
   * Set only by a deliberate confirmation, never inferred. It relaxes the rules
   * that encode a judgement about how hard today should be — the intensity
   * ceiling, no-maximal-testing-on-poor-recovery, high-intensity spacing, and
   * the variant's own recovery requirement — because those are coaching advice,
   * and an adult athlete is allowed to overrule advice about their own body.
   *
   * It does NOT relax anything that is not advice. Severe symptoms stop the
   * flow in `recommend` before any of this is read; equipment, impact and
   * postpartum constraints describe what can physically or safely be performed
   * and are unaffected. Overriding is recorded as `ATHLETE_OVERRIDE` on the
   * decision, so a session done this way is replayable as what it was.
   */
  athlete_override?: boolean;
  /** Return-to-training considerations from the athlete profile. */
  considerations: string[];

  /**
   * Kinds of work the athlete likes, from `athlete_preferences`.
   *
   * Matched against a template's family, training domain and planner goal,
   * because the athlete states a preference in whichever of those vocabularies
   * they think in — "I like barbell work" and "I like strength" are the same
   * sentence to them. Never overrides safety (PRD §9.2).
   */
  preferred_families?: string[];
  /**
   * Kinds of work the athlete asked not to be given (`rating = 'rather_not'`).
   *
   * A soft penalty, matched the same way. It is deliberately not a filter: an
   * athlete who dislikes running still has to run for a HYROX, and turning a
   * stated dislike into a hard exclusion would let preference quietly overrule
   * the sport.
   */
  avoided_families?: string[];
  /** Families to avoid repeating; drives variation tolerance. */
  variation_tolerance?: number;
  /**
   * Evidence-backed demand per capability, keyed by `capability_key`, 0..1.
   *
   * Composed server-side from `athlete_capability_evidence`, which only moves
   * on repeated comparable evidence. Additive demand and nothing more: it
   * raises the priority of work that addresses a demonstrated deficit and
   * cannot reach any hard constraint, all of which run before scoring.
   */
  capability_needs?: Record<string, number>;
  /**
   * Capabilities the athlete has SAID need work, from
   * `athlete_perceived_weaknesses`.
   *
   * A third signal, kept apart from the other two on purpose: evidence is what
   * performance demonstrated, this is what the athlete believes, and
   * `preferred_families` is what they want. No magnitude and no confidence — as
   * migration 0013 puts it, a belief has no confidence band, the athlete either
   * said it or did not.
   *
   * It ranks and it never becomes evidence. Nothing here writes
   * `athlete_capability_evidence`, moves a capability band or changes a
   * confidence band, and evidence that disagrees does not suppress it.
   */
  perceived_weaknesses?: string[];

  candidates: WorkoutTemplate[];
  substitutions: Substitution[];
}

export interface ScoreBreakdown {
  stimulus_urgency: number;
  capability_need: number;
  perceived_weakness: number;
  recovery_fit: number;
  race_specificity: number;
  progression_continuity: number;
  time_fit: number;
  equipment_fit: number;
  preference: number;
  /**
   * The load-overreach penalty, 0 or negative. Outside the weighted dimensions
   * above because it is subtracted from the total rather than scaled into it.
   * Zero whenever the template is ungraded or the athlete has not answered.
   */
  load_fit: number;
  total: number;
}

export interface Recommendation {
  template: WorkoutTemplate;
  variant: Variant;
  /** Blocks after variant transformation (PRD §9.3). */
  blocks: WorkoutBlock[];
  estimated_minutes: number;
  primary_stimulus: string;
  score: ScoreBreakdown;
  reason_codes: ReasonCode[];
  rationale: string;
  /** Exercise swaps applied to satisfy equipment/impact constraints. */
  substitutions_applied: { from: string; to: string; reason: string }[];
}

/** Returned instead of a workout when no session is safe or valid (PRD §9.4). */
export interface NoSessionResult {
  kind: 'no_session';
  reason_codes: ReasonCode[];
  rationale: string;
  guidance: string;
}

export type EngineDecision =
  | ({ kind: 'session' } & Recommendation)
  | NoSessionResult;

/** Appendix A. */
export type ReasonCode =
  | 'STIMULUS_DUE'
  | 'RECOVERY_HIGH'
  | 'RECOVERY_NORMAL'
  | 'RECOVERY_LOW'
  | 'TIME_LIMIT'
  | 'EQUIPMENT_MATCH'
  | 'EQUIPMENT_SUBSTITUTION'
  | 'IMPACT_REDUCTION'
  | 'PROGRESSION_CONTINUITY'
  | 'RACE_SPECIFICITY'
  | 'RECENT_LOWER_LOAD'
  | 'TAPER_OVERRIDE'
  | 'ATHLETE_OVERRIDE'
  | 'REENTRY_AFTER_GAP'
  | 'NO_VALID_HARD_SESSION';
