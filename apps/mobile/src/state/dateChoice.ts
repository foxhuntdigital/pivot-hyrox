/**
 * The race date as the onboarding chips build it: year, then month, then day.
 *
 * The answer is only a date once a month is chosen, so the year has to be held
 * somewhere before then. Reading it back from the saved date alone meant a year
 * tapped first had nowhere to go: there was no date to write it into, and the
 * chip snapped back to this year.
 *
 * Pure, and importing nothing, so it can be tested without React Native.
 */

export type DateChoice = {
  /** The years on offer: this one and the next. */
  years: number[];
  year: number;
  /** 1–12, or null until the athlete picks one. */
  month: number | null;
  day: number | null;
};

/** Days in a month, so February never offers a 30th. */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * What the chips show. A saved date wins; before there is one, `heldYear` is
 * the year the athlete tapped, and this year is the default.
 */
export function readDateChoice(
  value: string | null,
  heldYear: number | null,
  minDate: string,
): DateChoice {
  const thisYear = new Date(`${minDate}T00:00:00Z`).getUTCFullYear();
  const parsed = value ? new Date(`${value}T00:00:00Z`) : null;
  return {
    years: [thisYear, thisYear + 1],
    year: parsed?.getUTCFullYear() ?? heldYear ?? thisYear,
    month: parsed ? parsed.getUTCMonth() + 1 : null,
    day: parsed?.getUTCDate() ?? null,
  };
}

/**
 * The ISO date for a choice, or null while there is no month to make one.
 *
 * Clamps rather than rejects: moving from the 31st to February lands on the
 * 28th, not on a cleared answer.
 */
export function dateFromChoice(year: number, month: number | null, day: number | null): string | null {
  if (month == null) return null;
  const d = Math.min(day ?? 1, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** What the chooser keeps between taps. */
export type DateChooserState = { value: string | null; heldYear: number | null };

/**
 * One tap on a year, month or day chip. Returns the next state; `value` is
 * what gets saved, and changes only once there is a whole date to save.
 */
export function tapDateChip(
  state: DateChooserState,
  minDate: string,
  tap: { year: number } | { month: number } | { day: number },
): DateChooserState {
  const current = readDateChoice(state.value, state.heldYear, minDate);
  const year = 'year' in tap ? tap.year : current.year;
  const month = 'month' in tap ? tap.month : current.month;
  const day = 'day' in tap ? tap.day : current.day;
  return {
    value: dateFromChoice(year, month, day) ?? state.value,
    heldYear: 'year' in tap ? tap.year : state.heldYear,
  };
}
