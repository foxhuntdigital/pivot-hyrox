import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DRAWN_AT, GAP, LANE, SQUARE, T, splashLayout } from './splashLayout.ts';

const base = { W: 390, H: 844, wordW: 190, gutter: 20, headerTop: 57, headerRowH: 15 };

test('the lock-up is centred and the run along the top ends where the word does', () => {
  const l = splashLayout(base);
  assert.equal(l.lockW, SQUARE + GAP + 190);
  assert.ok(Math.abs(l.sqX + l.lockW / 2 - 195) <= 0.5);
  assert.equal(l.wordX, l.sqX + SQUARE + GAP);
  assert.equal(l.runEnd, l.wordX + 190);
});

test('the runner takes the middle of three lanes', () => {
  const l = splashLayout(base);
  assert.equal(l.lineXs.length, 4);
  const mid = (l.lineXs[1] + l.lineXs[2]) / 2 + 1;
  assert.ok(Math.abs(mid - (l.sqX + SQUARE / 2)) <= 1);
  assert.ok(l.lineXs.every((x, i) => i === 0 || Math.abs(x - l.lineXs[i - 1] - LANE) <= 1));
});

test('the hand-off lands the square on the header mark at its size', () => {
  const l = splashLayout(base);
  const { scale, dx, dy } = l.handOff;
  // Scaled about the lock-up's centre, then offset.
  const cx = l.sqX + l.lockW / 2 + dx;
  const cy = l.sqY + SQUARE / 2 + dy;
  const squareLeft = cx - (l.lockW * scale) / 2;
  const squareTop = cy - (SQUARE * scale) / 2;
  assert.equal(SQUARE * scale, 12);
  assert.ok(Math.abs(squareLeft - 20) < 1e-9);
  assert.ok(Math.abs(squareTop - (57 + (15 - 12) / 2)) < 1e-9);
});

test("the ground's rising edge reaches the header just as the mark lands there", () => {
  const l = splashLayout(base);
  const edgeY = base.H * (1 - l.handOff.landAt);
  assert.ok(Math.abs(edgeY - (57 + 15 / 2)) < 1e-9);
  assert.ok(l.handOff.landAt > 0.8 && l.handOff.landAt < 1);
});

test('the tail never overtakes the head', () => {
  assert.ok(T.tailUp[0] > T.headUp[0] && T.tailUp[1] > T.headUp[1]);
  assert.ok(T.tailOut[0] >= T.headOut[0] && T.tailOut[1] > T.headOut[1]);
  assert.equal(DRAWN_AT, T.tailOut[1]);
});
