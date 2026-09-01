-- A supplemental has no planner goal, because the planner cannot select it.
--
-- `primary_goal` is the key `matchesStimulus` compares against when the week
-- asks for a stimulus, and the week only ever asks for the five in
-- `PLANNER_GOALS`. A supplemental is never asked for: `loadContent` keeps
-- `workout_role = 'supplemental'` out of the candidate pool entirely, so
-- neither `recommend` nor `planWeekQueue` can reach one.
--
-- Until now the column was NOT NULL, which forced every supplemental to claim
-- one of the five. An eight-minute anti-rotation routine would have had to call
-- itself strength, and a mobility routine recovery — values written only to
-- satisfy a constraint, indistinguishable at a glance from values that mean
-- something, and passed through `resolveGoal` purely to have an answer. That is
-- the silent fallback the importer's planner-goal validator exists to remove,
-- reintroduced through the schema.
--
-- So the invariant is restated where it is actually true: every template the
-- planner can select resolves to a canonical goal. A supplemental is exempt,
-- and the check enforces the exemption in both directions — a primary without a
-- goal is still refused, which is the half that was doing the work.
--
-- If a supplemental ever becomes planner-selectable, it acquires a goal or
-- fails validation at that boundary. The constraint is the boundary.

alter table content.workout_templates
  alter column primary_goal drop not null;

do $$ begin
  alter table content.workout_templates
    add constraint workout_templates_primary_has_goal
    check (workout_role = 'supplemental' or primary_goal is not null);
exception when duplicate_object then null;
end $$;

comment on column content.workout_templates.primary_goal is
  'The planner goal this template serves, one of aerobic_durability, threshold, '
  'strength, race_specific, recovery. NULL only for workout_role = '
  'supplemental, which the planner never selects.';
