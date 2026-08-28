/**
 * Coach's intent layer.
 *
 * Coach is a bounded orchestration surface (Coach brief §1, Appendix B):
 * natural language is classified into structured signals here, and nothing in
 * this file makes a training decision. The decisions come from the engine —
 * `state/coachAnswer.ts` turns these signals plus engine output into the cards
 * the thread renders.
 *
 * Two rules shape the classifier:
 *   * Symptom language routes to the safety boundary before anything else. It
 *     is never re-read as "low energy" and programmed around (brief §5.1, §10).
 *   * An unmatched question returns null rather than a guess, so Coach can say
 *     what it answers from instead of inventing an answer (brief §9.3).
 */
import type { ReasonCode } from '@pivot/engine';

export type CoachIntent =
  | 'explain'
  | 'adapt'
  | 'progress'
  | 'weakness'
  | 'build'
  | 'travel'
  | 'plan'
  | 'safety';

/** The structured signals Coach is allowed to extract from free text. */
export interface CoachSignals {
  /** Minutes the athlete says they have. */
  time_limit?: number;
  low_energy?: boolean;
  low_impact?: boolean;
  /** Equipment ids parsed from travel or gym language. */
  equipment?: string[];
  /** Content search terms for workout discovery. */
  keywords?: string[];
  /** Templates already offered in this thread, so "Show another" moves on. */
  exclude_template_ids?: string[];
  /** Training days the athlete says they have this week. */
  days?: number;
}

export interface Classified {
  intent: CoachIntent | null;
  signals: CoachSignals;
}

/** Thread titles come from the dominant intent (brief §4.3). */
export const INTENT_TITLE: Record<CoachIntent, string> = {
  explain: 'Why this session',
  adapt: 'Short session today',
  progress: '1 km pace progress',
  weakness: 'HYROX limiters',
  build: 'Workout request',
  travel: 'Travel week adjustments',
  plan: 'Weekly plan change',
  safety: 'What I can and cannot do',
};

/**
 * Coach Home's suggested prompts (brief §3.4). Six, matching the mock: enough
 * to show the range of what Coach answers from without reading as a menu of the
 * only things it understands.
 */
export const SUGGESTED_PROMPTS: { intent: CoachIntent; label: string }[] = [
  { intent: 'adapt', label: 'I only have 25 minutes today' },
  { intent: 'progress', label: 'Am I getting faster?' },
  { intent: 'weakness', label: 'What is my biggest HYROX weakness?' },
  { intent: 'build', label: 'Build me a 30-minute sled + run workout' },
  { intent: 'travel', label: "I'm travelling with a treadmill and dumbbells" },
  { intent: 'plan', label: 'I can only train four days this week' },
];

/**
 * The phrasing each suggested prompt puts in the thread as the athlete's own
 * message. A tapped chip is still a question the athlete asked, so it reads as
 * one (brief §4.1 — preserve original wording).
 */
export const INTENT_UTTERANCE: Record<CoachIntent, string> = {
  explain: 'Why this workout today?',
  adapt: 'I only have 25 minutes today',
  progress: 'Am I getting faster?',
  weakness: 'What is my biggest HYROX weakness right now?',
  build: 'Build me a 30-minute sled and running workout',
  travel: "I'm travelling with a treadmill and dumbbells",
  plan: 'I can only train four days this week',
  safety: 'My knee has a sharp pain when I run — what should I do?',
};

/**
 * Engine reason codes in plain language (brief Appendix B — "workout
 * explanations should be grounded in engine reason codes"). The evidence drawer
 * translates these; it does not compose its own reasons.
 */
export const REASON_CODE_COPY: Record<ReasonCode, string> = {
  STIMULUS_DUE: 'this stimulus is still outstanding for the week',
  RECOVERY_HIGH: 'your recovery inputs support a full session',
  RECOVERY_NORMAL: 'recovery is where it usually sits',
  RECOVERY_LOW: 'recovery inputs are low, so volume is capped before intensity',
  TIME_LIMIT: 'the time you told me you have',
  EQUIPMENT_MATCH: 'everything it needs is in your equipment profile',
  EQUIPMENT_SUBSTITUTION: 'a movement was swapped to fit your equipment',
  IMPACT_REDUCTION: 'impact was reduced to respect a return-to-training consideration',
  PROGRESSION_CONTINUITY: 'it follows on from your last comparable session',
  RACE_SPECIFICITY: 'it carries race-specific transfer this close to your race',
  RECENT_LOWER_LOAD: 'recent load left room for this',
  TAPER_OVERRIDE: 'taper rules override the usual stimulus order',
  REENTRY_AFTER_GAP: 'you are coming back after a gap, so this rebuilds rather than tests',
  ATHLETE_OVERRIDE: 'you chose this one yourself, against the reduced version suggested',
  NO_VALID_HARD_SESSION: 'no hard session is valid today',
};

