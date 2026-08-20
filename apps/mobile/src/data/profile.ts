/**
 * The editable athlete profile (D22).
 *
 * Mirrors public.athlete_profiles. The postpartum date is display and record
 * only: `monthsPostpartum` renders a live descriptor, but the programming
 * constraint is carried by `considerations`, which the athlete sets explicitly.
 * Elapsed time is not consent, so no threshold here lifts a guardrail.
 */
export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export interface AthleteProfile {
  display_name: string;
  experience_level: ExperienceLevel;
  /** ISO `YYYY-MM-DD`, or null when not recorded. Month precision in the UI. */
  postpartum_birth_date: string | null;
}

export function isExperienceLevel(v: unknown): v is ExperienceLevel {
  return typeof v === 'string' && (EXPERIENCE_LEVELS as readonly string[]).includes(v);
}

/**
 * Parsed as a local date. `new Date('2024-11-01')` is UTC midnight, which lands
 * on the previous day west of Greenwich and would report a month too many.
 */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // Rejects 2024-02-31 and friends, which Date would silently roll forward.
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    ? date : null;
}

export function toISODate(year: number, month1to12: number, day = 1): string {
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole months elapsed, floored. Null when the date is absent or in the future. */
export function monthsPostpartum(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const birth = parseISODate(iso);
  if (!birth) return null;
  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  return months < 0 ? null : months;
}

export function postpartumPhrase(iso: string | null, now: Date = new Date()): string | null {
  const months = monthsPostpartum(iso, now);
  if (months === null) return null;
  if (months === 0) return 'Under 1 month postpartum';
  return `${months} month${months === 1 ? '' : 's'} postpartum`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  const letters = parts.length === 1
    ? parts[0].slice(0, 2)
    : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export function levelLabel(level: ExperienceLevel): string {
  return level[0].toUpperCase() + level.slice(1);
}

/** The line under the athlete's name — recomputed, never stored. */
export function descriptorOf(profile: AthleteProfile, now: Date = new Date()): string {
  return [levelLabel(profile.experience_level), 'Hybrid',
    postpartumPhrase(profile.postpartum_birth_date, now)]
    .filter(Boolean).join(' · ');
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}
