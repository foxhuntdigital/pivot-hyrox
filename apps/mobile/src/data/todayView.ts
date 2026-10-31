/**
 * What Today's supporting rows say (redesign plan, Today tab).
 *
 * Pure, so the wording rules are tested rather than eyeballed: readiness never
 * shows a bare low number on thin data, and the check-in row says only what
 * the athlete actually told us.
 */

/** Variant codes as the app says them: "Full", not the engine's "FULL" or "green". */
export const LENGTH_NAME: Record<string, string> = { green: 'Full', yellow: 'Express', red: 'Micro' };

export interface ReadinessLine {
  /** "Building a baseline", or "On track · 62". */
  headline: string;
  /** "2 of 6 areas measured", or "Medium confidence · 5 of 6 areas measured". */
  detail: string;
}

/**
 * A score is shown only once it rests on something. Low confidence, or no
 * score at all, reads "Building a baseline" with how much is measured, so a
 * new athlete is not handed "23/100" built from almost no data.
 */
export function readinessLine(r: {
  overall: number | null;
  confidence: string;
  observed?: string[] | null;
}, areas = 6): ReadinessLine {
  const measured = `${Math.min(areas, r.observed?.length ?? 0)} of ${areas} areas measured`;
  if (r.overall == null || r.confidence === 'low') {
    return { headline: 'Building a baseline', detail: measured };
  }
  const word = r.overall >= 80 ? 'Race ready'
    : r.overall >= 60 ? 'On track'
    : r.overall >= 40 ? 'Building'
    : 'Early days';
  const confidence = r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1);
  return { headline: `${word} · ${r.overall}`, detail: `${confidence} confidence · ${measured}` };
}

export interface CheckinLine {
  title: string;
  detail: string;
  /** What the row's action says. */
  action: 'Check in' | 'Edit';
  /** True when the night reported is short enough to have changed today. */
  warn: boolean;
}

export function checkinLine(args: {
  checkedIn: boolean;
  sleepClock: string | null;
  lowSleep: boolean;
  energy: string | null;
  finishedToday: boolean;
}): CheckinLine {
  if (!args.checkedIn) {
    return args.finishedToday
      ? { title: 'How did you sleep?', detail: 'Still worth logging: it keeps readiness accurate.',
          action: 'Check in', warn: false }
      : { title: 'How did you sleep?', detail: "20 seconds. Keeps today's session and readiness honest.",
          action: 'Check in', warn: false };
  }
  const parts = [
    args.sleepClock ? `Slept ${args.sleepClock}` : null,
    args.energy ? `${args.energy} energy` : null,
  ].filter(Boolean);
  return {
    title: parts.length ? parts.join(' · ') : 'Checked in',
    detail: args.lowSleep
      ? "Short night. Today's session has been sized for it."
      : "Today's session is built around it.",
    action: 'Edit',
    warn: args.lowSleep,
  };
}
