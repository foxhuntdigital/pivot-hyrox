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

`npm install` runs `scripts/patch-native-deps.mjs`, which re-applies local
fixes to native dependencies — currently one, dropping two redundant
`SWIFT_RETURNS_RETAINED` annotations from `expo-modules-jsi` that Swift 6.3
rejects and that stop `expo run:ios` compiling at all. The patch is matched on
content: if upstream fixes the file the script says so and leaves it alone, so
the entry can be deleted rather than quietly rotting.

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

If `expo run:ios` reports no matching destination, check
`xcodebuild -showdestinations`: an Xcode update can leave the iOS simulator
platform uninstalled, and none of the booted devices are then eligible even
though `simctl` still lists them. `xcodebuild -downloadPlatform iOS` restores
it (~8.5 GB).

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
- **Running costs equipment.** `outdoor` used to be treated as always available,
  alongside `bodyweight`, which read as generosity and was a hole: nothing could
  filter `requires_running`, so an athlete in a hotel room or a treadmill-less
  home gym was handed run sessions and no equipment profile could say otherwise.
  Running now needs `treadmill` or `outdoor` like every other modality needs its
  kit. Migration `0009` reinterprets existing profiles rather than changing what
  they meant: one that ticked neither was answered under the old rule, where
  that still meant "I can run", so it gains `outdoor`. One that ticked only
  `treadmill` was a deliberate answer and is left alone. The adapt sheet's "No
  equipment" keeps `outdoor` for the same reason — it is a place, not kit.

`packages/engine/src/coverage.test.ts` is the standing gate on what that leaves
an athlete with. It measures the two dumbbell profiles — with and without
somewhere to run — across goal × time budget × recovery state × training phase,
and fails a cell that falls below a floor derived from how often the planner
asks for that stimulus. It is red until the dumbbell expansion lands, and it
names the gaps: threshold and recovery without running, and taper, where the
family filter currently leaves a dumbbell athlete one session.

Then candidates are scored on the §9.2 weights (stimulus urgency 30%, recovery
fit 20%, race specificity 15%, progression continuity 15%, time fit 10%,
equipment fit 5%, preference 5%) and the winner is transformed per §9.3.
Ranking is stable regardless of input ordering, and every decision carries
`engine_version` plus reason codes so it can be replayed from stored inputs.

## Data

The supplied SQLite seed is converted to Postgres by `scripts/convert-seed.mjs`,
which parses each row rather than hand-editing 534 INSERTs. Integer flags become
booleans (263 conversions). Verified counts: 44 exercises, 90 templates, 270
variants, 240 block exercises, 24 equipment, 9 substitutions, 7 progression
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

The generated seed **upserts** (`on conflict ... do update`), so applying it to a
database that already holds an earlier version of the library brings it exactly
into line rather than leaving stale rows behind — a template that gained a
`stimulus`, or whose `primary_goal` was normalised, is corrected in place. Join
tables, which are all key and have nothing to update, keep `do nothing`. Apply
it to the linked project with:

```bash
supabase db query --linked -f supabase/seed/01_content.sql
```

A pack is JSON in `data/`, merged into the dump by `scripts/import-workouts.mjs`
(`npm run seed:import`). Re-running an import replaces that pack's rows rather
than duplicating them, and removes anything dropped from the pack — provenance
is the pack label on `workout_variants.notes`.

**Every prescribed quantity must carry an explicit `prescription_type` and
`unit`, and every workout an explicit `intensity_target`.** The first is
enforced twice: the importer refuses the row, and Postgres refuses it
(`prescription_type` is `NOT NULL` with a `CHECK`, `quantity_unit` is `NOT
NULL`). The second is an importer rule — `intensityCost()` falls back to 0.5
when a target is missing, so an unstated RPE 7 session reads as moderate and the
recovery guardrail hands it to a depleted athlete. The rule exists because prose prescriptions are
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

### The LLM layer

`@pivot/coach` is the bounded orchestration layer from PRD §13 and the PIVOT LLM
package. Two calls per message — a **Haiku 4.5** classifier that turns the
sentence into structured signals, and an **Opus 5** composer that writes the
reply from what the engine returned:

```
message → classify (structured output, ~350-token cached prefix)
        → route to deterministic tools (packages/coach/src/tools.ts)
        → compose (structured output, ~2,000-token cached prefix)
        → proposed action, built by code from engine output
```

| Piece | Where |
| --- | --- |
| Prompts + schemas (source of truth) | `packages/coach/prompts/*` |
| Generated prompt module | `npm run coach:prompts` → `src/generated.ts` |
| Orchestration, runtime-agnostic | `packages/coach/src/turn.ts`, `tools.ts` |
| Endpoint | `supabase/functions/coach/` |
| Release gate | `npm run coach:evals` |

