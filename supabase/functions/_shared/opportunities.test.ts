/**
 * Bonus opportunities.
 *
 * What is under test is that preference finally changes what an athlete is
 * offered — the thing it could not do anywhere else in the system — and that it
 * does so without being able to compromise the week.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickOpportunities, OPPORTUNITIES_PER_WEEK, type Opportunity,
} from './opportunities.ts';

function tpl(id: string, domain: string | null, spec = 0.5, name = id) {
  return {
    id, name, training_domain: domain, hyrox_specificity: spec,
    workout_family: `${id}_family`, primary_goal: domain, variants: [], blocks: [],
    estimated_minutes: 45, impact_level: 'medium', postpartum_friendly: true,
  } as any;
}

const LIBRARY = [
  tpl('s1', 'strength', 0.4), tpl('s2', 'strength', 0.8), tpl('s3', 'strength', 0.6),
  tpl('a1', 'aerobic', 0.9), tpl('a2', 'aerobic', 0.3),
  tpl('h1', 'hybrid', 1.0), tpl('r1', 'recovery', 0.1),
];

const pick = (o: Partial<Parameters<typeof pickOpportunities>[0]> = {}) =>
  pickOpportunities({
    templates: LIBRARY,
    queuedTemplateIds: new Set(),
    completedTemplateIds: new Set(),
    preferred: [], avoided: [],
    ...o,
  });

const ids = (list: Opportunity[]) => list.map(o => o.template_id);

describe('what the athlete is offered', () => {
  test('three, and only three', () => {
    // A ceiling rather than a target. More than this and the list stops being
    // readable; an athlete who wants more asks Coach.
    assert.equal(pick().length, OPPORTUNITIES_PER_WEEK);
  });

  test('loving strength gets strength', () => {
    // The whole reason this module exists. Everywhere else in the system a
    // stated preference cannot buy a third strength session: the week's counts
    // ignore preference entirely, and the scorer weights it at 0.04.
    const offered = pick({ preferred: ['strength'] });
    assert.deepEqual(offered.map(o => o.training_domain), ['strength', 'strength', 'strength']);
  });

  test('a dislike goes to the back of the menu, not out of it', () => {
    // With a thin library an avoided session may be all that is left, and an
    // empty list is worse than one the athlete scrolls past.
    const offered = pick({ avoided: ['strength', 'aerobic', 'hybrid'] });
    assert.equal(offered.length, 3);
    assert.equal(ids(offered)[0], 'r1', 'the one un-avoided domain leads');
  });

  test('the week is never offered back to itself', () => {
    const offered = pick({
      preferred: ['strength'],
      queuedTemplateIds: new Set(['s1', 's2']),
    });
    assert.ok(!ids(offered).includes('s1'));
    assert.ok(!ids(offered).includes('s2'));
    assert.equal(ids(offered)[0], 's3', 'the remaining strength session still leads');
  });

  test('two reads of the same week agree', () => {
    // A menu that reshuffles between renders reads as broken.
    assert.deepEqual(ids(pick({ preferred: ['aerobic'] })), ids(pick({ preferred: ['aerobic'] })));
  });
});

describe('an opportunity that was taken', () => {
  test('is shown as done rather than removed', () => {
    // Completing one moves no counter — the week's stimulus count is capped at
    // its target — so dropping the row too would leave the athlete no
    // acknowledgement anywhere on the tab they started it from.
    const offered = pick({
      preferred: ['strength'],
      completedTemplateIds: new Set(['s2']),
    });
    const s2 = offered.find(o => o.template_id === 's2');
    assert.ok(s2, 's2 is still listed');
    assert.equal(s2!.done, true);
  });

  test('holds its slot against a tie-break', () => {
    // Without pinning, a completed opportunity could be ranked out on the next
    // read and vanish, taking the record that it happened with it.
    const offered = pick({ completedTemplateIds: new Set(['a2']) });
    assert.equal(ids(offered)[0], 'a2');
    assert.equal(offered[0].done, true);
  });

  test('untaken ones are not marked done', () => {
    const offered = pick({ completedTemplateIds: new Set(['a2']) });
    assert.deepEqual(
      offered.filter(o => o.done).map(o => o.template_id), ['a2']);
  });
});

describe('what it refuses to invent', () => {
  test('an empty library offers nothing rather than something', () => {
    assert.deepEqual(pickOpportunities({
      templates: [], queuedTemplateIds: new Set(), completedTemplateIds: new Set(),
      preferred: ['strength'], avoided: [],
    }), []);
  });

  test('a week that already holds everything offers nothing', () => {
    const offered = pick({ queuedTemplateIds: new Set(LIBRARY.map(t => t.id)) });
    assert.deepEqual(offered, []);
  });

  test('a template with no domain is offerable but never preference-matched', () => {
    // All 34 supplementals carry a null domain, which is why preference could
    // never reach them. A null must not accidentally match a stated key.
    const offered = pickOpportunities({
      templates: [tpl('x1', null)],
      queuedTemplateIds: new Set(), completedTemplateIds: new Set(),
      preferred: ['strength'], avoided: [],
    });
    assert.equal(offered.length, 1);
    assert.equal(offered[0].training_domain, null);
  });
});
