/**
 * Supporting detail for each readiness component on the Progress screen.
 *
 * These were a static fixture — every athlete saw the same "Z2 pace 8:52",
 * "215 squat", "16.2 km longest" regardless of what they had done. That is the
 * fabricated pace the workout screen deliberately refuses to show (see
 * steps.ts), so it is computed here from the same history the readiness bars
 * use.
 *
 * The rule is: a stat with no data behind it is OMITTED, never defaulted. A
 * missing row is honest; a zero reads as a measurement.
 */
import {
  daysAgo, sessionMinutes,
  type CardioLogRow, type SessionRow, type SetLogRow, type TemplateFacts,
} from './readiness-history.ts';

export interface Stat { k: string; v: string }
export interface MetricDetail { stats: Stat[] }

/** Lifts worth surfacing, in the order a strength card reads best. */
const HEADLINE_LIFTS: [string, string][] = [
  ['ex_back_squat', 'Squat'], ['ex_deadlift', 'Deadlift'], ['ex_push_press', 'Press'],
];
/** Ergs are the only stations that log a duration, so only they get a time. */
const TIMED_STATIONS: [string, string, number][] = [
  ['ex_skierg', 'Ski 1k', 1000], ['ex_rowerg', 'Row 1k', 1000],
];

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds - m * 60)).padStart(2, '0')}`;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** Seconds per km for one logged effort, however it was recorded. */
const paceOf = (c: CardioLogRow) =>
  c.pace_seconds_per_km ?? (c.distance_meters && c.duration_seconds
    ? c.duration_seconds / (c.distance_meters / 1000) : null);

export function metricDetailFrom(args: {
  today: string;
  sessions: SessionRow[];
  setLogs: SetLogRow[];
  cardioLogs: CardioLogRow[];
  templates: Map<string, TemplateFacts>;
  checkins: { local_date: string; sleep_hours: number | null; energy: string | null }[];
  queue: { state: string }[];
}): Record<string, MetricDetail> {
  const { today, sessions, setLogs, cardioLogs, templates, checkins, queue } = args;
  const byId = new Map(sessions.map(s => [s.id, s]));
  const within = (sid: string, days: number) => {
    const s = byId.get(sid);
    return !!s && daysAgo(today, s.started_at) < days;
  };
  const goalOf = (sid: string) => templates.get(byId.get(sid)?.template_id ?? '')?.primary_goal;

  const stats: Record<string, Stat[]> = {
    aerobic: [], running: [], strength: [], stations: [], consistency: [], recovery: [],
  };

  // ── aerobic ────────────────────────────────────────────────────────────
  // "Z2 pace" is the pace held on easy aerobic runs specifically, which is what
  // makes it comparable across weeks — a median, so one hard day cannot move it.
  const z2 = cardioLogs
    .filter(c => c.exercise_id === 'ex_run' && within(c.session_id, 30)
      && goalOf(c.session_id) === 'aerobic_durability')
    .map(paceOf).filter((p): p is number => !!p && p > 0);
  if (z2.length) stats.aerobic.push({ k: 'Z2 pace', v: `${clock(median(z2))}/km` });

  // Session RPE x duration — the standard internal-load figure, and the only
  // load we can compute without power or heart-rate zones.
  let load = 0, rpeSessions = 0;
  for (const s of sessions) {
    if (daysAgo(today, s.started_at) >= 30 || !s.session_rpe) continue;
    load += s.session_rpe * sessionMinutes(s, templates.get(s.template_id));
    rpeSessions++;
  }
  if (rpeSessions) stats.aerobic.push({ k: '30d load', v: Math.round(load).toLocaleString('en-US') });
  // HR drift needs a within-session split; cardio_logs stores one average, so
  // it is not derivable and is left out rather than approximated.

  // ── running ────────────────────────────────────────────────────────────
  const runs = cardioLogs.filter(c => c.exercise_id === 'ex_run' && within(c.session_id, 30));
  const paces = runs.map(paceOf).filter((p): p is number => !!p && p > 0);
  if (paces.length) stats.running.push({ k: 'Median km', v: clock(median(paces)) });
  const week = cardioLogs.filter(c => c.exercise_id === 'ex_run' && within(c.session_id, 7));
  const longest = Math.max(0, ...week.map(c => c.distance_meters ?? 0));
  if (longest) stats.running.push({ k: 'Longest', v: `${(longest / 1000).toFixed(1)} km` });
  const weekly = week.reduce((n, c) => n + (c.distance_meters ?? 0), 0);
  if (weekly) stats.running.push({ k: 'Weekly', v: `${(weekly / 1000).toFixed(1)} km` });

  // ── strength ───────────────────────────────────────────────────────────
  for (const [id, label] of HEADLINE_LIFTS) {
    const loads = setLogs.filter(l => l.exercise_id === id && within(l.session_id, 30)
      && l.actual_load).map(l => l.actual_load!);
    if (!loads.length) continue;
    const unit = setLogs.find(l => l.exercise_id === id && l.load_unit)?.load_unit ?? '';
    stats.strength.push({ k: label, v: `${Math.max(...loads)}${unit ? ' ' + unit : ''}` });
  }

  // ── stations ───────────────────────────────────────────────────────────
  for (const [id, label, refMeters] of TIMED_STATIONS) {
    const efforts = cardioLogs.filter(c => c.exercise_id === id && within(c.session_id, 30)
      && c.duration_seconds && c.distance_meters);
    if (!efforts.length) continue;
    // Normalised to the race distance so a 500 m repeat and a 1 km piece compare.
    const best = Math.min(...efforts.map(c => c.duration_seconds! / (c.distance_meters! / refMeters)));
    stats.stations.push({ k: label, v: clock(best) });
  }

  // ── consistency ────────────────────────────────────────────────────────
  const trained = sessions.filter(s => daysAgo(today, s.started_at) < 28);
  if (trained.length) stats.consistency.push({ k: 'Sessions/wk', v: (trained.length / 4).toFixed(1) });
  if (queue.length) {
    const skipped = queue.filter(q => q.state === 'skipped').length;
    stats.consistency.push({ k: 'Skipped', v: `${Math.round((skipped / queue.length) * 100)}%` });
  }

  // ── recovery ───────────────────────────────────────────────────────────
  const recent = checkins.filter(c => daysAgo(today, `${c.local_date}T00:00:00Z`) < 14);
  const slept = recent.map(c => c.sleep_hours).filter((h): h is number => h != null);
  if (slept.length) {
    stats.recovery.push({ k: 'Sleep', v: `${(slept.reduce((a, b) => a + b, 0) / slept.length).toFixed(1)} h` });
  }
  if (recent.length) stats.recovery.push({ k: 'Check-ins', v: `${recent.length}/14` });

  return Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [k, { stats: v }]),
  );
}
