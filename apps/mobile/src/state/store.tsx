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
import {
  recommend, computeReadiness, ENGINE_VERSION,
  type EngineDecision, type EngineInput, type Energy, type VariantCode,
} from '@pivot/engine';
import { EXERCISES, TEMPLATES, SUBSTITUTIONS } from '../data/content';
import { metricDetail, type MetricDetail } from '../data/metrics';
import { EMPTY_PROFILE, type AthleteProfile, type ExperienceLevel } from '../data/profile';
import { fetchProfile, saveProfile } from '../data/profileRepo';
import { fetchToday, type TodayPayload } from '../data/todayRepo';
import { saveCheckin, EMPTY_CHECKIN, type Checkin } from '../data/recoveryRepo';
import { fetchProgressNarration } from '../data/coachRepo';
import {
  completeSession, eventId, startSession, type StartRequest,
} from '../data/sessionRepo';
import { recordAdaptation } from '../data/adaptRepo';
import { fetchEquipment, saveEquipment } from '../data/equipmentRepo';
import { planView, type PlanView } from '../data/plan';
import { COMPONENT_KEYS } from '@pivot/coach';
import { useSession } from './session';
import { buildSteps, type Step } from './steps';

/** PRD §8.4. */
export type WorkoutStatus =
  | 'ready' | 'active_block' | 'paused'
  | 'completed_pending_review' | 'completed' | 'abandoned';

interface State {
  /** Editable athlete profile (D22). Hydrated from Supabase when signed in. */
  profile: AthleteProfile;

  // Adaptation inputs
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

  /** Set when the athlete accepts an adaptation, overriding the engine's pick. */
  override_template_id: string | null;
  override_variant: VariantCode | null;
  adapted: boolean;

  // Active workout
  status: WorkoutStatus;
  step_index: number;
  elapsed_seconds: number;
  session_rpe: number | null;
  ended_early: boolean;
  /** Completed sessions this week, appended on finish. */
  completed_today: boolean;

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

  available_minutes: 45,
  energy: 'normal',
  flags: [],
  equipment: [],
  today_equipment: null,
  travel: null,
  checkin: null,

  session_id: null,
  session_revision: 0,

  override_template_id: null,
  override_variant: null,
  adapted: false,

  status: 'ready',
  step_index: 0,
  elapsed_seconds: 0,
  session_rpe: null,
  ended_early: false,
  completed_today: false,

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
  | { type: 'accept_adaptation'; template_id: string; variant: VariantCode }
  | { type: 'set_today_equipment'; equipment: string[] | null }
  | { type: 'set_travel'; travel: State['travel'] }
  | { type: 'set_checkin'; checkin: Checkin }
  | { type: 'restore'; snapshot: Restorable }
  | { type: 'start_workout' }
  | { type: 'session_opened'; session_id: string; revision: number }
  | { type: 'next_step'; total: number }
  | { type: 'tick' }
  | { type: 'toggle_pause' }
  | { type: 'end_and_save' }
  | { type: 'end_and_discard' }
  | { type: 'set_rpe'; rpe: number }
  | { type: 'back_to_today' }
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

    case 'set_time':
      return { ...s, available_minutes: a.minutes };
    case 'set_energy':
      return { ...s, energy: a.energy };
    case 'toggle_flag': {
      const flags = s.flags.includes(a.flag)
        ? s.flags.filter(f => f !== a.flag) : [...s.flags, a.flag];
      // "No equipment" is an adaptation input, not a profile edit — it narrows
      // the engine's equipment set for today without touching the saved gym.
      return { ...s, flags };
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
      return { ...s, override_template_id: a.template_id, override_variant: a.variant, adapted: true };
    case 'set_today_equipment':
      return { ...s, today_equipment: a.equipment };
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
        ...s, status: 'active_block', step_index: 0, elapsed_seconds: 0, ended_early: false,
        // Cleared here rather than on finish: the id belongs to the session
        // being performed, and a new one starts without the last one's row.
        session_id: null, session_revision: 0,
      };
    case 'session_opened':
      return { ...s, session_id: a.session_id, session_revision: a.revision };
    case 'tick':
      return s.status === 'active_block'
        ? { ...s, elapsed_seconds: s.elapsed_seconds + 1 } : s;
    case 'next_step':
      return s.step_index >= a.total - 1
        ? { ...s, status: 'completed_pending_review', completed_today: true }
        : { ...s, step_index: s.step_index + 1 };
    case 'toggle_pause':
      return { ...s, status: s.status === 'paused' ? 'active_block' : 'paused' };
    case 'end_and_save':
      return { ...s, status: 'completed_pending_review', ended_early: true, completed_today: true };
    case 'end_and_discard':
      // Abandoned, not completed: nothing is logged and the stimulus stays open.
      return { ...s, status: 'ready', step_index: 0, elapsed_seconds: 0 };
    case 'set_rpe':
      return { ...s, session_rpe: a.rpe };
    case 'back_to_today':
      return {
        ...s, status: 'ready', step_index: 0, elapsed_seconds: 0, session_rpe: null,
        session_id: null, session_revision: 0,
      };

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
   * Applies an accepted adaptation and records it. The apply is local and
   * immediate; the record is the audit row (PRD §24).
   */
  commitAdaptation(templateId: string, variant: VariantCode): void;
  profileError: string | null;
  /**
   * Server state backing the decision. Null on an unconfigured build, which
   * runs on the seeded athlete instead (see `athlete.ts`).
   */
  today: TodayPayload | null;
  todayLoading: boolean;
  todayError: string | null;
  /** Re-fetches today's decision — after completing a session, or on pull. */
  refreshToday(): void;
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { status: authStatus } = useSession();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [todayNonce, setTodayNonce] = useState(0);

