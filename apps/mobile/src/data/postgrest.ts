/**
 * One place to turn a PostgREST failure into a real Error.
 *
 * supabase-js returns its failures as plain objects — `{ message, details,
 * hint, code }` — not as `Error` instances, so `throw error` leaves every
 * caller's `instanceof Error` check false. Callers written the usual way then
 * fall through to their own fallback string, and the actual cause — an expired
 * token, a denied policy, a dropped connection — is replaced by a generic
 * "Could not load profile" that says nothing to the athlete and nothing to a
 * TestFlight bug report either.
 *
 * The code travels with the message for the same reason: `PGRST301` in a
 * screenshot is worth more than the sentence around it.
 */
export interface PostgrestFailure {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

export function postgrestError(error: PostgrestFailure): Error {
  const suffix = [error.code, error.hint].filter(Boolean).join(' · ');
  const e = new Error(suffix ? `${error.message} (${suffix})` : error.message);
  e.name = 'PostgrestError';
  return e;
}
