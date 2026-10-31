import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkinLine, readinessLine } from './todayView.ts';
import { variantOverrideFailed, variantSource, variantStep } from './variantChoice.ts';

test('thin data reads as a baseline, never as a bare low score', () => {
  assert.deepEqual(readinessLine({ overall: 23, confidence: 'low', observed: ['aerobic', 'recovery'] }),
    { headline: 'Building a baseline', detail: '2 of 6 areas measured' });
  assert.deepEqual(readinessLine({ overall: null, confidence: 'medium', observed: [] }),
    { headline: 'Building a baseline', detail: '0 of 6 areas measured' });
});

test('a score with confidence says a word, the number and how sure it is', () => {
  assert.deepEqual(readinessLine({ overall: 62, confidence: 'medium', observed: ['a', 'b', 'c', 'd', 'e'] }),
    { headline: 'On track · 62', detail: 'Medium confidence · 5 of 6 areas measured' });
  assert.equal(readinessLine({ overall: 84, confidence: 'high', observed: [] }).headline, 'Race ready · 84');
  assert.equal(readinessLine({ overall: 30, confidence: 'high', observed: [] }).headline, 'Early days · 30');
});

test('the check-in row asks until answered, then says what was reported', () => {
  const ask = checkinLine({ checkedIn: false, sleepClock: null, lowSleep: false, energy: null, finishedToday: false });
  assert.equal(ask.action, 'Check in');
  assert.match(ask.detail, /20 seconds/);
  const after = checkinLine({ checkedIn: false, sleepClock: null, lowSleep: false, energy: null, finishedToday: true });
  assert.match(after.detail, /Still worth logging/);
  const done = checkinLine({ checkedIn: true, sleepClock: '7:20', lowSleep: false, energy: 'normal', finishedToday: false });
  assert.deepEqual([done.title, done.action, done.warn], ['Slept 7:20 · normal energy', 'Edit', false]);
  const short = checkinLine({ checkedIn: true, sleepClock: '4:30', lowSleep: true, energy: 'low', finishedToday: false });
  assert.equal(short.warn, true);
  assert.match(short.detail, /Short night/);
});

test('choosing a length keeps its rules: recovery asks, a symptom stops, the rest is unavailable', () => {
  assert.deepEqual(variantStep({ ok: true }, 'FULL', 'x'), { kind: 'go' });
  const recovery = variantStep({ ok: false, reason: 'recovery' }, 'FULL', 'your check-in');
  assert.ok(recovery.kind === 'confirm' && recovery.confirmLabel === 'Do the FULL'
    && /Based on your check-in/.test(recovery.body));
  const symptom = variantStep({ ok: false, reason: 'symptom' }, 'FULL', 'x');
  assert.ok(symptom.kind === 'alert' && /symptom/.test(symptom.body));
  const unavailable = variantStep({ ok: false, reason: 'unavailable' }, 'FULL', 'x');
  assert.ok(unavailable.kind === 'alert' && /equipment and constraints/.test(unavailable.body));
  assert.equal(variantOverrideFailed('FULL').kind, 'alert');
});

test('a refusal names only the evidence the athlete gave', () => {
  assert.equal(variantSource({ checkedIn: true, energy: 'normal' }), 'your check-in');
  assert.equal(variantSource({ checkedIn: false, energy: 'low' }), 'the energy you reported');
  assert.equal(variantSource({ checkedIn: false, energy: 'normal' }), 'what you have told me about today');
});
