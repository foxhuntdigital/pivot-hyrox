/**
 * One Coach turn: classify → run deterministic tools → compose.
 *
 * This is the whole LLM layer. It is deliberately small, because the interesting
 * decisions were made elsewhere: the engine chose the session, `tools.ts` chose
 * which engine calls answer the question, and the confirmation policy decided
 * what may apply without asking. What is left for the model is understanding the
 * sentence and writing the reply.
 *
 * Both calls put the frozen prompt first so it caches (~2,000 tokens for the
 * composer, ~350 for the classifier) and everything per-request after it. The
 * prefix is identical for every athlete, so under real traffic it stays warm.
 */
import { ENGINE_VERSION } from "../../engine/src/index.ts";

import {
  CLASSIFIER_SYSTEM, COMPOSER_SYSTEM, INTENT_SCHEMA_API, RESPONSE_SCHEMA_API,
  INTENTS, RESPONSE_TYPES, PROMPT_VERSION, SAFETY_VERSION, SCHEMA_VERSION,
} from './generated.ts';
import { route } from './tools.ts';
import type {
  Classification, CoachContext, CoachServices, CoachTurn, ComposedResponse, LlmClient,
} from './types.ts';

export const CLASSIFIER_MODEL = 'claude-haiku-4-5';
export const COMPOSER_MODEL = 'claude-opus-5';

/**
 * Composing 2–5 paragraphs over data the engine already computed is not a
 * reasoning task, and this is a chat surface where latency is the felt cost.
 * Raise it if evals show the reasoning-heavy intents (plan change, race
 * strategy) degrading.
 */
const COMPOSER_EFFORT = 'low' as const;

const zeroUsage = {
  input_tokens: 0, output_tokens: 0,
  cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
};

/** The classification used when the classifier fails, refuses, or returns junk. */
const UNCLASSIFIED: Classification = {
  intent: 'other',
  confidence: 0,
  needs_clarification: true,
  clarifying_question: null,
};

/**
 * Structured outputs cannot express the numeric range on `confidence` or, in
 * every case, hold the model to an enum, so the constraints the wire copy drops
 * are checked here against the schema as authored. An out-of-contract value is
 * treated as no classification at all rather than quietly used.
 */
function isClassification(v: unknown): v is Classification {
  if (!v || typeof v !== 'object') return false;
  const c = v as Classification;
  return (INTENTS as readonly string[]).includes(c.intent)
    && typeof c.confidence === 'number'
    && c.confidence >= 0 && c.confidence <= 1;
}

function isComposed(v: unknown): v is ComposedResponse {
  if (!v || typeof v !== 'object') return false;
  const r = v as ComposedResponse;
  return typeof r.message === 'string'
    && r.message.length > 0
    && (RESPONSE_TYPES as readonly string[]).includes(r.response_type);
}

/**
 * The classifier gets the message and only the state that changes how a
 * sentence should be read — not the whole athlete record.
 */
function classifierContext(context: CoachContext): string {
  return JSON.stringify({
    date_local: context.today.date_local,
    planned_minutes_today: context.today.available_time_minutes,
    reported_energy: context.today.reported_energy,
    phase: context.program?.phase ?? null,
    days_to_race: context.active_race?.days_remaining ?? null,
    athlete_flags: context.athlete.flags ?? [],
  });
}

export async function classify(
  llm: LlmClient,
  message: string,
  context: CoachContext,
): Promise<{ classification: Classification; usage: CoachTurn['usage'] }> {
  const result = await llm.structured({
    model: CLASSIFIER_MODEL,
    system: CLASSIFIER_SYSTEM,
    schema: INTENT_SCHEMA_API,
    maxTokens: 512,
    messages: [{
      role: 'user',
      content: `<athlete_state>${classifierContext(context)}</athlete_state>\n\n${message}`,
    }],
  });

  return {
    classification: isClassification(result.parsed) ? result.parsed : UNCLASSIFIED,
    usage: result.usage,
  };
}

/**
 * What the composer is shown. Order is deliberate: the athlete's own words last,
 * so the reply answers the question rather than the payload.
 */
function composerContent(args: {
  context: CoachContext;
  classification: Classification;
  tools: unknown;
  action: CoachTurn['action'];
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}): string {
  const { context, classification, tools, action, message } = args;
  return [
    `<athlete_context>${JSON.stringify(context)}</athlete_context>`,
    `<interpreted_as>${JSON.stringify({
      intent: classification.intent,
      confidence: classification.confidence,
      entities: classification.entities ?? {},
    })}</interpreted_as>`,
    `<engine_output>${JSON.stringify(tools)}</engine_output>`,
    action
      ? `<available_action>${JSON.stringify({
          action_type: action.action_type,
          requires_confirmation: action.requires_confirmation,
        })}</available_action>\n`
        + (action.requires_confirmation
          ? 'This change is NOT applied. Tell the athlete it needs their confirmation first.'
          : 'This is a today-only change the athlete can apply in one tap.')
      : '<available_action>none</available_action>',
    `<athlete_message>${message}</athlete_message>`,
  ].join('\n\n');
}

export async function runCoachTurn(args: {
  llm: LlmClient;
  services: CoachServices;
  context: CoachContext;
  message: string;
  /** Prior turns of this thread, oldest first. Kept short on purpose. */
  history?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<CoachTurn> {
  const { llm, services, context, message } = args;
  const history = (args.history ?? []).slice(-4);

  const { classification, usage: classifierUsage } = await classify(llm, message, context);
  const { tools, action } = route(classification.intent, classification.entities ?? {}, services);

  const composed = await llm.structured({
    model: COMPOSER_MODEL,
    system: COMPOSER_SYSTEM,
    schema: RESPONSE_SCHEMA_API,
    maxTokens: 2000,
    effort: COMPOSER_EFFORT,
    messages: [
      ...history,
      { role: 'user', content: composerContent({ context, classification, tools, action, message, history }) },
    ],
  });

  const response: ComposedResponse = isComposed(composed.parsed)
    ? composed.parsed
    : {
        response_type: 'clarification',
        message: composed.refusal
          ? "I can't help with that one. Your plan is unchanged — ask me about today's session, "
            + 'your progress, a schedule or equipment change, or a workout you want built.'
          : 'Something went wrong composing that answer. Nothing in your plan changed. '
            + 'Try asking again.',
        confidence: 'low',
      };

  // A symptom report is a safety response whatever the model labelled it, and it
  // carries no action — the athlete decides what to do about pain, not Coach.
  const isSymptom = classification.intent === 'report_pain_or_symptom';
  const finalResponse: ComposedResponse = isSymptom
    ? { ...response, response_type: 'safety' }
    : response;

  return {
    classification,
    response: finalResponse,
    action: isSymptom ? null : action,
    tool_outputs: tools,
    versions: {
      prompt: PROMPT_VERSION,
      safety: SAFETY_VERSION,
      schema: SCHEMA_VERSION,
      engine: ENGINE_VERSION,
      classifier_model: CLASSIFIER_MODEL,
      composer_model: COMPOSER_MODEL,
    },
    usage: {
      input_tokens: classifierUsage.input_tokens + composed.usage.input_tokens,
      output_tokens: classifierUsage.output_tokens + composed.usage.output_tokens,
      cache_read_input_tokens:
        classifierUsage.cache_read_input_tokens + composed.usage.cache_read_input_tokens,
      cache_creation_input_tokens:
        classifierUsage.cache_creation_input_tokens + composed.usage.cache_creation_input_tokens,
    },
  };
}

export { zeroUsage };
