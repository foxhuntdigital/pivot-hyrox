-- The canonical vocabulary: identity, terminology, and lifecycle.
--
-- The exercise catalogue grows from 46 to ~226 in one migration, which makes
-- three gaps in the model urgent that were merely untidy at 46.
--
-- ── A name is not an identity ────────────────────────────────────────────────
--
-- The review renamed movements PIVOT already had — "Deadlift" became
-- "Conventional Deadlift", "DB Row" became "1-Arm DB Row" — and proposed
-- several more that are the same movement said differently. Performance history
-- hangs off `id`, so a rename must never be a new row: an athlete's deadlift
-- record has to survive the library learning a better word for it.
--
-- So display name and identity separate. `canonical_name` is what the product
-- shows, `aliases` is the terminology it also answers to, and `id` never moves.
--
-- ── Approved is not the same as usable ───────────────────────────────────────
--
-- The 212 proposed exercises were an over-complete candidate list. Product
-- approved them as vocabulary, not as content anyone may be prescribed
-- tomorrow — the lifecycle is Review -> Approved -> Migrated/Created ->
-- Content Eligible, and this migration performs the third step only. A row
-- lands as `created`, and becomes `content_eligible` when it has actually been
-- authored into a session. The 46 that predate this are already in content and
-- are backfilled accordingly.
--
-- Nothing reads `status` yet. It exists so that the moment something does, the
-- distinction is already recorded rather than reconstructed.
--
-- ── Equipment is not one question ────────────────────────────────────────────
--
-- Twelve new equipment types arrive with the vocabulary, and they are not alike.
-- A trap bar is a thing an athlete knows whether they have. A reverse-hyper is
-- not worth an onboarding checkbox, and `machine` is too broad to drive hard
-- eligibility at all — one tick would imply a leg-extension machine, a
-- chest-supported row and a lat-pulldown station alike. `selection_tier` records
-- which question each one is, so the onboarding screen can offer the first kind
-- and only the first kind.
--
-- Deliberately NOT a backfill. Nobody is assumed to own a nordic anchor.

-- ─────────────────────────────────────────────────────────────
-- Vocabulary additions (approved 2026-08-31)
-- ─────────────────────────────────────────────────────────────
--
-- Not vocabulary creep: each is a concept the methodology already required and
-- the schema could not express. The trunk row of the addendum's own movement
-- table reads "anti-extension, anti-rotation, lateral stability, loaded/dynamic
-- trunk" — four ideas, three of which had nowhere to go. `duration` is how a
-- plank or a carry progresses, which `volume` and `tempo` cannot say between
-- them. `complexity` is the "technique/complexity" track the developmental
-- progression class is defined by.
--
-- The CHECK constraints call these functions, so replacing the body widens what
-- they accept without touching the constraints themselves.

create or replace function content.movement_character_vocabulary() returns text[]
  language sql immutable as $$ select array[
    'foundational','simple','complex','unilateral','bilateral',
    'contralateral','ipsilateral','explosive','reactive','ballistic',
    'rotational','multiplanar','loaded_locomotion',
    'stability_demanding','technical','hybrid_specific',
    -- added 0015
    'anti_rotation','anti_lateral_flexion','anti_extension','dynamic'] $$;

create or replace function content.progression_track_vocabulary() returns text[]
  language sql immutable as $$ select array[
    'load','reps','volume','tempo','range_of_motion','distance',
    'density','technical','velocity','plyometric','work_rest','none',
    -- added 0015
    'duration','complexity'] $$;

-- ─────────────────────────────────────────────────────────────
-- Identity and terminology
-- ─────────────────────────────────────────────────────────────

alter table content.exercises
  -- What the product displays. `name` stays as authored so a rename is visible
  -- as a change rather than as an overwrite of the original record.
  add column if not exists canonical_name text,
  -- Terminology this movement also answers to. A discarded proposal's wording
  -- survives here rather than as a second identity: "Skater Jump" finds
  -- "Lateral Bound" without minting an exercise nobody meant to create.
  add column if not exists aliases text[] not null default '{}',
  -- The movement this is a variant of. Loads never carry across it — that is
  -- what history_comparability_group is for — but it is how a library can say
  -- a B-stance RDL belongs to the RDL family.
  add column if not exists variant_parent text references content.exercises(id),
  -- 50/25/25 (addendum §14). Exactly three values: this answers what KIND of
  -- exposure a movement is, and must not drift back into answering how the
  -- progression engine should treat it, which is progression_class's job.
  add column if not exists methodology_bucket text check (methodology_bucket in
    ('foundational_repeatable','athletic_power_plyometric','complex_specific_novel')),
  add column if not exists status text not null default 'created'
    check (status in ('created','content_eligible','deprecated'));

comment on column content.exercises.canonical_name is
  'Display name. Identity is the id; a rename must never create a row, or the performance history attached to the old one is orphaned.';
comment on column content.exercises.status is
  'created = migrated but not yet authored into content; content_eligible = usable in a session; deprecated = retired, never deleted.';

-- Everything already in the library is, by definition, already in content.
update content.exercises set status = 'content_eligible' where status = 'created';

-- The display name defaults to the authored one until a rename says otherwise.
update content.exercises set canonical_name = name where canonical_name is null;

create index if not exists exercises_status_idx on content.exercises (status);
create index if not exists exercises_variant_parent_idx on content.exercises (variant_parent);
create index if not exists exercises_aliases_idx on content.exercises using gin (aliases);

-- ─────────────────────────────────────────────────────────────
-- Equipment selection tiers
-- ─────────────────────────────────────────────────────────────

alter table content.equipment
  add column if not exists selection_tier text not null default 'athlete_selectable'
    check (selection_tier in ('athlete_selectable','derived_common','specialized'));

comment on column content.equipment.selection_tier is
  'athlete_selectable = offered as an onboarding control; derived_common = implied by a gym rather than ticked; specialized = needs deliberate opt-in and is never backfilled.';

create index if not exists equipment_selection_tier_idx on content.equipment (selection_tier);
