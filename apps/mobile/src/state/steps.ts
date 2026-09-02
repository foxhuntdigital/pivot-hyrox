/**
 * Flattens a transformed session into the linear step list the workout player
 * walks through.
 *
 * The content model nests rounds inside blocks, but execution is linear: the
 * athlete sees one thing to do at a time with a large Complete control
 * (PRD §6.4). Expanding rounds here keeps that expansion in one place and out
 * of the player's render path.
 */
import type { Recommendation, WorkoutBlock } from '@pivot/engine';

export interface Step {
  /** Section label, e.g. 'Warm-up', 'Threshold'. */
  kind: string;
  /** The dominant number: '6:00', '500 m', '4 × 6'. */
  qty: string;
  /** What to do. */
  label: string;
  targetKey: string;
  target: string;
  note: string;
  /** Progress label, e.g. 'ROUND 3 / 4'. */
  phase: string;
  exercise_id: string;
  /** Seconds, when the step is time-based. Drives the countdown. */
  duration_seconds: number | null;

  /* --- provenance: where this step came from, so what happened to it can be
     written back to the right row (`buildLogs`). ------------------------- */

  /** The block this step belongs to, by position in the prescription. */
  block_order: number;
  /** 1-based round within that block. */
  round: number;
  /** How the work was prescribed: 'duration', 'distance', 'reps', … */
  prescription_type: string;
  quantity: number;
  quantity_unit: string;
  /** Rest steps are structure, not work: they are never logged. */
  rest: boolean;

  /* --- unilateral work ------------------------------------------------------
     A prescription authored per side ('x10/leg', '30 sec/side') is TWO efforts,
     and the player used to walk one. The athlete got a single beat, a single
     clock and a single row to log — so the second leg was untimed, unlogged,
     and easy to forget entirely. Each side is now its own step. ------------- */

  /** 1 or 2 on work performed once per side. Absent on bilateral work. */
  side_number?: number;
  /** How many sides this movement is performed on. Always 2 where present. */
  side_count?: number;

  /* --- working sets (migration 0011) ---------------------------------------
     Present only on a structured strength prescription. A sets x reps row used
     to collapse into ONE step showing "4 x6", so four working sets were one
     tap and the log recorded the set count as the rep count. Each set is now
     its own step, which is what makes per-set entry possible at all. --------- */

