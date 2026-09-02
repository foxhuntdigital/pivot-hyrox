/**
 * Deterministic tool routing.
 *
 * The classifier says what the athlete wants; this decides which engine calls
 * answer it and trims the result for the composer. Trimming is not cosmetic —
 * a raw `Recommendation` is ~1,330 tokens because it carries the whole template
 * with every variant and block exercise, against ~285 for the shape below. At
 * 10 messages per athlete per month that difference is a third of the bill, and
 * none of the dropped fields are things the model should be talking about.
 *
 * Nothing here mutates anything. Applying a change is a separate, confirmed
 * call (FR-021) — this layer only ever proposes.
 */
import { VARIANT_LABEL, type EngineDecision, type EngineInput, type Recommendation } from "../../engine/src/index.ts";

import type { CoachAction, CoachEntities, CoachIntent, CoachServices, ToolOutputs } from './types.ts';

/** The ~285-token view of an engine decision. */
export function trimDecision(decision: EngineDecision) {
  if (decision.kind !== 'session') {
    return {
      kind: 'no_session' as const,
      reason_codes: decision.reason_codes,
      rationale: decision.rationale,
      guidance: decision.guidance,
    };
  }
  const r: Recommendation = decision;
  return {
    kind: 'session' as const,
    template: r.template.name,
    variant: VARIANT_LABEL[r.variant.variant_code],
    minutes: r.estimated_minutes,
    primary_stimulus: r.primary_stimulus,
    intensity_target: r.template.intensity_target ?? null,
    volume_multiplier: r.variant.volume_multiplier,
    reason_codes: r.reason_codes,
    rationale: r.rationale,
    blocks: r.blocks.map(b => ({
      title: b.title ?? b.block_type,
      rounds: b.rounds ?? null,
      minutes: b.duration_minutes ?? null,
    })),
    substitutions: r.substitutions_applied,
  };
}

/** Engine overrides implied by the classifier's entities. */
function overridesFrom(entities: CoachEntities, input: EngineInput): Partial<EngineInput> {
  const overrides: Partial<EngineInput> = {};
  if (typeof entities.available_time_minutes === 'number') {
    overrides.available_minutes = entities.available_time_minutes;
  }
  if (entities.energy) overrides.energy = entities.energy;
  if (entities.reported_recovery) overrides.recovery_state = entities.reported_recovery;
  if (entities.low_impact) overrides.low_impact_required = true;

  if (entities.equipment_available?.length) {
    overrides.available_equipment = [...entities.equipment_available, 'bodyweight'];
  } else if (entities.equipment_unavailable?.length) {
    const unavailable = new Set(entities.equipment_unavailable);
    overrides.available_equipment = input.available_equipment.filter(e => !unavailable.has(e));
  }

  // Symptom language never becomes a recovery input. It becomes a symptom flag,
  // which the engine treats as a hard constraint rather than a scoring term.
  if (entities.body_area || entities.symptom_severity) {
    const flag = entities.symptom_severity === 'severe'
      ? `severe pain ${entities.body_area ?? ''}`.trim()
      : `${entities.body_area ?? 'unspecified'} pain`;
    overrides.symptom_flags = [...input.symptom_flags, flag];
  }
  return overrides;
}

/**
 * Actions that may apply without confirmation, from
 * `coach-confirmation-policy.v1.md`. Anything absent requires confirmation.
 */
const ONE_TAP = new Set<CoachAction['action_type']>([
  'adapt_today', 'apply_workout_variant', 'change_equipment_profile',
  'open_workout', 'open_metric_detail',
]);

function propose(
  action_type: CoachAction['action_type'],
  payload: Record<string, unknown>,
  reason_codes: string[] = [],
): CoachAction {
  return {
    action_type,
    status: 'proposed',
    requires_confirmation: !ONE_TAP.has(action_type),
    payload,
    reason_codes,
  };
}

function actionFor(decision: EngineDecision, type: CoachAction['action_type']): CoachAction | null {
  if (decision.kind !== 'session') return null;
  return propose(type, {
    template_id: decision.template.id,
    variant: decision.variant.variant_code,
    minutes: decision.estimated_minutes,
    name: decision.template.name,
  }, decision.reason_codes);
}

export interface Routed {
  tools: ToolOutputs;
  action: CoachAction | null;
}

/**
 * Runs the deterministic services for an intent. Every branch either returns
 * engine output or says plainly that there is none — no branch invents data,
 * which is what lets the composer be told it may not either.
 */
