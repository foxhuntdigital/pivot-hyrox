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
import React, { createContext, useContext, useMemo, useReducer, useEffect, useRef } from 'react';
import {
  recommend, computeReadiness, ENGINE_VERSION,
  type EngineDecision, type EngineInput, type Energy, type VariantCode,
} from '@pivot/engine';
import { EXERCISES, TEMPLATES, SUBSTITUTIONS } from '../data/content';
import {
  DEFAULT_CONSIDERATIONS, DEFAULT_EQUIPMENT, PHASE, RACE,
  READINESS_INPUTS, RECENT_SESSIONS, WEEK_STIMULI,
} from '../data/athlete';
import { buildSteps, type Step } from './steps';

/** PRD §8.4. */
export type WorkoutStatus =
  | 'ready' | 'active_block' | 'paused'
  | 'completed_pending_review' | 'completed' | 'abandoned';

interface State {
  // Adaptation inputs
  available_minutes: number;
  energy: Energy;
  flags: string[];
  equipment: string[];
  considerations: string[];
  typical_minutes: number;
  sleep_hours: number;

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
  queue_reordered: boolean;
}

const initialState: State = {
  available_minutes: 60,
  energy: 'normal',
  flags: ['Low sleep'],
  equipment: DEFAULT_EQUIPMENT,
  considerations: DEFAULT_CONSIDERATIONS,
  typical_minutes: 45,
  sleep_hours: 4.17,

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
  queue_reordered: false,
};

type Action =
  | { type: 'set_time'; minutes: number }
  | { type: 'set_energy'; energy: Energy }
  | { type: 'toggle_flag'; flag: string }
  | { type: 'toggle_equipment'; id: string }
  | { type: 'toggle_consideration'; name: string }
  | { type: 'set_typical'; minutes: number }
  | { type: 'accept_adaptation'; template_id: string; variant: VariantCode }
  | { type: 'start_workout' }
  | { type: 'next_step'; total: number }
  | { type: 'tick' }
  | { type: 'toggle_pause' }
  | { type: 'end_and_save' }
  | { type: 'end_and_discard' }
  | { type: 'set_rpe'; rpe: number }
  | { type: 'back_to_today' }
  | { type: 'toggle_metric'; key: string }
  | { type: 'toggle_queue_order' };

function reducer(s: State, a: Action): State {
  switch (a.type) {
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
    case 'toggle_consideration':
      return {
        ...s,
        considerations: s.considerations.includes(a.name)
          ? s.considerations.filter(c => c !== a.name) : [...s.considerations, a.name],
      };
    case 'set_typical':
      return { ...s, typical_minutes: a.minutes };

    case 'accept_adaptation':
      return { ...s, override_template_id: a.template_id, override_variant: a.variant, adapted: true };

    case 'start_workout':
      return { ...s, status: 'active_block', step_index: 0, elapsed_seconds: 0, ended_early: false };
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
      return { ...s, status: 'ready', step_index: 0, elapsed_seconds: 0, session_rpe: null };

    case 'toggle_metric':
      return { ...s, open_metric: s.open_metric === a.key ? null : a.key };
    case 'toggle_queue_order':
      return { ...s, queue_reordered: !s.queue_reordered };
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
  engineInput: EngineInput;
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const engineInput = useMemo<EngineInput>(() => {
    const noEquipment = state.flags.includes('No equipment');
    return {
      local_date: new Date().toISOString().slice(0, 10),
      phase_type: PHASE.type,
      days_to_race: RACE.days_remaining,
      stimulus_requirements: WEEK_STIMULI,
      recent_sessions: RECENT_SESSIONS,
      recovery_state: 'okay',
      energy: state.energy,
      sleep_hours: state.flags.includes('Low sleep') ? state.sleep_hours : 7.5,
      available_minutes: state.available_minutes,
      available_equipment: noEquipment ? ['bodyweight'] : state.equipment,
      low_impact_required: state.flags.includes('Need low impact'),
      symptom_flags: state.flags.includes('Something hurts') ? ['Something hurts'] : [],
      considerations: state.considerations,
      candidates: TEMPLATES,
      substitutions: SUBSTITUTIONS,
      variation_tolerance: 1,
    };
  }, [state.energy, state.flags, state.available_minutes, state.equipment,
      state.considerations, state.sleep_hours]);

  const decision = useMemo(() => recommend(engineInput, EXERCISES), [engineInput]);

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

  const steps = useMemo(
    () => (session.kind === 'session' ? buildSteps(session) : []), [session]);

  const readiness = useMemo(() => computeReadiness(READINESS_INPUTS), []);

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

  const value = useMemo(
    () => ({ state, dispatch, decision, session, steps, readiness, engineInput }),
    [state, decision, session, steps, readiness, engineInput]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export { ENGINE_VERSION };
