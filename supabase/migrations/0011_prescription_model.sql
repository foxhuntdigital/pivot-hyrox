-- A strength prescription the schema can actually hold.
--
-- `block_exercises` has one shape for every kind of work: a `quantity` and a
-- `quantity_unit`. That fits a distance ('800', 'm') and a duration ('30',
-- 'sec'). It does not fit a set-and-rep scheme, and the library has been
-- encoding one by abuse:
--
--   ex_back_squat  prescription_type='sets_reps'  quantity=4.0  quantity_unit='6'
--
-- Four sets of six, with the set count in the number and the rep count in the
-- *unit string*. Three things follow from that, all of them wrong:
--
--   * The player renders `${quantity} ${unit}` and shows the athlete "4 6".
--   * buildSteps() emits one step, so four working sets are one tap.
--   * actuals.ts logs prescribed_reps = quantity = 4 — the set count recorded
--     as the rep count.
--
-- And there is no load column anywhere, so nothing can say what should be on
-- the bar, and nothing recorded can say what was.
--
-- These columns are additive and nullable. `quantity`/`quantity_unit` stay
-- authoritative for distance, duration and calorie work, so every existing
-- reader — transformBlocks, buildSteps, the history snapshot — keeps working
-- untouched on rows that do not set them. A row carries a structured strength
-- prescription when `sets is not null`; that is the discriminator readers test,
-- rather than `prescription_type`, which cannot be trusted until the taxonomy
-- migration lands.
--
-- Deliberately NOT a rewrite of quantity/quantity_unit into a polymorphic
-- shape: that would make an existing simple field mean different things by
-- context, and every reader would have to learn the difference. The same
-- reasoning parked `rest_schedule_seconds` in 0006.

alter table content.block_exercises
  -- Working sets. The discriminator: non-null means this row is a structured
  -- strength prescription and buildSteps() should expand it into `sets` steps.
  add column if not exists sets         integer check (sets > 0),
  -- A range, because "8-10" is a real prescription and a single value is just
  -- the degenerate case where min = max. Progression moves within the range
  -- before it moves the load (see 0012 and the progression service).
  add column if not exists reps_min     integer check (reps_min > 0),
  add column if not exists reps_max     integer check (reps_max > 0),
  -- Rest *between working sets*, which is what distinguishes true strength
  -- from density work. workout_blocks.rest_seconds is rest between rounds and
  -- means something else; a block can carry both.
  add column if not exists rest_seconds integer check (rest_seconds >= 0),
  -- The authored RPE ceiling for the working sets. Progression is allowed only
  -- while observed RPE sits under it.
  add column if not exists target_rpe   real check (target_rpe between 1 and 10),
  -- How load is expressed. 'bodyweight' is not "no load" — it is a load the
  -- athlete cannot change, which is why it is a basis and not a null.
  add column if not exists load_basis   text check (load_basis in
    ('absolute','percent_1rm','rpe','bodyweight')),
  add column if not exists load_value   real check (load_value >= 0);

-- A range that runs backwards is an authoring error, not a prescription.
do $$ begin
  alter table content.block_exercises
    add constraint block_exercises_rep_range_ordered
    check (reps_min is null or reps_max is null or reps_min <= reps_max);
exception when duplicate_object then null;
end $$;

-- load_value is meaningless without a basis to read it against, and every
-- basis except bodyweight needs a number. Enforced here rather than in the
-- importer because the seed is also written by hand during authoring.
--
-- Written as CASE rather than a chain of ORs on purpose. The obvious form,
--
--   (load_basis is null and load_value is null) or (load_basis = 'bodyweight' ...)
--
-- does not constrain anything when load_basis is null: `null = 'bodyweight'`
-- is NULL, `null in (...)` is NULL, and `false or false or NULL` is NULL — and
-- a CHECK passes on NULL. A load with no basis would have been storable. CASE
-- branches on `is null` first, so every row reaches exactly one boolean.
do $$ begin
  alter table content.block_exercises
    add constraint block_exercises_load_complete
    check (
      case
        when load_basis is null        then load_value is null
        when load_basis = 'bodyweight' then load_value is null
        else load_value is not null
      end
    );
exception when duplicate_object then null;
end $$;

comment on column content.block_exercises.sets is
  'Working sets. Non-null marks this row as a structured strength prescription; buildSteps expands it into one step per set.';
comment on column content.block_exercises.rest_seconds is
  'Rest between working sets. workout_blocks.rest_seconds is rest between rounds — a block may carry both.';

-- The progression service asks "what is the next exposure for this exercise",
-- which is a lookup by exercise across the whole library.
create index if not exists block_exercises_exercise_sets_idx
  on content.block_exercises (exercise_id) where sets is not null;
