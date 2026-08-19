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
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create role authenticated;
create role anon;
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
