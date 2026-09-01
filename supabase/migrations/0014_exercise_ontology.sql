-- The exercise ontology (Strength & Athletic Development addendum §3).
--
-- `content.exercises` describes a movement with four fields: category,
-- movement_pattern, modality and default_unit. That is enough to render a name
-- and pick an icon. It is not enough to program strength, because it cannot
-- answer any of the questions programming actually asks:
--
--   * Is this a stable movement I can progressively overload and measure, or a
--     skill whose load is limited by technique? (back squat vs hang clean)
--   * How should it progress? Load is the wrong track for a box jump, a
--     thruster and a sled push, and it is the wrong track for three different
--     reasons.
--   * What role can it play — primer, power, primary, accessory, finisher?
--   * Whose history may it be compared against?
--
-- Without those, "progressive overload" degenerates into last-weight-plus-five
-- applied to everything, which is wrong for most of the library and dangerous
-- for the plyometric and Olympic-derivative work the addendum adds.
--
-- Multi-valued on purpose. A Bulgarian split squat is a lunge pattern that is
-- also unilateral and stability-demanding, and trains functional strength and
-- hypertrophy at once. Forcing a primary would throw away the reason to have
-- the field.
--
-- Array contents are constrained with `<@` so a typo fails at import rather
-- than becoming a silent third value nothing matches. The vocabularies are the
-- addendum's, verbatim.

-- ─────────────────────────────────────────────────────────────
-- Vocabularies
-- ─────────────────────────────────────────────────────────────

create or replace function content.movement_family_vocabulary() returns text[]
  language sql immutable as $$ select array[
    'squat','hinge','lunge','horizontal_push','vertical_push',
    'horizontal_pull','vertical_pull','carry','trunk','rotation',
    'olympic_explosive','jump_plyometric','ground_get_up',
    'sled_resisted_locomotion','complex_total_body','accessory_isolation'] $$;

create or replace function content.training_quality_vocabulary() returns text[]
  language sql immutable as $$ select array[
    'absolute_strength','functional_strength','hypertrophy','power',
    'plyometric_reactive','strength_endurance','athletic_multiplanar',
    'integrated_complex','structural_resilience'] $$;

create or replace function content.movement_character_vocabulary() returns text[]
  language sql immutable as $$ select array[
    'foundational','simple','complex','unilateral','bilateral',
    'contralateral','ipsilateral','explosive','reactive','ballistic',
    'rotational','multiplanar','loaded_locomotion',
    'stability_demanding','technical','hybrid_specific'] $$;

create or replace function content.exercise_role_vocabulary() returns text[]
  language sql immutable as $$ select array[
    'primer','power','primary_strength','secondary_strength',
    'accessory','trunk_carry','finisher'] $$;

create or replace function content.progression_track_vocabulary() returns text[]
  language sql immutable as $$ select array[
    'load','reps','volume','tempo','range_of_motion','distance',
    'density','technical','velocity','plyometric','work_rest','none'] $$;

-- ─────────────────────────────────────────────────────────────
-- Exercise ontology
-- ─────────────────────────────────────────────────────────────

alter table content.exercises
  add column if not exists movement_families        text[] not null default '{}',
  add column if not exists training_qualities       text[] not null default '{}',
  add column if not exists movement_characters      text[] not null default '{}',
  add column if not exists complexity_level         text
    check (complexity_level in ('basic','intermediate','advanced')),
  add column if not exists exercise_role_eligibility text[] not null default '{}',
  -- How this movement is allowed to progress. The single most load-bearing
  -- field in this migration: the progression service branches on it, and
  -- getting it wrong is what turns a box jump into a load-progression bug.
  add column if not exists progression_class        text
    check (progression_class in ('anchor','developmental','variable_complex','accessory_anchor')),
  add column if not exists progression_tracks       text[] not null default '{}',
  -- The variant tree: barbell RDL and dumbbell RDL are one family.
  add column if not exists exercise_family_id       text,
  -- Whose history may carry forward as a LOAD. Usually the same as the family,
  -- and deliberately a separate column because it is not always: a deficit
  -- dumbbell RDL belongs to the RDL family but its loads are not comparable to
  -- the flat-footed version, and showing one as the other's "last time" would
  -- be a fabricated prior.
  add column if not exists history_comparability_group text;

