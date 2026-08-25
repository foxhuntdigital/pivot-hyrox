/**
 * Coach orchestration types.
 *
 * The shapes here are the contract between the LLM layer and the deterministic
 * one. Two rules are encoded in the types rather than left to convention:
 *
 *   * The model returns prose and evidence labels. It never returns an action.
 *     `CoachTurn.action` is built by code from the engine's output, so a model
 *     that hallucinates a plan change cannot produce one (PRD §13, FR-021).
 *   * Everything a Coach request has to log — prompt, safety, schema, engine
 *     and content versions — is carried on the turn, not left to the caller to
 *     remember (PIVOT LLM package README).
 */
import type { EngineDecision, EngineInput, ReadinessResult } from "../../engine/src/index.ts";

export type CoachIntent =
  | 'explain_today'
  | 'adapt_today'
  | 'request_workout'
  | 'ask_progress'
  | 'ask_readiness'
  | 'ask_plan'
  | 'request_plan_change'
  | 'equipment_change'
  | 'report_recovery'
  | 'report_pain_or_symptom'
  | 'race_strategy'
  | 'general_training_question'
  | 'other';

/** Structured signals the classifier is allowed to extract (§13.1). */
export interface CoachEntities {
  available_time_minutes?: number | null;
  reported_recovery?: 'poor' | 'okay' | 'good' | null;
  energy?: 'low' | 'normal' | 'high' | null;
  low_impact?: boolean | null;
  equipment_unavailable?: string[];
  equipment_available?: string[];
  body_area?: string | null;
  symptom_severity?: 'mild' | 'moderate' | 'severe' | null;
  requested_modality?: string[];
  requested_station?: string[];
}

export interface Classification {
  intent: CoachIntent;
  confidence: number;
  entities?: CoachEntities;
  needs_clarification?: boolean;
  clarifying_question?: string | null;
}

/** The minimal athlete state a Coach turn runs against (coach-context.schema). */
export interface CoachContext {
  request_id: string;
  athlete: {
    athlete_id: string;
    timezone: string;
    units: string;
    experience_level?: string | null;
    flags?: string[];
  };
  active_race: { name: string; date: string; division: string; days_remaining: number | null } | null;
  program: {
    phase: string;
    week: number | null;
    stimuli: { stimulus_type: string; target_exposures: number; completed_exposures: number; priority: number }[];
  } | null;
  today: {
    date_local: string;
    available_time_minutes: number;
    reported_energy: string;
    equipment_count: number;
  };
  /**
   * `overall` is null when nothing has been measured yet — a different
   * statement from a readiness of zero, and one Coach has to be able to make.
   */
  readiness: { overall: number | null; confidence: string; components: Record<string, number> } | null;
  recent_summary: { sessions_7d: number; last_session_days_ago: number | null; last_rpe: number | null } | null;
}

/** What the composer is shown. Trimmed on purpose — see `tools.ts`. */
export interface ToolOutputs {
  [tool: string]: unknown;
}

/**
 * A mutation Coach may carry out, built from engine output. `requires_confirmation`
 * comes from the confirmation policy, never from the model.
 */
export interface CoachAction {
  action_type:
    | 'adapt_today'
    | 'apply_workout_variant'
    | 'change_equipment_profile'
    | 'propose_plan_change'
    | 'open_workout'
    | 'open_metric_detail';
  status: 'proposed';
  requires_confirmation: boolean;
  payload: Record<string, unknown>;
  reason_codes: string[];
}

/** The composer's structured reply (coach-response.schema). */
export interface ComposedResponse {
  response_type:
    | 'answer' | 'explanation' | 'adaptation' | 'trend'
    | 'plan_change_proposal' | 'clarification' | 'safety';
  message: string;
  confidence?: 'low' | 'medium' | 'high';
  evidence?: { label: string; value: string | number; context?: string | null }[];
  warnings?: string[];
}

export interface CoachTurn {
  classification: Classification;
  response: ComposedResponse;
  action: CoachAction | null;
  tool_outputs: ToolOutputs;
  versions: {
    prompt: string;
    safety: string;
    schema: string;
    engine: string;
    classifier_model: string;
    composer_model: string;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

/**
 * The deterministic services the turn is allowed to call. Injected so the Edge
 * Function passes the real ones and the eval runner passes fixtures — the same
 * orchestration code either way.
 */
export interface CoachServices {
  /** Today's decision, already computed. */
  today: EngineDecision;
  /** The engine input today was computed from, for re-evaluation under changes. */
  input: EngineInput;
  /** Re-run the engine with overrides applied. */
  evaluate(overrides: Partial<EngineInput>): EngineDecision;
  /** Search the curated library. Returns engine-eligible templates only. */
  search(terms: string[], minutes?: number): EngineDecision;
  readiness: ReadinessResult;
  /** Comparable-session trends, or null where there is not enough data. */
  trends(): {
    metric: string;
    window_weeks: number;
    direction: 'improving' | 'holding' | 'slowing';
    samples: number;
    from: string;
    to: string;
    confidence: 'low' | 'medium' | 'high';
    caveat: string;
  } | null;
  /** The week as the Plan tab shows it. */
  week(): { day: string; template: string; minutes: number; priority: number; stimulus: string }[];
  /** A versioned race definition, or null when none is published for the race. */
  raceDefinition(): { version: string; division: string; stations: string[] } | null;
}

/** Minimal LLM surface the turn needs, so the package holds no SDK dependency. */
export interface LlmClient {
  structured(args: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    schema: unknown;
    maxTokens: number;
    /** Composer only — Haiku 4.5 rejects effort. */
    effort?: 'low' | 'medium' | 'high';
  }): Promise<{
    parsed: unknown;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
    };
    /** Set when the model declined; the turn degrades rather than throwing. */
    refusal?: string | null;
  }>;
}
