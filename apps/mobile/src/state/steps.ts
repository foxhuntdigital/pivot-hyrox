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
import { exerciseById } from '../data/content';

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
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Renders a prescription the way a coach would write it on a whiteboard. */
function formatQuantity(
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
      return { text: `${quantity} ${unit}`, seconds: null };
    case 'reps':
      return { text: `${quantity} ${unit}`, seconds: null };
    default:
      return { text: `${quantity} ${unit}`, seconds: null };
  }
}

function blockLabel(block: WorkoutBlock): string {
  const t = `${block.title ?? ''} ${block.instructions ?? ''}`.toLowerCase();
  if (/warm/.test(t)) return 'Warm-up';
  if (/cool|flush/.test(t)) return 'Cooldown';
  return titleCase(block.block_type === 'rounds' ? 'Work' : 'Main');
}

export function buildSteps(rec: Recommendation): Step[] {
  const steps: Step[] = [];
  const intensity = rec.template.intensity_target ?? 'RPE 6';

  for (const block of rec.blocks) {
    const rounds = block.rounds ?? 1;
    const kind = blockLabel(block);

    for (let r = 1; r <= rounds; r++) {
      for (const be of block.exercises) {
        const ex = exerciseById.get(be.exercise_id);
        const { text, seconds } = formatQuantity(be.prescription_type, be.quantity, be.quantity_unit);
        const note = be.intensity_note ?? block.instructions ?? '';

        steps.push({
          kind,
          qty: text,
          label: ex?.name ?? titleCase(be.exercise_id.replace(/^ex_/, '')),
          // Pace targets need a measured baseline; until one exists the honest
          // target is the authored RPE rather than a fabricated pace.
          targetKey: 'Target RPE',
          target: intensity.replace(/^RPE\s*/i, ''),
          note: note || 'Controlled and repeatable.',
          phase: rounds > 1 ? `ROUND ${r} / ${rounds}` : kind.toUpperCase(),
          exercise_id: be.exercise_id,
          duration_seconds: seconds,
        });
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
        });
      }
    }
  }

  return steps;
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
