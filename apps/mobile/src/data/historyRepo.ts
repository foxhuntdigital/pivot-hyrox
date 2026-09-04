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

/**
 * The outcome of asking for a page of history.
 *
 * Three states, not two, because the difference between them is the whole
 * point. This used to answer `HistoryPage | null`, and the screen read `null`
 * as an empty list — so a dropped connection, an expired token or a 500 all
 * rendered as "Nothing completed yet" over an athlete's entire training record.
 * That is the single line behind every "the app erased my history" report: an
 * absence of data and a failure to read it are not the same claim, and only one
 * of them is safe to state.
 *
 * `unconfigured` stays separate from `error` for the same reason. A build with
 * no Supabase credentials has nothing to show and nothing wrong with it; an
 * error state there would be a fault reported to someone who cannot act on it.
 */
export type HistoryResult =
  | { status: 'ok'; page: HistoryPage }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

export async function fetchHistory(before?: string | null): Promise<HistoryResult> {
  if (!supabase) return { status: 'unconfigured' };
  try {
    const params = new URLSearchParams({ limit: '20' });
    if (before) params.set('before', before);
    const { data, error } = await supabase.functions.invoke(`history?${params}`, { method: 'GET' });
    if (error) {
      // The Edge Function puts the useful sentence in the response body; the
      // envelope's own message is usually just "non-2xx status code".
      return { status: 'error', message: await functionMessage(error) ?? error.message };
    }
    if (!data) return { status: 'error', message: 'The server returned no history.' };
    return { status: 'ok', page: data as HistoryPage };
  } catch (e) {
    return {
      status: 'error',
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
