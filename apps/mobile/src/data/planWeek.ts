/**
 * The Plan tab's week, as tiles and rows (redesign plan, Plan tab direction A).
 *
 * One tile per session: the ones done, today's, the ones still to do, and any
 * dropped this week, in that order. A tile is a session, not a training need:
 * "4 of 6 done" counts sessions an athlete can see, where the old "4 / 6
 * completed" counted stimulus exposures they could not. A bonus session that
 * was not part of the plan is its own tile marked as extra, so it never makes
 * the planned week look further along than it is.
 *
 * Pure: the screen passes in the week and a way to look a template up, which
 * is what lets the parts a rewrite most easily loses (the ended-early note and
 * the Do-today warnings) be tested.
 */
import type { SessionKind } from '../theme/tokens';
import type { CompletedThisWeek, Opportunity, QueuedSession } from './todayRepo';
import type { PerformedSession } from './plan';

export type TileState = 'done' | 'today' | 'todo' | 'skipped';

/** What the week needs to know about a session's template. */
export interface TemplateLook {
  kind: SessionKind;
  /** 1 easy, 2 steady, 3 hard: the marks on a tile. */
  effort: 1 | 2 | 3;
  description: string | null;
  supplemental: boolean;
  /** Loaded work for time rather than for load: an EMOM, a metcon. Reads as a circuit. */
  circuit?: boolean;
}

export interface WeekTile {
  key: string;
  templateId: string | null;
  name: string;
  minutes: number | null;
  state: TileState;
  kind: SessionKind;
  effort: 1 | 2 | 3;
  /** Done but not part of the plan: a bonus or a supplemental. Marked "+". */
  extra: boolean;
  circuit: boolean;
  endedEarly: boolean;
  subline: string;
  description: string | null;
  /** The queue item behind a to-do or today tile, for Read workout and Do today. */
  queued: QueuedSession | null;
}

export interface WeekSummary {
  tiles: WeekTile[];
  /** Planned sessions done, and planned sessions in all (extras and skipped excluded). */
  done: number;
  planned: number;
  left: number;
  leftMinutes: number;
  /** "5 left · 3 h 15", or "Week complete". */
  leftLine: string;
}

/** The library's names use an em dash between name and variant; the app shows a middle dot. */
export function displayName(name: string): string {
  return name.replace(/\s+[—–]\s+/g, ' · ');
}

/** RPE → the 1-3 effort marks. 4 and under is easy, 5-6 steady, 7 and over hard. */
export function effortOf(rpe: number | null): 1 | 2 | 3 {
  if (rpe == null) return 2;
  return rpe <= 4 ? 1 : rpe <= 6 ? 2 : 3;
}

/** How a session will feel, in words: what a row says under its name. */
const FEEL: Record<SessionKind, [string, string, string]> = {
  run: ['Easy run', 'Steady run', 'Hard run'],
  erg: ['Easy engine', 'Steady engine', 'Hard engine'],
  station: ['Easy station work', 'Steady station work', 'Hard station work'],
  strength: ['Light strength', 'Strength', 'Heavy strength'],
  hybrid: ['Easy hybrid', 'Steady hybrid', 'Hard hybrid'],
  recovery: ['Recovery', 'Recovery', 'Recovery'],
};

/** Strength-coloured work done for time: "heavy" would say load, and it is not. */
const CIRCUIT: [string, string, string] = ['Easy circuit', 'Steady circuit', 'Hard circuit'];

export function feelOf(kind: SessionKind, effort: 1 | 2 | 3, circuit = false): string {
  return (circuit && kind === 'strength' ? CIRCUIT : FEEL[kind])[effort - 1];
}

/** 195 → "3 h 15"; 45 → "45 min". */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function subline(tile: Omit<WeekTile, 'subline'>): string {
  const min = tile.minutes ? `${tile.minutes} min` : null;
  const feel = feelOf(tile.kind, tile.effort, tile.circuit);
  const parts = {
    done: ['Done', tile.endedEarly ? 'ended early' : null, tile.extra ? 'extra' : null, min],
    today: ['Today', feel, min],
    todo: [feel, min],
    skipped: ['Skipped', feel],
  }[tile.state];
  return parts.filter(Boolean).join(' · ');
}

const FALLBACK: TemplateLook = { kind: 'strength', effort: 2, description: null, supplemental: false };

