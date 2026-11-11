# App Store launch checklist

What stands between this repo and an App Store release. Tick items in the PR
that closes them, so the history of this file is the history of the launch.

`[code]` can be done in the repo. `[ops]` is App Store Connect, RevenueCat,
EAS or Supabase configuration. `[you]` needs a decision or content from the
team.

Last reviewed: 2026-11-07.

## 1. Review blockers

Likely rejections if submitted as-is.

- [ ] **Privacy policy and Terms of Use (EULA) links in the app** `[you]` `[code]`
  - [x] Privacy policy published at a public URL `[you]`
  - [x] Terms of Use published, or Apple's standard EULA chosen `[you]`
  - [x] Both linked from Settings › Account `[code]` (privacy link appears once `EXPO_PUBLIC_PRIVACY_POLICY_URL` is set; terms default to Apple's standard EULA unless `EXPO_PUBLIC_TERMS_URL` is set)
  - [x] Both linked on the app's own subscription screen `[code]`
  - [ ] Both shown on the RevenueCat paywall (dashboard paywall settings) `[ops]`
  - [ ] Privacy policy URL entered in App Store Connect `[ops]`
- [x] **Privacy manifest declares what is collected** `[code]`
  `ios/PIVOT/PrivacyInfo.xcprivacy`, mirrored in `app.json` › `ios.privacyManifests` so a prebuild keeps it. Declared, all linked to the user, none used for tracking:
  - [x] Crash data and performance data (Sentry)
  - [x] Email address, name and user ID (account)
  - [x] Device ID (Amplitude)
  - [x] Coach messages (other user content)
  - [x] Fitness / health data: training history, check-ins, sleep, symptoms, postpartum status
  - [x] Product interaction (Amplitude events)
  - [x] Purchase history (RevenueCat)
  - [ ] Health data from HealthKit, if it ships (section 4)
- [ ] **App Store Connect privacy questionnaire** matches the manifest `[ops]`
  Same eleven types: account (email, name, user ID), device ID, health, fitness,
  other user content, product interaction, purchase history, crash data,
  performance data. All linked to the user, none used for tracking.
- [x] **Onboarding Health screen no longer advertises an unbuilt feature** `[code]`
  Hidden: availability goes straight to preferences, onboarding is 7 steps.
  `app/(onboarding)/health.tsx` says how to put it back when HealthKit ships.

## 2. Should be done before submitting

- [x] **Health and medical disclaimer** `[code]`
  Onboarding ("Anything to train around?", step 3) and Coach home. Guideline 1.4.1.
  - [x] Wording approved `[you]`
- [ ] **Subscriptions work end to end** `[ops]`
  - [x] Products created in App Store Connect and attached to the version
  - [x] RevenueCat offering and paywall configured; paywall shows price, length, renewal terms
  - [x] Sandbox purchase grants access in the app (2026-11-11; on that build only via Restore, fixed in the next build: the screen now waits for the webhook)
  - [x] `revenuecat-webhook` receives and applies the sandbox events
  - [ ] RevenueCat paywall's own Restore button has its action set to Restore purchases `[ops]`
  - [ ] Restore works on a second device
  - [ ] Cancel / expiry removes access
- [ ] **Beta comp access closed** `[ops]` `[code]`
  Migration `0019_beta_access.sql` gives every new signup free access
  (`product_id = 'beta_comp'`), which is why no paywall appears. A reviewer
  who signs up would be comped too and never reach the paywall: a 2.1 rejection.
  - [x] New grants stopped: `update public.app_config set beta_open = false, updated_at = now();` `[ops]` (2026-11-11)
  - [x] Paywall seen on a fresh signup after that, with real prices `[ops]`
  - [x] Existing beta testers (2 accounts) keep their comps to their end date. Decided: their comps run to their
    `current_period_end` unless deleted, and deleting one makes the server
    refuse that tester's requests (402) until they subscribe `[you]`
  - [ ] Remove the grant from the signup trigger with a migration (0019's own
    instructions: restore 0004's function body) `[code]`
- [ ] **Demo account for App Review** `[ops]`
  Email/password login with an active plan, so Today, Plan and Coach show
  real content. Entered in App Review notes, with how to reach the paywall.
- [ ] **Production build configuration** `[ops]`
  - [x] `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` set for the EAS production profile (without them the app runs on the seeded athlete)
  - [x] `EXPO_PUBLIC_REVENUECAT_IOS_KEY` set
  - [x] `EXPO_PUBLIC_AMPLITUDE_API_KEY` set
  - [x] `EXPO_PUBLIC_PRIVACY_POLICY_URL` set (and `EXPO_PUBLIC_TERMS_URL` if not using Apple's standard EULA)
  - Confirmed in the EAS dashboard and with `eas env:list --environment production` on 2026-11-09. `eas.json` pins each build profile to its environment.
  - [x] First production build (2026-11-11): real accounts (sign-up and confirmation by code work), and the Privacy Policy and Terms links open the live pages
  - [x] Paywall shows real prices, with no "Test store build" note `[ops]`
    - 2026-11-11: no paywall appeared on the first production build. Expected until the subscription products, Paid Apps agreement and RevenueCat offering below are set up
  - [x] Production Supabase has every migration applied (through `0026`) and the seed loaded
  - [x] `content` is in the Data API's exposed schemas (the workout library lives there)
  - Migrations at `0026` and exposed schemas confirmed in the dashboard on 2026-11-09.
  - [x] All 14 Edge Functions deployed: adapt, athlete-capacity, coach, complete-workout, history, onboarding-plan, progress, recovery-checkin, replan-week, reshape-week, revenuecat-webhook, start-workout, supplemental, today
  - [x] Function secrets set:
    - [x] `ANTHROPIC_API_KEY`
    - [x] `REVENUECAT_WEBHOOK_SECRET`, same value as the Authorization header on RevenueCat's webhook
  - [x] RevenueCat webhook points at `https://urmdsasiqizuuszhikcz.supabase.co/functions/v1/revenuecat-webhook` (production and sandbox, all events); RevenueCat's test event returned 200 on 2026-11-09
  - [x] Auth: email sign-in on; URL configuration has `pivot://` as site URL and redirect URL; confirm email **on** and secure email change on (2026-11-09; the repo's local `config.toml` still has confirmations off, which only affects local development)
  - [x] Custom SMTP configured, so password-reset emails reach athletes (Supabase's built-in sender is for testing only) — using Postmark
  - [x] Reset Password email template includes `{{ .Token }}`: the app resets by six-digit code, not by link (`src/state/session.tsx`)
  - [x] Email rate limit raised for launch (Authentication › Rate Limits)
  - [x] Leaked-password protection on (a Pro feature)
  - [x] Tested: "Forgot password" in the app delivers a code from your own sender, and the code sets a new password (2026-11-09, ashley@foxhuntdigital.com)
  - [x] Postmark account approved (out of Test mode) on 2026-11-10 `[ops]`
  - [x] Confirm signup email template includes `{{ .Token }}`: the app confirms by six-digit code too (needs a build with commit "Sign-up confirmation by code") `[ops]`
  - [x] Confirm-signup email tested with a fresh account `[ops]`
  - [x] Project on a paid plan, so it is not paused for inactivity and has daily backups
    (Fox Hunt Digital moved to Pro on 2026-11-09)
  - [x] Coach function has its model API key and limits configured (key rotated 2026-11-09; 200 messages a month)
- [x] **Native project in sync** `[code]`
  `ios/` is committed, so EAS builds from it and `app.json` changes do not
  reach the build without `expo prebuild`. Checked 2026-11-07: bundle ID,
  display name, portrait-only iPhone, light mode, URL schemes, ATS (no
  arbitrary loads), encryption flag and the privacy manifest all match; no
  entitlements are needed yet. Re-check after adding HealthKit or push.
  - [x] Launch version 1.0.0 in Info.plist, the Xcode project's
    MARKETING_VERSION and `app.json`. The build number is managed by EAS
    (`appVersionSource: remote`, `autoIncrement`). `[you]` `[code]`
- [x] **Account deletion verified on production** `[ops]` (2026-11-11)
  Settings › Account › Delete account removes the auth user and all rows.
- [x] **Coach reliability** `[ops]` `[code]`
  Find why the server Coach falls back to "Quick answer"; reviewers will use Coach.
  - [x] The app reports why, as the Amplitude event `coach_fallback` with
    `reason`: `timeout`, `offline`, `monthly_limit`, `server_unconfigured`
    (no `ANTHROPIC_API_KEY`), `unauthorized`, `server_error`, `bad_response`,
    `app_unconfigured`. Also logged to the console in development. `[code]`
  - [x] An athlete over the monthly limit is told so instead of a bare
    "Quick answer" `[code]`
  - [x] Causes found and fixed `[ops]`: the API key was not attached to the
    Anthropic account (rotated 2026-11-09), then the account had no credits
    (Sentry caught `credit balance is too low` on the first production build;
    credits added 2026-11-11). Coach answered the EMOM question on that build.
  - [ ] Auto-reload on and a monthly spend limit set in the Anthropic Console `[ops]`
  - [x] Monthly Coach limit stays at the default 200 (`COACH_MONTHLY_MESSAGE_LIMIT` unset, or set to 200) `[you]`
- [ ] **Further Coach testing** `[you]`

### Where these settings live

- **EAS (builds and build-time settings):** sign in at https://expo.dev with
  the Expo account that owns the project, open the project **pivot** (project
  ID `15177b35-c97f-4a05-9006-f34a83a0b0a8`, from `app.json`), then
  **Environment variables**, environment **production**. Or from a terminal in
  `apps/mobile`: `npx eas-cli whoami`, then
  `npx eas-cli env:list --environment production`. The local `.env` is
  gitignored and does not reach cloud builds; the values must be in EAS.
- **Supabase:** dashboard › project › **Edge Functions › coach › Logs** for
  Coach failures; **Edge Functions › Secrets** for `ANTHROPIC_API_KEY` and
  `COACH_MONTHLY_MESSAGE_LIMIT`; **SQL editor** for the migration check:
  `select version from supabase_migrations.schema_migrations order by version desc limit 5;`
  (the newest should be `0026`, if migrations are applied with the Supabase CLI).

## 3. Store listing

- [ ] App name, subtitle, description, keywords `[you]`
- [ ] Screenshots for 6.9" and 6.5" iPhones `[you]`
- [ ] Support URL and marketing URL `[you]`
- [ ] Age rating questionnaire `[ops]`
- [ ] Category (Health & Fitness) `[ops]`
- [x] Version number: 1.0.0 `[code]`

## 4. Apple Health (optional for launch)

Not required by Apple. If it is not in the first release, close the last item
of section 1 by hiding the onboarding screen.

- [ ] HealthKit library, entitlement and usage strings `[code]`
- [ ] Connect in onboarding `[code]`
- [ ] Connect / disconnect / reconnect in Settings `[code]`
- [ ] Read resting HR, HRV, sleep into `health_daily_metrics` `[code]`
- [ ] Write completed sessions as workouts `[code]`
- [ ] Live heart rate on the workout player `[code]` — needs a heart-rate source decision: Apple Watch samples, Bluetooth strap, or a Watch app
- [ ] HealthKit data excluded from analytics; privacy policy and manifest updated `[code]` `[you]`

## 5. Known debt that does not block release

- [ ] Dumbbell-only coverage: recovery-domain primary sessions need authoring
  (`expected-failures.json`) `[you]`
- [ ] Real descriptions for the 148 templates whose placeholder was cleared `[you]`
- [x] Crash reporting: Sentry in the mobile app, project `pivot-mobile` `[code]`
  - [x] `EXPO_PUBLIC_SENTRY_DSN` in the EAS **production** environment (Plain
    text). Without it the app's Sentry `init` is a no-op and builds report nothing `[ops]`
  - [x] Production stack traces: set `SENTRY_AUTH_TOKEN` in the EAS build env
    (visibility **Secret**) so source maps and dSYMs upload `[you]`
  - [x] Privacy manifest declares crash data and performance data (Sentry) `[code]`
  - [x] Edge Functions reporting verified: the first production build's Coach error reached Sentry (2026-11-11)
  - [x] Verified on the first production build: traces arrive  in `pivot-mobile` and `pivot-functions` (environment production), and source maps/debug files show an upload `[ops]`
  - [x] Edge functions report to Sentry, project `pivot-functions` (5xx only;
    4xx are answers, not incidents) `[code]`
  - [x] Set the functions' `SENTRY_DSN`: `supabase secrets set SENTRY_DSN=...`
    and `SENTRY_ENVIRONMENT=production`. Until then `init` is a no-op `[you]`
- [ ] README "Known gaps" is stale (onboarding is built) `[code]`
