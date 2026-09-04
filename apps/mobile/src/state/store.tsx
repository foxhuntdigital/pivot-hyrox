/**
 * App state.
 *
 * Two things live here and they are deliberately separate:
 *   * Athlete/adaptation state — the inputs the engine reads.
 *   * The active workout state machine (PRD §8.4), which is authoritative
 *     while a session is running. If a server plan changes mid-session the
 *     active snapshot wins (PRD §15.1).
 *
 * The engine is called synchronously from a memo. It is a pure function, so a
 * recommendation is always derivable from current state rather than stored and
 * risked going stale.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import { AppState } from 'react-native';
import {
  recommend, computeReadiness, variantMinutes, hasSevereSymptom,
  recoveryFromEnergy, ENGINE_VERSION,
  type EngineDecision, type EngineInput, type Energy, type VariantCode,
} from '@pivot/engine';
import { EXERCISES, TEMPLATES, SUBSTITUTIONS, exerciseById } from '../data/content';
import { metricDetail, type MetricDetail } from '../data/metrics';
import { EMPTY_PROFILE, type AthleteProfile, type ExperienceLevel } from '../data/profile';
import { fetchProfile, saveProfile } from '../data/profileRepo';
import {
  fetchToday,
  type CapabilityState, type ExerciseGuidance,
  type PerformanceTrend, type TodayPayload,
} from '../data/todayRepo';
import { saveCheckin, EMPTY_CHECKIN, type Checkin } from '../data/recoveryRepo';
import { fetchProgressNarration } from '../data/coachRepo';
import {
  abandonSession, clientSessionId, eventId, startSession, type StartRequest,
} from '../data/sessionRepo';
import {
  blockedFinishes, enqueueFinish, flushOutbox, loadOutbox, pendingFinishOn,
  subscribeOutbox, type PendingFinish,
} from '../data/outbox';
import { recordAdaptation } from '../data/adaptRepo';
import {
  clearActiveSession, loadActiveSession, saveActiveSession, verdictFor,
  SCHEMA_VERSION, type ActiveSessionRecord, type ActiveStatus,
} from '../data/activeSession';
import { fetchEquipment, saveEquipment } from '../data/equipmentRepo';
import {
  fetchPreferences, savePreference, fetchWeaknesses, saveWeakness,
  type PreferenceRating, type Preferences,
} from '../data/preferencesRepo';
import {
  planView, type FinishedHere, type PerformedSession, type PlanView,
} from '../data/plan';
import {
  track, flushAnalytics, bucketSleep, bucketScale, elapsedMinutes,
} from '../lib/analytics';
import { localToday } from '../lib/format';
import { COMPONENT_KEYS } from '@pivot/coach';
import { useSession } from './session';
import { useOnboarding } from './onboarding';
import { buildSteps, type Step } from './steps';
import { buildLogs, type SetEntries, type SetEntry } from './actuals';
import { buildSplits } from './splits';

/**
 * A profile/equipment failure, and whether it was a read or a write. The two
 * read very differently to an athlete: a failed write means what they just
 * typed is not stored, a failed read means the screen is showing less than
 * their account holds.
 */
export interface ProfileError {
  kind: 'load' | 'save';
  message: string;
}

/**
 * PostgREST hands its failures back as plain objects rather than Errors, so
 * `instanceof Error` is false for a real database failure and the caller's
 * fallback string replaces the actual cause. Repos wrap their own now; this
 * catches whatever else arrives.
 */
function messageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

/** PRD §8.4. */
export type WorkoutStatus =
  | 'ready' | 'active_block' | 'paused'
  | 'completed_pending_review' | 'completed' | 'abandoned';

interface State {
  /** Editable athlete profile (D22). Hydrated from Supabase when signed in. */
  profile: AthleteProfile;

  // Adaptation inputs
  /**
   * Whether the athlete has adjusted today's inputs since the plan was read.
   *
   * Until they do, the server's decision is what shows — it is the one written
   * to `adaptation_events`, and the default view should match the audited
   * answer. Once they change something, the local run takes over so the
   * recommendation responds to what they just said.
   */
  adapt_touched: boolean;
  available_minutes: number;
  energy: Energy;
  flags: string[];
  equipment: string[];
  /**
   * Equipment for today only, narrowed by a Coach travel answer. Separate from
   * `equipment` so a hotel week never overwrites the gym the athlete owns.
   */
  today_equipment: string[] | null;
  /** A multi-day equipment change the athlete confirmed from Coach. */
  travel: { equipment: string[]; days: string[] } | null;
  /**
   * Today's recovery check-in as the athlete entered it (D20 / FR-015). Held
   * locally as well as sent to the server so an offline check-in still shapes
   * today's session, and so the unconfigured build has somewhere to keep it.
   */
  checkin: Checkin | null;

  /**
   * The server's row for the session being performed, and the revision the
   * next write must carry. Null until the server answers Start — and on an
   * unconfigured build, for the whole session.
   */
  session_id: string | null;
  session_revision: number;
  /**
   * The session's own id, minted when the player opens rather than granted by
   * the server (migration 0021).
   *
   * The difference is the whole of what it fixes. `session_id` arrives only if
   * Start reached the server, so offline it is null for the length of the
   * workout — which left the finished session with nothing the app could
   * recognise it by when the week eventually came back holding it. This exists
   * from the first tap, network or no network.
   */
  client_session_id: string | null;

  /**
   * The id every finish for this session carries, minted when the player opens.
   *
   * It used to be minted inside `finishSession`, which was fine while a finish
   * happened exactly once. It no longer does: the finish is written to the
   * outbox as soon as the last step ends, and written again after the athlete
   * gives an RPE. Those two are the same event and must carry the same id —
   * `mergeQueued` replaces on it, and the server's replay guard reads it — or
   * one workout is queued as two.
   */
  finish_event_id: string | null;

  /** Set when the athlete accepts an adaptation, overriding the engine's pick. */
  override_template_id: string | null;
  override_variant: VariantCode | null;
  /**
   * The athlete confirmed this session against the engine's recovery advice.
   *
   * Held in state rather than passed once, because the forced session is
   * recomputed on every render: without it the next recompute would refuse the
   * variant again and quietly fall back to the engine's pick, which is the tap
   * appearing to do nothing.
   */
  override_forced: boolean;
  adapted: boolean;

  // Active workout
  status: WorkoutStatus;
  step_index: number;
  elapsed_seconds: number;
  /**
   * Seconds spent on each step, by index. The clock is the only thing the
   * player measures, and it is what turns a prescribed distance into a real
   * pace when the finish is written.
   */
  step_seconds: number[];
  session_rpe: number | null;
  ended_early: boolean;

  /**
   * The session finished on this device, held so the optimistic "completed
   * today" can retire the moment the server's week contains it.
   *
   * This is the whole of what is left of the optimistic layer, and it is not
   * removable. There is a window — between the outbox dropping a finish it has
   * successfully sent and the refetched payload coming back holding it — where
   * neither source knows about the session. Without something bridging it the
   * week's counter drops by one and Today's "you're done" state flicks off and
   * back on, at exactly the moment the athlete is looking at the screen.
   *
   * Without it `completed_today` was a bare flag that outlived its own refetch:
   * the week's counter added one on top of a server count that had already
   * been incremented, and Plan labelled whatever the engine recommended *next*
   * as "Completed today" — an athlete who finished Long Hybrid 60 was shown a
   * Threshold session, ticked, that they had never seen.
   */
  completed_client_id: string | null;
  /**
   * The local day that marker belongs to.
   *
   * Without it the marker outlived its own week. `serverHasIt` retires it by
   * finding the session in `week.completed` — but a week rollover empties that
   * list, so the match failed again and a session finished last Sunday
   * re-inflated into Monday's count, named as though it had just happened. The
   * marker is a claim about a particular day, and it stops being true when that
   * day ends.
   */
  completed_on: string | null;
  /**
   * The session the player was opened on, kept until the next one opens.
   *
   * Finishing spends the override, after which the engine's answer is the
   * *next* workout — so a screen that names the finished session from the live
   * decision names something the athlete never did. That is exactly what an
   * athlete who trained a session Coach built for them saw: Today and Plan both
   * credited them with the workout the plan had assigned instead. This is what
   * was performed, recorded at the one moment the app is certain of it.
   */
  performed: PerformedSession | null;

  /**
   * What the athlete typed for each working set, keyed by step index.
   *
   * Keyed by step rather than by exercise because the same movement appears in
   * several sets and each carries its own load and reps — that is the point of
   * expanding sets into steps. Entries survive moving back and forth through
   * the session and are read once, at finish, by `buildLogs`.
   */
  entries: SetEntries;