  /** 1-based position within this exercise's working sets. */
  set_number?: number;
  /** How many working sets this exercise prescribes. */
  set_count?: number;
  /** Prescribed rep range for this set. Both null on an AMRAP. */
  prescribed_reps_min?: number | null;
  prescribed_reps_max?: number | null;
  /** Authored RPE ceiling for the working sets, when one was given. */
  target_rpe?: number | null;
  /** Reps in reserve on an AMRAP set; null when the reps are a fixed number. */
  amrap_reserve?: number | null;
  /** True when the athlete should be asked what they lifted. */
  logs_load?: boolean;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * The authored marker for work performed once per side: 'x10/leg',
 * '30 sec/side', 'x8/arm'.
 *
 * The unit is the only place the content states this — `side_note` exists on
 * the column and is null on every row in the library — so it is read from
 * there rather than guessed at from the movement. `ex_bulgarian_split_squat`
 * is unilateral and `ex_walking_lunge` is not, and no property of the exercise
 * separates 'ten each leg' from 'ten alternating'; only the prescription does.
 */
const PER_SIDE = /\/\s*(side|leg|arm)s?\b/i;

/** The authored word — 'side', 'leg', 'arm' — or null when not per-side. */
export function sideWordOf(unit: string | null | undefined): string | null {
  return PER_SIDE.exec(String(unit ?? ''))?.[1].toLowerCase() ?? null;
}

/**
 * The unit with the per-side marker removed.
 *
 * Once the step IS one side, '30 sec/side' on it would be saying the same
 * thing twice and asking for twice the work: the number shown is what this
 * side asks for. The authored unit stays on `quantity_unit` untouched, because
 * that is what `buildLogs` reads and what the row was written as.
 */
function withoutSide(unit: string): string {
  return unit.replace(PER_SIDE, '').trim();
}

/** 'First'/'Second' — which side this is, never which of the athlete's. */
const SIDE_ORDINAL = ['First', 'Second'] as const;

/**
 * Renders a prescription the way a coach would write it on a whiteboard.
 *
 * Exported because the workout card shows the same prescription before the
 * athlete starts as the player shows during it. Two formatters would let the
 * card promise "500 m" and the player ask for something written differently.
 *
 * A structured strength row goes through `formatPrescription` instead, which
 * knows about `sets` — passing one here would render "4 x6" again, the exact
 * ambiguity the per-set expansion removed from the player.
 */
export function formatQuantity(
  type: string, quantity: number, unit: string,
): { text: string; seconds: number | null } {
  switch (type) {
    case 'duration': {
      if (unit.startsWith('min')) {
        const total = Math.round(quantity * 60);
        return { text: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, seconds: total };
      }
      return { text: `${quantity} ${unit}`, seconds: unit.startsWith('sec') ? quantity : null };
    }
    case 'distance':
      return { text: `${quantity % 1 === 0 ? quantity : quantity.toFixed(0)} ${unit}`, seconds: null };
    case 'sets_reps':
      // Only reached by a row with no structured prescription. A structured
      // one is expanded into per-set steps by buildSteps and formats its reps
      // directly, because "4 x6" on a single step is the bug this replaced.
      return { text: `${quantity} ${unit}`, seconds: null };
    case 'reps':
      return { text: `${quantity} ${unit}`, seconds: null };
    default:
      return { text: `${quantity} ${unit}`, seconds: null };
  }
}

/**
 * A whole prescription as the card should read it: '4 x 6', '3 x 8-10 / side'.
 *
 * The card summarises where the player walks. It states the set count because
 * that is what an athlete looks at a card to learn — but with an explicit 'x'
 * between two labelled numbers, rather than the bare "4 x6" that let the set
 * count be read, and logged, as the rep count.
 */
export function formatPrescription(be: {
  prescription_type: string; quantity: number; quantity_unit: string;
  sets?: number | null; reps_min?: number | null; reps_max?: number | null;
}): string {
  if (be.sets == null || be.sets <= 0) {
    return formatQuantity(be.prescription_type, be.quantity, be.quantity_unit).text;
  }
  const reps = repsLabel(be);
  const perSide = /\/(?:leg|side|arm)\b/i.test(be.quantity_unit ?? '');
  return `${be.sets} × ${reps}${perSide ? ' / side' : ''}`;
}

/** 'AMRAP-2' in the authored unit means as many as possible, two in reserve. */
function amrapReserveOf(be: { quantity_unit?: string; reps_min?: number | null }): number | null {
  if (be.reps_min != null) return null;
  const m = String(be.quantity_unit ?? '').match(/AMRAP(?:\s*-\s*(\d+))?/i);
  return m ? Number(m[1] ?? 0) : null;
}

/**
 * The reps a single working set asks for: '6', '8-10', or 'AMRAP-2'.
 *
 * The set count is deliberately absent — it is on the step's own `phase`
 * ('SET 2 / 4'), and repeating it in the headline number is what produced
 * "4 x6" and the reps-logged-as-sets bug behind it.
 */
function repsLabel(be: {
  reps_min?: number | null; reps_max?: number | null; quantity_unit?: string;
}): string {
  const reserve = amrapReserveOf(be);
  if (reserve !== null) return reserve > 0 ? `AMRAP-${reserve}` : 'AMRAP';
  if (be.reps_min == null) return String(be.quantity_unit ?? '').replace(/^x/i, '') || '—';
  if (be.reps_max != null && be.reps_max !== be.reps_min) return `${be.reps_min}-${be.reps_max}`;
  return String(be.reps_min);
}

function mmssOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** 'Warm-up', 'Cooldown', 'Work' or 'Main', from the block's own wording. */
export function blockLabel(block: WorkoutBlock): string {
  const t = `${block.title ?? ''} ${block.instructions ?? ''}`.toLowerCase();
  if (/warm/.test(t)) return 'Warm-up';
  if (/cool|flush/.test(t)) return 'Cooldown';
  return titleCase(block.block_type === 'rounds' ? 'Work' : 'Main');
}

/**
 * Resolves an exercise id to its display name.
 *
 * Injected rather than imported so this module stays free of the content
 * bundle — the same reason `actuals.ts` keeps its distance. `../data/content`
 * pulls in a 16,000-line JSON import that only Metro can resolve, and reaching
 * for it here would make the whole step-expansion path untestable outside the
 * app, which is exactly the path most worth testing.
 */
export type NameLookup = (exerciseId: string) => string | undefined;

export function buildSteps(rec: Recommendation, nameOf: NameLookup = () => undefined): Step[] {
  const steps: Step[] = [];
  const intensity = rec.template.intensity_target ?? 'RPE 6';

  for (const [blockOrder, block] of rec.blocks.entries()) {
    const rounds = block.rounds ?? 1;
    const kind = blockLabel(block);

    for (let r = 1; r <= rounds; r++) {
      for (const be of block.exercises) {
        const name = nameOf(be.exercise_id) ?? titleCase(be.exercise_id.replace(/^ex_/, ''));
        const note = be.intensity_note ?? block.instructions ?? '';
        const targetRpe = intensity.replace(/^RPE\s*/i, '');

        /*
         * Per-side work is walked one side at a time.
         *
         * `sides` is [null] for ordinary work and [1, 2] for a movement the
         * prescription states per side, so everything below is written once
         * and emitted twice where it has to be. The numbers are NOT halved:
         * '10/leg' already means ten on each, so two steps of ten is the
         * prescription, and one step of ten was half of it.
         */
        const sideWord = sideWordOf(be.quantity_unit);
        const sides: (number | null)[] = sideWord ? [1, 2] : [null];
        // The per-side marker belongs on the prescription, not on a step that
        // IS one side. `be` itself is never modified — `buildLogs` reads the
        // authored unit from the step and must keep seeing what was written.
        const shown = sideWord
          ? { ...be, quantity_unit: withoutSide(be.quantity_unit) }
          : be;

        const commonFor = (side: number | null) => ({
          kind,
          label: side ? `${name} · ${SIDE_ORDINAL[side - 1]} ${sideWord}` : name,
          // Pace targets need a measured baseline; until one exists the honest
          // target is the authored RPE rather than a fabricated pace.
          targetKey: 'Target RPE',
          target: targetRpe,
          note: note || 'Controlled and repeatable.',
          exercise_id: be.exercise_id,
          block_order: blockOrder,
          round: r,
          prescription_type: be.prescription_type,
          quantity: be.quantity,
          quantity_unit: be.quantity_unit,
          rest: false,
          ...(side ? { side_number: side, side_count: 2 } : {}),
        });
        const common = commonFor(null);

        // ── A structured strength prescription: one step per working set ────
        //
        // The whole point of migration 0011. Collapsed into a single step the
        // athlete saw "4 x6", tapped once, and the log recorded four reps —
        // the set count. Expanded, each set is its own step that can carry its
        // own load, reps and RPE, and the rest between them is real time on
        // the clock rather than an invisible pause.
        if (be.sets != null && be.sets > 0) {
          for (let n = 1; n <= be.sets; n++) {
            // Both sides of a set, then the rest. Resting between the two
            // halves of one set would turn '3x10 each leg' into six sets with
            // a break in the middle of each, which is a different session.
            for (const side of sides) {
              steps.push({
                ...commonFor(side),
                qty: repsLabel(shown),
                phase: side
                  ? `SET ${n} / ${be.sets} · ${SIDE_ORDINAL[side - 1].toUpperCase()} ${sideWord!.toUpperCase()}`
                  : `SET ${n} / ${be.sets}`,
                duration_seconds: null,
                set_number: n,
                set_count: be.sets,
                prescribed_reps_min: be.reps_min ?? null,
                prescribed_reps_max: be.reps_max ?? null,
                target_rpe: be.target_rpe ?? null,
                amrap_reserve: amrapReserveOf(shown),
                // Bodyweight work has nothing to put on the bar, so asking would
                // be a field the athlete can only leave empty.
                logs_load: be.load_basis !== 'bodyweight',
              });
            }

            // Rest between working sets is what separates strength from
            // density work, so it is a step rather than dead time between two
            // taps. Not emitted after the last set: the next thing is the next
            // exercise, which carries its own rest.
            if (be.rest_seconds && n < be.sets) {
              steps.push({
                ...common,
                kind: 'Rest',
                qty: mmssOf(be.rest_seconds),
                label: 'Recover',
                target: '2',
                note: `Before set ${n + 1} of ${be.sets} · ${name}`,
                phase: `SET ${n} / ${be.sets}`,
                duration_seconds: be.rest_seconds,
                prescription_type: 'duration',
                quantity: be.rest_seconds,
                quantity_unit: 'seconds',
                exercise_id: '',
                rest: true,
              });
            }
          }
          continue;
        }

        const { text, seconds } = formatQuantity(
          shown.prescription_type, shown.quantity, shown.quantity_unit);
        for (const side of sides) {
          const progress = rounds > 1 ? `ROUND ${r} / ${rounds}` : kind.toUpperCase();
          steps.push({
            ...commonFor(side),
            qty: text,
            phase: side
              ? `${progress} · ${SIDE_ORDINAL[side - 1].toUpperCase()} ${sideWord!.toUpperCase()}`
              : progress,
            // Its own clock, because it is its own effort. A 30-second side
            // plank held twice is two thirty-second holds, and the split the
            // athlete sees afterwards should say so.
            duration_seconds: seconds,
          });
        }
      }
      if (block.rest_seconds && r < rounds) {
        steps.push({
          kind: 'Rest',
          qty: `0:${String(block.rest_seconds).padStart(2, '0')}`,
          label: 'Recover',
          targetKey: 'Target RPE',
          target: '2',
          note: 'Keep moving if it feels better than standing still.',
          phase: `ROUND ${r} / ${rounds}`,
          exercise_id: '',
          duration_seconds: block.rest_seconds,
          block_order: blockOrder,
          round: r,
          prescription_type: 'duration',
          quantity: block.rest_seconds,
          quantity_unit: 'seconds',
          rest: true,
        });
      }
    }
  }

  return steps;
}

// `mmss` used to be re-exported from here so the player kept one import for the
// clock. It is imported from '@/lib/format' directly now: the re-export was the
// only runtime dependency this module had, and it is what kept the step
// expansion — the part most worth testing — unloadable outside Metro.
