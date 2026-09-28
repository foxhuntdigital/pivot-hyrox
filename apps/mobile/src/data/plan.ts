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
  CompletedThisWeek, Opportunity, PhaseSummary, QueuedSession, TodayPayload,
} from './todayRepo';

/**
 * Phase names, in full. Presentation, not data.
 *
 * They used to be abbreviated — `Found.`, `Spec.` — because six labels were
 * competing for one row, and on a narrow screen even those became `TA…` and
 * `RA…`. Abbreviating was the wrong end to solve it from: "Spec." is not a
 * shorter way of saying something the athlete already understands, it is a
 * shorter way of saying something only a coach does. Nothing renders six of
 * these side by side any more, so nothing needs to shorten them.
 */
export const PHASE_LABEL: Record<string, string> = {
  foundation: 'Foundation',
  build: 'Build',
  specific: 'Specific',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race',
};

/**
 * What each phase is actually doing for the athlete.
 *
 * The name is a label the sport uses; this is the part they can act on. Shown
 * wherever a phase is named, so "Foundation" is never left to mean whatever
 * they guess it means.
 *
 * Written as what the training is for, not what it will achieve — a phase makes
 * no promises about a result.
 */
export const PHASE_MEANING: Record<string, string> = {
  foundation: 'Building the aerobic base the rest of the block sits on.',
  build: 'Adding the work rate you will need to hold on race day.',
  specific: 'Rehearsing the race itself — stations, and running on tired legs.',
  peak: 'Sharpening. Less volume, and the quality work close to race effort.',
  taper: 'Volume comes down so you arrive fresh. The sharpness is already there.',
  race: 'Race week. Enough to stay sharp, and nothing that costs you on the day.',
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
   * open overnight still holds its local marker, and a screen that reads
   * "you're done for today" from a workout finished yesterday is worse than one
   * that never said it. The server's `completed_on` is the local day the
   * session was actually credited to — and the marker now carries a day of its
   * own for the same reason.
   */
  completedToday: CompletedThisWeek[];
  /**
   * Bonus sessions the athlete may take, beyond what the week asks.
   *
   * Deliberately carries no count of how many are left. The app's founding rule
   * is that a missed day creates no backlog, and "1 of 3 taken" would reinstate
   * exactly that — an athlete who took none would have failed at something.
   */
  opportunities: Opportunity[];
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

/**
 * A session the athlete performed, as this device knows it before the server
 * does.
 *
 * Recorded when the player opens, because that is the last moment the app is
 * certain what is being trained: finishing clears the override, and the
 * engine's next answer is a different workout. A screen naming the finished
 * session from the live decision therefore names whatever comes next.
 */
export interface PerformedSession {
  template_id: string;
  name: string;
  estimated_minutes: number;
}

export interface PlanView {
  /**
   * True while a session finished on this device is not yet in the server's
   * week — the window the optimistic counters cover. False again the moment the
   * refetch lands, which is what stops them counting the same session twice.
   */
  pendingCompletion: boolean;
  /**
   * What that pending finish was, for the screens that have to name it. Null
   * outside the window, and null inside it when nothing recorded the session —
   * which is a missing name, never a wrong one.
   */
  pendingSession: PerformedSession | null;
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
 * The optimism has to expire, though, and expiring it took three goes. It began
 * as a bare flag that stayed true for the life of the app, so once the refetch
 * landed the same session was counted twice and the week read "2 / 7" for one
 * workout. Matching against the server's completed list fixed that, but only
 * for a session the server had answered about — offline there was no id to
 * match on, and the flag never retired at all. And matching alone still had
 * nothing to say about a week rollover, which empties the list the match reads.
 *
 * So it takes both: the id the device minted, which exists whether or not the
 * network did, and the day the finish belongs to.
 */
/**
 * A session this device finished that the server may not know about yet.
 *
 * Carries the day it was finished on as well as its id, because retiring it
 * needs both answers: the server's week no longer holding it can mean the
 * finish has not landed, or it can mean the week has rolled over and the
 * session belongs to the last one.
 */
export interface FinishedHere {
  client_session_id: string;
  /** The athlete's local day, as it was when they finished. */
  on: string;
}

export function planView(
  today: TodayPayload | null,
  finishedHere: FinishedHere | null = null,
  performed: PerformedSession | null = null,
): PlanView {
  /**
   * Whether the week the server sent already contains the session this device
   * finished — matched on the id the device itself minted.
   *
   * It used to match on the server's `session_id`, and that is why the optimism
   * had two ways of never expiring. Offline there was no server id to hold, so
   * the match could not succeed at all: the bump stayed, the server counted the
   * session once the outbox drained, and one workout read as two indefinitely.
   * And even with an id, a week rollover empties `week.completed`, so the match
   * failed again and last week's session re-inflated into the new week.
   *
   * The client id exists from the moment the player opens, network or no
   * network, and it is the same value the server stores — so this answers
   * correctly in both cases. The null guard matters: sessions recorded before
   * migration 0021 carry a null, and a null must never match a null.
   */
  const serverHasIt = finishedHere !== null
    && (today?.week?.completed ?? [])
      .some(c => c.client_session_id === finishedHere.client_session_id);

  /**
   * Whether the marker still describes today.
   *
   * The second half of retiring it, and the half that was missing. A rollover
   * empties `week.completed`, so `serverHasIt` goes false again for a session
   * that landed perfectly well last week — and the bump came back, crediting
   * the new week with a workout done in the old one and naming it as though it
   * had just been finished. A claim about Sunday stops being true on Monday.
   *
   * With no payload there is no day to check against, and the marker is the
   * better of the two answers available.
   */
  const stillToday = finishedHere !== null
    && (today?.date_local == null || finishedHere.on === today.date_local);

  const pendingCompletion = stillToday && !serverHasIt;
  const bump = pendingCompletion ? 1 : 0;
  // Only meaningful while the finish is pending: once the server's week holds
  // the session, its own row is the better answer and this one is stale.
  const pendingSession = pendingCompletion ? performed : null;

  if (!today) {
    return {
      pendingCompletion,
      pendingSession,
      race: null,
      phase: null,
      week: {
        done: bump, target: 0, queue: [], completed: [], completedToday: [],
        opportunities: [],
      },
      training7d: null,
      shape: { days_trained: 0, days_remaining: 0, queue_remaining: 0 },
    };
  }

  const { done, target } = countStimuli(today.stimulus_requirements ?? []);

  /**
   * Stimuli the week no longer owes anything toward.
   *
   * A session performed off the queue still credits its stimulus — a strength
   * session is a strength session whichever list it was started from — but it
   * claims no queue item, because claiming matches on template. So the two
   * could disagree: the counter read "8 / 8" while two strength sessions sat in
   * "up next", both of them for a requirement that was already met.
   *
   * Rare while everything came from the queue. Routine now that bonus workouts
   * are offered, since taking one is exactly the case that credits a stimulus
   * without touching the queue. Filtered at read time rather than written to
   * the rows: the requirement being met is the fact, and a later reshape or a
   * corrected finish should be free to change the answer.
   */
  const satisfied = new Set(
    (today.stimulus_requirements ?? [])
      .filter(r => r.completed_exposures >= r.target_exposures)
      .map(r => r.stimulus_type));

  // Sessions already performed, and stimuli already met, drop out of what is
  // still to come.
  const queue = (today.week?.queue ?? []).filter(
    q => q.state !== 'completed' && q.state !== 'skipped'
      && !satisfied.has(q.stimulus_type));

  return {
    pendingCompletion,
    pendingSession,
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
      opportunities: today.week?.opportunities ?? [],
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