  // UI
  open_metric: string | null;
}

/**
 * What the app holds before an account answers.
 *
 * Every field here used to describe a seeded athlete — a name, a gym, two
 * considerations, a four-hour night — which rendered as the viewer's own data
 * until hydration replaced it, and stayed if hydration failed. It is empty now.
 * An empty profile shows as an empty profile.
 */
const initialState: State = {
  profile: EMPTY_PROFILE,

  adapt_touched: false,
  available_minutes: 45,
  energy: 'normal',
  flags: [],
  equipment: [],
  today_equipment: null,
  travel: null,
  checkin: null,

  session_id: null,
  session_revision: 0,
  client_session_id: null,
  finish_event_id: null,

  override_template_id: null,
  override_variant: null,
  override_forced: false,
  adapted: false,

  status: 'ready',
  step_index: 0,
  elapsed_seconds: 0,
  step_seconds: [],
  entries: {},
  session_rpe: null,
  ended_early: false,
  completed_client_id: null,
  completed_on: null,
  performed: null,

  open_metric: 'running',
};

/**
 * The slice a Coach commitment can change, and therefore the slice an undo has
 * to put back.
 */
export interface Restorable {
  available_minutes: number;
  energy: Energy;
  flags: string[];
  today_equipment: string[] | null;
  travel: State['travel'];
  checkin: Checkin | null;
  override_template_id: string | null;
  override_variant: VariantCode | null;
  adapted: boolean;
}

export function snapshot(s: State): Restorable {
  return {
    available_minutes: s.available_minutes,
    energy: s.energy,
    flags: [...s.flags],
    today_equipment: s.today_equipment,
    travel: s.travel,
    checkin: s.checkin,
    override_template_id: s.override_template_id,
    override_variant: s.override_variant,
    adapted: s.adapted,
  };
}

type Action =
  | { type: 'set_name'; name: string }
  | { type: 'set_experience'; level: ExperienceLevel }
  | { type: 'set_postpartum_date'; date: string | null }
  | { type: 'set_predictability'; value: number }
  | { type: 'hydrate_profile'; profile: AthleteProfile }
  | { type: 'hydrate_equipment'; equipment: string[] }
  | { type: 'set_time'; minutes: number }
  | { type: 'set_energy'; energy: Energy }
  | { type: 'toggle_flag'; flag: string }
  | { type: 'toggle_equipment'; id: string }
  | { type: 'toggle_consideration'; name: string }
  | { type: 'set_typical'; minutes: number }
  | { type: 'accept_adaptation'; template_id: string; variant: VariantCode; forced?: boolean }
  | { type: 'set_today_equipment'; equipment: string[] | null }
  | { type: 'new_day' }
  | { type: 'set_travel'; travel: State['travel'] }
  | { type: 'set_checkin'; checkin: Checkin }
  | { type: 'restore'; snapshot: Restorable }
  | {
      type: 'start_workout'; performed: PerformedSession | null;
      finish_event_id: string; client_session_id: string;
    }
  | { type: 'restore_session'; record: ActiveSessionRecord }
  | { type: 'session_opened'; session_id: string; revision: number }
  | { type: 'next_step'; total: number; local_date: string }
  | { type: 'tick' }
  | { type: 'toggle_pause' }
  | { type: 'end_and_save'; local_date: string }
  | { type: 'end_and_discard' }
  | { type: 'set_rpe'; rpe: number }
  | { type: 'back_to_today' }
  | { type: 'set_entry'; step: number; entry: SetEntry }
  | { type: 'toggle_metric'; key: string };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'set_name':
      return { ...s, profile: { ...s.profile, display_name: a.name } };
    case 'set_experience':
      return { ...s, profile: { ...s.profile, experience_level: a.level } };
    case 'set_postpartum_date':
      return { ...s, profile: { ...s.profile, postpartum_birth_date: a.date } };
    case 'set_predictability':
      return { ...s, profile: { ...s.profile, schedule_predictability: a.value } };
    case 'hydrate_profile':
      return { ...s, profile: a.profile };
    case 'hydrate_equipment':
      return { ...s, equipment: a.equipment };

    /**
     * A new local day clears the adjustment, not the adjustments themselves.
     *
     * Time, energy and flags are today-only inputs; once the date rolls over,
     * whatever the athlete told the sheet yesterday should stop overriding a
     * freshly computed plan. Only the flag is reset here — a refetch on the
     * same day must not discard an adjustment they just made.
     */
    case 'new_day':
      return { ...s, adapt_touched: false };

    // The three adapt inputs mark the day as adjusted, which is what switches
    // the recommendation from the server's answer to the live local one.
    case 'set_time':
      return { ...s, available_minutes: a.minutes, adapt_touched: true };
    case 'set_energy':
      return { ...s, energy: a.energy, adapt_touched: true };
    case 'toggle_flag': {
      const flags = s.flags.includes(a.flag)
        ? s.flags.filter(f => f !== a.flag) : [...s.flags, a.flag];
      // "No equipment" is an adaptation input, not a profile edit — it narrows
      // the engine's equipment set for today without touching the saved gym.
      return { ...s, flags, adapt_touched: true };
    }
    case 'toggle_equipment':
      return {
        ...s,
        equipment: s.equipment.includes(a.id)
          ? s.equipment.filter(e => e !== a.id) : [...s.equipment, a.id],
      };
    case 'toggle_consideration': {
      const has = s.profile.considerations.includes(a.name);
      return {
        ...s,
        profile: {
          ...s.profile,
          considerations: has
            ? s.profile.considerations.filter(c => c !== a.name)
            : [...s.profile.considerations, a.name],
        },
      };
    }
    case 'set_typical':
      return { ...s, profile: { ...s.profile, typical_session_minutes: a.minutes } };

    case 'accept_adaptation':
      return {
        ...s,
        override_template_id: a.template_id,
        override_variant: a.variant,
        override_forced: a.forced ?? false,
        adapted: true,
      };
    case 'set_today_equipment':
      return { ...s, adapt_touched: true, today_equipment: a.equipment };
    case 'set_travel':
      return { ...s, travel: a.travel };
    case 'set_checkin':
      return {
        ...s,
        checkin: a.checkin,
        // The check-in is the authoritative statement of how the athlete is;
        // the Adapt sheet's energy chip follows it rather than competing.
        energy: a.checkin.energy ?? s.energy,
      };
    // Undo (PRD §2 — an adaptation the athlete accepted is theirs to take back).
    // Restoring the whole adaptable slice is what makes a Coach commitment
    // reversible without each action having to author its own inverse.
    case 'restore':
      return { ...s, ...a.snapshot };

    case 'start_workout':
      return {
        ...s, status: 'active_block', step_index: 0, elapsed_seconds: 0,
        step_seconds: [], entries: {}, ended_early: false,
        // Cleared here rather than on finish: the id belongs to the session
        // being performed, and a new one starts without the last one's row.
        session_id: null, session_revision: 0,
        client_session_id: a.client_session_id,
        finish_event_id: a.finish_event_id,
        // Replaced here for the same reason, and for the same reason not
        // cleared on finish: the finished session still has to be nameable
        // after the override that chose it is spent.
        performed: a.performed,
      };
    case 'session_opened':
      return { ...s, session_id: a.session_id, session_revision: a.revision };

    /**
     * Puts back the session the process died in the middle of.
     *
     * Refused unless the player is idle: the restore is asynchronous, and an
     * athlete quick enough to tap Start before it lands must not have their new
     * session overwritten by the old one.
     *
     * The override is set from the record rather than left alone, and that is
     * the point of restoring at all. Without it the player would rebuild its
     * steps from whatever the plan recommends *now* — which after a day's
     * rollover, or a check-in, is a different workout — and the athlete would
     * be returned to a session they had never started, holding the numbers they
     * typed into the one they had.
     */
    case 'restore_session': {
      if (s.status !== 'ready') return s;
      const r = a.record;
      return {
        ...s,
        status: r.status,
        step_index: r.step_index,
        elapsed_seconds: r.elapsed_seconds,
        step_seconds: r.step_seconds,
        entries: r.entries,
        session_rpe: r.session_rpe,
        ended_early: r.ended_early,
        session_id: r.session_id,
        session_revision: r.session_revision,
        client_session_id: r.client_session_id,
        finish_event_id: r.finish_event_id,
        performed: {
          template_id: r.template_id,
          name: r.name,
          estimated_minutes: r.estimated_minutes,
        },
        override_template_id: r.template_id,
        override_variant: r.variant,
        /**
         * Forced, because this is not a new recommendation being made — it is
         * an existing one being redisplayed. The guardrails had their say when
         * the session opened; re-running them against inputs that have moved
         * since would refuse the session and silently drop the athlete into
         * whatever the engine likes better, mid-workout.
         */
        override_forced: true,
        adapted: false,
      };
    }
    case 'tick': {
      if (s.status !== 'active_block') return s;
      // The tick lands on whichever step is open, so a paused clock stops
      // counting against it as well as against the session.
      const step_seconds = [...s.step_seconds];
      step_seconds[s.step_index] = (step_seconds[s.step_index] ?? 0) + 1;
      return { ...s, elapsed_seconds: s.elapsed_seconds + 1, step_seconds };
    }
    case 'next_step':
      return s.step_index >= a.total - 1
        ? {
            ...s, status: 'completed_pending_review',
            completed_client_id: s.client_session_id, completed_on: a.local_date,
          }
        : { ...s, step_index: s.step_index + 1 };
    case 'toggle_pause':
      return { ...s, status: s.status === 'paused' ? 'active_block' : 'paused' };
    case 'end_and_save':
      return {
        ...s, status: 'completed_pending_review', ended_early: true,
        completed_client_id: s.client_session_id, completed_on: a.local_date,
      };
    case 'end_and_discard':
      // Abandoned, not completed: nothing is logged and the stimulus stays open.
      // Nothing was performed either, so the record of it goes with the rest.
      return {
        ...s, status: 'ready', step_index: 0, elapsed_seconds: 0,
        step_seconds: [], entries: {}, performed: null,
      };
    case 'set_rpe':
      return { ...s, session_rpe: a.rpe };
    case 'back_to_today':
      return {
        ...s, status: 'ready', step_index: 0, elapsed_seconds: 0, step_seconds: [],
        entries: {}, session_rpe: null, session_id: null, session_revision: 0,
        /**
         * The override is spent. It meant "this is what I am doing today", and
         * today's session is now finished — left standing it kept forcing the
         * same template after its queue item had been credited and dropped out
         * of the week, so Today offered a completed session back with a Start
         * button on it.
         */
        override_template_id: null, override_variant: null, override_forced: false,
        adapted: false,
      };

    case 'set_entry': {
      // Merged rather than replaced: the weight, the reps and the RPE are
      // three independent answers and typing one must not clear another.
      const prev = s.entries[a.step] ?? {};
      return { ...s, entries: { ...s.entries, [a.step]: { ...prev, ...a.entry } } };
    }
    case 'toggle_metric':
      return { ...s, open_metric: s.open_metric === a.key ? null : a.key };
  }
}

interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  /** The engine's pick given current inputs. */
  decision: EngineDecision;
  /** What the athlete will actually do — the override if they accepted one. */
  session: EngineDecision;
  steps: Step[];
  readiness: ReturnType<typeof computeReadiness>;
  metricDetail: Record<string, MetricDetail>;
  /**
   * Last exposure and suggested load per movement, keyed by exercise id.
   *
   * Computed server-side because the input is the athlete's whole logged
   * history. Empty when today has no session, when the server has not answered,
   * or for any movement that prescribes no working sets — the player shows
   * nothing rather than a prior it had to invent.
   */
  guidance: Record<string, ExerciseGuidance>;
  /**
   * What the athlete said they want more and less of, by domain key.
   *
   * Absent from the map means neutral, which is what the engine assumes and
   * what the table stores by omitting the row.
   */
  /**
   * What performance has demonstrated, and the one trend worth stating.
   *
   * Both come from the server because both are determinations over the
   * athlete's whole history — the client renders them and does not re-derive
   * them. A null trend is an answer, not a missing value.
   */
  capability: CapabilityState[];
  trend: PerformanceTrend | null;
  preferences: Preferences;
  /** Sets one preference, or clears it back to neutral with null. */
  setPreference(value: string, rating: PreferenceRating | null): void;
  /**
   * Capabilities the athlete says need work. A separate claim from preference
   * and from evidence, and scored as its own dimension since ENGINE 2.1.0.
   */
  weaknesses: string[];
  setWeakness(value: string, stated: boolean): void;
  /**
   * The race, phase and week as the screens render them. One resolution of
   * payload-or-seed, so no screen has to know which it is looking at.
   */
  plan: PlanView;
  /**
   * Sleep as the engine saw it, with where it came from. `null` hours mean the
   * athlete has not checked in and no wearable is connected — screens show a
   * neutral state rather than inventing a figure (PRD §8.3).
   */
  sleep: { hours: number | null; source: 'self_reported' | 'connected' | null };
  engineInput: EngineInput;
  /**
   * Writes a profile edit through to Supabase. Local state is already updated
   * by the time this runs, so the field stays responsive; a failure surfaces in
   * `profileError` rather than silently reverting what the athlete typed.
   */
  commitProfile(patch: Partial<AthleteProfile>): void;
  /**
   * Records the check-in locally, writes it through, and refreshes Today so the
   * recommendation reflects it. Local state updates first: the athlete's answer
   * is theirs whether or not the network agrees.
   */
  commitCheckin(checkin: Checkin): void;
  /**
   * Writes the athlete's equipment set through. Takes the whole set rather than
   * the toggled item: the row is a set, and sending the set is what makes a
   * dropped write recoverable by the next one.
   */
  commitEquipment(equipment: string[]): void;
  /**
   * Records a symptom on today's check-in. Separate from `commitCheckin` so a
   * caller with only a symptom to report does not have to reconstruct — or
   * overwrite — the answers the athlete already gave.
   */
  reportSymptom(name: string): void;
  /**
   * Opens the session on the server and starts it locally. Local state moves
   * first — the athlete is training whether or not the row was written.
   */
  beginSession(): void;
  /**
   * Closes the session: writes the finish through, then refreshes Today so the
   * week reflects the stimulus just credited.
   */
  finishSession(): void;
  /**
   * Throws the session away — locally and on the server.
   *
   * The server half is the point. Discarding used to be a reducer case and
   * nothing more, so the row it left behind stayed `active` for good and
   * `start-workout` handed it back, snapshot and all, the next time the athlete
   * started that template.
   */
  discardSession(): void;
  /**
   * Finishes written to disk that the server has not accepted yet, and how many
   * of those are waiting on the subscription rather than on the network.
   *
   * Surfaced because the blocked ones are otherwise invisible: the athlete sees
   * sessions missing from history with nothing anywhere saying why.
   */
  pendingSync: { pending: number; blocked: number };
  /**
   * Applies an accepted adaptation and records it. The apply is local and
   * immediate; the record is the audit row (PRD §24).
   */
  commitAdaptation(templateId: string, variant: VariantCode): void;
  /**
   * Makes a queued session today's, chosen by the athlete from Plan. Refusals
   * are classified exactly as `chooseVariant`'s are, and for the same reason:
   * an athlete asking for a harder session than today's check-in supports is
   * owed a question, not a closed door.
   */
  switchToQueued(templateId: string, opts?: { override?: boolean }): VariantChoice;
  /**
   * Runs an optional supplemental as the active session.
   *
   * The same override mechanism a queued switch uses — the store's session IS
   * the override template once one is set — but it records no adaptation,
   * because nothing was adapted. The athlete completed exactly what the plan
   * asked and chose to add something afterwards, and writing an
   * `adaptation_applied` event for that would put a change in the audit trail
   * that never happened.
   *
   * Returns false when the engine refuses the template, which is the same
   * answer the server's gate gives and is not an error worth a message: the
   * offer that produced this id was computed from the same snapshot, so a
   * refusal here means state moved underneath it.
   */
  startSupplemental(templateId: string): boolean;
  /**
   * Applies a specific variant of a workout — the Adapt sheet's Full/Micro
   * choices.
   *
   * A refusal says which kind it is, because the three are not the same
   * conversation: `recovery` is advice the athlete may overrule by calling
   * again with `override`, `symptom` is a safety boundary that no confirmation
   * lifts, and `unavailable` means the session cannot be built from what they
   * have at all.
   */
  chooseVariant(
    templateId: string, variant: VariantCode, opts?: { override?: boolean },
  ): VariantChoice;
  /**
   * The last profile/equipment read or write that failed, with which of the two
   * it was. `kind` exists because the banner used to say "Not saved" over a
   * message about a failed *load*, which reads as the athlete's answers having
   * been thrown away when nothing of theirs was ever at risk.
   */
  profileError: ProfileError | null;
  /** Re-reads the profile and the equipment set — what the error banner retries. */
  refreshProfile(): void;
  /**
   * Server state backing the decision. Null on an unconfigured build, which
   * runs on the seeded athlete instead (see `athlete.ts`).
   */
  today: TodayPayload | null;
  todayLoading: boolean;
  todayError: string | null;
  /** Re-fetches today's decision — after completing a session, or on pull. */
  refreshToday(): void;
  /**
   * The athlete's local day: the server's answer when it has given one, the
   * device's own calendar until then. Anything filing a record under a date
   * should read it from here rather than deriving its own.
   */
  localDate: string;
}

