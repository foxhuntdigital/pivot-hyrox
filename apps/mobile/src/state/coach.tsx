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
import { track } from '@/lib/analytics';
import {
  INTENT_TITLE, INTENT_UTTERANCE, classify, type CoachIntent, type CoachSignals,
} from '@/data/coach';
import { askCoach, type RemoteAnswer } from '@/data/coachRepo';

export interface CoachMessage {
  id: string;
  role: 'athlete' | 'coach';
  /** The athlete's own wording, preserved after intent extraction (§4.1). */
  text?: string;
  intent?: CoachIntent | null;
  signals?: CoachSignals;
  /**
   * The server's answer, once it lands. Until then the locally derived one is
   * on screen — the card is deterministic either way, so what the athlete sees
   * change is the prose around it.
   */
  remote?: RemoteAnswer;
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
 * The floor on how long the pending state shows. The local answer is ready
 * immediately; without a floor, a fast fallback would flash "Checking your
 * plan…" for one frame.
 */
const MIN_PENDING_MS = 300;

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
  const remoteThreadId = useRef<string | null>(null);
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

    // Intent classification only (PRD §16). The athlete's wording is the whole
    // point of the Coach surface and is exactly what must not leave the device
    // as analytics — `utterance` is deliberately not a property here.
    track({ name: 'coach_message_sent', intent: intent ?? 'unclassified' });

    /**
     * The card is already on screen, built from the engine. This asks the
     * server for the narrative and, when it answers, swaps the prose in and
     * adopts its reading of the sentence — a model classifier understands
     * "I'm wrecked and the gym is shut" in ways the local regex does not.
     * When it does not answer, the local one simply stays.
     */
    const started = Date.now();
    const history = (current?.messages ?? [])
      .filter(m => m.role === 'athlete' && m.text)
      .slice(-2)
      .map(m => ({ role: 'user' as const, content: m.text! }));

    askCoach({ message: utterance, threadId: remoteThreadId.current, history })
      .then(remote => {
        if (remote) {
          remoteThreadId.current = remote.thread_id ?? remoteThreadId.current;
          setThreads(prev => prev.map(t => ({
            ...t,
            messages: t.messages.map(m => m.id === coach.id
              ? {
                  ...m,
                  remote,
                  intent: remote.intent ?? m.intent,
                  signals: remote.intent ? { ...m.signals, ...remote.signals } : m.signals,
                }
              : m),
          })));
        }
      })
      .finally(() => {
        const wait = Math.max(0, MIN_PENDING_MS - (Date.now() - started));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setPending(false), wait);
      });

    return coach.id;
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
      goHome: () => { setActiveId(null); setPending(false); remoteThreadId.current = null; },
      setDraft,
      toggleWhy: id => setWhyOpen(prev => ({ ...prev, [id]: !prev[id] })),
      dismissInsight: () => setInsightDismissed(true),
      openReview: id => setReviewing(id),
      closeReview: () => setReviewing(null),
      commit: (id, commitment) => {
        // The card kind names what was applied — an adaptation, a substitution
        // — which is more analysable than the screen it landed on. `target` is
        // the fallback for an answer that committed without a card.
        track({
          name: 'coach_action_applied',
          action_type: commitment.answer.card?.kind ?? commitment.target,
        });
        setCommitments(prev => ({ ...prev, [id]: commitment }));
      },
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
