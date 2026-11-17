# Analytics events (Amplitude)

Every event the app sends, where it fires, and what it carries. The source of
truth is the `AnalyticsEvent` type in `apps/mobile/src/lib/analytics.ts`: an
event or property not listed there cannot be sent.

**Never sent:** email, name, Coach message text, symptom names, considerations,
raw sleep or soreness values (only bands), or setting values (only which
setting changed). Users are identified by their account ID only.

Amplitude also records **sessions and app open/close** automatically. Automatic
screen views and tap capture are off on purpose.

## Account

| Event | Fires when | Properties |
|---|---|---|
| `account_created` | Sign-up succeeds | `needs_confirmation` |
| `sign_up_existing_account` | Sign-up with an email that already has an account | |
| `email_confirmed` | The six-digit confirmation code is accepted | |
| `signed_in` | Email + password sign-in succeeds | |
| `signed_out` | Log out (sent before the identity is cleared) | |
| `account_deleted` | Account deletion succeeds | |
| `password_reset_requested` | "Email me a code" on Forgot password | |
| `password_reset_completed` | Code accepted and new password set | |

## Onboarding

| Event | Fires when | Properties |
|---|---|---|
| `onboarding_started` | A signed-in user with no plan enters setup | `source` |
| `onboarding_step_viewed` | Each intro scene (`intro_1`…) and each setup screen (`goal`, `race`, `experience`, `equipment`, `availability`, `preferences`, `ready`, `plan_ready`) | `step`, `step_number` |
| `onboarding_completed` | The plan is created | `sport`, `race_added`, `health_connected` |

Funnel: `account_created` → `email_confirmed` → `onboarding_step_viewed` (intro → … → `plan_ready`) → `paywall_viewed` (onboarding) → `subscription_confirmed`.

## Subscription

`placement` is where it happened: `onboarding` (the trial offer after the plan),
`settings` (Settings › Subscription) or `lapsed` ("Your plan is waiting").

| Event | Fires when | Properties |
|---|---|---|
| `paywall_viewed` | RevenueCat's paywall was shown | `placement` |
| `paywall_closed` | It closed | `placement`, `result` (`purchased` / `restored` / `cancelled` / `error`) |
| `subscription_confirmed` | The server confirmed access after a purchase, restore, code or existing subscription | `placement`, `via` |
| `restore_attempted` | Restore tapped | `placement`, `outcome` |
| `offer_code_opened` | "Have a code? Redeem it" opened Apple's sheet | `placement` |
| `manage_subscription_opened` | "Manage in the App Store" | |

What Apple charged (trial started, converted, renewed, cancelled, refunded, with
revenue) comes from **RevenueCat's Amplitude integration**, not from the app:
RevenueCat › Integrations › Amplitude. RevenueCat and Amplitude both use the
account ID, so those events join the same users.

## Today, adapting and workouts

| Event | Fires when | Properties |
|---|---|---|
| `today_viewed` | Today comes into view | `phase`, `recommendation_family`, `variant` |
| `variant_previewed` | A length tapped on Today's card (preview only) | `from_variant`, `to_variant` |
| `adapt_opened` | Adapt sheet opens | `original_variant` |
| `adapt_input_changed` | An Adapt answer changes | `time_bucket`, `energy_bucket`, `low_impact`, `equipment_change` |
| `adaptation_applied` | A change is committed (Adapt, Start with a previewed length, Plan's Do it today, Coach) | `from_variant`, `to_variant`, `reason_codes` |
| `recovery_checkin_completed` | Check-in saved | `sleep_bucket`, `soreness_bucket`, `symptom_count` |
| `workout_started` | Start | `template_id`, `family`, `variant`, `estimated_minutes` |
| `exercise_substituted` | A movement swapped for the user's kit | `from_exercise`, `to_exercise`, `reason` |
| `workout_step_completed` | Each step in the player | `block_type`, `exercise_id`, `step_index`, `total_steps` |
| `workout_completed` | Finish | `family`, `variant`, `actual_minutes`, `session_rpe`, `ended_early` |
| `workout_abandoned` | Left mid-session | `elapsed_minutes`, `block_index` |
| `supplemental_started` | An optional add-on session started | `template_id` |

## Progress, Coach and other screens

| Event | Fires when | Properties |
|---|---|---|
| `readiness_viewed` | Progress opens | `confidence`, `component_lowest` |
| `screen_viewed` | `plan`, `coach`, `profile`, `history`, `session_detail`, `readiness`, `capability`, `settings`, `subscription_ended`, `trial_offer` come into view | `screen`, `detail` (settings page or capability key) |
| `coach_message_sent` | A Coach question is sent | `intent` (category, never the text) |
| `coach_action_applied` | A Coach suggestion is applied | `action_type` |
| `coach_fallback` | The server Coach did not answer | `reason`, `status` |
| `tour_started` | The app tour starts (first time, or replayed from Profile) | |
| `tour_finished` | The tour ends | `completed`, `step` |
| `setting_changed` | A Profile setting saved | `setting` (which one, never its value) |

## Defined, not yet sent

`health_connection_started`, `health_connection_completed`,
`health_connection_failed`: for Apple Health, when it is built.
