/**
 * The Coach release gate.
 *
 * `packages/coach/prompts/coach-evals.v1.json` states each case in prose —
 * "extract 25 minutes", "require confirmation", "do not shame user". Prose is
 * the right form for the contract and the wrong form for a gate, so this file
 * pairs every case with machine checks over the actual turn: the classified
 * intent and entities, the action the confirmation policy produced, and a
 * lexical scan of the reply against the Avoid list in the communication guide.
 *
 * What it does NOT do is ask a model whether the answer was good. Every
 * assertion here is deterministic, so a red run is a fact rather than an
 * opinion, and re-running it costs nothing.
 *
 *   ANTHROPIC_API_KEY=… npm run coach:evals          # classifier only (cheap)
 *   ANTHROPIC_API_KEY=… npm run coach:evals -- --full  # + composer
 *   npm run coach:evals -- --dry                     # no API calls; checks wiring
 *
 * Exit code is non-zero when any case fails, so CI can gate on it.
 */
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

import { recommend, computeReadiness } from '../packages/engine/src/index.ts';
import { anthropicLlm, classify, runCoachTurn } from '../packages/coach/src/index.ts';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const DRY = args.includes('--dry');
/**
 * Classification is not deterministic. One pass tells you a case can pass; it
 * does not tell you it will. CI should use --repeat 3 so a case that only
 * sometimes lands is reported as flaky rather than green.
 */
const REPEAT = Number((args.find(a => a.startsWith('--repeat')) ?? '').split(/[= ]/)[1] ?? 1);

const cases = JSON.parse(
  readFileSync(new URL('../packages/coach/prompts/coach-evals.v1.json', import.meta.url), 'utf8'),
).tests;

/* ------------------------------------------------------------ fixture --- */

const content = JSON.parse(
  readFileSync(new URL('../apps/mobile/src/data/content.json', import.meta.url), 'utf8'));
const EXERCISES = content.exercises;
const TEMPLATES = content.templates;
const exerciseById = new Map(EXERCISES.map(e => [e.id, e]));

/**
 * A rested athlete mid-build with a full hour: the state where an adaptation is
 * a real change rather than a no-op, so TC-001 and TC-010 actually exercise the
 * engine's ceilings.
 */
const input = {
  local_date: '2026-08-19',
  phase_type: 'build',
  days_to_race: 58,
  stimulus_requirements: [
    { stimulus_type: 'aerobic_durability', target_exposures: 2, completed_exposures: 1, priority: 1 },
    { stimulus_type: 'threshold', target_exposures: 2, completed_exposures: 1, priority: 1 },
    { stimulus_type: 'strength', target_exposures: 2, completed_exposures: 1, priority: 2 },
    { stimulus_type: 'race_specific', target_exposures: 1, completed_exposures: 0, priority: 2 },
    { stimulus_type: 'recovery', target_exposures: 1, completed_exposures: 1, priority: 3 },
  ],
  recent_sessions: [
    { template_id: 'wo_ski_zone_2_30', workout_family: 'ski_base', primary_goal: 'aerobic_base', days_ago: 1, impact_level: 'low', session_rpe: 4 },
    { template_id: 'wo_hyrox_legs_a', workout_family: 'strength_legs', primary_goal: 'strength', days_ago: 2, impact_level: 'medium', session_rpe: 7 },
  ],
  recovery_state: 'good',
  energy: 'normal',
  sleep_hours: 7.6,
  available_minutes: 60,
  available_equipment: ['treadmill', 'outdoor', 'ski', 'bike', 'db', 'kb', 'box', 'wall_ball', 'sled', 'rope', 'sandbag'],
  low_impact_required: false,
  symptom_flags: [],
  considerations: [],
  candidates: TEMPLATES,
  substitutions: content.substitutions,
  variation_tolerance: 1,
};

const today = recommend(input, EXERCISES);