The orchestration is deliberately runtime-agnostic — the Edge Function and the
eval runner drive the identical code, so a case that passes in CI is the code
path that serves athletes.

Three things are enforced in code rather than asked for in the prompt, because a
prompt is a request and these are guarantees:

- **The model cannot mutate training.** A turn returns a *proposed* action built
  by `tools.ts` from engine output. The model never emits one, so a model that
  decides to rewrite the week cannot express it.
- **`requires_confirmation` comes from the confirmation policy**, not from the
  response. Weekly changes carry it whatever the prose says.
- **Symptom reports are typed `safety` and stripped of any action**, whatever
  the model returned. Covered by `coach.test.ts`, which runs without a key.

Cost, **measured over a full eval pass** rather than estimated —
`npm run coach:evals -- --full` prints this per run:

| Model | Calls | Input | Cached read | Output | Cost |
| --- | --- | --- | --- | --- | --- |
| `claude-haiku-4-5` (classifier) | 10 | 13,698 | 0 | 575 | $0.0166 |
| `claude-opus-5` (composer) | 10 | 9,713 | 33,270 | 5,291 | $0.1975 |

**$0.0214 per message → $214/month per 1,000 monthly actives** at 10 messages
each. Two things the measurement corrected against the estimate:

- **Output length dominates.** The composer averages 529 output tokens, not the
  320 modelled — 62% of the bill. `coach.communication.v1.md` asks for "2–5
  short paragraphs"; tightening that is the single biggest lever, and it is a
  voice decision rather than an engineering one.
- **The classifier prefix never caches.** At ~349 tokens it is under the
  ~1,024-token minimum, so `cached read` is 0 for Haiku and always will be.
  It costs $0.0017 a message, so padding the prompt to reach the threshold would
  be worse than leaving it.

The composer prefix does cache — 33,270 cached reads against 9,713 fresh input
in that run, and it stays warm across athletes because the prefix is identical
for all of them. Trimming engine objects before the model sees them
(`trimDecision`) keeps the fresh half small; both are tested for.

Coach degrades rather than fails. With no key, no network, or past the monthly
per-athlete cap, `coachRepo` returns null and the local deterministic answers
stand — which is the fallback the orchestration spec asks for, and what the app
did before the LLM existed.

**Running it**

```bash
npm run coach:evals -- --dry             # routing + checks, no API calls
npm run coach:evals                      # + the real classifier (~$0.02)
npm run coach:evals -- --repeat 3        # classification stability — use this in CI
npm run coach:evals -- --full            # + the composer (~$0.21)
npm run functions:check                  # deno check — the edge runtime's own typecheck
supabase secrets set ANTHROPIC_API_KEY=… # for the deployed function
```

The key lives in the repo-root `.env` (gitignored), which `coach:evals` loads
itself. Not `apps/mobile/.env` — Metro compiles that one into the app bundle.

**Classification is not deterministic.** A single pass showed one case failing
that eighty subsequent calls did not reproduce. `--repeat N` runs each case N
times and fails a case whose intent is unstable across them, which is the only
honest way to read a green run: one pass proves a case *can* pass.

`npm test` deliberately excludes `functions:check` so the suite runs without Deno
installed. CI should run both — Node's tests cover `_shared` and the packages,
but the edge functions run on Deno, and only `deno check` sees their import
paths and runtime APIs.

One deliberate deviation from `coach-context.schema.json`: `athlete.flags` does
not carry return-to-training considerations. They are marked SENSITIVE in the
schema and constrain the engine server-side; Coach sees their *effect* as an
`IMPACT_REDUCTION` reason code instead of the labels. Revisit behind an explicit
permission.

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

- **Recovery check-in (D20 / FR-015) has no write path.** `recovery_checkins`
  exists and is read by `today`, `adapt` and `coach`, but nothing in the app
  writes a row, so self-reported sleep is null for a signed-in athlete and
  Today shows its neutral state. The seeded build still shows the athlete's
  value. Sleep is the only check-in field wired end to end; energy, stress,
  soreness and motivation are read server-side and never collected.
- **Comparable-session trends have no source.** `get_performance_trends` returns
  null server-side because split-level history is not captured yet, so Coach
  says it lacks the data rather than estimating from session RPE. The trend card
  on the client still renders from the seeded set.
- **Coach responses are not streamed.** The reply arrives whole (~2–4s). The
  card renders immediately from the engine, so the wait is on prose only.
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
