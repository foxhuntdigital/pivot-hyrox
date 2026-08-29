-- Splits — the session as a stopwatch recorded it.
--
-- Every Next in the player is a lap. The clock already measured each step, but
-- that time only survived where an existing table happened to have room for it:
-- a cardio step kept its duration in `cardio_logs`, a strength step's time was
-- measured and discarded, and rest was recorded nowhere at all. So an athlete
-- could be told the session took 47 minutes and never what the third station
-- cost them.
--
-- This is a separate table rather than a `duration_seconds` column on
-- `set_logs`, for three reasons that all point the same way:
--
--   * A split exists for rest, which is neither a set nor a cardio effort.
--   * A split is **ordered**. `set_logs` is unique on (block, set_index) and
--     `cardio_logs` has no order at all, so neither can answer "what did I do
--     third" — and a split list read out of order is not a split list.
--   * The two log tables record what was *performed*; a split records what the
--     *clock* saw. Keeping them apart is what lets a session be re-sent without
--     the two disagreeing.
--
-- Seconds are moving time: the player's tick only advances while the session is
-- running, so a pause counts against neither the split nor the cumulative.

create table if not exists public.session_splits (
  session_id        uuid not null references public.workout_sessions(id) on delete cascade,
  -- Position in the session, 0-based, in the order performed. With session_id
  -- this is the whole identity of a split: re-sending a finish overwrites the
  -- same rows rather than appending a second copy of the session.
  split_index       integer not null,
  block_order       integer not null,
  round             integer not null default 1,
  -- Null for rest, which belongs to no movement.
  exercise_id       text references content.exercises(id),
  -- What the athlete saw on the step, kept verbatim so a split still reads
  -- correctly after the library is edited — the same rule as snapshot_json.
  label             text not null,
  prescribed        text,
  kind              text,
  seconds           integer not null check (seconds >= 0),
  cumulative_seconds integer not null check (cumulative_seconds >= 0),
  rest              boolean not null default false,
  primary key (session_id, split_index)
);

comment on table public.session_splits is
  'One lap per completed step, in order. Seconds are moving time, excluding pauses.';

alter table public.session_splits enable row level security;
create policy session_splits_owner on public.session_splits
  for all to authenticated
  using (exists (
    select 1 from public.workout_sessions s
    where s.id = session_id and s.user_id = public.current_app_user_id()))
  with check (exists (
    select 1 from public.workout_sessions s
    where s.id = session_id and s.user_id = public.current_app_user_id()));
