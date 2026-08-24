/**
 * Coach conversation state.
 *
 * Threads hold what the athlete asked and the intent it was classified to —
 * never the rendered answer. The answer is rebuilt from the engine each time a
 * thread is on screen, so reopening "Why Express on Tuesday?" after the athlete
 * changes their equipment shows what the engine says now (Coach brief §4.3:
 * conversation memory must not override authoritative plan data).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { Restorable } from './store';
import type { CoachAnswer } from './coachAnswer';
import {
  INTENT_TITLE, INTENT_UTTERANCE, classify, type CoachIntent, type CoachSignals,
} from '@/data/coach';

export interface CoachMessage {
  id: string;
  role: 'athlete' | 'coach';
  /** The athlete's own wording, preserved after intent extraction (§4.1). */
  text?: string;
  intent?: CoachIntent | null;
  signals?: CoachSignals;
}

export interface CoachThread {
  id: string;
  title: string;
  messages: CoachMessage[];
  /** Monotonic, for ordering the Recent list. */
  seq: number;
  /** Epoch ms, for the "2h ago" label on Coach Home. */
  created: number;
}

/** What a confirmed Coach action did, and how to take it back (CC12). */
export interface CoachCommitment {
  text: string;
  cta: string;
  target: 'today' | 'plan' | 'start';
  restore: Restorable;
  /**
   * The answer as it stood when the athlete agreed to it. Open answers are
   * re-derived from the engine on every render; an applied one is the record of
   * what was applied, so it is frozen here rather than following the state the
   * commitment itself just changed.
   */
  answer: CoachAnswer;
}

interface CoachStore {
  view: 'home' | 'thread';
  thread: CoachThread | null;
  threads: CoachThread[];
  pending: boolean;
  draft: string;
  insightDismissed: boolean;
  /** Message id whose plan proposal is open for review. */
  reviewing: string | null;
  commitments: Record<string, CoachCommitment>;
  whyOpen: Record<string, boolean>;

  /** Ask in the athlete's own words. */
  send(text: string): void;
  /** Ask from a suggested prompt or a follow-up action. */
  ask(intent: CoachIntent, signals?: CoachSignals, utterance?: string): void;
  openThread(id: string): void;
  goHome(): void;
  setDraft(v: string): void;
  toggleWhy(messageId: string): void;
  dismissInsight(): void;
  openReview(messageId: string): void;
  closeReview(): void;
  commit(messageId: string, commitment: CoachCommitment): void;
  undo(messageId: string): CoachCommitment | null;
}

const Ctx = createContext<CoachStore | null>(null);

/**
 * Answers are computed locally and return immediately. The pending state is
 * still real: it stands in for the round trip to the adaptation service, and
 * the copy is neutral rather than a typing indicator, because what the athlete
 * is waiting on is a plan lookup and not a person composing a sentence
 * (brief §8).
 */
const LOOKUP_MS = 420;

export function CoachProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<CoachThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [commitments, setCommitments] = useState<Record<string, CoachCommitment>>({});
  const [whyOpen, setWhyOpen] = useState<Record<string, boolean>>({});

  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useCallback((prefix: string) => `${prefix}_${++counter.current}`, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const put = useCallback((
    intent: CoachIntent | null,
    signals: CoachSignals,
    utterance: string,
  ) => {
    const athlete: CoachMessage = { id: nextId('a'), role: 'athlete', text: utterance };
    const coach: CoachMessage = { id: nextId('c'), role: 'coach', intent, signals };
    const title = intent ? INTENT_TITLE[intent] : 'Coach';
    const seq = ++counter.current;
    const current = threads.find(t => t.id === activeId);

    if (current) {
      // A follow-up stays in the thread it was asked in, and the title tracks
      // the dominant intent rather than freezing on the first question.
      setThreads(prev => prev.map(t => t.id === current.id
        ? { ...t, title, messages: [...t.messages, athlete, coach], seq }
        : t));
    } else {
      const created: CoachThread = {
        id: nextId('t'), title, messages: [athlete, coach], seq, created: Date.now(),
      };
      setThreads(prev => [created, ...prev]);
      setActiveId(created.id);
    }

    setDraft('');
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPending(false), LOOKUP_MS);
  }, [activeId, nextId, threads]);

  const ask = useCallback((
    intent: CoachIntent,
    signals: CoachSignals = {},
    utterance?: string,
  ) => {
    put(intent, signals, utterance ?? INTENT_UTTERANCE[intent]);
  }, [put]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { intent, signals } = classify(trimmed);
    put(intent, signals, trimmed);
  }, [put]);

  const value = useMemo<CoachStore>(() => {
    const thread = threads.find(t => t.id === activeId) ?? null;
    return {
      view: thread ? 'thread' : 'home',
      thread,
      threads: [...threads].sort((a, b) => b.seq - a.seq),
      pending,
      draft,
      insightDismissed,
      reviewing,
      commitments,
      whyOpen,
      send,
      ask,
      openThread: id => { setActiveId(id); setPending(false); },
      goHome: () => { setActiveId(null); setPending(false); },
      setDraft,
      toggleWhy: id => setWhyOpen(prev => ({ ...prev, [id]: !prev[id] })),
      dismissInsight: () => setInsightDismissed(true),
      openReview: id => setReviewing(id),
      closeReview: () => setReviewing(null),
      commit: (id, commitment) => setCommitments(prev => ({ ...prev, [id]: commitment })),
      undo: id => {
        const found = commitments[id] ?? null;
        if (found) {
          setCommitments(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
        return found;
      },
    };
  }, [threads, activeId, pending, draft, insightDismissed, reviewing, commitments, whyOpen, send, ask]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCoach(): CoachStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoach must be used inside CoachProvider');
  return v;
}
