#!/usr/bin/env bash
# Applies migrations + seed to a throwaway database to prove they run.
# Stubs the Supabase-provided auth schema, which is the only thing the
# migrations depend on that a bare Postgres does not have.
set -euo pipefail

DB="pivot_verify_$$"
cleanup() { dropdb --if-exists "$DB" 2>/dev/null || true; }
trap cleanup EXIT

createdb "$DB"

psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema auth;
-- Mirrors the columns our own triggers read off auth.users, so provisioning is
-- actually exercised here rather than merely parsed.
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
-- Roles are cluster-wide, so they outlive the throwaway database and are
-- already present on every run after the first.
do $$ begin
  create role authenticated;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role anon;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role;
exception when duplicate_object then null;
end $$;
SQL

for f in supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done

echo "applying seed"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/seed/01_content.sql

echo
echo "=== content row counts ==="
psql -X -A -F' ' -t -d "$DB" <<'SQL'
select 'equipment', count(*) from content.equipment
union all select 'exercises', count(*) from content.exercises
union all select 'exercise_equipment', count(*) from content.exercise_equipment
union all select 'tags', count(*) from content.tags
union all select 'workout_templates', count(*) from content.workout_templates
union all select 'workout_variants', count(*) from content.workout_variants
union all select 'workout_blocks', count(*) from content.workout_blocks
union all select 'block_exercises', count(*) from content.block_exercises
union all select 'workout_tags', count(*) from content.workout_tags
union all select 'substitutions', count(*) from content.substitutions
union all select 'progression_rules', count(*) from content.progression_rules
order by 1;
SQL

echo
echo "=== integrity checks ==="
psql -X -A -t -d "$DB" <<'SQL'
select 'templates without all 3 variants: ' || count(*) from (
  select workout_id from content.workout_variants
  group by workout_id having count(distinct variant_code) <> 3) x;
select 'templates without blocks: ' || count(*) from content.workout_templates t
  where not exists (select 1 from content.workout_blocks b where b.workout_id = t.id);
select 'blocks without exercises: ' || count(*) from content.workout_blocks b
  where not exists (select 1 from content.block_exercises e where e.block_id = b.id);
select 'rls-enabled tables: ' || count(*) from pg_tables
  where schemaname in ('public','content') and rowsecurity;
select 'tables missing rls: ' || coalesce(string_agg(schemaname||'.'||tablename, ', '), 'none')
  from pg_tables where schemaname in ('public','content') and not rowsecurity;
SQL

echo
echo "=== account deletion ==="
# 5.1.1(v) deletion is a cascade, and a cascade is only as good as the last
# foreign key added to the schema. This exercises it end to end rather than
# trusting that every future table remembers `on delete cascade`: a new table
# hanging off public.users without one turns this section red.
psql -X -A -t -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'leaver@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'stayer@example.com');
select id as leaver from public.users where email = 'leaver@example.com' \gset

insert into public.races (id, user_id, event_name, event_date)
  values ('22222222-2222-2222-2222-222222222222', :'leaver', 'Boston', '2099-01-01');
insert into public.programs (user_id, race_id, start_date, end_date)
  values (:'leaver', '22222222-2222-2222-2222-222222222222', '2098-01-01', '2099-01-01');
insert into public.content_versions (entity_type, entity_id, version, authored_by)
  values ('workout', 'verify-w1', 1, :'leaver');

create or replace function auth.uid() returns uuid language sql stable as
  $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
select public.delete_own_account();
create or replace function auth.uid() returns uuid language sql stable as
  $$ select null::uuid $$;
\set QUIET off

select 'rows left for the deleted athlete: ' || (
  (select count(*) from public.users where email = 'leaver@example.com')
  + (select count(*) from public.races where user_id = :'leaver')
  + (select count(*) from public.programs where user_id = :'leaver')
  + (select count(*) from auth.users where email = 'leaver@example.com'));
select 'other athletes affected: ' || (
  select count(*) from public.users where email <> 'stayer@example.com');
select 'content kept with author cleared: ' || (
  select count(*) from public.content_versions
  where entity_id = 'verify-w1' and authored_by is null);
SQL

echo
echo "=== running backfill (0009) ==="
# 0009 reinterprets every profile written before running became an equipment
# constraint: leaving both running surfaces unticked used to mean "I can run",
# so it has to keep meaning that. The migration ran above against an empty
# database, which proves nothing, so it is re-run here over profiles that
# exercise each case — it is written to be idempotent, and this is where that
# is checked as well.
psql -X -A -t -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
\set QUIET on
insert into auth.users (id, email)
  values ('44444444-4444-4444-4444-444444444444', 'runner@example.com');
select id as athlete from public.users where email = 'runner@example.com' \gset

insert into public.equipment_profiles (id, user_id, name, is_default) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'athlete', 'Nothing ticked', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'athlete', 'Dumbbells only', false),
  ('aaaaaaaa-0000-0000-0000-000000000003', :'athlete', 'Treadmill only', false),
  ('aaaaaaaa-0000-0000-0000-000000000004', :'athlete', 'Already outdoor', false);
insert into public.equipment_profile_items (profile_id, equipment_id) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'db'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'treadmill'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'outdoor');
\set QUIET off
SQL

psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0009_running_is_equipment.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0009_running_is_equipment.sql

psql -X -A -t -d "$DB" <<'SQL'
select 'profiles left with no way to run: ' || count(*)
  from public.equipment_profiles ep
  where not exists (
    select 1 from public.equipment_profile_items i
    where i.profile_id = ep.id and i.equipment_id in ('outdoor','treadmill'));
select 'treadmill-only profile left alone: ' || (
  select case when count(*) = 1 and bool_and(equipment_id = 'treadmill') then 'yes' else 'no' end
  from public.equipment_profile_items
  where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003');
select 'dumbbell profile keeps its dumbbells: ' || (
  select case when count(*) = 1 then 'yes' else 'no' end
  from public.equipment_profile_items
  where profile_id = 'aaaaaaaa-0000-0000-0000-000000000002' and equipment_id = 'db');
select 're-running the backfill adds nothing: ' || (
  select case when count(*) = 1 then 'yes' else 'no' end
  from public.equipment_profile_items
  where profile_id = 'aaaaaaaa-0000-0000-0000-000000000004' and equipment_id = 'outdoor');
SQL
