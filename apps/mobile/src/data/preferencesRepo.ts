/**
 * What kind of training the athlete actually wants to do.
 *
 * `athlete_preferences` has existed since migration 0013 and the engine has
 * read it since ENGINE 2.0.0 — into `preferred_families` and
 * `avoided_families`, scored by the `preference` dimension. Nothing has ever
 * written a row, so that dimension has been inert in production and every
 * athlete has ranked identically on it. This is the write path.
 *
 * ── Why these six ───────────────────────────────────────────────────────────
 *
 * `preference()` compares a stated key against a template's `workout_family`,
 * `training_domain` and `primary_goal` by exact match. A key that matches none
 * of the three is stored, read, scored, and silently does nothing — so the
 * options offered are exactly the domains the library actually carries, and the
 * athlete-facing label is separate from the value that has to match.
 *
 * Modality-level preferences — "barbell", "boxing" — are the obvious next step
 * and are deliberately not here: `content.workout_templates.modality` exists
 * but the engine does not read it yet, so offering them would be offering a
 * control that does nothing.
 *
 * ── Neutral is the absence of a row ─────────────────────────────────────────
 *
 * The schema's fourth rating is `neutral`, and it means the same as having no
 * opinion — which the engine already treats identically. So clearing a choice
 * deletes the row rather than writing `neutral`, and the table stays a list of
 * things the athlete actually said.
 */
import { supabase } from '@/lib/supabase';

/**
 * The APP user's id — `public.users.id`, not the auth uid.
 *
 * The two are different uuids joined by `users.auth_id` (migration 0002), and
 * both tables here take the app one: they reference `public.users(id)`, and
 * 0013's RLS policy is `user_id = public.current_app_user_id()`, which resolves
 * the same value. Writing `auth.getUser().id` instead failed the policy's WITH
 * CHECK on every save — silently, because these writes are best-effort and
 * swallow their errors — so a preference showed on screen from local state and
 * was gone by the next launch. `equipmentRepo` states the same rule where it
 * creates a profile row; this is that rule, applied to the other two tables.
 *
 * RLS restricts this select to the caller's own row, so it needs no filter.
 */
async function appUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('users').select('id').single();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * Says that a best-effort write did not land.
 *
 * PostgREST does not throw on a rejected write — an RLS refusal comes back as
 * `{ error }` on a resolved promise. Both writes here ignored that value and
 * had only a `catch`, which sees network failures and nothing else, so every
 * refused save looked exactly like a successful one. Staying best-effort is
 * deliberate (a lost setting must never cost the session); staying silent
 * about it was not.
 */
function reportWriteFailure(what: string, error: unknown): void {
  if (error && __DEV__) console.warn(`[${what}] save was refused`, error);
}

export type PreferenceRating = 'love' | 'like' | 'rather_not';

/** One offered choice: what the athlete sees, and the key that must match. */
export interface PreferenceOption {
  /** Stored in `modality_or_domain`. Must equal a domain, family or goal. */
  value: string;
  label: string;
  /** What it means in the athlete's terms, not the taxonomy's. */
  hint: string;
}

export const PREFERENCE_OPTIONS: PreferenceOption[] = [
  { value: 'strength', label: 'Strength', hint: 'Barbell and dumbbell lifting' },
  { value: 'aerobic', label: 'Easy aerobic', hint: 'Conversational runs, rows and rides' },
  { value: 'threshold', label: 'Hard intervals', hint: 'Sustained efforts and repeats' },
  { value: 'hybrid', label: 'Race simulation', hint: 'Stations, carries and compromised running' },
  { value: 'muscular_endurance', label: 'Muscular endurance', hint: 'High-rep loaded work' },
  { value: 'recovery', label: 'Recovery', hint: 'Easy movement and mobility' },
];

export type Preferences = Record<string, PreferenceRating>;

