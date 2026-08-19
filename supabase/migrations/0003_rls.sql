-- Row Level Security (PRD §15.2).
--
--   * Athlete data: readable and writable only by its owner.
--   * Published workout content: readable by any authenticated user, writable
--     only by the service role (content admin runs server-side).
--
-- Every table below has RLS enabled. A table added later without a policy is
-- unreachable by anon/authenticated by default, which is the intended failure
-- direction.

-- Maps the JWT's auth.uid() to our own users.id. STABLE so the planner can
-- cache it per statement rather than re-running it per row.
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where auth_id = auth.uid() and deleted_at is null;
$$;

-- ─────────────────────────────────────────────────────────────
-- Content: read-only to authenticated users
-- ─────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'equipment','exercises','exercise_equipment','tags','workout_templates',
    'workout_variants','workout_blocks','block_exercises','workout_tags',
    'substitutions','progression_rules','race_definitions'
  ] loop
    execute format('alter table content.%I enable row level security', t);
    execute format(
      'create policy %I on content.%I for select to authenticated using (true)',
      t || '_read', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Athlete data: owner-only
-- ─────────────────────────────────────────────────────────────

-- Tables with a direct user_id column.
do $$
declare t text;
begin
  foreach t in array array[
    'athlete_profiles','races','programs','workout_sessions','recovery_checkins',
    'health_daily_metrics','readiness_snapshots','equipment_profiles',
    'adaptation_events','coach_threads'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = public.current_app_user_id())
         with check (user_id = public.current_app_user_id())',
      t || '_owner', t);
  end loop;
end $$;

alter table public.users enable row level security;

create policy users_self on public.users
  for all to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Athlete data reached through a parent row
-- ─────────────────────────────────────────────────────────────

alter table public.program_phases enable row level security;
create policy program_phases_owner on public.program_phases
  for all to authenticated
  using (exists (
    select 1 from public.programs p
    where p.id = program_id and p.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.programs p
    where p.id = program_id and p.user_id = public.current_app_user_id()));

alter table public.weekly_cycles enable row level security;
create policy weekly_cycles_owner on public.weekly_cycles
  for all to authenticated
  using (exists (
    select 1 from public.program_phases ph
    join public.programs p on p.id = ph.program_id
    where ph.id = phase_id and p.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.program_phases ph
    join public.programs p on p.id = ph.program_id
    where ph.id = phase_id and p.user_id = public.current_app_user_id()));

alter table public.stimulus_requirements enable row level security;
create policy stimulus_requirements_owner on public.stimulus_requirements
  for all to authenticated
  using (exists (
    select 1 from public.weekly_cycles wc
    join public.program_phases ph on ph.id = wc.phase_id
    join public.programs p on p.id = ph.program_id
    where wc.id = weekly_cycle_id and p.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.weekly_cycles wc
    join public.program_phases ph on ph.id = wc.phase_id
    join public.programs p on p.id = ph.program_id
    where wc.id = weekly_cycle_id and p.user_id = public.current_app_user_id()));

alter table public.session_queue_items enable row level security;
create policy session_queue_items_owner on public.session_queue_items
  for all to authenticated
  using (exists (
    select 1 from public.weekly_cycles wc
    join public.program_phases ph on ph.id = wc.phase_id
    join public.programs p on p.id = ph.program_id
    where wc.id = weekly_cycle_id and p.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.weekly_cycles wc
    join public.program_phases ph on ph.id = wc.phase_id
    join public.programs p on p.id = ph.program_id
    where wc.id = weekly_cycle_id and p.user_id = public.current_app_user_id()));

alter table public.session_blocks enable row level security;
create policy session_blocks_owner on public.session_blocks
  for all to authenticated
  using (exists (
    select 1 from public.workout_sessions s
    where s.id = session_id and s.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.workout_sessions s
    where s.id = session_id and s.user_id = public.current_app_user_id()));

do $$
declare t text;
begin
  foreach t in array array['set_logs','cardio_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (exists (
           select 1 from public.session_blocks b
           join public.workout_sessions s on s.id = b.session_id
           where b.id = session_block_id and s.user_id = public.current_app_user_id()))
         with check (exists (
           select 1 from public.session_blocks b
           join public.workout_sessions s on s.id = b.session_id
           where b.id = session_block_id and s.user_id = public.current_app_user_id()))',
      t || '_owner', t);
  end loop;
end $$;

alter table public.equipment_profile_items enable row level security;
create policy equipment_profile_items_owner on public.equipment_profile_items
  for all to authenticated
  using (exists (
    select 1 from public.equipment_profiles ep
    where ep.id = profile_id and ep.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.equipment_profiles ep
    where ep.id = profile_id and ep.user_id = public.current_app_user_id()));

alter table public.coach_messages enable row level security;
create policy coach_messages_owner on public.coach_messages
  for all to authenticated
  using (exists (
    select 1 from public.coach_threads t
    where t.id = thread_id and t.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.coach_threads t
    where t.id = thread_id and t.user_id = public.current_app_user_id()));

-- Content versioning is an internal-operator surface; no authenticated policy,
-- so it is service-role only.
alter table public.content_versions enable row level security;
