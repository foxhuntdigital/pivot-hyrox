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

export interface Exercise {
  id: string;
  name: string;
  impact_level: ImpactLevel;
  postpartum_friendly: boolean;
  /** Equipment ids that can satisfy this exercise. Empty = needs nothing. */
  equipment: string[];
}

export interface BlockExercise {
  exercise_id: string;
  sequence_order: number;
  prescription_type: 'duration' | 'distance' | 'reps' | 'sets_reps' | 'calories' | 'load';
  quantity: number;
  quantity_unit: string;
  intensity_note?: string | null;
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
  secondary_goal?: string | null;
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
  | 'REENTRY_AFTER_GAP'
  | 'NO_VALID_HARD_SESSION';