  // Today's decision comes from the server so it is recorded against the engine
  // version that produced it (PRD §24). A failure leaves `today` null and the
  // seed showing, with the error surfaced rather than swallowed.
  useEffect(() => {
    if (authStatus !== 'signed_in') return;
    let cancelled = false;
    setTodayLoading(true);
    setTodayError(null);
    fetchToday()
      .then(payload => { if (!cancelled) setToday(payload); })
      .catch(e => {
        if (!cancelled) setTodayError(e instanceof Error ? e.message : 'Could not load today');
      })
      .finally(() => { if (!cancelled) setTodayLoading(false); });
    return () => { cancelled = true; };
  }, [authStatus, todayNonce]);

  const refreshToday = useCallback(() => setTodayNonce(n => n + 1), []);

  // Hydrate the profile once a session exists. Unconfigured builds keep the
  // seeded athlete, which is why this is gated on the status rather than run
  // unconditionally and allowed to fail.
  useEffect(() => {
    if (authStatus !== 'signed_in') return;
    let cancelled = false;
    fetchProfile('')
      .then(profile => {
        if (!cancelled && profile) dispatch({ type: 'hydrate_profile', profile });
      })
      .catch(e => {
        if (!cancelled) setProfileError(e instanceof Error ? e.message : 'Could not load profile');
      });
    return () => { cancelled = true; };
  }, [authStatus]);

  // The athlete's saved gym. Separate from the profile fetch because it is a
  // separate table, and because a failed equipment read must not cost the
  // profile — the two are useful independently.
  useEffect(() => {
    if (authStatus !== 'signed_in') return;
    let cancelled = false;
    fetchEquipment()
      .then(equipment => {
        if (!cancelled && equipment) dispatch({ type: 'hydrate_equipment', equipment });
      })
      .catch(e => {
        if (!cancelled) setProfileError(e instanceof Error ? e.message : 'Could not load equipment');
      });
    return () => { cancelled = true; };
  }, [authStatus]);

  const authStatusRef = useRef(authStatus);
  authStatusRef.current = authStatus;

