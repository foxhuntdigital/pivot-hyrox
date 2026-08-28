/**
 * Onboarding draft and gate (PRD §6.1, D02–D08).
 *
 * Answers are held here rather than passed through route params: the flow is
 * seven screens that submit once at the end, and a back-navigation must not
 * lose what was already answered.
 *
 * The draft is deliberately not persisted. An abandoned onboarding resumes from
 * the start on the next launch, which is honest — nothing was created server
 * side, so there is no half-made plan to resume into.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

import {
  createPlan, fetchActiveProgram, type PlanSummary, type PlanTarget,
} from '@/data/planRepo';
import { track } from '@/lib/analytics';
import { useSession } from './session';

export type Goal = 'finish_healthy' | 'performance' | 'custom';

/**
 * What the plan is built from. An athlete with an entry counts back from it; an
 * athlete without one picks how many weeks to train for. There is no third
 * option — an open-ended plan has no phases, because every phase length here is
 * a proportion of the runway.
 */
export type PlanMode = 'race' | 'block';

export interface OnboardingDraft {
  sport: string;
  goal_type: Goal;
  plan_mode: PlanMode;
  event_name: string;
  event_date: string | null;
  division: string | null;
  /** Length of the program when `plan_mode` is 'block'. */
  block_weeks: number;
  experience_level: 'beginner' | 'intermediate' | 'advanced';
  training_age_years: number | null;
  equipment: string[];
  typical_session_minutes: number;
  schedule_predictability: number;
  impact_tolerance: 'low' | 'normal' | 'high';
  considerations: string[];
  health_connected: boolean;
}

/**
 * `checking` is distinct from `needed`: routing an athlete into onboarding
 * before the lookup returns would flash the flow at someone who already has a
 * plan.
 */
export type OnboardingStatus = 'checking' | 'needed' | 'complete' | 'not_applicable';

interface OnboardingStore {
  status: OnboardingStatus;
  draft: OnboardingDraft;
  update(patch: Partial<OnboardingDraft>): void;
  submit(): Promise<PlanSummary>;
  summary: PlanSummary | null;
  recheck(): void;
}

const EMPTY_DRAFT: OnboardingDraft = {
  sport: 'hyrox',
  goal_type: 'performance',
  plan_mode: 'race',
  event_name: '',
  event_date: null,
  division: null,
  block_weeks: 12,
  experience_level: 'intermediate',
  training_age_years: null,
  equipment: [],
  typical_session_minutes: 45,
  schedule_predictability: 0.5,
  impact_tolerance: 'normal',
  considerations: [],
  health_connected: false,
};

const Ctx = createContext<OnboardingStore | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus } = useSession();
  const [status, setStatus] = useState<OnboardingStatus>('checking');
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // Without credentials the app runs on the seeded athlete, who already has a
    // plan to look at. Onboarding would write nowhere.
    if (authStatus === 'unconfigured') { setStatus('not_applicable'); return; }
    if (authStatus !== 'signed_in') { setStatus('checking'); return; }

    let cancelled = false;
    setStatus('checking');

    /**
     * A floor under the lookup, independent of the request.
     *
     * `fetchActiveProgram` carries its own timeout, but the splash is held open
     * by this status and nothing else — so if the call ever fails to settle for
     * a reason its own timeout does not cover, the app must still open. Falling
     * through to `complete` is the same policy the catch below uses, and for the
     * same reason: an athlete stuck behind a splash can do nothing at all.
     */
    const escape = setTimeout(() => {
      if (!cancelled) setStatus(s => (s === 'checking' ? 'complete' : s));
    }, 12_000);

    fetchActiveProgram()
      .then(program => {
        if (cancelled) return;
        setStatus(program ? 'complete' : 'needed');
        // Fired where the flow is decided rather than on the first screen's
        // mount, so a back-navigation through `/goal` cannot count as a second
        // start. `source` is the route gate because that is what sent them.
        if (!program) track({ name: 'onboarding_started', source: 'auth_gate' });
      })
      .catch(() => {
        // A failed lookup is not evidence of a missing plan. Falling through to
        // the app shows an error state there rather than trapping the athlete
        // in an onboarding flow they may not need.
        if (!cancelled) setStatus('complete');
      });
    return () => { cancelled = true; clearTimeout(escape); };
  }, [authStatus, nonce]);

  const update = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft(d => ({ ...d, ...patch }));
  }, []);

  const recheck = useCallback(() => setNonce(n => n + 1), []);

  const submit = useCallback(async () => {
    let target: PlanTarget;
    if (draft.plan_mode === 'race') {
      if (!draft.event_date) throw new Error('A race date is required.');
      target = {
        race: {
          event_name: draft.event_name.trim() || 'My race',
          event_date: draft.event_date,
          division: draft.division,
          goal_type: draft.goal_type,
        },
      };
    } else {
      target = { block: { weeks: draft.block_weeks } };
    }

    const plan = await createPlan({
      ...target,
      equipment: draft.equipment,
      profile: {
        typical_session_minutes: draft.typical_session_minutes,
        schedule_predictability: draft.schedule_predictability,
        impact_tolerance: draft.impact_tolerance,
        considerations: draft.considerations,
      },
    });
    setSummary(plan);
    track({
      name: 'onboarding_completed',
      sport: draft.sport,
      race_added: draft.plan_mode === 'race',
      health_connected: draft.health_connected,
    });
    // Status flips only after the server confirms, so a failed submit leaves
    // the athlete in onboarding with their answers intact.
    setStatus('complete');
    return plan;
  }, [draft]);

  const value = useMemo<OnboardingStore>(
    () => ({ status, draft, update, submit, summary, recheck }),
    [status, draft, update, submit, summary, recheck],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboarding(): OnboardingStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return v;
}
