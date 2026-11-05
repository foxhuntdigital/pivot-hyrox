import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clockTime, deltaWords, headerDateLabel, isoDayLabel } from './format.ts';

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

test('dates read month before day, as a US-first app', () => {
  assert.equal(headerDateLabel(new Date(2026, 7, 19)), 'Wed Aug 19');
  assert.equal(isoDayLabel('2026-03-14'), 'Sat Mar 14');
  assert.equal(isoDayLabel('2026-03-01'), 'Sun Mar 1');
});

test('a plan date is the day the server named, not the device\'s', () => {
  // Midnight UTC is the previous evening in the Americas: read in the device's
  // own zone, an athlete in Los Angeles would see the day before their race.
  assert.equal(isoDayLabel('2026-01-01'), 'Thu Jan 1');
});

test('a malformed plan date says nothing rather than "Invalid Date"', () => {
  assert.equal(isoDayLabel('not-a-date'), '');
});

test('the clock is 12-hour with a meridiem, and 12 is never 0', () => {
  assert.equal(clockTime(new Date(2026, 2, 14, 17, 5)), '5:05 PM');
  assert.equal(clockTime(new Date(2026, 2, 14, 9, 30)), '9:30 AM');
  assert.equal(clockTime(new Date(2026, 2, 14, 12, 0)), '12:00 PM');
  assert.equal(clockTime(new Date(2026, 2, 14, 0, 7)), '12:07 AM');
});