export function route(
  intent: CoachIntent,
  entities: CoachEntities,
  services: CoachServices,
): Routed {
  const overrides = overridesFrom(entities, services.input);

  switch (intent) {
    case 'explain_today': {
      const progression = services.progression();
      return {
        tools: {
          today: trimDecision(services.today),
          weekly_stimuli: services.input.stimulus_requirements,
          ...(progression.length ? {
            progression,
            note: 'Loads are computed from logged history. Restate them and the reason; '
              + 'never adjust one, and never supply a number for a movement not listed.',
          } : {}),
        },
        action: services.today.kind === 'session'
          ? propose('open_workout', { template_id: services.today.template.id })
          : null,
      };
    }

    case 'adapt_today':
    case 'report_recovery': {
      const proposed = services.evaluate(overrides);
      return {
        tools: {
          current: trimDecision(services.today),
          proposed: trimDecision(proposed),
          constraints_applied: overrides,
        },
        action: actionFor(proposed, 'adapt_today'),
      };
    }

    case 'equipment_change': {
      // Salvage today's session first: a substitution that keeps the planned
      // work beats a different session that happens to be eligible.
      const salvaged = services.today.kind === 'session'
        ? services.evaluate({ ...overrides, candidates: [services.today.template] })
        : null;
      const usable = salvaged?.kind === 'session' ? salvaged : services.evaluate(overrides);
      return {
        tools: {
          current: trimDecision(services.today),
          proposed: trimDecision(usable),
          salvaged_original: salvaged?.kind === 'session',
          constraints_applied: overrides,
        },
        action: actionFor(usable, 'change_equipment_profile'),
      };
    }

    case 'request_workout': {
      const terms = [
        ...(entities.requested_modality ?? []),
        ...(entities.requested_station ?? []),
      ].map(t => t.toLowerCase());
      const found = services.search(terms, entities.available_time_minutes ?? undefined);
      return {
        tools: {
          query: terms,
          result: trimDecision(found),
          note: found.kind === 'session'
            ? 'From the curated library. Not applied to today unless the athlete asks.'
            : 'No validated template matches. Do not compose one.',
        },
        action: actionFor(found, 'apply_workout_variant'),
      };
    }

    case 'ask_progress': {
      const trends = services.trends();
      const records = services.records();
      const model = services.athleteModel();
      return {
        tools: {
          ...(trends
            ? { trend: trends }
            : { trend: null, note: 'Not enough comparable sessions. Say so; do not estimate.' }),
          // A record is only a record against a prior comparable exposure, so an
          // empty list means there were none — not that the session went badly.
          ...(records.length ? { records } : {}),
          athlete_model: model,
          model_note:
            'Three separate signals, and they must stay separate. `observed` is what '
            + "performance demonstrated and is PIVOT's determination — explain it, never "
            + 're-derive it from sessions yourself. `believed` is what the athlete said '
            + 'about themselves; it is not evidence and must never be reported as '
            + 'demonstrated. `preferred` is what they enjoy. Where they disagree, say so '
            + 'plainly and attribute each to its source. Where `observed` is empty or low '
            + 'confidence, say the evidence is not there yet rather than confirming what '
            + 'the athlete believes.',
        },
        action: trends ? propose('open_metric_detail', { metric: trends.metric }) : null,
      };
    }

    case 'ask_readiness':
      return {
        tools: {
          readiness: services.readiness,
          note: 'A product score. Never describe it as a percentage recovered or as clinical.',
        },
        action: propose('open_metric_detail', { metric: 'readiness' }),
      };

    case 'ask_plan':
      return {
        tools: {
          week: services.week(),
          weekly_stimuli: services.input.stimulus_requirements,
          phase: { type: services.input.phase_type, days_to_race: services.input.days_to_race },
          note: 'Completion is measured in stimuli, not weekdays. Missed days do not create backlog.',
        },
        action: null,
      };

    case 'request_plan_change': {
      const week = services.week();
      const dropped = [...week].sort((a, b) => b.priority - a.priority)[0] ?? null;
      return {
        tools: {
          current_week: week,
          weekly_stimuli: services.input.stimulus_requirements,
          lowest_priority_session: dropped,
          note: 'A proposal only. It is not applied until the athlete confirms it.',
        },
        // Built here rather than by the model: a weekly change always carries
        // requires_confirmation, whatever the response says.
        action: propose('propose_plan_change', {
          scope: 'this_week',
          current_sessions: week.length,
          candidate_to_drop: dropped,
        }),
      };
    }

    case 'report_pain_or_symptom': {
      // The engine decides whether anything is safe, not the model.
      const constrained = services.evaluate(overrides);
      return {
        tools: {
          engine_result: trimDecision(constrained),
          severity: entities.symptom_severity ?? 'unspecified',
          note: 'Do not diagnose, do not give clearance, do not treat pain as fatigue. '
            + 'Encourage professional evaluation if it persists or worsens.',
        },
        action: null,
      };
    }

    case 'race_strategy': {
      const definition = services.raceDefinition();
      return {
        tools: definition
          ? { race: definition, readiness: services.readiness }
          : { race: null, note: 'No versioned race definition is published. Say you cannot verify '
              + 'loads or standards rather than stating them.' },
        action: null,
      };
    }

    default:
      return {
        tools: { note: 'No tool output. Answer from the context provided, or say what is missing.' },
        action: null,
      };
  }
}
