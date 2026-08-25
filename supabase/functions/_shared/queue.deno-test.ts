/**
 * What may be done to a week that is already underway.
 *
 * The rule these pin down is the same one in both directions: the plan can be
 * changed, what happened cannot. A session in progress or completed is not a
 * queue entry any more, and moving one would contradict a stimulus credit that
 * has already been applied.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { claimableFor, validateReshape, type QueueItem } from './queue.ts';
import { HttpError } from './context.ts';

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'q1',
  workout_template_id: 't_long_run',
  stimulus_type: 'aerobic_durability',
  rank: 0,
  state: 'queued',
  ...over,
});

const index = (items: QueueItem[]) => new Map(items.map(q => [q.id, q]));

/** The status a rejected reshape answers with, or null when it was accepted. */
function reject(items: QueueItem[], keep: string[], drop: string[]): number | null {
  try {
    validateReshape(index(items), keep, drop);
    return null;
  } catch (e) {
    return e instanceof HttpError ? e.status : 500;
  }
}

describe('Reshaping a week', () => {
  test('a reorder and a drop together are accepted', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', rank: 1 }), item({ id: 'c', rank: 2 })];
    assert.equal(reject(items, ['b', 'a'], ['c']), null);
  });

  test('a change that changes nothing is a bad request', () => {
    assert.equal(reject([item()], [], []), 400);
  });

  test('a session cannot be both kept and dropped', () => {
    assert.equal(reject([item({ id: 'a' })], ['a'], ['a']), 400);
  });

  test('a session named twice is a bad request', () => {
    // Otherwise it would take two ranks, and the second write would win
    // silently.
    const items = [item({ id: 'a' }), item({ id: 'b' })];
    assert.equal(reject(items, ['a', 'a', 'b'], []), 400);
  });

  test('a session from another week is refused', () => {
    assert.equal(reject([item({ id: 'a' })], ['a', 'elsewhere'], []), 400);
  });

  test('a session in progress cannot be moved', () => {
    const items = [item({ id: 'a', state: 'in_progress' })];
    assert.equal(reject(items, ['a'], []), 409, 'a conflict, not a bad request');
  });

  test('a completed session cannot be dropped', () => {
    const items = [item({ id: 'a', state: 'completed' })];
    assert.equal(reject(items, [], ['a']), 409);
  });

  test('a dropped session can be put back', () => {
    // This is what makes Coach's undo work: a skipped session has to be
    // returnable to the week it was taken out of.
    const items = [item({ id: 'a', state: 'skipped' })];
    assert.equal(reject(items, ['a'], []), null);
  });
});

describe('Claiming a queued session', () => {
  test('the lowest-ranked open item for that template', () => {
    const items = [
      item({ id: 'late', rank: 5 }),
      item({ id: 'next', rank: 1 }),
      item({ id: 'other', rank: 0, workout_template_id: 't_ski' }),
    ];
    assert.equal(claimableFor(items, 't_long_run')?.id, 'next');
  });

  test('a recommended item is claimable', () => {
    const items = [item({ id: 'a', state: 'recommended' })];
    assert.equal(claimableFor(items, 't_long_run')?.id, 'a');
  });

  test('an item already in progress is not claimed again', () => {
    // Starting the same template twice must not re-claim the row the first
    // session is already performing.
    const items = [item({ id: 'a', state: 'in_progress' })];
    assert.equal(claimableFor(items, 't_long_run'), null);
  });

  test('a completed or skipped item is not claimable', () => {
    assert.equal(claimableFor([item({ state: 'completed' })], 't_long_run'), null);
    assert.equal(claimableFor([item({ state: 'skipped' })], 't_long_run'), null);
  });

  test('an off-plan session claims nothing', () => {
    // The session is still recorded; it just credits no stimulus.
    assert.equal(claimableFor([item()], 't_not_in_the_week'), null);
  });
});
