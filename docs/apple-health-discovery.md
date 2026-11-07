# Apple Health (HealthKit) discovery

Status: research and recommendation only. Nothing is built yet.
Scope: `docs/launch-checklist.md` section 4. Target: Expo 57, RN 0.86.2 with the
new architecture, committed `apps/mobile/ios/`, deployment target iOS 16.4.

Goal: the athlete can connect Apple Health in onboarding and in
Profile › Settings, disconnect it, reconnect it, and see heart rate on the
workout player (`apps/mobile/app/active.tsx`).

---

## 1. iOS facts: confirmed or corrected

| Claim in the first pass | Verdict | Detail |
|---|---|---|
| An app can't revoke its own permission | **Confirmed** | No API exists. "Disconnect" has to be app-owned: stop reading and writing, and optionally delete what was synced. Only the athlete can remove the grant, in the Health app or in Settings › Privacy & Security › Health › PIVOT. |
| An app can't read whether read access was granted | **Confirmed, with a nuance** | A denied read looks the same as "no data": queries just return nothing. **Write** status *is* readable: `authorizationStatus(for:)` returns `sharingAuthorized` / `sharingDenied` / `notDetermined` for types the app writes. So PIVOT can tell whether it may save workouts, but not whether it may read sleep. |
| The prompt only shows once | **Partly correct** | The sheet shows once **per set of types**. If a later release requests a new type, such as heart rate, the sheet appears again with only the new types. `getRequestStatusForAuthorization` says ahead of time whether calling `requestAuthorization` would show a sheet (`shouldRequest`) or do nothing (`unnecessary`). That lets "Reconnect" choose between showing the sheet and showing instructions. |
| "Connected" is app-owned state | **Confirmed** | Store it per device (AsyncStorage) and mirror a boolean to the profile, so `health_connected` in analytics and the server agree. HealthKit grants are per device, so they don't follow the account to a new phone. |
| Watch HR samples via HealthKit queries are sparse or late without a Watch workout | **Confirmed** | Outside a workout, the Watch records heart rate every few minutes and syncs to the phone with a delay. During a Watch workout, samples arrive every few seconds but still reach the phone late, often 5–30 s or more, depending on Bluetooth and Wi-Fi. That works for a "last seen" number, not for a live readout. |
| **iOS 26: can an iPhone run `HKWorkoutSession` and get live HR from paired sensors?** | **Yes** | iOS 26 (WWDC25 session 322) brings `HKWorkoutSession` and `HKLiveWorkoutBuilder` to iPhone and iPad as **standalone** sessions, not only mirrored from a Watch. Apple says iPhone has no heart-rate sensor, but you can pair "any device that you wear during a workout that supports the heart rate GATT profile, like a wearable heart rate monitor or the Powerbeats Pro 2", and "HealthKit will handle getting heart rate data from the device". **The app writes no Bluetooth code.** It also adds crash recovery (a scene delegate), data access while the phone is locked (a one-time system prompt), Live Activity and Siri support. The builder saves the finished workout, with its heart rate, to Health. |
| (same) …and does a paired Apple Watch feed it? | **No, as far as Apple says** | Apple's guidance for Watch owners is to start the workout on the Watch and mirror it to the phone. A Watch is not described as a sensor for an iPhone session. |
| (same) …AirPods Pro 3? | **Unconfirmed** | Apple names Powerbeats Pro 2. Developers report AirPods Pro 3 heart rate also reaches iPhone workout sessions, but I found no Apple statement. Test on a device. |
| (same) …does any RN library support it? | **No** | `@kingstinct/react-native-healthkit` 16.2.0 (latest, 12 Oct 2026) has `startWatchAppWithWorkoutConfiguration`, `saveWorkoutSample` and workout queries, but no iPhone `HKWorkoutSession` or `HKLiveWorkoutBuilder`. I checked the shipped `src/specs`. It would be a small Swift module of our own (section 4). |

Open items to settle in the device spike (section 4, step 0). Apple's pages
don't state them:

- Whether a Bluetooth strap only has to be paired once in Settings › Bluetooth.
- Whether `UIBackgroundModes` needs `workout-processing` on iOS for a session to survive the lock screen.
- What happens when the athlete also starts a Watch workout: two sessions, and two workouts in Health?

## 2. Library compatibility (Expo 57 / RN 0.86 / new architecture)

