/**
 * What every Progress screen reads: the shared payload, a fallback built from
 * the store for builds with no server, and the few derivations more than one
 * screen draws (a session's kind, the readiness chart's span).
 */
import { useMemo } from 'react';
import { HYROX_STATION_EXERCISES, READINESS_TARGETS } from '@pivot/engine';

import { lookOf } from '@/components/plan/weekData';
import { EXERCISES } from '@/data/content';
import { WEAKNESS_OPTIONS } from '@/data/preferencesRepo';
import type { CapabilityKey, IndexSession, ProgressPayload } from '@/data/progressRepo';
import {
  addDays, projectTo, shortDate, weekOf, weeklyReadiness,
} from '@/data/progressView';
import { localToday } from '@/lib/format';
import { useApp } from '@/state/store';
import { useProgress } from '@/state/progress';
import type { SessionKind } from '@/theme/tokens';

export const TARGETS = READINESS_TARGETS;

export const CAPABILITIES = WEAKNESS_OPTIONS.map(o => ({
  key: o.value as CapabilityKey, label: o.label, hint: o.hint,
}));

/**
 * Which capability a movement speaks to: a race station first, then its
 * movement family. Mirrors `capabilityFor` in `_shared/evidence.ts`, so the
 * session Capability suggests trains what that page measures.
 */
const BY_FAMILY: Record<string, CapabilityKey> = {
  squat: 'lower_body_strength', hinge: 'lower_body_strength', lunge: 'lower_body_strength',
  horizontal_push: 'upper_body_strength', vertical_push: 'upper_body_strength',
  horizontal_pull: 'upper_body_strength', vertical_pull: 'upper_body_strength',
  carry: 'loaded_movement', sled_resisted_locomotion: 'loaded_movement', complex_total_body: 'loaded_movement',
  trunk: 'muscular_endurance', rotation: 'muscular_endurance', accessory_isolation: 'muscular_endurance',
};
const STATIONS = new Set<string>(HYROX_STATION_EXERCISES);
const families = new Map(EXERCISES.map(e => [e.id, (e as { movement_families?: string[] }).movement_families ?? []]));

export function capabilityOfExercise(id: string): CapabilityKey | null {
  if (STATIONS.has(id)) return 'station_proficiency';
  for (const f of families.get(id) ?? []) if (BY_FAMILY[f]) return BY_FAMILY[f];
  return null;
}

/** A session's kind, from the bundled library. Unknown templates read as hybrid. */
export function kindOf(s: { template_id: string }): SessionKind {
  return lookOf(s.template_id)?.kind ?? 'hybrid';
}

export function useProgressModel() {
  const { data, status, message, refresh } = useProgress();
  const { readiness, capability, weaknesses, plan } = useApp();

  /**
   * A build with no server still has the store's readiness, from the seed, so
   * the tab draws what is known and leaves the rest empty rather than failing.
   */
  const payload: ProgressPayload | null = useMemo(() => {
    if (data) return data;
    if (status !== 'unconfigured') return null;
    const observed = readiness.observed as string[];
    const measured = Object.entries(readiness.components).filter(([k]) => observed.includes(k));
    return {
      today: localToday(),
      race: plan.race ? { date: plan.race.event_date ?? null, name: plan.race.name, days: plan.race.days_remaining ?? null } : null,
      program: { week: plan.phase?.week ?? null, total_weeks: plan.phase?.total_weeks ?? null },
      readiness: {
        overall: readiness.overall, confidence: readiness.confidence,
        components: readiness.components, observed,
        lowest: measured.length ? measured.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : null,
        inputs: null, stations_covered: [],
      },
      trend: [], sessions: [],
      capabilities: { state: capability as never, perceived: weaknesses, detail: {} },
      highlights: { pace: null, lift: null, record: null },
    };
  }, [data, status, readiness, capability, weaknesses, plan]);

  return { payload, status, message, refresh };
}

/**
 * The readiness chart's x axis: from week 1 of the program (or the first
 * point) to race week (or the end of the program, or four weeks on).
 */
export function readinessSpan(p: ProgressPayload) {
  const today = p.today;
  const thisWeek = weekOf(today);
  const weekly = weeklyReadiness(p.trend);
  const programStart = p.program.week ? addDays(thisWeek, -7 * (p.program.week - 1)) : null;
  const start = programStart ?? weekly[0]?.week ?? thisWeek;
  const raceWeek = p.race?.date ? weekOf(p.race.date) : null;
  const end = raceWeek
    ?? (programStart && p.program.total_weeks ? addDays(programStart, 7 * (p.program.total_weeks - 1)) : null)
    ?? addDays(thisWeek, 28);
  const span = Math.max(7, Date.parse(end) - Date.parse(start));
  const at = (week: string) => Math.max(0, Math.min(1, (Date.parse(week) - Date.parse(start)) / span));

  const points = weekly.filter(w => w.week >= start).map(w => ({ x: at(w.week), v: w.overall }));
  const projected = raceWeek ? projectTo(weekly, raceWeek) : null;
  return {
    points,
    projection: raceWeek && projected != null ? { x: at(raceWeek), v: projected } : null,
    raceX: raceWeek ? at(raceWeek) : null,
    leftLabel: programStart ? 'Week 1' : weekly[0] ? shortDate(weekly[0].week) : null,
    rightLabel: p.race?.date ? `Race · ${shortDate(p.race.date)}${p.trend.length <= 1 && p.race.days != null ? ` · ${p.race.days} days` : ''}` : null,
  };
}

export const directionLabel = (s: IndexSession) =>
  [s.minutes != null ? `${s.minutes} min` : null, s.rpe != null ? `RPE ${s.rpe}` : 'no RPE logged']
    .filter(Boolean).join(' · ');
