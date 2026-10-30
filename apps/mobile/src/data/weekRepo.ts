/**
 * Applying a week change.
 *
 * Coach's plan proposals are the only thing that calls this, and it is what
 * turns "your week is now three days" from a sentence into a fact. Without it
 * the commitment lived in client state and a reopened app showed the week the
 * athlete thought they had changed.
 *
 * Unlike an adaptation, this is not fire-and-forget: the athlete agreed to a
 * specific change and the confirmation says it was applied, so the caller waits
 * for the answer and can say otherwise when it fails.
 */
import { supabase } from '@/lib/supabase';

export interface ReshapeRequest {
  /** Queue item ids that stay, in the order they should be performed. */
  keep: string[];
  /** Queue item ids that come out of the week. */
  drop: string[];
}

export interface ReshapeResult {
  kept: number;
  dropped: number;
}

/** Null when there is nothing to write to, or when the write failed. */
export async function reshapeWeek(request: ReshapeRequest): Promise<ReshapeResult | null> {
  if (!supabase) return null;
  if (!request.keep.length && !request.drop.length) return null;
  try {
    const { data, error } = await supabase.functions.invoke('reshape-week', {
      method: 'POST',
      body: request,
    });
    if (error || !data) return null;
    return { kept: data.kept ?? 0, dropped: data.dropped ?? 0 };
  } catch {
    return null;
  }
}

export interface ReplanResult {
  expired: number;
  added: number;
}

/**
 * Brings this week's queue in line with the athlete's saved equipment, after
 * they change it.
 *
 * Fire-and-forget, unlike a reshape: the athlete asked to change their
 * equipment, not their week, so a failure here costs them nothing they agreed
 * to. Today and Start already read the current equipment; this only stops Plan
 * listing sessions planned around kit they no longer have. Null when there is
 * nothing to write to, or when the call failed.
 */
export async function replanWeek(): Promise<ReplanResult | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('replan-week', { method: 'POST' });
    if (error || !data) return null;
    return { expired: data.expired ?? 0, added: data.added ?? 0 };
  } catch {
    return null;
  }
}
