/**
 * The athlete's default equipment profile.
 *
 * Equipment lives in its own table rather than a profile column because it is a
 * set the engine selects against, and because an athlete has more than one —
 * home, gym, travel. This module reads and writes the default one, which is the
 * gym Profile edits and the engine falls back to.
 *
 * Onboarding writes the same profile through `onboarding-plan`. Both paths end
 * at one row, so the equipment chosen at signup is the equipment Profile shows.
 */
import { supabase } from '@/lib/supabase';

/** The name onboarding gives the default profile. */
const DEFAULT_NAME = 'Default';

/**
 * Equipment ids on the athlete's default profile, or null when there is no
 * profile to read — a new account, or an unconfigured build. Null is not an
 * empty gym, and the caller keeps what it has rather than clearing it.
 */
export async function fetchEquipment(): Promise<string[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('equipment_profiles')
    .select('id, is_default, equipment_profile_items(equipment_id)')
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const items = (data.equipment_profile_items ?? []) as { equipment_id: string }[];
  return items.map(i => i.equipment_id);
}

/**
 * Replaces the default profile's items with `equipment`.
 *
 * Delete-then-insert rather than a diff: the athlete's answer is the whole set,
 * and reconciling two lists to save one round trip would be the more fragile of
 * the two. The profile is created on first save if onboarding never made one.
 */
export async function saveEquipment(equipment: string[]): Promise<void> {
  if (!supabase) return;

  const profileId = await defaultProfileId();
  if (!profileId) return;

  const { error: clearError } = await supabase
    .from('equipment_profile_items').delete().eq('profile_id', profileId);
  if (clearError) throw new Error(clearError.message);

  if (!equipment.length) return;

  const { error: insertError } = await supabase
    .from('equipment_profile_items')
    .insert(equipment.map(equipment_id => ({ profile_id: profileId, equipment_id })));
  if (insertError) throw new Error(insertError.message);
}

async function defaultProfileId(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('equipment_profiles')
    .select('id, is_default')
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data.id;

  // `user_id` has no default and RLS checks it, so the row needs the app user's
  // id rather than the auth uid. RLS still restricts what this select returns
  // to the caller's own row.
  const { data: user, error: userError } = await supabase
    .from('users').select('id').single();
  if (userError || !user) throw new Error(userError?.message ?? 'Not authenticated');

  const { data: created, error: createError } = await supabase
    .from('equipment_profiles')
    .insert({ user_id: user.id, name: DEFAULT_NAME, is_default: true })
    .select('id')
    .single();
  if (createError || !created) {
    throw new Error(createError?.message ?? 'Could not create an equipment profile');
  }
  return created.id;
}
