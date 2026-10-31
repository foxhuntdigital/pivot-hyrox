/**
 * What the Progress tab draws, shaped from stored rows.
 *
 * `progress` is the read behind the redesigned tab and its subpages: the
 * readiness line, the training calendar and weekly time, each capability's
 * page, and the highlights. Everything here is a pure function over rows so the
 * arithmetic is testable without a database; the function file only fetches.
 *
 * Nothing in this file decides anything about the athlete. Directions and
 * confidence come from `capabilityState` and the evidence log; this file only
 * lays out what those rows, and the logs behind them, already say.
 */
import { rangesOverlap, type Exposure, type ExerciseHistory } from './exercise-history.ts';
import { capabilityFor, type CapabilityKey, type EvidenceOntology } from './evidence.ts';
import type { ComparableSeries } from './comparable.ts';
import { personalRecordsIn } from './prs.ts';

/* ------------------------------------------------------------ sessions --- */

/** One completed session, as small as the calendar and the weekly chart need. */
export interface IndexSession {
  id: string;
  /** The athlete's local date, from the snapshot. */
  date: string;
  template_id: string;
  variant_code: string | null;
  name: string;
  minutes: number | null;
  rpe: number | null;
  ended_early: boolean;
  supplemental: boolean;
}

export interface IndexRow {
  id: string;
  template_id: string;
  variant_code?: string | null;
  started_at: string | null;
  ended_at: string | null;
  session_rpe?: number | null;
  ended_early?: boolean | null;
  workout_role?: string | null;
  /** Pulled out of `snapshot_json` by the query, so the whole snapshot is not sent. */
  name?: string | null;
  local_date?: string | null;
  estimated_minutes?: number | string | null;
}

/**
 * Every completed session, newest first.
 *
 * Minutes are what the clock measured, falling back to what the session was
 * planned at. That is the same rule readiness uses (`sessionMinutes`), so the
 * training-time chart and the aerobic minutes behind readiness cannot disagree
 * about how long a session took.
 */
