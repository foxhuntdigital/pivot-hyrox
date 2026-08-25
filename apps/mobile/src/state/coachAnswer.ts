/**
 * Coach answers.
 *
 * Every card in a Coach thread is built here, and every number in one comes
 * from the engine, the content library or the athlete's logged training. That
 * is the whole point of the module: Coach explains and orchestrates the
 * training engine, it does not invent a training system (Coach brief §1).
 *
 * The functions are pure over an explicit context, so an answer is derived at
 * render time rather than stored on the message. A thread reopened after the
 * athlete changes their equipment or check-in shows what the engine says now,
 * not what it said when the question was asked (brief §4.3).
 */
import {
  recommend, VARIANT_LABEL,
  type Confidence, type EngineDecision, type EngineInput, type Recommendation,
  type ReadinessResult, type StimulusRequirement, type VariantCode, type WorkoutBlock,
  type WorkoutTemplate,
} from '@pivot/engine';

import { EXERCISES, EQUIPMENT, TEMPLATES, exerciseById, templateById } from '@/data/content';
import {
  COMPARABLE_1K, METRIC_DETAIL, NON_COMPARABLE_1K, WEEK_SHAPE,
  type Phase, type PlannedSession, type Race,
} from '@/data/athlete';
import { REASON_CODE_COPY, type CoachIntent, type CoachSignals } from '@/data/coach';

/* ---------------------------------------------------------------- types --- */

export type CoachActionId =
  | 'use_adaptation'
  | 'keep_original'
  // Navigates to Today, which shows whichever variant is recommended. Never
  // label it "full" — FULL is a variant name (VARIANT_LABEL), so the athlete
  // reads that as a promise of the green variant and gets EXPRESS instead.
  | 'see_today'
  | 'see_plan'
  | 'see_progress'
  | 'ask_weakness'
  | 'ask_build'
  | 'ask_adapt'
  | 'ask_explain'
  | 'ask_low_impact'
  | 'use_workout'
  | 'show_another'
  | 'use_equipment_today'
  | 'review_plan'
  | 'decline_plan'
  | 'flag_symptom';

export interface CoachAction {
  id: CoachActionId;
  label: string;
  primary?: boolean;
}

interface SessionSummary {
  name: string;
  variant: string;
  minutes: number;
}

export interface PlanProposal {
  kind: 'week_days' | 'travel';
  title: string;
  lede: string;
  current: { label: string; value: string; unit: string };
  proposed: { label: string; value: string; unit: string };
  rows: { name: string; verb: string; detail: string; emphasis: boolean }[];
  impact: { text: string; tag: string; reduced: boolean }[];
  consequence: string;
  /** What the inline confirmation says once the athlete applies it. */
  applied: string;
  /** Set on a travel proposal — the equipment and days an apply commits. */
  commit_travel?: { equipment: string[]; days: string[] };
}

export type CoachCard =
  | {
      kind: 'adaptation';
      current: SessionSummary;
      proposed: SessionSummary;
      stimulus: string;
      /** False when the shorter option carries a different stimulus. */
      preserved: boolean;
      changes: string[];
      week_impact: string;
      a11y: string;
    }
  | {
      kind: 'trend';
      metric: string;
      direction: 'Improving' | 'Holding' | 'Slowing';
      from: string;
      to: string;
      window: string;
      samples: string;
      confidence: Confidence;
      bars: { height: number; accent: boolean }[];
      caveat: string;
      a11y: string;
    }
  | {
      kind: 'substitution';
      title: string;
      subs: { from: string; to: string; why: string }[];
      caveat: string;
    }
  | {
      kind: 'workout';
      source: string;
      name: string;
      variant: string;
      minutes: number;
      goal: string;
      intensity: string;
      blocks: { qty: string; label: string; note: string }[];
      equipment: string;
      fits: string;
    }
  | { kind: 'plan'; proposal: PlanProposal }
  | { kind: 'safety'; boundary: string; unchanged: string };

/** What an action would commit, when the action commits a session. */
export interface CoachCommit {
  template_id: string;
  variant: VariantCode;
  name: string;
  minutes: number;
  /** Check-in values the answer was computed against, applied with it. */
  time_limit?: number;
  low_energy?: boolean;
  low_impact?: boolean;
  equipment?: string[];
}

export interface CoachAnswer {
  text: string;
  chips: string[];
  why?: { k: string; v: string }[];
  card?: CoachCard;
  actions: CoachAction[];
  commit?: CoachCommit;
  proposal?: PlanProposal;
  /** Template offered by a workout card, so "Show another" can move past it. */
  offered_template_id?: string;
}

export interface CoachContext {
  engineInput: EngineInput;
  /** What the athlete will actually do today. */
  today: EngineDecision;
  readiness: ReadinessResult;
  weekStimuli: StimulusRequirement[];
  queue: PlannedSession[];
  race: Race;
  phase: Phase;
}

/* -------------------------------------------------------------- helpers --- */

const equipmentName = new Map(EQUIPMENT.map(e => [e.id, e.name]));

const stimulusLabel = (s: string) => s.replace(/_/g, ' ');

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const exerciseName = (id: string) => exerciseById.get(id)?.name ?? id.replace(/^ex_/, '').replace(/_/g, ' ');

