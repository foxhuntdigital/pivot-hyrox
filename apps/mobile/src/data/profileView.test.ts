import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  changedIds, enjoySummary, equipmentGroups, equipmentSummary, goalChange, healthSummary,
  needsWorkSummary, rebuildConsequence, trainingSince, weeksUntil,
} from './profileView.ts';

const KIT = [
  { id: 'ex_ski', name: 'SkiErg', category: 'cardio' },
  { id: 'rower', name: 'Rower', category: 'cardio' },
  { id: 'sled', name: 'Sled', category: 'hyrox' },
  { id: 'bar', name: 'Barbell', category: 'strength' },
  { id: 'db', name: 'Dumbbells', category: 'strength' },
  { id: 'kb', name: 'Kettlebells', category: 'strength' },
  { id: 'rope', name: 'Jump rope', category: 'conditioning' },
];
const RACE = { race: { name: 'Vegas HYROX', event_date: '2027-03-14', division: 'open' }, total_weeks: 20 };
const draft = (over = {}) => ({ mode: 'race' as const, name: 'Vegas HYROX', date: '2027-03-14', division: 'open', weeks: 12, ...over });

describe('Profile view', () => {
  test('equipment groups follow the kit, and the summary names race kit first', () => {
    assert.deepEqual(equipmentGroups(KIT).map(g => g.title), ['Cardio', 'Race kit', 'Strength', 'Conditioning']);
    assert.equal(equipmentSummary(['bar', 'sled', 'ex_ski', 'db', 'kb', 'rope'], KIT),
      '6 items · Sled, SkiErg, Barbell, Dumbbells, Kettlebells…');
    assert.equal(equipmentSummary(['bar'], KIT), '1 item · Barbell');
    assert.equal(equipmentSummary([], KIT), 'Nothing ticked · bodyweight sessions only');
  });

  test('summaries say what was stated and nothing more', () => {
    const options = [{ value: 'strength', label: 'Strength' }, { value: 'aerobic', label: 'Easy aerobic' }];
    assert.equal(enjoySummary({ strength: 'love', aerobic: 'rather_not' }, options), 'Love strength · Rather not easy aerobic');
    assert.equal(enjoySummary({}, options), 'Nothing set · sessions rank on your plan alone');
    assert.equal(needsWorkSummary(['aerobic'], options), 'Easy aerobic · 1 of 3');
    assert.equal(healthSummary(['Postpartum'], '9 months postpartum'), '9 months postpartum');
    assert.equal(healthSummary([], null), 'Nothing set');
    assert.equal(trainingSince([{ date: '2026-10-30' }, { date: '2026-09-07' }]), 'Training since Sep 7 · 2 sessions');
  });

  test('a draft counts only what actually changed', () => {
    assert.deepEqual([...changedIds(['a', 'b'], ['b', 'c'])].sort(), ['a', 'c']);
    assert.equal(changedIds(['a'], ['a']).size, 0);
    assert.match(rebuildConsequence(3, 'with what you have'), /^Your 3 sessions left this week are rebuilt/);
    assert.match(rebuildConsequence(1, 'x'), /^Your session left this week is rebuilt/);
    assert.match(rebuildConsequence(0, 'x'), /^No sessions are left/);
  });

  test('a goal edit rebuilds only when the runway moves', () => {
    assert.equal(goalChange(RACE, draft()), 'none');
    assert.equal(goalChange(RACE, draft({ name: 'Vegas HYROX Pro', division: 'pro' })), 'details');
    assert.equal(goalChange(RACE, draft({ date: '2027-02-06' })), 'rebuild');
    assert.equal(goalChange(RACE, draft({ mode: 'block' })), 'rebuild');
    const block = { race: null, total_weeks: 12 };
    assert.equal(goalChange(block, draft({ mode: 'block', weeks: 12 })), 'none');
    assert.equal(goalChange(block, draft({ mode: 'block', weeks: 16 })), 'rebuild');
    assert.equal(goalChange(block, draft()), 'rebuild');
  });

  test('weeks until a date round up', () => {
    assert.equal(weeksUntil('2026-10-31', '2027-01-23'), 12);
    assert.equal(weeksUntil('2026-10-31', '2026-10-01'), 0);
  });
});