| Library | Version (npm, Nov 2026) | Verdict |
|---|---|---|
| `@kingstinct/react-native-healthkit` | 16.2.0, peers `react >=19`, `react-native >=0.79`, `react-native-nitro-modules >=0.35` | **Use it.** Built on Nitro (JSI), which is native to the new architecture. It depends on `@react-native-healthkit/core` 16.2.0. Add `react-native-nitro-modules` 0.37.2. Its Expo config plugin **turns on the background-delivery entitlement by default**. Pass `background: false`, because PIVOT reads on foreground. It doesn't work in Expo Go, which is fine because the app already uses `expo-dev-client`. |
| `react-native-ble-plx` | 3.5.1 (Feb 2026), peers `*` | **Works, not preferred.** It's an old-style bridge module (`RCT_EXPORT_MODULE`), so on RN 0.86 it runs through the new architecture's interop layer. It builds with `install_modules_dependencies`. Its separate config plugin `@config-plugins/react-native-ble-plx` was last published in 2023 for Expo 49, and doesn't matter while `ios/` is committed. It pulls in `MultiplatformBleAdapter` 0.2.0. |
| `react-native-ble-manager` | 13.0.0 (5 Nov 2026) | **Better of the two BLE libraries** if one is needed. It's a real TurboModule (`codegenConfig`, `install_modules_dependencies`) and ships a plugin for `NSBluetoothAlwaysUsageDescription`. |
| Own Swift Expo Module (`apps/mobile/modules/…`) | n/a | **Recommended for heart rate** (section 3). The Expo Modules API supports the new architecture natively. Only one capability is needed, so a ~200-line Swift module beats taking on a BLE library. |

Native-project note: `ios/` is committed and isn't regenerated, so **config
plugins don't run**. Each plugin change has to be hand-applied to
`ios/PIVOT/PIVOT.entitlements` and `ios/PIVOT/Info.plist`, then `pod install`.
Add the same plugin entries to `app.json` so a future `expo prebuild` gives the
same result. Enable the HealthKit capability on the App ID
(`com.adaptiveathlete.pivot`). EAS capability sync or the developer portal can
do it, and the provisioning profile must be regenerated.

## 3. Heart-rate source: recommendation

**Recommendation: iPhone workout session on iOS 26+ (call it option d), with
Apple Watch samples (option a) as the fallback. Drop the plan to build our own
Bluetooth (option b) unless the device spike shows straps don't feed the
session.**

| | (a) Watch samples via query | (b) Own BLE strap code | **(d) iOS 26 iPhone workout session** | (c) watchOS app + mirroring |
|---|---|---|---|---|
| Live? | No, 5–30 s+ late | Yes, ~1 Hz | Yes, ~1 Hz from the sensor | Yes |
| Sources | Apple Watch (any HealthKit HR) | GATT HR straps | GATT HR straps, Powerbeats Pro 2, probably AirPods Pro 3 | Apple Watch |
| OS | 16.4+ | 16.4+ | **26+** (iOS 16.4–25 falls back to a) | 16.4+ phone, watchOS app |
| Our Bluetooth code | none | scan, pick, pair, reconnect, drop-outs | none (system pairing) | none |
| Extra permission | HealthKit read HR | Bluetooth | HealthKit read HR + write workout | HealthKit on both |
| Writes workout to Health | separate work | separate work | **builder does it, with HR** | Watch does it |
| Lock screen | n/a | BLE background mode | system handles it, one-time prompt | n/a |
| Effort | ~1.5 d | 3–4 d | ~3–4 d | 2–4 weeks |

UX tradeoffs:

- **(d) folds two features into one.** A live readout and "write completed sessions to Health" come from the same session. One Health connection covers both, so there's no second (Bluetooth) permission to explain. Pairing a strap happens in iOS Settings, where athletes have already paired it for Apple Fitness.
- **(d) needs Health connected to show HR.** That fits the goal: heart rate only appears for athletes who connected Health. It also means a denied heart-rate read looks the same as "no sensor". The player can't tell them apart, so the copy has to cover both (section 5).
- **Apple Watch owners**, likely the largest group, don't get a live number from (d). They get (a): "142 · Watch, 20 s ago". Real live Watch heart rate is option (c), a separate project. Decide after launch from how many athletes are on a Watch.
- **(b) works on older iOS and doesn't need Health**, but PIVOT then owns device pickers, reconnects and battery drain. Keep it as the plan B if the spike shows (d) needs more than one-time system pairing.
- **Don't invent values.** The player already shows "— not connected" (PRD §8.3). Keep that rule: show a number only if a sample is less than ~10 s old (live) or label its age (Watch).

