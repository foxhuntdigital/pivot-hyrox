/**
 * The rules for changing this week's queue.
 *
 * Both the functions that touch `session_queue_items` reason the same way about
 * it: `start-workout` claims the item being performed, `reshape-week` reorders
 * and drops. Keeping the rules here rather than in each handler means there is
 * one definition of what may be moved and one of what may not.
 */
import {
  checkEligibility, matchesStimulus,
  type EngineInput, type Exercise, type WorkoutTemplate,
} from '../../../packages/engine/src/index.ts';
import { HttpError } from './context.ts';

/** A queue row as the functions read it. */
export interface QueueItem {
  id: string;
  workout_template_id: string;
  stimulus_type: string;
  rank: number;
  state: string;
}

/**
 * States a change may move.
 *
 * `skipped` is included so a change can be taken back: Coach's commitments
 * carry an undo, and a session dropped from the week has to be returnable to
 * it. Anything else is already history — a session in progress or completed is
 * not the plan any more, it is what happened, and reopening one would corrupt
 * the stimulus credit `complete-workout` already applied.
 */
export const MUTABLE_STATES = ['queued', 'recommended', 'skipped'];

/** Items a Start may claim: queued work that has not been begun. */
export const CLAIMABLE_STATES = ['queued', 'recommended'];

/**
 * Checks a reshape before any of it is written.
 *
 * Throws rather than returning a verdict: every failure here is a bad request
 * or a conflict, and the handler's job is to say which. A partially applied
 * reshape would leave the week in a shape nobody chose.
 */
export function validateReshape(
  items: Map<string, QueueItem>,
  keep: string[],
  drop: string[],
): void {
  if (!keep.length && !drop.length) {
    throw new HttpError(400, 'Nothing to change: send keep, drop, or both');
  }
  if (keep.filter(id => drop.includes(id)).length) {
    throw new HttpError(400, 'A session cannot be both kept and dropped');
  }
  const all = [...keep, ...drop];
  if (new Set(all).size !== all.length) {
    throw new HttpError(400, 'A session was named twice');
  }
  if (all.some(id => !items.has(id))) {
    throw new HttpError(400, 'Some sessions are not in this week');
  }
  if (all.some(id => !MUTABLE_STATES.includes(items.get(id)!.state))) {
    throw new HttpError(409, 'A session already started or finished cannot be moved');
  }
}

