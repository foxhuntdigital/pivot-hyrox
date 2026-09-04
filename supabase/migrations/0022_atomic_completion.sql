-- Completing a workout is one decision, so it is now one transaction.
--
-- `complete-workout` performed six independent writes in sequence — the
-- session, its blocks, the set and cardio logs, the splits, the stimulus
-- credit, the queue item — with nothing tying them together. Postgres gave each
-- statement its own implicit transaction, so every gap between them was a point
-- where the session could end up half-recorded, and the function's error
-- handling made two of those gaps permanent rather than transient.
--
-- ── The failure that made this urgent ───────────────────────────────────────
--
-- The session was marked `completed` first and credited last. If anything
-- between the two threw — a log insert against a constraint, a dropped
-- connection, a statement timeout on a large session — the handler returned
-- 500 with the session already completed and the week not yet credited. The
-- client did the right thing and retried. And the retry hit the replay guard:
--
--     if (session.status === 'completed' && session.revision >= body.revision)
--       return { replayed: true }
--
-- which is correct for a genuine replay and exactly wrong here. The session
-- looked finished, so the retry returned success and did nothing, and the
-- stimulus was never credited. The athlete had trained, the app said so, and
-- the week's counter disagreed with it permanently — with no error anywhere,
-- because every layer believed it had succeeded.
--
-- Reordering the writes would have narrowed that window. It would not have
-- closed it: any ordering still has a gap, and a gap after a status change that
-- suppresses its own retry is unrecoverable wherever it falls. The session's
-- status must not become `completed` unless everything that follows from it
-- committed too, and that is a transaction, not an ordering.
--
-- ── Why the guards moved in here ───────────────────────────────────────────
--
-- The replay and stale-revision checks used to run in TypeScript, against a row
-- read a few statements earlier, with nothing holding it still in between. Two
-- finishes arriving together — a device and its own outbox retry, or two
-- devices — could both read `active`, both pass the guard, and both write. The
-- `select … for update` below is what makes the check mean something: the
-- second finish waits for the first to commit and then sees the state it
-- actually left behind.
--
-- ── Why SECURITY INVOKER ───────────────────────────────────────────────────
--
-- Deliberately not `security definer`, unlike `delete_own_account`. Every table
-- touched here already carries an RLS policy that scopes it to the owning
-- athlete, so running as the caller means this function can write exactly what
-- the caller could have written statement by statement — and no more. A definer
-- function would have to re-derive ownership itself and would be a standing
-- invitation to get that wrong. The transaction is the only thing being added.
--
-- ── What stayed outside ────────────────────────────────────────────────────
--
-- Capability evidence. It is derived from the logs after they land, by rules
-- that live in TypeScript, and it is rebuilt from scratch on every finish — so
-- a failure there is a gap the next session repairs, not a lost record. Pulling
-- it in would mean reimplementing the evidence rules in plpgsql for no gain in
-- correctness.

