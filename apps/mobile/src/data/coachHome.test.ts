import assert from 'node:assert/strict';
import { test } from 'node:test';

import { basedOnLine, followUpsFor, startersFor } from './coachHome.ts';

const day = { sessionName: 'Long Hybrid 75', sessionMinutes: 75, checkedIn: true, lowSleep: false,
  finishedToday: false, hasRace: true };

test("home's starters follow the athlete's day", () => {
  const normal = startersFor(day).map(s => s.label);
  assert.deepEqual(normal.slice(0, 2), ['Why Long Hybrid 75 today?', 'I only have 30 minutes today']);
  assert.equal(normal.length, 4);

  const tired = startersFor({ ...day, lowSleep: true }).map(s => s.label);
  assert.equal(tired[0], 'I slept badly. What should I change today?');

  const done = startersFor({ ...day, finishedToday: true }).map(s => s.label);
  assert.equal(done[0], 'How did today move my progress?');
  assert.ok(!done.some(l => l.startsWith('Why Long Hybrid')), 'a finished session is not offered again');

  const short = startersFor({ ...day, sessionMinutes: 20 }).map(s => s.label);
  assert.ok(!short.includes('I only have 30 minutes today'), 'no "only 30 minutes" for a 20 minute session');

  const noRace = startersFor({ ...day, sessionName: null, hasRace: false }, 6).map(s => s.label);
  assert.ok(noRace.includes("I'm travelling this week"));
});

test('follow-ups skip what the answer already offers, and a safety answer offers none', () => {
  assert.deepEqual(followUpsFor('explain', ['ask_adapt']).map(f => f.action), ['ask_low_impact', 'ask_weakness']);
  assert.deepEqual(followUpsFor('safety', []), []);
  assert.ok(followUpsFor(null, []).length > 0);
});

test('evidence reads as one line of words, not a row of chips', () => {
  assert.equal(basedOnLine(['SLEEP 7:30', 'EQUIPMENT PROFILE', 'Build week 8']),
    'Based on sleep 7:30, equipment profile and build week 8');
  assert.equal(basedOnLine(["Today's plan"]), "Based on today's plan");
  assert.equal(basedOnLine(['build · week 8', 'Sleep 7:12']), 'Based on build · week 8 and sleep 7:12');
  assert.equal(basedOnLine([]), null);
});