/** Equipment vocabulary, mapped to the content library's equipment ids. */
const EQUIPMENT_TERMS: [RegExp, string[]][] = [
  [/treadmill|hotel gym/, ['treadmill']],
  [/dumbbell|\bdbs?\b/, ['db']],
  [/kettlebell|\bkbs?\b/, ['kb']],
  [/barbell|squat rack|\brack\b/, ['barbell', 'rack']],
  [/rower|row(ing)? (erg|machine)/, ['row_erg']],
  [/ski ?erg/, ['ski']],
  [/\bbike\b|spin bike|assault bike/, ['bike']],
  [/\bsled\b/, ['sled']],
  [/wall ?ball/, ['wall_ball']],
  [/sandbag/, ['sandbag']],
  [/plyo ?box|\bbox\b/, ['box']],
  [/\bbench\b/, ['bench']],
  [/pull-?up bar|\brig\b/, ['rig']],
  [/jump ?rope|skipping rope/, ['jump_rope']],
  // Somewhere to run. Since running became an equipment constraint rather than
  // a free resource, an athlete listing what they have needs a way to say this
  // — "only dumbbells" is a different week from "only dumbbells, but there's a
  // park" and the engine can now tell them apart.
  [/outside|outdoors|\bpark\b|\btrail|\btrack\b|streets?\b/, ['outdoor']],
  [/nothing|no equipment|body ?weight|hotel room|bare room/, ['bodyweight']],
];

/** Content search terms Coach will accept for workout discovery. */
const CONTENT_TERMS = [
  'sled', 'run', 'running', 'ski', 'row', 'rowing', 'wall ball', 'burpee', 'carry',
  'lunge', 'strength', 'legs', 'upper', 'pull', 'push', 'threshold', 'tempo',
  'interval', 'repeat', 'hybrid', 'recovery', 'mobility', 'bike', 'compromised',
  'station', 'micro', 'engine', 'simulation', 'density',
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
};

/**
 * Symptom and clearance language. Deliberately broad: over-routing a question
 * to the boundary card costs the athlete one extra tap, while under-routing it
 * means Coach programmes around pain as though it were fatigue.
 */
const SAFETY_RE =
  /\b(pain|painful|hurts?|hurting|injur\w*|strain\w*|sprain\w*|tweak\w*|pulled|clearance|physio|doctor|is it safe|safe to (train|run)|see a (doctor|physio))\b/;

/** Language that means "make it easier on my joints", not "I am in pain". */
const LOW_IMPACT_RE = /low[- ]impact|joint[- ]friendly|no jumping|no impact|off my (knees|joints)/;

const PLAN_RE =
  /(only|just|can) .{0,20}\b(train|training)\b|\b(train|training)\b.{0,20}\bdays?\b|reduce (my )?(week|training|volume)|cut (my|the|down) (week|training)|drop a (session|day)|four[- ]day|4[- ]day/;

const TRAVEL_RE =
  /travel\w*|hotel|away|trip|on the road|conference|airbnb|visiting|out of town/;

const BUILD_RE =
  /build|give me|make me|write me|create|design|show me a (workout|session)|(workout|session) (for|with|using|that)|i want a (workout|session)|something with/;

const PROGRESS_RE =
  /faster|slower|improv\w*|progress\w*|trend\w*|getting better|any better|pace (going|trending)|am i (fitter|fit)/;

const WEAKNESS_RE =
  /weak\w*|limiter|limiting|worst|holding me back|what should i (work on|improve|focus on)|biggest gap/;

const EXPLAIN_RE =
  /^why\b|\bwhy (this|that|did|is|am|are|not)\b|explain|how did you (pick|choose)|instead of/;

const ADAPT_RE =
  /adapt|shorten|shorter|cut it|squeeze|tired|exhaust\w*|knackered|wiped|no sleep|didn'?t sleep|slept (badly|poorly|terribly)|up all night|short on time|pressed for time|less time|only have/;