/** 4.17 h → "4:10". Sleep is read as a clock time everywhere in the app. */
function hoursToClock(hours: number | null): string | null {
  if (hours === null) return null;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function paceClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function summarise(rec: Recommendation): SessionSummary {
  return {
    name: rec.template.name,
    variant: VARIANT_LABEL[rec.variant.variant_code],
    minutes: rec.estimated_minutes,
  };
}

function totalRounds(blocks: WorkoutBlock[]): number {
  return blocks.reduce((n, b) => n + (b.rounds ?? 0), 0);
}

function blockRows(rec: Recommendation) {
  return rec.blocks.map(b => ({
    qty: b.rounds && b.rounds > 1 ? `${b.rounds} ×` : `${b.duration_minutes ?? ''} min`,
    label: b.title ?? b.block_type.replace(/_/g, ' '),
    note: b.exercises.map(e => exerciseName(e.exercise_id)).join(' · '),
  }));
}

function equipmentFor(rec: Recommendation): string {
  const ids = new Set<string>();
  for (const block of rec.blocks) {
    for (const e of block.exercises) {
      for (const id of exerciseById.get(e.exercise_id)?.equipment ?? []) ids.add(id);
    }
  }
  const names = [...ids].filter(id => id !== 'bodyweight').map(id => equipmentName.get(id) ?? id);
  return names.length ? names.join(' · ') : 'Bodyweight only';
}

/**
 * Movements in a session that nothing in the available equipment can perform,
 * and that the substitution table cannot cover. Naming the movement is more
 * useful to an athlete than naming the equipment id it wanted.
 */
function unsupportedMovements(rec: Recommendation, available: string[]): string[] {
  // Matches the engine's own rule: bodyweight and outdoor need no equipment, so
  // a hotel with a treadmill can still run (guardrails.ts `BODYWEIGHT`).
  const have = new Set([...available, 'bodyweight', 'outdoor']);
  const names = new Set<string>();
  for (const block of rec.blocks) {
    for (const e of block.exercises) {
      const needs = exerciseById.get(e.exercise_id)?.equipment ?? [];
      if (needs.length && !needs.some(id => have.has(id))) names.add(exerciseName(e.exercise_id));
    }
  }
  return [...names];
}

/** Context chips (CC10) — the data scope Coach answered from. */
function chipsFor(ctx: CoachContext, extra: string[] = []): string[] {
  const sleep = hoursToClock(ctx.engineInput.sleep_hours);
  return [
    ...extra,
    `${ctx.phase.type} · week ${ctx.phase.week}`,
    ...(sleep ? [`Sleep ${sleep}`] : []),
  ];
}

/**
 * The evidence drawer (CC09). Reason codes carry the engine's actual reasoning;
 * the rest is the state those codes were evaluated against, so a low-confidence
 * answer shows what is missing rather than sounding certain (brief §5.2).
 */
function evidence(
  ctx: CoachContext,
  rec: Recommendation,
  /** The input this recommendation came from, when it is not today's. */
  against: EngineInput = ctx.engineInput,
): { k: string; v: string }[] {
  const rows: { k: string; v: string }[] = [];

  const due = ctx.weekStimuli.find(s => s.stimulus_type === rec.primary_stimulus);
  if (due) {
    rows.push({
      k: 'Weekly stimulus due',
      v: `${stimulusLabel(due.stimulus_type)} is at ${due.completed_exposures} of `
        + `${due.target_exposures} exposures for week ${ctx.phase.week}. It is the reason this `
        + 'session exists.',
    });
  }

  const recent = ctx.engineInput.recent_sessions;
  if (recent.length) {
    const week = recent.filter(s => s.days_ago <= 7);
    const last = recent.reduce((a, b) => (b.days_ago < a.days_ago ? b : a));
    rows.push({
      k: 'Recent load',
      v: `${week.length} session${week.length === 1 ? '' : 's'} logged in the last 7 days. `
        + `Most recent was ${last.days_ago === 1 ? 'yesterday' : `${last.days_ago} days ago`}`
        + `${last.session_rpe ? ` at RPE ${last.session_rpe}` : ''}.`,
    });
  }

  const sleep = hoursToClock(against.sleep_hours);
  rows.push({
    k: 'Recovery input',
    v: `${sleep ? `${sleep} sleep, ` : ''}self-reported ${against.energy} energy. `
      + `Readiness ${ctx.readiness.overall} at ${ctx.readiness.confidence} confidence — a product `
      + 'score, not a medical assessment.',
  });

  const similar = recent.find(s => s.primary_goal === rec.primary_stimulus);
  if (similar) {
    const template = templateById.get(similar.template_id);
    rows.push({
      k: 'Last similar exposure',
      v: `${template?.name ?? similar.template_id}, ${similar.days_ago} days ago`
        + `${similar.session_rpe ? `, RPE ${similar.session_rpe}` : ''}.`,
    });
  }

  if (rec.reason_codes.length) {
    rows.push({
      k: 'Engine reasons',
      v: `Ranked on ${rec.reason_codes.map(c => REASON_CODE_COPY[c]).join('; ')}.`,
    });
  }

  return rows;
}

/** Plain-language diff between two engine recommendations. */
function describeChanges(cur: Recommendation, next: Recommendation): string[] {
  const out: string[] = [];

  if (next.template.id !== cur.template.id) {
    out.push(next.primary_stimulus === cur.primary_stimulus
      ? `${cur.template.name} becomes ${next.template.name} — the shorter validated session for `
        + `the same ${stimulusLabel(next.primary_stimulus)} stimulus`
      : `${cur.template.name} becomes ${next.template.name} — a different session: it carries `
        + `${stimulusLabel(next.primary_stimulus)} rather than `
        + `${stimulusLabel(cur.primary_stimulus)} work`);
  }
  if (next.blocks.length < cur.blocks.length) {
    out.push(`${cur.blocks.length} blocks become ${next.blocks.length}`);
  }
  const curRounds = totalRounds(cur.blocks);
  const nextRounds = totalRounds(next.blocks);
  if (nextRounds && nextRounds < curRounds) {
    out.push(`Working rounds drop from ${curRounds} to ${nextRounds}`);
  }
  if (next.variant.volume_multiplier < 1) {
    out.push(`Volume at ${Math.round(next.variant.volume_multiplier * 100)}% of the full `
      + `prescription — ${next.variant.intensity_modifier ?? 'rounds reduced, purpose preserved'}`);
  }
  for (const swap of next.substitutions_applied) {
    out.push(`${exerciseName(swap.from)} → ${exerciseName(swap.to)} · ${swap.reason}`);
  }
  if (!out.length) out.push('Same blocks, shorter durations');
  return out;
}

/* ----------------------------------------------------------- the answers --- */

/**
 * F01 — adapt today. The proposal is a second engine run against the athlete's
 * stated constraint, so what Coach offers is what the deterministic adaptation
 * service would offer from the Adapt sheet.
 */
function adaptAnswer(sig: CoachSignals, ctx: CoachContext): CoachAnswer {
  const minutes = sig.time_limit ?? Math.min(ctx.engineInput.available_minutes, 30);
  const input: EngineInput = {
    ...ctx.engineInput,
    available_minutes: minutes,
    energy: sig.low_energy ? 'low' : ctx.engineInput.energy,
    low_impact_required: sig.low_impact || ctx.engineInput.low_impact_required,
  };
  // A shortened version of today's session is the adaptation the athlete asked
  // for. Only when no variant of it survives the constraint does Coach reach for
  // a different session — and then it says that is what happened, because an
  // adaptation that drops the primary stimulus is not an adaptation (PRD §19.2).
  const sameSession = ctx.today.kind === 'session'
    ? recommend({ ...input, candidates: [ctx.today.template] }, EXERCISES)
    : { kind: 'no_session' as const, reason_codes: [], rationale: '', guidance: '' };
  const proposed = sameSession.kind === 'session' ? sameSession : recommend(input, EXERCISES);
  const chips = chipsFor(ctx, ["Today's plan", `${minutes} min available`]);

  if (proposed.kind !== 'session') {
    // C04 "no eligible adaptation": the engine's guidance, not a shorter
    // session invented to avoid an empty state.
    return {
      text: `${proposed.rationale} ${proposed.guidance}`,
      chips,
      actions: [
        { id: 'see_today', label: 'See today', primary: true },
        { id: 'ask_explain', label: 'Why?' },
      ],
    };
  }

  if (ctx.today.kind !== 'session') {
    return {
      text: `There is no session on today for me to shorten, but ${proposed.template.name} at `
        + `${proposed.estimated_minutes} minutes is valid for what you have.`,
      chips,
      card: workoutCard(proposed, 'From your library'),
      actions: [
        { id: 'use_workout', label: 'Use this workout', primary: true },
        { id: 'show_another', label: 'Show another' },
      ],
      commit: commitFor(proposed, sig),
      offered_template_id: proposed.template.id,
      why: evidence(ctx, proposed),
    };
  }

  const current = ctx.today;
  const unchanged =
    proposed.template.id === current.template.id
    && proposed.variant.variant_code === current.variant.variant_code;

  if (unchanged) {
    const already: string[] = [];
    if (sig.low_impact) already.push('It is already low impact.');
    if (sig.low_energy && current.variant.variant_code !== 'green') {
      already.push(`Your recovery inputs are already in it — that is why today is `
        + `${VARIANT_LABEL[current.variant.variant_code]} rather than the full session.`);
    }
    return {
      text: `Today already fits. ${current.template.name} at `
        + `${VARIANT_LABEL[current.variant.variant_code]} runs ${current.estimated_minutes} `
        + `minutes, inside the ${minutes} you have, so I would leave it alone.`
        + (already.length ? ` ${already.join(' ')}` : ''),
      chips,
      why: evidence(ctx, current, input),
      actions: [
        { id: 'see_today', label: "See today's session", primary: true },
        { id: 'ask_explain', label: 'Why this session?' },
      ],
    };
  }

  const preserved = proposed.primary_stimulus === current.primary_stimulus;

  return {
    text: preserved
      ? `I can keep today's ${stimulusLabel(proposed.primary_stimulus)} focus and shorten the `
        + `session. ${proposed.template.name} at ${VARIANT_LABEL[proposed.variant.variant_code]} is `
        + `${proposed.estimated_minutes} minutes, and it removes volume rather than making the `
        + 'remaining work harder.'
      : `Today's ${stimulusLabel(current.primary_stimulus)} session can't be shortened into `
        + `${minutes} minutes without losing what it is for. The best validated alternative is `
        + `${proposed.template.name} at ${proposed.estimated_minutes} minutes, which is `
        + `${stimulusLabel(proposed.primary_stimulus)} work — so this is a swap, not a trim.`,
    chips,
    card: {
      kind: 'adaptation',
      current: summarise(current),
      proposed: summarise(proposed),
      stimulus: stimulusLabel(proposed.primary_stimulus),
      preserved,
      changes: describeChanges(current, proposed),
      week_impact: 'No other sessions change.',
      a11y: `Current: ${current.template.name}, ${VARIANT_LABEL[current.variant.variant_code]}, `
        + `${current.estimated_minutes} minutes. Proposed: ${proposed.template.name}, `
        + `${VARIANT_LABEL[proposed.variant.variant_code]}, ${proposed.estimated_minutes} minutes. `
        + (preserved
          ? `Primary stimulus preserved: ${stimulusLabel(proposed.primary_stimulus)}.`
          : `Primary stimulus changes from ${stimulusLabel(current.primary_stimulus)} to `
            + `${stimulusLabel(proposed.primary_stimulus)}.`),
    },
    why: evidence(ctx, proposed, input),
    actions: [
      { id: 'use_adaptation', label: 'Use this workout', primary: true },
      { id: 'keep_original', label: 'Keep original' },
      { id: 'see_today', label: "See today's session" },
    ],
    commit: commitFor(proposed, sig),
  };
}

function commitFor(rec: Recommendation, sig: CoachSignals): CoachCommit {
  return {
    template_id: rec.template.id,
    variant: rec.variant.variant_code,
    name: rec.template.name,
    minutes: rec.estimated_minutes,
    time_limit: sig.time_limit,
    low_energy: sig.low_energy,
    low_impact: sig.low_impact,
    equipment: sig.equipment,
  };
}

/** F02 — explain today's recommendation, from the engine's own rationale. */
function explainAnswer(ctx: CoachContext): CoachAnswer {
  if (ctx.today.kind !== 'session') {
    return {
      text: ctx.today.rationale + ' ' + ctx.today.guidance,
      chips: chipsFor(ctx, ["Today's plan"]),
      actions: [{ id: 'see_today', label: 'See today', primary: true }],
    };
  }
  const rec = ctx.today;
  return {
    text: rec.rationale,
    chips: chipsFor(ctx, ["Today's plan", stimulusLabel(rec.primary_stimulus)]),
    why: evidence(ctx, rec),
    actions: [
      { id: 'see_today', label: "See today's session", primary: true },
      { id: 'ask_adapt', label: 'Ask for something shorter' },
    ],
  };
}

/**
 * F03 — performance question. Direction, window, sample size and confidence all
 * come from the comparable-session set; where the set is thin, the caveat says
 * so instead of the headline overselling it (brief §5.3).
 */
function progressAnswer(ctx: CoachContext): CoachAnswer {
  const series = COMPARABLE_1K;
  const first = series[0];
  const last = series[series.length - 1];
  const delta = first.pace_seconds - last.pace_seconds;
  const direction = delta >= 4 ? 'Improving' : delta <= -4 ? 'Slowing' : 'Holding';
  const n = series.length;
  const confidence: Confidence = n >= 6 ? 'high' : n >= 3 ? 'medium' : 'low';
  const withHr = series.filter(s => s.hr !== undefined).length;

  const fastest = Math.min(...series.map(s => s.pace_seconds));
  const slowest = Math.max(...series.map(s => s.pace_seconds));
  const span = Math.max(1, slowest - fastest);
  const median = [...series].sort((a, b) => a.pace_seconds - b.pace_seconds)[Math.floor(n / 2)];

  return {
    text: `Your comparable 1 km repeats are trending ${direction.toLowerCase()} over the last four `
      + `weeks at a similar RPE — ${paceClock(first.pace_seconds)} to `
      + `${paceClock(last.pace_seconds)} per km. I have ${n} comparable sessions, so confidence is `
      + `${confidence}: a direction, not yet a stable trend.`,
    chips: chipsFor(ctx, ['Last 4 weeks', '1 km repeats', 'RPE matched']),
    card: {
      kind: 'trend',
      metric: '1 km repeat pace',
      direction,
      from: `${paceClock(first.pace_seconds)} · ${first.date}`,
      to: `${paceClock(last.pace_seconds)} · ${last.date}`,
      window: '4 weeks',
      samples: `${n} comparable`,
      confidence,
      bars: series.map(s => ({
        // Faster pace draws taller, so the chart reads the way the claim does.
        height: 40 + Math.round(((slowest - s.pace_seconds) / span) * 60),
        accent: s.pace_seconds <= median.pace_seconds,
      })),
      caveat: `${withHr} of ${n} sessions carry heart rate, so I am weighting RPE instead. `
        + `${NON_COMPARABLE_1K} other running sessions in the window did not match the interval `
        + 'structure closely enough to compare.',
      a11y: `1 km repeat pace, ${direction.toLowerCase()}. ${paceClock(first.pace_seconds)} per `
        + `kilometre on ${first.date}, ${paceClock(last.pace_seconds)} on ${last.date}, across `
        + `${n} comparable sessions. Confidence ${confidence}.`,
    },
    why: [
      {
        k: 'Comparable-session rule',
        v: 'Same interval structure, same surface, within one RPE point. '
          + `${n} of ${n + NON_COMPARABLE_1K} sessions in the window qualified.`,
      },
      {
        k: 'Median pace',
        v: `${paceClock(median.pace_seconds)} per km across the window; `
          + `${paceClock(first.pace_seconds)} → ${paceClock(last.pace_seconds)} end to end.`,
      },
      {
        k: 'Heart-rate context',
        v: withHr < n
          ? `Present on ${withHr} of ${n} sessions, so it informs but does not carry the claim.`
          : 'Present on every comparable session.',
      },
    ],
    actions: [
      { id: 'see_progress', label: 'View in Progress', primary: true },
      { id: 'ask_weakness', label: 'What should I work on?' },
    ],
  };
}

/** F03 variant — the limiter question, ranked from the readiness components. */
function weaknessAnswer(ctx: CoachContext): CoachAnswer {
  const entries = Object.entries(ctx.readiness.components) as [string, number][];
  const ranked = [...entries].sort((a, b) => a[1] - b[1]);
  const [lowKey, lowValue] = ranked[0];
  const [highKey, highValue] = ranked[ranked.length - 1];
  const low = METRIC_DETAIL[lowKey];
  const high = METRIC_DETAIL[highKey];

  return {
    text: `${low?.label ?? lowKey} at ${lowValue} out of 100 is your lowest readiness component. `
      + `${low?.detail ?? ''} ${high?.label ?? highKey} at ${highValue} is your strongest — ahead of `
      + 'what your goal requires, so it is being maintained rather than built.',
    chips: chipsFor(ctx, ['Readiness components', ctx.race.name]),
    why: [
      { k: low?.label ?? lowKey, v: low?.detail ?? 'Lowest readiness component.' },
      { k: high?.label ?? highKey, v: high?.detail ?? 'Highest readiness component.' },
      {
        k: 'Ranking order',
        v: ranked.map(([k, v]) => `${METRIC_DETAIL[k]?.label ?? k} ${v}`).join(' · ') + '.',
      },
      {
        k: 'Confidence',
        v: `${ctx.readiness.confidence}. Enough to rank the components, not enough to quantify how `
          + 'much of your finish time each one costs.',
      },
    ],
    actions: [
      { id: 'see_progress', label: 'See Progress detail', primary: true },
      { id: 'ask_build', label: 'Build me a session for it' },
    ],
  };
}

/**
 * F04 — workout discovery. Coach searches validated content and lets the engine
 * rank what it finds; it never composes a session out of nothing, and it never
 * replaces today's plan without the athlete asking (brief §5.4).
 */
function buildAnswer_(sig: CoachSignals, ctx: CoachContext): CoachAnswer {
  const terms = sig.keywords ?? [];
  const excluded = new Set(sig.exclude_template_ids ?? []);
  const scored = TEMPLATES
    .filter(t => !excluded.has(t.id))
    .map(t => ({ t, hits: matchScore(t, terms) }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const chips = chipsFor(ctx, ['Equipment profile', ...(terms.length ? [terms.join(' + ')] : [])]);

  if (!scored.length) {
    return {
      text: excluded.size
        ? 'That is everything in your library that matches. I only offer validated sessions, so '
          + 'rather than write a new one I would rather adjust one of these.'
        : 'I could not find a validated session matching that. I build from the curated library '
          + 'rather than inventing work, so tell me the equipment and the quality you want and I '
          + 'will search again.',
      chips,
      actions: [
        { id: 'see_today', label: "See today's session", primary: true },
        { id: 'ask_weakness', label: 'What should I work on?' },
      ],
    };
  }

  // Only the templates that matched the most terms. Letting a one-term match
  // through would hand the engine a Zone 2 run for "sled and running" and let
  // stimulus urgency pick it — an answer to a question the athlete didn't ask.
  const best = scored[0].hits;
  const candidates = scored.filter(x => x.hits === best).slice(0, 6).map(x => x.t);
  const minutes = sig.time_limit ?? ctx.engineInput.available_minutes;
  const found = recommend({ ...ctx.engineInput, candidates, available_minutes: minutes }, EXERCISES);

  if (found.kind !== 'session') {
    return {
      text: `${candidates[0].name} is the closest match in your library, but it is not eligible `
        + `right now: ${found.rationale.toLowerCase()}`,
      chips,
      actions: [
        { id: 'ask_adapt', label: 'Adapt today instead', primary: true },
        { id: 'see_today', label: 'See today' },
      ],
    };
  }

  // Asked for 30 minutes and handed 15: say why, rather than letting the athlete
  // wonder whether Coach heard the number.
  const short = sig.time_limit !== undefined && found.estimated_minutes < sig.time_limit - 8
    ? ` It comes in at ${found.estimated_minutes} rather than the ${sig.time_limit} you asked for `
      + 'because your recovery inputs cap today\'s volume.'
    : '';

  return {
    text: `${found.template.name} fits — ${found.estimated_minutes} minutes at `
      + `${VARIANT_LABEL[found.variant.variant_code]}, targeting `
      + `${stimulusLabel(found.primary_stimulus)}.${short} It will not touch today's plan unless `
      + 'you tell me to use it.',
    chips,
    card: workoutCard(found, 'From your library'),
    why: evidence(ctx, found),
    actions: [
      { id: 'use_workout', label: 'Use today instead', primary: true },
      { id: 'show_another', label: 'Show another' },
    ],
    commit: commitFor(found, sig),
    offered_template_id: found.template.id,
  };
}

function matchScore(t: WorkoutTemplate, terms: string[]): number {
  const haystack = [t.name, t.workout_family, t.primary_goal, t.description, ...(t.tags ?? [])]
    .join(' ').toLowerCase();
  return terms.reduce((n, term) => n + (haystack.includes(term) ? 1 : 0), 0);
}

function workoutCard(rec: Recommendation, source: string): CoachCard {
  return {
    kind: 'workout',
    source,
    name: rec.template.name,
    variant: VARIANT_LABEL[rec.variant.variant_code],
    minutes: rec.estimated_minutes,
    goal: `${stimulusLabel(rec.primary_stimulus)} · ${rec.template.description}`,
    intensity: rec.template.intensity_target ?? `RPE guided`,
    blocks: blockRows(rec),
    equipment: equipmentFor(rec),
    fits: rec.rationale,
  };
}

/**
 * F05 — equipment and travel. The swaps are the engine's own
 * `substitutions_applied` for today's template under the reduced equipment set,
 * so a movement Coach shows as substitutable is one the validated substitution
 * table actually supports.
 */
function travelAnswer(sig: CoachSignals, ctx: CoachContext): CoachAnswer {
  const equipment = sig.equipment ?? ['bodyweight'];
  const names = equipment.filter(id => id !== 'bodyweight').map(id => equipmentName.get(id) ?? id);
  const chips = chipsFor(ctx, ['Equipment profile', names.join(' · ') || 'Bodyweight']);
  const input: EngineInput = { ...ctx.engineInput, available_equipment: equipment };

  if (ctx.today.kind === 'session') {
    const salvaged = recommend({ ...input, candidates: [ctx.today.template] }, EXERCISES);
    if (salvaged.kind === 'session') {
      const subs = salvaged.substitutions_applied.map(s => ({
        from: exerciseName(s.from),
        to: exerciseName(s.to),
        why: s.reason,
      }));
      if (!subs.length) {
        return {
          text: `${ctx.today.template.name} needs nothing you will not have, so no substitutions `
            + 'are required — it runs as written.',
          chips,
          actions: [{ id: 'see_today', label: 'See today', primary: true }],
        };
      }
      return {
        text: `I can keep ${ctx.today.template.name} with `
          + `${subs.length} substitution${subs.length === 1 ? '' : 's'}. The stimulus holds; the `
          + 'load on the substituted movements does not always match.',
        chips,
        card: {
          kind: 'substitution',
          title: `Substitutions · ${names.join(' · ') || 'bodyweight'}`,
          subs,
          caveat: 'A substitute keeps the movement pattern and the quality being trained. It does '
            + 'not always reproduce the load, so treat the effort as the target rather than the '
            + 'number.',
        },
        why: evidence(ctx, salvaged),
        actions: [
          { id: 'use_equipment_today', label: 'Use for today', primary: true },
          { id: 'review_plan', label: 'Apply to my whole trip' },
        ],
        commit: { ...commitFor(salvaged, sig), equipment },
        proposal: travelProposal(equipment, names, sig.days ?? WEEK_SHAPE.open_days.length, ctx),
      };
    }
  }

  // Today's session cannot be salvaged: offer what *is* eligible instead of a
  // substitution that loses the stimulus.
  const blocked = ctx.today.kind === 'session'
    ? unsupportedMovements(ctx.today, equipment) : [];
  // "Show another" arrives as the same question with the offered session
  // excluded, so the second answer has to be a different session.
  const excluded = new Set(sig.exclude_template_ids ?? []);
  const alternative = recommend(
    { ...input, candidates: input.candidates.filter(c => !excluded.has(c.id)) }, EXERCISES);
  if (alternative.kind !== 'session') {
    return {
      text: `${alternative.rationale} ${alternative.guidance}`,
      chips,
      actions: [{ id: 'see_today', label: 'See today', primary: true }],
    };
  }
  return {
    text: (blocked.length
      ? `Today's session needs ${blocked.join(' and ')}, and there is no validated substitute for `
        + `${blocked.length === 1 ? 'it' : 'those'} on what you will have. `
      : 'Today\'s session needs equipment you will not have, and substituting it would lose the '
        + 'stimulus. ')
      + `${alternative.template.name} is the closest validated session on `
      + `${names.join(' and ') || 'bodyweight'}.`,
    chips,
    card: workoutCard(alternative, 'Eligible on your travel equipment'),
    why: evidence(ctx, alternative),
    actions: [
      { id: 'use_equipment_today', label: 'Use for today', primary: true },
      { id: 'show_another', label: 'Show another' },
    ],
    commit: { ...commitFor(alternative, sig), equipment },
    offered_template_id: alternative.template.id,
    proposal: travelProposal(equipment, names, sig.days ?? WEEK_SHAPE.open_days.length, ctx),
  };
}

/**
 * F06 — a meaningful weekly change. This is a proposal, never an applied
 * change: the answer carries the comparison and the review screen commits it.
 */
function planAnswer(sig: CoachSignals, ctx: CoachContext): CoachAnswer {
  const proposal = weekDaysProposal(sig.days ?? 4, ctx);
  return {
    text: `I can compress the week and protect the priority sessions. `
      + `${proposal.lede} This changes your week, so nothing moves until you review it.`,
    chips: chipsFor(ctx, ['This week']),
    card: { kind: 'plan', proposal },
    proposal,
    actions: [
      { id: 'review_plan', label: 'Review changes', primary: true },
      { id: 'decline_plan', label: 'Leave my week alone' },
    ],
  };
}

/**
 * A compressed week. Capacity is deliberately explicit: a training day takes at
 * most two sessions when the week is being squeezed, and what drops is decided
 * by the queue's priority order rather than by what reads well.
 */
export function weekDaysProposal(requestedDays: number, ctx: CoachContext): PlanProposal {
  const trained = WEEK_SHAPE.days_trained;
  const openBudget = Math.max(0, requestedDays - trained);
  const days = WEEK_SHAPE.open_days.slice(-openBudget || WEEK_SHAPE.open_days.length);
  const usableDays = openBudget === 0 ? [] : days;
  const capacity = usableDays.length * 2;

  const byPriority = [...ctx.queue].sort((a, b) => a.priority - b.priority);
  const kept = byPriority.slice(0, capacity);
  const dropped = byPriority.slice(capacity);

  const rows: PlanProposal['rows'] = [];
  if (ctx.today.kind === 'session') {
    rows.push({
      name: ctx.today.template.name,
      verb: 'Unchanged',
      detail: `Today · ${ctx.today.estimated_minutes} min · already counted in the days you have `
        + 'trained',
      emphasis: false,
    });
  }
  kept.forEach((session, i) => {
    const target = usableDays[Math.min(i, usableDays.length - 1)];
    const paired = i >= usableDays.length;
    const name = templateById.get(session.template_id)?.name ?? session.template_id;
    rows.push({
      name,
      verb: session.day === target && !paired ? 'Unchanged' : 'Moves',
      detail: session.day === target && !paired
        ? `${session.day} · ${session.minutes} min unchanged`
        : `${session.day} → ${target} · ${session.minutes} min unchanged`
          + (paired ? ' · second session that day' : ''),
      emphasis: session.day !== target || paired,
    });
  });
  dropped.forEach(session => {
    const name = templateById.get(session.template_id)?.name ?? session.template_id;
    rows.push({
      name,
      verb: 'Drops',
      detail: `${session.minutes} min ${stimulusLabel(session.stimulus)} · lowest priority this week`,
      emphasis: true,
    });
  });

  const plannedExposures = ctx.weekStimuli.reduce((n, s) => n + s.target_exposures, 0);
  const droppedExposures = dropped.length;
  const protectedStimuli = kept
    .filter(s => s.priority === 1)
    .map(s => stimulusLabel(s.stimulus));

  const impact: PlanProposal['impact'] = [
    ...protectedStimuli.map(s => ({ text: `${sentence(s)} session`, tag: 'Protected', reduced: false })),
    ...(ctx.today.kind === 'session'
      ? [{
          text: `Today's ${stimulusLabel(ctx.today.primary_stimulus)} work`,
          tag: 'Protected',
          reduced: false,
        }]
      : []),
    {
      text: `Weekly stimulus exposures ${plannedExposures} → ${plannedExposures - droppedExposures}`,
      tag: droppedExposures ? 'Reduced' : 'Unchanged',
      reduced: droppedExposures > 0,
    },
    ...dropped.map(s => ({
      text: `${sentence(stimulusLabel(s.stimulus))} volume`,
      tag: `Deferred to week ${ctx.phase.week + 1}`,
      reduced: true,
    })),
  ];

  const dayWord = requestedDays === 1 ? 'day' : 'days';
  return {
    kind: 'week_days',
    title: `${requestedDays} training ${dayWord}\nthis week`,
    lede: dropped.length
      ? `${dropped.length} session${dropped.length === 1 ? '' : 's'} would drop and `
        + `${rows.filter(r => r.verb === 'Moves').length} would move.`
      : 'Nothing would need to drop — the remaining sessions just move.',
    current: { label: 'Current', value: String(WEEK_SHAPE.planned_days), unit: 'DAYS' },
    proposed: { label: 'Proposed', value: String(requestedDays), unit: 'DAYS' },
    rows,
    impact,
    consequence: ctx.race.days_remaining > 42
      ? `Race-specific consequence: none the engine can support at ${ctx.race.days_remaining} days `
        + 'out. A second reduced week in a row would change that.'
      : `At ${ctx.race.days_remaining} days out, a reduced week costs race-specific exposure that `
        + 'the remaining weeks cannot fully replace.',
    applied: dropped.length
      ? `Your week is now ${requestedDays} ${dayWord}. `
        + `${kept.map(s => templateById.get(s.template_id)?.name ?? s.template_id).join(' and ')} `
        + `moved, and ${dropped.map(s => templateById.get(s.template_id)?.name ?? s.template_id)
          .join(' and ')} was dropped.`
      : `Your week is now ${requestedDays} ${dayWord} with the same sessions.`,
  };
}

/** The multi-day equipment change — same confirmation gate as any week change. */
export function travelProposal(
  equipment: string[],
  names: string[],
  days: number,
  ctx: CoachContext,
): PlanProposal {
  const affected = WEEK_SHAPE.open_days.slice(0, Math.max(1, Math.min(days, WEEK_SHAPE.open_days.length)));
  const rows: PlanProposal['rows'] = [];
  // Replacements are chosen once each: three days of the same substitute
  // session would be a worse week than the one it replaced.
  const spent = new Set<string>();
  let intact = 0;

  affected.forEach(day => {
    const planned = ctx.queue.find(s => s.day === day);
    if (!planned) return;
    const template = templateById.get(planned.template_id);
    const name = template?.name ?? planned.template_id;
    if (!template) {
      rows.push({ name, verb: 'Unchanged', detail: `${day} · not in the offline library`, emphasis: false });
      return;
    }
    const result = recommend(
      { ...ctx.engineInput, available_equipment: equipment, candidates: [template] }, EXERCISES);
    if (result.kind !== 'session') {
      const alternative = recommend({
        ...ctx.engineInput,
        available_equipment: equipment,
        available_minutes: planned.minutes,
        candidates: TEMPLATES.filter(c => !spent.has(c.id) && c.id !== template.id),
      }, EXERCISES);
      if (alternative.kind === 'session') spent.add(alternative.template.id);
      rows.push({
        name,
        verb: 'Replaced',
        detail: alternative.kind === 'session'
          ? `${day} · ${alternative.template.name}, ${alternative.estimated_minutes} min instead · `
            + 'substituting the original would lose its stimulus'
          : `${day} · nothing in the library is eligible on this equipment`,
        emphasis: true,
      });
      return;
    }
    if (!result.substitutions_applied.length) {
      intact += 1;
      rows.push({ name, verb: 'Unchanged', detail: `${day} · works as written`, emphasis: false });
      return;
    }
    rows.push({
      name,
      verb: 'Substituted',
      detail: `${day} · `
        + result.substitutions_applied
            .map(s => `${exerciseName(s.from)} → ${exerciseName(s.to)}`).join(' · '),
      emphasis: true,
    });
  });

  const changed = rows.filter(r => r.verb !== 'Unchanged').length;
  return {
    kind: 'travel',
    title: `${names.join(' and ') || 'Bodyweight'}\nfor ${affected.length} day`
      + `${affected.length === 1 ? '' : 's'}`,
    lede: `${changed} of ${rows.length} sessions change; ${intact} work as written.`,
    current: { label: 'Equipment', value: String(ctx.engineInput.available_equipment.length), unit: 'ITEMS' },
    proposed: { label: 'On the trip', value: String(equipment.length), unit: 'ITEMS' },
    rows,
    impact: [
      { text: 'Session count', tag: 'Unchanged', reduced: false },
      { text: 'Primary stimulus per session', tag: changed ? 'Preserved by substitution' : 'Unchanged', reduced: false },
      { text: 'Load on substituted movements', tag: 'Reduced', reduced: true },
    ],
    consequence: 'Station-specific work is the part travel costs you. Sled and wall-ball loads '
      + 'cannot be reproduced with dumbbells, so those qualities hold rather than progress this week.',
    applied: `${affected.join(', ')} now run on ${names.join(' and ') || 'bodyweight'}. `
      + 'The rest of your week is unchanged.',
    commit_travel: { equipment, days: affected },
  };
}

/**
 * §10 — the safety boundary. No diagnosis, no clearance, and no re-reading pain
 * as fatigue. The actions offered are product actions, not medical advice.
 */
function safetyAnswer(ctx: CoachContext): CoachAnswer {
  return {
    text: "I'm not going to adapt around that. Sharp pain is different from fatigue, and I can't "
      + "tell you whether it's safe to train — that's a clinician's call.",
    chips: chipsFor(ctx, ["Today's plan"]),
    card: {
      kind: 'safety',
      boundary: 'Sharp pain is not fatigue, so I will not treat it as low readiness and programme '
        + 'around it. I also cannot assess symptoms or give medical clearance, and your readiness '
        + 'score is not a medical assessment.',
      unchanged: "I've left today's session untouched. Nothing in your week has changed.",
    },
    actions: [
      { id: 'ask_low_impact', label: 'Show low-impact options', primary: true },
      { id: 'flag_symptom', label: "Flag it on today's check-in" },
    ],
  };
}

/** brief §9.2 — say what Coach answers from rather than refusing. */
function fallbackAnswer(ctx: CoachContext): CoachAnswer {
  return {
    text: 'I answer from your plan and your logged training, so I need the question to land on one '
      + "of those. Ask about today's session, your progress, a schedule or equipment change, or a "
      + 'workout you want built.',
    chips: chipsFor(ctx),
    actions: [
      { id: 'ask_explain', label: 'Why this workout today?', primary: true },
      { id: 'ask_adapt', label: 'I have less time than planned' },
    ],
  };
}

export function buildAnswer(
  intent: CoachIntent | null,
  signals: CoachSignals,
  ctx: CoachContext,
): CoachAnswer {
  switch (intent) {
    case 'adapt': return adaptAnswer(signals, ctx);
    case 'explain': return explainAnswer(ctx);
    case 'progress': return progressAnswer(ctx);
    case 'weakness': return weaknessAnswer(ctx);
    case 'build': return buildAnswer_(signals, ctx);
    case 'travel': return travelAnswer(signals, ctx);
    case 'plan': return planAnswer(signals, ctx);
    case 'safety': return safetyAnswer(ctx);
    default: return fallbackAnswer(ctx);
  }
}

/**
 * The proactive insight (CC03). Shown only when the engine's pick for today
 * differs from the athlete's planned queue, or a trend is decision-relevant —
 * never as generic motivation (brief §3.3).
 */
export interface CoachInsight {
  label: string;
  text: string;
  chips: string[];
  intent: CoachIntent;
  cta: string;
}

export function insightFor(ctx: CoachContext): CoachInsight | null {
  const delta = COMPARABLE_1K[0].pace_seconds
    - COMPARABLE_1K[COMPARABLE_1K.length - 1].pace_seconds;

  if (ctx.today.kind === 'session' && ctx.today.variant.variant_code !== 'green') {
    return {
      label: 'Coach noticed',
      text: `Today is ${VARIANT_LABEL[ctx.today.variant.variant_code]} rather than the full `
        + `session. ${ctx.today.rationale}`,
      chips: ["Today's plan", `Readiness ${ctx.readiness.overall} · ${ctx.readiness.confidence}`],
      intent: 'explain',
      cta: 'See why',
    };
  }

  if (delta >= 4) {
    return {
      label: 'Coach noticed',
      text: `Your last ${COMPARABLE_1K.length} comparable 1 km repeats held pace at the same RPE, `
        + `${delta} seconds per km faster end to end. Threshold work can progress at the next `
        + 'exposure.',
      chips: ['Last 4 weeks', `${COMPARABLE_1K.length} comparable sessions`],
      intent: 'progress',
      cta: 'See the evidence',
    };
  }

  return null;
}
