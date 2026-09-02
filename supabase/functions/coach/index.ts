/**
 * POST /v1/coach/messages — one Coach turn (PRD §12, FR-020).
 *
 * The function is thin on purpose. It authenticates, loads the same athlete
 * state the Today and Adapt endpoints load, hands the deterministic services to
 * `@pivot/coach`, and writes the result down. The orchestration itself lives in
 * the package so the eval runner exercises the identical code path in Node.
 *
 * Three guarantees this endpoint makes, and the reasons they live here rather
 * than in the prompt:
 *
 *   * It never mutates training. A turn returns a *proposed* action; applying
 *     one is a separate confirmed call (FR-021). A model that decided to change
 *     the athlete's week could not do it through this route.
 *   * The API key never leaves the server (PRD §15).
 *   * Every request stores the prompt, safety, schema, engine and model
 *     versions alongside the message, so an answer can be reproduced later from
 *     what produced it (PRD §11.1, §24).
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.120.0';

import {
  recommend, recoveryFromEnergy, type EngineInput,
} from '../../../packages/engine/src/index.ts';
import {
  anthropicLlm, narrateProgress, runCoachTurn,
  type AnthropicResponse, type CoachContext, type CoachServices,
} from '../../../packages/coach/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, loadAthleteState, loadContent,
  localDate, requireEntitlement, requireUser,
} from '../_shared/context.ts';
import { comparableSeries } from '../_shared/comparable.ts';
import { exerciseHistory, loadPerformanceLogs } from '../_shared/exercise-history.ts';
import { performanceTrend } from '../_shared/trends.ts';
import { progressionFor, type ProgressionRuleRow } from '../_shared/progression.ts';
import { personalRecordsIn } from '../_shared/prs.ts';
import { loadProgressSnapshot } from '../_shared/progress.ts';

/** Per-athlete monthly ceiling. Beyond it the app falls back to local Coach. */
const MONTHLY_MESSAGE_LIMIT = Number(Deno.env.get('COACH_MONTHLY_MESSAGE_LIMIT') ?? '200');

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new HttpError(503, 'Coach is not configured');

    // The adapter is deliberately weakly typed so `@pivot/coach` holds no SDK
    // dependency; this is where the two type worlds meet, so the cast lives
    // here rather than being hidden inside it.
    const anthropic = new Anthropic({ apiKey });
    const llm = anthropicLlm(params =>
      anthropic.messages.create(
        params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      ) as unknown as Promise<AnthropicResponse>);

    const db = clientFor(req);
    const user = await requireUser(db);
    await requireEntitlement(db, user.id);
    const today = localDate(user.timezone);

    const body = await req.json() as {
      mode?: 'message' | 'progress_narration';
      message?: string;
      thread_id?: string | null;
      history?: { role: 'user' | 'assistant'; content: string }[];
    };

    // Progress narration is not a conversation turn: it writes the six labels
    // under the readiness bars from figures it is handed. It runs on a cheap
    // model, writes no thread, and is not charged against the message quota —
    // the athlete did not ask for it, the screen did.
    if (body.mode === 'progress_narration') {
      const [content, state] = await Promise.all([
        loadContent(db),
        loadAthleteState(db, user.id, today),
      ]);
      const snapshot = await loadProgressSnapshot({ db, userId: user.id, today, content, state });
      // `observed` travels with each component so the narrator can tell a
      // measured zero from an absence. Without it every component looked like a
      // fact and Coach wrote six sentences for an athlete who had logged none.
      const observed = new Set<string>(snapshot.readiness.observed);
      const facts = Object.fromEntries(
        Object.entries(snapshot.readiness.components).map(([k, score]) => [
          k, {
            score,
            stats: snapshot.metric_detail[k]?.stats ?? [],
            observed: observed.has(k),
          },
        ]),
      );
      const narration = await narrateProgress({
        llm, facts, lowest: snapshot.lowest ?? '',
      });
      return json({
        detail: narration.detail,
        source: narration.source,
        narration_version: narration.version,
      }, 200, origin);
    }

    const message = (body.message ?? '').trim();
    if (!message) throw new HttpError(400, 'message is required');
    if (message.length > 2000) throw new HttpError(400, 'message is too long');

    // Rate limit before spending anything. The client degrades to its local
    // deterministic Coach on 429 rather than showing an error.
    const monthStart = `${today.slice(0, 7)}-01`;
    const { count } = await db
      .from('coach_messages')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user')
      .gte('created_at', monthStart);
    if ((count ?? 0) >= MONTHLY_MESSAGE_LIMIT) {
      return json({ error: 'monthly_limit_reached', limit: MONTHLY_MESSAGE_LIMIT }, 429, origin);
    }

    const [content, state] = await Promise.all([
      loadContent(db),
      loadAthleteState(db, user.id, today),
    ]);

    // One extra round trip per turn, taken up front because `trends()` is a
    // synchronous contract: the tool layer calls it inside a decision, not
    // inside an await. The block join is the same one loadHistory makes.
    const logs = await loadPerformanceLogs(db, state.sessionRows.map((s: any) => s.id));

    const templateIndex = new Map(content.templates.map(t => [t.id, t]));
    const exerciseNames = new Map(content.exercises.map((e: any) => [e.id, e.name]));
    const exerciseIndex = new Map(content.exercises.map((e: any) => [e.id, e]));

    // Computed once. Three services read it, and recomputing per call would
    // rescan every set the athlete has logged for each question they ask.
    const strengthHistories = exerciseHistory({
      today, sessions: state.sessionRows, setLogs: logs.setLogs,
    });
    const { data: progressionRules } = await db.schema('content')
      .from('progression_rules').select('*');
    const rules: ProgressionRuleRow[] = progressionRules ?? [];
    const recent_sessions = state.recent_sessions.map(s => {
      const tpl = templateIndex.get(s.template_id);
      return {
        ...s,
        workout_family: tpl?.workout_family ?? '',
        primary_goal: tpl?.primary_goal ?? '',
        impact_level: tpl?.impact_level ?? 'medium' as const,
      };
    });

    const checkin = state.checkin;
    const input: EngineInput = {
      local_date: today,
      phase_type: state.currentPhase?.phase_type ?? 'build',
      days_to_race: state.daysToRace,
      stimulus_requirements: state.stimulus_requirements,
      recent_sessions,
      recovery_state: recoveryFromEnergy(checkin?.energy),
      energy: checkin?.energy ?? 'normal',
      sleep_hours: checkin?.sleep_hours ?? null,
      available_minutes: state.profile?.typical_session_minutes ?? 45,
      available_equipment: state.available_equipment,
      low_impact_required: state.profile?.impact_tolerance === 'low',
      symptom_flags: Object.keys(checkin?.symptom_json ?? {}),
      considerations: state.profile?.considerations ?? [],
      candidates: content.candidates,
      substitutions: content.substitutions,
      // Stated preference and demonstrated deficit. Both are scoring inputs and
      // neither is a filter: every hard constraint has already run by the time
      // anything here is read (rank.ts).
      preferred_families: state.preferred_families,
      avoided_families: state.avoided_families,
      capability_needs: state.capability_needs,
      perceived_weaknesses: state.perceived_weaknesses,
      variation_tolerance: 1,
    };

    const decision = recommend(input, content.exercises);
    // The same computation /v1/today runs, so the number Coach explains is the
    // number Progress shows.
    // The same snapshot /v1/today and Progress compute, so the readiness Coach
    // explains is the readiness the athlete is looking at. Computing it here a
    // second time is how the two drift apart.
    const { readiness } = await loadProgressSnapshot({
      db, userId: user.id, today, content, state,
    });

    const services: CoachServices = {
      today: decision,
      input,
      evaluate: overrides => recommend({ ...input, ...overrides }, content.exercises),
      search: (terms, minutes) => {
        const score = (t: typeof content.templates[number]) => terms.reduce((n, term) =>
          n + ([t.name, t.workout_family, t.primary_goal, t.description ?? '', ...(t.tags ?? [])]
            .join(' ').toLowerCase().includes(term) ? 1 : 0), 0);
        const scored = content.candidates.map(t => ({ t, hits: score(t) }))
          .filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits);
        if (!scored.length) {
          return {
            kind: 'no_session',
            reason_codes: [],
            rationale: 'No validated template matches that request.',
            guidance: 'Offer the closest validated option instead of composing one.',
          };
        }
        const best = scored[0].hits;
        return recommend({
          ...input,
          candidates: scored.filter(x => x.hits === best).slice(0, 6).map(x => x.t),
          available_minutes: minutes ?? input.available_minutes,
        }, content.exercises);
      },
      readiness,
      /**
       * Comparable-session trends, from logged loads and paces.
       *
       * Still returns null whenever the comparability rules find nothing to
       * compare, which is the behaviour the tool contract depends on: Coach is
       * told to say it lacks the data rather than estimating from session RPE.
       * What changed is that the answer is now sometimes yes.
       */
      trends: () => performanceTrend({
        runs: comparableSeries({
          today, sessions: state.sessionRows, cardioLogs: logs.cardioLogs,
        }),
        strength: strengthHistories,
        nameFor: (id: string) => exerciseNames.get(id) ?? id,
      }),

      /**
       * What to put on the bar today, per movement.
       *
       * Only movements that prescribe working sets are asked about: a distance
       * carry and an erg interval have no load to progress, and offering the
       * model an empty suggestion for them invites it to fill one in.
       */
      progression: () => {
        if (decision.kind !== 'session') return [];
        const template = decision.template;
        return template.blocks
          .flatMap((b: any) => b.exercises ?? [])
          .filter((be: any) => be.sets != null && be.sets > 0)
          .map((be: any) => {
            const s = progressionFor({
              prescription: {
                exercise_id: be.exercise_id,
                workout_family: template.workout_family,
                sets: be.sets ?? null,
                reps_min: be.reps_min ?? null,
                reps_max: be.reps_max ?? null,
                target_rpe: be.target_rpe ?? null,
              },
              history: strengthHistories.get(be.exercise_id),
              ontology: exerciseIndex.get(be.exercise_id),
              rules,
            });
            return {
              exercise: exerciseNames.get(be.exercise_id) ?? be.exercise_id,
              reason_code: s.reason_code,
              dimension: s.dimension,
              suggested_load: s.suggested_load,
              load_unit: s.load_unit,
              suggested_reps: s.suggested_reps,
              last_time: s.basis
                ? {
                  date: s.basis.date, load: s.basis.top_load,
                  reps: s.basis.top_reps, rpe: s.basis.rpe,
                }
                : null,
              caveat: s.caveat,
            };
          });
      },

      records: () => {
        const last = state.sessionRows[0]?.id;
        if (!last) return [];
        return personalRecordsIn({ sessionId: last, histories: strengthHistories })
          .map(r => ({
            exercise: exerciseNames.get(r.exercise_id) ?? r.exercise_id,
            kind: r.kind, value: r.value, unit: r.unit,
            previous: r.previous, date: r.date,
          }));
      },
      week: () => ((state.currentCycle as { session_queue_items?: unknown[] } | null)
        ?.session_queue_items ?? [])
        .map((q) => {
          const item = q as { workout_template_id: string; stimulus_type: string; rank: number };
          const tpl = templateIndex.get(item.workout_template_id);
          return {
            day: `rank ${item.rank}`,
            template: tpl?.name ?? item.workout_template_id,
            minutes: tpl?.estimated_minutes ?? 0,
            priority: item.rank,
            stimulus: item.stimulus_type,
          };
        }),
      // No versioned race definition is published yet, so Coach must say it
      // cannot verify loads or standards rather than stating them (§13.2).
      raceDefinition: () => null,
    };

    const context: CoachContext = {
      request_id: crypto.randomUUID(),
      athlete: {
        athlete_id: user.id,
        timezone: user.timezone,
        units: user.units,
        experience_level: state.profile?.experience_level ?? null,
        // Return-to-training considerations are marked SENSITIVE in the schema
        // and must not go to the AI coach beyond the granted purpose (§13.2).
        // They already constrain the engine through `input.considerations`, so
        // their effect reaches Coach as an IMPACT_REDUCTION reason code — which
        // is what Coach needs to explain the session. The labels themselves
        // ("postpartum", "pelvic-floor") stay server-side. Revisit only behind
        // an explicit permission, and note this narrows `athlete.flags` in
        // coach-context.schema.json to a boolean.
        flags: (state.profile?.considerations ?? []).length
          ? ['return_to_training_constraints_active']
          : [],
      },
      active_race: state.race ? {
        name: state.race.event_name,
        date: state.race.event_date,
        division: state.race.division ?? 'unspecified',
        days_remaining: state.daysToRace,
      } : null,
      program: state.currentPhase ? {
        phase: state.currentPhase.phase_type,
        week: state.currentCycle?.week_index ?? null,
        stimuli: state.stimulus_requirements,
      } : null,
      today: {
        date_local: today,
        available_time_minutes: input.available_minutes,
        reported_energy: input.energy,
        equipment_count: input.available_equipment.length,
      },
      readiness: {
        overall: readiness.overall,
        confidence: readiness.confidence,
        components: readiness.components,
      },
      recent_summary: {
        sessions_7d: recent_sessions.filter(s => s.days_ago <= 7).length,
        last_session_days_ago: recent_sessions[0]?.days_ago ?? null,
        last_rpe: recent_sessions[0]?.session_rpe ?? null,
      },
    };

    const turn = await runCoachTurn({
      llm,
      services,
      context,
      message,
      history: body.history ?? [],
    });

    // Persist the thread. A failed write must not lose the athlete's answer, so
    // the reply is returned either way and the ids come back null.
    let threadId = body.thread_id ?? null;
    try {
      if (!threadId) {
        const { data } = await db.from('coach_threads')
          .insert({ user_id: user.id, title: turn.response.response_type })
          .select('id').single();
        threadId = data?.id ?? null;
      }
      if (threadId) {
        await db.from('coach_messages').insert([
          { thread_id: threadId, role: 'user', content: message },
          {
            thread_id: threadId,
            role: 'assistant',
            content: turn.response.message,
            proposed_action: turn.action
              ? { ...turn.action, versions: turn.versions, intent: turn.classification.intent }
              : null,
            action_status: turn.action ? 'proposed' : null,
          },
        ]);
      }
    } catch (_persistError) {
      threadId = null;
    }

    return json({
      thread_id: threadId,
      intent: turn.classification.intent,
      confidence: turn.classification.confidence,
      entities: turn.classification.entities ?? {},
      needs_clarification: turn.classification.needs_clarification ?? false,
      response: turn.response,
      action: turn.action,
      versions: turn.versions,
      usage: turn.usage,
    }, 200, origin);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const messageText = error instanceof Error ? error.message : 'Coach failed';
    return json({ error: messageText }, status, origin);
  }
});
