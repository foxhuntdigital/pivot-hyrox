/**
 * Every way a ruling can be wrong, and the refusal it earns.
 *
 * These decide whether canonical identity is safe to change. A rule that is not
 * exercised here is a rule that silently passes a bad ruling into the library,
 * where it forks history or orphans a template — the failure the whole gate
 * exists to prevent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan } from './vocabulary-plan.mjs';

const library = {
  exercises: [
    { id: 'ex_back_squat', name: 'Back Squat' },
    { id: 'ex_deadlift', name: 'Deadlift' },
    { id: 'ex_orphan', name: 'Orphan Move' },
  ],
  templates: [{
    id: 'wo_legs', blocks: [{ exercises: [{ exercise_id: 'ex_back_squat' }] }],
  }],
  substitutions: [
    { exercise_id: 'ex_back_squat', substitute_exercise_id: 'ex_deadlift' },
  ],
};

const detail = {
  equipment: { trap_bar: { status: 'new', uses: 2, proposed_tier: 'athlete_selectable' } },
  proposed: [
    { proposed_name: 'Back Squat', proposed_id: 'ex_back_squat', issues: [] },
    { proposed_name: 'Trap-Bar Deadlift', proposed_id: 'ex_trap_bar_deadlift', issues: [] },
    { proposed_name: 'Bench Press', proposed_id: 'ex_bench_press', issues: [] },
  ],
};

const ruling = (over = {}) => ({
  row: '2', proposed_name: 'Back Squat', proposed_id: 'ex_back_squat',
  ruling: 'EXACT_EXISTING', ruling_target_id: 'ex_back_squat',
  ruling_aliases: '', ruling_variant_parent: '', review_status: 'Review', ...over,
});

const run = (rulings, absentRulings = []) =>
  buildPlan({ rulings, absentRulings, detail, library });

describe('Ruling validation', () => {
  test('a coherent ruling produces a plan and no errors', () => {
    const { errors, plan } = run([ruling()]);
    assert.deepEqual(errors, []);
    assert.equal(plan.update.length, 1);
    assert.equal(plan.update[0].id, 'ex_back_squat');
  });

  test('a disposition outside the vocabulary is refused', () => {
    const { errors } = run([ruling({ ruling: 'PROBABLY_FINE' })]);
    assert.match(errors[0], /is not a disposition/);
  });

  test('a blank ruling is refused rather than defaulted', () => {
    // Defaulting a blank to "accept the proposal" would let an untouched row
    // pass as a decision nobody made.
    const { errors } = run([ruling({ ruling: '' })]);
    assert.match(errors[0], /is not a disposition/);
  });

  test('a targeted disposition with no target is refused', () => {
    const { errors } = run([ruling({ ruling: 'RENAME_EXISTING', ruling_target_id: '' })]);
    assert.match(errors[0], /needs a ruling_target_id/);
  });

  test('a target that does not exist is refused', () => {
    // The likeliest error in a hand-edited file, and the one a spreadsheet
    // dropdown could never catch.
    const { errors } = run([ruling({ ruling_target_id: 'ex_back_squatt' })]);
    assert.match(errors[0], /is not an exercise in the library/);
  });

  test('NEW_CANONICAL naming a target is refused as claiming two things', () => {
    const { errors } = run([ruling({
      proposed_name: 'Bench Press', ruling: 'NEW_CANONICAL', ruling_target_id: 'ex_deadlift',
    })]);
    assert.match(errors[0], /must not name a ruling_target_id/);
  });

  test('two rows cannot claim the same existing exercise', () => {
    // Both would rewrite one row's identity, and the second would win silently.
    const { errors } = run([
      ruling(),
      ruling({ row: '3', proposed_name: 'Trap-Bar Deadlift', ruling: 'ALIAS_EXISTING',
        ruling_target_id: 'ex_back_squat' }),
    ]);
    assert.match(errors[0], /already claimed by/);
  });

  test('a new exercise cannot mint an id that already exists', () => {
    // This is what forks history: two rows, one id, one of them inheriting
    // performance records that were never theirs.
    const { errors } = run([ruling({
      proposed_name: 'Bench Press', proposed_id: 'ex_deadlift',
      ruling: 'NEW_CANONICAL', ruling_target_id: '',
    })]);
    assert.match(errors[0], /already exists/);
  });

  test('two new exercises cannot mint the same id', () => {
    const { errors } = run([
      ruling({ proposed_name: 'Bench Press', proposed_id: 'ex_new', ruling: 'NEW_CANONICAL', ruling_target_id: '' }),
      ruling({ row: '3', proposed_name: 'Trap-Bar Deadlift', proposed_id: 'ex_new',
        ruling: 'NEW_CANONICAL', ruling_target_id: '' }),
    ]);
    assert.match(errors[0], /already minted by/);
  });

  test('a variant may point at a parent another variant also points at', () => {
    // Unlike a rename, a variant mints its own id and only references the
    // parent, so several variants of one movement are legitimate.
    const { errors, plan } = run([
      ruling({ proposed_name: 'Trap-Bar Deadlift', proposed_id: 'ex_trap_bar_deadlift',
        ruling: 'VARIANT_OF_EXISTING', ruling_target_id: 'ex_deadlift' }),
      ruling({ row: '3', proposed_name: 'Bench Press', proposed_id: 'ex_bench_press',
        ruling: 'VARIANT_OF_EXISTING', ruling_target_id: 'ex_deadlift' }),
    ]);
    assert.deepEqual(errors, []);
    assert.equal(plan.variant.length, 2);
    assert.equal(plan.variant[0].parent, 'ex_deadlift');
  });

  test('REQUIRES_REVIEW is collected, not treated as an error', () => {
    // Unresolved is a normal state to be in. It blocks applying, and it is not
    // a mistake to be shouted about.
    const { errors, plan } = run([ruling({ ruling: 'REQUIRES_REVIEW', ruling_target_id: '' })]);
    assert.deepEqual(errors, []);
    assert.equal(plan.unresolved.length, 1);
  });

  test('approval is tracked separately from coherence', () => {
    const a = run([ruling()]).plan.update[0];
    const b = run([ruling({ review_status: 'Approved' })]).plan.update[0];
    assert.equal(a.approved, false, 'coherent but not approved');
    assert.equal(b.approved, true);
  });

  test('a rename carries the aliases the reviewer set', () => {
    const { plan } = run([ruling({
      proposed_name: 'Trap-Bar Deadlift', ruling: 'RENAME_EXISTING',
      ruling_target_id: 'ex_deadlift', ruling_aliases: 'Deadlift; Conventional Deadlift',
    })]);
    assert.deepEqual(plan.rename[0].aliases, ['Deadlift', 'Conventional Deadlift']);
  });
});

describe('Deprecation', () => {
  test('an unreferenced exercise may be deprecated', () => {
    const { errors, deprecations } = run([], [
      { id: 'ex_orphan', name: 'Orphan Move', ruling: 'DEPRECATION_CANDIDATE', ruling_notes: '' },
    ]);
    assert.deepEqual(errors, []);
    assert.equal(deprecations.length, 1);
  });

  test('an exercise a template uses may not be deprecated', () => {
    const { errors, deprecations } = run([], [
      { id: 'ex_back_squat', name: 'Back Squat', ruling: 'DEPRECATION_CANDIDATE' },
    ]);
    assert.match(errors[0], /cannot deprecate/);
    assert.equal(deprecations.length, 0);
  });

  test('an exercise only the substitution graph uses may not be deprecated', () => {
    // The graph is why a dumbbell athlete can reach a barbell session at all.
    // Retiring a substitute silently removes that path.
    const { errors } = run([], [
      { id: 'ex_deadlift', name: 'Deadlift', ruling: 'DEPRECATION_CANDIDATE' },
    ]);
    assert.match(errors[0], /cannot deprecate/);
  });

  test('KEEP_EXISTING is the quiet default and produces nothing', () => {
    const { errors, deprecations } = run([], [
      { id: 'ex_orphan', name: 'Orphan Move', ruling: 'KEEP_EXISTING' },
    ]);
    assert.deepEqual(errors, []);
    assert.equal(deprecations.length, 0);
  });

  test('an unrecognised absent ruling is refused, never ignored', () => {
    const { errors } = run([], [{ id: 'ex_orphan', name: 'Orphan Move', ruling: 'delete' }]);
    assert.match(errors[0], /is not KEEP_EXISTING or DEPRECATION_CANDIDATE/);
  });
});

describe('Equipment', () => {
  test('equipment new to the library is surfaced with its proposed tier', () => {
    const { newEquipment } = run([ruling()]);
    assert.deepEqual(newEquipment, [
      { id: 'trap_bar', uses: 2, proposed_tier: 'athlete_selectable' },
    ]);
  });
});
