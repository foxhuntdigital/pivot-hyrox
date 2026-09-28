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

import { recommend } from './index.ts';
import type { EngineInput, WorkoutTemplate } from './types.ts';

const fixture = JSON.parse(readFileSync(
  new URL('../../../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));

const ALL: WorkoutTemplate[] = fixture.templates;

/**
 * What the planner can select. Supplementals are excluded here exactly as
 * `loadContent` excludes them from `candidates` — they are offered after a
 * session, never scheduled — and the goal invariant below applies to this pool
 * rather than to the catalogue, because that is where being unaddressable
 * actually costs an athlete a session.
 */
const TEMPLATES: WorkoutTemplate[] = ALL
  .filter(t => (t.workout_role ?? 'primary') === 'primary');

/** The only goals the planner ever asks for (BASE_STIMULI in periodization). */
const PLANNER_GOALS = [
  'aerobic_durability', 'threshold', 'strength', 'race_specific', 'recovery',
] as const;

describe('Library invariants', () => {
  test('every planner-selectable template resolves to one of the five goals', () => {
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

  test('a supplemental is never plannable, and carries no goal it cannot serve', () => {
    const supplemental = ALL.filter(t => (t.workout_role ?? 'primary') === 'supplemental');
    // The exemption, stated: a supplemental may have no planner goal, and must
    // not have been given one to satisfy a constraint. Migration 0018 permits
    // the null and still refuses it for everything else.
    for (const t of supplemental) {
      assert.equal(t.primary_goal ?? null, null,
        `${t.id} is supplemental and carries primary_goal "${t.primary_goal}" — a value `
        + 'written only to satisfy an invariant is the fallback the validator removes');
    }
    // The other half of the exemption: a supplemental is excused the planner
    // goal only because it can never be planned. If one ever reaches the
    // planner's pool, the excuse stops being true and this fails.
    assert.equal(
      TEMPLATES.filter(t => (t.workout_role ?? 'primary') === 'supplemental').length, 0,
      'a supplemental is in the planner pool; it is exempt from the goal invariant '
      + 'only because it is not');
    // Not an assertion that any exist — the library may have none. What is
    // pinned is that if they do, each carries the two fields the offer path
    // cannot work without, because `searchSupplementals` skips a row missing
    // either rather than guessing at it, and a skipped row is invisible.
    for (const t of supplemental) {
      assert.ok(t.supplemental_type,
        `${t.id} is supplemental with no supplemental_type — it can never be offered`);
      assert.ok(t.supplemental_load,
        `${t.id} is supplemental with no supplemental_load — it can never be offered`);
      assert.notEqual(t.supplemental_load as string, 'high',
        `${t.id} carries supplemental_load 'high'; work that could compromise tomorrow is not supplemental`);
    }
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
  test('every template in the library can be recommended, supplementals included', () => {
    /*
     * The crash this exists to stop.
     *
     * `startSupplemental` runs the same `recommend` the planner runs, over a
     * single candidate the athlete tapped. `buildRationale` read
     * `template.primary_goal.replace(...)`, and the test above pins that a
     * supplemental's goal is null — so every one of the 34 supplementals threw
     * a TypeError the moment it was chosen, and the app died on the Done
     * screen. The type said `string`, so nothing caught it: the content was
     * right and the type was the lie.
     *
     * Over the whole library rather than over supplementals, because the
     * defect was never about boxing. Any field the content is allowed to leave
     * null and the renderer is not is the same bug wearing a different name.
     */
    const input: EngineInput = {
      local_date: '2026-01-01',
      phase_type: 'build',
      days_to_race: 60,
      stimulus_requirements: [],
      recent_sessions: [],
      recovery_state: 'good',
      energy: 'good',
      sleep_hours: 7.5,
      available_minutes: 60,
      available_equipment: [...new Set(
        (fixture.exercises as { equipment?: string[] }[]).flatMap(e => e.equipment ?? []))],
      low_impact_required: false,
      symptom_flags: [],
      considerations: [],
      candidates: [],
      substitutions: fixture.substitutions,
      variation_tolerance: 1,
      preferred_families: [],
      avoided_families: [],
      perceived_weaknesses: [],
    };

    const broke: string[] = [];
    for (const template of ALL) {
      try {
        const decision = recommend({ ...input, candidates: [template] }, fixture.exercises);
        // A refusal is a legitimate answer; a throw is not. What is pinned is
        // that the engine ANSWERS, and that a session it returns carries the
        // rationale and stimulus the screens render without checking.
        if (decision.kind !== 'session') continue;
        assert.ok(decision.primary_stimulus, `${template.id}: empty primary_stimulus`);
        assert.ok(decision.rationale, `${template.id}: empty rationale`);
      } catch (e) {
        broke.push(`${template.id} (${template.workout_family}): ${(e as Error).message}`);
      }
    }

    assert.deepEqual(broke, [],
      `${broke.length} of ${ALL.length} template(s) threw when recommended`);
  });
});

describe('demand coverage (product signoff, 27 Sep 2026)', () => {
  /**
   * The capacity scale is 1-4 on both axes and stays that way — that was signed
   * off. What is missing is content at the top of it.
   *
   * All 239 graded primary templates sit at 1-3, so a `technical_capacity: 4`
   * athlete has no ceiling to reach and the `load_fit` penalty can never fire
   * above capacity 3. The scale is not wrong; the library has not caught up to
   * it. Recorded here as a coverage floor rather than left as a note, so it is
   * visible in CI like every other content gap.
   */
  const graded = TEMPLATES.filter(t =>
    (t.workout_role ?? 'primary') === 'primary'
    && t.technical_demand != null && t.load_demand != null);

  test('the graded pool covers the whole capacity scale', () => {
    assert.ok(graded.length > 0, 'nothing is graded at all');
    const technical = new Set(graded.map(t => t.technical_demand));
    const load = new Set(graded.map(t => t.load_demand));
    assert.ok(technical.has(4),
      `no template is graded technical_demand 4 (found ${[...technical].sort().join(', ')})`);
    assert.ok(load.has(4),
      `no template is graded load_demand 4 (found ${[...load].sort().join(', ')})`);
  });
});
