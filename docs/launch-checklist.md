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
  - [ ] Privacy policy published at a public URL `[you]`
  - [ ] Terms of Use published, or Apple's standard EULA chosen `[you]`
  - [x] Both linked from Settings › Account `[code]` (privacy link appears once `EXPO_PUBLIC_PRIVACY_POLICY_URL` is set; terms default to Apple's standard EULA unless `EXPO_PUBLIC_TERMS_URL` is set)
  - [x] Both linked on the app's own subscription screen `[code]`
  - [ ] Both shown on the RevenueCat paywall (dashboard paywall settings) `[ops]`
  - [ ] Privacy policy URL entered in App Store Connect `[ops]`
- [x] **Privacy manifest declares what is collected** `[code]`
  `ios/PIVOT/PrivacyInfo.xcprivacy`, mirrored in `app.json` › `ios.privacyManifests` so a prebuild keeps it. Declared, all linked to the user, none used for tracking:
  - [x] Email address, name and user ID (account)
  - [x] Device ID (Amplitude)
  - [x] Coach messages (other user content)
  - [x] Fitness / health data: training history, check-ins, sleep, symptoms, postpartum status
  - [x] Product interaction (Amplitude events)
  - [x] Purchase history (RevenueCat)
  - [ ] Health data from HealthKit, if it ships (section 4)
- [ ] **App Store Connect privacy questionnaire** matches the manifest `[ops]`
  Same nine types: account (email, name, user ID), device ID, health, fitness,
  other user content, product interaction, purchase history. All linked to the
  user, none used for tracking.
- [x] **Onboarding Health screen no longer advertises an unbuilt feature** `[code]`
  Hidden: availability goes straight to preferences, onboarding is 7 steps.
  `app/(onboarding)/health.tsx` says how to put it back when HealthKit ships.

## 2. Should be done before submitting

- [x] **Health and medical disclaimer** `[code]`
  Onboarding ("Anything to train around?", step 3) and Coach home. Guideline 1.4.1.
  - [x] Wording approved `[you]`
- [ ] **Subscriptions work end to end** `[ops]`
  - [ ] Products created in App Store Connect and attached to the version
  - [ ] RevenueCat offering and paywall configured; paywall shows price, length, renewal terms
  - [ ] Sandbox purchase grants access in the app
  - [ ] `revenuecat-webhook` receives and applies the sandbox events
  - [ ] Restore works on a second device
  - [ ] Cancel / expiry removes access
- [ ] **Demo account for App Review** `[ops]`
  Email/password login with an active plan, so Today, Plan and Coach show
  real content. Entered in App Review notes, with how to reach the paywall.
- [ ] **Production build configuration** `[ops]`
  - [x] `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` set for the EAS production profile (without them the app runs on the seeded athlete)
  - [x] `EXPO_PUBLIC_REVENUECAT_IOS_KEY` set
  - [x] `EXPO_PUBLIC_AMPLITUDE_API_KEY` set
  - [x] `EXPO_PUBLIC_PRIVACY_POLICY_URL` set (and `EXPO_PUBLIC_TERMS_URL` if not using Apple's standard EULA)
  - Confirmed in the EAS dashboard and with `eas env:list --environment production` on 2026-11-09. `eas.json` pins each build profile to its environment.
  - [ ] First production build: the app signs in to real accounts, the paywall shows real prices (no "Test store build" note), and the Privacy Policy link opens the live page `[ops]`
  - [x] Production Supabase has every migration applied (through `0026`) and the seed loaded
  - [x] `content` is in the Data API's exposed schemas (the workout library lives there)
  - Migrations at `0026` and exposed schemas confirmed in the dashboard on 2026-11-09.
  - [x] All 14 Edge Functions deployed: adapt, athlete-capacity, coach, complete-workout, history, onboarding-plan, progress, recovery-checkin, replan-week, reshape-week, revenuecat-webhook, start-workout, supplemental, today
  - [x] Function secrets set:
    - [x] `ANTHROPIC_API_KEY`
    - [x] `REVENUECAT_WEBHOOK_SECRET`, same value as the Authorization header on RevenueCat's webhook
  - [x] RevenueCat webhook points at `https://urmdsasiqizuuszhikcz.supabase.co/functions/v1/revenuecat-webhook` (production and sandbox, all events); RevenueCat's test event returned 200 on 2026-11-09
  - [ ] Auth: email sign-in on; URL configuration has `pivot://` as site URL and redirect URL; email confirmation decided (the repo's config has it off)
  - [ ] Custom SMTP configured, so password-reset emails reach athletes (Supabase's built-in sender is for testing only)
  - [x] Project on a paid plan, so it is not paused for inactivity and has daily backups
    (Fox Hunt Digital moved to Pro on 2026-11-09)
  - [ ] Coach function has its model API key and limits configured
- [x] **Native project in sync** `[code]`
  `ios/` is committed, so EAS builds from it and `app.json` changes do not
  reach the build without `expo prebuild`. Checked 2026-11-07: bundle ID,
  display name, portrait-only iPhone, light mode, URL schemes, ATS (no
  arbitrary loads), encryption flag and the privacy manifest all match; no
  entitlements are needed yet. Re-check after adding HealthKit or push.
  - [x] Launch version 1.0.0 in Info.plist, the Xcode project's
    MARKETING_VERSION and `app.json`. The build number is managed by EAS
    (`appVersionSource: remote`, `autoIncrement`). `[you]` `[code]`
- [ ] **Account deletion verified on production** `[ops]`
  Settings › Account › Delete account removes the auth user and all rows.
- [ ] **Coach reliability** `[ops]` `[code]`
  Find why the server Coach falls back to "Quick answer"; reviewers will use Coach.
  - [x] The app reports why, as the Amplitude event `coach_fallback` with
    `reason`: `timeout`, `offline`, `monthly_limit`, `server_unconfigured`
    (no `ANTHROPIC_API_KEY`), `unauthorized`, `server_error`, `bad_response`,
    `app_unconfigured`. Also logged to the console in development. `[code]`
  - [x] An athlete over the monthly limit is told so instead of a bare
    "Quick answer" `[code]`
  - [ ] Read the reasons (Amplitude, or the `coach` function logs in Supabase)
    and fix the cause `[ops]`
    - 2026-11-09: the Nov 7 logs had expired (free plan keeps one day). The
      Anthropic console showed the API key was not attached to the account, so
      the key was rotated and the new one saved in Supabase. Likely cause; still
      to confirm with a fresh Coach question that answers without "Quick answer".
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
- [ ] Crash reporting (e.g. Sentry) `[code]`
- [ ] README "Known gaps" is stale (onboarding is built) `[code]`
