# Adaptive Athlete

> Training that adapts to the athlete's life without losing the training objective.

An adaptive HYROX/hybrid training app. The signature behaviour: a planned
70-minute session becomes a 30-minute Express or a 15-minute Micro **while
preserving the day's training stimulus**. The athlete stays on track when the
correct reduced stimulus is completed — missed calendar dates never create
backlog.

Built from `Adaptive Athlete.dc.html` (Claude Design) against
`Adaptive_Athlete_Design_Technical_PRD_v1.pdf`.

## Layout

```
apps/mobile/          Expo + React Native + TypeScript client
packages/engine/      Deterministic adaptation engine (shared client + server)
supabase/
  migrations/         Postgres schema + RLS
  seed/               Generated content seed
  functions/          Edge Functions (today, adapt, complete-workout)
tests/engine-fixtures Real curated library, engine-shaped
data/                 Source PRD + seed database as supplied
scripts/              Seed conversion, pack import, fixture build, schema verification
```

The engine is a **pure function** with explicit `.ts` import specifiers, so the
identical source runs three ways with no build step: Node's type stripping for
tests, Metro for the app, and Deno for Edge Functions. A recommendation cannot
drift between server and client because there is only one implementation.

## Getting started

```bash
npm install
npm test                  # engine suite (33 tests)
npm run db:verify         # applies migrations + seed to a scratch Postgres
npm run mobile            # Expo dev server
```

`db:verify` needs a local Postgres on the default socket. It creates a
throwaway database, stubs the Supabase `auth` schema, applies every migration
and the seed, then reports row counts and integrity checks.

### iOS simulator

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npx expo start
```

Do **not** use `expo start --host localhost`. That binds Metro to `[::1]` only,
while Expo Go requests the bundle over IPv4 — the app fails with "Could not
connect to development server" pointing at `127.0.0.1:8081` even though the
server is plainly running. The default bind is dual-stack; the environment
variable only fixes the advertised URL, which otherwise resolves to the
machine's LAN address and leaves `simctl openurl` to time out behind a hotspot
or a changing network.

Open the project with `xcrun simctl openurl <device-udid> exp://127.0.0.1:8081`.

## The engine

`packages/engine` implements PRD §9. Given an `EngineInput` snapshot it returns
either a session or an honest `no_session`.

**Hard constraints run before scoring** (§9.4) — a template that fails one is
not a low-ranked candidate, it is not a candidate:

- Concerning symptoms (chest, dizziness, bleeding, pelvic pressure, leaking)
  stop the hard-training flow and return safety guidance. The engine never
  diagnoses.
- An **intensity ceiling** by recovery state. This is deliberately a hard
  constraint rather than a scoring input: `stimulus_urgency` carries 30% weight
  and `recovery_fit` only 20%, so scoring alone once handed a depleted athlete
  RPE 6–7 threshold work. There is a regression test for exactly that.
- No maximal testing on poor recovery; taper overrides generic progression;
  48-hour spacing between repeat high-intensity or heavy lower-body exposures;
  postpartum considerations exclude non-friendly content.

Then candidates are scored on the §9.2 weights (stimulus urgency 30%, recovery
fit 20%, race specificity 15%, progression continuity 15%, time fit 10%,
equipment fit 5%, preference 5%) and the winner is transformed per §9.3.
Ranking is stable regardless of input ordering, and every decision carries
`engine_version` plus reason codes so it can be replayed from stored inputs.

## Data

The supplied SQLite seed is converted to Postgres by `scripts/convert-seed.mjs`,
which parses each row rather than hand-editing 534 INSERTs. Integer flags become
booleans (263 conversions). Verified counts: 44 exercises, 59 templates, 177
variants, 157 block exercises, 24 equipment, 9 substitutions, 7 progression
rules, 32 station programming rules.

Training goals are a **two-level taxonomy**. The planner only ever asks for five
stimuli (`BASE_STIMULI` in `periodization.ts`), but the content packs speak a much
richer vocabulary — `lactate_threshold`, `work_density`, `force_power_reserve` and
forty-odd more. A template carries both: `stimulus` is the authored value,
`primary_goal` the planner-facing goal it rolls up to, and ranking matches either.
`primary_goal` is *derived* by `scripts/apply-taxonomy.mjs`, so the two cannot
drift — edit the stimulus and re-run. A few stimuli resolve on the session rather
than the name: `power_endurance` is threshold work on an erg and strength work on
a heavy sled, so the roll-up reads the exercises' modalities.

Some authored values describe the **dose** rather than the goal.
`minimum_effective_dose` is what a Micro variant *is*, not what it trains — a
Micro threshold session is still threshold, a Micro aerobic session is still
aerobic durability — so mapping it globally would mislabel every session using
it. Those resolve from the session's own evidence (intensity first, then whether
the work is loaded, then whether it rehearses several race stations) and are
reported as wanting a real stimulus declared in their pack.

These run above the supplied dump's own `meta` figures because content packs
are folded in on top of it: the rower as equipment, `ex_rowerg` and its
substitution for running, 21 row-based workouts, and the parts of the HYROX
station matrix and running expansion that are fit to publish.

