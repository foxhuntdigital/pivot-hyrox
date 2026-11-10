/**
 * Crash and error reporting.
 *
 * The posture is `lib/analytics.ts`'s, for the same reason: this is a second
 * pipe out of the app to a third party, and §15 does not care which vendor is
 * on the other end of it. So the rules that file enforces are enforced here
 * too, and an absent DSN is a supported state rather than an error — `init`
 * becomes a no-op and the app runs exactly as it did before. Crash reporting
 * must never be the reason a workout screen fails to open.
 *
 * What is different from Sentry's recommended React Native setup, and why:
 *
 *   * `sendDefaultPii` stays off (its default, stated here because it is
 *     load-bearing rather than incidental — Sentry's own RN guide turns it on).
 *     It would attach request bodies, headers and user details to every event.
 *   * Session Replay is not enabled. Mobile replay records the screen, and
 *     these screens render HealthKit resting HR, HRV and sleep, the readiness
 *     check-in, and the athlete's considerations. The masking defaults are not
 *     a thing to stake that promise on.
 *   * Breadcrumbs are filtered rather than taken as they come: see
 *     `scrubBreadcrumb`. The stack trace is what debugs a crash; the trail of
 *     taps and request URLs leading to it is where the health data would ride
 *     along.
 *
 * What identifies an event is the Supabase auth UUID and nothing else — the
 * same join key, and the same omissions, as `identifyAthlete`.
 */
import { isRunningInExpoGo } from 'expo';
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const isMonitoringConfigured = Boolean(dsn);

/**
 * The deploy an event came from.
 *
 * `__DEV__` only distinguishes Metro from a compiled binary, which would file
 * every internal preview build under `production` alongside real athletes.
 * `EXPO_PUBLIC_ENV` is set per EAS build profile; the fallback is what a local
 * `expo run:ios` gets.
 */
const environment = process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'development' : 'production');

let started = false;

/**
 * Starts the SDK. Safe to call more than once, for the reason `initAnalytics`
 * is: React 19 strict mode mounts effects twice in development.
 */
export function initMonitoring(): void {
  if (!dsn || started) return;
  started = true;

  Sentry.init({
    dsn,
    environment,

    // Stated rather than left to the default. See the header.
    sendDefaultPii: false,

    // Everything in dev, a fifth in production: traces are sampled for volume,
    // and errors are not affected by this rate.
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,

    // Slow and frozen frames come from the native layer, which Expo Go does not
    // have — asking for them there logs a warning on every start.
    enableNativeFramesTracking: !isRunningInExpoGo(),

    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}

/**
 * Ties events to the athlete, on the same paths as the analytics identity.
 *
 * Null on sign-out: the next athlete on a shared phone must not inherit the
 * last one's crashes.
 */
export function identifyForMonitoring(userId: string | null): void {
  if (!dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/**
 * Reports a handled failure that the athlete should not have to tell us about.
 *
 * For the best-effort paths that currently warn to a console nobody is reading
 * in production — a refused save, a fetch that fell back to bundled content.
 * `where` is the subject, matching the `[profile]`-style prefixes those call
 * sites already use, and it becomes the issue's fingerprint so one failing
 * repository does not scatter across a dozen issues.
 */
export function captureProblem(where: string, error: unknown): void {
  if (!dsn) return;
  Sentry.withScope(scope => {
    scope.setTag('where', where);
    scope.setFingerprint(['{{ default }}', where]);
    Sentry.captureException(error instanceof Error ? error : new Error(`${where}: ${String(error)}`));
  });
}

/**
 * Drops the breadcrumbs that would carry an athlete's numbers off the phone.
 *
 * Three classes, each for a concrete reason rather than caution in general:
 *
 *   * `ui.click` / touch. The native layer labels a touch with the view's
 *     accessibility label, and this app builds those out of the values
 *     themselves — `app/checkin.tsx:173` renders "Sleep 6.5 hours" and
 *     "Soreness 4 of 5". Those are the raw numbers §15 asks to keep out and
 *     that `bucketSleep` and `bucketScale` exist to avoid sending.
 *   * `console`. The app's own warnings pass error objects straight through
 *     (`equipmentCatalogue.ts:27`, `preferencesRepo.ts:64`), and a PostgREST
 *     error can quote the row it refused. Kept in development, where the
 *     breadcrumb never leaves the machine and is the useful one.
 *   * Query strings on request breadcrumbs. A PostgREST filter puts its values
 *     in the URL. The path alone still says which table was being read, which
 *     is the part that debugs anything.
 */
function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'ui.click' || breadcrumb.category === 'touch') return null;
  if (breadcrumb.category === 'console' && !__DEV__) return null;

  const url = breadcrumb.data?.url;
  if (typeof url === 'string' && (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch')) {
    const [path] = url.split('?');
    return { ...breadcrumb, data: { ...breadcrumb.data, url: path } };
  }

  return breadcrumb;
}

/**
 * Last gate before an event is sent.
 *
 * `sendDefaultPii: false` already keeps request bodies and headers off events;
 * this drops the request entirely rather than trusting that one option across
 * SDK upgrades, and clears any user field an integration populated beyond the
 * id `identifyForMonitoring` sets.
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.request;
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  return event;
}
