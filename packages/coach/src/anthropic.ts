/**
 * The Anthropic adapter.
 *
 * It takes an already-constructed SDK client rather than importing the SDK,
 * because this file runs under two runtimes: Node (the eval runner, via
 * node_modules) and Deno (the Edge Function, via `npm:@anthropic-ai/sdk`).
 * There is no bare specifier both resolve without an import map, and an import
 * map that is wrong deploys cleanly and fails in production. Structural typing
 * costs a little type safety at this one boundary and removes that failure mode
 * — every caller constructs its own client and passes it in.
 *
 * Two things here are load-bearing:
 *
 *   * `cache_control` sits on the system block, which is the frozen prompt. The
 *     prefix is byte-identical for every athlete and every request, so it stays
 *     warm across users, not just within one conversation. Verify with
 *     `cache_read_input_tokens` — if it is 0 across repeated calls, something
 *     per-request has leaked into the prefix.
 *   * Structured output is given the JSON Schema from the prompt pack directly,
 *     so the schema the release gate reviews is the schema the model is held to.
 *     No second copy in Zod to drift.
 */
import type { LlmClient } from './types.ts';

/**
 * What this adapter needs: a way to create one message. Deliberately a function
 * rather than a client object — the SDK's `messages.create` is overloaded and
 * requires specific parameter types, so a structural interface claiming to
 * accept `Record<string, unknown>` is not something the real client satisfies.
 * Each runtime passes a one-line lambda with its own SDK types in scope, which
 * is where the cast belongs.
 */
export type CreateMessage = (params: Record<string, unknown>) => Promise<AnthropicResponse>;

export interface AnthropicResponse {
  content: { type: string; text?: string }[];
  stop_reason?: string | null;
  stop_details?: { explanation?: string | null } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * A model occasionally double-escapes a unicode sequence inside JSON output, so
 * what survives `JSON.parse` is a literal `\u2014` in the middle of a sentence.
 * It is rare and it is visible, so string values are normalised on the way out.
 * Coaching prose never legitimately contains that sequence.
 */
function unescapeStrays<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\\u([0-9a-fA-F]{4})/g,
      (_, hex) => String.fromCharCode(parseInt(hex, 16))) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(unescapeStrays) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, unescapeStrays(v)])) as T;
  }
  return value;
}

export function anthropicLlm(createMessage: CreateMessage): LlmClient {
  return {
    async structured({ model, system, messages, schema, maxTokens, effort }) {
      const response = await createMessage({
        model,
        max_tokens: maxTokens,
        // The frozen prompt, cached. Nothing per-request may be appended here.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: {
          format: { type: 'json_schema', schema },
          ...(effort ? { effort } : {}),
        },
      });

      const usage = {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        cache_read_input_tokens: response.usage?.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage?.cache_creation_input_tokens ?? 0,
      };

      // A declined request is a product state, not an exception: the caller
      // degrades to a safe reply rather than showing the athlete an error.
      if (response.stop_reason === 'refusal') {
        return { parsed: null, usage, refusal: response.stop_details?.explanation ?? 'refused' };
      }

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('');

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;   // schema-constrained output should not land here
      }
      return { parsed: unescapeStrays(parsed), usage, refusal: null };
    },
  };
}
