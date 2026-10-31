/**
 * The Progress read, shared by the tab and its subpages.
 *
 * Readiness, Capability and History open from the tab with the payload already
 * in hand, so they draw at once from the copy here rather than each fetching
 * the same thing. Every screen that mounts asks for a fresh copy in the
 * background; until it arrives, the last one stands.
 *
 * History entries opened from the list are kept here too, so Session detail
 * draws the row that was tapped without a second read.
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchProgress, type ProgressPayload } from '@/data/progressRepo';
import type { HistorySession } from '@/data/historyRepo';

export type ProgressStatus = 'loading' | 'ok' | 'unconfigured' | 'error';

let cached: ProgressPayload | null = null;
let status: ProgressStatus = 'loading';
let message: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(l => l());

function refresh(): Promise<void> {
  inflight ??= fetchProgress().then(result => {
    if (result.status === 'ok') { cached = result.payload; status = 'ok'; message = null; }
    else if (result.status === 'unconfigured') { status = 'unconfigured'; }
    // A failed refresh keeps the copy already shown; only a first read fails.
    else { status = cached ? 'ok' : 'error'; message = result.message; }
  }).finally(() => { inflight = null; notify(); });
  return inflight;
}

export function useProgress(): {
  data: ProgressPayload | null;
  status: ProgressStatus;
  message: string | null;
  refresh: () => Promise<void>;
} {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump(n => n + 1);
    listeners.add(listener);
    refresh();
    return () => { listeners.delete(listener); };
  }, []);
  const again = useCallback(() => refresh(), []);
  return { data: cached, status, message, refresh: again };
}

/* ── history entries, by id ─────────────────────────────────────────────── */

const entries = new Map<string, HistorySession>();

export function rememberSessions(list: HistorySession[]): void {
  for (const s of list) entries.set(s.id, s);
}

export function rememberedSession(id: string): HistorySession | undefined {
  return entries.get(id);
}
