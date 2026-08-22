-- Data API grants for the content schema.
--
-- RLS decides which rows a role may see; table privileges decide whether the
-- role may touch the table at all, and the grant is checked first. Supabase
-- applies its default privileges to `public` only, so the read policies added
-- in 0003 sit on content tables that `authenticated` holds no privilege on --
-- every query would fail with `permission denied for table` before a single
-- policy was evaluated. `public` needs nothing here because the project was
-- created with "automatically expose new tables" on.
--
-- `anon` is deliberately absent: 0003 scopes every content policy `to
-- authenticated`, so granting anon would widen the surface without matching a
-- policy that could ever return a row.

grant usage on schema content to authenticated, service_role;

-- Athletes read the library; the content admin writes it server-side as
-- service_role (README, "Data"), never from the client.
grant select on all tables in schema content to authenticated;
grant all    on all tables in schema content to service_role;

-- Without this a content table added by a later migration silently repeats the
-- failure above. Left bound to the current role rather than a named `postgres`
-- so the same file runs under `db push`, the dashboard SQL editor, and the
-- local verify harness, whose superuser is whoever created the database.
alter default privileges in schema content
  grant select on tables to authenticated;
alter default privileges in schema content
  grant all    on tables to service_role;
