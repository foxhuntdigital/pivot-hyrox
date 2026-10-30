/**
 * The race date chips.
 *
 * The case that matters is the order an athlete actually taps in: year first.
 * Until a month is chosen there is no date to save, and the year still has to
 * stick.
 */
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { readDateChoice, tapDateChip, type DateChooserState } from './dateChoice.ts';

const TODAY = '2026-10-30';
const EMPTY: DateChooserState = { value: null, heldYear: null };

describe('race date chips', () => {
  test('offers this year and next, defaulting to this year', () => {
    const c = readDateChoice(null, null, TODAY);
    assert.deepEqual(c.years, [2026, 2027]);
    assert.equal(c.year, 2026);
    assert.equal(c.month, null);
  });

  test('a year tapped before a month stays selected', () => {
    const s = tapDateChip(EMPTY, TODAY, { year: 2027 });
    assert.equal(s.value, null, 'no month yet, so nothing to save');
    assert.equal(readDateChoice(s.value, s.heldYear, TODAY).year, 2027);
  });

  test('year, then month, then day builds the date in the tapped year', () => {
    let s = tapDateChip(EMPTY, TODAY, { year: 2027 });
    s = tapDateChip(s, TODAY, { month: 3 });
    assert.equal(s.value, '2027-03-01');
    s = tapDateChip(s, TODAY, { day: 14 });
    assert.equal(s.value, '2027-03-14');
  });

  test('changing the year after a full date keeps month and day', () => {
    let s = tapDateChip(EMPTY, TODAY, { month: 3 });
    s = tapDateChip(s, TODAY, { day: 14 });
    s = tapDateChip(s, TODAY, { year: 2027 });
    assert.equal(s.value, '2027-03-14');
  });

  test('clamps the day when the month is shorter', () => {
    let s = tapDateChip(EMPTY, TODAY, { year: 2027 });
    s = tapDateChip(s, TODAY, { month: 1 });
    s = tapDateChip(s, TODAY, { day: 31 });
    s = tapDateChip(s, TODAY, { month: 2 });
    assert.equal(s.value, '2027-02-28');
  });
});
