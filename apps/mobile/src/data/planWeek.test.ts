import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildWeek, clock, displayName, doTodayStep, effortOf, overrideFailed, type TemplateLook,
} from './planWeek.ts';
import type { CompletedThisWeek, QueuedSession } from './todayRepo.ts';

const look = (kind: TemplateLook['kind'], effort: 1 | 2 | 3, extra = {}): TemplateLook =>
  ({ kind, effort, description: null, supplemental: false, ...extra });
const LOOKS: Record<string, TemplateLook> = {
  run_easy: look('run', 1),
  squat: look('strength', 3),
  carry: look('station', 3),
  ski: look('erg', 2),
  core: look('strength', 1, { supplemental: true }),
  bonus_row: look('erg', 1),
};
const lookup = (id: string) => LOOKS[id] ?? null;

const done = (id: string, template: string, extra: Partial<CompletedThisWeek> = {}): CompletedThisWeek => ({
  session_id: id, client_session_id: null, template_id: template, name: template, stimulus: null,
  estimated_minutes: 40, variant: 'green', session_rpe: null, ended_early: false,
  completed_on: '2026-11-02', ...extra,
});
const queued = (id: string, template: string, minutes = 45, state: QueuedSession['state'] = 'queued'): QueuedSession =>
  ({ id, template_id: template, name: template, stimulus_type: 'strength', rank: 1, state, estimated_minutes: minutes });

const week = (over: Partial<Parameters<typeof buildWeek>[0]> = {}) => buildWeek({
  completed: [], pendingSession: null, today: null, upNext: [], skipped: [], opportunities: [],
  look: lookup, ...over,
});

test('tiles run done, today, to do, then skipped', () => {
  const w = week({
    completed: [done('s1', 'run_easy')],
    today: { templateId: 'squat', name: 'squat', minutes: 60, queued: queued('q0', 'squat', 60) },
    upNext: [queued('q1', 'carry', 20), queued('q2', 'ski', 35)],
    skipped: [queued('q3', 'run_easy', 30, 'skipped')],
  });
  assert.deepEqual(w.tiles.map(t => t.state), ['done', 'today', 'todo', 'todo', 'skipped']);
  assert.equal(w.done, 1);
  assert.equal(w.planned, 4, 'a skipped session is not part of the count');
  assert.equal(w.left, 3);
  assert.equal(w.leftLine, `3 left · ${clock(115)}`);
});

test('a session ended early says so on its row', () => {
  const w = week({ completed: [done('s1', 'squat', { ended_early: true, estimated_minutes: 60 })] });
  assert.equal(w.tiles[0].endedEarly, true);
  assert.equal(w.tiles[0].subline, 'Done · ended early · 60 min');
});

test('a bonus or supplemental is an extra and never counts toward the plan', () => {
  const w = week({
    completed: [done('s1', 'squat'), done('s2', 'bonus_row'), done('s3', 'core')],
    upNext: [queued('q1', 'carry')],
    opportunities: [{ template_id: 'bonus_row', name: 'Row', training_domain: 'aerobic',
      stimulus: null, estimated_minutes: 30, done: true }],
  });
  assert.deepEqual(w.tiles.map(t => t.extra), [false, true, true, false]);
  assert.equal(w.done, 1);
  assert.equal(w.planned, 2);
  assert.match(w.tiles[1].subline, /extra/);
});

test('a finish this device knows about counts before the server has it', () => {
  const w = week({ pendingSession: { template_id: 'squat', name: 'Lower Strength — Squat', estimated_minutes: 60 } });
  assert.equal(w.tiles[0].state, 'done');
  assert.equal(w.tiles[0].name, 'Lower Strength · Squat');
  assert.equal(w.leftLine, 'Week complete');
});

test('rows say how a session will feel, in words', () => {
  const w = week({ upNext: [queued('q1', 'run_easy', 40), queued('q2', 'carry', 20)] });
  assert.equal(w.tiles[0].subline, 'Easy run · 40 min');
  assert.equal(w.tiles[1].subline, 'Hard station work · 20 min');
});

test('an empty week says nothing rather than claiming it is complete', () => {
  assert.equal(week().leftLine, '');
});

test('loaded work for time reads as a circuit, not as heavy lifting', () => {
  const w = buildWeek({
    completed: [], pendingSession: null, today: null, skipped: [], opportunities: [],
    upNext: [queued('q1', 'emom', 24)],
    look: () => ({ kind: 'strength', effort: 3, description: null, supplemental: false, circuit: true }),
  });
  assert.equal(w.tiles[0].subline, 'Hard circuit · 24 min');
});

test('names, effort and time read the way the screen shows them', () => {
  assert.equal(displayName('Pull Strength — Vertical Foundation'), 'Pull Strength · Vertical Foundation');
  assert.equal(displayName('Easy Run + Strides'), 'Easy Run + Strides');
  assert.deepEqual([effortOf(3), effortOf(4), effortOf(6), effortOf(7), effortOf(null)], [1, 1, 2, 3, 2]);
  assert.equal(clock(195), '3 h 15');
  assert.equal(clock(45), '45 min');
});

test('Do today keeps its warnings: recovery asks, a symptom stops, the rest points at Adapt', () => {
  assert.deepEqual(doTodayStep({ ok: true }, 'X'), { kind: 'go' });

  const recovery = doTodayStep({ ok: false, reason: 'recovery' }, 'Sled Push');
  assert.equal(recovery.kind, 'confirm');
  assert.ok(recovery.kind === 'confirm' && recovery.confirmLabel === 'Do it anyway');
  assert.ok(recovery.kind === 'confirm' && /more than today supports/.test(recovery.title));

  const symptom = doTodayStep({ ok: false, reason: 'symptom' }, 'Sled Push');
  assert.equal(symptom.kind, 'alert');
  assert.ok(symptom.kind === 'alert' && /symptom/.test(symptom.body));

  const unavailable = doTodayStep({ ok: false, reason: 'unavailable' }, 'Sled Push');
  assert.ok(unavailable.kind === 'alert' && /Adapt from the Today tab/.test(unavailable.body));

  assert.ok(overrideFailed('X').kind === 'alert');
});
