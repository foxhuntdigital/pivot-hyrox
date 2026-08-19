-- Content domain: the curated workout library.
--
-- PRD §10: "The existing seed database already follows the intended pattern:
-- exercise primitives -> equipment -> workout templates -> blocks -> block
-- exercises -> Full/Express/Micro variants -> tags/substitutions/progression
-- rules. Production should retain this composable model."
--
-- Kept in its own schema because the access rule differs from athlete data:
-- published content is world-readable, athlete data is owner-only (see 0003).

create schema if not exists content;

-- ─────────────────────────────────────────────────────────────
-- Primitives
-- ─────────────────────────────────────────────────────────────

create table content.equipment (
  id          text primary key,
  name        text not null unique,
  category    text not null
);

create table content.exercises (
  id                  text primary key,
  name                text not null,
  category            text not null,
  movement_pattern    text not null,
  modality            text not null,
  default_unit        text not null,
  -- Drives the low-impact adaptation path (PRD §6.3, §9.3).
  impact_level        text not null check (impact_level in ('low','medium','high')),
  hyrox_relevance     real not null check (hyrox_relevance between 0 and 1),
  postpartum_friendly boolean not null default true,
  notes               text
);

create table content.exercise_equipment (
  exercise_id   text not null references content.exercises(id) on delete cascade,
  equipment_id  text not null references content.equipment(id) on delete cascade,
  -- false = this equipment satisfies the exercise but is not the only option.
  required      boolean not null default true,
  primary key (exercise_id, equipment_id)
);

create table content.tags (
  id        text primary key,
  name      text not null unique,
  tag_type  text not null
);

-- ─────────────────────────────────────────────────────────────
-- Templates
-- ─────────────────────────────────────────────────────────────

create table content.workout_templates (
  id                  text primary key,
  name                text not null,
  -- Progression caps are keyed by family (PRD §9.4).
  workout_family      text not null,
  primary_goal        text not null,
  secondary_goal      text,
  estimated_minutes   integer not null check (estimated_minutes > 0),
  intensity_target    text,
  impact_level        text not null check (impact_level in ('low','medium','high')),
  hyrox_specificity   real not null check (hyrox_specificity between 0 and 1),
  postpartum_friendly boolean not null default true,
  requires_running    boolean not null default false,
  requires_ski        boolean not null default false,
  description         text,
  coaching_notes      text
);

-- Full / Express / Micro. Stored as green/yellow/red (the seed's vocabulary);
-- PRD §25 requires the consumer UI to render them as Full/Express/Micro, and
-- explicitly not as failure states, so the mapping lives in the client.
create table content.workout_variants (
  id                    text primary key,
  workout_id            text not null references content.workout_templates(id) on delete cascade,
  variant_code          text not null check (variant_code in ('green','yellow','red')),
  time_budget_minutes   integer not null check (time_budget_minutes > 0),
  recovery_state        text not null check (recovery_state in ('good','okay','poor')),
  volume_multiplier     real not null check (volume_multiplier > 0 and volume_multiplier <= 1),
  intensity_modifier    text,
  notes                 text,
  unique (workout_id, variant_code)
);

create table content.workout_blocks (
  id                text primary key,
  workout_id        text not null references content.workout_templates(id) on delete cascade,
  block_order       integer not null,
  block_type        text not null,
  title             text,
  instructions      text,
  rounds            integer,
  duration_minutes  real,
  rest_seconds      integer,
  unique (workout_id, block_order)
);

create table content.block_exercises (
  id                text primary key,
  block_id          text not null references content.workout_blocks(id) on delete cascade,
  sequence_order    integer not null,
  exercise_id       text not null references content.exercises(id),
  prescription_type text not null check (prescription_type in ('duration','distance','reps','sets_reps','calories','load')),
  quantity          real not null,
  quantity_unit     text not null,
  intensity_note    text,
  side_note         text,
  unique (block_id, sequence_order)
);

create table content.workout_tags (
  workout_id  text not null references content.workout_templates(id) on delete cascade,
  tag_id      text not null references content.tags(id) on delete cascade,
  primary key (workout_id, tag_id)
);

-- ─────────────────────────────────────────────────────────────
-- Rules
-- ─────────────────────────────────────────────────────────────

-- The validated substitution graph. PRD §6.4: substitution is allowed only
-- from this graph unless the user explicitly picks a free-form replacement.
create table content.substitutions (
  id                      text primary key,
  exercise_id             text not null references content.exercises(id) on delete cascade,
  substitute_exercise_id  text not null references content.exercises(id) on delete cascade,
  reason                  text not null,
  priority                integer not null default 1,
  unique (exercise_id, substitute_exercise_id)
);

create table content.progression_rules (
  id                text primary key,
  workout_family    text not null,
  metric            text not null,
  trigger_condition text not null,
  action            text not null,
  -- PRD §9.4: "Progression caps are stored by workout family."
  max_change_pct    real not null check (max_change_pct > 0),
  notes             text
);

-- ─────────────────────────────────────────────────────────────
-- Race definitions (PRD §4) — versioned so rulebook changes are content
-- updates, not app releases.
-- ─────────────────────────────────────────────────────────────

create table content.race_definitions (
  id            uuid primary key default gen_random_uuid(),
  sport         text not null,
  name          text not null,
  version       text not null,
  division      text not null,
  -- Ordered segments/stations; validated by the content QA job (PRD §19.2).
  segments      jsonb not null,
  provenance    text,
  published_at  timestamptz,
  unique (sport, name, version, division)
);

create index on content.workout_variants (workout_id, variant_code);
create index on content.workout_blocks (workout_id, block_order);
create index on content.block_exercises (block_id, sequence_order);
create index on content.exercise_equipment (equipment_id);
create index on content.workout_tags (tag_id);
create index on content.substitutions (exercise_id, priority);
create index on content.workout_templates (workout_family);
