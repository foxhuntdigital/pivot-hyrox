/**
 * Program provisioning and the content lookups onboarding needs.
 *
 * Plan generation is a server concern: `onboarding-plan` writes the race,
 * program, phases, weeks and stimulus targets in one place and records the
 * engine version behind them (PRD §12, §24). The client sends answers and
 * renders the summary it gets back — it does not periodize.
 */
import { supabase } from '@/lib/supabase';
import { postgrestError } from './postgrest';

export interface EquipmentOption {
  id: string;
  name: string;
  category: string;
}

export interface PhaseSummary {
  phase_type: 'foundation' | 'build' | 'specific' | 'peak' | 'taper' | 'race';
  phase_order: number;
  start_date: string;
  end_date: string;
  weeks: number;
}

export interface PlanSummary {
  program_id: string;
  version: number;
  /** Null for a block — an athlete training without an event entered. */
  race: { id: string; event_name: string; event_date: string } | null;
  /** Set for a block, null for a race plan. The two are mutually exclusive. */
  block: { weeks: number; end_date: string } | null;
  total_weeks: number;
  phases: PhaseSummary[];
  current_phase: { phase_type: PhaseSummary['phase_type']; week: number; total_weeks: number } | null;
  first_week_stimuli: { stimulus_type: string; target_exposures: number; priority: number }[];
}

/**
 * A plan is built from one of two things: a race to count back from, or a
 * length to count forward over. The union is exclusive at the type level
 * because it is exclusive on the server — sending both is a 400.
 */
export type PlanTarget =
  | {
      race: {
        event_name: string;
        event_date: string;
        division?: string | null;
        goal_type?: 'finish_healthy' | 'performance' | 'custom';
        goal_value?: string | null;
      };
      block?: never;
    }
  | { block: { weeks: number }; race?: never };

/** Block lengths the server accepts. Mirrors `_shared/periodization.ts`. */
export const MIN_BLOCK_WEEKS = 4;
export const MAX_BLOCK_WEEKS = 24;

export type PlanRequest = PlanTarget & {
  equipment?: string[];
  profile?: {
    typical_session_minutes?: number;
    /** 0–1, where 1 is fully unpredictable. See `data/profile.ts`. */
    schedule_predictability?: number;
    impact_tolerance?: 'low' | 'normal' | 'high';
    considerations?: string[];
    /** 1-4. What the athlete can absorb; sizes the first week (migration 0023). */
    load_capacity?: number | null;
    /** 1-4. How technical a session they can perform well. */
    technical_capacity?: number | null;
  };
}

/**
 * How long the program lookup is given before the app stops waiting on it.
 *
 * This call gates the splash screen: the app holds the mark on screen until it
 * knows whether the athlete has a plan, because routing before then would flash
 * onboarding at someone who already has one. With no bound on the request, a
 * cold launch whose token refresh stalls left the splash up indefinitely with
 * no error, no spinner and no way forward — the app simply never opened. Eight
 * seconds is far longer than the call takes and far shorter than a hang.
 */
const PROGRAM_LOOKUP_TIMEOUT_MS = 8_000;

/**
 * Whether the athlete already has a plan. Null when Supabase is unconfigured,
 * which the caller reads as "not applicable" rather than "no plan" — the seeded
 * build should not be pushed into onboarding it cannot complete.
 *
 * Throws rather than hanging when the lookup outlives its timeout. The caller
 * treats a failed lookup as "assume they have a plan" and lets the app show its
 * own error state, which is the right call here too: an athlete stuck on a
 * splash has nothing, while one let through sees Today report what went wrong.
 */
export async function fetchActiveProgram(): Promise<{ id: string } | null> {
  if (!supabase) return null;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), PROGRAM_LOOKUP_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from('programs').select('id').eq('status', 'active').limit(1)
      .abortSignal(abort.signal)
      .maybeSingle();
    if (error) throw postgrestError(error);
    return data ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The curated equipment list. Read from `content` rather than hardcoded so the
 * options an athlete sees are the ones the engine can actually select against.
 */
export async function fetchEquipment(): Promise<EquipmentOption[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .schema('content').from('equipment').select('id, name, category').order('category');
  // PostgrestError is a plain object, not an Error, so rethrowing it as-is left
  // every caller's `instanceof Error` check false and the real cause — schema
  // not exposed, permission denied — replaced by a generic fallback message.
  if (error) throw postgrestError(error);
  return (data ?? []) as EquipmentOption[];
}

/**
 * Creates the athlete's program. Called once from onboarding and again whenever
 * an edit reshapes the plan — the server supersedes the prior version rather
 * than mutating it, so completed sessions keep the plan they were performed
 * under.
 */
export async function createPlan(request: PlanRequest): Promise<PlanSummary> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('onboarding-plan', {
    body: request,
  });
  if (error) {
    // Edge function failures carry their message in the response body rather
    // than the error, so surface that when it is there.
    const detail = await readFunctionError(error);
    throw new Error(detail ?? error.message);
  }
  return data as PlanSummary;
}

/**
 * Renames a race, or changes its division, without touching the program.
 *
 * The distinction this exists to draw: a race date is the runway, and changing
 * it means the plan has to be rebuilt around it. A name and a division are
 * labels on that runway — no phase boundary moves — so correcting a typo goes
 * straight to the row rather than through `createPlan`, which would supersede
 * the program and restart the athlete at week 1 of a new one.
 *
 * Owner-scoped by RLS; the id is passed so the update names its target rather
 * than relying on the one-active-race index to make a filter unambiguous.
 */
export async function updateRaceDetails(
  raceId: string, patch: { event_name: string; division: string | null },
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('races')
    .update({ event_name: patch.event_name, division: patch.division })
    .eq('id', raceId);
  if (error) throw postgrestError(error);
}

/**
 * supabase-js wraps a non-2xx response in a FunctionsHttpError whose `context`
 * is the raw Response. The useful message is inside it.
 */
async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}
