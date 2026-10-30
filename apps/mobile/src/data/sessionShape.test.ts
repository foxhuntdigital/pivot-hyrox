import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  MAX_BARS, movementKind, rpeOf, sessionKind, sessionShape, simplify, type ShapeBar,
} from './sessionShape.ts';

const content = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
const exercises = new Map(content.exercises.map((e: any) => [e.id, e]));
const templates: any[] = content.templates;
const byId = (id: string) => {
  const t = templates.find(x => x.id === id);
  assert.ok(t, `${id} is not in the bundle`);
  return t;
};
const shapeOf = (t: any) => sessionShape(t.blocks, { exercises, intensityTarget: t.intensity_target });
const kindOf = (t: any) => sessionKind(t, shapeOf(t));
const gaps = (bars: ShapeBar[]) => bars.filter(b => b.effort === 0).length;

test('every session in the library draws a usable shape', () => {
  const broken: string[] = [];
  for (const t of templates) {
    const bars = shapeOf(t);
    const why = !bars.length ? 'no bars'
      : bars.length > MAX_BARS ? `${bars.length} bars`
      : bars.some(b => !Number.isFinite(b.grow) || b.grow <= 0) ? 'a bar with no width'
      : bars.some(b => b.effort < 0 || b.effort > 1) ? 'effort out of range'
      : bars[0].effort === 0 || bars[bars.length - 1].effort === 0 ? 'starts or ends on rest'
      : null;
    if (why) broken.push(`${t.id}: ${why}`);
  }
  assert.deepEqual(broken, []);
});

test('an easy steady run is one long low bar', () => {
  const bars = shapeOf(byId('wo_zone_2_run_30'));
  assert.equal(bars.length, 1);
  assert.equal(bars[0].kind, 'run');
  assert.ok(bars[0].effort <= 0.4);
});

test('working sets are drawn as sets, with their rest between them', () => {
  // Back squat 4 sets: at least three rests inside the first lift alone.
  const bars = shapeOf(byId('str_lower_01'));
  assert.ok(gaps(bars) >= 3);
  assert.ok(bars.some(b => b.effort >= 0.7), 'the anchor lift is drawn hard');
});

test('an EMOM leaves the rest of each minute as rest', () => {
  const bars = shapeOf(byId('me_emom_02'));
  assert.ok(gaps(bars) >= 6, `expected a gap per minute, got ${gaps(bars)}`);
});

test('an AMRAP lasts as long as its clock', () => {
  const bars = shapeOf(byId('me_metcon_06'));
  const total = bars.reduce((s, b) => s + b.grow, 0);
  assert.ok(Math.abs(total - 20 * 60) < 1, `drawn ${total}s for a 20 minute AMRAP`);
});

test('the kind of a session follows what it is', () => {
  assert.equal(kindOf(byId('wo_zone_2_run_30')), 'run');
  assert.equal(kindOf(byId('wo_ski_zone_2_30')), 'erg');
  assert.equal(kindOf(byId('str_pull_new_01')), 'strength');
  assert.equal(kindOf(byId('wo_long_hybrid_75')), 'hybrid');
  assert.equal(kindOf(byId('mx_sled_push_strength_power')), 'station');
  // A dumbbell EMOM is resistance work, not a station, even with a carry in it.
  assert.equal(kindOf(byId('me_emom_01')), 'strength');
  // A station session is a station session even where the station is short.
  assert.equal(kindOf(byId('mx_burpee_broad_jump_strength_power')), 'station');
});

test('every kind is used, and no session falls through to nothing', () => {
  const seen = new Set(templates.map(kindOf));
  for (const k of ['run', 'erg', 'station', 'strength', 'hybrid', 'recovery']) {
    assert.ok(seen.has(k as any), `no session is ${k}`);
  }
});

test('movements are told apart by modality and category', () => {
  assert.equal(movementKind(exercises.get('ex_run') as any), 'run');
  assert.equal(movementKind(exercises.get('ex_rowerg') as any), 'erg');
  assert.equal(movementKind(exercises.get('ex_sled_push') as any), 'station');
  assert.equal(movementKind(exercises.get('ex_back_squat') as any), null);
  assert.equal(movementKind(undefined), null);
});

test('effort reads numbers first, then words', () => {
  assert.equal(rpeOf('RPE 6-7'), 7);
  assert.equal(rpeOf('RPE 7.5'), 7.5);
  assert.equal(rpeOf('crisp quality, RPE 5-6'), 6);
  assert.equal(rpeOf('easy cooldown'), 3);
  assert.equal(rpeOf(null), null);
});

test('simplifying keeps the long rests and drops the short ones', () => {
  const long: ShapeBar = { grow: 300, effort: 0, kind: null };
  const bars: ShapeBar[] = [];
  for (let i = 0; i < 40; i++) bars.push({ grow: 30, effort: 0.6, kind: null }, { grow: 2, effort: 0, kind: null });
  bars.push(long, { grow: 600, effort: 0.3, kind: 'run' });
  const out = simplify(bars, 10);
  assert.ok(out.length <= 10);
  assert.ok(out.some(b => b.effort === 0 && b.grow >= 300), 'the long rest survives');
  const before = bars.reduce((s, b) => s + b.grow, 0) - 2;  // the trailing short gap before the long rest folds in
  assert.ok(Math.abs(out.reduce((s, b) => s + b.grow, 0) - before) <= 2, 'no time is lost');
});
