/**
 * The manual recovery check-in (FR-015).
 *
 * Sleep is entered in hours and minutes and stored as decimal hours, because
 * that is what the engine reasons in (`sleep_hours < 5` caps recovery). The
 * conversion lives here so no screen has to know that.
 *
 * A failed save returns null rather than throwing. The check-in is kept in
 * local state either way, so an athlete who logs a bad night on the train still
 * gets an adapted session — the row catches up when they reconnect.
 */
import { supabase } from '@/lib/supabase';

export interface Checkin {
  /** Decimal hours, e.g. 7.5 for 7h30m. Null when not answered. */
  sleep_hours: number | null;
  energy: 'low' | 'normal' | 'high' | null;
  /** 1–5, where 5 is the most stressed. */
  stress: number | null;
  /** 1–5, where 5 is the most sore. */
  soreness: number | null;
  /** 1–5, where 5 is the most motivated. */
  motivation: number | null;
  /**
   * What the athlete reported as wrong today.
   *
   * The one check-in field that is a safety input rather than a recovery one:
   * the engine's first guardrail reads these and stops the hard-training flow
   * before anything else is considered. It is stored so tomorrow's
   * recommendation knows what today's did — an adaptation sheet flag lives only
   * as long as the request that carried it.
   */
  symptoms: string[];
}

export const EMPTY_CHECKIN: Checkin = {
  sleep_hours: null, energy: null, stress: null, soreness: null, motivation: null,
  symptoms: [],
};

/** 7h 30m → 7.5. The inverse of what the sleep stepper shows. */
export function toDecimalHours(hours: number, minutes: number): number {
  return Math.round((hours + minutes / 60) * 60) / 60;
}

/** 7.5 → { hours: 7, minutes: 30 }, for seeding the stepper from a saved value. */
export function fromDecimalHours(value: number | null): { hours: number; minutes: number } {
  if (value === null) return { hours: 7, minutes: 30 };   // a plausible starting point
  const hours = Math.floor(value);
  return { hours, minutes: Math.round((value - hours) * 60) };
}

export async function saveCheckin(checkin: Checkin): Promise<Checkin | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('recovery-checkin', {
      method: 'POST',
      body: {
        ...checkin,
        // The column is a jsonb object, so the list is sent as a set. Keys are
        // matched as lowercase substrings by the engine's guardrail, which is
        // why the labels themselves travel rather than codes.
        symptoms: Object.fromEntries(checkin.symptoms.map(s => [s, true])),
      },
    });
    if (error || !data) return null;
    const saved = (data as { recovery: Partial<Checkin> | null }).recovery;
    // The server echoes the stored row; symptoms come back as they were sent
    // rather than re-read, since the endpoint's select does not return them.
    return saved ? { ...checkin, ...saved, symptoms: checkin.symptoms } : null;
  } catch {
    return null;   // offline or unconfigured — local state still holds it
  }
}
