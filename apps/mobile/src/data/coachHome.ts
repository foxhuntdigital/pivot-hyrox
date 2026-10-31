/**
 * What Coach suggests asking, and how it says what an answer rests on
 * (redesign plan, Coach tab).
 *
 * Home's starters change with the athlete's day instead of being a fixed menu
 * of six; a thread's chips are the next questions worth asking about the
 * answer on screen. Starters are sent as the athlete's own words, so the
 * classifier reads "I only have 30 minutes" as thirty minutes rather than as
 * a bare "make it shorter".
 *
 * Pure, so which starter appears when is tested.
 */
import type { CoachIntent } from './coach';

export interface Starter {
  label: string;
}

export function startersFor(day: {
  /** Today's session name, when there is one still to do. */
  sessionName: string | null;
  sessionMinutes: number | null;
  checkedIn: boolean;
  lowSleep: boolean;
  finishedToday: boolean;
  hasRace: boolean;
}, max = 4): Starter[] {
  const out: string[] = [];
  if (day.finishedToday) {
    out.push('How did today move my progress?');
  } else if (day.sessionName) {
    if (day.lowSleep) out.push('I slept badly. What should I change today?');
    out.push(`Why ${day.sessionName} today?`);
    if (day.sessionMinutes && day.sessionMinutes > 30) out.push('I only have 30 minutes today');
  }
  out.push("What's my biggest gap right now?");
  out.push('Am I getting faster?');
  out.push('Build me a 30-minute sled + run workout');
  out.push(day.hasRace ? 'I can only train four days this week' : "I'm travelling this week");
  return [...new Set(out)].slice(0, max).map(label => ({ label }));
}

/** The follow-ups a thread offers under its latest answer, as the actions they map to. */
export type FollowUp = { label: string; action: 'ask_weakness' | 'ask_explain' | 'ask_adapt' | 'ask_low_impact' | 'ask_build' };

const FOLLOW_UPS: Record<CoachIntent, FollowUp[]> = {
  explain: [
    { label: 'Make it shorter', action: 'ask_adapt' },
    { label: 'Low-impact options', action: 'ask_low_impact' },
    { label: "What's my biggest gap?", action: 'ask_weakness' },
  ],
  adapt: [
    { label: 'Why this session?', action: 'ask_explain' },
    { label: 'Low-impact options', action: 'ask_low_impact' },
  ],
  progress: [
    { label: "What's my biggest gap?", action: 'ask_weakness' },
    { label: 'Build me a session for it', action: 'ask_build' },
  ],
  weakness: [
    { label: 'Build me a session for it', action: 'ask_build' },
    { label: 'Why this session today?', action: 'ask_explain' },
  ],
  build: [
    { label: 'Make it shorter', action: 'ask_adapt' },
    { label: "What's my biggest gap?", action: 'ask_weakness' },
  ],
  travel: [
    { label: 'Why this session?', action: 'ask_explain' },
    { label: 'Low-impact options', action: 'ask_low_impact' },
  ],
  plan: [
    { label: 'Why this session today?', action: 'ask_explain' },
    { label: "What's my biggest gap?", action: 'ask_weakness' },
  ],
  safety: [],
  logged: [
    { label: "What's my biggest gap?", action: 'ask_weakness' },
    { label: 'Why this session?', action: 'ask_explain' },
  ],
};

/**
 * Chips for the latest answer: its intent's follow-ups, minus anything the
 * answer already offers as a button. A safety answer offers none: nothing
 * should invite training past a boundary.
 */
export function followUpsFor(intent: CoachIntent | null, offered: string[]): FollowUp[] {
  if (!intent) return FOLLOW_UPS.explain.filter(f => !offered.includes(f.action));
  return FOLLOW_UPS[intent].filter(f => !offered.includes(f.action));
}

/**
 * The evidence an answer used, as one quiet line: "Based on sleep 7:30, your
 * equipment and Build week 8". Chips arrive in the library's uppercase micro
 * voice; they are read here as words.
 */
export function basedOnLine(chips: string[]): string | null {
  // An all-caps chip is the micro-label voice, not a name, so it reads in
  // lower case; a chip written in mixed case ("Build week 8") keeps its own.
  const words = chips.map(c => c.trim()).filter(Boolean).map(c =>
    c === c.toUpperCase() ? c.toLowerCase() : c);
  if (!words.length) return null;
  // Each continues the sentence, so each starts in lower case.
  const all = words.map(w => w.charAt(0).toLowerCase() + w.slice(1));
  const joined = all.length === 1 ? all[0]
    : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
  return `Based on ${joined}`;
}
