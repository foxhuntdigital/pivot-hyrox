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
}

export const EMPTY_CHECKIN: Checkin = {
  sleep_hours: null, energy: null, stress: null, soreness: null, motivation: null,
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
      body: checkin,
    });
    if (error || !data) return null;
    return (data as { recovery: Checkin }).recovery ?? null;
  } catch {
    return null;   // offline or unconfigured — local state still holds it
  }
}
