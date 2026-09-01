-- The athlete model: what they enjoy, what they think they need, and what
-- their training has actually shown.
--
-- These are three different signals and the whole design turns on not
-- collapsing them:
--
--   * The sport says you need this        — stimulus_requirements (0002)
--   * Performance says you need this      — athlete_capability_evidence, here
--   * The athlete says they enjoy this    — athlete_preferences, here
--   * The athlete says they lack this     — athlete_perceived_weaknesses, here
--
-- Self-report is an input, not a capability score. An athlete who believes
-- they are a weak runner and an athlete whose splits show it are different
-- rows with different authority, and the planner weighs them differently.
-- Storing both in one table would lose exactly that distinction.
--
-- Nothing here is a hard constraint. Safety, sport requirements and recovery
-- outrank all of it; preference ranks candidates that are already valid and
-- can never make an invalid one valid. That rule is enforced in the engine
-- (checkEligibility runs before score()), not here — this file only has to
-- avoid making it hard to keep.

-- ─────────────────────────────────────────────────────────────
-- What the athlete enjoys
-- ─────────────────────────────────────────────────────────────

create table if not exists public.athlete_preferences (
  user_id            uuid not null references public.users(id) on delete cascade,
  -- A modality ('running', 'barbell', 'boxing') or a training domain
  -- ('strength', 'threshold'). One column because the planner asks the same
  -- question of both — "how does this athlete feel about this kind of work" —
  -- and a template matches on whichever it carries.
  modality_or_domain text not null,
  rating             text not null check (rating in ('love','like','neutral','rather_not')),
  -- 'onboarding' | 'profile' | 'coach'. Kept because a preference the athlete
  -- stated in conversation carries less weight than one they set deliberately,
  -- and because "where did this come from" is a question Coach must be able to
  -- answer about its own suggestions.
  source             text not null default 'onboarding',
  updated_at         timestamptz not null default now(),
  primary key (user_id, modality_or_domain)
);

-- ─────────────────────────────────────────────────────────────
-- What the athlete believes they need
-- ─────────────────────────────────────────────────────────────

-- Deliberately separate from capability evidence, and deliberately without a
-- magnitude. This is a belief, and a belief has no confidence band — the
-- athlete either said it or did not. It seeds emphasis before there is any
-- performance history to read, and is outranked by evidence once there is.
create table if not exists public.athlete_perceived_weaknesses (
  user_id        uuid not null references public.users(id) on delete cascade,
  capability_key text not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, capability_key)
);

-- ─────────────────────────────────────────────────────────────
-- What performance has shown
-- ─────────────────────────────────────────────────────────────

-- One row per completed session that produced a readable signal. Append-only:
-- this is the evidence log, not the athlete's current state. Current state is
-- *derived* from repeated rows, which is the whole safeguard — a single
-- exceptional or terrible session writes one low-confidence row and changes
-- nothing on its own.
--
-- Bands rather than numbers on purpose. A 5 lb jump on a dumbbell press is not
-- a measurement precise enough to justify a decimal, and storing one invites
-- arithmetic that reads as science. Direction plus magnitude band plus
-- confidence is what the data actually supports.
create table if not exists public.athlete_capability_evidence (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  capability_key    text not null check (capability_key in (
    'lower_body_strength','upper_body_strength','running_threshold',
    'aerobic_durability','loaded_movement','muscular_endurance',
    'station_proficiency')),
  direction         text not null check (direction in ('negative','neutral','positive')),
  magnitude_band    text not null check (magnitude_band in ('small','moderate','large')),
  confidence_band   text not null check (confidence_band in ('low','medium','high')),
  -- The session this was read from. Nullable only so evidence can survive a
  -- session being archived; a row with no source cannot be re-derived and is
  -- therefore never written by the services.
  source_session_id uuid references public.workout_sessions(id) on delete set null,
  -- Which version of the evidence rules produced this. Rules will change; rows
  -- written under the old ones must stay interpretable rather than silently
  -- re-meaning. Same argument as engine_version on adaptation_events.
  rules_version     text not null default '1.0.0',
  created_at        timestamptz not null default now()
);

-- The planner reads "recent evidence for this capability", newest first.
create index if not exists capability_evidence_lookup_idx
  on public.athlete_capability_evidence (user_id, capability_key, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- RLS — owner-only, matching 0003
-- ─────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'athlete_preferences','athlete_perceived_weaknesses','athlete_capability_evidence'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = public.current_app_user_id())
         with check (user_id = public.current_app_user_id())',
      t || '_owner', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Workout taxonomy (Workstream A)
-- ─────────────────────────────────────────────────────────────
--
-- Every published workout must be classifiable independently of the athlete it
-- was authored for. Holding weights does not make a session strength: the seed
-- carries 25 templates whose primary_goal is 'strength', of which 21 are sled
-- pushes, erg intervals, hill repeats and carries.
--
-- These columns are added empty. NOTHING READS THEM YET, and that is the
-- point: rank.ts:matchesStimulus still matches primary_goal, so the planner's
-- behaviour is unchanged by this migration. The flip to training_domain is one
-- line in the engine, and it happens only once the coverage gate proves there
-- is enough true-strength content to survive it. Reclassifying before then
-- would take the week's two strength exposures from a library of four
-- templates — zero of them reachable without a barbell.

alter table content.workout_templates
  -- The physiological/programming domain. What the planner will match on,
  -- after the flip.
  add column if not exists training_domain text,
  -- Structural form. 'strength' and 'strength_endurance' are both legitimate
  -- and are not the same session; this is the column that says which.
  add column if not exists session_type    text,
  -- How the work is performed. An array because a hybrid session is genuinely
  -- more than one, and collapsing it to a primary loses the ability to honour
  -- "I'd rather not row" without also dropping the run in the same workout.
  add column if not exists modality        text[] not null default '{}',
  add column if not exists workout_role    text not null default 'primary'
    check (workout_role in ('primary','supplemental')),
  add column if not exists supplemental_type text check (supplemental_type in (
    'core','muscular_endurance','metcon','accessory_strength',
    'resilience','recovery','boxing')),
  -- Never 'high'. Supplemental work that could compromise tomorrow is not
  -- supplemental, and the constraint is here so no authoring pass can make it
  -- so by accident.
  add column if not exists supplemental_load text check (supplemental_load in
    ('minimal','low','moderate'));

-- A supplemental workout needs a type; a primary one must not have one.
do $$ begin
  alter table content.workout_templates
    add constraint workout_templates_supplemental_complete
    check (
      (workout_role = 'primary'      and supplemental_type is null)
      or (workout_role = 'supplemental' and supplemental_type is not null)
    );
exception when duplicate_object then null;
end $$;

comment on column content.workout_templates.training_domain is
  'Physiological domain. Becomes the planner-facing match key when the coverage gate goes green; primary_goal is the legacy rollup until then.';

create index if not exists workout_templates_domain_idx
  on content.workout_templates (training_domain);
create index if not exists workout_templates_role_idx
  on content.workout_templates (workout_role, supplemental_type);

grant select on content.workout_templates to authenticated;