### Content packs

A pack is JSON in `data/`, merged into the dump by `scripts/import-workouts.mjs`
(`npm run seed:import`). Re-running an import replaces that pack's rows rather
than duplicating them, and removes anything dropped from the pack — provenance
is the pack label on `workout_variants.notes`.

**Every prescribed quantity must carry an explicit `prescription_type` and
`unit`.** This is enforced twice: the importer refuses a pack that omits either,
and Postgres refuses the row (`prescription_type` is `NOT NULL` with a `CHECK`,
`quantity_unit` is `NOT NULL`). The rule exists because prose prescriptions are
underspecified — `m` is overloaded between metres and minutes, and for runs and
ergs no semantic discriminator survives once magnitude is the deciding factor.
Rather than let a parser's guess become production content, prose packs go
through `scripts/prepare-pack.mjs` (`npm run seed:prepare`), which splits them:

| bucket | meaning |
| --- | --- |
| `.ready.json` | every unit resolved by the movement or an explicit token — importable |
| `.review.json` | parsed, but a metre/minute call rested on magnitude alone — needs sign-off |
| `.authoring.json` | not parseable, or missing `estimated_minutes` — needs structured items |

`scripts/export-authoring-sheet.mjs` (`npm run seed:sheets`) flattens the last
two into CSVs for review. The parser refuses rather than guesses: it will not
fall through an unknown movement to the station default, will not drop an
unquantified phase that names real work, and will not read a per-round rest
schedule as a set of reps.

Imports **deduplicate semantically**, on what a session prescribes — movements,
quantities, units, rounds — not on its id or name, because four packs now
overlap by design. A match keeps the existing richer template. It catches an
identical prescription, the same shape retuned within 10%, and the same main set
differing only in a warm-up or cool-down.

Content lives in the `content` schema (read-only to authenticated users);
athlete data lives in `public` (owner-only). All 33 tables have RLS enabled.

### Variant vocabulary

The database stores `green` / `yellow` / `red`. The UI renders **Full /
Express / Micro** and never presents them as failure states (§25, §8.1). The
mapping is `VARIANT_LABEL` in the engine.

## Coach

The fifth tab (D21 / FR-020), built from the `COACH` screens in
`Adaptive Athlete.dc.html` and the Coach UX brief in the same design project.

Conversation is the interface; the structured payload underneath is the
authority. Nothing in a Coach answer is written prose about training:

| layer | file | what it may do |
| --- | --- | --- |
| classify | `src/data/coach.ts` | free text → intent + structured signals (time limit, energy, equipment ids, content terms, days). Symptom language routes to the safety boundary first and is never re-read as fatigue. An unmatched question returns `null` rather than a guess. |
| answer | `src/state/coachAnswer.ts` | runs the **engine** against those signals and builds the cards. Every duration, variant, swap and reason code on screen came out of `recommend()`, the readiness model or the curated library. |
| render | `src/components/coach/cards.tsx` | CC01–CC12 as typed components |
| converse | `src/state/coach.tsx` | threads hold the question and its intent, never the rendered answer |

Because answers are derived rather than stored, reopening a thread re-asks the
engine: a conversation can never assert a plan the athlete no longer has.

Two consequences worth knowing when reading the code:

- **Adaptations prefer today's own session.** Coach asks the engine for a smaller
  variant of the planned template before it will offer a different one, and when
  the stimulus cannot survive the constraint the card says "Stimulus changed"
  rather than dressing a swap up as a trim.
- **Actions write through.** "Use this workout" applies the check-in it was
  computed against (`set_time`, `set_energy`, equipment) and the override, so the
  session Coach offered is the session Today shows. A weekly change is a
  proposal: it goes through the full-screen review (`PlanChangeReview`) and only
  `Apply changes` mutates the plan. Everything committed leaves an inline
  confirmation with an undo, restored from a snapshot of the adaptable state.

## Known gaps

Deliberate omissions, not oversights:

- **Coach threads are not persisted.** The tab is built (see below) but a thread
  lives for the session; `coach_threads` / `coach_messages` (with held
  `proposed_action`) are in the schema and not yet written to.
- **Onboarding (D02–D08) is not built.** Email/password auth is (D01): sign-in,
  sign-up, session persistence, route gating and log out, with `0004` provisioning
  `users` + `athlete_profiles` on signup. What is missing is the guided setup that
  should follow a first sign-up — goal, equipment and considerations are edited on
  Profile instead.
- **Training data is still local.** Only the profile round-trips to Supabase. The
  plan, sessions and readiness come from the bundled library and a fixed athlete in
  `src/data/athlete.ts`, shaped exactly as the Supabase queries return so swapping
  to live data is a change of source, not of shape. With no `EXPO_PUBLIC_SUPABASE_*`
  configured the app runs entirely on that seed rather than refusing to start.
- **HealthKit / WorkoutKit / Health Connect** are P1 and not started. Where the
  design showed heart rate and training load, the app shows a neutral
  "not connected" state rather than inventing numbers (§8.3).
- **Offline sync** — schema support exists (`client_event_id`, `revision`) but
  the sync loop is not implemented.
