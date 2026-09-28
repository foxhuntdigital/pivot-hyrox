-- What kind of session this is, within what it trains.
--
-- `training_domain` says a template is strength. It does not say whether it is
-- a repeatable barbell session an athlete progresses week to week, an explosive
-- one, an integrated one, or a blend — and those are different programming
-- purposes, not flavours. A week asking for two strength exposures and being
-- handed two Complex sessions because both scored 0.02 higher is a week that
-- has quietly skipped the foundational overload the athlete needed.
--
-- ── Why not `strength_archetype` ───────────────────────────────────────────
--
-- The column arrives with a 48-workout strength pack that names four values —
-- foundational, athletic, complex, mixed — so naming it for strength would have
-- been the obvious call, and wrong. Running needs the same axis and its own
-- vocabulary, already authored: eighteen values across four domains, in a
-- 24-workout pack waiting on the running-programming work. A strength-named
-- column would have needed renaming within weeks. The axis is "what kind of
-- session within its domain", and that question is not specific to strength.
--
-- ── Why no check constraint ───────────────────────────────────────────────
--
-- Deliberate, and a departure from how this schema usually handles a closed
-- set. A constraint listing the four strength values would refuse the first
-- running template written, and a constraint listing both vocabularies would
-- permit `long_run` on a strength session — so it would either block the next
-- pack or fail to mean anything. The vocabulary lives in the function below
-- instead, alongside the five that migration 0014 already established, where it
-- can grow per domain without a migration each time.
--
-- Null is a first-class value and means "no rotation preference". The existing
-- 277 templates keep it: their `workout_family` values are body-part splits
-- (`strength_total`, `strength_legs`, `strength_push`) rather than archetypes,
-- so inferring one would be inventing data. A null template simply does not
-- participate in archetype rotation, which is exactly today's behaviour.
--
-- ── What this column is not ───────────────────────────────────────────────
--
-- Not a second difficulty gate. `technical_demand` and `load_demand`
-- (migration 0023) are the eligibility envelope, matched against the athlete's
-- `technical_capacity` and `load_capacity`, and archetype must never widen it:
-- a rotation target may change which of the eligible sessions is chosen, never
-- whether a session the athlete cannot safely perform becomes available. The
-- demand grades already cut across archetype — complex and mixed carry
-- identical technical spreads in the incoming pack — so treating archetype as
-- difficulty would both duplicate the concept and get it wrong.

alter table content.workout_templates
  add column if not exists workout_archetype text;

comment on column content.workout_templates.workout_archetype is
  'What kind of session this is within its training domain — a rotation and programming axis, never an eligibility gate. Vocabulary per domain in content.workout_archetype_vocabulary(). Null means no rotation preference.';

/**
 * The archetypes, by the domain they belong to.
 *
 * Returns pairs rather than a flat array, unlike the vocabularies in migration
 * 0014, because an archetype is only meaningful inside a domain: `foundational`
 * says something about a strength session and nothing about a run, and a
 * running archetype is not a strength archetype at any value. A flat list would
 * lose exactly the constraint that makes the vocabulary useful — and it is the
 * shape, not the contents, that makes this table able to absorb a second
 * domain's vocabulary without a migration.
 *
 * ── Why only strength is listed ───────────────────────────────────────────
 *
 * Running is coming, and its archetypes are already written — eighteen values
 * across aerobic, threshold, race_specific and recovery, in a 24-workout pack.
 * They are deliberately not recorded here yet.
 *
 * That pack's metadata is mid-correction: its phase vocabulary says `base`
 * where the schema says `foundation`, it claims no `peak` or `race`
 * compatibility at all, and its `race_specific` training domain collides with
 * the planner goal of the same name and may be renamed. Writing the vocabulary
 * down while three of those are unsettled is how a wrong spelling becomes the
 * canonical one — which is the single thing this function exists to prevent.
 *
 * So the running rows are added in the same pass that corrects the pack, and
 * the only claim made here is about strength.
 */
create or replace function content.workout_archetype_vocabulary()
returns table (training_domain text, workout_archetype text)
language sql immutable as $$
  select * from (values
    ('strength', 'foundational'),   -- repeatable anchors, progressed week to week
    ('strength', 'athletic'),       -- power, jumps, force expression
    ('strength', 'complex'),        -- integrated, offset and contralateral loading
    ('strength', 'mixed')           -- foundational anchors plus athletic or complex work
  ) as v(training_domain, workout_archetype);
$$;

comment on function content.workout_archetype_vocabulary() is
  'Valid archetypes per training domain — strength only so far; running''s are added with the pack that defines them. Advisory rather than enforced: a check constraint would either refuse the next domain''s vocabulary or permit cross-domain nonsense.';

grant execute on function content.workout_archetype_vocabulary() to authenticated, anon, service_role;

-- No index. The whole template table is read in one `select *` by `loadContent`
-- and filtered in memory, so an index on this column would serve no query the
-- application actually makes.