function parseMinutes(text: string): number | undefined {
  const explicit = text.match(/(\d{1,3})\s*(?:-|\s)?\s*(?:min|mins|minutes|m\b)/);
  if (explicit) return clampMinutes(Number(explicit[1]));

  const hours = text.match(/(?:an?|1|one)\s*(?:and a half\s*)?hour/);
  if (hours) return /and a half/.test(hours[0]) ? 90 : 60;
  if (/half an hour/.test(text)) return 30;

  // "I have 25 today" — a bare number next to availability language.
  const bare = text.match(/\b(?:have|got|only)\s+(\d{1,3})\b/);
  if (bare) return clampMinutes(Number(bare[1]));
  return undefined;
}

function clampMinutes(n: number): number | undefined {
  return n >= 5 && n <= 240 ? n : undefined;
}

function parseDays(text: string): number | undefined {
  const digits = text.match(/\b([1-7])\s*days?\b/);
  if (digits) return Number(digits[1]);
  const words = text.match(/\b(one|two|three|four|five|six|seven)\s*days?\b/);
  if (words) return NUMBER_WORDS[words[1]];
  return undefined;
}

function parseEquipment(text: string): string[] | undefined {
  const ids = new Set<string>();
  for (const [re, values] of EQUIPMENT_TERMS) {
    if (re.test(text)) values.forEach(v => ids.add(v));
  }
  if (!ids.size) return undefined;
  // Bodyweight work is always available, and every travel set needs it so the
  // engine can fill gaps rather than return nothing.
  ids.add('bodyweight');
  return [...ids];
}

function parseKeywords(text: string): string[] | undefined {
  const hits = CONTENT_TERMS.filter(term => text.includes(term));
  return hits.length ? hits : undefined;
}

/**
 * Free text → intent + signals. Order is the specification: safety first, then
 * the intents that mutate a week, then the ones that only explain.
 */
export function classify(raw: string): Classified {
  const text = raw.toLowerCase().trim();
  const time_limit = parseMinutes(text);
  const equipment = parseEquipment(text);
  const keywords = parseKeywords(text);
  const days = parseDays(text);
  const low_energy =
    /tired|exhaust\w*|no sleep|didn'?t sleep|slept (badly|poorly|terribly)|up all night|wrecked|wiped|knackered|drained/.test(text);
  const low_impact = LOW_IMPACT_RE.test(text);

  if (SAFETY_RE.test(text) && !low_impact) return { intent: 'safety', signals: {} };

  if (PLAN_RE.test(text) && (days !== undefined || /week/.test(text))) {
    return { intent: 'plan', signals: { days: days ?? 4 } };
  }

  if (TRAVEL_RE.test(text) || (equipment && /only|just|all i have|all i've got/.test(text))) {
    return { intent: 'travel', signals: { equipment: equipment ?? ['bodyweight'], days } };
  }

  // "Why did you give me this?" is an explanation request, not a build request,
  // even though it contains "give me" — so explain is tested first. A "why am I
  // not getting faster" question is a progress question, and stays one.
  if (EXPLAIN_RE.test(text) && !PROGRESS_RE.test(text)) {
    return { intent: 'explain', signals: {} };
  }

  if (BUILD_RE.test(text) && keywords) {
    return { intent: 'build', signals: { keywords, time_limit } };
  }

  if (PROGRESS_RE.test(text)) return { intent: 'progress', signals: {} };
  if (WEAKNESS_RE.test(text)) return { intent: 'weakness', signals: {} };

  if (time_limit !== undefined || low_energy || low_impact || ADAPT_RE.test(text)) {
    return { intent: 'adapt', signals: { time_limit, low_energy, low_impact } };
  }

  if (equipment) return { intent: 'travel', signals: { equipment } };

  return { intent: null, signals: {} };
}

/**
 * Content search terms for each readiness component, so "build me a session
 * for it" after a limiter answer searches for the right kind of work rather
 * than asking the athlete to restate what Coach just told them.
 */
export const LIMITER_KEYWORDS: Record<string, string[]> = {
  aerobic: ['engine', 'threshold'],
  running: ['run', 'compromised'],
  strength: ['strength', 'legs'],
  stations: ['station', 'sled', 'wall ball'],
  consistency: ['micro'],
  recovery: ['recovery', 'mobility'],
};

/** "2h", "3d" — the age label on Coach Home's recent threads. */
export function relativeAge(epochMs: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - epochMs) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
