-- Returning from injury, as a temporary ceiling rather than a smaller athlete.
--
-- "Returning from injury" has been an onboarding option since launch and has
-- never done anything: it reaches the engine as a `considerations` string and
-- matches nothing there, because only postpartum is implemented. The athlete
-- who filed the beta ticket that started this work selected it.
--
-- ── Why this is not a lower capacity ──────────────────────────────────────
--
-- The obvious implementation is to drop `load_capacity` by one. It is wrong,
-- and product signoff (28 Sep 2026) is explicit about why: an athlete six weeks
-- back from injury has not become a beginner. They have the training age, the
-- technique and the history they had before, and what is reduced is how much
-- work they can absorb *right now*. Overwriting the stated capacity would
-- destroy the number they are rebuilding towards and leave nothing to know when
-- the rebuild is finished.
--
-- So the stated capacity is never mutated. A separate ceiling constrains it,
-- and the constraint is lifted a level at a time until it meets the capacity
-- underneath, at which point it disappears.
--
--   effective load capacity = min(load_capacity, rebuilding_load_ceiling)
--
-- ── Why reporting an injury is not enough to impose it ────────────────────
--
-- The ceiling is created only when the athlete says the return *currently
-- requires reduced training*. Someone who has fully rebuilt and simply reports
-- the history should not be handed a smaller week for it, and an athlete
-- describing their own readiness is a better signal than an inference drawn
-- from the fact that an injury once happened.
--
-- ── Why there is no expiry ────────────────────────────────────────────────
--
-- Nothing here is time-based, and that is deliberate. A rebuild finishes when
-- the athlete tolerates the work, not when a fortnight has passed — and a
-- ceiling that lifted itself on a timer would raise the dose of someone who had
-- not trained at all. Progression is confirmed by the athlete, and only offered
-- once the sessions behind it exist: at least two tolerated exposures at the
-- current ceiling, spanning at least seven days. `ceiling_set_at` is what makes
-- that span measurable.
--
-- ── What this is not ──────────────────────────────────────────────────────
--
-- Not a safety constraint. Current movement and activity limitations stay where
-- they are, in `considerations` and the engine's impact and symptom gates, and
-- they are checked whatever the ceiling says. This governs dose alone.

alter table public.athlete_profiles
  add column if not exists rebuilding_load_ceiling integer
    check (rebuilding_load_ceiling between 1 and 4),
  -- When the CURRENT ceiling level was set, not when the rebuild began. Each
  -- confirmed step forward resets it, because the seven-day span the next step
  -- needs is a span at the level being left behind.
  add column if not exists rebuilding_ceiling_set_at timestamptz;

comment on column public.athlete_profiles.rebuilding_load_ceiling is
  'Temporary cap on effective load capacity while rebuilding (migration 0025). Never overwrites load_capacity: effective = min(load_capacity, this). Null means no rebuild in progress. Cleared when it reaches load_capacity.';
comment on column public.athlete_profiles.rebuilding_ceiling_set_at is
  'When the current ceiling level was set. Each confirmed step resets it — the seven-day span a step requires is measured at the level being left, not from the start of the rebuild.';