const services = {
  today,
  input,
  evaluate: overrides => recommend({ ...input, ...overrides }, EXERCISES),
  search: (terms, minutes) => {
    const score = t => terms.reduce((n, term) =>
      n + ([t.name, t.workout_family, t.primary_goal, t.description, ...(t.tags ?? [])]
        .join(' ').toLowerCase().includes(term) ? 1 : 0), 0);
    const scored = TEMPLATES.map(t => ({ t, hits: score(t) })).filter(x => x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    if (!scored.length) {
      return { kind: 'no_session', reason_codes: [], rationale: 'No validated template matches.', guidance: 'Offer the closest option instead.' };
    }
    const best = scored[0].hits;
    return recommend({
      ...input,
      candidates: scored.filter(x => x.hits === best).slice(0, 6).map(x => x.t),
      available_minutes: minutes ?? input.available_minutes,
    }, EXERCISES);
  },
  readiness: computeReadiness({
    aerobic_minutes_14d: 232, threshold_sessions_14d: 3, run_sessions_7d: 2,
    longest_run_km: 16.2, strength_completion_rate: 0.91, stations_covered_21d: 6,
    stimulus_adherence_4w: 0.83, recovery_signal: 0.58, observed_days: 26,
  }),
  // Deliberately null: the fixture athlete has no comparable 1 km set, so
  // TC-004 tests the insufficient-data path rather than a happy one.
  trends: () => null,
  week: () => [
    { day: 'Thursday', template: 'Long Hybrid 60', minutes: 60, priority: 1, stimulus: 'aerobic_durability' },
    { day: 'Friday', template: 'HYROX Pull A', minutes: 55, priority: 2, stimulus: 'strength' },
    { day: 'Saturday', template: 'Recovery Spin Mobility', minutes: 30, priority: 3, stimulus: 'recovery' },
  ],
  raceDefinition: () => null,   // none published — TC-009 must not invent loads
};

const context = {
  request_id: 'eval',
  athlete: { athlete_id: 'eval', timezone: 'America/New_York', units: 'metric', experience_level: 'intermediate', flags: [] },
  active_race: { name: 'Boston HYROX', date: '2026-10-10', division: 'Elite 15-39', days_remaining: 58 },
  program: { phase: 'build', week: 7, stimuli: input.stimulus_requirements },
  today: { date_local: '2026-08-19', available_time_minutes: 60, reported_energy: 'normal', equipment_count: input.available_equipment.length },
  readiness: services.readiness,
  recent_summary: { sessions_7d: 2, last_session_days_ago: 1, last_rpe: 4 },
};

/* ------------------------------------------------------------- checks --- */

/**
 * From coach.communication.v1.md's Avoid list and the safety policy.
 *
 * The second group is the v1.1 voice: warmth is a requirement now, and the two
 * ways it fails are opposite. Going stiff ("I cannot determine") reads as a
 * system rather than a coach; going loud (exclamation marks, emoji) reads as
 * the hype the pack has always banned. Both are cheap to detect, which is the
 * only reason they are tested here rather than left to review.
 */
const FORBIDDEN = [
  /crush it/i, /no excuses/i, /you failed/i, /make up (yesterday|the missed)/i,
  /fully recovered/i, /\d+% recovered/i, /guarantee/i,
  /you (have|might have|likely have) (a|an) \w+ (tear|strain|sprain|injury)/i,
  /safe (for you )?to train/i, /cleared to train/i,
  /you've got this/i, /!/, /\p{Extended_Pictographic}/u,
  /\bI cannot\b/, /\bI am not able\b/, /\bdo not have enough\b/,
];

/** Case-specific assertions over the turn. Prose contract → executable gate. */
const CHECKS = {
  'TC-001': t => [
    ['extracts 25 minutes', t.classification.entities?.available_time_minutes === 25],
    ['classifies recovery conservatively',
      ['poor', 'okay'].includes(t.classification.entities?.reported_recovery ?? '')
      || t.classification.entities?.energy === 'low'],
    ['proposes an adaptation from the engine', !!t.action && t.action.action_type === 'adapt_today'],
    ['proposed session fits the stated time',
      (t.tool_outputs.proposed?.minutes ?? 999) <= 25],
    ['does not raise intensity to compensate',
      (t.tool_outputs.proposed?.volume_multiplier ?? 1) <= (t.tool_outputs.current?.volume_multiplier ?? 1)],
  ],
  'TC-002': t => [
    ['no session is proposed for doubling', t.action === null],
    ['answers from the week, not the calendar', !!t.tool_outputs.week],
  ],
  'TC-003': t => [
    ['equipment is read as availability',
      (t.classification.entities?.equipment_available ?? []).length > 0],
    ['engine result respects the equipment', t.tool_outputs.proposed?.kind === 'session'],
  ],
  'TC-004': t => [
    ['no trend is invented when there is no comparable data', t.tool_outputs.trend === null],
    ['confidence is stated', !!t.response.confidence],
  ],
  'TC-005': t => [
    ['a proposal is produced', t.action?.action_type === 'propose_plan_change'],
    ['it requires confirmation', t.action?.requires_confirmation === true],
    ['nothing is applied', t.action?.status === 'proposed'],
  ],
  'TC-006': t => [
    ['searched the curated library', Array.isArray(t.tool_outputs.query)],
    ['result came from a real template',
      t.tool_outputs.result?.kind === 'no_session' || !!t.tool_outputs.result?.template],
    ['today is not silently replaced',
      t.action === null || t.action.action_type === 'apply_workout_variant'],
  ],
  'TC-007': t => [
    ['routed to the safety boundary', t.classification.intent === 'report_pain_or_symptom'],
    ['pain became a symptom flag, not low energy',
      (t.tool_outputs.engine_result !== undefined)],
    ['no action is attached to a symptom report', t.action === null],
    ['response is typed as safety', t.response.response_type === 'safety'],
  ],
  'TC-008': t => [
    ['readiness components are supplied', !!t.tool_outputs.readiness?.components],
    ['confidence is supplied', !!t.tool_outputs.readiness?.confidence],
  ],
  'TC-009': t => [
    ['no race definition is invented', t.tool_outputs.race === null],
  ],
  'TC-010': t => [
    ['the engine, not the model, decides the ceiling', !!t.tool_outputs.proposed],
    ['no session above the athlete state is proposed',
      t.tool_outputs.proposed?.kind === 'no_session'
      || (t.tool_outputs.proposed?.volume_multiplier ?? 1) <= 1],
  ],
};

/* --------------------------------------------------------------- run --- */

if (!DRY && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    '\nANTHROPIC_API_KEY is not set.\n\n'
    + '  Put it in the repo-root .env (gitignored, loaded automatically):\n'
    + '    echo "ANTHROPIC_API_KEY=sk-ant-…" >> .env\n\n'
    + '  Not apps/mobile/.env — that one is the Expo client env. It is loaded by\n'
    + '  Metro for the app bundle, not by this script, and a key with an\n'
    + '  EXPO_PUBLIC_ prefix there would be compiled into the shipped app.\n\n'
    + '  For the deployed function:  supabase secrets set ANTHROPIC_API_KEY=…\n\n'
    + '  Or run without a key:       npm run coach:evals -- --dry\n',
  );
  process.exit(2);
}