## 4. Implementation plan

**Step 0 — device spike (0.5 d).** iPhone on iOS 26, plus a chest strap and,
if available, AirPods Pro 3 / Powerbeats Pro 2 and an Apple Watch. A throwaway
Swift snippet starts an `HKWorkoutSession` with `HKLiveWorkoutDataSource` and
logs `didCollectDataOf` heart-rate statistics. Settle the open items in
section 1. If straps don't stream, switch the heart-rate work to (b) with our
own CoreBluetooth module or `react-native-ble-manager`, at the same estimate.

**Step 1 — HealthKit setup (1 d)**
- `apps/mobile/package.json`: add `@kingstinct/react-native-healthkit@16.2.0`, `react-native-nitro-modules@0.37.2`.
- `apps/mobile/app.json`: add the plugin with `background: false` and the usage strings (section 5).
- `apps/mobile/ios/PIVOT/PIVOT.entitlements`: add `com.apple.developer.healthkit` = true and `com.apple.developer.healthkit.access` = [].
- `apps/mobile/ios/PIVOT/Info.plist`: add `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` (plus `UIBackgroundModes` › `workout-processing` if the spike shows it's needed).
- `apps/mobile/ios/Podfile.lock`: `pod install`. Developer portal: enable the HealthKit capability.

**Step 2 — connection state (1 d)**
- New `apps/mobile/src/lib/health.ts`: the only file that imports the library. It exposes `isAvailable()`, `requestAccess()`, `requestStatus()`, `canSaveWorkouts()` (write status), `latestHeartRate()`, and later the daily reads. Every function returns a "not available" result on Android, iPad without Health, or when the module is missing, so nothing else branches on platform.
- New `apps/mobile/src/state/health.tsx` (or a slice of `state/store.tsx`): `connected` (app-owned, AsyncStorage), `promptShown`, `lastDataSeenAt`, `writeStatus`. Mirror `connected` to the profile row so the server knows; this needs a small profile field or migration.
- One requested type set, defined once: read `heartRate`, `restingHeartRate`, `heartRateVariabilitySDNN`, `sleepAnalysis` (plus `workoutType` if "workouts you record elsewhere" stays); write `workoutType` and `heartRate` (for the builder). Ask for everything in one sheet. Splitting it means the second sheet appears at a surprising moment.

**Step 3 — onboarding and Settings UI (2–2.5 d)**
- `apps/mobile/app/(onboarding)/health.tsx`: replace the "Not yet available" box with Connect / Not now. Set `health_connected` in `src/state/onboarding.tsx` from the real result. That field already feeds `onboarding_completed`.
- `apps/mobile/src/components/profile/SettingsPages.tsx`: add `'apple-health'` to `PAGES`, plus an `AppleHealthPage` in `BODIES` with the states in section 5. Leave the existing `health` page ("Things to train around") as it is, and keep the two rows clearly separate.
- The Profile list (wherever the rows to `/settings/[page]` are defined) gets an "Apple Health" row with a Connected / Off value.

**Step 4 — live heart rate on the player (3–4 d with d; +1 d for fallback a)**
- New local Expo module `apps/mobile/modules/pivot-workout-session/`: Swift module with `start(activityType)`, `pause`, `resume`, `end(save: boolean)`, `discard`, and an `onHeartRate({ bpm, at })` event. It's guarded by `if #available(iOS 26, *)` and reports `unsupported` below that. It uses `HKLiveWorkoutBuilderDelegate.didCollectDataOf` → `statistics(for: heartRate).mostRecentQuantity()`. Use activity type `.functionalStrengthTraining` or `.crossTraining` for HYROX sessions, decided in the spike. Crash recovery through the new scene delegate is v2. In v1, a crash loses the in-progress Health workout but not PIVOT's own session data.
- `apps/mobile/app/active.tsx` (the slot at ~line 312): a `useHeartRate()` hook in `src/lib/health.ts` that uses the session on iOS 26+, otherwise anchored `heartRate` queries (fallback a). It shows a number with a freshness rule and keeps "— not connected" / "— no sensor" otherwise. Start the session with `workout_started`, mirror pause and resume, and end it at completion. **Discard it when the athlete abandons the session.**
- When writing, be careful not to double-log. The athlete may also run a Watch workout. Settle this in the spike, and at least skip PIVOT's write if a Watch workout overlaps.

**Step 5 — write completed sessions (0.5 d on iOS 26 via the builder; 1 d below 26 via `saveWorkoutSample`)**
- Hook into the existing completion path (`complete-workout` call site in the app) so a save that failed or was abandoned never writes to Health.

**Step 6 — read side into `health_daily_metrics` (3–5 d, as first estimated)**
- On app foreground, read the last 7 days: daily `restingHeartRate`, overnight `heartRateVariabilitySDNN` average, and sleep minutes. For sleep, merge overlapping `asleepCore` / `asleepDeep` / `asleepREM` / `asleepUnspecified` samples across sources and count each minute once. That's the fiddly part. Upsert with `source = 'apple_health'` (unique key `user_id, local_date, source`). Writes go through a new edge function or RLS-checked insert, and never overwrite self-reported rows (PRD §11.1, already the schema's rule).
- `supabase/functions/today/index.ts` (~line 357) and `packages/engine/src/readiness.ts` (`recovery_signal`): prefer connected sleep and RHR/HRV when present, and carry `source: 'connected'`. The client types `todayRepo.ts` and `store.tsx` already allow `'connected'`.
- "Workouts you record elsewhere", promised by the onboarding copy: +1–2 d (query workouts, exclude `currentAppSource()`, map them to recent sessions). **Either build it or remove it from the copy.**

