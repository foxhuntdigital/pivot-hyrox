-- A rule that deliberately changes nothing.
--
-- 0001 wrote `check (max_change_pct > 0)` when every progression rule moved a
-- number: the cap existed to stop a rule progressing too fast, and zero meant a
-- rule someone had forgotten to fill in. The maintenance families broke that
-- assumption. `strength_maintenance_lower` and `_upper` are a reduced dose by
-- design, and the ruling they encode is that completing one earns no heavier
-- prescription and is not evidence of decline either — the load was lower
-- because the session asked for less, not because the athlete could do less.
--
-- The action for that is `hold`, and its honest cap is 0.
--
-- Written as a scoped exemption rather than by relaxing the check to `>= 0`,
-- because the original guarantee is still worth having everywhere else: a
-- `step` or `percent` rule with a zero cap is still a rule that silently never
-- progresses, and that is the bug 0001 was guarding against. So the constraint
-- now says the thing it actually means — a hold changes nothing, and everything
-- that is not a hold changes something.
alter table content.progression_rules
  drop constraint if exists progression_rules_max_change_pct_check;

do $$ begin
  alter table content.progression_rules
    add constraint progression_rules_change_matches_action
    check (
      (action  = 'hold' and max_change_pct = 0)
      or (action <> 'hold' and max_change_pct > 0)
    );
exception when duplicate_object then null;
end $$;

comment on column content.progression_rules.max_change_pct is
  'Cap on how far one application may move the prescription. Exactly 0 for '
  'action = ''hold'', which is a reduced dose by design; strictly positive for '
  'every other action, where 0 would be a rule that never progresses.';