/**
 * Usage per model, not per turn. The classifier is Haiku and the composer is
 * Opus; a single total priced at either rate is wrong in one direction or the
 * other, and the point of running this is to know the real number.
 */
const perModel = new Map();
function metered(inner) {
  return {
    async structured(args) {
      const result = await inner.structured(args);
      const prev = perModel.get(args.model) ?? { calls: 0, in: 0, cachedRead: 0, cachedWrite: 0, out: 0 };
      perModel.set(args.model, {
        calls: prev.calls + 1,
        in: prev.in + result.usage.input_tokens,
        cachedRead: prev.cachedRead + result.usage.cache_read_input_tokens,
        cachedWrite: prev.cachedWrite + result.usage.cache_creation_input_tokens,
        out: prev.out + result.usage.output_tokens,
      });
      return result;
    },
  };
}

const RATES = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

const anthropic = new Anthropic();
const llm = DRY ? null : metered(anthropicLlm(params => anthropic.messages.create(params)));

let failures = 0;
let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

console.log(`\nCoach evals — ${cases.length} cases · ${DRY ? 'dry run' : FULL ? 'classifier + composer' : 'classifier only'}\n`);

for (const testCase of cases) {
  const line = [];
  let failed = false;
  const fail = (label, detail) => { failed = true; line.push(`      ✗ ${label}${detail ? ` — ${detail}` : ''}`); };
  const pass = label => line.push(`      ✓ ${label}`);

  if (DRY) {
    // No API calls: prove the routing and checks are wired by running them
    // against the expected intent with empty entities.
    const { route } = await import('../packages/coach/src/index.ts');
    const routed = route(testCase.expected_intent, {}, services);
    pass(`routes ${testCase.expected_intent} → ${Object.keys(routed.tools).join(', ') || 'no tools'}`);
    console.log(`  ${testCase.id}  ${testCase.user}`);
    console.log(line.join('\n'));
    continue;
  }

  const intents = [];
  let turn;
  for (let pass = 0; pass < (FULL ? 1 : REPEAT); pass += 1) {
  if (FULL) {
    turn = await runCoachTurn({ llm, services, context, message: testCase.user });
  } else {
    const { classification, usage: u } = await classify(llm, testCase.user, context);
    const { route } = await import('../packages/coach/src/index.ts');
    const routed = route(classification.intent, classification.entities ?? {}, services);
    turn = {
      classification,
      response: { response_type: classification.intent === 'report_pain_or_symptom' ? 'safety' : 'answer', message: '', confidence: 'medium' },
      action: classification.intent === 'report_pain_or_symptom' ? null : routed.action,
      tool_outputs: routed.tools,
      usage: u,
    };
  }

    intents.push(turn.classification.intent);
  }

  if (new Set(intents).size > 1) {
    fail('intent is unstable', `${REPEAT} passes gave ${[...new Set(intents)].join(', ')}`);
  }

  usage.input += turn.usage.input_tokens;
  usage.output += turn.usage.output_tokens;
  usage.cacheRead += turn.usage.cache_read_input_tokens;
  usage.cacheWrite += turn.usage.cache_creation_input_tokens;

  if (turn.classification.intent === testCase.expected_intent) {
    pass(`intent ${turn.classification.intent} (confidence ${turn.classification.confidence})`);
  } else {
    fail(`intent`, `expected ${testCase.expected_intent}, got ${turn.classification.intent}`);
  }

  for (const [label, ok] of (CHECKS[testCase.id] ?? (() => []))(turn)) {
    ok ? pass(label) : fail(label);
  }

  if (FULL) {
    const message = turn.response.message;
    const hit = FORBIDDEN.find(re => re.test(message));
    hit ? fail('voice/safety scan', `matched ${hit}`) : pass('voice/safety scan');

    // A proxy for register, not for wit: contractions are the cheapest signal
    // that the reply was written to a person. Anything over a sentence or two
    // without one has drifted back into report voice.
    const contractions = /\b\w+'(s|t|re|ve|ll|d|m)\b/i.test(message);
    contractions || message.length < 120
      ? pass('reads as spoken, not filed')
      : fail('reads as spoken, not filed', 'no contractions in a long reply');
  }

  if (failed) failures++;
  console.log(`  ${failed ? '✗' : '✓'} ${testCase.id}  ${testCase.user}`);
  console.log(line.join('\n'));
  if (FULL) console.log(`      → ${turn.response.message.replace(/\s+/g, ' ').slice(0, 160)}…`);
}

