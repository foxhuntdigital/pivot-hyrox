/**
 * Links Supabase's auth emails send back into the app.
 *
 * The app confirms sign-ups and resets passwords by six-digit code, so nothing
 * it asks for arrives as a link. But a link can still arrive: an email sent
 * before the templates carried codes, or a Supabase redirect after a link was
 * opened ("Email link is invalid or has expired"). Those come in as
 * `pivot://#access_token=…` or `pivot://#error=…`, which match no route, and
 * Expo Router showed "Unmatched Route" with the raw error in the URL.
 */
const AUTH_PARAMS = /(^|[#?&])(error|error_code|error_description|access_token|refresh_token|token_hash|type|code)=/;

export function isAuthCallback(url: string): boolean {
  let text = url;
  // The fragment can arrive percent-encoded once or twice (%23, %2523).
  for (let i = 0; i < 2; i++) {
    try { text = decodeURIComponent(text); } catch { break; }
  }
  return AUTH_PARAMS.test(text);
}
