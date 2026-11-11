-- End the beta's comped access at signup.
--
-- 0019 extended the signup trigger to give every new account a free
-- 'beta_comp' subscription while `app_config.beta_open` was true. That switch
-- was turned off on 2026-11-11, which is enough to stop new grants, but it
-- leaves the grant one setting away from coming back: anyone who flips
-- `beta_open` (or a restore of 0019's seed) would quietly give every new
-- signup free access again, including App Review's account, which then never
-- reaches the paywall (guideline 2.1).
--
-- So the grant comes out of the trigger, which goes back to 0004's body:
-- provision the user and their profile, nothing else.
--
-- Deliberately left alone:
--   * Existing `beta_comp` rows. The beta testers keep their access to its
--     end date (a decision recorded in docs/launch-checklist.md). They expire
--     on their own, and the app then shows "Your plan is waiting".
--   * `public.app_config`. Nothing reads it any more, but it holds the record
--     of when the beta window was, and dropping it buys nothing.
--
-- Who is still comped, and until when:
--   select u.email, s.current_period_end
--     from public.subscriptions s join public.users u on u.id = s.user_id
--    where s.product_id = 'beta_comp' order by u.email;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user_id uuid;
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

  return new;
end;
$$;

-- Belt and braces: the switch stays off even though nothing reads it now.
update public.app_config set beta_open = false, updated_at = now() where beta_open;

comment on table public.app_config is
  'Beta access switch, retired in 0027 (the signup trigger no longer reads it). Kept as a record of the beta window.';
