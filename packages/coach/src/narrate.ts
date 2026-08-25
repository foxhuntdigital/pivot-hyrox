/**
 * The one-line explanation under each readiness component on Progress.
 *
 * These used to be six fixed sentences shipped with the app — every athlete
 * read "Threshold pace ... has improved steadily through this block" whatever
 * their history did. Once the stats beside them became real, the prose could
 * contradict the numbers it sat above.
 *
 * So Coach writes them, from the numbers and nothing else. Two things keep that
 * safe: the prompt forbids any claim not supported by a supplied figure (and no
 * trend figures are supplied, so no trend claims are possible), and
 * `FALLBACK_DETAIL` below is a deterministic sentence per component that ships
 * with the app. Narration is an enhancement over that floor, never a dependency:
 * if the model is unavailable, rate limited, or returns something unusable, the
 * screen still reads correctly.
 */
import { NARRATOR_SYSTEM, NARRATION_SCHEMA_API, NARRATION_VERSION } from './generated.ts';
import type { LlmClient } from './types.ts';

export const NARRATOR_MODEL = 'claude-haiku-4-5';

export type ComponentKey =
  | 'aerobic' | 'running' | 'strength' | 'stations' | 'consistency' | 'recovery';

export const COMPONENT_KEYS: ComponentKey[] =
  ['aerobic', 'running', 'strength', 'stations', 'consistency', 'recovery'];

export interface ComponentFacts {
  /** 0..100, as shown on the bar. */
  score: number;
  stats: { k: string; v: string }[];
}

/**
 * What each component measures, said plainly.
 *
 * This is the floor, not a placeholder: it states what the metric is rather
 * than how it is going, so it cannot be contradicted by the numbers beside it.
 */
export const FALLBACK_DETAIL: Record<ComponentKey, string> = {
  aerobic: 'Easy-run pace and 30-day internal load, from the sessions you have logged.',
  running: 'Run frequency and your longest continuous run over the last week.',
  strength: 'How much of the prescribed load you completed, across four weeks.',
  stations: 'How many of the eight race stations you have touched in three weeks.',
  consistency: 'Stimuli completed against what the week asked for, not sessions on a calendar.',
  recovery: 'What you reported at check-in — sleep and energy, as you logged them.',
};

interface NarrationReply {
  components: { key: string; sentence: string }[];
}

const isReply = (v: unknown): v is NarrationReply =>
  !!v && typeof v === 'object' && Array.isArray((v as NarrationReply).components)
  && (v as NarrationReply).components.every(c =>
    c && typeof c.key === 'string' && typeof c.sentence === 'string');

/** The facts the model is allowed to write from, and nothing else. */
function narratorContent(facts: Record<string, ComponentFacts>, lowest: string): string {
  const lines = COMPONENT_KEYS.filter(k => facts[k]).map(k => {
    const f = facts[k];
    const stats = f.stats.length
      ? f.stats.map(s => `${s.k} = ${s.v}`).join(', ')
      : 'no stats measured yet';
    return `- ${k}: score ${f.score}/100; ${stats}${k === lowest ? '; lowest-scoring component' : ''}`;
  });
  return [
    'Write one sentence for each component below.',
    '',
    ...lines,
    '',
    'No comparison figures are supplied, so no trend or goal claims are possible.',
  ].join('\n');
}

/**
 * Asks Coach for the six sentences. Never throws and never returns a partial
 * set — any component the model omits or leaves empty keeps its fallback, so
 * the caller always gets one usable sentence per component.
 */
export async function narrateProgress(args: {
  llm: LlmClient;
  facts: Record<string, ComponentFacts>;
  lowest: string;
}): Promise<{
  detail: Record<ComponentKey, string>;
  source: 'coach' | 'fallback';
  version: string;
  usage?: { input_tokens: number; output_tokens: number };
}> {
  const detail = { ...FALLBACK_DETAIL };
  try {
    const res = await args.llm.structured({
      model: NARRATOR_MODEL,
      system: NARRATOR_SYSTEM,
      schema: NARRATION_SCHEMA_API,
      maxTokens: 700,
      messages: [{ role: 'user', content: narratorContent(args.facts, args.lowest) }],
    });
    if (!isReply(res.parsed)) return { detail, source: 'fallback', version: NARRATION_VERSION };

    let used = false;
    for (const c of res.parsed.components) {
      const key = c.key as ComponentKey;
      if (!COMPONENT_KEYS.includes(key)) continue;
      const sentence = c.sentence.trim();
      // A sentence long enough to be a paragraph is not the label this asks
      // for, and the row has no room for it.
      if (!sentence || sentence.length > 160) continue;
      detail[key] = sentence;
      used = true;
    }
    return {
      detail,
      source: used ? 'coach' : 'fallback',
      version: NARRATION_VERSION,
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    };
  } catch {
    // Narration is never worth failing a screen over.
    return { detail, source: 'fallback', version: NARRATION_VERSION };
  }
}
