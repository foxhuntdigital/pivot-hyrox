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
  - [ ] `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` set for the EAS production profile (without them the app runs on the seeded athlete)
  - [ ] `EXPO_PUBLIC_REVENUECAT_IOS_KEY` set
  - [ ] `EXPO_PUBLIC_AMPLITUDE_API_KEY` set
  - [ ] `EXPO_PUBLIC_PRIVACY_POLICY_URL` set (and `EXPO_PUBLIC_TERMS_URL` if not using Apple's standard EULA)
  - [ ] Production Supabase has every migration applied (through `0026`) and the seed loaded
  - [ ] Coach function has its model API key and limits configured
- [x] **Native project in sync** `[code]`
  `ios/` is committed, so EAS builds from it and `app.json` changes do not
  reach the build without `expo prebuild`. Checked 2026-11-07: bundle ID,
  display name, portrait-only iPhone, light mode, URL schemes, ATS (no
  arbitrary loads), encryption flag and the privacy manifest all match; no
  entitlements are needed yet. Re-check after adding HealthKit or push.
  - [ ] Version: Info.plist says 0.1.0 and the Xcode project's MARKETING_VERSION
    says 1.0. Pick the launch version (1.0.0 suggested) and set both, plus
    `app.json` (section 3) `[you]` `[code]`
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
  - [ ] `COACH_MONTHLY_MESSAGE_LIMIT` (default 200) is the number you want `[you]`
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
- [ ] Version number (`app.json` is `0.1.0`) `[code]`

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