**Step 7 — privacy (1 d code + your decisions)**
- `apps/mobile/ios/PIVOT/PrivacyInfo.xcprivacy`: add `NSPrivacyCollectedDataTypeHealth` and `…Fitness`, linked to the user, not tracking, purpose App Functionality. Section 1 of the launch checklist already lists this.
- `apps/mobile/src/lib/analytics.ts`: no HealthKit-derived value in any event. `sleep_bucket` (from `store.tsx:976`) must stay **self-reported only**. Add a header-comment rule. If you want `health_connected` / `health_disconnected` events, they need a PRD §16 change first, because the taxonomy is fixed there.
- **Decision needed: Coach.** `supabase/functions/coach/index.ts` sends `sleep_hours` and readiness to the LLM provider. Once those can come from HealthKit, that's HealthKit data reaching a third party. Guideline 5.1.3 limits HealthKit disclosure, and 5.1.2(i) requires disclosure and consent for sharing with third-party AI. Options: keep Coach on self-reported values only (recommended for launch), or add explicit consent and privacy-policy language.
- Privacy policy and App Store text: say HealthKit is used and what's read and written. HealthKit apps must identify the integration in the UI and marketing text. No HealthKit data goes in iCloud or to advertising.

**Step 8 — device QA (1–1.5 d).** Grant all, deny all, partial, revoke in Health, reinstall, new phone, iPad (Health exists on iPadOS 17+), iOS 25 device (fallback path), strap disconnected mid-session, phone locked mid-session.

### Revised estimate

| Work | First pass | Revised |
|---|---|---|
| Device spike | — | 0.5 d |
| Setup (library, entitlement, strings, native project) | 1 d | 1 d |
| Connection state + connect/disconnect/reconnect UI | 2–3 d | 3–3.5 d (state 1 + UI 2–2.5) |
| Privacy | 1 d | 1 d + Coach decision |
| Live HR | (b) 3–4 d | (d) 3–4 d + (a) fallback 1 d |
| Write workouts | 1 d | 0.5–1 d |
| Read side (RHR / HRV / sleep → table → engine) | 3–5 d | 3–5 d (+1–2 d for "workouts elsewhere") |
| Device QA | — | 1–1.5 d |
| **Goal only** (connect, disconnect, reconnect, HR on player) | ~7–9 d | **~10–12 d** |
| **Everything the onboarding screen promises** | ~11–15 d | **~14–19 d** |

If section 4 is cut from the first release, the cheapest honest option is the
one the checklist already names: hide `(onboarding)/health.tsx`.

## 5. Copy and states

The tone follows the existing screen: plain, says exactly what's read and
written, and never claims a connection it can't verify.

### Info.plist

- `NSHealthShareUsageDescription`: "PIVOT reads your resting heart rate, heart-rate variability, sleep and heart rate during sessions to adjust your training and show your heart rate while you work out."
- `NSHealthUpdateUsageDescription`: "PIVOT saves the sessions you complete, with their heart rate, so your Activity rings and Health history stay accurate."

