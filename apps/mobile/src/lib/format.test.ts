import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deltaWords } from './format.ts';

test('a change says its direction with an arrow and where it started', () => {
  assert.deepEqual(deltaWords({ now: 62, from: 47, since: '4 weeks ago' }),
    { text: '↑ 15 from 47, 4 weeks ago', bad: false });
  assert.deepEqual(deltaWords({ now: 40, from: 47, since: 'Sep 1' }),
    { text: '↓ 7 from 47, Sep 1', bad: true });
});

test('down is good when smaller is better', () => {
  assert.deepEqual(deltaWords({ now: 281, from: 292, since: '4 weeks ago', goodWhen: 'down', unit: ' s' }),
    { text: '↓ 11 s from 292 s, 4 weeks ago', bad: false });
});

test('no change is said as level, not as a zero', () => {
  assert.deepEqual(deltaWords({ now: 50, from: 50, since: 'last week' }),
    { text: 'Level with last week', bad: false });
});
