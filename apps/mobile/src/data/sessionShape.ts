/**
 * The session-shape graphic, as data (redesign plan, design system).
 *
 * A session drawn from its own blocks: width is time, height is effort, a gap
 * is rest. It is what lets a week, a day or a Coach card say how a session
 * will feel before anyone reads it: a long flat bar is an easy run, a comb of
 * tall teeth is intervals, stepped blocks with gaps are sets.
 *
 * Pure and deterministic, so it is tested against the whole library rather
 * than eyeballed on a few sessions. Every time it estimates is an estimate:
 * the graphic compares the parts of ONE session with each other, so a carry
 * guessed at a metre a second only has to be in proportion with the rest
 * between its sets, not right to the second.
 */
import type { SessionKind } from '../theme/tokens';

/** What a single movement is, where it says: the three kinds a movement can be by itself. */
export type MovementKind = 'run' | 'erg' | 'station';

export interface ShapeExercise {
  category?: string | null;
  modality?: string | null;
}

export interface ShapeItem {
  exercise_id: string;
  prescription_type: string;
  quantity: number;
  quantity_unit: string;
  intensity_note?: string | null;
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  rest_seconds?: number | null;
  target_rpe?: number | null;
}

export interface ShapeBlock {
  block_type: string;
  rounds?: number | null;
  duration_minutes?: number | null;
  rest_seconds?: number | null;
  exercises: ShapeItem[];
}

/**
 * One bar. `grow` is its share of the width (seconds, before scaling).
 * `effort` is 0-1, and 0 means rest: drawn as a gap. `kind` tints the bar
 * when the movement is one by itself (a run inside a hybrid); null takes the
 * session's own colour.
 */
export interface ShapeBar {
  grow: number;
  effort: number;
  kind: MovementKind | null;
}

/** More than this and a 300 px wide graphic is drawing bars under a pixel. */
export const MAX_BARS = 48;

/** The lowest a working bar is drawn, so an easy effort is still visibly work. */
const FLOOR = 0.15;

/** Between blocks: a change of task, drawn as a short gap. */
const BLOCK_GAP_S = 30;

/** The share of the rest between working sets that is drawn as a gap. */
const SET_GAP = 0.3;

export function movementKind(ex: ShapeExercise | undefined): MovementKind | null {
  if (!ex) return null;
  const m = ex.modality ?? '';
  if (m === 'running' || m === 'run_skill') return 'run';
  if (m === 'row' || m === 'ski' || m === 'bike') return 'erg';
  if (ex.category === 'hyrox') return 'station';
  return null;
}

/* ── effort ───────────────────────────────────────────────────────────────── */

/** Words the library uses in place of a number, on the RPE scale. */
const EFFORT_WORDS: [RegExp, number][] = [
  [/\b(max|all[- ]out|sprint)\b/i, 9],
  [/\b(hard|race|fast)\b/i, 8],
  [/\bthreshold\b/i, 7],
  [/\b(moderate|tempo|strong)\b/i, 6],
  [/\b(steady|controlled|smooth|crisp)\b/i, 5],
  [/\b(easy|comfortable|conversational)\b/i, 3],
  [/\b(recovery|cool-?down|warm-?up|mobility)\b/i, 2],
];

/** The top of the first RPE in a string ("RPE 6-7" → 7), or a word's value. */
export function rpeOf(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/RPE\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/i);
  if (m) return Number(m[2] ?? m[1]);
  for (const [re, v] of EFFORT_WORDS) if (re.test(text)) return v;
  return null;
}

const heightOf = (rpe: number) => Math.min(1, Math.max(FLOOR, rpe / 10));

/* ── time ─────────────────────────────────────────────────────────────────── */

/** Seconds per metre, by what is covering the ground. */
const PACE: Record<MovementKind | 'other', number> = {
  run: 0.33,      // about 5:30 a kilometre
  erg: 0.24,      // about 2:00 a 500 m
  station: 1.0,   // sleds, carries, lunges: slow, loaded ground
  other: 1.0,
};

function metres(qty: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'km') return qty * 1000;
  if (u === 'ft') return qty * 0.3048;
  if (u === 'mi' || u === 'mile' || u === 'miles') return qty * 1609;
  if (u === 'yd') return qty * 0.9144;
  return qty;
}

function seconds(qty: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('min')) return qty * 60;
  if (u === 'h' || u.startsWith('hour')) return qty * 3600;
  return qty;
}

/** Time for one pass of an item (one set, for sets work). */
function workSeconds(it: ShapeItem, kind: MovementKind | null): number {
  switch (it.prescription_type) {
    case 'duration': return seconds(it.quantity, it.quantity_unit);
    case 'distance': return metres(it.quantity, it.quantity_unit) * PACE[kind ?? 'other'];
    case 'calories': return it.quantity * 4;
    case 'sets_reps': return Math.max(10, (it.reps_max ?? it.reps_min ?? 5) * 3);
    case 'reps': return Math.max(5, it.quantity * (/step/i.test(it.quantity_unit) ? 1.5 : 3));
    default: return 30;
  }
}

/* ── the shape ────────────────────────────────────────────────────────────── */

