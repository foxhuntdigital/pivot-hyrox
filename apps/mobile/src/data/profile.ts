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
  /**
   * What the athlete can absorb and how technical a session they can perform
   * well, 1-4 each (migration 0023). Null until they have answered.
   *
   * `experience_level` above is retained as context and is no longer read by
   * anything that decides programming.
   */
  load_capacity: number | null;
  technical_capacity: number | null;
  /** ISO `YYYY-MM-DD`, or null when not recorded. Month precision in the UI. */
  postpartum_birth_date: string | null;
  /**
   * 0 = very predictable, 1 = fully unpredictable. Declared in onboarding (D06)
   * and editable on Profile; both write the same column, so the answer given
   * once is the answer the screen shows.
   */
  schedule_predictability: number;
  /**
   * Return-to-training considerations. SENSITIVE: these constrain what the
   * engine may program, so they are read from the athlete's own row and never
   * defaulted on their behalf — a consideration nobody set must not appear set.
   */
  considerations: string[];
  /** The session length the plan is built around. */
  typical_session_minutes: number;
}

/**
 * The return-to-training considerations the app offers.
 *
 * A list of choices, not a set of defaults: what an athlete has selected comes
 * from their own row, and anything stored outside this list is shown alongside
 * it rather than dropped (see `readConsiderations`).
 */
export const CONSIDERATION_CHOICES = [
  'Returning from injury',
  'Postpartum',
  'Breastfeeding',
  // Temporarily withdrawn from onboarding and Profile.
  //
  // Removing it from this list hides it in both places at once, and does so
  // without touching anyone who has already chosen it: Profile renders the
  // choices plus anything stored outside them, so an athlete who set it keeps
  // seeing it, keeps its programming constraints, and can still remove it. The
  // engine reads the stored string (`POSTPARTUM_CONSIDERATIONS` in
  // guardrails.ts), not this list, so their content stays correctly limited.
  //
  // Restore by uncommenting — nothing else has to change.
  // 'Pelvic-floor considerations',
];

/** The session lengths Profile offers for this field (PRD §6.1 step 6). */
export const SESSION_MINUTES = [15, 30, 45, 60, 90] as const;

export const DEFAULT_SESSION_MINUTES = 45;

export function clampSessionMinutes(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.round(v) : DEFAULT_SESSION_MINUTES;
}

/**
 * Considerations as stored, coerced to a list of non-empty strings.
 *
 * Values outside the app's own choice list are kept rather than filtered out.
 * The column is the athlete's, and silently dropping a constraint we did not
 * recognise is the one failure mode this field cannot have.
 */
export function readConsiderations(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];
}

/**
 * The three answers the athlete can give. Stored as a real rather than an enum
 * because the column is a 0–1 scale — these are the points on it that the UI
 * offers, and `nearestPredictability` maps any stored value back onto one.
 */
export const PREDICTABILITY_CHOICES = [
  { value: 0.1, label: 'Same time daily', phrase: 'very predictable' },
  { value: 0.5, label: 'Roughly regular', phrase: 'roughly regular' },
  { value: 0.9, label: 'Never the same', phrase: 'mostly unpredictable' },
] as const;

export type PredictabilityChoice = (typeof PREDICTABILITY_CHOICES)[number];

/** At or above this, the engine pre-generates Express and Micro variants. */
export const VARIANTS_AHEAD_AT = 0.7;

/** Column default, and what an unreadable value falls back to. */
export const DEFAULT_PREDICTABILITY = 0.5;

export function clampPredictability(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(1, Math.max(0, v)) : DEFAULT_PREDICTABILITY;
}

/**
 * The choice a stored value sits closest to. The column accepts any 0–1 real —
 * a value set outside this app, or a scale we later re-point, still has to
 * render as one of the options rather than as no selection at all.
 */
export function nearestPredictability(v: number): PredictabilityChoice {
  return PREDICTABILITY_CHOICES.reduce((best, c) =>
    Math.abs(c.value - v) < Math.abs(best.value - v) ? c : best);
}

export function predictabilityPhrase(v: number): string {
  return nearestPredictability(v).phrase;
}

export function preGeneratesVariants(v: number): boolean {
  return v >= VARIANTS_AHEAD_AT;
}

/**
 * The profile before an account answers. Empty, not seeded: a name nobody typed
 * and a consideration nobody set would both render as the athlete's own.
 */
export const EMPTY_PROFILE: AthleteProfile = {
  display_name: '',
  experience_level: 'intermediate',
  load_capacity: null,
  technical_capacity: null,
  postpartum_birth_date: null,
  schedule_predictability: DEFAULT_PREDICTABILITY,
  considerations: [],
  typical_session_minutes: DEFAULT_SESSION_MINUTES,
};

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
