/**
 * Recording an adaptation.
 *
 * The athlete's accepted change applies locally the moment they tap it — the
 * engine is a pure function and the client runs the same code. This call is
 * what makes the change auditable: the server re-runs the decision against the
 * inputs it was given and writes an `adaptation_events` row stamped with the
 * engine version behind it (PRD §24).
 *
 * It is deliberately not the source of the athlete's session. Waiting on a
 * round trip to show what they just chose would trade a real interaction for a
 * spinner, and a failed write should cost the audit row, not the adaptation.
 */
import { supabase } from '@/lib/supabase';
import type { VariantCode } from '@pivot/engine';

export interface AdaptationRecord {
  /** The session being replaced, when there was one. */
  original_template_id?: string | null;
  original_variant?: VariantCode | null;
  /** The session the athlete accepted. */
  force_template_id: string;
  available_minutes?: number;
  energy?: 'low' | 'normal' | 'high';
  sleep_hours?: number | null;
  low_impact?: boolean;
  symptom_flags?: string[];
  unavailable_equipment?: string[];
}

/** Resolves true when the event was recorded. Never throws. */
export async function recordAdaptation(record: AdaptationRecord): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.functions.invoke('adapt', {
      method: 'POST',
      body: record,
    });
    return !error;
  } catch {
    return false;
  }
}
