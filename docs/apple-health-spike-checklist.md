# Apple Health device spike: test checklist

Branch: `spike/apple-health` (throwaway; nothing here ships).
Device: iPhone 16 Pro Max on iOS 27, plus your Apple Watch, a chest strap and,
if you have them, AirPods Pro 3 or Powerbeats Pro 2.
Time: about 1–1.5 hours, mostly wearing things and moving.

Answers the open questions in `docs/apple-health-discovery.md`, sections 1 and 3.

## Build and open it (about 15 min plus build time)

1. From `apps/mobile` on the spike branch: `npm install`, then
   `eas build --profile development --platform ios`.
   - The development profile uses EAS's `latest` image, because the zone code
     needs the iOS 27 SDK (Xcode 27). If the build fails in
     `PivotHealthSpikeModule.swift` on a zone type, send me the error.
   - EAS should turn on the HealthKit capability for `com.adaptiveathlete.pivot`
     when it sees the new entitlement. If the build says the profile lacks
     HealthKit, tick HealthKit for that App ID in the Apple developer portal
     and rebuild.
   - If the phone isn't registered for internal builds: `eas device:create`.
2. Install the build, run `npx expo start --dev-client`, open the app, and sign
   in as an athlete who has finished onboarding.
3. Open the test screen: type `pivot://health-spike` in Safari (or tap it in
   Notes). The header shows the iOS version and "iPhone session yes · zones yes".

Tap the note buttons (or type a note) whenever something happens. Every note is
timestamped into the log, which is how I line up what you did with the data.

## A. Access (2 min)

1. **Request access.** The Health sheet appears. Turn everything on and allow.
2. Check the status line: `write workouts: sharingAuthorized`, `write HR: sharingAuthorized`.
3. Tap **Request access** again. Expected: no sheet, and the status says
   `prompt: unnecessary`.

## B. Your zones (1 min)

1. **My preferred zones.** The log shows `preferred_zones` with its source
   (`system` or `user`) and the bpm boundaries.
2. Note whether you've ever set zones by hand in the Workout app or Health.

## C. Chest strap, live (10 min)

1. Pair the strap in **Settings › Bluetooth**. Note whether it shows up there at
   all, or whether you had to pair it somewhere else (Fitness app, Health).
   Note exactly what you did.
2. Back in the test screen: pick `functionalStrength`, tap **Start**.
   - The first time, iOS should show its own prompt about workout data while
     the phone is locked. Note what it says and allow it.
3. Watch **Live (session)**. Expected: it updates about every second, with a
   delay of a second or two. Do 30 s of hard effort (tap **Hard effort** first)
   and check the number climbs.
4. Tap **Locking phone**, lock the phone for 2 minutes while moving, unlock,
   come back and tap **Reload**. Look for `live_hr` entries between
   `phone_locking` and `phone_unlocked`.
5. Tap **Strap off**, take the strap off for 30 s, put it back on (**Strap on**).
   Does heart rate come back by itself?
6. **Pause**, wait 20 s, **Resume**.
7. **End + save**. The log shows `session_saved` with avg/max bpm and `zones`.
8. **Workouts, last 6 h**. The PIVOT workout is listed with its source and zones.
   Check it in the Health app too, and whether it counted towards your rings.

## D. Earbuds, live (5 min, if you have AirPods Pro 3 or Powerbeats Pro 2)

1. Strap off. Earbuds in (**Earbuds in**).
2. **Start**, wait 2–3 minutes with some movement, **End + discard**.
3. Did `live_hr` entries arrive? How often?

## E. Apple Watch, no workout running (5 min)

1. Strap and earbuds off. **Start listening** (section 3).
2. Leave it 5 minutes on the screen, unlocked. Then lock it for 2 minutes and
   come back.
3. Expected: `hr_sample` entries a few minutes apart. Each one has `delaySec`
   (how late it reached the phone) and the source/device.

## F. Apple Watch with Apple's Workout app (15 min)

This is the v1 path for Watch owners, so it matters most.

1. On the Watch, start **Functional Strength Training** in Apple's Workout app.
   Tap **Watch workout started**.
2. On the phone, **Start listening** if it isn't already.
3. Train normally for 10 minutes, with a couple of hard efforts (tap
   **Hard effort** each time). Keep the phone unlocked and nearby for the first
   5 minutes. Then lock it for 3 minutes (**Locking phone**) and come back.
4. While the Watch workout is still running, start a PIVOT session too
   (**Start**, no strap). Run both for 2 minutes. Look for a `session_error` or
   anything on the Watch.
5. End the PIVOT session with **End + save**, then end the Watch workout and
   tap **Watch workout ended**.
6. Wait a minute, then **Workouts, last 6 h**. Questions:
   - Are there two workouts for the same time (Watch + PIVOT)?
   - Does the Watch's workout show `zones` (not `none`)?
   - Do the Watch workout's zones match the Workout app's own summary on the Watch or in Fitness?

## G. Send me the results

1. **Share log** and AirDrop or save it, then paste or attach it in the chat.
   It's your own heart-rate data; share it only here.
2. Add anything the log can't show: what the pairing screens said, what the iOS
   lock-screen prompt said, whether the Watch did anything odd.

I'll turn the log into findings in `docs/apple-health-discovery.md` and confirm
or change the heart-rate plan.

## What each question needs from the log

| Question | Look at |
|---|---|
| Strap streams ~1 Hz into an iPhone session | `live_hr` spacing and `delaySec` in C |
| Keeps collecting while locked | `live_hr` between `phone_locking` and `phone_unlocked` |
| `workout-processing` needed | as above; if it fails, a rebuild without it tells us whether it matters |
| Earbuds feed the session | `live_hr` in D |
| Watch → phone delay | `hr_sample.delaySec` in E and F |
| Double workouts | `workout` entries in F |
| Zones on saved workouts (PIVOT and Watch) | `session_saved.zones`, `workout.zones` |
| Live zones on iPhone | `live_zone` entries in C |
