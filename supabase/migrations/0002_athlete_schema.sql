-- Athlete + training domain (PRD §11).
--
-- Data rules enforced here (PRD §11.1):
--   * UUID keys, server timestamps in UTC, IANA timezone kept for local-day math.
--   * workout_sessions carry an immutable snapshot; template edits are never
--     retroactive.
--   * Every engine decision stores engine_version + reason codes so a
--     recommendation can be reproduced from stored inputs.
--   * Archive rather than delete anything history references.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Identity
-- ─────────────────────────────────────────────────────────────

create table public.users (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid not null unique references auth.users(id) on delete cascade,
  email       text,
  locale      text not null default 'en-US',
  units       text not null default 'imperial' check (units in ('imperial','metric')),
  -- IANA name, e.g. 'America/Los_Angeles'. Local-day boundaries are computed
  -- from this, never from the server's clock.
  timezone    text not null default 'UTC',
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.athlete_profiles (
  user_id                uuid primary key references public.users(id) on delete cascade,
  experience_level       text not null default 'intermediate',
  training_age_years     real,
  typical_session_minutes integer not null default 45,
  -- 0 = very predictable, 1 = fully unpredictable. Drives whether the engine
  -- pre-generates Express/Micro variants (Profile screen).
  schedule_predictability real not null default 0.5
    check (schedule_predictability between 0 and 1),
  impact_tolerance       text not null default 'normal'
    check (impact_tolerance in ('low','normal','high')),
  preferences_json       jsonb not null default '{}'::jsonb,
  -- Return-to-training considerations (postpartum, pelvic-floor, injury).
  -- SENSITIVE: used only to constrain programming. Owner-only under RLS, never
  -- copied into analytics (PRD §16), never sent to the AI coach beyond the
  -- granted purpose (PRD §13.2).
  considerations         text[] not null default '{}',
  updated_at             timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Goals + program
-- ─────────────────────────────────────────────────────────────

create table public.races (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  race_definition_id  uuid references content.race_definitions(id),
  event_name          text not null,
  event_date          date not null,
  division            text,
  goal_type           text not null default 'performance'
    check (goal_type in ('finish_healthy','performance','custom')),
  goal_value          text,
  status              text not null default 'active'
    check (status in ('active','completed','archived')),
  created_at          timestamptz not null default now()
);

-- Only one active race per athlete drives Today.
create unique index races_one_active_per_user
  on public.races (user_id) where status = 'active';

create table public.programs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  race_id     uuid references public.races(id) on delete set null,
  -- Race date or division changes create a new version rather than mutating
  -- history (PRD §20).
  version     integer not null default 1,
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'active'
    check (status in ('active','superseded','archived')),
  created_at  timestamptz not null default now(),
  unique (user_id, race_id, version)
);

create table public.program_phases (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references public.programs(id) on delete cascade,
  phase_type      text not null
    check (phase_type in ('foundation','build','specific','peak','taper','race')),
  phase_order     integer not null,
  start_date      date not null,
  end_date        date not null,
  objectives_json jsonb not null default '{}'::jsonb,
  unique (program_id, phase_order)
);

create table public.weekly_cycles (
  id          uuid primary key default gen_random_uuid(),
  phase_id    uuid not null references public.program_phases(id) on delete cascade,
  week_index  integer not null,
  target_load real,
  status      text not null default 'pending'
    check (status in ('pending','active','complete')),
  unique (phase_id, week_index)
);

-- The week is defined by required stimuli, not weekdays (PRD §2, FR-012).
create table public.stimulus_requirements (
  id               uuid primary key default gen_random_uuid(),
  weekly_cycle_id  uuid not null references public.weekly_cycles(id) on delete cascade,
  stimulus_type    text not null,
  target_exposures integer not null default 1 check (target_exposures > 0),
  completed_exposures integer not null default 0,
  priority         integer not null default 1,
  min_dose_minutes integer,
  max_dose_minutes integer,
  unique (weekly_cycle_id, stimulus_type)
);

create table public.session_queue_items (
  id               uuid primary key default gen_random_uuid(),
  weekly_cycle_id  uuid not null references public.weekly_cycles(id) on delete cascade,
  workout_template_id text not null references content.workout_templates(id),
  stimulus_type    text not null,
  rank             integer not null,
  state            text not null default 'queued'
    check (state in ('queued','recommended','in_progress','completed','skipped','expired')),
  earliest_at      timestamptz,
  expires_at       timestamptz
);

create index on public.session_queue_items (weekly_cycle_id, rank) where state = 'queued';

-- ─────────────────────────────────────────────────────────────
-- Execution
-- ─────────────────────────────────────────────────────────────

create table public.workout_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  queue_item_id   uuid references public.session_queue_items(id) on delete set null,
  template_id     text not null references content.workout_templates(id),
  variant_code    text not null check (variant_code in ('green','yellow','red')),
  -- Immutable copy of the prescription as it was when the session started.
  -- Later template edits must never change a historical record (PRD §11.1).
  snapshot_json   jsonb not null,
  status          text not null default 'ready'
    check (status in ('ready','active','paused','completed_pending_review','completed','abandoned')),
  started_at      timestamptz,
  ended_at        timestamptz,
  session_rpe     integer check (session_rpe between 1 and 10),
  notes           text,
  ended_early     boolean not null default false,
  -- Monotonic counter for idempotent offline sync (PRD §15.1).
  revision        integer not null default 0,
  created_at      timestamptz not null default now()
);