/** The queued item for a template, in rank order, or null when none is open. */
export function claimableFor(
  items: QueueItem[],
  templateId: string,
): QueueItem | null {
  return items
    .filter(q => q.workout_template_id === templateId && CLAIMABLE_STATES.includes(q.state))
    .sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/* ------------------------------------------------------- planning a week --- */

/**
 * A session the week intends, before it exists as a row.
 */
export interface PlannedQueueItem {
  workout_template_id: string;
  stimulus_type: string;
  /** Position in the week. Lower is protected first when the week compresses. */
  rank: number;
}

export interface WeekRequirement {
  stimulus_type: string;
  target_exposures: number;
  completed_exposures?: number;
  /** 1 = protected, 3 = first to go when the week compresses (PRD §2). */
  priority: number;
}

/**
 * Turns a week's stimulus requirements into the sessions that would satisfy
 * them.
 *
 * The week has always been defined by required stimuli; what was missing was
 * anything that named the sessions delivering them. Without that, Plan's queue
 * is empty, a finished session credits nothing because it matches no queue
 * item, and every proposal that reshapes the week has nothing to reshape.
 *
 * Three rules decide the order, and the order is the whole point — `rank` is
 * what a compressed week is cut from the bottom of:
 *
 *   * Priority first. A protected stimulus outranks an optional one, so what
 *     drops when the week shortens is what the periodisation says is least
 *     costly to lose.
 *   * Round-robin inside a priority tier, so three aerobic sessions do not sit
 *     in a row ahead of the threshold work they share a tier with.
 *   * Within a stimulus, the most race-specific template the athlete is
 *     eligible for, and a different one each time until the pool runs out.
 *
 * Eligibility is the engine's own — equipment, impact, considerations, phase —
 * so a queue can never hold a session the athlete would be refused. Spacing is
 * deliberately not applied: it reasons about what was performed recently, and a
 * week being planned has not been performed at all.
 */
export function planWeekQueue(args: {
  requirements: WeekRequirement[];
  templates: WorkoutTemplate[];
  exercises: Exercise[];
  /** Planning context: the athlete's equipment, considerations and phase. */
  input: EngineInput;
}): PlannedQueueItem[] {
  const { requirements, templates, exercises, input } = args;

  const exerciseIndex = new Map(
    exercises.map(e => [e.id, { equipment: e.equipment, impact_level: e.impact_level }]));

  // A week is planned against a neutral day. Recovery is what today's decision
  // reads; planning ahead on a bad night would write a soft week the athlete is
  // then stuck with.
  const planningInput: EngineInput = { ...input, recent_sessions: [] };
  const eligible = templates.filter(
    t => checkEligibility(t, planningInput, exerciseIndex, 'okay').eligible);

  /**
   * Candidates for one stimulus, most race-specific first.
   *
   * Uses the engine's own matcher rather than comparing `primary_goal` itself.
   * The two had drifted into being separate implementations of the same
   * question: after ENGINE 2.0.0 moved `matchesStimulus` onto `training_domain`,
   * this would have gone on queueing the week from what sessions were CALLED
   * while today's decision scored them by what they ARE. The week and the day
   * would have disagreed about what counts as a strength session.
   */
  const poolFor = (stimulus: string) => eligible
    .filter(t => matchesStimulus(t, stimulus))
    .sort((a, b) =>
      (b.hyrox_specificity ?? 0) - (a.hyrox_specificity ?? 0) ||
      a.id.localeCompare(b.id));

  const needs = requirements
    .map(r => ({
      stimulus: r.stimulus_type,
      priority: r.priority,
      remaining: Math.max(0, r.target_exposures - (r.completed_exposures ?? 0)),
      pool: poolFor(r.stimulus_type),
      taken: 0,
    }))
    .filter(n => n.remaining > 0 && n.pool.length > 0);

  const items: PlannedQueueItem[] = [];
  const used = new Set<string>();
  const tiers = [...new Set(needs.map(n => n.priority))].sort((a, b) => a - b);

  for (const tier of tiers) {
    const inTier = needs.filter(n => n.priority === tier);
    // Round-robin: one exposure from each stimulus in turn until the tier's
    // requirements are met.
    while (inTier.some(n => n.taken < n.remaining)) {
      for (const need of inTier) {
        if (need.taken >= need.remaining) continue;
        // A different template each time while the pool allows it; a week
        // asking for three of a stimulus the library has two of repeats the
        // best one rather than dropping the exposure.
        const pick = need.pool.find(t => !used.has(t.id)) ?? need.pool[need.taken % need.pool.length];
        used.add(pick.id);
        need.taken += 1;
        items.push({
          workout_template_id: pick.id,
          stimulus_type: need.stimulus,
          rank: items.length,
        });
      }
    }
  }

  return items;
}

/**
 * Writes the week's queue, if it does not have one.
 *
 * Called when a plan is created and again whenever `today` finds the active
 * week empty — which is what gives a queue to athletes whose program was
 * generated before there was anything to generate one with, and to each new
 * week as it becomes active.
 *
 * The emptiness check and the insert are two statements, so two clients opening
 * the app at the same moment could both find the week empty and both fill it.
 * The window is small and the cost is a duplicated queue rather than lost work;
 * closing it properly wants a unique index on (weekly_cycle_id, rank), which is
 * a migration rather than a change here.
 */
export async function ensureWeekQueue(args: {
  db: { from: (table: string) => any };
  cycleId: string;
  requirements: WeekRequirement[];
  templates: WorkoutTemplate[];
  exercises: Exercise[];
  input: EngineInput;
}): Promise<PlannedQueueItem[]> {
  const { db, cycleId, ...plan } = args;

  const { data: existing } = await db
    .from('session_queue_items')
    .select('id')
    .eq('weekly_cycle_id', cycleId)
    .limit(1);
  if (existing?.length) return [];

  const items = planWeekQueue(plan);
  if (!items.length) return [];

  const { error } = await db.from('session_queue_items').insert(
    items.map(i => ({
      weekly_cycle_id: cycleId,
      workout_template_id: i.workout_template_id,
      stimulus_type: i.stimulus_type,
      rank: i.rank,
      state: 'queued',
    })),
  );
  // A week without a queue still works — the engine picks a session daily
  // regardless. Failing the caller over it would cost the athlete their plan
  // for the sake of a list.
  if (error) {
    console.error('session_queue_items insert failed', error.message);
    return [];
  }
  return items;
}
