/**
 * Coach's intent classifier.
 *
 * What is pinned here is the distinction the classifier kept getting wrong: a
 * question *about the library* is a search, and a statement about *what the
 * athlete will have* is a travel plan. Both name equipment, and reading the
 * first as the second is how "are there any strength workouts with dumbbells
 * and barbells?" came back with a running session — every constraint in the
 * question dropped until an answer existed.
 *
 * The safety routing is here for the opposite reason: it must never be reached
 * by any of this. Pain is not a search term.
 */
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { classify } from './coach.ts';

describe('Coach intent', () => {
  test('asking what the library holds is a search, not a travel plan', () => {
    const { intent, signals } = classify('Are there any strength workouts with dumbbells and barbells?');

    assert.equal(intent, 'build');
    assert.ok(signals.keywords?.includes('strength'),
      'the quality asked for must survive classification');
    assert.deepEqual(signals.equipment?.sort(), ['barbell', 'bodyweight', 'db', 'rack'].sort());
  });

  test('the plural is not a different question', () => {
    // "workouts with" failed `(workout|session) (for|with)` on the s alone.
    for (const q of [
      'any sled workouts with a rower?',
      'do you have a threshold session using the rower',
      'what running workouts do you have',
    ]) {
      assert.equal(classify(q).intent, 'build', q);
    }
  });

  test('equipment named in a build request narrows it, rather than being noise', () => {
    const { intent, signals } = classify('Build me a 30-minute sled and running workout');
    assert.equal(intent, 'build');
    assert.ok(signals.keywords?.includes('sled'));
    assert.equal(signals.time_limit, 30);
  });

  test('telling Coach what you will have is still a travel plan', () => {
    // The suggested prompt, and the case discovery must not swallow: no
    // question about the library, just a statement of kit.
    const { intent, signals } = classify("I'm travelling with a treadmill and dumbbells");
    assert.equal(intent, 'travel');
    assert.ok(signals.equipment?.includes('treadmill'));
    assert.ok(signals.equipment?.includes('db'));
  });

  test('"only dumbbells" is a constraint on today, not a question', () => {
    assert.equal(classify('I only have dumbbells today').intent, 'travel');
  });

  test('a time limit is still an adaptation request', () => {
    const { intent, signals } = classify('I only have 25 minutes today');
    assert.equal(intent, 'adapt');
    assert.equal(signals.time_limit, 25);
  });

  test('symptom language outranks every search term in the sentence', () => {
    // "workouts" and "strength" are both present; neither may route this.
    const { intent } = classify('my knee hurts — are there any strength workouts I can still do?');
    assert.equal(intent, 'safety');
  });

  test('an unmatched question is null rather than a guess', () => {
    assert.equal(classify('what is the capital of France').intent, null);
  });
});
