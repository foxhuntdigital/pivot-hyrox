/**
 * Formatters shared across screens.
 *
 * Sleep is shown in three places — Today's stat row, Coach's context chips, and
 * Coach's evidence drawer — and they have to agree. Two of them formatting 4.17
 * hours differently is the kind of thing an athlete reads as the app not knowing
 * its own numbers.
 */

/**
 * Seconds → "4:12". The workout clock, everywhere it appears.
 *
 * Here rather than in `steps.ts` because the split lists on the summary and in
 * history need it, and `steps.ts` reaches for the content library to name
 * exercises. History in particular must not depend on the engine or the plan —
 * it is the surface that survives a lapsed subscription — and a time formatter
 * is no reason to give it one.
 */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 4.17 → "4:10". Null hours mean unknown, which is not the same as zero. */
export function hoursToClock(hours: number | null | undefined): string | null {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return null;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  // 4.999 h would otherwise render "4:60".
  if (minutes === 60) return `${whole + 1}:00`;
  return `${whole}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * The engine caps recovery below five hours (`guardrails.ts`), so that is the
 * threshold the accent is tied to. The colour then means "this changed today's
 * session", rather than being decorative.
 */
export const LOW_SLEEP_HOURS = 5;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The app header's date — "Wed 19 Aug".
 *
 * Formatted here rather than with `toLocaleDateString`: Hermes ships without
 * full ICU on some builds and silently falls back to a different shape, which
 * is how a release build ends up disagreeing with the simulator about what
 * today looks like. This is also the device's own day, not the plan's — the
 * header answers "what is the date", and an athlete travelling should not see
 * yesterday because their stored timezone says so.
 */
export function headerDateLabel(now: Date = new Date()): string {
  return `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS_SHORT[now.getMonth()]}`;
}

/**
 * Today, as the device's own calendar reads it — `2026-09-03`.
 *
 * `new Date().toISOString().slice(0, 10)` is UTC, and it was standing in for a
 * local date in three places that all mattered: the engine's `local_date`, the
 * day a queued finish is filed under, and the day Plan matches that finish
 * against. Every one of those fallbacks fires precisely when the server has not
 * answered — offline — so an athlete west of UTC finishing an evening session
 * had it filed under tomorrow, where "completed today" could never find it.
 *
 * Built from the `Date` accessors rather than `Intl.DateTimeFormat` for the
 * same reason `headerDateLabel` is: Hermes ships without full ICU on some
 * builds, and a release that silently formats differently from the simulator is
 * the harder bug of the two. These accessors are always the device's own zone.
 *
 * This is the device's day, not the athlete's stored timezone. The server still
 * owns that answer and still wins whenever it has given one — this is only what
 * to believe until it does.
 */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
