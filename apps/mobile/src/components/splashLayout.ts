/**
 * Where everything in the launch splash sits, and when it moves.
 *
 * Pure, so the one claim that matters can be tested without a device: the
 * lock-up the splash ends on is the app header's mark at exactly twice its
 * size, and the hand-off lands it on the header's own position at half scale.
 *
 * The story it draws: a red runner comes up the middle of three lanes, makes
 * one hard right-angle turn (the pivot), and runs out along the top. Its tail
 * follows it round, so what it leaves behind is the header's red square at the
 * corner and the PIVOT ENGINE wordmark along the straight it just ran.
 */

/** The header mark is 12 px with an 8 px gap and 11 px type; the splash is twice that. */
export const SCALE = 2;
export const SQUARE = 12 * SCALE;
export const GAP = 8 * SCALE;
export const WORD_SIZE = 11 * SCALE;
export const WORD_TRACKING = 1.76 * SCALE;
/** Each lane is wide enough that the runner reads as running in it, not filling it. */
export const LANE = 40;

/** Milliseconds from mount. */
export const T = {
  /** The native splash's charcoal fades to ink while the lanes draw. */
  groundFade: [0, 300],
  lines: [0, 420],
  /** Head up the lane, then round the corner and out along the top. */
  headUp: [120, 620],
  headOut: [620, 880],
  /** The tail follows the same path, a little behind. */
  tailUp: [300, 760],
  tailOut: [760, 1080],
  linesOut: [700, 1000],
  /** A beat on the finished lock-up before the hand-off. */
  hold: 200,
  handOff: 480,
  reducedFade: 240,
} as const;

export const DRAWN_AT = T.tailOut[1];

export interface SplashLayout {
  /** The corner, which is also where the red square ends up. */
  sqX: number;
  sqY: number;
  /** Where the wordmark starts and the run along the top finishes. */
  wordX: number;
  runEnd: number;
  lockW: number;
  /** The four track lines, left to right, and how far up they reach. */
  lineXs: number[];
  linesTop: number;
  /**
   * The hand-off: scale and offset that land the lock-up on the header mark,
   * and `landAt`, how far through the (eased) wipe the ground's rising edge
   * passes the header. The mark arrives exactly then, so it travels over ink
   * the whole way and only meets the app's paper once it is in place.
   */
  handOff: { scale: number; dx: number; dy: number; landAt: number };
}

/**
 * `wordW` is the measured width of the wordmark at splash size. `headerTop` is
 * the y of the header row's top edge (safe-area inset plus the header's own
 * padding); the 12 px square is vertically centred in a row as tall as the
 * eyebrow's line, `headerRowH`.
 */
export function splashLayout(args: {
  W: number;
  H: number;
  wordW: number;
  gutter: number;
  headerTop: number;
  headerRowH: number;
}): SplashLayout {
  const { W, H, wordW, gutter, headerTop, headerRowH } = args;
  const lockW = SQUARE + GAP + wordW;
  const sqX = Math.round((W - lockW) / 2);
  // A little above centre: the eye's centre of a tall screen sits high.
  const sqY = Math.round(H * 0.46 - SQUARE / 2);
  const wordX = sqX + SQUARE + GAP;
  const runEnd = wordX + wordW;

  const laneMid = sqX + SQUARE / 2;
  const lineXs = [-1.5, -0.5, 0.5, 1.5].map(k => Math.round(laneMid + k * LANE) - 1);
  const linesTop = sqY - 2 * LANE;

  // RN scales about the centre, so the offset is from the lock-up's centre to
  // where its centre must be for the scaled square to sit on the header's.
  const scale = 1 / SCALE;
  const targetLeft = gutter;
  const targetTop = headerTop + (headerRowH - SQUARE * scale) / 2;
  const dx = targetLeft + (lockW * scale) / 2 - (sqX + lockW / 2);
  const dy = targetTop + (SQUARE * scale) / 2 - (sqY + SQUARE / 2);

  const landAt = 1 - (targetTop + (SQUARE * scale) / 2) / H;

  return { sqX, sqY, wordX, runEnd, lockW, lineXs, linesTop, handOff: { scale, dx, dy, landAt } };
}
