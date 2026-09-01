import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveExerciseColumns, impactLevelFor, defaultUnitFor } from './exercise-defaults.mjs';

test('anything airborne is high impact whatever its family says', () => {
  // The athlete asking for low impact is asking about their joints.
  assert.equal(impactLevelFor({ movement_families: ['jump_plyometric'] }), 'high');
  assert.equal(impactLevelFor({ movement_characters: ['reactive'] }), 'high');
  assert.equal(impactLevelFor({ movement_characters: ['ballistic'] }), 'high');
});

test('explosive without airborne is medium, not high', () => {
  assert.equal(impactLevelFor({ movement_families: ['olympic_explosive'], movement_characters: ['explosive'] }), 'medium');
});

test('a barbell squat is low impact', () => {
  assert.equal(impactLevelFor({ movement_families: ['squat'], movement_characters: ['foundational', 'bilateral'] }), 'low');
});

test('a hold counts in seconds, a carry in metres, a lift in reps', () => {
  assert.equal(defaultUnitFor({ progression_tracks: ['duration', 'load'] }), 'sec');
  assert.equal(defaultUnitFor({ movement_families: ['carry'], progression_tracks: ['load', 'distance'] }), 'm');
  assert.equal(defaultUnitFor({ progression_tracks: ['load', 'reps'] }), 'reps');
});

test('postpartum-friendly is never inferred', () => {
  // False withholds; true exposes. Nobody has assessed these movements, so the
  // only safe default is the one that withholds.
  for (const o of [
    { movement_families: ['squat'] },
    { movement_families: ['jump_plyometric'] },
    { movement_families: ['accessory_isolation'] },
  ]) {
    assert.equal(deriveExerciseColumns(o).postpartum_friendly, false);
  }
});

test('hyrox relevance is zero, not a guess', () => {
  assert.equal(deriveExerciseColumns({ movement_families: ['carry'] }).hyrox_relevance, 0);
});

test('every NOT NULL column the table needs is produced', () => {
  const cols = deriveExerciseColumns({
    movement_families: ['squat'], movement_characters: ['foundational'],
    progression_tracks: ['load', 'reps'], equipment: ['barbell'],
    methodology_bucket: 'foundational_repeatable',
  });
  for (const c of ['category', 'movement_pattern', 'modality', 'default_unit',
    'impact_level', 'hyrox_relevance', 'postpartum_friendly']) {
    assert.ok(cols[c] !== undefined && cols[c] !== null, `${c} is missing`);
  }
  assert.equal(cols.modality, 'barbell');
  assert.equal(cols.category, 'strength');
});
