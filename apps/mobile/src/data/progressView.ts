/**
 * The Progress tab's arithmetic, kept out of the screens so it can be tested.
 *
 * Everything here lays out numbers the server already measured (`progress`):
 * which days were trained, how many minutes a week, how readiness moved, what
 * each input stands at against full marks, and how far along a capability is.
 * None of it scores anything.
 */
import type { SessionKind } from '../theme/tokens';
import type {
  CapabilityDetail, CapabilityStateRow, IndexSession, ReadinessInputs, TrendPoint,
} from './progressRepo';

/* ── dates ──────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday of the week containing `date`. */
export function weekOf(date: string): string {
  const d = new Date(parse(date));
  return iso(parse(date) - ((d.getUTCDay() + 6) % 7) * DAY);
}

export function addDays(date: string, days: number): string {
  return iso(parse(date) + days * DAY);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];
/** "Oct 29". */
export const shortDate = (date: string) => `${SHORT[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
export const weekday = (date: string) => WEEKDAY[new Date(parse(date)).getUTCDay()];

/** "42 min", "3 h 17", "1 h 00". */
export function hoursText(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/* ── calendar ───────────────────────────────────────────────────────────── */

export interface DayCell {
  /** Null for the blanks before the 1st and after the last day. */
  date: string | null;
  day: number | null;
  sessions: IndexSession[];
  isToday: boolean;
  future: boolean;
}

/** A month as rows of seven, Monday first. */
export function monthGrid(month: string, sessions: IndexSession[], today: string): DayCell[] {
  const first = `${month}-01`;
  const lead = (new Date(parse(first)).getUTCDay() + 6) % 7;
  const next = Number(month.slice(5, 7)) === 12
    ? `${Number(month.slice(0, 4)) + 1}-01-01`
    : `${month.slice(0, 5)}${String(Number(month.slice(5, 7)) + 1).padStart(2, '0')}-01`;
  const days = Math.round((parse(next) - parse(first)) / DAY);

  const byDate = new Map<string, IndexSession[]>();
  for (const s of sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  const blank: DayCell = { date: null, day: null, sessions: [], isToday: false, future: false };
  const cells: DayCell[] = Array.from({ length: lead }, () => blank);
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    cells.push({
      date, day: d,
      // Oldest first, so a day's list reads in the order it was trained.
      sessions: [...(byDate.get(date) ?? [])].reverse(),
      isToday: date === today, future: date > today,
    });
  }
  while (cells.length % 7) cells.push(blank);
  return cells;
}

/** "19 sessions · 15 h 40", over the month's sessions. */
export function monthSummary(month: string, sessions: IndexSession[]): { count: number; minutes: number; text: string } {
  const inMonth = sessions.filter(s => s.date.startsWith(month));
  const minutes = inMonth.reduce((t, s) => t + (s.minutes ?? 0), 0);
  const count = inMonth.length;
  const text = count === 0
    ? 'No sessions yet'
    : `${count} ${count === 1 ? 'session' : 'sessions'}${minutes ? ` · ${hoursText(minutes)}` : ''}`;
  return { count, minutes, text };
}

/* ── training time ──────────────────────────────────────────────────────── */

export const KIND_ORDER: SessionKind[] = ['run', 'erg', 'station', 'strength', 'hybrid', 'recovery'];

export interface WeekMinutes {
  week: string;
  total: number;
  byKind: { kind: SessionKind; minutes: number }[];
}

/** The last `weeks` weeks of minutes, oldest first, stacked by kind. */
export function weeklyMinutes(
  sessions: IndexSession[], today: string, kindOf: (s: IndexSession) => SessionKind, weeks = 8,
): WeekMinutes[] {
  const thisWeek = weekOf(today);
  const out: WeekMinutes[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = addDays(thisWeek, -7 * i);
    const end = addDays(week, 6);
    const totals = new Map<SessionKind, number>();
    for (const s of sessions) {
      if (s.date < week || s.date > end || !s.minutes) continue;
      const k = kindOf(s);
      totals.set(k, (totals.get(k) ?? 0) + s.minutes);
    }
    const byKind = KIND_ORDER.filter(k => totals.has(k)).map(k => ({ kind: k, minutes: totals.get(k)! }));
    out.push({ week, total: byKind.reduce((t, k) => t + k.minutes, 0), byKind });
  }
  return out;
}

/* ── readiness ──────────────────────────────────────────────────────────── */

/** Daily rows averaged into weeks, oldest first. Weeks with no row are skipped. */
export function weeklyReadiness(trend: TrendPoint[]): { week: string; overall: number }[] {
  const weeks = new Map<string, number[]>();
  for (const p of trend) weeks.set(weekOf(p.date), [...(weeks.get(weekOf(p.date)) ?? []), p.overall]);
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, xs]) => ({ week, overall: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) }));
}

/**
 * How readiness moved: this week's average against the average `weeks` weeks
 * earlier, never two single days (a check-in alone can move one day).
 * Null until there is a week that far back to compare with.
 */
export function readinessChange(trend: TrendPoint[], today: string, weeks = 4):
  { now: number; from: number; delta: number; weeks: number } | null {
  const byWeek = new Map(weeklyReadiness(trend).map(w => [w.week, w.overall]));
  const now = byWeek.get(weekOf(today));
  const from = byWeek.get(addDays(weekOf(today), -7 * weeks));
  if (now == null || from == null) return null;
  return { now, from, delta: now - from, weeks };
}

/** "↑ 15 in 4 weeks", "↓ 3 in 4 weeks", "No change in 4 weeks". Never a plus sign. */
export function changeText(c: { delta: number; weeks: number }): string {
  if (c.delta === 0) return `No change in ${c.weeks} weeks`;
  return `${c.delta > 0 ? '↑' : '↓'} ${Math.abs(c.delta)} in ${c.weeks} weeks`;
}

/**
 * Where the line is heading by race week, if it keeps its recent slope.
 *
 * A straight fit through the last four weekly points, clamped to the scale.
 * Null under three weeks: two points draw a line through anything.
 */
export function projectTo(weekly: { week: string; overall: number }[], raceWeek: string): number | null {
  const recent = weekly.slice(-4);
  if (recent.length < 3) return null;
  const xs = recent.map(w => (parse(w.week) - parse(recent[0].week)) / (7 * DAY));
  const ys = recent.map(w => w.overall);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sxx = xs.reduce((t, x) => t + (x - mx) ** 2, 0);
  const slope = sxx ? xs.reduce((t, x, i) => t + (x - mx) * (ys[i] - my), 0) / sxx : 0;
  const ahead = (parse(raceWeek) - parse(recent[recent.length - 1].week)) / (7 * DAY);
  return Math.max(0, Math.min(100, Math.round(ys[ys.length - 1] + slope * Math.max(0, ahead))));
}

export const AREAS = [
  { key: 'aerobic', label: 'Aerobic' },
  { key: 'running', label: 'Running' },
  { key: 'strength', label: 'Strength' },
  { key: 'stations', label: 'Stations' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'recovery', label: 'Recovery' },
] as const;

export interface AreaInput { label: string; value: string; pct: number }

/** Readiness's own targets (`READINESS_TARGETS`), passed in so this file stays engine-free. */
export interface Targets {
  aerobic_minutes_14d: number;
  threshold_sessions_14d: number;
  run_sessions_7d: number;
  longest_run_km: number;
  stations_covered_21d: number;
}

const pctOf = (v: number, of: number) => Math.max(0, Math.min(100, Math.round((v / of) * 100)));
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** What one area is computed from, each input against its full-marks target. */
export function areaInputs(key: string, i: ReadinessInputs, targets: Targets):
  { inputs: AreaInput[]; full: string } {
  switch (key) {
    case 'aerobic': return {
      inputs: [
        { label: 'Easy aerobic minutes, last 14 days',
          value: `${num(i.aerobic_minutes_14d)} of ${targets.aerobic_minutes_14d}`,
          pct: pctOf(i.aerobic_minutes_14d, targets.aerobic_minutes_14d) },
        { label: 'Threshold sessions, last 14 days',
          value: `${i.threshold_sessions_14d} of ${targets.threshold_sessions_14d}`,
          pct: pctOf(i.threshold_sessions_14d, targets.threshold_sessions_14d) },
      ],
      full: `Full marks: ${targets.aerobic_minutes_14d} easy minutes and `
        + `${targets.threshold_sessions_14d} threshold sessions every two weeks.`,
    };
    case 'running': return {
      inputs: [
        { label: 'Runs, last 7 days', value: `${i.run_sessions_7d} of ${targets.run_sessions_7d}`,
          pct: pctOf(i.run_sessions_7d, targets.run_sessions_7d) },
        { label: 'Longest run, last 7 days', value: `${num(i.longest_run_km)} of ${targets.longest_run_km} km`,
          pct: pctOf(i.longest_run_km, targets.longest_run_km) },
      ],
      full: `Full marks: ${targets.run_sessions_7d} runs a week and a ${targets.longest_run_km} km long run.`,
    };
    case 'strength': return {
      inputs: [{ label: 'Prescribed reps completed, last 28 days',
        value: `${Math.round(i.strength_completion_rate * 100)}%`,
        pct: pctOf(i.strength_completion_rate, 1) }],
      full: 'Full marks: every prescribed rep in your strength sets completed.',
    };
    case 'stations': return {
      inputs: [{ label: 'Race stations trained, last 21 days',
        value: `${i.stations_covered_21d} of ${targets.stations_covered_21d}`,
        pct: pctOf(i.stations_covered_21d, targets.stations_covered_21d) }],
      full: `Full marks: all ${targets.stations_covered_21d} stations trained in three weeks.`,
    };
    case 'consistency': return {
      inputs: [{ label: 'Training needs met, last four weeks',
        value: `${Math.round(i.stimulus_adherence_4w * 100)}%`,
        pct: pctOf(i.stimulus_adherence_4w, 1) }],
      full: 'Full marks: every training need in each of the last four weeks met.',
    };
    case 'recovery': return {
      inputs: [{ label: 'Check-ins, last 7 days: sleep, energy, stress, soreness, motivation',
        value: `${Math.round(i.recovery_signal * 100)} of 100`,
        pct: pctOf(i.recovery_signal, 1) }],
      full: 'Read from your check-ins over the last seven days. No check-in in that time reads as not measured.',
    };
    default: return { inputs: [], full: '' };
  }
}

/** The biggest gap, said in numbers. */
export function gapReason(key: string, i: ReadinessInputs, targets: Targets): string {
  switch (key) {
    case 'stations': {
      const left = targets.stations_covered_21d - i.stations_covered_21d;
      return `${i.stations_covered_21d} of ${targets.stations_covered_21d} race stations trained in the last 21 days.`
        + (left > 0 ? ` Covering the other ${left} is the quickest way to raise readiness.` : '');
    }
    case 'aerobic':
      return `${num(i.aerobic_minutes_14d)} of ${targets.aerobic_minutes_14d} easy minutes and `
        + `${i.threshold_sessions_14d} of ${targets.threshold_sessions_14d} threshold sessions in the last 14 days.`;
    case 'running':
      return `${i.run_sessions_7d} of ${targets.run_sessions_7d} runs this week, longest `
        + `${num(i.longest_run_km)} of ${targets.longest_run_km} km.`;
    case 'strength':
      return `${Math.round(i.strength_completion_rate * 100)}% of prescribed strength reps completed in the last 28 days.`;
    case 'consistency':
      return `${Math.round(i.stimulus_adherence_4w * 100)}% of the last four weeks' training needs met.`;
    case 'recovery':
      return `Check-ins over the last week average ${Math.round(i.recovery_signal * 100)} of 100.`;
    default: return '';
  }
}

