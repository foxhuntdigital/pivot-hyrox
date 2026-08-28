/**
 * POST /v1/revenuecat-webhook — billing events from RevenueCat.
 *
 * RevenueCat is the system of record for what has been paid for; this keeps a
 * local copy so every other function can answer "is this athlete entitled"
 * without a network call on the critical path.
 *
 * Two things make it safe to expose:
 *
 *  - It is not JWT-verified (RevenueCat has no user token), so it authenticates
 *    on a shared secret sent in the Authorization header. Without the secret
 *    configured the endpoint refuses every request rather than running open.
 *  - It writes with the service role, because the athlete must never be able to
 *    grant themselves entitlement.
 *
 * Events can arrive out of order and more than once, so the write is idempotent
 * and an event older than the one already stored is ignored.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, json } from '../_shared/context.ts';

/**
 * The entitlement configured in RevenueCat. Events for any other entitlement
 * are not this product and must not grant access.
 */
const ENTITLEMENT_ID = 'pivot_engine_pro';

/**
 * RevenueCat event types → the state they leave the subscription in.
 *
 * TRANSFER and SUBSCRIPTION_PAUSED are deliberately absent: they need their own
 * handling rather than a status guess, and an unmapped event is recorded and
 * ignored rather than silently changing access.
 */
const STATUS_BY_TYPE: Record<string, 'trialing' | 'active' | 'in_grace' | 'expired' | 'revoked'> = {
  INITIAL_PURCHASE: 'active',
  RENEWAL: 'active',
  PRODUCT_CHANGE: 'active',
  UNCANCELLATION: 'active',
  NON_RENEWING_PURCHASE: 'active',
  // Cancellation is not loss of access — it turns off auto-renew and the
  // athlete keeps what they paid for until current_period_end.
  CANCELLATION: 'active',
  BILLING_ISSUE: 'in_grace',
  SUBSCRIPTION_EXTENDED: 'active',
  EXPIRATION: 'expired',
  // Apple can claw a purchase back after the fact, so access has to be
  // removable and not only grantable.
  REFUND: 'revoked',
};

const STORE_BY_NAME: Record<string, string> = {
  APP_STORE: 'app_store', MAC_APP_STORE: 'app_store',
  PLAY_STORE: 'play_store', PROMOTIONAL: 'promotional', STRIPE: 'stripe',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  // Refusing when unconfigured is the safe direction: an open webhook that
  // grants entitlement is worse than one that is switched off.
  if (!secret) return json({ error: 'webhook not configured' }, 503, origin);
  if (req.headers.get('Authorization') !== secret) return json({ error: 'unauthorized' }, 401, origin);

  try {
    const body = await req.json();
    const event = body?.event ?? body;
    const type: string = event?.type ?? '';
    const appUserId: string | null = event?.app_user_id ?? null;
    if (!appUserId) return json({ error: 'no app_user_id' }, 400, origin);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    /*
     * Resolve the athlete from RevenueCat's app user id.
     *
     * `public.users.id` and `auth.users.id` are different uuids joined by
     * `auth_id`, and the client only has the auth one to hand at sign-in. So
     * both are accepted: whichever the app was configured with, the purchase
     * lands on the right account. Matching only one of them would mean every
     * webhook silently no-ops while the athlete is charged — the worst
     * possible failure, and an invisible one.
     *
     * Aliases are included so a purchase made before sign-in still attaches.
     */
    const candidates = [appUserId, ...(event?.aliases ?? [])]
      .filter((a: string) => /^[0-9a-f-]{36}$/i.test(a));
    if (!candidates.length) return json({ ok: true, ignored: 'no usable app_user_id' }, 200, origin);

    const { data: matches } = await db.from('users')
      .select('id, auth_id')
      .or(`id.in.(${candidates.join(',')}),auth_id.in.(${candidates.join(',')})`)
      .limit(1);
    const user = matches?.[0];
    if (!user) return json({ ok: true, ignored: 'unknown app_user_id' }, 200, origin);

    const status = STATUS_BY_TYPE[type];
    if (!status) return json({ ok: true, ignored: `unmapped event ${type}` }, 200, origin);

    // A RevenueCat project can sell more than one thing. An event for some
    // other entitlement is not a licence for this one.
    const entitlements: string[] = event?.entitlement_ids ?? [];
    if (entitlements.length && !entitlements.includes(ENTITLEMENT_ID)) {
      return json({ ok: true, ignored: `entitlement ${entitlements.join(',')}` }, 200, origin);
    }

    const eventAt = event?.event_timestamp_ms ? new Date(event.event_timestamp_ms).toISOString() : null;

    // Out-of-order delivery is normal; an event older than what we already
    // applied must not roll a subscription backwards.
    const { data: existing } = await db.from('subscriptions')
      .select('last_event_at, last_event_id').eq('user_id', user.id).maybeSingle();
    if (existing?.last_event_id && existing.last_event_id === event?.id) {
      return json({ ok: true, ignored: 'duplicate event' }, 200, origin);
    }
    if (existing?.last_event_at && eventAt && eventAt < existing.last_event_at) {
      return json({ ok: true, ignored: 'stale event' }, 200, origin);
    }

    const periodEnd = event?.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString() : null;

    const { error } = await db.from('subscriptions').upsert({
      user_id: user.id,
      rc_app_user_id: appUserId,
      entitlement: event?.entitlement_ids?.[0] ?? ENTITLEMENT_ID,
      // A trial is a paid period that has not been charged for; RevenueCat
      // flags it separately from the event type.
      status: event?.period_type === 'TRIAL' && status === 'active' ? 'trialing' : status,
      store: STORE_BY_NAME[event?.store ?? ''] ?? null,
      product_id: event?.product_id ?? null,
      trial_ends_at: event?.period_type === 'TRIAL' ? periodEnd : null,
      current_period_end: periodEnd,
      will_renew: type !== 'CANCELLATION' && type !== 'EXPIRATION',
      last_event_id: event?.id ?? null,
      last_event_at: eventAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    if (error) return json({ error: error.message }, 500, origin);
    return json({ ok: true, status, user_id: user.id }, 200, origin);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500, origin);
  }
});
