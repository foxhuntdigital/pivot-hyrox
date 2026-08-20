/**
 * Reads and writes public.athlete_profiles.
 *
 * No query filters by user: RLS already restricts every row to its owner, and
 * adding a client-side predicate would imply the client is what enforces it.
 */
import { supabase } from '@/lib/supabase';
import {
  isExperienceLevel, type AthleteProfile, type ExperienceLevel,
} from './profile';

const COLUMNS = 'user_id, display_name, experience_level, postpartum_birth_date';

interface Row {
  user_id: string;
  display_name: string | null;
  experience_level: string;
  postpartum_birth_date: string | null;
}

function toProfile(row: Row, fallbackName: string): AthleteProfile {
  return {
    display_name: row.display_name?.trim() || fallbackName,
    experience_level: isExperienceLevel(row.experience_level)
      ? (row.experience_level as ExperienceLevel)
      : 'intermediate',
    postpartum_birth_date: row.postpartum_birth_date,
  };
}

export async function fetchProfile(fallbackName: string): Promise<AthleteProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('athlete_profiles').select(COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? toProfile(data as Row, fallbackName) : null;
}

export async function saveProfile(patch: Partial<AthleteProfile>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('athlete_profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .not('user_id', 'is', null);
  if (error) throw error;
}
