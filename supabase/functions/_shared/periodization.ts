/**
 * Program periodization: race date in, phase and week structure out.
 *
 * The PRD names the six phase types (§8.2 D08, `program_phases.phase_type`) and
 * says taper rules override generic progression (§13), but it does not specify
 * phase lengths or per-week stimulus targets. These rules are extrapolated from
 * the shape the design was built against — the 16-week Boston Build in
 * `apps/mobile/src/data/athlete.ts` — so a generated plan matches what the
 * screens already render.
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

/**
 * The reference 16-week split. Weeks are proportions of the whole rather than
 * fixed counts: a 24-week runway should not spend 15 of them in foundation.
 */
const REFERENCE_SPLIT: { phase_type: PhaseType; weeks: number }[] = [
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
 * Per-week stimulus targets, from `WEEK_STIMULI` in the seed. Phases shift
 * emphasis rather than count: the same five stimuli appear every week, and what
 * changes is how many exposures each is due.
 */
const BASE_STIMULI: StimulusTarget[] = [
  { stimulus_type: 'aerobic_durability', target_exposures: 2, priority: 1 },
  { stimulus_type: 'threshold', target_exposures: 2, priority: 1 },
  { stimulus_type: 'strength', target_exposures: 2, priority: 2 },
  { stimulus_type: 'race_specific', target_exposures: 1, priority: 2 },
  { stimulus_type: 'recovery', target_exposures: 1, priority: 3 },
];

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
 * Distributes `totalWeeks` across the phase split.
 *
 * Taper and race hold a week each; the remainder is shared among the leading
 * phases in proportion to the reference split, with any rounding shortfall
 * going to `build` — the phase that tolerates being a week longer or shorter
 * without changing what the plan is.
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

  const scalable = split.filter(p => !FIXED_TAIL.includes(p.phase_type));
  const fixedWeeks = split.length - scalable.length;
  const scalableWeeks = Math.max(0, totalWeeks - fixedWeeks);
  const referenceScalable = scalable.reduce((n, p) => n + p.weeks, 0);

  const weeks = new Map<PhaseType, number>();
  for (const phase of split) {
    weeks.set(
      phase.phase_type,
      FIXED_TAIL.includes(phase.phase_type)
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

  const plans: PhasePlan[] = [];
  let cursor = startDate;
  let order = 1;
  for (const phase of split) {
    const n = weeks.get(phase.phase_type)!;
    plans.push({
      phase_type: phase.phase_type,
      phase_order: order++,
      start_date: cursor,
      end_date: addDays(cursor, n * 7 - 1),
      weeks: n,
    });
    cursor = addDays(cursor, n * 7);
  }

  // The race phase must end on race day rather than at a week boundary, so the
  // program's last date is the event itself.
  const last = plans[plans.length - 1];
  if (last) last.end_date = raceDate;

  return plans;
}

/**
 * Which phases survive a runway too short for all six. Later phases are the
 * ones that matter closest to a race, so the front is dropped first.
 */
function shortRunwaySplit(totalWeeks: number): { phase_type: PhaseType; weeks: number }[] {
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
export function stimuliFor(phase: PhaseType): StimulusTarget[] {
  const emphasis = PHASE_EMPHASIS[phase];
  return BASE_STIMULI
    .map(s => ({ ...s, target_exposures: emphasis[s.stimulus_type] ?? s.target_exposures }))
    .filter(s => s.target_exposures > 0);
}