### Onboarding (`(onboarding)/health.tsx`)

- Title: **"Connect Apple Health"**
- Description: "Optional. Your plan works without it. You choose exactly what PIVOT can see on the next screen, and you can change it any time in the Health app."
- Keep the READS / WRITES lists as they are, adding "Heart rate during sessions, shown live with a chest strap or compatible earbuds" (iOS 26+). Remove the workouts line if step 6's extra isn't built.
- Buttons: primary **"Connect Apple Health"**, secondary **"Not now"**.
- After the sheet closes, PIVOT can't tell what was allowed, so it says: "Connected. If you turned anything off, PIVOT simply won't see it. Change it any time in Health › Profile › Apps › PIVOT." Then Continue.
- Health unavailable (iPad without Health, or Android): skip the step.

### Settings › Apple Health (`AppleHealthPage`)

| State | How it's detected | Shown |
|---|---|---|
| Not available | `isHealthDataAvailable()` false | "Apple Health isn't available on this device." No buttons. |
| Off, never asked | `connected` false, `requestStatus` = `shouldRequest` | Title "Apple Health" · "Off" · what it reads and writes · **Connect Apple Health** |
| On | `connected` true, data seen in the last 7 days | "Connected" · "Last data from Health: today, 7:02" · reads/writes list · **Disconnect** |
| On, nothing seen | `connected` true, no samples for 7 days | "Connected, but PIVOT hasn't seen any health data for a week. If you turned access off, or don't wear a device that records it, there's nothing to read." · how-to-change line · **Disconnect** |
| On, saving off | write status `sharingDenied` | Inline: "Saving workouts is off. PIVOT can't add sessions to Health until it's turned on in Health › Profile › Apps › PIVOT." |
| Off after disconnect | `connected` false, `requestStatus` = `unnecessary` | "Off. PIVOT isn't reading or saving anything." · **Reconnect** |

- **Disconnect** confirm dialog (`useDialog`): eyebrow "Apple Health", title "Disconnect Apple Health?", body "PIVOT stops reading and saving now. Data already synced stays in your plan history unless you remove it. iOS keeps the permission itself; to remove it, go to Health › Profile › Apps › PIVOT." Actions: "Disconnect", "Disconnect and remove synced data", "Cancel".
- **Reconnect**: if `requestStatus` = `shouldRequest`, show the sheet; otherwise flip on and say "Reconnected, with the access you chose before. To change it, go to Health › Profile › Apps › PIVOT." iOS has no public deep link to that page. Don't send people to `app-settings:` and imply it's there.

### Workout player heart-rate slot (`active.tsx`)

| State | Value | Small label |
|---|---|---|
| Health not connected | — | not connected |
| Connected, iOS 26+, live sample < 10 s old | 142 | bpm |
| Connected, iOS 26+, no sample yet / sensor dropped | — | no sensor |
| Connected, below iOS 26, recent Watch sample | 142 | Watch · 20 s ago |
| Connected, no recent sample | — | no recent reading |
| Phone locked, data not yet allowed | (hidden) | — (Apple's guidance: show duration only) |

The first time a session starts with Health connected on iOS 26+, iOS shows its
own prompt about workout data while locked. That's expected; no extra PIVOT
copy is needed.

---

## Sources

- Apple, WWDC25 "Track workouts with HealthKit on iOS and iPadOS": https://developer.apple.com/videos/play/wwdc2025/322/
- Apple Developer Forums, HealthKit tag (iOS 26 strap auto-connect reports): https://developer.apple.com/forums/tags/healthkit/?page=6
- Developer reports on AirPods Pro 3 / iPhone sessions (secondary): https://github.com/DuarteSantos8/openGym/issues/818, https://github.com/calbotsman/IronBoi/pull/52
- iPhone `HKWorkoutSession` API availability (secondary): https://aifitnessapi.com/watch-apps/hkworkoutsession-lifecycle-swift, https://www.createwithswift.com/tracking-workouts-with-healthkit-in-ios-apps/
- npm registry metadata and the published package sources of `@kingstinct/react-native-healthkit@16.2.0`, `react-native-ble-plx@3.5.1`, `react-native-ble-manager@13.0.0`, `react-native-nitro-modules@0.37.2`, `@config-plugins/react-native-ble-plx@7.0.0`, inspected directly on 7 Nov 2026.