/**
 * The outcome of asking for a particular version of a workout.
 *
 * `recovery` is the only refusal that carries a question: it means the engine's
 * advice, not a limit of the world, and the caller may put it to the athlete
 * and call again with `override`.
 */
export type VariantChoice =
  | { ok: true }
  | { ok: false; reason: 'recovery' | 'symptom' | 'unavailable' };

const Ctx = createContext<Store | null>(null);

/**
 * What the athlete still has on a "No equipment" day.
 *
 * `outdoor` is a place, not kit. Since running became an equipment constraint
 * (migration 0009) rather than something the engine handed out for free,
 * collapsing this day to bodyweight alone would quietly remove the one session
 * a no-equipment day is most likely to want. Someone who says they have no
 * equipment has not said they are indoors. A treadmill is kit, so it goes.
 */
function bodyweightDay(equipment: string[]): string[] {
  return equipment.includes('outdoor') ? ['bodyweight', 'outdoor'] : ['bodyweight'];
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { status: authStatus } = useSession();
  const { status: onboardingStatus } = useOnboarding();
  const [profileError, setProfileError] = useState<ProfileError | null>(null);
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [todayNonce, setTodayNonce] = useState(0);
  /** Finishes written to disk but not yet accepted by the server. */
  const [pendingFinishes, setPendingFinishes] = useState<PendingFinish[]>([]);
  const [profileNonce, setProfileNonce] = useState(0);

  /**
   * Whether the athlete's server rows are worth reading yet.
   *
   * Being signed in is not enough. A brand-new account is signed in for the
   * whole of onboarding, and everything these effects read — the race, the
   * program, the profile answers, the gym — is written by `onboarding-plan` at
   * the end of it. Fetching on sign-in alone therefore read an athlete who had
   * no plan yet and then never looked again, which is why Today opened on "No
   * race set" over the race the athlete had just entered. Keying the fetches on
   * this makes the flip to `complete` the refetch.
   */
  const serverReady = authStatus === 'signed_in'
    && (onboardingStatus === 'complete' || onboardingStatus === 'not_applicable');

  // Today's decision comes from the server so it is recorded against the engine
  // version that produced it (PRD §24). A failure leaves `today` null and the
  // seed showing, with the error surfaced rather than swallowed.
  useEffect(() => {
    if (!serverReady) return;
    let cancelled = false;
    setTodayLoading(true);
    setTodayError(null);
    fetchToday()
      .then(payload => { if (!cancelled) setToday(payload); })
      .catch(e => {
        if (!cancelled) setTodayError(messageOf(e, 'Could not load today'));
      })
      .finally(() => { if (!cancelled) setTodayLoading(false); });
    return () => { cancelled = true; };
  }, [serverReady, todayNonce]);

  const refreshToday = useCallback(() => setTodayNonce(n => n + 1), []);

  /**
   * Replays anything the last run could not send.
   *
   * On launch and on every return to the foreground, because the two failures
   * this exists for — no connection, and a server that was briefly unwell —
   * both tend to have resolved by the time the athlete opens the app again.
   * A successful send moves the week's counters, so the payload is refetched.
   */
  useEffect(() => {
    const unsubscribe = subscribeOutbox(setPendingFinishes);
    loadOutbox();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authStatus !== 'signed_in') return;

    let cancelled = false;
    const run = () => {
      flushOutbox().then(result => {
        if (!cancelled && result.sent > 0) refreshToday();
      });
    };

    run();
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') run();
    });
    return () => { cancelled = true; sub.remove(); };
  }, [authStatus, refreshToday]);
  const refreshProfile = useCallback(() => {
    setProfileError(null);
    setProfileNonce(n => n + 1);
  }, []);

  // Hydrate the profile once a session exists. Unconfigured builds keep the
  // seeded athlete, which is why this is gated on the status rather than run
  // unconditionally and allowed to fail.
  useEffect(() => {
    if (!serverReady) return;
    let cancelled = false;
    fetchProfile('')
      .then(profile => {
        // Deliberately not clearing the banner here: the equipment read runs
        // alongside this one and writes to the same slot, so a profile that
        // succeeds must not erase an equipment failure. `refreshProfile` clears
        // before both re-run, which is the only point where nothing is pending.
        if (!cancelled && profile) dispatch({ type: 'hydrate_profile', profile });
      })
      .catch(e => {
        if (!cancelled) {
          setProfileError({ kind: 'load', message: messageOf(e, 'Could not load your profile.') });
        }
      });
    return () => { cancelled = true; };
  }, [serverReady, profileNonce]);

  /**
   * Stated training preferences. Local state so the control responds instantly;
   * the write is best-effort behind it, exactly like equipment.
   */
  const [preferences, setPreferences] = useState<Preferences>({});
  const [weaknesses, setWeaknesses] = useState<string[]>([]);

  useEffect(() => {
    if (!serverReady) return;
    let cancelled = false;
    fetchPreferences().then(p => { if (!cancelled && p) setPreferences(p); });
    fetchWeaknesses().then(w => { if (!cancelled && w) setWeaknesses(w); });
    return () => { cancelled = true; };
  }, [serverReady]);

  const setWeakness = useCallback((value: string, stated: boolean) => {
    setWeaknesses(prev => (stated
      ? (prev.includes(value) ? prev : [...prev, value])
      : prev.filter(v => v !== value)));
    saveWeakness(value, stated).catch(() => {});
  }, []);

  const setPreference = useCallback((value: string, rating: PreferenceRating | null) => {
    setPreferences(prev => {
      const next = { ...prev };
      if (rating === null) delete next[value];
      else next[value] = rating;
      return next;
    });
    // Best-effort: a failed write costs the setting, never the session. The
    // next payload re-reads the server's truth.
    savePreference(value, rating).catch(() => {});
  }, []);

  // The athlete's saved gym. Separate from the profile fetch because it is a
  // separate table, and because a failed equipment read must not cost the
  // profile — the two are useful independently.
  useEffect(() => {
    if (!serverReady) return;
    let cancelled = false;
    fetchEquipment()
      .then(equipment => {
        if (!cancelled && equipment) dispatch({ type: 'hydrate_equipment', equipment });
      })
      .catch(e => {
        // Named as equipment, not as the profile. Both land in the same banner,
        // and reporting one as the other sent an athlete looking for answers
        // that were never in question.
        if (!cancelled) {
          setProfileError({ kind: 'load', message: messageOf(e, 'Could not load your equipment.') });
        }
      });
    return () => { cancelled = true; };
  }, [serverReady, profileNonce]);

  const authStatusRef = useRef(authStatus);
  authStatusRef.current = authStatus;

  // Read by `finishSession` for the athlete's local day. A ref rather than a
  // dependency: the callback must not be rebuilt on every payload refetch.
  const todayRef = useRef(today);
  todayRef.current = today;

  const commitProfile = useCallback((patch: Partial<AthleteProfile>) => {
    if (authStatusRef.current !== 'signed_in') return;
    setProfileError(null);
    saveProfile(patch).catch(e =>
      setProfileError({ kind: 'save', message: messageOf(e, 'Could not save your profile.') }));
  }, []);

  /**
   * Writes the whole equipment set through after a toggle. Debounced by a beat
   * so a run of taps is one write rather than one per chip — the athlete
   * usually changes several at once.
   */
  const equipmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitEquipment = useCallback((equipment: string[]) => {
    if (authStatusRef.current !== 'signed_in') return;
    if (equipmentTimer.current) clearTimeout(equipmentTimer.current);
    equipmentTimer.current = setTimeout(() => {
      setProfileError(null);
      saveEquipment(equipment).catch(e =>
        setProfileError({ kind: 'save', message: messageOf(e, 'Could not save your equipment.') }));
    }, 600);
  }, []);

  useEffect(() => () => {
    if (equipmentTimer.current) clearTimeout(equipmentTimer.current);
  }, []);

  const commitCheckin = useCallback((checkin: Checkin) => {
    dispatch({ type: 'set_checkin', checkin });
    // Buckets only (PRD §16). The symptom names are health free text and stay
    // out of analytics entirely; how many were reported is the analysable part.
    track({
      name: 'recovery_checkin_completed',
      sleep_bucket: bucketSleep(checkin.sleep_hours),
      soreness_bucket: bucketScale(checkin.soreness),
      symptom_count: checkin.symptoms.length,
    });
    if (authStatusRef.current !== 'signed_in') return;
    saveCheckin(checkin).then(saved => {
      if (saved) refreshToday();
    });
  }, [refreshToday]);

  /**
   * Today's answers as the server's endpoints take them. Derived from the same
   * state the local engine reads, so the row records the inputs the athlete
   * actually saw a decision for.
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * What the engine currently has the athlete doing, kept in a ref because the
   * decision is derived further down the file than the callbacks that need it.
   */
  const sessionRef = useRef<{ template_id: string; variant_code: VariantCode } | null>(null);

  /** The step list the athlete performed, for the same reason. */
  const stepsRef = useRef<Step[]>([]);

  /**
   * When the current session opened, as the stored record reports it.
   *
   * Kept in a ref rather than in state because nothing renders it: it exists so
   * a restored session keeps its original start time instead of being re-dated
   * to the moment it was read back off disk.
   */
  const startedAtRef = useRef<string | null>(null);

  /**
   * The whole decision, not just the two fields the server needs. §16's workout
   * events want the family and the estimated duration, which `sessionRef`
   * deliberately does not carry — it is spread straight into the start request,
   * so anything added to it would be sent to the server too.
   */
  const decisionRef = useRef<EngineDecision | null>(null);

  const adaptInputs = useCallback((): Omit<StartRequest, 'template_id' | 'variant_code'> => {
    const s = stateRef.current;
    const noEquipment = s.flags.includes('No equipment');
    const equipment = s.today_equipment ?? s.equipment;
    const effective = noEquipment ? bodyweightDay(equipment) : equipment;
    return {
      available_minutes: s.available_minutes,
      energy: s.energy,
      sleep_hours: s.checkin?.sleep_hours ?? null,
      low_impact: s.flags.includes('Need low impact'),
      symptom_flags: [...new Set([
        ...(s.checkin?.symptoms ?? []),
        ...(s.flags.includes('Something hurts') ? ['Something hurts'] : []),
      ])],
      // The server subtracts these from the athlete's saved gym, so a narrowed
      // day is expressed as what is missing rather than as a new equipment set.
      unavailable_equipment: s.equipment.filter(e => !effective.includes(e)),
    };
  }, []);

  /**
   * Opens the player on a decision that has already been made: the status the
   * elapsed-time ticker runs on, the analytics, and the server row.
   *
   * The decision arrives as an argument rather than being read from
   * `decisionRef`, and that is the whole point of the split. A supplemental is
   * chosen and started within one tick, and at that moment the ref still holds
   * the session the athlete has just finished — so a version of this that read
   * the ref would start the wrong thing, or nothing at all.
   */
  const openSession = useCallback((started: EngineDecision | null) => {
    dispatch({
      type: 'start_workout',
      // Both minted here, once, before anything is sent. The session's identity
      // does not wait on a server that may never answer.
      finish_event_id: eventId(),
      client_session_id: clientSessionId(),
      performed: started?.kind === 'session'
        ? {
            template_id: started.template.id,
            name: started.template.name,
            estimated_minutes: started.estimated_minutes,
          }
        : null,
    });

    startedAtRef.current = new Date().toISOString();

    if (started?.kind === 'session') {
      track({
        name: 'workout_started',
        template_id: started.template.id,
        family: started.template.workout_family,
        variant: started.variant.variant_code,
        estimated_minutes: started.estimated_minutes,
      });
      // The engine substitutes silently when equipment is missing, so this is
      // the moment a swap becomes real to the athlete — there is no separate
      // tap to hang it off.
      for (const swap of started.substitutions_applied) {
        track({
          name: 'exercise_substituted',
          from_exercise: swap.from,
          to_exercise: swap.to,
          reason: swap.reason,
        });
      }
    }

    if (authStatusRef.current !== 'signed_in') return;
    if (started?.kind !== 'session') return;

    // The row records the session the athlete is looking at, with any accepted
    // override already folded in.
    startSession({
      ...adaptInputs(),
      client_session_id: stateRef.current.client_session_id ?? undefined,
      template_id: started.template.id,
      variant_code: started.variant.variant_code,
    }).then(result => {
      if (result && 'session_id' in result) {
        dispatch({
          type: 'session_opened',
          session_id: result.session_id,
          revision: result.revision,
        });
      }
      // A refusal or a failure leaves the session unrecorded. The athlete is
      // already in the player either way; nothing here interrupts them.
    });
  }, [adaptInputs]);

  /**
   * Start, from Today or from Coach.
   *
   * The decision is read before the dispatch, because the dispatch is what the
   * record is made from: this is the decision the athlete tapped Start on,
   * override and all, and it is the last moment the app can say so.
   *
   * Tracked before the sign-in check, not after: a started workout is a started
   * workout whether or not the server accepted the row, and gating the event on
   * the write would quietly under-count every session that began offline —
   * which §15.1 explicitly expects to happen.
   */
  const beginSession = useCallback(() => openSession(decisionRef.current), [openSession]);

  /**
   * Writes the session to the outbox exactly as it currently stands.
   *
   * Called twice for one workout, on purpose. Once the moment the last step
   * ends, because at that point the athlete has done the training and
   * everything needed to record it is known — and the review screen that
   * follows is an unbounded wait during which the app may be backgrounded and
   * killed. Once again when they submit the review, now carrying the RPE.
   *
   * Both carry `finish_event_id`, so the second replaces the first in the queue
   * rather than joining it, and a server that has already accepted the first
   * treats the second as the correction it is. This is what closed the window
   * where a workout the UI had already called "completed" existed nowhere but
   * in memory.
   */
  const queueFinish = useCallback(async (s: State, opts: {
    /** False for the write made at the last step, before the review. */
    final: boolean;
  }) => {
    if (authStatusRef.current !== 'signed_in') return;

    const performed = stepsRef.current;
    const finished = decisionRef.current;

    /**
     * Steps the athlete actually reached. Ending early stops the count where
     * they stopped, so the rest of the session is absent from the record rather
     * than written down as a failure.
     */
    const completedCount = s.ended_early ? s.step_index : performed.length;
    const actuals = buildLogs(performed, s.step_seconds, completedCount, new Date(), s.entries);
    // The laps, in order. Same completion rule as the logs: the step the
    // athlete was in the middle of when they ended has no finished time, so it
    // is not a split.
    const splits = buildSplits(performed, s.step_seconds, completedCount);

    /**
     * Queued before it is sent, and queued even when there is no `session_id`.
     *
     * The old guard returned here on a missing id, which is how a workout whose
     * Start never reached the server was lost in full: the athlete had trained,
     * the app said so, and nothing was ever written down. The outbox opens the
     * session on the retry instead, so the finish has somewhere to attach.
     */
    const chosen = finished?.kind === 'session' ? finished : null;
    await enqueueFinish({
      client_event_id: s.finish_event_id ?? eventId(),
      // Held back until the review is submitted, or until a launch proves the
      // athlete never came back to it.
      provisional: !opts.final,
      local_date: todayRef.current?.date_local ?? localToday(),
      template_id: chosen?.template.id ?? s.performed?.template_id ?? '',
      name: chosen?.template.name ?? s.performed?.name ?? '',
      // Carried so a finish that outlives the process can still be named and
      // totalled by the screens, not just replayed to the server.
      estimated_minutes: chosen?.estimated_minutes ?? s.performed?.estimated_minutes,
      session_id: s.session_id,
      revision: s.session_revision,
      start: {
        ...adaptInputs(),
        // The retry re-presents the session's identity, so an outbox flush that
        // has to open the row resolves to the one this workout already has
        // rather than creating a second.
        client_session_id: s.client_session_id ?? undefined,
        template_id: chosen?.template.id ?? s.performed?.template_id ?? '',
        variant_code: chosen?.variant.variant_code,
      },
      finish: {
        session_rpe: s.session_rpe,
        ended_early: s.ended_early,
        ...actuals,
        splits,
      },
    });

    if (!opts.final) return;
    const result = await flushOutbox();
    // Refreshed on any successful send, not only on this one: a flush may
    // have cleared an older finish too, and the week's counters moved for
    // whichever of them landed.
    if (result.sent > 0) refreshToday();
  }, [adaptInputs, refreshToday]);

  /**
   * Records the finish the moment the session completes locally.
   *
   * The finish used to be written only when the athlete tapped through the
   * review screen. Between the last step and that tap the UI already said
   * "completed" while the workout existed in RAM alone — so an app backgrounded
   * on the summary and reclaimed by the OS lost a workout it had already
   * congratulated the athlete for.
   */
  useEffect(() => {
    if (state.status !== 'completed_pending_review') return;
    queueFinish(stateRef.current, { final: false });
  }, [state.status, queueFinish]);

  const finishSession = useCallback(() => {
    const s = stateRef.current;
    dispatch({ type: 'back_to_today' });

    const finished = decisionRef.current;
    if (finished?.kind === 'session') {
      track({
        name: 'workout_completed',
        family: finished.template.workout_family,
        variant: finished.variant.variant_code,
        actual_minutes: elapsedMinutes(s.elapsed_seconds),
        session_rpe: s.session_rpe,
        ended_early: s.ended_early,
      });
    }
    // Finishing is the likeliest moment for the athlete to put the phone down,
    // and a queued event in a killed process never happened.
    flushAnalytics();

    // The finish is already on disk from the last step; this rewrites it with
    // the RPE the athlete just gave and sends it.
    queueFinish(s, { final: true });
  }, [queueFinish]);

  /**
   * Discards the session, and says so to the server.
   *
   * The local dispatch is unconditional and immediate — the athlete has decided
   * — and the write follows it. A failed write is not surfaced: nothing of the
   * athlete's is at risk, and the server's own staleness bound retires the row
   * either way.
   */
  const discardSession = useCallback(() => {
    const sessionId = stateRef.current.session_id;
    dispatch({ type: 'end_and_discard' });
    if (authStatusRef.current !== 'signed_in' || !sessionId) return;
    abandonSession(sessionId);
  }, []);

  const commitAdaptation = useCallback((
    templateId: string, variant: VariantCode, forced = false,
  ) => {
    const s = stateRef.current;
    dispatch({ type: 'accept_adaptation', template_id: templateId, variant, forced });

    const before = decisionRef.current;
    track({
      name: 'adaptation_applied',
      from_variant: s.override_variant ?? (before?.kind === 'session'
        ? before.variant.variant_code : null),
      to_variant: variant,
      reason_codes: before?.reason_codes ?? [],
    });

    if (authStatusRef.current !== 'signed_in') return;

    const original = s.override_template_id ?? today?.recommendation?.template.id ?? null;
    recordAdaptation({
      ...adaptInputs(),
      original_template_id: original,
      original_variant: s.override_variant,
      force_template_id: templateId,
    });
  }, [adaptInputs, today]);

  const reportSymptom = useCallback((name: string) => {
    const current = stateRef.current.checkin ?? EMPTY_CHECKIN;
    if (current.symptoms.includes(name)) return;
    commitCheckin({ ...current, symptoms: [...current.symptoms, name] });
  }, [commitCheckin]);

  /**
   * Templates the local engine may choose from.
   *
   * `week.queue` is the server's own list for this week, so anything in it
   * belongs to the plan. With no plan — signed out, or the seeded build — the
   * bundled library is the right candidate set, because there is no queue to
   * contradict.
   */
  const planCandidates = useMemo(() => {
    /**
     * Never a supplemental, on any path.
     *
     * Supplementals are offered after a session by `supplementalOffer`, never
     * scheduled — the server excludes them from its candidate pool in
     * `loadContent` and this is the same exclusion for the local engine. It
     * matters most on the fallback below, which is the path the seeded and
     * signed-out builds actually take: without it, an eight-minute core routine
     * would compete to be today's session on time_fit alone.
     */
    const plannable = TEMPLATES.filter(t => (t.workout_role ?? 'primary') === 'primary');
    const queued = today?.week?.queue ?? [];
    if (!queued.length) return plannable;
    const ids = new Set<string>(queued.map(q => q.template_id));
    if (today?.recommendation?.template?.id) ids.add(today.recommendation.template.id);
    const inPlan = plannable.filter(t => ids.has(t.id));
    // A queue naming templates this build does not carry would otherwise leave
    // nothing to choose from; the library is a safer fallback than an empty set.
    return inPlan.length ? inPlan : plannable;
  }, [today]);

  const engineInput = useMemo<EngineInput>(() => {
    const noEquipment = state.flags.includes('No equipment');
    const equipment = state.today_equipment ?? state.equipment;
    /**
     * One sleep number, resolved once, for the engine and the screens alike.
     *
     * A logged check-in wins. Failing that the Adapt sheet's "Low sleep" flag
     * stands in with the seeded athlete's value, which is what the unconfigured
     * build runs on. Failing both it is null — unknown, not "slept well". The
     * engine only branches below five hours, so null and the 7.5 that used to
     * sit here produce the same recommendation; null is simply the truth, and
     * it is what lets Today show a neutral state instead of a number.
     */
    const reportedSleep = state.checkin?.sleep_hours
      ?? today?.recovery?.sleep_hours
      ?? null;
    return {
      local_date: today?.date_local ?? localToday(),
      // 'build' is the server's own default for an athlete with no phase, so
      // both sides reason the same way about a plan that does not exist yet.
      phase_type: (today?.phase?.type as EngineInput['phase_type']) ?? 'build',
      days_to_race: today?.active_race?.days_remaining ?? null,
      stimulus_requirements: today?.stimulus_requirements ?? [],
      recent_sessions: (today?.recent_sessions as EngineInput['recent_sessions']) ?? [],
      // Derived by the engine, not here — see `recoveryFromEnergy`. This was a
      // hard-coded `'okay'`, which is why the Full version of every session was
      // unreachable on the client while the server recommended it happily.
      recovery_state: recoveryFromEnergy(state.energy),
      energy: state.energy,
      sleep_hours: reportedSleep,
      available_minutes: state.available_minutes,
      available_equipment: noEquipment ? bodyweightDay(equipment) : equipment,
      low_impact_required: state.flags.includes('Need low impact'),
      // Both sources: what the athlete reported at check-in, which persists, and
      // the adapt sheet's flag, which does not. The check-in is why a symptom
      // reported this morning still constrains this evening's session.
      symptom_flags: [...new Set([
        ...(state.checkin?.symptoms ?? []),
        ...(state.flags.includes('Something hurts') ? ['Something hurts'] : []),
      ])],
      considerations: state.profile.considerations,
      /**
       * The plan's own queue, not the whole library.
       *
       * Running the local engine over every bundled template is what let it
       * invent a session belonging to no plan. Constrained to what the week
       * actually holds, a local re-run can only re-rank or re-size sessions the
       * server already queued — so the sheet can answer live without being able
       * to conjure anything. The recommended template is always included, since
       * the athlete is being offered variants of it.
       */
      candidates: planCandidates,
      substitutions: SUBSTITUTIONS,
      variation_tolerance: 1,
      /**
       * The same preference signal the server scores with.
       *
       * Fed from local state rather than from the payload so the Adapt sheet
       * re-ranks the moment a preference changes, and so the local engine and
       * the server engine answer from the same inputs — which is the whole
       * reason one implementation is shared between them.
       */
      preferred_families: Object.entries(preferences)
        .filter(([, r]) => r === 'love' || r === 'like').map(([k]) => k),
      avoided_families: Object.entries(preferences)
        .filter(([, r]) => r === 'rather_not').map(([k]) => k),
      // The third signal, kept separate from the other two all the way down.
      perceived_weaknesses: weaknesses,
    };
  }, [state.energy, state.flags, state.available_minutes, state.equipment,
      state.today_equipment, state.profile.considerations,
      state.checkin, today, planCandidates, preferences, weaknesses]);

  /**
   * The server's decision is authoritative when there is one — it is the one
   * written to `adaptation_events`. The local engine still runs so an adapted
   * session can be re-ranked without a round trip, and because both sides are
   * the same code fed the same inputs, the two agree.
   */
  /**
   * The athlete's day, as everything that has to file something under a date
   * should read it.
   *
   * The server's answer when there is one — it is computed from the stored
   * timezone and it is what every row is filed against — and the device's own
   * calendar until then. Resolved once here rather than re-derived at each call
   * site, which is how three of them ended up on UTC.
   */
  const localDate = today?.date_local ?? localToday();

  const plan = useMemo(
    /**
     * A finish still sitting in the outbox counts as completed.
     *
     * The reducer's own marker dies with the process, which is precisely how a
     * finished session came back as un-finished after a restart. The queue is
     * on disk, so it can answer the same question across launches — and it
     * stops answering it the moment the server confirms, because the entry is
     * then gone.
     */
    () => {
      /**
       * What was performed, preferring this run's own record and falling back
       * to the queued finish — which is the only one of the two that survives a
       * restart, and which is why the name lives on the outbox entry at all.
       */
      const queued = pendingFinishOn(pendingFinishes, localDate);
      const performed = state.performed ?? (queued && queued.name
        ? {
            template_id: queued.template_id,
            name: queued.name,
            estimated_minutes: queued.estimated_minutes ?? 0,
          }
        : null);

      /**
       * The session finished here, from this run if it happened in this run and
       * from the queue if it did not.
       *
       * Both name the same thing by the same id, so which one answers does not
       * change what is counted — it only changes whether the answer survives a
       * restart. The reducer's copy is preferred because it outlives the queue
       * entry by the length of one refetch, which is the gap it exists to cover.
       */
      const finishedHere: FinishedHere | null = state.completed_client_id
        ? { client_session_id: state.completed_client_id, on: state.completed_on ?? localDate }
        : (queued?.start.client_session_id
          ? { client_session_id: queued.start.client_session_id, on: queued.local_date }
          : null);

      return planView(today, finishedHere, performed);
    },
    [today, localDate, state.completed_client_id, state.completed_on, state.performed,
     pendingFinishes]);

  /**
   * Keeps the stored session in step with the one being performed.
   *
   * Two triggers rather than one. Structural changes — a step advanced, a load
   * typed, a pause, the server row arriving — are written immediately, because
   * each is something the athlete did that a crash would otherwise erase. The
   * clock is written every five seconds instead: `tick` fires once a second and
   * moves both `elapsed_seconds` and the current step's entry in
   * `step_seconds`, so persisting on it directly would mean a write per second
   * for the length of a workout. Five seconds of a stopwatch is the most this
   * can lose, which is a fair trade for not hammering storage all session.
   *
   * `ready` is the absence of a session, so it clears rather than writes — which
   * is what retires the record after a finish or a discard, both of which land
   * there.
   */
  const persistActive = useCallback(() => {
    const s = stateRef.current;
    if (s.status === 'ready') { clearActiveSession(); return; }

    const live = decisionRef.current;
    const template_id = s.performed?.template_id ?? (live?.kind === 'session' ? live.template.id : null);
    const variant = live?.kind === 'session' ? live.variant.variant_code : s.override_variant;
    // Nothing identifying the session means nothing worth restoring: the player
    // could not rebuild its steps from it.
    if (!template_id || !variant || !s.finish_event_id || !s.client_session_id) return;

    saveActiveSession({
      version: SCHEMA_VERSION,
      template_id,
      variant,
      name: s.performed?.name ?? (live?.kind === 'session' ? live.template.name : ''),
      estimated_minutes: s.performed?.estimated_minutes
        ?? (live?.kind === 'session' ? live.estimated_minutes : 0),
      status: s.status as ActiveStatus,
      step_index: s.step_index,
      elapsed_seconds: s.elapsed_seconds,
      step_seconds: s.step_seconds,
      entries: s.entries,
      session_rpe: s.session_rpe,
      ended_early: s.ended_early,
      session_id: s.session_id,
      session_revision: s.session_revision,
      client_session_id: s.client_session_id,
      finish_event_id: s.finish_event_id,
      local_date: todayRef.current?.date_local ?? localToday(),
      started_at: startedAtRef.current ?? new Date().toISOString(),
      saved_at: new Date().toISOString(),
    });
  }, []);

  useEffect(() => { persistActive(); }, [
    persistActive, state.status, state.step_index, state.entries,
    state.session_id, state.session_revision, state.session_rpe, state.ended_early,
    state.performed,
  ]);

  useEffect(() => {
    if (state.status !== 'active_block') return;
    if (state.elapsed_seconds % 5 !== 0) return;
    persistActive();
  }, [persistActive, state.status, state.elapsed_seconds]);

  /**
   * Puts back a session the last run did not finish.
   *
   * Runs once, on mount. A record past its window is dropped and its server row
   * closed — the same tidy-up `discardSession` does, for the case where the app
   * never got the chance. Nothing is lost by dropping it: a session that had
   * reached the review screen already wrote its finish to the outbox, which
   * replays on its own and does not depend on this at all.
   */
  useEffect(() => {
    let cancelled = false;
    loadActiveSession().then(record => {
      if (cancelled || !record) return;
      if (verdictFor(record, Date.now()) === 'discard') {
        clearActiveSession();
        if (record.session_id && authStatusRef.current === 'signed_in') {
          abandonSession(record.session_id);
        }
        return;
      }
      startedAtRef.current = record.started_at;
      dispatch({ type: 'restore_session', record });
    });
    return () => { cancelled = true; };
  }, []);

  const pendingSync = useMemo(() => ({
    pending: pendingFinishes.length,
    blocked: blockedFinishes(pendingFinishes).length,
  }), [pendingFinishes]);

  const localDecision = useMemo(() => recommend(engineInput, EXERCISES), [engineInput]);

  const decision = useMemo<EngineDecision>(() => {
    /**
     * Once the athlete has adjusted today's inputs, the live run answers.
     *
     * The Adapt sheet exists to change the recommendation as its questions are
     * answered; before this it dispatched to state that reached nothing, because
     * the server payload was returned unconditionally and the local run was
     * computed and discarded. The local engine is the same pure function the
     * server ran, now over the same plan's queue, with inputs that are current
     * rather than however the athlete felt when `today` was fetched.
     *
     * Until they adjust anything, the server's answer stands: it is what
     * `adaptation_events` recorded, and the default view should match it.
     */
    if (state.adapt_touched && today?.recommendation && localDecision.kind === 'session') {
      return localDecision;
    }
    if (today?.recommendation) return { kind: 'session', ...today.recommendation };
    if (today?.no_session) return { kind: 'no_session', ...today.no_session };
    /**
     * No server answer, and an account that should have had one.
     *
     * This fell through to `localDecision` — the engine run here against the
     * bundled content library — which invented a workout for an athlete with no
     * program at all. Plan listed it under "This week" beside "0 / 0 completed",
     * and Today offered a Start button for a session belonging to no plan. The
     * local run is a stand-in for having no account, not for having no plan.
     */
    if (authStatus === 'signed_in') {
      return today
        ? {
            kind: 'no_session',
            reason_codes: [],
            rationale: 'The plan has nothing queued for today.',
            guidance: 'Nothing is scheduled for today. Adjust what you have and '
              + "I'll build a session from it.",
          }
        : {
            kind: 'no_session',
            reason_codes: [],
            rationale: "Today's plan has not been read yet.",
            guidance: "Your plan hasn't loaded, so there is nothing to recommend "
              + 'from yet. Pull to retry once you are back online.',
          };
    }
    return localDecision;
  }, [today, localDecision, authStatus, state.adapt_touched]);

  // An accepted override still runs through the engine, so the same guardrails
  // apply to a session the athlete picked as to one the engine chose.
  const session = useMemo<EngineDecision>(() => {
    if (!state.override_template_id || !state.override_variant) return decision;
    const template = TEMPLATES.find(t => t.id === state.override_template_id);
    if (!template) return decision;
    /**
     * The chosen version, not just the chosen workout.
     *
     * `override_variant` was recorded and then dropped here: the forced run was
     * handed the whole template and re-picked the variant by score, which is
     * the same calculation that produced the recommendation in the first place
     * — so it returned the same one. That is why tapping Full or Micro under
     * "Other versions of this stimulus" closed the sheet and changed nothing.
     * Narrowing the candidate to the athlete's variant is what makes the tap
     * mean something; the guardrails in `eligibleVariants` still get the final
     * say, and refusing everything falls back to the engine's own pick.
     */
    const chosen = template.variants.filter(v => v.variant_code === state.override_variant);
    const forced = recommend(
      {
        ...engineInput,
        // Scoped to this forced run alone. `engineInput` itself is never given
        // the flag, so the engine's own recommendation — `decision`, and the
        // fallback on the line below — is always computed under the full
        // guardrails.
        athlete_override: state.override_forced,
        candidates: [{ ...template, variants: chosen.length ? chosen : template.variants }],
      },
      EXERCISES);
    return forced.kind === 'session' ? forced : decision;
  }, [decision, engineInput, state.override_template_id, state.override_variant,
      state.override_forced]);

  sessionRef.current = session.kind === 'session'
    ? { template_id: session.template.id, variant_code: session.variant.variant_code }
    : null;
  decisionRef.current = session;

  /**
   * Swaps a queued session in as today's, if the engine will have it.
   *
   * The week is a set of stimuli in rank order, not a calendar (PRD §2), so
   * which of them an athlete does today is genuinely theirs to choose. It runs
   * through the same forced `recommend` the Adapt sheet uses rather than being
   * assigned directly: the athlete picks the session, the engine still picks
   * the variant and still applies the guardrails. A template it will not build
   * today returns false so the caller can say so, instead of an override that
   * silently resolves back to the original.
   */
  /**
   * Applies a specific version of a workout the athlete picked themselves.
   *
   * Choosing the full version is the athlete saying they have that long, so the
   * time input moves with it rather than silently contradicting the choice —
   * otherwise `eligibleVariants` filters a 60-minute session straight back out
   * against a 45-minute answer given before they changed their mind. Recovery
   * is not treated the same way: the time is theirs to revise, the guardrail is
   * not, so a variant their recovery will not support returns false.
   */
  const chooseVariant = useCallback((
    templateId: string,
    variantCode: VariantCode,
    opts?: { override?: boolean },
  ): VariantChoice => {
    const template = TEMPLATES.find(t => t.id === templateId);
    const variant = template?.variants.find(v => v.variant_code === variantCode);
    if (!template || !variant) return { ok: false, reason: 'unavailable' };

    const needed = variantMinutes(template, variant);
    const available = Math.max(stateRef.current.available_minutes, needed);
    const base = {
      ...engineInput,
      available_minutes: available,
      candidates: [{ ...template, variants: [variant] }],
    };

    const override = opts?.override ?? false;
    const forced = recommend({ ...base, athlete_override: override }, EXERCISES);

    if (forced.kind !== 'session') {
      // Why it was refused, so the caller knows whether there is anything to
      // ask the athlete. A severe symptom is checked first because it is the
      // one answer that is not a negotiation — the engine stops on it before
      // any guardrail reads the override, and the UI must not offer to press on.
      if (hasSevereSymptom(engineInput.symptom_flags)) {
        return { ok: false, reason: 'symptom' };
      }
      // Would it build if the athlete overruled the recovery advice? If yes the
      // refusal was a judgement and can be put to them; if no it is equipment,
      // impact or a postpartum constraint, and confirming would change nothing.
      const ifOverridden = recommend({ ...base, athlete_override: true }, EXERCISES);
      return {
        ok: false,
        reason: ifOverridden.kind === 'session' ? 'recovery' : 'unavailable',
      };
    }

    if (available !== stateRef.current.available_minutes) {
      dispatch({ type: 'set_time', minutes: available });
    }
    commitAdaptation(templateId, variantCode, override);
    return { ok: true };
  }, [engineInput, commitAdaptation]);

  const switchToQueued = useCallback((
    templateId: string, opts?: { override?: boolean },
  ): VariantChoice => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) return { ok: false, reason: 'unavailable' };

    const base = { ...engineInput, candidates: [template] };
    const override = opts?.override ?? false;
    const forced = recommend({ ...base, athlete_override: override }, EXERCISES);

    if (forced.kind !== 'session') {
      if (hasSevereSymptom(engineInput.symptom_flags)) {
        return { ok: false, reason: 'symptom' };
      }
      const ifOverridden = recommend({ ...base, athlete_override: true }, EXERCISES);
      return {
        ok: false,
        reason: ifOverridden.kind === 'session' ? 'recovery' : 'unavailable',
      };
    }

    // The engine picked the variant here, so committing that same code is what
    // keeps the override and the decision describing one session.
    commitAdaptation(templateId, forced.variant.variant_code, override);
    return { ok: true };
  }, [engineInput, commitAdaptation]);

  const startSupplemental = useCallback((templateId: string): boolean => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) return false;
    const chosen = recommend({ ...engineInput, candidates: [template] }, EXERCISES);
    if (chosen.kind !== 'session') return false;
    // `back_to_today` has already cleared the finished session's step index,
    // timings, entries and RPE, so this opens a clean one rather than resuming
    // the player mid-session.
    dispatch({
      type: 'accept_adaptation',
      template_id: templateId,
      variant: chosen.variant.variant_code,
      forced: false,
    });
    // Choosing it is not starting it. Without this the player opened on a
    // supplemental that was never running: `start_workout` is what sets
    // `active_block`, and `active_block` is the only status the elapsed-time
    // ticker counts on — so the clock sat at 0:00 for the whole session. It is
    // also what opens the server row, so the supplemental was invisible to the
    // history, to `complete-workout`, and to the one-per-day guard that exists
    // to stop exactly this session being logged twice.
    openSession(chosen);
    return true;
  }, [engineInput, openSession]);

  const steps = useMemo(
    () => (session.kind === 'session' ? buildSteps(session, id => exerciseById.get(id)?.name) : []), [session]);
  stepsRef.current = steps;

  const readiness = useMemo(() => {
    // No payload means nothing has been measured. It used to mean the seeded
    // athlete's readiness — 232 aerobic minutes, a 16.2 km long run — shown as
    // though it were the viewer's. Null is the honest score, and every screen
    // already renders it as a dash.
    if (!today) {
      return {
        overall: null,
        confidence: 'low',
        components: Object.fromEntries(COMPONENT_KEYS.map(k => [k, 0])),
        observed: [],
      } as unknown as ReturnType<typeof computeReadiness>;
    }
    return {
      overall: today.readiness.overall,
      confidence: today.readiness.confidence,
      components: today.readiness.components,
      observed: today.readiness.observed ?? Object.keys(today.readiness.components),
    } as ReturnType<typeof computeReadiness>;
  }, [today]);

  /**
   * Per-component supporting stats. On a live account these are measured from
   * the athlete's own history; the bundled fixture stands in only for the
   * seeded build, where there is no account to measure.
   */
  /**
   * Coach's one-liners, fetched once per session when there is an account to
   * write about. Absent until it answers — and if it never does, the shipped
   * sentences stand.
   */
  // A rolled-over date returns the athlete to the server's answer for the new
  // day. Same-day refetches leave their adjustment standing.
  const lastDay = useRef<string | null>(null);
  useEffect(() => {
    const day = today?.date_local ?? null;
    if (!day) return;
    if (lastDay.current && lastDay.current !== day) dispatch({ type: 'new_day' });
    lastDay.current = day;
  }, [today?.date_local]);

  const [narration, setNarration] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!today) return;
    let cancelled = false;
    fetchProgressNarration().then(d => { if (!cancelled && d) setNarration(d); });
    return () => { cancelled = true; };
  }, [today?.date_local]);

  const metricDetailView = useMemo(
    () => metricDetail(today?.readiness.metric_detail, narration),
    [today, narration]);

  // Elapsed-time ticker. Runs only while a block is active, so pausing stops
  // the clock rather than merely hiding it.
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  useEffect(() => {
    const id = setInterval(() => {
      if (statusRef.current === 'active_block') dispatch({ type: 'tick' });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const sleep = useMemo(() => ({
    hours: engineInput.sleep_hours,
    source: engineInput.sleep_hours === null
      ? null
      : (today?.recovery?.source ?? 'self_reported'),
  }), [engineInput.sleep_hours, today]);

  const value = useMemo(
    () => ({
      state, dispatch, decision, session, steps, readiness,
      metricDetail: metricDetailView, guidance: today?.exercise_guidance ?? {},
      capability: today?.capability_state ?? [],
      trend: today?.performance_trend ?? null,
      preferences, setPreference, weaknesses, setWeakness,
      plan, sleep, engineInput,
      commitProfile, commitCheckin, commitEquipment, reportSymptom,
      beginSession, finishSession, discardSession, commitAdaptation, switchToQueued,
      startSupplemental,
      chooseVariant, pendingSync,
      profileError, refreshProfile, today, todayLoading, todayError, refreshToday,
      localDate,
    }),
    [state, decision, session, steps, readiness, metricDetailView, plan, sleep, engineInput, commitProfile,
     commitCheckin, commitEquipment, reportSymptom,
     preferences, setPreference, weaknesses, setWeakness,
     beginSession, finishSession, discardSession, commitAdaptation, switchToQueued,
     startSupplemental,
     chooseVariant, pendingSync,
     profileError, refreshProfile, today, todayLoading, todayError, refreshToday,
     localDate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export { ENGINE_VERSION };
