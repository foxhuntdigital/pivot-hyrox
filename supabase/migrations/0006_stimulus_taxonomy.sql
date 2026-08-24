-- Two-level training taxonomy.
--
-- The planner only ever asks for five stimuli (BASE_STIMULI in
-- periodization.ts), but the content packs speak a far richer vocabulary —
-- skill_economy, work_density, lactate_threshold, force_power_reserve and
-- forty-odd more. Collapsing those into the five at authoring time would throw
-- away the detail that makes a station matrix worth having.
--
-- So a template carries both. `primary_goal` stays the planner-facing rollup
-- that ranking matches on; `stimulus` holds the value the coach actually wrote.
-- Deliberately not named `secondary_goal`: that column means "a second, lower
-- priority objective", which is not what this is. It is the specific name for
-- the same objective.
--
-- primary_goal is derived from stimulus by scripts/apply-taxonomy.mjs, so the
-- two cannot drift.

alter table content.workout_templates
  add column if not exists stimulus text;

comment on column content.workout_templates.stimulus is
  'Authored training stimulus. primary_goal is the planner-facing goal this rolls up to.';

-- Ranking reads primary_goal; this makes the richer value cheap to filter on
-- for content QA and for the station rules below.
create index if not exists workout_templates_stimulus_idx
  on content.workout_templates (stimulus);

-- ─────────────────────────────────────────────────────────────
-- Station × stimulus programming rules
-- ─────────────────────────────────────────────────────────────
-- The station matrix's value is not another 96 sessions — it is the rules in
-- its Express / Micro / progression columns, which say how to *adapt* a session
-- at a given station and stimulus. Those are reusable across every template
-- that touches the station, so they live once here rather than being copied
-- onto each workout.
--
-- `station` is '*' for a rule that applies at that stimulus whatever the
-- station, letting a general rule sit alongside station-specific overrides.
-- It is NOT NULL on purpose: with a nullable column `unique (station,
-- stimulus)` would not constrain the general rows at all, since NULL is never
-- equal to NULL, and two conflicting defaults for one stimulus could both be
-- inserted. 'Run' is a station here — a HYROX is eight runs and eight stations.
create table if not exists content.station_programming_rules (
  id                text primary key,
  station           text not null default '*',
  stimulus          text not null,
  express_rule      text not null,
  micro_rule        text not null,
  progression_rule  text not null,
  -- What a completed exposure should record, so progression has inputs.
  tracking_metrics  jsonb not null default '[]'::jsonb,
  -- Reference distance/reps for the station, e.g. '1000m', '100 reps'.
  race_reference    text,
  content_version   text not null default 'v1',
  unique (station, stimulus)
);

create index if not exists station_programming_rules_stimulus_idx
  on content.station_programming_rules (stimulus);

grant select on content.station_programming_rules to authenticated;
grant all    on content.station_programming_rules to service_role;

alter table content.station_programming_rules enable row level security;

create policy station_programming_rules_read on content.station_programming_rules
  for select to authenticated using (true);
