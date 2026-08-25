/**
 * @pivot/coach — the bounded LLM layer over the deterministic engine.
 *
 * Coach is not the training engine (PRD §9, §13). The engine chooses sessions,
 * this package turns a sentence into structured signals, runs the engine, and
 * turns the result back into coaching language. It cannot mutate anything: a
 * turn returns a *proposed* action and the caller applies it, under the
 * confirmation policy.
 */
export const COACH_VERSION = '0.1.0';

export * from './types.ts';
export * from './generated.ts';
export { route, trimDecision } from './tools.ts';
export { runCoachTurn, classify, CLASSIFIER_MODEL, COMPOSER_MODEL } from './turn.ts';
export { anthropicLlm, type CreateMessage, type AnthropicResponse } from './anthropic.ts';
export {
  narrateProgress, FALLBACK_DETAIL, COMPONENT_KEYS, NARRATOR_MODEL,
  type ComponentKey, type ComponentFacts,
} from './narrate.ts';
