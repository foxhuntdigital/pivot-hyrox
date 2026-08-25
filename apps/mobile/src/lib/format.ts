/**
 * Formatters shared across screens.
 *
 * Sleep is shown in three places — Today's stat row, Coach's context chips, and
 * Coach's evidence drawer — and they have to agree. Two of them formatting 4.17
 * hours differently is the kind of thing an athlete reads as the app not knowing
 * its own numbers.
 */

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
