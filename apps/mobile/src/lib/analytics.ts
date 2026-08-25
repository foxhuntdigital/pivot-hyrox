/**
 * Product analytics (PRD §16).
 *
 * The event taxonomy is not invented here — §16 fixes the names and the
 * properties, and `AnalyticsEvent` below is that table expressed as a
 * discriminated union so a call site cannot drift from it. Adding a property to
 * one screen and forgetting it on another is the usual way a tracking plan
 * rots; here it is a type error.
 *
 * Two rules from the PRD are load-bearing and are enforced in this file rather
 * than left to the discipline of every caller:
 *
 *   * §15 "avoid sending sensitive free-text health notes to analytics", and
 *     the promise the Profile screen makes in copy: considerations are excluded
 *     entirely. No event carries them, and none carries a symptom name, a coach
 *     message body, an email, or a display name. Where a sensitive value would
 *     be informative it is bucketed — `bucketSleep`, `bucketScale` — so the
 *     shape of the distribution survives and the athlete's number does not.
 *   * §15.2 "minimize event payloads". Properties are the ones §16 names and
 *     nothing else.
 *
 * Like `lib/supabase.ts`, an absent key is a supported state rather than an
 * error: `track` becomes a no-op and the app runs exactly as it did before.
 * Analytics must never be the reason a workout screen fails to open.
 */
import {
  init, track as amplitudeTrack, setUserId, reset, flush,
} from '@amplitude/analytics-react-native';

const apiKey = process.env.EXPO_PUBLIC_AMPLITUDE_API_KEY;

export const isAnalyticsConfigured = Boolean(apiKey);

/**
 * The §16 taxonomy. `name` is the Amplitude event name; the rest of each member
 * is that row's "Properties / notes" column.
 */
export type AnalyticsEvent =
  | { name: 'onboarding_started'; source: string }
  | {
      name: 'onboarding_completed';
      sport: string;
      race_added: boolean;
      health_connected: boolean;
    }
  | {
      name: 'today_viewed';
      phase: string;
      recommendation_family: string | null;
      variant: string | null;
    }
  | { name: 'adapt_opened'; original_variant: string | null }
  | {
      name: 'adapt_input_changed';
      time_bucket: string;
      energy_bucket: string;
      low_impact: boolean;
      equipment_change: boolean;
    }
  | {
      name: 'adaptation_applied';
      from_variant: string | null;
      to_variant: string;
      reason_codes: string[];
    }
  | {
      name: 'workout_started';
      template_id: string;
      family: string;
      variant: string;
      estimated_minutes: number;
    }
  /**
   * §16 warns this one off "every tap if volume is excessive". It is emitted
   * per step, which for a HYROX session is single digits to low tens — the
   * aggregate the note is worried about would be a per-rep or per-tick event,
   * not this. `step_index`/`total_steps` make drop-off within a session
   * readable without a second event.
   */
  | {
      name: 'workout_step_completed';
      block_type: string;
      exercise_id: string | null;
      step_index: number;
      total_steps: number;
    }
  | { name: 'exercise_substituted'; from_exercise: string; to_exercise: string; reason: string }
  | {
      name: 'workout_completed';
      family: string;
      variant: string;
      actual_minutes: number;
      session_rpe: number | null;
      ended_early: boolean;
    }
  | { name: 'workout_abandoned'; elapsed_minutes: number; block_index: number }
  /**
   * "Buckets only" (§16). Sleep and soreness arrive bucketed; symptoms are
   * reduced to a count, because a symptom name is exactly the health free text
   * §15 excludes.
   */
  | {
      name: 'recovery_checkin_completed';
      sleep_bucket: string;
      soreness_bucket: string;
      symptom_count: number;
    }
  | { name: 'readiness_viewed'; confidence: string; component_lowest: string | null }
  /** "Intent classification only; do not mirror raw sensitive text" (§16). */
  | { name: 'coach_message_sent'; intent: string }
  | { name: 'coach_action_applied'; action_type: string }
  | {
      name: 'health_connection_started' | 'health_connection_completed' | 'health_connection_failed';
      provider: string;
      permission_group: string;
    };

let started = false;

/**
 * Starts the SDK. Safe to call more than once — React 19 strict mode mounts
 * effects twice in development, and a second `init` would otherwise open a
 * second instance against the same key.
 */
export function initAnalytics(): void {
  if (!apiKey || started) return;
  started = true;
  init(apiKey, undefined, {
    // Amplitude's default autocapture records screen views and every element
    // tap. §15.2 asks for minimized payloads and §16 names the events it wants;
    // an untyped stream of tap events alongside them is noise that also risks
    // capturing labels off the considerations and coach screens.
    autocapture: {
      sessions: true,
      appLifecycles: true,
      screenViews: false,
      elementInteractions: false,
    },
  });
}

/**
 * Ties events to the athlete.
 *
 * The Supabase auth UUID, deliberately — it is the join key the §16.1 KPIs need
 * (week-2 retention and stimulus adherence are both "this athlete's rows over
 * time"), and it is opaque. The email and display name stay out of analytics.
 */
export function identifyAthlete(userId: string): void {
  if (!apiKey) return;
  setUserId(userId);
}

/**
 * Clears identity on sign-out.
 *
 * `reset` drops the user ID *and* the device ID, so the next athlete on a
 * shared phone starts a new anonymous identity rather than inheriting the last
 * one's history.
 */
export function resetAthlete(): void {
  if (!apiKey) return;
  reset();
}

/**
 * Records an event. Never throws: a analytics failure must not surface as a
 * broken screen, so a rejected send is swallowed the same way an absent key is.
 */
export function track(event: AnalyticsEvent): void {
  if (!apiKey) return;
  const { name, ...properties } = event;
  try {
    amplitudeTrack(name, properties);
  } catch {
    // Intentionally silent. See the note above.
  }
}

/**
 * Pushes anything queued.
 *
 * Called when a workout ends, which is the moment the athlete is most likely to
 * background the app — and an event queued but unsent when the process is
 * killed is an event that never happened.
 */
export function flushAnalytics(): void {
  if (!apiKey) return;
  try {
    flush();
  } catch {
    // As above.
  }
}

// ---------------------------------------------------------------------------
// Bucketing
//
// These exist so that no call site has to decide whether a raw value is safe to
// send. The answer for a recovery number is always no, and the bucket is always
// the thing worth analysing anyway.
// ---------------------------------------------------------------------------

/** Session-length buckets, named for the variants they tend to select. */
export function bucketMinutes(minutes: number): string {
  if (minutes <= 20) return '0-20';
  if (minutes <= 35) return '21-35';
  if (minutes <= 50) return '36-50';
  if (minutes <= 75) return '51-75';
  return '76+';
}

/** Sleep, coarse enough that it describes a night rather than identifies one. */
export function bucketSleep(hours: number | null): string {
  if (hours === null) return 'unreported';
  if (hours < 5) return 'under_5';
  if (hours < 6.5) return '5_to_6.5';
  if (hours < 8) return '6.5_to_8';
  return '8_plus';
}

/** The 1–5 check-in scales, as low/medium/high. */
export function bucketScale(value: number | null): string {
  if (value === null) return 'unreported';
  if (value <= 2) return 'low';
  if (value <= 3) return 'medium';
  return 'high';
}

/** Seconds of elapsed workout time as whole minutes. */
export function elapsedMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}