/* ── capabilities ───────────────────────────────────────────────────────── */

export type CapabilityTile =
  | { kind: 'direction'; word: 'Improving' | 'Holding' | 'Slipping'; dir: 'up' | 'flat' | 'down'; dots: 1 | 2 | 3 }
  | { kind: 'building'; steps: 0 | 1 | 2; note: string };

const DOTS = { low: 1, medium: 2, high: 3 } as const;

/**
 * A capability as its tile shows it.
 *
 * A direction appears once `capabilityState` has two readings to go on — the
 * same rule the evidence uses, so a tile never claims more than the state.
 * Before that it shows how far along it is: no session yet, a baseline set,
 * a first reading.
 */
export function capabilityTile(
  state: CapabilityStateRow | undefined, detail: CapabilityDetail | undefined,
): CapabilityTile {
  const readings = detail?.readings.length ?? 0;
  if (state && state.samples >= 2) {
    const dir = state.direction === 'positive' ? 'up' : state.direction === 'negative' ? 'down' : 'flat';
    return {
      kind: 'direction', dir, dots: DOTS[state.confidence],
      word: dir === 'up' ? 'Improving' : dir === 'down' ? 'Slipping' : 'Holding',
    };
  }
  if (readings >= 1) return { kind: 'building', steps: 2, note: 'First reading · 1 more' };
  if (detail?.baseline) return { kind: 'building', steps: 1, note: 'Baseline set · 2 more' };
  return { kind: 'building', steps: 0, note: 'Needs a first session' };
}