export function buildWeek(args: {
  completed: CompletedThisWeek[];
  /** A session finished on this device that the server's week does not hold yet. */
  pendingSession: PerformedSession | null;
  /** Today's session while it is still to do. */
  today: { templateId: string; name: string; minutes: number | null; queued: QueuedSession | null } | null;
  /** The queue after today's claim: what is still to come. */
  upNext: QueuedSession[];
  skipped: QueuedSession[];
  opportunities: Opportunity[];
  look: (templateId: string) => TemplateLook | null;
}): WeekSummary {
  const bonusIds = new Set(args.opportunities.filter(o => o.done).map(o => o.template_id));
  const tiles: WeekTile[] = [];
  const push = (t: Omit<WeekTile, 'subline'>) => tiles.push({ ...t, subline: subline(t) });
  const lookOf = (id: string | null) => (id ? args.look(id) : null) ?? FALLBACK;

  for (const c of args.completed) {
    const l = lookOf(c.template_id);
    push({
      key: c.session_id, templateId: c.template_id, name: displayName(c.name),
      minutes: c.estimated_minutes, state: 'done', kind: l.kind, effort: l.effort, circuit: !!l.circuit,
      extra: l.supplemental || bonusIds.has(c.template_id),
      endedEarly: c.ended_early, description: l.description, queued: null,
    });
  }
  if (args.pendingSession) {
    const p = args.pendingSession;
    const l = lookOf(p.template_id);
    push({
      key: 'pending', templateId: p.template_id, name: displayName(p.name),
      minutes: p.estimated_minutes, state: 'done', kind: l.kind, effort: l.effort, circuit: !!l.circuit,
      extra: false, endedEarly: false, description: l.description, queued: null,
    });
  }
  if (args.today) {
    const d = args.today;
    const l = lookOf(d.templateId);
    push({
      key: 'today', templateId: d.templateId, name: displayName(d.name),
      minutes: d.minutes, state: 'today', kind: l.kind, effort: l.effort, circuit: !!l.circuit,
      extra: false, endedEarly: false, description: l.description, queued: d.queued,
    });
  }
  for (const q of args.upNext) {
    const l = lookOf(q.template_id);
    push({
      key: q.id, templateId: q.template_id, name: displayName(q.name),
      minutes: q.estimated_minutes, state: 'todo', kind: l.kind, effort: l.effort, circuit: !!l.circuit,
      extra: false, endedEarly: false, description: l.description, queued: q,
    });
  }
  for (const q of args.skipped) {
    const l = lookOf(q.template_id);
    push({
      key: `skipped:${q.id}`, templateId: q.template_id, name: displayName(q.name),
      minutes: q.estimated_minutes, state: 'skipped', kind: l.kind, effort: l.effort, circuit: !!l.circuit,
      extra: false, endedEarly: false, description: l.description, queued: null,
    });
  }

  const plannedTiles = tiles.filter(t => !t.extra && t.state !== 'skipped');
  const done = plannedTiles.filter(t => t.state === 'done').length;
  const leftTiles = plannedTiles.filter(t => t.state === 'today' || t.state === 'todo');
  const leftMinutes = leftTiles.reduce((n, t) => n + (t.minutes ?? 0), 0);
  const leftLine = leftTiles.length
    ? `${leftTiles.length} left${leftMinutes ? ` · ${clock(leftMinutes)}` : ''}`
    : plannedTiles.length ? 'Week complete' : '';
  return { tiles, done, planned: plannedTiles.length, left: leftTiles.length, leftMinutes, leftLine };
}

/* ── Do today ─────────────────────────────────────────────────────────────── */

export type SwitchResult = { ok: true } | { ok: false; reason: 'recovery' | 'symptom' | 'unavailable' };

/**
 * What happens when Do today is tapped, given what `switchToQueued` answered.
 * The copy and the rules are the old Plan tab's, kept word for word: a
 * recovery warning is advice the athlete can overrule, a symptom is a stop,
 * and a session the day cannot build points them at Adapt.
 */
export type DoTodayStep =
  | { kind: 'go' }
  | { kind: 'confirm'; eyebrow: string; title: string; body: string; confirmLabel: string; cancelLabel: string }
  | { kind: 'alert'; eyebrow: string; title: string; body: string };

export function doTodayStep(result: SwitchResult, name: string): DoTodayStep {
  if (result.ok) return { kind: 'go' };
  if (result.reason === 'recovery') {
    return {
      kind: 'confirm',
      eyebrow: 'Are you sure?',
      title: `${name} is more than today supports`,
      body: "Based on your check-in, this asks for more than today's "
        + 'recommendation. You can still do it — you know how you feel better '
        + 'than the check-in does. Ease off if it stops feeling right.',
      confirmLabel: 'Do it anyway',
      cancelLabel: 'Not today',
    };
  }
  return {
    kind: 'alert',
    eyebrow: 'Not today',
    title: `${name} doesn't fit today`,
    body: result.reason === 'symptom'
      ? 'You reported a symptom that training hard through would not be '
        + 'reasonable. This one is not something to push past — rest today, '
        + 'and get it looked at if it persists.'
      : `${name} isn't something this can build from the equipment and `
        + 'constraints you have reported today. Adapt from the Today tab and '
        + 'it will offer what fits.',
  };
}

/** After "Do it anyway", if the override itself could not be applied. */
export function overrideFailed(name: string): DoTodayStep {
  return {
    kind: 'alert',
    eyebrow: 'Not today',
    title: `${name} could not be applied`,
    body: 'Something about today changed while you were deciding. Try again.',
  };
}
