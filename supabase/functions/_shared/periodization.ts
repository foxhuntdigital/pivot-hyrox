/**
 * Program periodization: a runway in, phase and week structure out.
 *
 * The PRD names the six phase types (§8.2 D08, `program_phases.phase_type`) and
 * says taper rules override generic progression (§13), but it does not specify
 * phase lengths or per-week stimulus targets. These rules are extrapolated from
 * the shape the design was built against — the 16-week Boston Build in
 * `apps/mobile/src/data/athlete.ts` — so a generated plan matches what the
 * screens already render.
 *
 * There are two kinds of runway. A **race plan** is counted back from an event:
 * the taper and race week are calendar facts, and the phases before them are
 * proportions of whatever time is left. A **block** has no event, so it is
 * counted forward from a length the athlete chose. Both go through the same
 * distribution; what differs is the split they distribute and which end of it
 * survives a short runway.
 *
 * Kept free of Supabase and Deno so it can be exercised directly.
 */

export type PhaseType = 'foundation' | 'build' | 'specific' | 'peak' | 'taper' | 'race';

export interface PhasePlan {
  phase_type: PhaseType;
  phase_order: number;
  start_date: string;
  end_date: string;
  weeks: number;
}

export interface StimulusTarget {
  stimulus_type: string;
  target_exposures: number;
  priority: number;
}

interface SplitEntry {
  phase_type: PhaseType;
  weeks: number;
}

/**
 * The reference 16-week split. Weeks are proportions of the whole rather than
 * fixed counts: a 24-week runway should not spend 15 of them in foundation.
 */
const REFERENCE_SPLIT: SplitEntry[] = [
  { phase_type: 'foundation', weeks: 4 },
  { phase_type: 'build', weeks: 5 },
  { phase_type: 'specific', weeks: 3 },
  { phase_type: 'peak', weeks: 2 },
  { phase_type: 'taper', weeks: 1 },
  { phase_type: 'race', weeks: 1 },
];

/**
 * Derived, not declared: the seed's programme is 16 weeks with week 7 falling in
 * `build`, and a split that no longer adds up to that would otherwise be
 * corrected silently by the rounding absorber in `planPhases`.
 */
export const REFERENCE_WEEKS = REFERENCE_SPLIT.reduce((n, p) => n + p.weeks, 0);

/**
 * Taper and race are fixed at a week each regardless of runway. They are
 * calendar facts about the event rather than training volume to be scaled, and
 * compressing a taper is the one change that reliably makes an athlete race
 * worse.
 */
const FIXED_TAIL: PhaseType[] = ['taper', 'race'];

/** Below this, there is not enough runway for a full six-phase progression. */
const MIN_WEEKS_FOR_FULL_SPLIT = 6;

/**
 * The split for a block with no race attached: the reference split with the
 * event itself removed.
 *
 * A taper is a taper *for* something, and a race week with no race is a week of
 * training the athlete did not ask to lose, so both are dropped rather than
 * scaled to nothing. Peak survives — it is ordinary hard training at the top of
 * a progression, and finishing a block sharp is worth something whether or not
 * there is a start line to be sharp for.
 */
const BLOCK_SPLIT: SplitEntry[] = REFERENCE_SPLIT
  .filter(p => !FIXED_TAIL.includes(p.phase_type));

/**
 * Block lengths the athlete may choose. Four weeks is the shortest runway that
 * still gives every phase in `BLOCK_SPLIT` a week of its own; past roughly six
 * months a block stops being a plan and becomes an open-ended stream, which is
 * the thing a block exists to avoid.
 */
export const MIN_BLOCK_WEEKS = 4;
export const MAX_BLOCK_WEEKS = 24;

/**
 * Per-week stimulus targets, from `WEEK_STIMULI` in the seed. Phases shift
 * emphasis rather than count: the same five stimuli appear every week, and what
 * changes is how many exposures each is due.
 */
