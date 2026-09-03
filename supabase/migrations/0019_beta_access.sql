-- Comped access for the beta.
--
-- The problem this solves: `trial.tsx` is the only route into the app, and it
-- opens only when the server says the athlete is entitled. It reads
-- `public.subscriptions` directly rather than keying off the Edge Functions'
-- 402, so relaxing `requireEntitlement` alone would change nothing for a new
-- signup — the functions would stop refusing, and nobody would reach them.
--
-- Both gates read this one table, so one row satisfies both. That is the whole
-- mechanism: no flag in the Edge Functions, no bypass compiled into the client,
-- no release. The RevenueCat SDK stays configured and the webhook stays live,
-- so the purchase path keeps working rather than rotting for the length of the
-- beta — and a tester who does buy has their comped row cleanly overwritten,
-- because the webhook upserts on `user_id` and this row is not special to it.
--
-- Three independent ways out, because the failure mode here is silent — free
-- access that outlives the beta breaks nothing and so tells you nothing:
--
--   1. `app_config.beta_open` — stops new grants immediately, no migration.
--   2. `app_config.beta_period_end` — every grant expires on its own.
--   3. `product_id = 'beta_comp'` — finds every one of them, for cleanup.
--
-- This must come out before App Store submission. Not for the code's sake —
-- dormant purchase code is not a review problem — but because a reviewer who
-- signs up gets comped too, never reaches the paywall, and cannot test an IAP
-- product attached to the version. That is a 2.1 rejection.

-- ─────────────────────────────────────────────────────────────
-- The switch
-- ─────────────────────────────────────────────────────────────
-- Single-row: `id` is a boolean pinned true by its own check constraint, so a
-- second row cannot be inserted and no query needs to pick between rows.
create table if not exists public.app_config (
  id              boolean primary key default true check (id),

  -- Closed by default at the column level even though the seed below opens it.
  -- If this table is ever recreated from the schema without the seed, it comes
  -- back shut rather than open.
  beta_open       boolean not null default false,

  -- One date for the whole cohort, not a rolling window per athlete: this is a
  -- beta that ends, not a free tier that renews. Read at signup and copied onto
  -- the row, so moving it forward extends future grants without retroactively
  -- extending — or shortening — access someone already has.
  beta_period_end timestamptz not null default (now() + interval '90 days'),

  updated_at      timestamptz not null default now()
);

comment on table public.app_config is
  'Server-side switches. Never readable by the app — see the RLS note below.';

insert into public.app_config (id, beta_open, beta_period_end)
values (true, true, now() + interval '90 days')
on conflict (id) do nothing;

-- No policies and no grants for `authenticated`, on purpose. The trigger below
-- is `security definer` and so reads this regardless; nothing else should. A
-- client that can read the switch learns whether it is being comped, and a
-- client that could write it would be granting itself a subscription.
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant  all on public.app_config to service_role;

-- ─────────────────────────────────────────────────────────────
-- Granting at signup
-- ─────────────────────────────────────────────────────────────
-- Extends 0004's provisioning rather than adding a second trigger on
-- public.users: the row has to exist before the client's first authenticated
-- read, and 0004 already establishes that provisioning runs inside the auth
-- insert's transaction for exactly that reason. A separate trigger would work
-- but would put the ordering back in question.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user_id uuid;
  cfg         public.app_config%rowtype;
begin
  insert into public.users (auth_id, email)
  values (new.id, new.email)
  on conflict (auth_id) do nothing
  returning id into new_user_id;

  -- A repeated trigger (or a race with a client-side insert) must not fail the
  -- signup, so recover the id rather than assuming the insert returned one.
  if new_user_id is null then
    select id into new_user_id from public.users where auth_id = new.id;
  end if;

  insert into public.athlete_profiles (user_id, display_name)
  values (
    new_user_id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (user_id) do nothing;

  -- Beta comp. Wrapped so that nothing here can fail a signup: this is
  -- temporary scaffolding, and the cost of it going wrong must be an athlete
  -- who sees the paywall, never an athlete who cannot create an account.
  begin
    select * into cfg from public.app_config where id;

    if found and cfg.beta_open and cfg.beta_period_end > now() then
      insert into public.subscriptions (
        user_id, status, store, product_id,
        trial_ends_at, current_period_end, will_renew
      )
      values (
        new_user_id, 'trialing', 'promotional', 'beta_comp',
        cfg.beta_period_end, cfg.beta_period_end, false
      )
      -- Never over a real subscription. Reinstalls and second devices reach
      -- this path too, and the billing system of record outranks a comp.
      on conflict (user_id) do nothing;
    end if;
  exception when others then
    null;
  end;

  return new;
end;
$$;

-- The trigger itself is unchanged from 0004; recreated so this migration is
-- self-contained if the function is ever restored from here.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ─────────────────────────────────────────────────────────────
-- Backfill
-- ─────────────────────────────────────────────────────────────
-- Everyone who signed up before this ran — including the testers currently
-- stuck on the "See plans" screen, which is what prompted all of it. No list
-- needed: the condition is having an account, not being known in advance.
insert into public.subscriptions (
  user_id, status, store, product_id,
  trial_ends_at, current_period_end, will_renew
)
select u.id, 'trialing', 'promotional', 'beta_comp',
       c.beta_period_end, c.beta_period_end, false
from public.users u
cross join public.app_config c
where c.beta_open
  and c.beta_period_end > now()
on conflict (user_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Turning it off
-- ─────────────────────────────────────────────────────────────
--   Stop new grants, keep existing ones running to their date:
--     update public.app_config set beta_open = false, updated_at = now();
--
--   Extend the window (future grants only — issued rows keep their own date):
--     update public.app_config
--        set beta_period_end = now() + interval '30 days', updated_at = now();
--
--   Who is comped, and until when:
--     select u.email, s.current_period_end
--       from public.subscriptions s join public.users u on u.id = s.user_id
--      where s.product_id = 'beta_comp' order by u.email;
--
--   Full removal, before App Store submission. Restore 0004's function body
--   first, then:
--     update public.app_config set beta_open = false;
--     delete from public.subscriptions where product_id = 'beta_comp';