/* ── history ────────────────────────────────────────────────────────────── */

/** Sessions of one month, filtered by kind, for the month header. */
export function monthTotals(
  month: string, sessions: IndexSession[], kindOf: (s: IndexSession) => SessionKind, filter: SessionKind | 'all',
): string {
  const shown = sessions.filter(s => s.date.startsWith(month) && (filter === 'all' || kindOf(s) === filter));
  const minutes = shown.reduce((t, s) => t + (s.minutes ?? 0), 0);
  return `${shown.length} ${shown.length === 1 ? 'session' : 'sessions'}${minutes ? ` · ${hoursText(minutes)}` : ''}`;
}

/* ── splits ─────────────────────────────────────────────────────────────── */

export interface SplitLike {
  label: string;
  seconds: number;
  rest: boolean;
  block_order?: number | null;
  round?: number | null;
  exercise_id?: string | null;
}

export interface RoundTable {
  columns: string[];
  rows: { round: number; cells: Record<string, number>; total: number }[];
  /** One sentence on where the time went between the first and last round. */
  summary: string | null;
}

export function mmss(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The repeated block's laps as a table of rounds, or null when nothing repeats.
 *
 * `columnOf` names the column a lap goes in (Run, Ski, Stations), so the table
 * groups what the athlete would group. Rest is left out: it is structure, and
 * the round total is the work.
 */
export function roundTable(splits: SplitLike[], columnOf: (s: SplitLike) => string): RoundTable | null {
  const work = splits.filter(s => !s.rest && s.round != null && s.block_order != null);
  const blocks = new Map<number, SplitLike[]>();
  for (const s of work) blocks.set(s.block_order!, [...(blocks.get(s.block_order!) ?? []), s]);
  let best: SplitLike[] | null = null;
  let rounds = 1;
  for (const laps of blocks.values()) {
    const n = new Set(laps.map(l => l.round)).size;
    if (n > rounds) { rounds = n; best = laps; }
  }
  if (!best) return null;

  const columns: string[] = [];
  const byRound = new Map<number, Record<string, number>>();
  for (const lap of best) {
    const col = columnOf(lap);
    if (!columns.includes(col)) columns.push(col);
    const cells = byRound.get(lap.round!) ?? {};
    cells[col] = (cells[col] ?? 0) + lap.seconds;
    byRound.set(lap.round!, cells);
  }
  const rows = [...byRound.entries()].sort(([a], [b]) => a - b).map(([round, cells]) => ({
    round, cells, total: Object.values(cells).reduce((a, b) => a + b, 0),
  }));

  let summary: string | null = null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const diff = last.total - first.total;
  if (rows.length >= 2 && Math.abs(diff) >= 5) {
    const most = columns
      .map(c => ({ c, d: (last.cells[c] ?? 0) - (first.cells[c] ?? 0) }))
      .sort((a, b) => (diff > 0 ? b.d - a.d : a.d - b.d))[0];
    const share = most && Math.sign(most.d) === Math.sign(diff) && Math.abs(most.d) >= 3
      ? `, and ${Math.abs(most.d)} s of that was the ${most.c.toLowerCase()}` : '';
    summary = `Round ${last.round} was ${mmss(Math.abs(diff))} ${diff > 0 ? 'slower' : 'faster'} than round ${first.round}${share}.`;
  } else if (rows.length >= 2) {
    summary = `Every round within a few seconds of round ${first.round}: an even pace.`;
  }
  return { columns, rows, summary };
}
