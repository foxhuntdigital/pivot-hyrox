/**
 * The "What needs work" cap. Three picks, never more by adding, and never
 * fewer by force: an athlete over the cap from before it existed keeps their
 * picks until they remove some.
 */
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { canPickMore, MAX_NEEDS_WORK, needsWorkNote, toggleNeedsWork } from './needsWork.ts';

describe('What needs work', () => {
  test('picks up to three', () => {
    let picks: string[] = [];
    for (const v of ['a', 'b', 'c']) picks = toggleNeedsWork(picks, v).next;
    assert.deepEqual(picks, ['a', 'b', 'c']);
    assert.equal(MAX_NEEDS_WORK, 3);
  });

  test('a fourth is refused and changes nothing', () => {
    const r = toggleNeedsWork(['a', 'b', 'c'], 'd');
    assert.equal(r.blocked, true);
    assert.equal(r.picked, false);
    assert.deepEqual(r.next, ['a', 'b', 'c']);
    assert.equal(canPickMore(['a', 'b', 'c']), false);
  });

  test('taking one off is always allowed, at or over the cap', () => {
    assert.deepEqual(toggleNeedsWork(['a', 'b', 'c'], 'b').next, ['a', 'c']);
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const r = toggleNeedsWork(seven, 'g');
    assert.equal(r.blocked, false);
    assert.equal(r.next.length, 6);
  });

  test('over the cap from before it existed: kept, and no new pick allowed', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    assert.equal(toggleNeedsWork(seven.slice(0, 6), 'g').blocked, true);
    assert.equal(needsWorkNote(seven), 'You have 7 picked. Remove 4 to keep the 3 that matter most.');
  });

  test('the note counts toward the cap', () => {
    assert.equal(needsWorkNote([]), 'Pick up to 3. 0 of 3 picked.');
    assert.equal(needsWorkNote(['a', 'b']), 'Pick up to 3. 2 of 3 picked.');
  });
});
