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
  primary_goal: string;
  /**
   * The authored training stimulus, which is finer-grained than the planner's
   * five goals — `lactate_threshold` rather than `threshold`. `primary_goal` is
   * the goal it rolls up to; both are matchable.
   */
  stimulus?: string | null;
  secondary_goal?: string | null;
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

  /** Modality preferences; never override safety (PRD §9.2). */
  preferred_families?: string[];
  /** Families to avoid repeating; drives variation tolerance. */
  variation_tolerance?: number;

  candidates: WorkoutTemplate[];
  substitutions: Substitution[];
}

export interface ScoreBreakdown {
  stimulus_urgency: number;
  recovery_fit: number;
  race_specificity: number;
  progression_continuity: number;
  time_fit: number;
  equipment_fit: number;
  preference: number;
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