create or replace function public.complete_workout_tx(
  p_session_id  uuid,
  p_revision    integer,
  p_session_rpe integer,
  p_notes       text,
  p_ended_early boolean,
  p_blocks      jsonb,
  p_set_logs    jsonb,
  p_cardio_logs jsonb,
  p_splits      jsonb,
  -- Resolved by the caller before the transaction opens. Which week a session
  -- belongs to is a read, and a read does not need to be inside this to be
  -- correct; passing it keeps the periodisation rules in one language.
  p_cycle_id    uuid,
  p_stimulus    text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_session        public.workout_sessions%rowtype;
  v_already        boolean;
  v_credited       text := null;
  v_has_blocks     boolean;
begin
  -- Held for the rest of the transaction. Everything below reasons about this
  -- row's status and revision, and neither may move underneath it.
  select * into v_session
  from public.workout_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  -- Already applied at this revision or beyond. Answering with the stored state
  -- is what makes a retrying outbox safe.
  if v_session.status = 'completed' and v_session.revision >= p_revision then
    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'credited_stimulus', null,
      'replayed', true);
  end if;

  -- Another device already advanced this session past the revision being sent.
  if p_revision < v_session.revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;

  /*
   * Whether this session had already been counted.
   *
   * A *later* finish for a completed session is a correction — a corrected RPE,
   * a re-sent set of logs — and it must rewrite the record without incrementing
   * the week a second time. Crediting by stimulus has no marker of its own to
   * prevent that, so the guard has to be explicit.
   */
  v_already := v_session.status = 'completed';

  update public.workout_sessions
     set status       = 'completed',
         ended_at     = now(),
         session_rpe  = p_session_rpe,
         notes        = p_notes,
         ended_early  = coalesce(p_ended_early, false),
         revision     = p_revision
   where id = p_session_id;

  -- ── Per-block actuals ────────────────────────────────────────────────────
  if p_blocks is not null and jsonb_array_length(p_blocks) > 0 then
    update public.session_blocks sb
       set actual_json  = j.actual_json,
           completed_at = j.completed_at,
           skipped      = coalesce(j.skipped, false)
      from jsonb_to_recordset(p_blocks)
        as j(block_order integer, actual_json jsonb,
             completed_at timestamptz, skipped boolean)
     where sb.session_id = p_session_id
       and sb.block_order = j.block_order;
  end if;

  select exists(select 1 from public.session_blocks where session_id = p_session_id)
    into v_has_blocks;

  /*
   * Logs are replaced, never appended.
   *
   * A finish is a statement about the whole session, so a corrected or re-sent
   * one has to overwrite what it said before. Appending would double every set
   * the athlete performed, and an upsert would leave the tail of a session that
   * ended early still claiming steps it never reached.
   *
   * They are keyed by `block_order` on the wire because that is what the client
   * knows — the prescription's shape, not the row ids the server minted — and
   * resolved to `session_blocks.id` by the join here. With no block rows there
   * is nothing to attach them to; that is a session whose blocks failed to
   * write, and its logs are dropped rather than orphaned.
   */
  if v_has_blocks then
    delete from public.set_logs
     where session_block_id in (
       select id from public.session_blocks where session_id = p_session_id);

    delete from public.cardio_logs
     where session_block_id in (
       select id from public.session_blocks where session_id = p_session_id);

    if p_set_logs is not null and jsonb_array_length(p_set_logs) > 0 then
      insert into public.set_logs (
        session_block_id, exercise_id, set_index,
        prescribed_reps, actual_reps, prescribed_load, actual_load,
        load_unit, rpe, prescribed_reps_min, prescribed_reps_max,
        prescribed_rpe, notes, source, client_event_id)
      select sb.id, j.exercise_id, j.set_index,
             j.prescribed_reps, j.actual_reps, j.prescribed_load, j.actual_load,
             j.load_unit, j.rpe, j.prescribed_reps_min, j.prescribed_reps_max,
             j.prescribed_rpe, j.notes,
             -- A client that does not send it is an older build, whose rows are
             -- asserted by construction.
             coalesce(j.source, 'asserted'),
             gen_random_uuid()
        from jsonb_to_recordset(p_set_logs)
          as j(block_order integer, exercise_id text, set_index integer,
               prescribed_reps integer, actual_reps integer,
               prescribed_load real, actual_load real,
               load_unit text, rpe integer,
               prescribed_reps_min integer, prescribed_reps_max integer,
               prescribed_rpe real, notes text, source text)
        join public.session_blocks sb
          on sb.session_id = p_session_id and sb.block_order = j.block_order;
    end if;

    if p_cardio_logs is not null and jsonb_array_length(p_cardio_logs) > 0 then
      insert into public.cardio_logs (
        session_block_id, exercise_id, duration_seconds, distance_meters,
        avg_hr, calories, rpe, source, client_event_id)
      select sb.id, j.exercise_id, j.duration_seconds, j.distance_meters,
             j.avg_hr, j.calories, j.rpe,
             -- The default flips here: a distance step is timed whether or not
             -- anyone typed anything, so an existing row is a real measurement.
             coalesce(j.source, 'timer'),
             gen_random_uuid()
        from jsonb_to_recordset(p_cardio_logs)
          as j(block_order integer, exercise_id text,
               duration_seconds integer, distance_meters real,
               avg_hr integer, calories integer, rpe integer, source text)
        join public.session_blocks sb
          on sb.session_id = p_session_id and sb.block_order = j.block_order;
    end if;
  end if;

  /*
   * Splits hang off the session rather than off its blocks, so unlike the logs
   * they can be written even when the block rows are missing. Deleted before
   * inserting for the same reason: a session re-sent after ending early is
   * shorter than the one before it, and an upsert would leave the earlier laps
   * past its end in place.
   */
  if p_splits is not null then
    delete from public.session_splits where session_id = p_session_id;

    if jsonb_array_length(p_splits) > 0 then
      insert into public.session_splits (
        session_id, split_index, block_order, round, exercise_id,
        label, prescribed, kind, seconds, cumulative_seconds, rest)
      select p_session_id, j.index, j.block_order, coalesce(j.round, 1),
             nullif(j.exercise_id, ''), j.label, j.prescribed, j.kind,
             greatest(0, round(j.seconds)::integer),
             greatest(0, round(j.cumulative_seconds)::integer),
             coalesce(j.rest, false)
        from jsonb_to_recordset(p_splits)
          as j(index integer, block_order integer, round integer,
               exercise_id text, label text, prescribed text, kind text,
               seconds real, cumulative_seconds real, rest boolean);
    end if;
  end if;

  /*
   * Reconcile the week. A completed session credits its stimulus once, whatever
   * day it landed on.
   *
   * The caller decides whether there is anything to credit — a supplemental
   * passes a null stimulus, because the week asked for a primary session and
   * already got one.
   */
  if p_stimulus is not null and p_cycle_id is not null and not v_already then
    update public.stimulus_requirements
       set completed_exposures = least(target_exposures, completed_exposures + 1)
     where weekly_cycle_id = p_cycle_id
       and stimulus_type = p_stimulus
    returning stimulus_type into v_credited;
  end if;

  if v_session.queue_item_id is not null and not v_already then
    update public.session_queue_items
       set state = 'completed'
     where id = v_session.queue_item_id;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', 'completed',
    'credited_stimulus', v_credited,
    'replayed', false);
end;
$$;

revoke all on function public.complete_workout_tx(
  uuid, integer, integer, text, boolean, jsonb, jsonb, jsonb, jsonb, uuid, text) from public;
revoke all on function public.complete_workout_tx(
  uuid, integer, integer, text, boolean, jsonb, jsonb, jsonb, jsonb, uuid, text) from anon;
grant execute on function public.complete_workout_tx(
  uuid, integer, integer, text, boolean, jsonb, jsonb, jsonb, jsonb, uuid, text) to authenticated;

comment on function public.complete_workout_tx(
  uuid, integer, integer, text, boolean, jsonb, jsonb, jsonb, jsonb, uuid, text) is
  'Finalises a workout session and reconciles the week in one transaction. Runs as the caller, so RLS scopes every write. Locks the session row, so the replay and stale-revision guards hold against concurrent finishes.';