create index on public.workout_sessions (user_id, started_at desc);

create table public.session_blocks (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.workout_sessions(id) on delete cascade,
  block_order   integer not null,
  block_type    text not null,
  prescribed_json jsonb not null,
  actual_json     jsonb,
  completed_at  timestamptz,
  skipped       boolean not null default false,
  unique (session_id, block_order)
);

create table public.set_logs (
  id                uuid primary key default gen_random_uuid(),
  session_block_id  uuid not null references public.session_blocks(id) on delete cascade,
  exercise_id       text not null references content.exercises(id),
  set_index         integer not null,
  prescribed_reps   integer,
  actual_reps       integer,
  prescribed_load   real,
  actual_load       real,
  load_unit         text,
  rpe               integer check (rpe between 1 and 10),
  -- Client-generated so a replayed offline event cannot duplicate a set.
  client_event_id   uuid not null unique,
  unique (session_block_id, set_index)
);

create table public.cardio_logs (
  id                uuid primary key default gen_random_uuid(),
  session_block_id  uuid not null references public.session_blocks(id) on delete cascade,
  exercise_id       text not null references content.exercises(id),
  duration_seconds  integer,
  distance_meters   real,
  avg_hr            integer,
  max_hr            integer,
  pace_seconds_per_km real,
  calories          integer,
  rpe               integer check (rpe between 1 and 10),
  client_event_id   uuid not null unique
);

-- ─────────────────────────────────────────────────────────────
-- Recovery + readiness
-- ─────────────────────────────────────────────────────────────

create table public.recovery_checkins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  local_date    date not null,
  sleep_hours   real,
  energy        text check (energy in ('low','normal','high')),
  stress        integer check (stress between 1 and 5),
  soreness      integer check (soreness between 1 and 5),
  motivation    integer check (motivation between 1 and 5),
  -- Symptom flags trigger conservative handling, never a diagnosis (PRD §9.4).
  symptom_json  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (user_id, local_date)
);

create table public.health_daily_metrics (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  local_date        date not null,
  -- Health-derived values keep their source and observation time, and never
  -- silently overwrite a manual value (PRD §11.1).
  source            text not null,
  observed_at       timestamptz not null,
  resting_hr        integer,
  sleep_duration_minutes integer,
  hrv_ms            real,
  weight_kg         real,
  unique (user_id, local_date, source)
);

create table public.readiness_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  local_date      date not null,
  overall         integer not null check (overall between 0 and 100),
  components_json jsonb not null,
  -- Drives the "building baseline" state instead of fake precision (PRD §20).
  confidence      text not null check (confidence in ('low','medium','high')),
  model_version   text not null,
  created_at      timestamptz not null default now(),
  unique (user_id, local_date)
);

-- ─────────────────────────────────────────────────────────────
-- Equipment
-- ─────────────────────────────────────────────────────────────

create table public.equipment_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  name          text not null,
  location_type text not null default 'gym'
    check (location_type in ('home','gym','travel','other')),
  is_default    boolean not null default false,
  unique (user_id, name)
);

create table public.equipment_profile_items (
  profile_id      uuid not null references public.equipment_profiles(id) on delete cascade,
  equipment_id    text not null references content.equipment(id) on delete cascade,
  properties_json jsonb not null default '{}'::jsonb,
  primary key (profile_id, equipment_id)
);

-- ─────────────────────────────────────────────────────────────
-- Engine audit
-- ─────────────────────────────────────────────────────────────

-- One row per engine decision. Storing inputs + engine_version is what makes
-- "Engine decisions are reproducible from stored inputs" testable (PRD §24).
create table public.adaptation_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  original_template_id text references content.workout_templates(id),
  original_variant    text,
  selected_template_id text references content.workout_templates(id),
  selected_variant    text,
  inputs_json         jsonb not null,
  reason_codes        text[] not null default '{}',
  rationale           text,
  engine_version      text not null,
  created_at          timestamptz not null default now()
);

create index on public.adaptation_events (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- AI coach (PRD §13) — bounded action layer, not a program writer.
-- ─────────────────────────────────────────────────────────────

create table public.coach_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now()
);

create table public.coach_messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.coach_threads(id) on delete cascade,
  role              text not null check (role in ('user','assistant','system')),
  content           text not null,
  -- A proposed mutation, held until the user confirms. Multi-day changes must
  -- never apply silently (FR-021).
  proposed_action   jsonb,
  action_status     text check (action_status in ('proposed','applied','rejected')),
  created_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Content ops (FR-022)
-- ─────────────────────────────────────────────────────────────

create table public.content_versions (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,
  entity_id     text not null,
  version       integer not null,
  status        text not null default 'draft'
    check (status in ('draft','coaching_review','qa','published','deprecated')),
  authored_by   uuid references public.users(id),
  published_at  timestamptz,
  unique (entity_type, entity_id, version)
);
