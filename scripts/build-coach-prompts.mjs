/**
 * Emits packages/coach/src/generated.ts from the prompt pack.
 *
 * The `.md` and `.json` files under packages/coach/prompts are the source of
 * truth — they are what content design edits and what the release gate reviews.
 * This inlines them into a module because the Edge Function is bundled from its
 * import graph: a runtime `readTextFile` would deploy fine and then fail in
 * production with no prompt.
 *
 * The generated module also freezes the version strings that every Coach
 * request has to log (PIVOT LLM package README).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../packages/coach/prompts/', import.meta.url);
const read = name => readFileSync(new URL(name, dir), 'utf8').trimEnd();

/**
 * The composer sees the full coaching contract. Order matters: this block is
 * the cached prefix, so it must be byte-stable across every request and every
 * athlete — nothing per-request may be interpolated into it.
 */
const COMPOSER = [
  read('coach.system.v1.md'),
  read('coach.safety.v1.md'),
  read('coach.communication.v1.md'),
  read('coach-confirmation-policy.v1.md'),
].join('\n\n---\n\n');

/**
 * The classifier only extracts structured signals; it never writes prose, so it
 * gets the interpretation and safety-routing rules rather than the whole
 * coaching contract. That is the difference between ~2,300 and ~830 prompt
 * tokens on every message.
 */
const CLASSIFIER = `# PIVOT Coach — Intent Classifier v1.0

You extract structured signals from an athlete's message for PIVOT, an adaptive
training app. You do not coach, explain, or write prose. You return only the
structured intent object.

## Rules
Infer only what is reasonably explicit. "I was up all night and only have 25
minutes" gives available_time_minutes=25 and reported_recovery=poor. It does not
give a sleep duration, an illness, or an injury — never invent health facts.

Symptom language routes to report_pain_or_symptom, always. Pain is never
re-read as low energy, tiredness, or a scheduling problem, and severity is
classified conservatively: when the wording is ambiguous, choose the more severe
option. Requests for medical clearance are also report_pain_or_symptom.

A request that would change more than today — weekly frequency, load, phase
dates, race goal, recurring sessions — is request_plan_change. A question *about*
the week or the plan, including whether to make up or double a missed session, is
ask_plan: asking is not requesting a change.

Equipment or travel context is equipment_change when the athlete is telling you
what they will have; it is adapt_today when they are asking for today to change
for another reason.

Anything about the race itself — division loads, station standards, rules,
pacing, transitions, taper timing, what to expect on the day — is race_strategy,
even when it reads like a question about their own training.

Why today's session is what it is → explain_today. request_workout is for a
*named* piece of work — a modality, a station, a duration, a benchmark. A
request for a session that names only how the athlete feels ("give me the
hardest thing you have", "something easy") is adapt_today: their state decides
the answer, not a search. Are they improving → ask_progress. What their
readiness score means → ask_readiness. Reporting sleep, energy or soreness
without asking for a change → report_recovery.

Set needs_clarification only when you cannot pick an intent without one more
fact from the athlete, and put that single question in clarifying_question.
Prefer a confident intent with entities left null over a clarification.

confidence is your own certainty in the intent label, 0 to 1.`;

/**
 * Structured outputs accept a subset of JSON Schema. Numeric and string
 * constraints (`minimum`, `pattern`, `maxLength`, …) are rejected outright, and
 * every object must refuse unknown keys.
 *
 * Rather than weaken the schemas — the range on `confidence` is part of the
 * contract the release gate reviews — this emits two copies, which is what the
 * SDKs do internally for their own schema types:
 *
 *   *_SCHEMA      the pack as authored, used to validate what comes back
 *   *_SCHEMA_API  the wire copy, with unsupported constraints moved into the
 *                 description so the model still sees the intent of them
 *
 * A constraint dropped here is therefore still enforced — by `turn.ts` against
 * the original, after the response arrives.
 */
const DROPPED = ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'maxItems', 'uniqueItems'];
const FORMATS = ['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid'];

