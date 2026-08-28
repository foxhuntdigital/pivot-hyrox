-- Account deletion (App Store Guideline 5.1.1(v)) and programs with no race.

-- ─────────────────────────────────────────────────────────────
-- Account deletion
-- ─────────────────────────────────────────────────────────────
--
-- Deleting the auth user is the whole operation: public.users.auth_id cascades
-- from auth.users, and every athlete table cascades from public.users, so one
-- delete removes the account and all of its training data. Nothing is left
-- behind to reconcile, and no table needs to be listed here — a table added
-- later inherits the behaviour from its own foreign key.
--
-- `users.deleted_at` is deliberately not used. A soft delete is a deactivation,
-- and 5.1.1(v) asks for the account and its data to actually go.

-- The one foreign key to public.users that would refuse the delete rather than
-- follow it. Content provenance is worth keeping when its author leaves, but it
-- is not worth keeping the author's account alive for: the row survives with an
-- anonymous author instead.
alter table public.content_versions
  drop constraint if exists content_versions_authored_by_fkey;
alter table public.content_versions
  add constraint content_versions_authored_by_fkey
  foreign key (authored_by) references public.users(id) on delete set null;

/**
 * Deletes the calling athlete's own account.
 *
 * `security definer` because auth.users belongs to the auth schema and no
 * end-user role may write to it. The privilege is bounded by the body rather
 * than by the caller: the only row this can ever delete is the one matching
 * auth.uid(), so it cannot be turned into a way to delete somebody else no
 * matter what it is called with. It takes no arguments for the same reason.
 *
 * This is why the flow is an RPC and not an Edge Function — a function would
 * need the service role key, and the rule the codebase holds to is that the
 * service role never appears on a user-facing path (see _shared/context.ts).
 */
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Permanently deletes the calling account and, by cascade, all of its data. '
  'Bounded to auth.uid() — it cannot delete another athlete.';

-- ─────────────────────────────────────────────────────────────
-- Programs with no race
-- ─────────────────────────────────────────────────────────────
--
-- programs.race_id was already nullable, so a block is legal without this. What
-- is missing is the constraint: `unique (user_id, race_id, version)` does not
-- bind when race_id is null, because Postgres treats nulls as distinct. Without
-- a partial index a replan of a block would silently write a second version 1
-- and both would look active.
create unique index if not exists programs_version_per_user_no_race
  on public.programs (user_id, version) where race_id is null;

-- One active program per athlete, race or block. The existing unique constraint
-- allows an active race program and an active block to coexist, which Today has
-- no way to choose between.
--
-- Any pre-existing overlap is collapsed first, keeping the newest, so the index
-- can be built on a database that predates the rule rather than refusing to
-- apply to it.
update public.programs p set status = 'superseded'
where p.status = 'active'
  and exists (
    select 1 from public.programs q
    where q.user_id = p.user_id
      and q.status = 'active'
      and (q.created_at, q.id) > (p.created_at, p.id)
  );

create unique index if not exists programs_one_active_per_user
  on public.programs (user_id) where status = 'active';