const BASE_STIMULI: StimulusTarget[] = [
  { stimulus_type: 'aerobic_durability', target_exposures: 2, priority: 1 },
  { stimulus_type: 'threshold', target_exposures: 1, priority: 1 },
  { stimulus_type: 'strength', target_exposures: 2, priority: 2 },
  { stimulus_type: 'race_specific', target_exposures: 1, priority: 2 },
  /**
   * Zero, and deliberately not absent.
   *
   * A target of zero writes no requirement row, so recovery is not something a
   * normal week owes — it is available, not owed. The phase matrix brings it
   * back where it is the point: taper and race week both raise it.
   *
   * Keeping the row here at zero rather than deleting it is what lets a phase
   * raise it at all; `stimuliFor` maps over this list, so a stimulus absent
   * from it cannot be reintroduced by any override.
   */
  { stimulus_type: 'recovery', target_exposures: 0, priority: 3 },
];

/**
 * The reference week per race goal (product/programming signoff, 27 Sep 2026).
 *
 * Only `hybrid_race` is reachable today: races carry no distance, so nothing
 * resolves an athlete to 5K, 10K or half marathon yet. The three running weeks
 * are recorded here rather than in a document because this is where they will
 * be read from, and a signed-off number kept anywhere else is a number that
 * gets re-guessed.
 *
 * One aerobic exposure in each running week is the long run. That protection is
 * not expressible as a count — it is a property of which aerobic session gets
 * picked — and belongs to the archetype work, not here.
 */
export const GOAL_BASE_STIMULI: Record<string, StimulusTarget[]> = {
  hybrid_race: BASE_STIMULI,
  '5k': [
    { stimulus_type: 'aerobic_durability', target_exposures: 2, priority: 1 },
    { stimulus_type: 'threshold', target_exposures: 1, priority: 1 },
    { stimulus_type: 'strength', target_exposures: 2, priority: 2 },
    { stimulus_type: 'race_specific', target_exposures: 1, priority: 2 },
    { stimulus_type: 'recovery', target_exposures: 0, priority: 3 },
  ],
  '10k': [
    { stimulus_type: 'aerobic_durability', target_exposures: 2, priority: 1 },
    { stimulus_type: 'threshold', target_exposures: 1, priority: 1 },
    { stimulus_type: 'strength', target_exposures: 2, priority: 2 },
    { stimulus_type: 'race_specific', target_exposures: 1, priority: 2 },
    { stimulus_type: 'recovery', target_exposures: 0, priority: 3 },
  ],
  half_marathon: [
    // More aerobic, less strength — the trade the distance asks for.
    { stimulus_type: 'aerobic_durability', target_exposures: 3, priority: 1 },
    { stimulus_type: 'threshold', target_exposures: 1, priority: 1 },
    { stimulus_type: 'strength', target_exposures: 1, priority: 2 },
    { stimulus_type: 'race_specific', target_exposures: 1, priority: 2 },
    { stimulus_type: 'recovery', target_exposures: 0, priority: 3 },
  ],
};

/**
 * How each phase departs from the base week. Foundation trades race-specific
 * work for aerobic volume; specific and peak invert that; taper cuts volume
 * while keeping enough intensity to stay sharp; race week is recovery plus the
 * event itself.
 */
const PHASE_EMPHASIS: Record<PhaseType, Partial<Record<string, number>>> = {
  foundation: { aerobic_durability: 3, threshold: 1, race_specific: 0 },
  build: {},
  specific: { race_specific: 2, threshold: 2 },
  peak: { race_specific: 2, strength: 1, threshold: 2 },
  taper: { aerobic_durability: 1, threshold: 1, strength: 1, race_specific: 1, recovery: 2 },
  race: { aerobic_durability: 0, threshold: 0, strength: 0, race_specific: 1, recovery: 2 },
};

/**
 * How much of the base week an athlete of each load capacity is given.
 *
 * This is the one place `load_capacity` changes the plan without waiting on
 * anything else. Template selection needs `load_demand` on the templates, and
 * content is still grading them — but *how many* exposures a week is due does
 * not depend on grading at all, only on how much work the athlete can absorb.
 * So a beginner gets a shorter, less intense week from their first plan rather
 * than from whenever the library catches up.
 *
 * The shape of the reduction matters more than its size. What comes off first
 * is race-specific work and threshold — the two hardest things in the week, and
 * the two an athlete rebuilding a base has least use for. Aerobic volume and
 * recovery are held: those are what actually builds someone at capacity 1, and
 * cutting them would make a beginner's week both shorter and worse.
 *
 * PROVISIONAL. The counts below are a coaching judgement and are flagged for
 * sign-off; the mechanism is what is being shipped, and the numbers are one
 * table to change. Capacity 2 and 3 are deliberately identical to the base week
 * so that this cannot quietly re-scale the plan of every athlete already on one
 * — only the ends of the range move.
 */
