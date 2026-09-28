/**
 * Bonus workouts — full sessions the athlete may take, beyond what the week asks.
 *
 * The week states what it owes and the planner fills those slots. Preference had
 * no way to change any of that: `stimuliFor` answers only to phase and load
 * capacity, `planWeekQueue` never reads preference, and the `preference`
 * dimension in the scorer is weighted 0.04 — a tenth of the urgency it would
 * have to overcome to earn a third strength session. An athlete who said they
 * love strength got exactly two, always.
 *
 * These are where that answer lands. Three full sessions from the same primary
 * library, chosen for what the athlete said they like, offered on Plan as
 * opportunities rather than obligations.
 *
 * ── What they are not ─────────────────────────────────────────────────────
 *
 * Not supplementals. Those are the 5-to-12-minute accessories in
 * `supplemental.ts` — core, mobility, boxing — bolted onto a session that has
 * already finished, capped at 20 minutes and one a day. These are whole
 * sessions with their own Full / Express / Micro choice, and the athlete may do
 * one before their primary, instead of it, or three in a day if they want to.
 *
 * Not a second ledger either. A bonus session credits the week exactly as any
 * session does: if strength is still owed it counts toward strength, and if
 * strength is already met it credits nothing because `complete-workout` caps at
 * the target. That is deliberate — the week is a set of stimuli, not a
 * calendar, and a strength session is a strength session whichever list the
 * athlete started it from. So there is no crediting logic here at all, and
 * these are opportunities to *satisfy* the week in a different shape as much as
 * to exceed it.
 *
 * ── No counter ───────────────────────────────────────────────────────────
 *
 * Nothing here reports "1 of 3 taken". The app's founding rule is that a missed
 * day creates no backlog, and a bonus counter would reinstate exactly that: an
 * athlete who took none would have failed at something. They are available, and
 * the ceiling exists to keep the list readable rather than to be filled.
 */
import type { WorkoutTemplate } from '../../../packages/engine/src/index.ts';

/**
 * How many are offered at once.
 *
 * A ceiling, not a target. An athlete who wants more than this asks Coach —
 * which is a conversation about why, and a better answer than a longer list.
 */
export const OPPORTUNITIES_PER_WEEK = 3;

export interface Opportunity {
  template_id: string;
  name: string;
  /** What the session trains, in the vocabulary preference is stated in. */
  training_domain: string | null;
  /** The requirement it would credit, when the week still owes one. */
  stimulus: string | null;
  estimated_minutes: number | null;
  /**
   * A session on this template has already been completed this week.
   *
   * Kept in the list rather than removed. Completing an opportunity moves no
   * counter — the week's stimulus count is capped at its target, so an extra
   * exposure is invisible there by design — and dropping the row as well would
   * leave the athlete no acknowledgement anywhere on the tab they started it
   * from.
   */
  done: boolean;
}

/**
 * Whether a template serves a domain the athlete named.
 *
 * Matched on `training_domain` alone, and not through the scorer's `preference`
 * helper, which is the point of this function existing. That helper matches a
 * stated key against `workout_family` and `primary_goal` as well — which is
 * right when nudging a ranking, and wrong when building a menu: it scores
 * "RowErg — Strength-Power" as a strength match for someone who asked for
 * barbell and dumbbell lifting, because the family is *named* strength_power.
 * The domain is the only one of the three that says what the session trains.
 *
 * The two vocabularies line up exactly — `strength`, `aerobic`, `threshold`,
 * `hybrid`, `muscular_endurance`, `recovery` are both the preference options
 * and the authored domains — so this needs no translation table.
 */
function servesDomain(template: WorkoutTemplate, domains: string[]): boolean {
  const domain = template.training_domain;
  return domain != null && domains.includes(domain);
}

/**
 * Picks the week's opportunities.
 *
 * Pure, and takes an already-eligible list: the caller filters through
 * `checkEligibility` first, so equipment the athlete does not own, impact they
 * cannot take, and technical demand above their capacity are gone before
 * anything here runs. Dropping the per-day and per-minute limits was a product
 * decision; dropping eligibility would just be the SkiErg bug again.
 */
export function pickOpportunities(args: {
  /** Eligible primary templates, already filtered by the caller. */
  templates: WorkoutTemplate[];
  /** Templates the week already asks for. Never offered twice. */
  queuedTemplateIds: Set<string>;
  /** Templates with a completed session inside the current week. */
  completedTemplateIds: Set<string>;
  preferred: string[];
  avoided: string[];
  limit?: number;
}): Opportunity[] {
  const {
    templates, queuedTemplateIds, completedTemplateIds,
    preferred, avoided, limit = OPPORTUNITIES_PER_WEEK,
  } = args;

  const offerable = templates.filter(t => !queuedTemplateIds.has(t.id));

  const rank = (t: WorkoutTemplate) => {
    if (servesDomain(t, preferred)) return 2;
    // A dislike pushes a session to the back of the menu rather than out of it.
    // With nothing preferred and a short library, an avoided session may still
    // be the only thing left to offer, and an empty list is worse than one the
    // athlete scrolls past.
    if (servesDomain(t, avoided)) return 0;
    return 1;
  };

  const sorted = [...offerable].sort((a, b) =>
    rank(b) - rank(a)
    // Then stably, so the same week does not reshuffle between two reads.
    //
    // This used to fall back to `hyrox_specificity` descending, matching how the
    // week's queue ordered a pool. That tiebreak went with the queue's: one
    // scalar named for a single sport should not decide what an athlete is
    // offered, and on a menu it made every unstated preference resolve to "the
    // hardest thing we have".
    || a.id.localeCompare(b.id));

  /**
   * Anything already done holds its slot.
   *
   * Without this an opportunity the athlete completed could be ranked out by a
   * tie-break on the next read and simply vanish, taking the only record that
   * they did it off the tab.
   */
  const taken = sorted.filter(t => completedTemplateIds.has(t.id));
  const rest = sorted.filter(t => !completedTemplateIds.has(t.id));

  return [...taken, ...rest].slice(0, limit).map(t => ({
    template_id: t.id,
    name: t.name,
    training_domain: t.training_domain ?? null,
    stimulus: t.primary_goal ?? t.stimulus ?? null,
    estimated_minutes: t.estimated_minutes ?? null,
    done: completedTemplateIds.has(t.id),
  }));
}
