-- Supplemental work, as something the athlete did rather than something the
-- plan asked for.
--
-- A supplemental session is offered after a primary is finished, taken or
-- declined in the moment, and never scheduled. It is still training: it lands
-- in `workout_sessions` like anything else, so accumulated load in
-- `readiness.ts` sees it, history shows it, and the logging path that already
-- exists records what was performed. What it must never do is credit a weekly
-- stimulus requirement — the week asked for a primary session and got one.
--
-- ── Why the role is stored and not derived ──────────────────────────────────
--
-- `content.workout_templates.workout_role` already says what a template is, so
-- a session's role could be read through the join. It is copied here for the
-- same reason `snapshot_json` exists: a template edited or re-roled next month
-- must not change what an athlete did last month. A derived role would rewrite
-- history the moment the library moved, and the whole point of that column is
-- that history does not move.
--
-- ── One per day, and never chained ──────────────────────────────────────────
--
-- The cap is a product rule (PRD §19.4): supplemental work is a bonus for an
-- athlete who finished and still has something left, not a second session that
-- quietly doubles the day. It is enforced in `_shared/supplemental.ts` where
-- the reason can be explained, and again here where it cannot be bypassed by a
-- client that skips the check.

alter table public.workout_sessions
  add column if not exists workout_role text not null default 'primary'
    check (workout_role in ('primary', 'supplemental'));

comment on column public.workout_sessions.workout_role is
  'Copied from the template at start, not joined: a template re-roled later '
  'must not change what this athlete did.';

-- At most one supplemental per athlete per local day.
--
-- Keyed on the date the session STARTED, in UTC. The athlete's own local date
-- lives in `snapshot_json` and cannot be indexed from here without making the
-- index depend on a jsonb path; UTC day is close enough for a guard whose job
-- is stopping a loop, not adjudicating a timezone edge.
create unique index if not exists workout_sessions_one_supplemental_per_day
  on public.workout_sessions (user_id, ((started_at at time zone 'utc')::date))
  where workout_role = 'supplemental';

create index if not exists workout_sessions_role_idx
  on public.workout_sessions (user_id, workout_role, started_at desc);