function apiSchema(node) {
  if (Array.isArray(node)) return node.map(apiSchema);
  if (!node || typeof node !== 'object') return node;

  const out = {};
  const notes = [];
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED.includes(key)) {
      notes.push(`${key} ${value}`);
      continue;
    }
    if (key === 'format' && !FORMATS.includes(value)) {
      notes.push(`format ${value}`);
      continue;
    }
    if (key === 'minItems') {
      out[key] = value > 1 ? 1 : value;   // only 0 and 1 are supported
      continue;
    }
    out[key] = apiSchema(value);
  }

  const type = out.type;
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    out.additionalProperties = false;
  }
  if (notes.length) {
    out.description = [out.description, `Constraints: ${notes.join(', ')}.`]
      .filter(Boolean).join(' ');
  }
  return out;
}

/** Guard: the API rejects these at request time, so fail the build instead. */
function assertWireSafe(node, path = '$') {
  if (Array.isArray(node)) return node.forEach((v, i) => assertWireSafe(v, `${path}[${i}]`));
  if (!node || typeof node !== 'object') return;
  for (const key of DROPPED) {
    if (key in node) throw new Error(`${path}: "${key}" is rejected by structured outputs`);
  }
  const type = node.type;
  if ((type === 'object' || (Array.isArray(type) && type.includes('object')))
      && node.additionalProperties !== false) {
    throw new Error(`${path}: object schemas need "additionalProperties": false`);
  }
  for (const [key, value] of Object.entries(node)) assertWireSafe(value, `${path}.${key}`);
}

const intentSchema = JSON.parse(read('coach-intent.schema.json'));
const responseSchema = JSON.parse(read('coach-response.schema.json'));
const intentApi = apiSchema(intentSchema);
const responseApi = apiSchema(responseSchema);
assertWireSafe(intentApi, 'coach-intent.schema.json');
assertWireSafe(responseApi, 'coach-response.schema.json');

const file = `/**
 * GENERATED by scripts/build-coach-prompts.mjs — do not edit.
 * Source: packages/coach/prompts/*. Run \`npm run coach:prompts\` after editing.
 */

/** Logged on every Coach request, with the engine and content versions. */
export const PROMPT_VERSION = '1.0.0';
export const SAFETY_VERSION = '1.0.0';
export const SCHEMA_VERSION = '1.0.1';

/** Cached prefix for the composer call. Byte-stable — never interpolate. */
export const COMPOSER_SYSTEM = ${JSON.stringify(COMPOSER)};

/** Cached prefix for the classifier call. */
export const CLASSIFIER_SYSTEM = ${JSON.stringify(CLASSIFIER)};

/** The pack as authored — what a response is validated against. */
export const INTENT_SCHEMA = ${JSON.stringify(intentSchema, null, 2)} as const;
export const RESPONSE_SCHEMA = ${JSON.stringify(responseSchema, null, 2)} as const;

/** The wire copies: unsupported constraints moved into descriptions. */
export const INTENT_SCHEMA_API = ${JSON.stringify(intentApi, null, 2)} as const;
export const RESPONSE_SCHEMA_API = ${JSON.stringify(responseApi, null, 2)} as const;

/** Enum members, for validating what comes back against the original. */
export const INTENTS = ${JSON.stringify(intentSchema.properties.intent.enum)} as const;
export const RESPONSE_TYPES = ${JSON.stringify(responseSchema.properties.response_type.enum)} as const;
`;

writeFileSync(new URL('../packages/coach/src/generated.ts', import.meta.url), file);

const tokens = n => Math.round(n / 4);
console.log(`composer   ${COMPOSER.length.toString().padStart(6)} chars  ~${tokens(COMPOSER.length)} tokens (cached)`);
console.log(`classifier ${CLASSIFIER.length.toString().padStart(6)} chars  ~${tokens(CLASSIFIER.length)} tokens (cached)`);
console.log('wrote packages/coach/src/generated.ts');
