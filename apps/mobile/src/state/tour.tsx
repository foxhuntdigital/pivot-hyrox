/**
 * The first-run tour.
 *
 * Onboarding establishes what the athlete is training for; it says nothing
 * about how to drive the app. This points at the real controls on Today and
 * names what each one is for, once, and then never again.
 *
 * Targets are measured rather than described. A tour drawn from hardcoded
 * coordinates goes wrong the first time a card grows a line of copy, and goes
 * wrong differently on every screen size — so each highlighted element reports
 * its own position in window coordinates and the overlay draws around whatever
 * comes back. An element that never registers is skipped rather than
 * highlighted in the wrong place.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the caption sits relative to the highlight. */
type Placement = 'below' | 'above';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Preferred side; the overlay flips it when there is no room. */
  prefer: Placement;
}

/**
 * Five steps, in the order the athlete meets them going down the screen. Each
 * one answers "what is this for", not "what is this called" — a caption that
 * only reads the label back is a step worth deleting.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'race',
    title: 'What you are training for',
    body: 'Your race and the days left. Every session is chosen against this date, '
      + 'and the bar underneath is the phase you are in now.',
    prefer: 'below',
  },
  {
    id: 'stats',
    title: 'Where you stand',
    body: 'Stimuli done this week, your readiness score, and last night\'s sleep. '
      + 'Tap sleep to check in — the day\'s session is recalculated from it.',
    prefer: 'below',
  },
  {
    id: 'session',
    title: "Today's session",
    body: 'Chosen for you from your plan, your recovery and the equipment you have. '
      + 'Open "Full workout" to read every set before you begin.',
    prefer: 'above',
  },
  {
    id: 'actions',
    title: 'Start it, or change it',
    body: "Short on time or feeling wrecked? Adapt rebuilds today's session around "
      + 'what you actually have. It never costs you the week.',
    prefer: 'above',
  },
  {
    id: 'tabs',
    title: 'The rest of it',
    body: 'Plan is your week — tap any queued session to do it today instead. '
      + 'Coach answers questions about your training. Progress is what you have built.',
    prefer: 'above',
  },
];

/** Resolves an element's position in window coordinates, or null if it is gone. */
type Measure = () => Promise<TourRect | null>;

interface TourStore {
  /** True while the overlay should be on screen. */
  active: boolean;
  index: number;
  step: TourStep | null;
  total: number;
  /** The current step's measured target, or null when it could not be found. */
  rect: TourRect | null;
  next(): void;
  /** Ends the tour and records that it has been seen. */
  end(): void;
  /** Called by a highlighted element to make itself findable. */
  register(id: string, measure: Measure | null): void;
  /** Lets the host screen bring an off-screen target into view. */
  registerScroller(scrollTo: ((y: number) => void) | null): void;
  /**
   * Starts the tour if this athlete has not seen it. Safe to call on every
   * render of the host screen; it runs at most once.
   */
  maybeStart(): void;
  /** Replays it from Profile, for an athlete who skipped or forgot. */
  restart(): void;
}

const SEEN_KEY = 'pivot.tour.today.v1';

const Ctx = createContext<TourStore | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<TourRect | null>(null);

  /** null until storage answers — starting before then could show it twice. */
  const seen = useRef<boolean | null>(null);
  const wanted = useRef(false);
  const targets = useRef(new Map<string, Measure>());
  const scroller = useRef<((y: number) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SEEN_KEY)
      .then(v => {
        if (cancelled) return;
        seen.current = v === '1';
        // A screen that asked to start before storage answered gets its answer
        // now, rather than silently never running.
        if (!seen.current && wanted.current) setActive(true);
      })
      // Unreadable storage means showing the tour again, which is a far smaller
      // failure than never showing it at all.
      .catch(() => { seen.current = false; if (wanted.current) setActive(true); });
    return () => { cancelled = true; };
  }, []);

  const register = useCallback((id: string, measure: Measure | null) => {
    if (measure) targets.current.set(id, measure);
    else targets.current.delete(id);
  }, []);

  const registerScroller = useCallback((fn: ((y: number) => void) | null) => {
    scroller.current = fn;
  }, []);

  const maybeStart = useCallback(() => {
    if (wanted.current) return;
    wanted.current = true;
    if (seen.current === false) setActive(true);
  }, []);

  const end = useCallback(() => {
    setActive(false);
    setIndex(0);
    setRect(null);
    seen.current = true;
    AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {
      // Failing to record it means the athlete sees it once more next launch.
      // Nothing is lost, so this is not worth surfacing.
    });
  }, []);

  const next = useCallback(() => {
    setIndex(i => {
      if (i >= TOUR_STEPS.length - 1) return i;
      return i + 1;
    });
  }, []);

  // The last step's button ends rather than advances, so `next` never runs off
  // the end; this keeps that decision in one place.
  const isLast = index >= TOUR_STEPS.length - 1;
  const advance = useCallback(() => {
    if (isLast) end();
    else next();
  }, [isLast, end, next]);

  const value = useMemo<TourStore>(() => ({
    active,
    index,
    step: active ? TOUR_STEPS[index] ?? null : null,
    total: TOUR_STEPS.length,
    rect,
    next: advance,
    end,
    register,
    registerScroller,
    maybeStart,
    restart: () => {
      seen.current = false;
      setIndex(0);
      setRect(null);
      setActive(true);
    },
  }), [active, index, rect, advance, end, register, registerScroller, maybeStart]);

  return (
    <Ctx.Provider value={value}>
      <MeasureOnStep
        active={active}
        index={index}
        targets={targets}
        scroller={scroller}
        onRect={setRect}
      />
      {children}
    </Ctx.Provider>
  );
}

/**
 * Resolves the current step's rect, scrolling it into view first when the host
 * screen offers a scroller.
 *
 * Split into its own component so the effect can depend on the step index
 * without re-running everything else in the provider.
 */
function MeasureOnStep({
  active, index, targets, scroller, onRect,
}: {
  active: boolean;
  index: number;
  targets: React.MutableRefObject<Map<string, Measure>>;
  scroller: React.MutableRefObject<((y: number) => void) | null>;
  onRect: (r: TourRect | null) => void;
}) {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const id = TOUR_STEPS[index]?.id;
    const measure = id ? targets.current.get(id) : undefined;
    if (!measure) { onRect(null); return; }

    // Two passes: measure where it is, scroll if it is not usefully on screen,
    // then measure again once the scroll has settled. Layout animations mean
    // the first answer after a scroll is not trustworthy.
    let timer: ReturnType<typeof setTimeout> | null = null;
    measure().then(first => {
      if (cancelled) return;
      onRect(first);
      if (!first || !scroller.current) return;
      timer = setTimeout(() => {
        measure().then(second => { if (!cancelled) onRect(second ?? first); });
      }, 260);
      scroller.current(first.y);
    });

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [active, index, targets, scroller, onRect]);

  return null;
}

export function useTour(): TourStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTour must be used inside TourProvider');
  return v;
}
