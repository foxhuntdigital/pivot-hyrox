/**
 * The strength archetype rule. Cases are real sessions from the library,
 * written as their exercises' buckets in the order performed
 * (F foundational, A athletic, C complex).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveArchetype } from './archetype.mjs';

const F = 'foundational', A = 'athletic', C = 'complex';

describe('workout archetype', () => {
  test('all foundational anchors is foundational (Lower Strength: Squat Foundation)', () => {
    assert.equal(deriveArchetype([F, F, F, F, F]), 'foundational');
  });

  test('one athletic accessory does not change a foundational session (Dumbbell Hinge)', () => {
    // The single-leg RDL is filed athletic; the session is still a hinge day.
    assert.equal(deriveArchetype([F, F, F, A, F]), 'foundational');
  });

  test('a power primer before the anchors is mixed (Power Strength: Jump + Squat)', () => {
    assert.equal(deriveArchetype([A, F, F, F]), 'mixed');
    assert.equal(deriveArchetype([C, F, F, F]), 'mixed');
  });

  test('two fifths non-foundational is mixed (HYROX Legs A)', () => {
    assert.equal(deriveArchetype([F, F, A, C, F]), 'mixed');
  });

  test('mostly athletic is athletic (Power Strength: Lateral + Unilateral)', () => {
    assert.equal(deriveArchetype([A, F, A, A]), 'athletic');
  });

  test('mostly complex is complex', () => {
    assert.equal(deriveArchetype([C, C, F, C]), 'complex');
  });

  test('unclassified exercises are ignored, and nothing classified is null', () => {
    assert.equal(deriveArchetype([F, null, F, F]), 'foundational');
    assert.equal(deriveArchetype([null, null]), null);
    assert.equal(deriveArchetype([]), null);
  });
});