  const commitProfile = useCallback((patch: Partial<AthleteProfile>) => {
    if (authStatusRef.current !== 'signed_in') return;
    setProfileError(null);
    saveProfile(patch).catch(e =>
      setProfileError(e instanceof Error ? e.message : 'Could not save profile'));
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
        setProfileError(e instanceof Error ? e.message : 'Could not save equipment'));
    }, 600);
  }, []);

  useEffect(() => () => {
    if (equipmentTimer.current) clearTimeout(equipmentTimer.current);
  }, []);

  const commitCheckin = useCallback((checkin: Checkin) => {
    dispatch({ type: 'set_checkin', checkin });
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

  const adaptInputs = useCallback((): Omit<StartRequest, 'template_id' | 'variant_code'> => {
    const s = stateRef.current;
    const noEquipment = s.flags.includes('No equipment');
    const effective = noEquipment ? ['bodyweight'] : (s.today_equipment ?? s.equipment);
    return {
      available_minutes: s.available_minutes,
      energy: s.energy,
      sleep_hours: s.checkin?.sleep_hours ?? null,
      low_impact: s.flags.includes('Need low impact'),
      symptom_flags: s.flags.includes('Something hurts') ? ['Something hurts'] : [],
      // The server subtracts these from the athlete's saved gym, so a narrowed
      // day is expressed as what is missing rather than as a new equipment set.
      unavailable_equipment: s.equipment.filter(e => !effective.includes(e)),
    };
  }, []);

  const beginSession = useCallback(() => {
    dispatch({ type: 'start_workout' });
    if (authStatusRef.current !== 'signed_in') return;

    // The engine's current answer, which already has any accepted override
    // folded in — so the row records the session the athlete is looking at.
    const chosen = sessionRef.current;
    if (!chosen) return;

    startSession({ ...adaptInputs(), ...chosen }).then(result => {
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

  const finishSession = useCallback(() => {
    const s = stateRef.current;
    dispatch({ type: 'back_to_today' });
    if (!s.session_id || authStatusRef.current !== 'signed_in') return;

    completeSession({
      session_id: s.session_id,
      client_event_id: eventId(),
      // The server treats a revision below the stored one as stale, so a
      // finish always advances past the revision Start handed back.
      revision: s.session_revision + 1,
      session_rpe: s.session_rpe,
      ended_early: s.ended_early,
    }).then(done => {
      // Refresh only on a recorded finish: the week's counters just moved.
      if (done) refreshToday();
    });
  }, [refreshToday]);

  const commitAdaptation = useCallback((templateId: string, variant: VariantCode) => {
    const s = stateRef.current;
    dispatch({ type: 'accept_adaptation', template_id: templateId, variant });
    if (authStatusRef.current !== 'signed_in') return;

    const original = s.override_template_id ?? today?.recommendation?.template.id ?? null;
    recordAdaptation({
      ...adaptInputs(),
      original_template_id: original,
      original_variant: s.override_variant,
      force_template_id: templateId,
    });
  }, [adaptInputs, today]);

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
      local_date: today?.date_local ?? new Date().toISOString().slice(0, 10),
      // 'build' is the server's own default for an athlete with no phase, so
      // both sides reason the same way about a plan that does not exist yet.
      phase_type: (today?.phase?.type as EngineInput['phase_type']) ?? 'build',
      days_to_race: today?.active_race?.days_remaining ?? null,
      stimulus_requirements: today?.stimulus_requirements ?? [],
      recent_sessions: (today?.recent_sessions as EngineInput['recent_sessions']) ?? [],
      recovery_state: 'okay',
      energy: state.energy,
      sleep_hours: reportedSleep,
      available_minutes: state.available_minutes,
      available_equipment: noEquipment ? ['bodyweight'] : equipment,
      low_impact_required: state.flags.includes('Need low impact'),
      symptom_flags: state.flags.includes('Something hurts') ? ['Something hurts'] : [],
      considerations: state.profile.considerations,
      candidates: TEMPLATES,
      substitutions: SUBSTITUTIONS,
      variation_tolerance: 1,
    };
  }, [state.energy, state.flags, state.available_minutes, state.equipment,
      state.today_equipment, state.profile.considerations,
      state.checkin, today]);

  /**
   * The server's decision is authoritative when there is one — it is the one
   * written to `adaptation_events`. The local engine still runs so an adapted
   * session can be re-ranked without a round trip, and because both sides are
   * the same code fed the same inputs, the two agree.
   */
  const plan = useMemo(
    () => planView(today, state.completed_today), [today, state.completed_today]);

  const localDecision = useMemo(() => recommend(engineInput, EXERCISES), [engineInput]);

  const decision = useMemo<EngineDecision>(() => {
    if (today?.recommendation) return { kind: 'session', ...today.recommendation };
    if (today?.no_session) return { kind: 'no_session', ...today.no_session };
    return localDecision;
  }, [today, localDecision]);

  // An accepted override still runs through the engine, so the same guardrails
  // apply to a session the athlete picked as to one the engine chose.
  const session = useMemo<EngineDecision>(() => {
    if (!state.override_template_id || !state.override_variant) return decision;
    const template = TEMPLATES.find(t => t.id === state.override_template_id);
    if (!template) return decision;
    const forced = recommend(
      { ...engineInput, candidates: [template] }, EXERCISES);
    return forced.kind === 'session' ? forced : decision;
  }, [decision, engineInput, state.override_template_id, state.override_variant]);

  sessionRef.current = session.kind === 'session'
    ? { template_id: session.template.id, variant_code: session.variant.variant_code }
    : null;

  const steps = useMemo(
    () => (session.kind === 'session' ? buildSteps(session) : []), [session]);

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
      metricDetail: metricDetailView, plan, sleep, engineInput,
      commitProfile, commitCheckin, commitEquipment,
      beginSession, finishSession, commitAdaptation,
      profileError, today, todayLoading, todayError, refreshToday,
    }),
    [state, decision, session, steps, readiness, metricDetailView, plan, sleep, engineInput, commitProfile,
     commitCheckin, commitEquipment, beginSession, finishSession, commitAdaptation,
     profileError, today, todayLoading, todayError, refreshToday]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export { ENGINE_VERSION };
