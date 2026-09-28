/**
 * Reads and writes public.athlete_profiles.
 *
 * No query filters by user: RLS already restricts every row to its owner, and
 * adding a client-side predicate would imply the client is what enforces it.
 */
import { supabase } from '@/lib/supabase';
import { postgrestError } from './postgrest';
import {
  clampPredictability, clampSessionMinutes, isExperienceLevel, readConsiderations,
  type AthleteProfile, type ExperienceLevel,
} from './profile';

// One string literal, not a concatenation: supabase-js infers the row type from
// the literal, and a computed string degrades it to an error type.
// eslint-disable-next-line max-len
const COLUMNS = 'user_id, display_name, experience_level, postpartum_birth_date, schedule_predictability, considerations, typical_session_minutes, load_capacity, technical_capacity';

interface Row {
  user_id: string;
  display_name: string | null;
  experience_level: string;
  load_capacity: number | null;
  technical_capacity: number | null;
  postpartum_birth_date: string | null;
  schedule_predictability: number | null;
  considerations: string[] | null;
  typical_session_minutes: number | null;
}

function toProfile(row: Row, fallbackName: string): AthleteProfile {
  return {
    display_name: row.display_name?.trim() || fallbackName,
    load_capacity: row.load_capacity ?? null,
    technical_capacity: row.technical_capacity ?? null,
    experience_level: isExperienceLevel(row.experience_level)
      ? (row.experience_level as ExperienceLevel)
      : 'intermediate',
    postpartum_birth_date: row.postpartum_birth_date,
    schedule_predictability: clampPredictability(row.schedule_predictability),
    considerations: readConsiderations(row.considerations),
    typical_session_minutes: clampSessionMinutes(row.typical_session_minutes),
  };
}

export async function fetchProfile(fallbackName: string): Promise<AthleteProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('athlete_profiles').select(COLUMNS).maybeSingle();
  // Wrapped, not rethrown: a PostgrestError is a plain object, and throwing it
  // as-is is what turned every real failure here into the store's generic
  // "Could not load profile" with the cause discarded.
  if (error) throw postgrestError(error);
  return data ? toProfile(data as Row, fallbackName) : null;
}

export async function saveProfile(patch: Partial<AthleteProfile>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('athlete_profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .not('user_id', 'is', null);
  if (error) throw postgrestError(error);
}

/**
 * Records what the athlete can absorb, and re-sizes the weeks ahead.
 *
 * A discriminated result rather than a swallowed failure, because this one has
 * a visible consequence: the athlete is told their plan is being rebuilt, and
 * if the call did not land then it was not. Silence here would be the same
 * class of bug as the questions this replaces.
 */
export async function saveCapacity(
  loadCapacity: number, technicalCapacity: number,
): Promise<{ ok: true; cyclesResized: number } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Not signed in on this device.' };
  try {
    const { data, error } = await supabase.functions.invoke('athlete-capacity', {
      method: 'POST',
      body: { load_capacity: loadCapacity, technical_capacity: technicalCapacity },
    });
    if (error) {
      return { ok: false, message: await functionMessage(error) ?? error.message };
    }
    return { ok: true, cyclesResized: (data as { cycles_resized?: number })?.cycles_resized ?? 0 };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error && e.message ? e.message : 'Could not reach the server.',
    };
  }
}

/** Edge Function failures carry their body on the error's `context` Response. */
async function functionMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}