/** Null when there is no server to ask; `{}` when the athlete has said nothing. */
export async function fetchPreferences(): Promise<Preferences | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('athlete_preferences')
      .select('modality_or_domain, rating');
    if (error) return null;

    const out: Preferences = {};
    for (const row of data ?? []) {
      // `neutral` rows may exist from another writer; they carry no opinion and
      // are dropped rather than rendered as a choice the athlete made.
      if (row.rating === 'neutral') continue;
      out[row.modality_or_domain] = row.rating as PreferenceRating;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Sets one preference, or clears it.
 *
 * Best-effort like every other write on this client: a failure costs the
 * setting, never the session. The caller has already updated local state, so
 * the athlete sees their choice regardless and the engine picks it up on the
 * next payload.
 */
export async function savePreference(
  value: string, rating: PreferenceRating | null,
): Promise<void> {
  if (!supabase) return;
  try {
    const userId = await appUserId();
    if (!userId) return;

    const { error } = rating === null
      ? await supabase.from('athlete_preferences')
        .delete().eq('user_id', userId).eq('modality_or_domain', value)
      : await supabase.from('athlete_preferences').upsert({
        user_id: userId,
        modality_or_domain: value,
        rating,
        // 'profile' rather than 'onboarding': the column exists so Coach can
        // answer "where did this come from", and a preference set deliberately
        // in settings is a stronger statement than one picked during signup.
        source: 'profile',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,modality_or_domain' });
    reportWriteFailure('preferences', error);
  } catch (e) {
    reportWriteFailure('preferences', e);
  }
}


/* ── What the athlete believes needs work ─────────────────────────────────
 *
 * A different question from the one above, and a different table, because they
 * are different claims: `athlete_preferences` is what someone wants to do and
 * this is what they think they are bad at. Migration 0013 keeps them apart and
 * ENGINE 2.1.0 scores them as separate dimensions — belief below evidence,
 * above preference.
 *
 * No rating and no magnitude. As the migration puts it, a belief has no
 * confidence band: the athlete either said it or did not.
 */

/** The seven capabilities, in the vocabulary the evidence table also uses. */
export interface WeaknessOption { value: string; label: string; hint: string }

export const WEAKNESS_OPTIONS: WeaknessOption[] = [
  { value: 'lower_body_strength', label: 'Lower-body strength', hint: 'Squat, hinge, lunge' },
  { value: 'upper_body_strength', label: 'Upper-body strength', hint: 'Press, pull, row' },
  { value: 'running_threshold', label: 'Running speed', hint: 'Holding a hard pace' },
  { value: 'aerobic_durability', label: 'Aerobic endurance', hint: 'Lasting the distance' },
  { value: 'loaded_movement', label: 'Carries and sleds', hint: 'Moving weight over ground' },
  { value: 'muscular_endurance', label: 'Muscular endurance', hint: 'High reps under fatigue' },
  { value: 'station_proficiency', label: 'Race stations', hint: 'Wall balls, burpees, ski' },
];

/** Null when there is no server to ask; `[]` when the athlete has said nothing. */
export async function fetchWeaknesses(): Promise<string[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('athlete_perceived_weaknesses').select('capability_key');
    if (error) return null;
    return (data ?? []).map(r => r.capability_key as string);
  } catch {
    return null;
  }
}

/** Adds or removes one stated weakness. Best-effort, like every write here. */
export async function saveWeakness(value: string, stated: boolean): Promise<void> {
  if (!supabase) return;
  try {
    const userId = await appUserId();
    if (!userId) return;

    const { error } = stated
      ? await supabase.from('athlete_perceived_weaknesses')
        .upsert({ user_id: userId, capability_key: value },
          { onConflict: 'user_id,capability_key' })
      : await supabase.from('athlete_perceived_weaknesses')
        .delete().eq('user_id', userId).eq('capability_key', value);
    reportWriteFailure('weaknesses', error);
  } catch (e) {
    reportWriteFailure('weaknesses', e);
  }
}
