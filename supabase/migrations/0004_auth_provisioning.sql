-- Auth provisioning + the profile fields the Profile screen edits.
--
-- Every owner-scoped policy resolves through public.current_app_user_id(),
-- which maps auth.uid() to public.users.id. A freshly signed-up auth user has
-- no such row, so without this trigger their first authenticated query would
-- silently return nothing rather than fail loudly. Provisioning therefore runs
-- in the same transaction as the auth insert, not from the client.

alter table public.athlete_profiles
  add column if not exists display_name text,
  -- Date of birth of the athlete's child. Drives the live "N months
  -- postpartum" descriptor only; the programming constraint is carried by
  -- `considerations`, which the athlete controls explicitly. A date is never
  -- read as consent to lift a safety constraint.
  add column if not exists postpartum_birth_date date;

comment on column public.athlete_profiles.postpartum_birth_date is
  'SENSITIVE. Display/record only — never relaxes the postpartum guardrail.';

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
