/**
 * Narration writes user-facing claims about someone's training, so what is
 * pinned here is that it degrades to something correct rather than to nothing,
 * and that a bad reply cannot reach the screen.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { narrateProgress, FALLBACK_DETAIL, COMPONENT_KEYS } from './narrate.ts';
import type { LlmClient } from './types.ts';

const FACTS = {
  aerobic: { score: 93, stats: [{ k: 'Z2 pace', v: '5:32/km' }] },
  running: { score: 41, stats: [] },
  strength: { score: 94, stats: [{ k: 'Squat', v: '140 kg' }] },
  stations: { score: 38, stats: [] },
  consistency: { score: 83, stats: [] },
  recovery: { score: 60, stats: [] },
};

const llmReturning = (parsed: unknown, capture?: { system?: string; content?: string }): LlmClient => ({
  async structured(a: any) {
    if (capture) { capture.system = a.system; capture.content = a.messages[0].content; }
    return { parsed, refusal: null, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  },
} as any);

describe('Progress narration', () => {
  test('a model failure leaves every component with its shipped sentence', async () => {
    const llm = { async structured() { throw new Error('503'); } } as any as LlmClient;
    const r = await narrateProgress({ llm, facts: FACTS, lowest: 'stations' });
    assert.equal(r.source, 'fallback');
    assert.deepEqual(r.detail, FALLBACK_DETAIL);
  });

  test('a malformed reply is discarded rather than partly trusted', async () => {
    const r = await narrateProgress({ llm: llmReturning({ nope: true }), facts: FACTS, lowest: 'stations' });
    assert.equal(r.source, 'fallback');
    assert.deepEqual(r.detail, FALLBACK_DETAIL);
  });

  test('components the model omits keep their fallback', async () => {
    const r = await narrateProgress({
      llm: llmReturning({ components: [{ key: 'aerobic', sentence: 'Easy-run pace and 30-day load.' }] }),
      facts: FACTS, lowest: 'stations',
    });
    assert.equal(r.detail.aerobic, 'Easy-run pace and 30-day load.');
    assert.equal(r.detail.running, FALLBACK_DETAIL.running);
    assert.equal(Object.keys(r.detail).length, COMPONENT_KEYS.length);
  });

  test('an over-long sentence is rejected — the row is one line', async () => {
    const r = await narrateProgress({
      llm: llmReturning({ components: [{ key: 'aerobic', sentence: 'x'.repeat(200) }] }),
      facts: FACTS, lowest: 'stations',
    });
    assert.equal(r.detail.aerobic, FALLBACK_DETAIL.aerobic);
  });

  test('an unknown component key cannot introduce a row', async () => {
    const r = await narrateProgress({
      llm: llmReturning({ components: [{ key: 'vo2max', sentence: 'Invented.' }] }),
      facts: FACTS, lowest: 'stations',
    });
    assert.deepEqual(Object.keys(r.detail).sort(), [...COMPONENT_KEYS].sort());
    assert.equal(r.source, 'fallback');
  });

  test('the model is handed the figures and told no comparisons exist', async () => {
    const cap: { system?: string; content?: string } = {};
    await narrateProgress({
      llm: llmReturning({ components: [] }, cap), facts: FACTS, lowest: 'stations',
    });
    assert.match(cap.content!, /aerobic: score 93\/100; Z2 pace = 5:32\/km/);
    assert.match(cap.content!, /stations: score 38\/100; no stats measured yet; lowest-scoring component/);
    assert.match(cap.content!, /no trend or goal claims are possible/);
    // The grounding rule has to be in the system prompt, not just the content.
    assert.match(cap.system!, /Every claim must be supported by a figure you were given/);
    assert.match(cap.system!, /no trend claims at all/);
  });

  test('the shipped sentences state what a metric is, never how it is going', () => {
    for (const [key, sentence] of Object.entries(FALLBACK_DETAIL)) {
      assert.doesNotMatch(sentence, /improv|declin|steadil|ahead of|behind|lagg/i,
        `${key} fallback must not make a trend or goal claim`);
    }
  });
});
