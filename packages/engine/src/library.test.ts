/**
 * Invariants the library must hold for the planner to be able to plan at all.
 *
 * Distinct from `coverage.test.ts`, which asks whether there is ENOUGH content.
 * This asks whether the content is addressable: a template the planner can
 * never name is not a shortfall you can author your way out of, it is a row
 * that will sit in the library for ever looking perfectly correct.
 *
 * ── The failure this exists to stop ─────────────────────────────────────────
 *
 * `matchesStimulus` compares a template's goal against the goal the week asked
 * for, and the week only ever asks for the five in `GOALS`. The importer used
 * to fall back to the raw authored stimulus when the taxonomy had no roll-up
 * for it, so a pack naming its stimulus `bilateral_squat_strength` imported
 * cleanly, classified as strength, passed the coverage gate, and was then
 * invisible to the planner for ever. Thirty templates arrived that way in a
 * single pack and nothing anywhere went red.
 *
 * The importer now refuses. This is the second lock: it fails on the library as
 * built, so a roll-up lost in a merge, a hand-edited dump or a taxonomy entry
 * deleted as unused is caught by the test suite rather than by an athlete
 * whose week is short a session.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { WorkoutTemplate } from './types.ts';

const fixture = JSON.parse(readFileSync(
  new URL('../../../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));

const TEMPLATES: WorkoutTemplate[] = fixture.templates;

/** The only goals the planner ever asks for (BASE_STIMULI in periodization). */
const PLANNER_GOALS = [
  'aerobic_durability', 'threshold', 'strength', 'race_specific', 'recovery',
] as const;

describe('Library invariants', () => {
  test('every template carries one of the five planner goals', () => {
    const stray = TEMPLATES
      .filter(t => !(PLANNER_GOALS as readonly string[]).includes(t.primary_goal))
      .map(t => `${t.id} (primary_goal "${t.primary_goal}", stimulus "${t.stimulus ?? '-'}")`);

    assert.deepEqual(stray, [],
      `${stray.length} template(s) carry a primary_goal that is not a planner goal, so `
      + 'matchesStimulus can never select them. The authored stimulus is orthogonal '
      + 'metadata and stays as it is; what is missing is its roll-up in '
      + 'scripts/lib/stimulus-taxonomy.mjs.');
  });

  test('the authored stimulus survives the roll-up', () => {
    // The roll-up must not be achieved by flattening the detail into it. If
    // every template's stimulus equalled its planner goal, the taxonomy would
    // have stopped being a two-level model and become a rename.
    const detailed = TEMPLATES.filter(t => t.stimulus && t.stimulus !== t.primary_goal);
    assert.ok(detailed.length > TEMPLATES.length / 4,
      `only ${detailed.length} of ${TEMPLATES.length} templates carry a stimulus distinct `
      + 'from their planner goal — the authored detail is being lost, not rolled up');
  });

  test('no retired template reaches the planning fixture', () => {
    // Retirement (migration 0016) removes a template from candidate generation.
    // build-fixtures drops them, so anything with a status here is a template
    // that was retired after the fixture was built.
    const retired = TEMPLATES.filter((t: any) => t.status === 'retired').map(t => t.id);
    assert.deepEqual(retired, [],
      'retired templates are in the planning fixture — re-run scripts/build-fixtures.mjs');
  });

  test('every template has a family, and a goal its family does not contradict', () => {
    const unfamilied = TEMPLATES.filter(t => !t.workout_family).map(t => t.id);
    assert.deepEqual(unfamilied, [], 'templates with no workout_family');

    // A family named for strength that rolls up to something else is a
    // mislabel in one direction or the other, and the planner will believe the
    // goal while a coach reads the family.
    const contradicting = TEMPLATES
      .filter(t => t.workout_family.startsWith('strength_') && t.primary_goal !== 'strength')
      .map(t => `${t.id} (${t.workout_family} -> ${t.primary_goal})`);
    assert.deepEqual(contradicting, [],
      'templates in a strength_* family that do not roll up to the strength goal');
  });
});