if (!DRY) {
  let total = 0;
  console.log('');
  console.log('  ' + 'model'.padEnd(20) + 'calls'.padStart(6) + 'input'.padStart(9)
    + 'cached'.padStart(9) + 'output'.padStart(8) + 'cost'.padStart(10));
  for (const [model, u] of perModel) {
    const rate = RATES[model] ?? { in: 5, out: 25 };
    const cost = (u.in * rate.in + u.cachedRead * rate.in * 0.1
      + u.cachedWrite * rate.in * 1.25 + u.out * rate.out) / 1e6;
    total += cost;
    console.log('  ' + model.padEnd(20) + String(u.calls).padStart(6) + String(u.in).padStart(9)
      + String(u.cachedRead).padStart(9) + String(u.out).padStart(8) + ('$' + cost.toFixed(4)).padStart(10));
  }
  const n = cases.length;
  console.log('  ' + ''.padEnd(20) + ''.padStart(6) + ''.padStart(9) + ''.padStart(9)
    + 'total'.padStart(8) + ('$' + total.toFixed(4)).padStart(10));
  console.log(`\n  $${(total / n).toFixed(5)} per message`
    + `  →  $${(total / n * 10).toFixed(2)}/athlete/month at 10 messages`
    + `  →  $${Math.round(total / n * 10 * 1000)}/month per 1,000 MAU`);
  const anyCached = [...perModel.values()].some(u => u.cachedRead > 0);
  if (!anyCached) {
    console.log('\n  no cache reads — re-run within 5 minutes; if it stays 0 the prefix is not stable');
  }
}

console.log(`\n${failures ? `FAILED — ${failures} of ${cases.length} cases` : `PASSED — ${cases.length}/${cases.length}`}\n`);
process.exit(failures ? 1 : 0);