export function sessionShape(
  blocks: ShapeBlock[],
  opts: { exercises: Map<string, ShapeExercise>; intensityTarget?: string | null },
): ShapeBar[] {
  const sessionRpe = rpeOf(opts.intensityTarget) ?? 5;
  const bars: ShapeBar[] = [];
  const work = (grow: number, effort: number, kind: MovementKind | null) =>
    grow > 0 && bars.push({ grow, effort, kind });
  const rest = (grow: number) => grow > 0 && bars.push({ grow, effort: 0, kind: null });

  blocks.forEach((b, bi) => {
    if (bi > 0) rest(BLOCK_GAP_S);
    const items = b.exercises;
    if (!items.length) return;
    const rounds = Math.max(1, b.rounds ?? 1);
    const start = bars.length;

    // Every minute on the minute: each item owns a minute, and what the work
    // leaves of it is rest. Recognised by the clock matching the item count.
    const emom = b.block_type === 'rounds' && b.duration_minutes != null && b.rounds != null
      && b.duration_minutes === b.rounds * items.length;

    for (let r = 0; r < rounds; r++) {
      if (r > 0 && !emom) rest(b.rest_seconds ?? 0);
      items.forEach((it, i) => {
        const kind = movementKind(opts.exercises.get(it.exercise_id));
        const effort = heightOf(it.target_rpe ?? rpeOf(it.intensity_note) ?? sessionRpe);
        const once = workSeconds(it, kind);
        if (emom) {
          const w = Math.min(once, 50);
          work(w, effort, kind);
          rest(60 - w);
        } else if ((it.sets ?? 1) > 1) {
          // Working sets. Drawn to the clock, fifteen seconds of squatting and
          // three minutes of rest is a sliver and a gulf, and nobody can count
          // the sets. So a set is drawn with most of its recovery, as the unit
          // of work it is, and the gap between sets is the rest of it: the
          // total stays true to time and the sets read as sets. A new
          // exercise gets a longer gap than a new set.
          const between = it.rest_seconds ?? 60;
          if (i > 0 && !b.rounds) rest(between * 0.6);
          for (let s = 0; s < it.sets!; s++) {
            if (s > 0) rest(between * SET_GAP);
            work(once + between * (1 - SET_GAP), effort, kind);
          }
        } else {
          work(once, effort, kind);
        }
      });
    }

    // A block on a clock (an AMRAP, a timed continuous block) lasts as long as
    // its clock, however many passes that is: stretch what was drawn to fit.
    if (b.duration_minutes && !emom) {
      const drawn = bars.slice(start).reduce((s, x) => s + x.grow, 0);
      const k = drawn > 0 ? (b.duration_minutes * 60) / drawn : 1;
      for (let i = start; i < bars.length; i++) bars[i].grow *= k;
    }
  });

  return simplify(bars);
}

/**
 * Fewer bars, same picture. Neighbours that look identical merge first; then,
 * only if there are still too many, the shortest gaps close, so a long rest
 * between blocks survives and a few seconds of transition do not.
 */
export function simplify(input: ShapeBar[], max = MAX_BARS): ShapeBar[] {
  let bars = mergeAlike(input.filter(b => b.grow > 0));
  // A shape never starts or ends on rest.
  while (bars.length && bars[0].effort === 0) bars.shift();
  while (bars.length && bars[bars.length - 1].effort === 0) bars.pop();

  const total = bars.reduce((s, b) => s + b.grow, 0);
  let threshold = total / 400;
  while (bars.length > max && threshold < total) {
    const out: ShapeBar[] = [];
    for (const b of bars) {
      const prev = out[out.length - 1];
      if (b.effort === 0 && b.grow < threshold && prev) {
        prev.grow += b.grow;           // a short gap folds into the work before it
      } else if (prev && prev.effort > 0 && b.effort > 0 && prev.kind === b.kind) {
        // Two pieces of work now touching become one, at the harder of the two.
        prev.effort = Math.max(prev.effort, b.effort);
        prev.grow += b.grow;
      } else {
        out.push({ ...b });
      }
    }
    bars = out;
    threshold *= 2;
  }
  return bars;
}

function mergeAlike(bars: ShapeBar[]): ShapeBar[] {
  const out: ShapeBar[] = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev && prev.effort === b.effort && prev.kind === b.kind) prev.grow += b.grow;
    else out.push({ ...b });
  }
  return out;
}

/* ── the kind of session ──────────────────────────────────────────────────── */

/**
 * What a session is, for its colour and its tag.
 *
 * The authored session type decides where it is unambiguous, then a station
 * family. Otherwise (conditioning, a benchmark, a strength-endurance session,
 * a supplemental) the session's own work decides: the movement kind it spends
 * most time on, and hybrid when two kinds each take a real share.
 */
export function sessionKind(
  t: { session_type?: string | null; workout_family?: string | null },
  shape: ShapeBar[],
): SessionKind {
  switch (t.session_type) {
    case 'run': return 'run';
    case 'strength': return 'strength';
    case 'hybrid': return 'hybrid';
    case 'recovery': return 'recovery';
  }
  if (/recovery|mobility/.test(t.workout_family ?? '')) return 'recovery';
  // A station family is a station session even where the station is the
  // shorter part by the clock: six burpee broad jumps between squat sets are
  // the point of the session, not a quarter of it.
  if (/^station_/.test(t.workout_family ?? '')) return 'station';

  const time: Record<MovementKind, number> = { run: 0, erg: 0, station: 0 };
  let total = 0;
  for (const b of shape) {
    if (b.effort === 0) continue;
    total += b.grow;
    if (b.kind) time[b.kind] += b.grow;
  }
  const ranked = (Object.keys(time) as MovementKind[])
    .filter(k => time[k] > 0)
    .sort((a, z) => time[z] - time[a]);
  if (ranked.length >= 2 && time[ranked[1]] >= total * 0.25) return 'hybrid';
  // A kind has to be a real share of the work to name the session: one carry
  // in a dumbbell EMOM does not make it a station session.
  if (ranked.length && time[ranked[0]] >= total * 0.4) return ranked[0];
  // Loaded or bodyweight work that is mostly not a run, an erg or a station:
  // an EMOM, a metcon, a core circuit. Resistance work, so it wears
  // strength's colour.
  return 'strength';
}
