-- What the athlete actually did, as opposed to what they were asked to do.
--
-- set_logs already has prescribed_load, actual_load, load_unit and rpe. None
-- of them has ever been written: the player never asks what was on the bar, so
-- actuals.ts leaves load null and sets
--
--   actual_reps = step.quantity = prescribed_reps
--
-- which makes every row in the table the prescription copied onto itself. The
-- columns were right; the question was never asked. Most of this release is
-- feeding fields that already exist.
--
-- What is genuinely missing is the *prescription snapshot* at set level. A
-- session's snapshot_json holds the workout as authored, but a progression
-- decision needs to compare against the range and RPE ceiling this specific
-- set was performed under, and re-deriving that from the snapshot means
-- re-implementing the variant transform against a template that may since have
-- been edited. Cheaper and safer to record it with the set.
--
-- `source` is the one field that changes how a row may be *used*. A set the
-- athlete typed is evidence. A set recorded because they tapped Next, which is
-- an assertion that the prescription was met, is not — it cannot show a miss,
-- so trending it would read the library back as achievement. Rows written
-- before this migration are exactly that second kind, so the default is
-- 'asserted' and the evidence services exclude it. Defaulting to 'manual'
-- would silently promote every tautological historical row to evidence.

alter table public.set_logs
  add column if not exists prescribed_reps_min integer,
  add column if not exists prescribed_reps_max integer,
  add column if not exists prescribed_rpe      real check (prescribed_rpe between 1 and 10),
  add column if not exists notes               text,
  add column if not exists source              text not null default 'asserted'
    check (source in ('asserted','manual','carried','timer'));

comment on column public.set_logs.source is
  'asserted = recorded from a Complete tap and cannot show a miss (not evidence); manual = the athlete entered it; carried = prefilled from a prior set and left unedited.';

-- Same distinction on the cardio side, but the default flips. A distance step
-- times itself: the clock measured the duration whether or not anyone typed
-- anything, so an existing cardio row IS a real measurement and comparable.ts
-- has been trending it correctly all along. Defaulting these to 'asserted'
-- would throw away working running evidence.
alter table public.cardio_logs
  add column if not exists source text not null default 'timer'
    check (source in ('timer','manual','integration'));

comment on column public.cardio_logs.source is
  'Where the numbers came from. Unlike set_logs, the default is a real measurement: a distance step is timed by the player whether or not the athlete typed anything.';

-- Evidence is read as "the most recent comparable exposure to this exercise",
-- which crosses sessions and therefore cannot use the (session_block_id, ...)
-- keys these tables are indexed on today.
create index if not exists set_logs_exercise_idx
  on public.set_logs (exercise_id) where actual_load is not null;
create index if not exists cardio_logs_exercise_idx
  on public.cardio_logs (exercise_id);
