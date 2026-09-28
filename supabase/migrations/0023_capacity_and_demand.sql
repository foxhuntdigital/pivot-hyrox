-- Capacity describes the athlete. Demand describes the workout.
--
-- Onboarding has asked two questions about experience since launch —
-- `experience_level` ("New to this / Some racing / Experienced") and
-- `training_age_years` — and neither has ever reached the planner. They were
-- never sent to the server, `EngineInput` had no field to receive them, and no
-- template carried anything to match them against. A beta athlete who selected
-- "new to race training" and "returning from injury" received a week
-- byte-identical to a seasoned racer's.
--
-- Wiring those two up would not have been enough, because both were the wrong
-- questions. They measured *race history*, and race history is a poor proxy for
-- either of the things the planner actually needs to know.
--
-- ── Why two axes and not one ───────────────────────────────────────────────
--
-- A single beginner/intermediate/advanced label produces visibly wrong plans
-- for the two athletes we have most of:
--
--   * The CrossFit convert. Eight years under a barbell, first HYROX in March.
--     Large capacity for work, no race-specific skill. One "beginner" label
--     gives them a week far below what they can absorb.
--   * The returning racer. Four seasons of racing, six weeks post-injury. Full
--     technical command, badly reduced capacity. One "advanced" label hands
--     them exactly the volume that re-injures them.
--
-- Those two need opposite things and one number cannot separate them. So:
--
--   load_capacity       how much work this athlete can absorb
--   technical_capacity  how complex a movement they can perform well
--
-- and on the other side of the match, on the template:
--
--   load_demand         how much work this session costs
--   technical_demand    how much skill it assumes
--
-- ── Why they are priors, not facts ─────────────────────────────────────────
--
-- Both start as an athlete's own answer, which is a starting estimate and not
-- a measurement. `athlete_capability_evidence` already establishes the pattern
-- for the other direction — observed performance accumulating into a state
-- with a confidence band — and these are shaped to be refined the same way
-- later. `capacity_source` records which we are looking at, so a value that
-- came from a questionnaire is never mistaken for one the athlete demonstrated.
--
-- ── The demand columns are deliberately null ───────────────────────────────
--
-- No template is graded yet; content is grading all 239 against a published
-- rubric. The columns exist now so that work has somewhere to land and the
-- engine can be built against them, and every rule that reads them treats null
-- as "unknown, do not constrain". An ungraded library therefore behaves exactly
-- as it does today, and each template starts being matched the moment it is
-- graded rather than on a flag day.
--
-- ── What happens to the old columns ────────────────────────────────────────
--
-- `experience_level` and `training_age_years` are kept, not dropped. They hold
-- real answers from real beta athletes and they are still worth having as
-- context — the Coach prompt reads experience, and race history is genuinely
-- interesting next to a capacity the athlete claimed. What changes is that
-- neither may determine eligibility or demand ever again. Nothing in the
-- programming path reads them after this migration.

-- ─────────────────────────────────────────────────────────────
-- Athlete: capacity
-- ─────────────────────────────────────────────────────────────

alter table public.athlete_profiles
  add column if not exists load_capacity integer
    check (load_capacity between 1 and 4),
  add column if not exists technical_capacity integer
    check (technical_capacity between 1 and 4),
  -- 'stated' = the athlete's own answer at onboarding. 'observed' is reserved
  -- for a value derived from performance; nothing writes it yet, and the column
  -- exists so that when something does, a stated value is distinguishable from
  -- a demonstrated one rather than silently overwritten.
  add column if not exists capacity_source text not null default 'stated'
    check (capacity_source in ('stated', 'observed'));

comment on column public.athlete_profiles.load_capacity is
  '1-4. How much training this athlete can absorb. From "How would you describe your fitness right now?" at onboarding. Null for athletes who onboarded before migration 0023 and have not been re-asked.';
comment on column public.athlete_profiles.technical_capacity is
  '1-4. How complex a movement this athlete can perform well. From "How experienced are you with structured performance training?". A broad prior, explicitly not final truth.';
comment on column public.athlete_profiles.experience_level is
  'Race history. Secondary context only — must never determine eligibility or workout demand. Superseded for programming by load_capacity and technical_capacity (migration 0023).';
comment on column public.athlete_profiles.training_age_years is
  'Years training. Secondary context only — must never determine eligibility or workout demand (migration 0023).';

-- ─────────────────────────────────────────────────────────────
-- Template: demand
-- ─────────────────────────────────────────────────────────────

alter table content.workout_templates
  add column if not exists load_demand integer
    check (load_demand between 1 and 4),
  add column if not exists technical_demand integer
    check (technical_demand between 1 and 4);

comment on column content.workout_templates.load_demand is
  '1-4, authored. How much this session costs to absorb: volume, intensity, recovery required. Null = ungraded, which every matching rule reads as "do not constrain".';
comment on column content.workout_templates.technical_demand is
  '1-4, authored. How much skill this session assumes. Null = ungraded. Matched as a hard constraint once set: technical demand above an athlete''s capacity is a safety question, not a preference.';

-- Read whenever the planner filters a candidate pool.
create index if not exists workout_templates_demand_idx
  on content.workout_templates (technical_demand, load_demand);
