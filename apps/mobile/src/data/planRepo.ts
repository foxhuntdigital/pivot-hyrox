/**
 * Program provisioning and the content lookups onboarding needs.
 *
 * Plan generation is a server concern: `onboarding-plan` writes the race,
 * program, phases, weeks and stimulus targets in one place and records the
 * engine version behind them (PRD §12, §24). The client sends answers and
 * renders the summary it gets back — it does not periodize.
 */
import { supabase } from '@/lib/supabase';

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
  race: { id: string; event_name: string; event_date: string };
  total_weeks: number;
  phases: PhaseSummary[];
  current_phase: { phase_type: PhaseSummary['phase_type']; week: number; total_weeks: number } | null;
  first_week_stimuli: { stimulus_type: string; target_exposures: number; priority: number }[];
}

export interface PlanRequest {
  race: {
    event_name: string;
    event_date: string;
    division?: string | null;
    goal_type?: 'finish_healthy' | 'performance' | 'custom';
    goal_value?: string | null;
  };
  equipment?: string[];
  profile?: {
    typical_session_minutes?: number;
    /** 0–1, where 1 is fully unpredictable. See `data/profile.ts`. */
    schedule_predictability?: number;
    impact_tolerance?: 'low' | 'normal' | 'high';
    considerations?: string[];
  };
}

/**
 * Whether the athlete already has a plan. Null when Supabase is unconfigured,
 * which the caller reads as "not applicable" rather than "no plan" — the seeded
 * build should not be pushed into onboarding it cannot complete.
 */
export async function fetchActiveProgram(): Promise<{ id: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('programs').select('id').eq('status', 'active').limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
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
  if (error) throw new Error(error.message + (error.hint ? ` (${error.hint})` : ''));
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
