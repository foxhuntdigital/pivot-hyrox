/**
 * Completed training history.
 *
 * Paginated by cursor rather than offset: sessions are appended over time, and
 * an offset would skip or repeat rows as new ones land at the top.
 */
import { supabase } from '@/lib/supabase';

export interface HistoryMovement {
  exercise_id: string;
  exercise: string;
  prescribed: string | null;
  actual: string | null;
}

/** One lap of a session, as it was recorded. */
export interface HistorySplit {
  index: number;
  label: string;
  prescribed: string | null;
  kind: string | null;
  seconds: number;
  cumulative_seconds: number;
  rest: boolean;
}

export interface HistorySession {
  id: string;
  date: string;
  name: string;
  variant_label: string | null;
  stimulus: string | null;
  minutes: number | null;
  session_rpe: number | null;
  ended_early: boolean;
  movements: HistoryMovement[];
  /** Empty for sessions finished before splits were recorded. */
  splits: HistorySplit[];
  /**
   * Records set in this session. Empty for almost every session, which is what
   * makes the ones that are not worth marking — not an empty state to fill.
   */
  records?: {
    exercise: string;
    kind: 'load' | 'reps';
    value: number;
    unit: string | null;
    previous: number;
  }[];
  /** Optional work taken after a session, rather than prescribed by the plan. */
  supplemental?: boolean;
}

export interface HistoryPage {
  sessions: HistorySession[];
  has_more: boolean;
  next_before: string | null;
}

/** Null when there is no server to ask — the caller shows the seeded state. */
export async function fetchHistory(before?: string | null): Promise<HistoryPage | null> {
  if (!supabase) return null;
  try {
    const params = new URLSearchParams({ limit: '20' });
    if (before) params.set('before', before);
    const { data, error } = await supabase.functions.invoke(`history?${params}`, { method: 'GET' });
    if (error || !data) return null;
    return data as HistoryPage;
  } catch {
    return null;
  }
}
