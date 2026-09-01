-- Retirement: a template stops being scheduled without ceasing to exist.
--
-- Four templates were authored to close the true-strength coverage gate while
-- the authored strength library was still being written. The library has now
-- landed and supersedes them, and the two sets overlap by four movements out of
-- five — near-identical sessions that semantic dedup cannot catch, because one
-- movement differs in each and that is enough to change the signature.
--
-- ── Why not delete them ─────────────────────────────────────────────────────
--
-- `workout_sessions.template_id` references these rows, and an athlete who
-- trained one of them did that training. Deleting the row would either break
-- the reference or force history onto a different template's id, and the second
-- is worse than the first: it would claim the athlete performed a session they
-- never saw. The prescription an athlete actually did is already safe —
-- `history.ts` reads it from `workout_sessions.snapshot_json`, never from the
-- template, precisely so a record cannot change when the library does (PRD
-- §11.1) — so retirement costs the historical record nothing.
--
-- What retirement removes is future scheduling. `status` is read where
-- candidates are generated, not where templates are looked up, so a completed
-- session on a retired template still resolves its name, family and goal.
--
-- ── superseded_by ───────────────────────────────────────────────────────────
--
-- Nullable, and not a redirect. Nothing follows it to substitute one template
-- for another; it records which session took over the job, so "why did this
-- stop appearing" has an answer that outlives the person who knows.

alter table content.workout_templates
  add column if not exists status text not null default 'content_eligible'
    check (status in ('content_eligible', 'retired')),
  add column if not exists superseded_by text references content.workout_templates(id);

comment on column content.workout_templates.status is
  'content_eligible = may be generated as a candidate. retired = kept for the '
  'history that references it, never scheduled again.';

comment on column content.workout_templates.superseded_by is
  'Which template took over this one''s job. Provenance, not a redirect: no '
  'reader follows it, and no history is migrated onto it.';

-- A retired template must say what replaced it, or the retirement is an
-- unexplained disappearance six months from now.
alter table content.workout_templates
  drop constraint if exists workout_templates_retired_has_successor;
alter table content.workout_templates
  add constraint workout_templates_retired_has_successor
  check (status <> 'retired' or superseded_by is not null);

create index if not exists workout_templates_status_idx
  on content.workout_templates (status);