/**
 * How the reference week changes with an athlete's load capacity
 * (product/programming signoff, 27 Sep 2026).
 *
 * Only capacity 1 moves it, and only by one strength exposure: a rebuilding
 * athlete gets five where the reference week asks for six. Capacities 2, 3 and
 * 4 all get the reference week unchanged.
 *
 * ── Why higher capacity does not add sessions ────────────────────────────
 *
 * The signoff is explicit that capacity above the reference raises *eligible
 * demand, dose and progression* rather than weekly frequency. A competitive
 * athlete is not someone who trains more often than an intermediate one; they
 * are someone who can absorb harder sessions and a larger dose within the same
 * frequency. That distinction is carried by `load_demand` selection and, for
 * running, by the dose resolver — not here.
 *
 * An earlier engineering placeholder had capacity 4 adding an aerobic exposure
 * and a second race-specific one, taking the build week to ten. That was a
 * guess, it was wrong, and this replaces it.
 */
const CAPACITY_EXPOSURES: Record<number, Partial<Record<string, number>>> = {
  // Building or rebuilding. One strength exposure comes off; nothing else moves.
  1: { strength: 1 },
  2: {},
  3: {},
  4: {},
};

/** Days between two ISO dates, positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** ISO date `days` after `from`. */
export function addDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Whole weeks from `startDate` to `raceDate`, inclusive of race week. A race
 * eleven days out is two weeks of program, not one and a half.
 */
export function weeksUntil(startDate: string, raceDate: string): number {
  return Math.max(1, Math.ceil((daysBetween(startDate, raceDate) + 1) / 7));
}

/**
 * Shares `totalWeeks` across a split.
 *
 * Phases named in `fixed` hold a week each; the remainder is shared among the
 * rest in proportion to their reference weeks, with any rounding shortfall
 * going to `build` — the phase that tolerates being a week longer or shorter
 * without changing what the plan is.
 */
function distribute(
  split: SplitEntry[], totalWeeks: number, fixed: PhaseType[],
): PhasePlan[] {
  const scalable = split.filter(p => !fixed.includes(p.phase_type));
  const fixedWeeks = split.length - scalable.length;
  const scalableWeeks = Math.max(0, totalWeeks - fixedWeeks);
  const referenceScalable = scalable.reduce((n, p) => n + p.weeks, 0);

  const weeks = new Map<PhaseType, number>();
  for (const phase of split) {
    weeks.set(
      phase.phase_type,
      fixed.includes(phase.phase_type) || referenceScalable === 0
        ? 1
        : Math.max(1, Math.round((phase.weeks / referenceScalable) * scalableWeeks)),
    );
  }

  // Rounding rarely lands exactly on totalWeeks. Absorb the difference in build
  // when it exists, otherwise in the longest scalable phase.
  const assigned = [...weeks.values()].reduce((a, b) => a + b, 0);
  if (assigned !== totalWeeks && scalable.length > 0) {
    const absorber = weeks.has('build')
      ? 'build'
      : scalable.reduce((a, b) => (weeks.get(a.phase_type)! >= weeks.get(b.phase_type)! ? a : b)).phase_type;
    weeks.set(absorber, Math.max(1, weeks.get(absorber)! + (totalWeeks - assigned)));
  }

  // Dates are not set here. `distribute` decides how long each phase is;
  // `withStart` decides when it happens, and only one of them may own the
  // cursor or the two disagree at a phase boundary.
  return split.map((phase, i) => ({
    phase_type: phase.phase_type,
    phase_order: i + 1,
    start_date: '',
    end_date: '',
    weeks: weeks.get(phase.phase_type)!,
  }));
}

/**
 * Phases for a plan counted back from a race date.
 *
 * Short runways drop phases from the front rather than shrinking every phase to
 * nothing: four weeks out, an athlete is in specific work and a taper, not a
 * one-week foundation block.
 */
export function planPhases(startDate: string, raceDate: string): PhasePlan[] {
  const totalWeeks = weeksUntil(startDate, raceDate);

  const split = totalWeeks >= MIN_WEEKS_FOR_FULL_SPLIT
    ? REFERENCE_SPLIT
    : shortRunwaySplit(totalWeeks);

  const plans = withStart(distribute(split, totalWeeks, FIXED_TAIL), startDate);

  // The race phase must end on race day rather than at a week boundary, so the
  // program's last date is the event itself.
  const last = plans[plans.length - 1];
  if (last) last.end_date = raceDate;

  return plans;
}

