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
scripts/              Seed conversion, fixture build, schema verification
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
booleans (198 conversions). Verified counts: 43 exercises, 34 templates, 102
variants, 103 block exercises, 23 equipment, 8 substitutions, 7 progression
rules — matching the source JSON's own `meta` block.

Content lives in the `content` schema (read-only to authenticated users);
athlete data lives in `public` (owner-only). All 33 tables have RLS enabled.

### Variant vocabulary

The database stores `green` / `yellow` / `red`. The UI renders **Full /
Express / Micro** and never presents them as failure states (§25, §8.1). The
mapping is `VARIANT_LABEL` in the engine.

## Known gaps

Deliberate omissions, not oversights:

- **Coach tab (D21 / FR-020) is not built.** It is P0 in the PRD but absent
  from the design file, which has four tabs where §5 specifies five. The schema
  (`coach_threads`, `coach_messages` with held `proposed_action`) is in place.
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
