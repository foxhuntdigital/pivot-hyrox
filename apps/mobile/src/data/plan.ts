/**
 * The plan as the screens render it.
 *
 * Today, Plan, Coach and the completion screen all describe the same week — the
 * race it points at, the phase it sits in, what is queued and what is done. They
 * used to describe it from an authored fixture, each reaching into
 * `data/athlete.ts` for its own slice.
 *
 * This module is the single place where the server payload is turned into those
 * views. It was written with the fixture's fallbacks in it so that retiring them
 * would be a change to one file rather than to four screens; that is what has
 * now happened, and no plan value in the app is authored any more.
 *
 * With no payload every view is null or zero. That is the state of an athlete
 * who has not signed in or has no plan yet, and the screens render it as such —
 * "No race set", an empty queue — rather than as somebody else's week.
 */
import type { StimulusRequirement } from '@pivot/engine';
import type {
  CompletedThisWeek, PhaseSummary, QueuedSession, TodayPayload,
} from './todayRepo';

/** Phase names as the ribbon abbreviates them. Presentation, not data. */
export const PHASE_LABEL: Record<string, string> = {
  foundation: 'Found.',
  build: 'Build',
  specific: 'Spec.',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race',
};

export function phaseTitle(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export interface RaceView {
  id: string;
  name: string;
  /** "October 10", or null when the date is not known. */
  date_label: string | null;
  /**
   * The raw ISO date behind `date_label`. Kept alongside it because the Profile
   * editor has to seed a date picker from the current race, and a formatted
   * label cannot be parsed back into one reliably.
   */
  event_date: string;
  division: string | null;
  days_remaining: number | null;
}

export interface PhaseView {
  type: string;
  /** Week within the whole program, and how many it holds. */
  week: number;
  total_weeks: number;
  /** Every phase in order — what the ribbon draws. */
  sequence: PhaseSummary[];
}

export interface WeekView {
  /** Stimulus exposures completed and required this week. */
  done: number;
  target: number;
  queue: QueuedSession[];
  completed: CompletedThisWeek[];
  /**
   * The sessions finished on today's local date.
   *
   * Filtered by the server's own date rather than by a client flag: an app left
   * open overnight still holds `completed_today`, and a screen that reads
   * "you're done for today" from a workout finished yesterday is worse than one
   * that never said it. The server's `completed_on` is the local day the
   * session was actually credited to.
   */
  completedToday: CompletedThisWeek[];
}

/**
 * The week as Coach's proposals reason about it.
 *
 * All counts, no weekday names. The fixture this replaces held `planned_days`,
 * `days_trained` and three named open days; the schema has none of those, and
 * proposals built on them were describing a calendar the athlete did not have.
 */
export interface WeekShape {
  /** Distinct days with a completed session inside the current week. */
  days_trained: number;
  /** Whole days left in the week window, today included. */
  days_remaining: number;
  /** Sessions still queued. */
  queue_remaining: number;
}

export interface PlanView {
  /**
   * True while a session finished on this device is not yet in the server's
   * week — the window the optimistic counters cover. False again the moment the
   * refetch lands, which is what stops them counting the same session twice.
   */
  pendingCompletion: boolean;
  race: RaceView | null;
  phase: PhaseView | null;
  week: WeekView;
  /** Seven-day volume, or null where nothing has been measured. */
  training7d: { sessions: number; minutes: number } | null;
  /** Counts Coach's week proposals are arithmetic over. */
  shape: WeekShape;
}

/** Whole days from `from` to `to`, inclusive of both ends; never negative. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000) + 1);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** `2026-10-10` → "October 10". Parsed as a plain date; no timezone applies. */
export function eventDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

function countStimuli(requirements: StimulusRequirement[]) {
  return {
    done: requirements.reduce((n, r) => n + r.completed_exposures, 0),
    target: requirements.reduce((n, r) => n + r.target_exposures, 0),
  };
}

/**
 * Resolves the plan views from the payload.
 *
 * A session finished on this device is added to the week's count rather than
 * waiting for the server: the athlete just finished one, and a counter that
 * does not move until a refetch lands reads as the app not having noticed.
 *
 * The optimism has to expire, though, and it did not. `completed_today` stayed
 * true for the life of the app, so once the refetch landed — with the server's
 * own count already incremented — the same session was counted twice and the
 * week read "2 / 7" for one workout. Matching the finished session against the
 * server's completed list is what retires it: the bump covers the gap and
 * nothing more.
 */
export function planView(
  today: TodayPayload | null,
  completedToday: boolean,
  completedSessionId: string | null = null,
): PlanView {
  const serverHasIt = completedSessionId !== null
    && (today?.week?.completed ?? []).some(c => c.session_id === completedSessionId);
  const pendingCompletion = completedToday && !serverHasIt;
  const bump = pendingCompletion ? 1 : 0;

  if (!today) {
    return {
      pendingCompletion,
      race: null,
      phase: null,
      week: { done: bump, target: 0, queue: [], completed: [], completedToday: [] },
      training7d: null,
      shape: { days_trained: 0, days_remaining: 0, queue_remaining: 0 },
    };
  }

  const { done, target } = countStimuli(today.stimulus_requirements ?? []);
  // Sessions already performed drop out of what is still to come.
  const queue = (today.week?.queue ?? []).filter(
    q => q.state !== 'completed' && q.state !== 'skipped');

  return {
    pendingCompletion,
    race: today.active_race && {
      id: today.active_race.id,
      name: today.active_race.name,
      date_label: eventDateLabel(today.active_race.event_date),
      event_date: today.active_race.event_date,
      division: today.active_race.division,
      days_remaining: today.active_race.days_remaining,
    },
    phase: today.phase && {
      type: today.phase.type,
      week: today.phase.program_week,
      total_weeks: today.phase.program_total_weeks,
      sequence: today.phase.sequence ?? [],
    },
    week: {
      done: Math.min(target, done + bump),
      target,
      queue,
      completed: today.week?.completed ?? [],
      completedToday: (today.week?.completed ?? [])
        .filter(c => c.completed_on === today.date_local),
    },
    training7d: today.training_7d ?? null,
    shape: {
      // Days, not sessions: two sessions in one day is one day trained.
      days_trained: new Set(
        (today.week?.completed ?? []).map(c => c.completed_on).filter(Boolean)).size,
      days_remaining: today.week?.end_date
        ? daysBetween(today.date_local, today.week.end_date) : 0,
      queue_remaining: queue.length,
    },
  };
}
