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
  - [ ] Both linked from Settings › Account `[code]`
  - [ ] Both linked on, or next to, the paywall (guideline 3.1.2) `[code]` `[ops]`
  - [ ] Privacy policy URL entered in App Store Connect `[ops]`
- [ ] **Privacy manifest declares what is collected** `[code]`
  `ios/PIVOT/PrivacyInfo.xcprivacy` lists no collected data types today. Declare:
  - [ ] Email address and user ID (account)
  - [ ] Fitness / health data: training history, check-ins, sleep, symptoms, postpartum status
  - [ ] Product interaction (Amplitude events)
  - [ ] Purchase history (RevenueCat)
  - [ ] Health data from HealthKit, if it ships (section 4)
- [ ] **App Store Connect privacy questionnaire** matches the manifest `[ops]`
- [ ] **Onboarding Health screen no longer advertises an unbuilt feature** `[code]`
  Either hide `app/(onboarding)/health.tsx` until HealthKit ships, or ship
  HealthKit (section 4). Placeholder features invite a 2.1 rejection.

## 2. Should be done before submitting

- [ ] **Health and medical disclaimer** `[you]` `[code]`
  "Not medical advice; check with a clinician" wording in onboarding (near
  symptoms, injury, postpartum) and in Coach. Guideline 1.4.1.
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
  - [ ] Production Supabase has every migration applied (through `0026`) and the seed loaded
  - [ ] Coach function has its model API key and limits configured
- [ ] **Native project in sync** `[code]`
  `ios/` is committed, so EAS builds from it and `app.json` changes do not
  reach the build without `expo prebuild`. Confirm Info.plist, entitlements and
  the privacy manifest are what ships.
- [ ] **Account deletion verified on production** `[ops]`
  Settings › Account › Delete account removes the auth user and all rows.
- [ ] **Coach reliability** `[ops]` `[code]`
  Find why the server Coach falls back to "Quick answer"; reviewers will use Coach.
- [ ] **Further Coach testing** `[you]`

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

Discovery, recommendation and estimate: `docs/apple-health-discovery.md`.

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
