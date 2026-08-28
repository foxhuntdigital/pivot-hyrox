-- Subscription entitlement.
--
-- The server owns this, not the device. Gating in React Native only hides UI:
-- the Edge Functions are the product, and anyone holding their own JWT can call
-- them directly. So entitlement is checked where the work happens.
--
-- RevenueCat is the billing system of record and writes here by webhook. The
-- app never writes it — a client that could grant itself access is not a
-- paywall.

create table if not exists public.subscriptions (
  user_id             uuid primary key references public.users(id) on delete cascade,
  -- RevenueCat's app user id. We call Purchases.logIn(users.id), so this is
  -- normally the same value; kept separate because RevenueCat can alias ids
  -- when an anonymous purchase is later attached to an account.
  rc_app_user_id      text unique,
  entitlement         text not null default 'pivot_engine_pro',

  -- 'trialing'  paid nothing yet, fully entitled
  -- 'active'    paying
  -- 'in_grace'  payment failed, store is retrying, access preserved
  -- 'expired'   access ended
  -- 'revoked'   refunded or charged back — access removed retroactively
  status              text not null default 'expired'
    check (status in ('trialing','active','in_grace','expired','revoked')),

  store               text check (store in ('app_store','play_store','promotional','stripe')),
  product_id          text,
  trial_ends_at       timestamptz,
  -- When the paid-for period runs out. Cancelling does NOT end access: an
  -- athlete who turns off auto-renew on day 2 keeps the other 28 days.
  current_period_end  timestamptz,
  will_renew          boolean not null default false,

  -- Last event applied, for support and for replay-safety.
  last_event_id       text,
  last_event_at       timestamptz,
  updated_at          timestamptz not null default now()
);

create index if not exists subscriptions_period_idx
  on public.subscriptions (current_period_end);

-- ─────────────────────────────────────────────────────────────
-- The one question everything else asks
-- ─────────────────────────────────────────────────────────────
-- Deliberately not "is status = active": trialing and in_grace are entitled,
-- and a cancelled-but-unexpired subscription is still paid for. Gating on
-- cancellation would cut an athlete off weeks early.
create or replace function public.has_active_entitlement(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and s.status in ('trialing','active','in_grace')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

comment on function public.has_active_entitlement is
  'True while access is paid for, including trials, grace periods, and a cancelled subscription that has not yet run out.';

alter table public.subscriptions enable row level security;

-- An athlete may read their own subscription — the app shows the state, the
-- renewal date, and whether a trial is running.
create policy subscriptions_owner_read on public.subscriptions
  for select to authenticated
  using (user_id in (select id from public.users where auth_id = auth.uid()));

-- No insert/update/delete policy for `authenticated` on purpose. Only the
-- webhook, running as service_role, writes here.
grant select on public.subscriptions to authenticated;
grant all    on public.subscriptions to service_role;
grant execute on function public.has_active_entitlement(uuid) to authenticated, service_role;
