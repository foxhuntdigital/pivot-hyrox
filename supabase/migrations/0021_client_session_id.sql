-- The session's identity, minted by the device that performs it.
--
-- Until now a session had no identity until the server gave it one, and
-- `start-workout` defended against duplicates by asking a question instead:
-- "is there already an open session for this template?" That query is the only
-- thing standing between a retried Start and a second workout, and it is wrong
-- in three separate ways.
--
-- It reads mutable state. `status` moves — a session completes, a finish
-- lands — so whether Start is idempotent depends on when it is asked. Two
-- requests either side of a completion see different answers and both open a
-- row.
--
-- It is racy. Select-then-insert has no lock between the two, so a
-- double-tapped Start on a slow connection, or a client and its own outbox
-- retry firing together, both find nothing and both insert. Nothing in the
-- schema stops them.
--
-- And it is scoped to the wrong thing. Matching on template means an athlete
-- who legitimately performs the same template twice in a window is fighting
-- the dedupe, while an athlete whose session was recorded under a different
-- template is not protected by it at all.
--
-- ── What this replaces it with ──────────────────────────────────────────────
--
-- The client mints a uuid when the player opens — before any request is made,
-- so it survives the network being absent entirely — and sends it with Start
-- and with every retry of Start. The server looks the session up by it, and
-- the unique index below makes that lookup authoritative rather than advisory:
-- a duplicate insert is refused by Postgres, not by a query that happened to
-- run first.
--
-- This is what makes the offline path whole. A session begun with no
-- connection now has an id its own device knows, so the finish queued against
-- it names the same session the server will eventually create, and the app can
-- tell the two apart from a session it has never heard of. The optimistic
-- "completed today" counter that could never retire itself offline — because
-- it had no id to match on — retires on this one.
--
-- ── Why the index is partial ────────────────────────────────────────────────
--
-- Every session written before this migration has a null here, and nulls are
-- distinct under a plain unique index in Postgres — but stating the predicate
-- makes the intent explicit and keeps the index off the rows it can never
-- serve. Sessions from older clients keep working: `start-workout` falls back
-- to its previous behaviour when a request carries no id.
--
-- ── Why it is scoped by user ────────────────────────────────────────────────
--
-- A globally unique index would let one athlete's insert fail against a uuid
-- another athlete happens to hold, which is a cross-account failure mode for
-- no benefit. Identity here means "this athlete's session", and the index says
-- exactly that.

alter table public.workout_sessions
  add column if not exists client_session_id uuid;

comment on column public.workout_sessions.client_session_id is
  'Minted by the device when the player opens, before Start is sent. The identity a retry re-presents; null for sessions written before migration 0021.';

create unique index if not exists workout_sessions_client_session_id_uniq
  on public.workout_sessions (user_id, client_session_id)
  where client_session_id is not null;