/**
 * Phases for a block of `weeks` with no race attached.
 *
 * Counted forward from the start date rather than back from an event, and with
 * no fixed phases: nothing here is a calendar fact, so every phase scales.
 *
 * A race plan needs `shortRunwaySplit` because a race can be three weeks away
 * whether or not that suits a six-phase progression. A block cannot — the
 * athlete picks the length, and `MIN_BLOCK_WEEKS` is set to the point where
 * every phase still gets a week of its own, so there is no short-block case to
 * handle.
 */
export function planBlockPhases(startDate: string, weeks: number): PhasePlan[] {
  const totalWeeks = clampBlockWeeks(weeks);
  return withStart(distribute(BLOCK_SPLIT, totalWeeks, []), startDate);
}

/** A block length the planner will accept, whatever the caller sent. */
export function clampBlockWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return MIN_BLOCK_WEEKS;
  return Math.min(MAX_BLOCK_WEEKS, Math.max(MIN_BLOCK_WEEKS, Math.round(weeks)));
}

/** The last date covered by a block of `weeks` starting on `startDate`. */
export function blockEndDate(startDate: string, weeks: number): string {
  return addDays(startDate, clampBlockWeeks(weeks) * 7 - 1);
}

/** Walks a distributed split onto real dates from `startDate`. */
function withStart(plans: PhasePlan[], startDate: string): PhasePlan[] {
  let cursor = startDate;
  for (const plan of plans) {
    plan.start_date = cursor;
    plan.end_date = addDays(cursor, plan.weeks * 7 - 1);
    cursor = addDays(cursor, plan.weeks * 7);
  }
  return plans;
}

/**
 * Which phases survive a runway too short for all six. Later phases are the
 * ones that matter closest to a race, so the front is dropped first.
 */
function shortRunwaySplit(totalWeeks: number): SplitEntry[] {
  const order: PhaseType[] = ['specific', 'peak', 'taper', 'race'];
  const kept = order.slice(Math.max(0, order.length - totalWeeks));
  return kept.map(phase_type => ({
    phase_type,
    weeks: REFERENCE_SPLIT.find(p => p.phase_type === phase_type)!.weeks,
  }));
}

/**
 * Stimulus targets for one week of a phase. A target of zero means the stimulus
 * is not due this week and no row is written for it, rather than a row the
 * engine would read as an unmet requirement forever.
 */
export function stimuliFor(
  phase: PhaseType,
  /**
   * The athlete's load capacity, 1-4. Null for an athlete who has not answered
   * — every athlete who onboarded before migration 0023 — and null means the
   * base week, which is exactly what they get today.
   */
  loadCapacity: number | null = null,
): StimulusTarget[] {
  const emphasis = PHASE_EMPHASIS[phase];
  const capacity = loadCapacity != null ? CAPACITY_EXPOSURES[loadCapacity] ?? {} : {};

  return BASE_STIMULI
    .map(s => {
      /**
       * Capacity may always reduce. It may only add where the phase is silent.
       *
       * The asymmetry is the whole rule, and both halves of it are load-bearing.
       *
       * A capacity limit describes what this athlete can absorb, and that does
       * not stop being true because the calendar reached a peak block. Letting
       * the phase override a reduction is how a rebuilding athlete ends up with
       * eight exposures and two race-specific sessions in peak week — which is
       * the periodisation working exactly as designed on someone it will hurt.
       * So a reduction holds in every phase.
       *
       * A capacity bonus is the opposite kind of claim: it says this athlete
       * *could* take more, not that they should get more right now. Periodisation
       * is allowed to veto that, and in a taper it must — a taper is a taper for
       * everybody, and a competitive athlete getting a bigger one is the single
       * thing this must never produce.
       */
      const base = s.target_exposures;
      const phased = emphasis[s.stimulus_type];
      const capped = capacity[s.stimulus_type];

      let target = phased ?? base;
      if (capped != null && capped < target) target = capped;
      if (capped != null && capped > target && phased == null) target = capped;

      return { ...s, target_exposures: target };
    })
    .filter(s => s.target_exposures > 0);
}