do $$ begin
  alter table content.exercises
    add constraint exercises_movement_families_known
      check (movement_families <@ content.movement_family_vocabulary()),
    add constraint exercises_training_qualities_known
      check (training_qualities <@ content.training_quality_vocabulary()),
    add constraint exercises_movement_characters_known
      check (movement_characters <@ content.movement_character_vocabulary()),
    add constraint exercises_roles_known
      check (exercise_role_eligibility <@ content.exercise_role_vocabulary()),
    add constraint exercises_tracks_known
      check (progression_tracks <@ content.progression_track_vocabulary());
exception when duplicate_object then null;
end $$;

-- An anchor exists to be progressed and measured, so one with nothing to
-- progress on is a contradiction rather than a sparse row.
do $$ begin
  alter table content.exercises
    add constraint exercises_anchor_has_a_track
      check (progression_class is distinct from 'anchor'
             or (array_length(progression_tracks, 1) > 0
                 and not (progression_tracks @> array['none'])));
exception when duplicate_object then null;
end $$;

comment on column content.exercises.progression_class is
  'anchor = stable and progressively overloaded; developmental = technique/complexity leads, load follows; variable_complex = density/work:rest/output; accessory_anchor = progressed like an anchor but weighted lower in capability inference.';
comment on column content.exercises.history_comparability_group is
  'Loads may only carry forward within this group. Broader than a canonical id, narrower than a family.';

create index if not exists exercises_progression_class_idx
  on content.exercises (progression_class);
create index if not exists exercises_family_idx
  on content.exercises (exercise_family_id);
create index if not exists exercises_movement_families_idx
  on content.exercises using gin (movement_families);
create index if not exists exercises_qualities_idx
  on content.exercises using gin (training_qualities);

-- ─────────────────────────────────────────────────────────────
-- Prescription-level role (addendum §6, §20)
-- ─────────────────────────────────────────────────────────────
--
-- Role belongs on the prescription, not the exercise. A goblet squat is a
-- primary strength lift for a beginner, a warm-up primer for a lifter, and a
-- finisher at the end of a circuit — the same movement in three roles, and the
-- session decides which. `exercise_role_eligibility` says which roles the
-- movement can hold; this says which one it holds here.

alter table content.block_exercises
  add column if not exists exercise_role text
    check (exercise_role in (
      'primer','power','primary_strength','secondary_strength',
      'accessory','trunk_carry','finisher'));

comment on column content.block_exercises.exercise_role is
  'The role this movement plays in THIS session. Must be one the exercise is eligible for; the same movement is a primer in one workout and a primary lift in another.';

create index if not exists block_exercises_role_idx
  on content.block_exercises (exercise_role) where exercise_role is not null;

-- ─────────────────────────────────────────────────────────────
-- Capability evidence vocabulary (addendum §16)
-- ─────────────────────────────────────────────────────────────
--
-- 0013 fixed the seven keys the original PRD named. The addendum adds
-- pattern-level strength, power and athletic dimensions, which is what lets
-- evidence say "your hinge is progressing and your vertical push is not"
-- rather than collapsing both into lower/upper body.
--
-- Dropped and recreated rather than edited in 0013, so this applies cleanly
-- whether or not 0013 has already been run against a live database.

do $$ begin
  alter table public.athlete_capability_evidence
    drop constraint if exists athlete_capability_evidence_capability_key_check;
end $$;

alter table public.athlete_capability_evidence
  add constraint athlete_capability_evidence_capability_key_check
  check (capability_key in (
    -- Original seven (0013). Kept: existing rows must stay valid.
    'lower_body_strength','upper_body_strength','running_threshold',
    'aerobic_durability','loaded_movement','muscular_endurance',
    'station_proficiency',
    -- Pattern-level strength.
    'bilateral_squat_strength','hinge_strength','unilateral_lower_strength',
    'horizontal_push_strength','vertical_push_strength',
    'horizontal_pull_strength','vertical_pull_strength','loaded_carry_strength',
    -- Power and athletic qualities.
    'lower_body_power','upper_body_power','reactive_plyometric_capacity',
    'multiplanar_control','trunk_capacity','structural_accessory_capacity'));
