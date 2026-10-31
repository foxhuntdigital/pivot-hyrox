/**
 * GET /v1/progress — what the Progress tab and its subpages draw.
 *
 * One read for the whole tab: readiness with the inputs behind it and its line
 * over time, every completed session (for the calendar, the weekly time chart
 * and History's counts), each capability's readings, lifts and chart, and the
 * highlights. The shaping is in `_shared/progress-view.ts`; this file fetches.
 *
 * Like `history`, it decides nothing. Readiness comes from the same helper
 * Today and Coach use, so the three cannot show different numbers, and the
 * capability directions are `capabilityState`'s, sent as they are.
 */
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, localDate, requireUser,
} from '../_shared/context.ts';
import { loadProgressSnapshot } from '../_shared/progress.ts';
import { exerciseHistory, EXPOSURE_WINDOW_DAYS, loadPerformanceLogs } from '../_shared/exercise-history.ts';
import { daysAgo } from '../_shared/readiness-history.ts';
import {
  capabilityDetails, highlightsFrom, sessionIndex, trendFrom, type EvidenceRow, type IndexRow,
} from '../_shared/progress-view.ts';

/** Six months of daily readiness: a whole training block with room either side. */
const TREND_DAYS = 182;
/** Enough sessions for years of training; the index is a few fields each. */
const INDEX_LIMIT = 1500;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    const db = clientFor(req);
    const user = await requireUser(db);
    const today = localDate(user.timezone);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - TREND_DAYS * 86_400_000)
      .toISOString().slice(0, 10);

    const [state, templatesRes, exercisesRes, sessionsRes, snapshotsRes, evidenceRes] = await Promise.all([
      loadAthleteState(db, user.id, today),
      db.schema('content').from('workout_templates')
        .select('id, primary_goal, requires_running, estimated_minutes'),
      db.schema('content').from('exercises').select('id, name, movement_families'),
      db.from('workout_sessions')
        .select('id, template_id, variant_code, started_at, ended_at, session_rpe, ended_early, '
          + 'workout_role, name:snapshot_json->>name, local_date:snapshot_json->>started_local_date, '
          + 'estimated_minutes:snapshot_json->>estimated_minutes')
        .eq('user_id', user.id).eq('status', 'completed')
        .order('started_at', { ascending: false }).limit(INDEX_LIMIT),
      db.from('readiness_snapshots')
        .select('local_date, overall, confidence, components_json')
        .eq('user_id', user.id).gte('local_date', since)
        .order('local_date', { ascending: true }),
      db.from('athlete_capability_evidence')
        .select('capability_key, direction, magnitude_band, confidence_band, source_session_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(500),
    ]);
    if (sessionsRes.error) throw new HttpError(500, `sessions: ${sessionsRes.error.message}`);

    // Readiness first: it also writes today's snapshot, which the line below
    // should include.
    const snapshot = await loadProgressSnapshot({
      db, userId: user.id, today, content: { templates: templatesRes.data ?? [] }, state,
    });

    const rows = (sessionsRes.data ?? []) as unknown as IndexRow[];
    const sessions = sessionIndex(rows);
    const sessionNames = new Map(sessions.map(s => [s.id, s.name]));

    // Lifts are read over the same window the evidence rules use.
    const recent = rows.filter(r => daysAgo(today, r.started_at) < EXPOSURE_WINDOW_DAYS);
    const { setLogs } = await loadPerformanceLogs(db, recent.map(r => r.id));
    const histories = exerciseHistory({ today, sessions: recent as any, setLogs });

    const exercises = exercisesRes.data ?? [];
    const exerciseNames = new Map<string, string>(exercises.map((e: any) => [e.id, e.name]));
    const ontology = new Map(exercises.map((e: any) =>
      [e.id, { movement_families: e.movement_families }]));

    // Today's row is in the trend whether or not the read above raced the write.
    const trend = trendFrom([
      ...(snapshotsRes.data ?? []).filter((r: any) => r.local_date !== today),
      ...(snapshot.readiness.overall !== null ? [{
        local_date: today,
        overall: snapshot.readiness.overall,
        confidence: snapshot.readiness.confidence,
        components_json: {
          components: snapshot.readiness.components, observed: snapshot.readiness.observed,
        },
      }] : []),
    ]);

    return json({
      today,
      race: state.race ? { date: state.race.event_date ?? null, name: state.race.event_name ?? null, days: state.daysToRace ?? null } : null,
      program: { week: state.programWeek ?? null, total_weeks: state.programTotalWeeks ?? null },
      readiness: {
        overall: snapshot.readiness.overall,
        confidence: snapshot.readiness.confidence,
        components: snapshot.readiness.components,
        observed: snapshot.readiness.observed,
        lowest: snapshot.lowest,
        inputs: snapshot.inputs,
        stations_covered: snapshot.stations_covered,
      },
      trend,
      sessions,
      capabilities: {
        state: state.capability_state,
        perceived: state.perceived_weaknesses,
        detail: capabilityDetails({
          histories, ontology, exerciseNames, sessionNames,
          evidence: (evidenceRes.data ?? []) as EvidenceRow[],
        }),
      },
      highlights: highlightsFrom({
        comparable: snapshot.comparable, histories, ontology, exerciseNames,
        sessions: sessions.filter(s => recent.some(r => r.id === s.id)),
      }),
    }, 200, origin);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : 'unknown' }, status, origin);
  }
});