export function sessionIndex(rows: IndexRow[]): IndexSession[] {
  return rows.map(r => {
    let minutes: number | null = null;
    if (r.started_at && r.ended_at) {
      const m = (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60_000;
      if (m > 0 && m < 300) minutes = Math.round(m);
    }
    if (minutes == null && r.estimated_minutes != null && Number(r.estimated_minutes) > 0) {
      minutes = Math.round(Number(r.estimated_minutes));
    }
    return {
      id: r.id,
      date: r.local_date ?? (r.started_at ?? '').slice(0, 10),
      template_id: r.template_id,
      variant_code: r.variant_code ?? null,
      name: r.name ?? r.template_id,
      minutes,
      rpe: r.session_rpe ?? null,
      ended_early: !!r.ended_early,
      supplemental: (r.workout_role ?? 'primary') === 'supplemental',
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

/* --------------------------------------------------------------- trend --- */

export interface SnapshotRow {
  local_date: string;
  overall: number;
  confidence: string;
  components_json: { components?: Record<string, number>; observed?: string[] } | null;
}

export interface TrendPoint {
  date: string;
  overall: number;
  confidence: string;
  components: Record<string, number>;
  observed: string[];
}

/** The stored daily readiness rows, oldest first, as the line draws them. */
export function trendFrom(rows: SnapshotRow[]): TrendPoint[] {
  return [...rows]
    .sort((a, b) => a.local_date.localeCompare(b.local_date))
    .map(r => ({
      date: r.local_date,
      overall: r.overall,
      confidence: r.confidence,
      components: r.components_json?.components ?? {},
      observed: r.components_json?.observed ?? [],
    }));
}

/* --------------------------------------------------------- capabilities --- */

/** One stored evidence row, with the session it was read from. */
export interface EvidenceRow {
  capability_key: CapabilityKey;
  direction: 'negative' | 'neutral' | 'positive';
  magnitude_band: 'small' | 'moderate' | 'large';
  confidence_band: 'low' | 'medium' | 'high';
  source_session_id: string | null;
  created_at: string;
}

export interface Reading {
  date: string;
  direction: EvidenceRow['direction'];
  band: EvidenceRow['magnitude_band'];
  confidence: EvidenceRow['confidence_band'];
  session_id: string | null;
  session_name: string | null;
}

export interface Lift {
  exercise_id: string;
  name: string;
  /** The rep range the lift is compared at, from its first session. */
  reps_min: number | null;
  reps_max: number | null;
  start: number;
  now: number;
  unit: string | null;
}

export interface SeriesPoint {
  /** Monday of the week. */
  week: string;
  /** Mean percent on each lift's own baseline, across the lifts started by then. */
  pct: number;
  /** The latest session that week that touched these lifts. */
  session_id: string;
  session_name: string;
  /** What moved, said plainly: "Back squat 100 to 105 kg for 5". */
  detail: string;
}

export interface CapabilityDetail {
  readings: Reading[];
  lifts: Lift[];
  series: SeriesPoint[];
  /** The first session this capability was measured from. */
  baseline: { date: string; session_id: string; session_name: string } | null;
}

/** Monday of the week containing `date`, as an ISO date. */
export function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const fmtLoad = (n: number, unit: string | null) =>
  `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ` ${unit}` : ''}`;
const repsOf = (e: { reps_min: number | null; reps_max: number | null; top_reps: number | null }) =>
  e.top_reps ?? e.reps_max ?? e.reps_min;

/**
 * The capability page's chart and lift rows, for the load-based capabilities.
 *
 * Each lift is measured against its own first full session, and only against
 * later sessions at an overlapping rep range — the same comparison the evidence
 * rules make, so the chart and the direction above it are read the same way.
 * A reduced dose never counts: Express and Micro are lighter on purpose.
 *
 * Cardio capabilities have no load to chart and come back with no lifts and no
 * series; their page shows the readings instead.
 */
export function capabilityDetails(args: {
  histories: Map<string, ExerciseHistory>;
  ontology: Map<string, EvidenceOntology>;
  exerciseNames: Map<string, string>;
  sessionNames: Map<string, string>;
  evidence: EvidenceRow[];
}): Record<string, CapabilityDetail> {
  const { histories, ontology, exerciseNames, sessionNames, evidence } = args;
  const out: Record<string, CapabilityDetail> = {};
  const ensure = (key: string) =>
    (out[key] ??= { readings: [], lifts: [], series: [], baseline: null });

  for (const row of [...evidence].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    ensure(row.capability_key).readings.push({
      date: row.created_at.slice(0, 10),
      direction: row.direction,
      band: row.magnitude_band,
      confidence: row.confidence_band,
      session_id: row.source_session_id,
      session_name: row.source_session_id ? sessionNames.get(row.source_session_id) ?? null : null,
    });
  }

  /** Per capability: each lift's comparable exposures, oldest first. */
  const byCapability = new Map<string, { id: string; exposures: Exposure[] }[]>();
  for (const [id, history] of histories) {
    const key = capabilityFor(id, ontology.get(id));
    if (!key) continue;
    const full = history.exposures
      .filter(e => e.context === 'full' && e.top_load != null && e.top_load > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!full.length) continue;
    const base = full[0];
    const comparable = full.filter(e => rangesOverlap(e, base));
    byCapability.set(key, [...(byCapability.get(key) ?? []), { id, exposures: comparable }]);
  }

  for (const [key, lifts] of byCapability) {
    const detail = ensure(key);
    detail.lifts = lifts
      .map(({ id, exposures }) => {
        const base = exposures[0];
        const last = exposures[exposures.length - 1];
        return {
          exercise_id: id,
          name: exerciseNames.get(id) ?? id,
          reps_min: base.reps_min,
          reps_max: base.reps_max,
          start: base.top_load!,
          now: last.top_load!,
          unit: base.load_unit,
        };
      })
      // The lifts with the most behind them first; a lift done once says least.
      .sort((a, b) =>
        (lifts.find(l => l.id === b.exercise_id)!.exposures.length)
        - (lifts.find(l => l.id === a.exercise_id)!.exposures.length));

    const all = lifts.flatMap(l => l.exposures).sort((a, b) => a.date.localeCompare(b.date));
    const first = all[0];
    detail.baseline = {
      date: first.date,
      session_id: first.session_id,
      session_name: sessionNames.get(first.session_id) ?? '',
    };

    const weeks = [...new Set(all.map(e => weekOf(e.date)))].sort();
    for (const week of weeks) {
      const end = new Date(`${week}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      const until = end.toISOString().slice(0, 10);

      const pcts: number[] = [];
      for (const { exposures } of lifts) {
        const upTo = exposures.filter(e => e.date <= until);
        if (!upTo.length) continue;
        pcts.push((upTo[upTo.length - 1].top_load! / exposures[0].top_load! - 1) * 100);
      }
      const thisWeek = all.filter(e => weekOf(e.date) === week);
      const latest = thisWeek[thisWeek.length - 1];
      detail.series.push({
        week,
        pct: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
        session_id: latest.session_id,
        session_name: sessionNames.get(latest.session_id) ?? '',
        detail: describeWeek(thisWeek, lifts, exerciseNames),
      });
    }
  }

  return out;
}

/** "Back squat 100 to 105 kg for 5" for each lift moved that week, or its first load. */
function describeWeek(
  week: Exposure[],
  lifts: { id: string; exposures: Exposure[] }[],
  names: Map<string, string>,
): string {
  const parts: string[] = [];
  for (const e of week) {
    const series = lifts.find(l => l.id === e.exercise_id)!.exposures;
    const at = series.findIndex(x => x.session_id === e.session_id);
    const name = names.get(e.exercise_id) ?? e.exercise_id;
    const reps = repsOf(e);
    const forReps = reps ? ` for ${reps}` : '';
    if (at <= 0) {
      parts.push(`${name} ${fmtLoad(e.top_load!, e.load_unit)}${forReps}, the first time`);
      continue;
    }
    const before = series[at - 1].top_load!;
    parts.push(before === e.top_load
      ? `${name} ${fmtLoad(e.top_load!, e.load_unit)}${forReps}, the same as last time`
      : `${name} ${fmtLoad(before, null)} to ${fmtLoad(e.top_load!, e.load_unit)}${forReps}`);
  }
  return parts.join('. ') + (parts.length ? '.' : '');
}

/* ----------------------------------------------------------- highlights --- */

export interface Highlights {
  /** A repeat pace across comparable sessions, oldest first. Null under two. */
  pace: { exercise_id: string; distance_meters: number; points: { date: string; seconds: number }[] } | null;
  /** The strength lift with the most comparable sessions behind it. Null under two. */
  lift: { exercise_id: string; name: string; reps: number | null; unit: string | null;
    points: { date: string; load: number }[] } | null;
  /** The most recent personal best. */
  record: { exercise: string; kind: 'load' | 'reps'; value: number; unit: string | null;
    previous: number; date: string; session_id: string } | null;
}

const STRENGTH: ReadonlySet<string> = new Set(['lower_body_strength', 'upper_body_strength']);

export function highlightsFrom(args: {
  comparable: ComparableSeries | null;
  histories: Map<string, ExerciseHistory>;
  ontology: Map<string, EvidenceOntology>;
  exerciseNames: Map<string, string>;
  /** Newest first. Records are searched in this order. */
  sessions: { id: string; date: string }[];
}): Highlights {
  const { comparable, histories, ontology, exerciseNames, sessions } = args;

  const pace = comparable && comparable.runs.length >= 2 ? {
    exercise_id: comparable.exercise_id,
    distance_meters: comparable.distance_meters,
    points: comparable.runs.map(r => ({ date: r.date, seconds: Math.round(r.pace_seconds) })),
  } : null;

  let lift: Highlights['lift'] = null;
  let most = 1;
  for (const [id, history] of histories) {
    const key = capabilityFor(id, ontology.get(id));
    if (!key || !STRENGTH.has(key)) continue;
    const full = history.exposures
      .filter(e => e.context === 'full' && e.top_load != null && e.top_load > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!full.length) continue;
    const comparable = full.filter(e => rangesOverlap(e, full[full.length - 1]));
    if (comparable.length <= most) continue;
    most = comparable.length;
    const last = comparable[comparable.length - 1];
    lift = {
      exercise_id: id,
      name: exerciseNames.get(id) ?? id,
      reps: repsOf(last),
      unit: last.load_unit,
      points: comparable.slice(-8).map(e => ({ date: e.date, load: e.top_load! })),
    };
  }

  let record: Highlights['record'] = null;
  for (const s of sessions) {
    const found = personalRecordsIn({ sessionId: s.id, histories });
    if (!found.length) continue;
    const r = found[0];
    record = {
      exercise: exerciseNames.get(r.exercise_id) ?? r.exercise_id,
      kind: r.kind, value: r.value, unit: r.unit, previous: r.previous,
      date: s.date, session_id: s.id,
    };
    break;
  }

  return { pace, lift, record };
}
