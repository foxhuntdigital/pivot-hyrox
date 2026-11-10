/**
 * Error reporting for the Edge Functions.
 *
 * What this replaces: every handler ended its `catch` by turning the error into
 * a response, and the best-effort paths ended theirs with `console.error`. Both
 * are still right — a failed request must answer, and a failed stimulus-credit
 * write must not fail the session — but `console.error` goes to the Supabase
 * function log, where nothing aggregates it, nothing alerts on it, and nobody
 * is looking. A 500 that happens fifty times a day currently looks exactly
 * like one that happened once.
 *
 * ── Which failures are reported ──────────────────────────────────────────────
 *
 * Only 5xx. The 4xx an `HttpError` carries are the API working correctly: a
 * 401 is an expired token, a 402 is an athlete without a subscription, a 409
 * is `validateReshape` refusing to move a session that already started. Those
 * are answers, not incidents, and reporting them would bury the ones that are.
 *
 * ── What is deliberately not sent ────────────────────────────────────────────
 *
 * `@sentry/deno` v11 replaced `sendDefaultPii` with `dataCollection`, and its
 * defaults collect everything: request and response bodies, all headers,
 * cookies, query params, resolved user info, database query data, and local
 * variables in stack frames. For these functions that default is the whole
 * problem, not a detail:
 *
 *   * The request body IS the sensitive data. `recovery-checkin` posts sleep,
 *     soreness and symptoms; `coach` posts the athlete's message text;
 *     `complete-workout` posts session notes. §15 keeps those off third-party
 *     services, and `apps/mobile/src/lib/analytics.ts` enforces the same rule
 *     for Amplitude.
 *   * The `Authorization` header is the athlete's live Supabase JWT. Sentry
 *     filters well-known secret keys, but a bearer token is not something to
 *     send and rely on being filtered.
 *   * Stack frame locals in these handlers hold the parsed body — the readiness
 *     numbers and the notes, one frame below where they arrived.
 *   * Database query data would carry the same values back in PostgREST form.
 *
 * So every collector is turned off explicitly. What is left is the thing that
 * debugs a 500: the error, its stack, which function, and which athlete by
 * opaque id.
 */
import * as Sentry from 'npm:@sentry/deno@11.11.0';

const dsn = Deno.env.get('SENTRY_DSN');

/** False in local `supabase functions serve` runs with no secret set. */
export const isMonitoringConfigured = Boolean(dsn);

/**
 * Started at module scope, not from a function each handler has to remember to
 * call.
 *
 * The SDK has to be initialised before `Deno.serve` runs, and an ES module's
 * imports are fully evaluated before the importing module's body — so every
 * function that imports `captureFailure` gets this for free, in the right
 * order. The alternative was an `initMonitoring()` line in fourteen entry
 * files, which is fourteen chances for a new function to be the one that
 * silently reports nothing.
 */
if (dsn) {
  Sentry.init({
    dsn,
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    release: Deno.env.get('SENTRY_RELEASE'),

    // A tenth of requests traced. Errors are not sampled by this.
    tracesSampleRate: 0.1,

    // See the header. Every one of these defaults to collecting.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },

    beforeSend: scrubEvent,
  });
}

/**
 * Reports a request that failed with a 5xx, then flushes.
 *
 * Awaited rather than fired and forgotten: an Edge Function isolate can be
 * frozen as soon as the handler's response is returned, and an envelope still
 * sitting in the transport queue at that moment is simply lost. `flush` is
 * bounded so a Sentry outage cannot hold a response open — a dropped report is
 * better than a hung request.
 *
 * Returns nothing and throws nothing: this runs inside a `catch` whose job is
 * to answer the caller, and a reporting failure must not replace the real
 * error with its own.
 */
export async function captureFailure(
  err: unknown,
  status: number,
  where: { fn: string; userId?: string | null },
): Promise<void> {
  if (!dsn || status < 500) return;
  try {
    Sentry.withScope(scope => {
      scope.setTag('function', where.fn);
      scope.setTag('status', String(status));
      if (where.userId) scope.setUser({ id: where.userId });
      Sentry.captureException(asError(err));
    });
    await Sentry.flush(2000);
  } catch {
    // Intentionally silent. See above.
  }
}

/**
 * Reports a best-effort write that did not land, on a request that carries on
 * regardless.
 *
 * These are the failures that were invisible: the capability evidence insert in
 * `complete-workout`, the session block insert in `start-workout`, the first
 * week's queue in `onboarding-plan`. Staying best-effort is deliberate — none
 * of them should cost the athlete their session — but staying silent was not a
 * decision, just the absence of anywhere to report to.
 *
 * `where` becomes the fingerprint, so one failing write is one issue rather
 * than a new one per stack shape.
 */
export async function captureProblem(where: string, err: unknown): Promise<void> {
  if (!dsn) return;
  try {
    Sentry.withScope(scope => {
      scope.setTag('where', where);
      scope.setLevel('warning');
      scope.setFingerprint(['{{ default }}', where]);
      Sentry.captureException(asError(err));
    });
    await Sentry.flush(2000);
  } catch {
    // As above.
  }
}

/** Supabase client errors arrive as plain objects with a `message`. */
function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return new Error(String((err as { message: unknown }).message));
  }
  return new Error(String(err));
}

/**
 * Last gate before an event leaves.
 *
 * `dataCollection` above already stops the collectors that would attach a
 * request. This removes it outright, so a future SDK default or a new
 * integration cannot quietly put one back.
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.request;
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  return event;
}
