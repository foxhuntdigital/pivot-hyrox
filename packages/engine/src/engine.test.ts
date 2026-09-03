/**
 * Engine tests.
 *
 * Coverage maps to PRD §23.1 (unit) and §23.3 (E2E acceptance scenarios), and
 * runs against the real curated library in tests/engine-fixtures/content.json
 * rather than hand-built stubs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { recommend, ENGINE_VERSION } from './index.ts';
import { computeReadiness } from './readiness.ts';
import {
  effectiveRecovery, hasSevereSymptom, variantMinutes, resolveEquipment,
  recoveryFromEnergy, INTENSITY_CEILING, templateIntensity,
} from './guardrails.ts';
import { transformBlocks, preservesPrimaryStimulus, blockRole } from './transform.ts';
import { intensityCost, stimulusUrgency, recoveryFit } from './rank.ts';
import type { EngineInput, Exercise, WorkoutTemplate, Substitution } from './types.ts';

const fixture = JSON.parse(readFileSync(
  new URL('../../../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));

const EXERCISES: Exercise[] = fixture.exercises;
const TEMPLATES: WorkoutTemplate[] = fixture.templates;
const SUBSTITUTIONS: Substitution[] = fixture.substitutions;
const ALL_EQUIPMENT: string[] = fixture.equipment.map((e: any) => e.id);

/** A well-resourced athlete in the middle of a build block. */
function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    local_date: '2026-08-19',
    phase_type: 'build',
    days_to_race: 52,
    stimulus_requirements: [
      { stimulus_type: 'aerobic_base', target_exposures: 2, completed_exposures: 0, priority: 1 },
      { stimulus_type: 'threshold', target_exposures: 2, completed_exposures: 1, priority: 2 },
      { stimulus_type: 'strength', target_exposures: 2, completed_exposures: 1, priority: 2 },
    ],
    recent_sessions: [
      { template_id: 'wo_ski_zone_2_30', workout_family: 'ski_base', primary_goal: 'aerobic_base', days_ago: 3, impact_level: 'low', session_rpe: 4 },
    ],
    recovery_state: 'good',
    energy: 'normal',
    sleep_hours: 7.5,
    available_minutes: 60,
    available_equipment: ALL_EQUIPMENT,
    low_impact_required: false,
    symptom_flags: [],
    considerations: [],
    candidates: TEMPLATES,
    substitutions: SUBSTITUTIONS,
    ...over,
  };
}

describe('E2E acceptance (PRD §23.3)', () => {
  test('60 minutes + normal recovery returns a Full session', () => {
    const d = recommend(baseInput(), EXERCISES);
    assert.equal(d.kind, 'session');
    if (d.kind !== 'session') return;

    assert.equal(d.variant.variant_code, 'green', 'should not compress when time and recovery allow');
    assert.ok(d.estimated_minutes <= 60);
    assert.ok(d.rationale.length > 0, 'every decision must explain itself');
    assert.ok(d.reason_codes.includes('STIMULUS_DUE'));
  });

  test('same athlete with 25 minutes gets a valid compressed adaptation', () => {
    const d = recommend(baseInput({ available_minutes: 25 }), EXERCISES);
    assert.equal(d.kind, 'session');
    if (d.kind !== 'session') return;

    assert.ok(['yellow', 'red'].includes(d.variant.variant_code),
      `expected Express/Micro, got ${d.variant.variant_code}`);
    assert.ok(d.estimated_minutes <= 25, `session must fit: got ${d.estimated_minutes}`);
    assert.ok(d.reason_codes.includes('TIME_LIMIT'));
    assert.ok(preservesPrimaryStimulus(d.template, d.blocks),
      'compression must preserve the primary stimulus');
  });

  test('low recovery caps intensity at the ceiling, however urgent the stimulus', () => {
    const input = baseInput({
      recovery_state: 'poor', energy: 'low', sleep_hours: 4,
      stimulus_requirements: [
        { stimulus_type: 'threshold', target_exposures: 2, completed_exposures: 0, priority: 1 },
      ],
    });
    const tired = recommend(input, EXERCISES);

    assert.equal(tired.kind, 'session');
    if (tired.kind !== 'session') return;

    assert.ok(tired.reason_codes.includes('RECOVERY_LOW'));

    // The invariant is the ceiling itself, and it is inclusive: `poor` allows
    // RPE 6, so a session at exactly 0.6 is compliant. Comparing against
    // whatever a fresh athlete happened to be given instead would make this
    // depend on library composition rather than on the rule — it passed for a
    // while only because no eligible RPE 6 template served threshold.
    const ceiling = INTENSITY_CEILING[effectiveRecovery(input)];
    assert.ok(templateIntensity(tired.template) <= ceiling,
      `a depleted athlete must not be given work above the ${ceiling} intensity ceiling`);
  });

  test('no SkiErg still yields a session that serves the week', () => {
    const noSki = ALL_EQUIPMENT.filter(e => e !== 'ski');
    const d = recommend(baseInput({ available_equipment: noSki }), EXERCISES);

    assert.equal(d.kind, 'session');
    if (d.kind !== 'session') return;

    // Either a session needing no SkiErg, or one where it was substituted.
    const usesSki = d.blocks.some(b => b.exercises.some(e => e.exercise_id === 'ex_skierg'));
    assert.ok(!usesSki || d.substitutions_applied.length > 0,
      'SkiErg work must be substituted when the erg is unavailable');
  });

  test('a 7+ day gap triggers re-entry, not backlog', () => {
    const d = recommend(baseInput({
      recent_sessions: [
        { template_id: 'wo_zone_2_run_30', workout_family: 'run_base', primary_goal: 'aerobic_base', days_ago: 11, impact_level: 'medium', session_rpe: 5 },
      ],
    }), EXERCISES);

    assert.equal(d.kind, 'session');
    if (d.kind !== 'session') return;
    assert.ok(d.reason_codes.includes('REENTRY_AFTER_GAP'));
    assert.match(d.rationale, /gap/i);
  });
});

/**
 * The rationale is a sentence, and has to read like one.
 *
 * It is assembled from independent clauses, and the join used to strip the last
 * comma unconditionally — right for the one clause that carries its own "and",
 * wrong for every other shape. What the athlete saw was two clauses run
 * together: "rather than picking up where the plan left off trimmed to fit the
 * time you have", which reads as a missing word rather than a missing comma.
 *
 * Pinned as punctuation around the clause openings rather than as whole
 * sentences, so rewording any clause does not break the test that guards how
 * they are joined.
 */
describe('The rationale reads as a sentence', () => {
  /** Clause openings that must be preceded by a comma when they appear. */
  const COMMA_BEFORE = [
    'trimmed to fit the time you have',
    'cut to a minimum effective dose',
    'at a controlled intensity',
    'with high-impact movements swapped out',
    'with substitutions for the kit',
  ];

  /** Inputs chosen to exercise each optional clause at least once. */
  const CASES: Array<[string, Partial<EngineInput>]> = [
    ['a re-entry after a gap, on limited time', {
      available_minutes: 40,
      recent_sessions: [
        { template_id: 'wo_zone_2_run_30', workout_family: 'run_base', primary_goal: 'aerobic_base', days_ago: 11, impact_level: 'medium', session_rpe: 5 },
      ],
    }],
    ['a very short session', { available_minutes: 20 }],
    ['an athlete recovering poorly', { recovery_state: 'poor', energy: 'low', sleep_hours: 4 }],
    ['an athlete recovering unevenly', { recovery_state: 'okay', energy: 'normal', sleep_hours: 6 }],
    ['low impact required', { low_impact_required: true }],
    ['missing equipment', { available_equipment: ALL_EQUIPMENT.filter(e => e !== 'ski') }],
    ['everything at once', {
      available_minutes: 20, low_impact_required: true,
      recovery_state: 'poor', energy: 'low', sleep_hours: 4,
      recent_sessions: [
        { template_id: 'wo_zone_2_run_30', workout_family: 'run_base', primary_goal: 'aerobic_base', days_ago: 11, impact_level: 'medium', session_rpe: 5 },
      ],
    }],
  ];

  for (const [label, over] of CASES) {
    test(`clauses are separated — ${label}`, () => {
      const d = recommend(baseInput(over), EXERCISES);
      if (d.kind !== 'session') return;   // a refusal has its own sentence

      for (const clause of COMMA_BEFORE) {
        const at = d.rationale.indexOf(clause);
        if (at <= 0) continue;
        assert.equal(d.rationale.slice(at - 2, at), ', ',
          `"${clause}" runs into the clause before it: ${d.rationale}`);
      }

      // The one clause that carries its own conjunction takes no comma.
      assert.doesNotMatch(d.rationale, /, and held well below/,
        `a clause opening with "and" must not also take a comma: ${d.rationale}`);
      assert.doesNotMatch(d.rationale, /,\s*\./, `trailing comma: ${d.rationale}`);
      assert.match(d.rationale, /\.$/, `must end in a full stop: ${d.rationale}`);
    });
  }
});

describe('Hard guardrails (PRD §9.4)', () => {
  test('concerning symptoms return no session and do not diagnose', () => {
    const d = recommend(baseInput({ symptom_flags: ['chest tightness'] }), EXERCISES);

    assert.equal(d.kind, 'no_session');
    if (d.kind !== 'no_session') return;
    assert.ok(d.reason_codes.includes('NO_VALID_HARD_SESSION'));
    assert.doesNotMatch(d.guidance, /diagnos|you have|it'?s probably/i,
      'guidance must not read as a diagnosis');
    assert.match(d.guidance, /professional/i, 'should point to appropriate evaluation');
  });

  test('severe symptom matching covers the PRD list', () => {
    for (const s of ['chest pain', 'dizziness', 'pelvic pressure', 'leaking', 'bleeding']) {
      assert.ok(hasSevereSymptom([s]), `${s} should be treated as severe`);
    }
    assert.ok(!hasSevereSymptom(['low sleep', 'tired']), 'ordinary fatigue is not severe');
  });

  test('no maximal testing on poor recovery', () => {
    const d = recommend(baseInput({
      recovery_state: 'poor', sleep_hours: 4, available_minutes: 90,
      stimulus_requirements: [
        { stimulus_type: 'race_specific', target_exposures: 1, completed_exposures: 0, priority: 1 },
      ],
    }), EXERCISES);

    if (d.kind === 'session') {
      assert.notEqual(d.template.workout_family, 'simulation',
        'race simulation is maximal testing and is barred on poor recovery');
    }
  });

  test('taper overrides generic progression', () => {
    const d = recommend(baseInput({ phase_type: 'taper', days_to_race: 5 }), EXERCISES);
    if (d.kind === 'session') {
      assert.ok(['recovery', 'micro', 'run_quality', 'ski_quality'].includes(d.template.workout_family),
        `taper must not prescribe ${d.template.workout_family}`);
      assert.ok(d.reason_codes.includes('TAPER_OVERRIDE'));
    }
  });

  test('an urgent stimulus cannot outvote the intensity ceiling', () => {
    // Regression: stimulus_urgency is weighted 30% and recovery_fit only 20%,
    // so scoring alone once handed a depleted athlete RPE 6-7 threshold work.
    // The ceiling is a hard constraint precisely so that cannot happen.
    const d = recommend(baseInput({
      recovery_state: 'poor', energy: 'low', sleep_hours: 3.5,
      stimulus_requirements: [
        { stimulus_type: 'threshold', target_exposures: 2, completed_exposures: 0, priority: 1 },
      ],
    }), EXERCISES);

    if (d.kind === 'session') {
      assert.ok(intensityCost(d.template) <= INTENSITY_CEILING.poor + 1e-9,
        `poor recovery must not exceed the ceiling: ${d.template.id} at ${d.template.intensity_target}`);
    }
  });

  test('heavy lower-body work is not repeated back to back', () => {
    const d = recommend(baseInput({
      recent_sessions: [
        { template_id: 'wo_hyrox_legs_a', workout_family: 'strength_legs', primary_goal: 'strength', days_ago: 1, impact_level: 'medium', session_rpe: 7 },
      ],
      stimulus_requirements: [
        { stimulus_type: 'strength', target_exposures: 3, completed_exposures: 0, priority: 1 },
      ],
    }), EXERCISES);

    if (d.kind === 'session') {
      assert.notEqual(d.template.workout_family, 'strength_legs',
        'consecutive heavy lower-body days violate the spacing rule');
    }
  });

  test('twelve minutes returns Micro or no session, never a faked full stimulus', () => {
    const d = recommend(baseInput({ available_minutes: 12 }), EXERCISES);
    if (d.kind === 'session') {
      assert.ok(d.estimated_minutes <= 12);
      assert.equal(d.variant.variant_code, 'red');
    } else {
      assert.ok(d.reason_codes.includes('NO_VALID_HARD_SESSION'));
    }
  });

  test('postpartum considerations exclude non-friendly content', () => {
    const d = recommend(baseInput({
      considerations: ['Postpartum', 'Pelvic-floor considerations'],
    }), EXERCISES);

    if (d.kind === 'session') {
      assert.ok(d.template.postpartum_friendly);
      const unsafe = d.blocks.flatMap(b => b.exercises)
        .map(e => EXERCISES.find(x => x.id === e.exercise_id))
        .filter(e => e && !e.postpartum_friendly);
      assert.equal(unsafe.length, 0, `unsafe exercises: ${unsafe.map(e => e!.id).join(', ')}`);
    }
  });
});

describe('Determinism and reproducibility (PRD §24)', () => {
  test('same input yields the same decision', () => {
    const a = recommend(baseInput(), EXERCISES);
    const b = recommend(baseInput(), EXERCISES);
    assert.deepEqual(a, b);
  });

  test('candidate array order does not change the outcome', () => {
    const forward = recommend(baseInput(), EXERCISES);
    const reversed = recommend(baseInput({ candidates: [...TEMPLATES].reverse() }), EXERCISES);
    assert.equal(
      forward.kind === 'session' ? forward.template.id : 'none',
      reversed.kind === 'session' ? reversed.template.id : 'none',
      'ranking must be stable regardless of input ordering');
  });

  test('engine version is exported for the audit trail', () => {
    assert.match(ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
  });
});

describe('Variant transformation (PRD §9.3)', () => {
  const template = TEMPLATES.find(t => t.id === 'wo_hyrox_legs_a')!;

  test('every template compresses without losing its primary stimulus', () => {
    for (const t of TEMPLATES) {
      for (const v of t.variants) {
        const blocks = transformBlocks(t, v);
        assert.ok(preservesPrimaryStimulus(t, blocks),
          `${t.id}/${v.variant_code} dropped its primary stimulus`);
      }
    }
  });

  test('volume decreases monotonically Full -> Express -> Micro', () => {
    for (const t of TEMPLATES) {
      const byCode = Object.fromEntries(t.variants.map(v => [v.variant_code, v]));
      const vol = (code: string) => {
        const blocks = transformBlocks(t, byCode[code]);
        return blocks.reduce((sum, b) =>
          sum + (b.rounds ?? 1) * b.exercises.reduce((s, e) => s + e.quantity, 0), 0);
      };
      assert.ok(vol('green') >= vol('yellow'), `${t.id}: Express is not lighter than Full`);
      assert.ok(vol('yellow') >= vol('red'), `${t.id}: Micro is not lighter than Express`);
    }
  });

  test('no variant exceeds its own duration estimate (PRD §19.2)', () => {
    for (const t of TEMPLATES) {
      for (const v of t.variants) {
        assert.ok(variantMinutes(t, v) <= t.estimated_minutes,
          `${t.id}/${v.variant_code} is longer than the full session`);
      }
    }
  });

  test('block roles are classified from the authored content', () => {
    assert.equal(blockRole({ block_type: 'continuous', title: 'Warm-up', exercises: [], id: 'x', block_order: 1 } as any), 'warmup');
    assert.equal(blockRole({ block_type: 'continuous', title: 'Cooldown', exercises: [], id: 'x', block_order: 1 } as any), 'cooldown');
    assert.equal(blockRole({ block_type: 'rounds', title: 'Main', exercises: [], id: 'x', block_order: 1 } as any), 'primary');
  });

  test('Micro does not raise intensity to buy back volume', () => {
    const micro = template.variants.find(v => v.variant_code === 'red')!;
    const full = template.variants.find(v => v.variant_code === 'green')!;
    assert.ok(micro.volume_multiplier < full.volume_multiplier);
    const microBlocks = transformBlocks(template, micro);
    const fullBlocks = transformBlocks(template, full);
    for (let i = 0; i < microBlocks.length; i++) {
      const mi = microBlocks[i], fi = fullBlocks[i];
      if (mi?.rounds != null && fi?.rounds != null) assert.ok(mi.rounds <= fi.rounds);
    }
  });

  /**
   * Working sets come off with the variant, and reps do not.
   *
   * `sets` (migration 0011) carries the same count `quantity` has always
   * carried on a sets x reps row, and the player reads `sets` in preference
   * because it is the field that can be trusted. If only `quantity` scaled, an
   * athlete on a twenty-minute Micro would be handed the full four working
   * sets while every other part of the session compressed around them.
   *
   * Reps holding steady is the other half: a 4x6 cut to 2x6 keeps the stimulus
   * and takes away the dose, where 4x4 would change what the session trains.
   */
  test('a Micro cuts working sets, not reps', () => {
    const strength = TEMPLATES.find((t: WorkoutTemplate) =>
      t.blocks.some(b => b.exercises.some(e => e.sets != null)));
    if (!strength) return;   // no structured prescription in the fixture yet

    const micro = strength.variants.find(v => v.variant_code === 'red')!;
    const full = strength.variants.find(v => v.variant_code === 'green')!;

    const microSets = transformBlocks(strength, micro)
      .flatMap(b => b.exercises).filter(e => e.sets != null);
    const fullSets = transformBlocks(strength, full)
      .flatMap(b => b.exercises).filter(e => e.sets != null);

    assert.ok(microSets.length > 0, 'the fixture should carry a structured prescription');

    for (const m of microSets) {
      const f = fullSets.find(x => x.exercise_id === m.exercise_id);
      if (!f) continue;
      assert.ok(m.sets! <= f.sets!,
        `${m.exercise_id}: Micro prescribes ${m.sets} sets against Full's ${f.sets}`);
      assert.ok(m.sets! >= 1, 'a set count never scales to nothing');
      assert.equal(m.reps_min, f.reps_min,
        `${m.exercise_id}: reps changed with the variant — volume comes off in whole sets`);
      assert.equal(m.reps_max, f.reps_max);
    }

    // And the legacy field stays in step with the new one, so a reader of
    // either sees the same session.
    for (const m of microSets) assert.equal(m.sets, m.quantity);
  });
});

describe('Equipment substitution graph (PRD §6.4)', () => {
  const index = new Map(EXERCISES.map(e => [e.id, { equipment: e.equipment, impact_level: e.impact_level }]));

  test('bodyweight-only still resolves some session', () => {
    const d = recommend(baseInput({
      available_equipment: ['bodyweight'], available_minutes: 30,
    }), EXERCISES);
    // Either a valid bodyweight session or an honest no-session — never a
    // session prescribing equipment the athlete does not have.
    if (d.kind === 'session') {
      const missing = d.blocks.flatMap(b => b.exercises).filter(be => {
        const ex = EXERCISES.find(x => x.id === be.exercise_id)!;
        return ex.equipment.length > 0
          && !ex.equipment.some(eq => eq === 'bodyweight' || eq === 'outdoor');
      });
      assert.equal(missing.length, 0,
        `prescribed unavailable equipment: ${missing.map(m => m.exercise_id).join(', ')}`);
    }
  });

  test('substitutions only come from the validated graph', () => {
    const d = recommend(baseInput({
      available_equipment: ALL_EQUIPMENT.filter(e => e !== 'sled'),
    }), EXERCISES);
    if (d.kind !== 'session') return;
    for (const s of d.substitutions_applied) {
      assert.ok(
        SUBSTITUTIONS.some(g => g.exercise_id === s.from && g.substitute_exercise_id === s.to),
        `${s.from} -> ${s.to} is not in the substitution graph`);
    }
  });

  test('resolveEquipment reports failure rather than guessing', () => {
    const skiTemplate = TEMPLATES.find(t => t.requires_ski && t.id === 'wo_ski_5x500')!;
    const r = resolveEquipment(skiTemplate, baseInput({ available_equipment: ['bodyweight'] }), index);
    assert.equal(r.ok, false, 'a SkiErg session with no erg and no substitute must fail');
  });
});

describe('Recovery derivation', () => {
  test('short sleep caps recovery at the documented boundaries', () => {
    // Under 5h caps at okay; under 4h drops to poor. The design's own scenario
    // (4:10 of sleep -> Express) depends on 4h+ still being 'okay'.
    assert.equal(effectiveRecovery(baseInput({ recovery_state: 'good', sleep_hours: 4.17 })), 'okay');
    assert.equal(effectiveRecovery(baseInput({ recovery_state: 'good', sleep_hours: 3.5 })), 'poor');
    assert.equal(effectiveRecovery(baseInput({ recovery_state: 'good', sleep_hours: 7.5 })), 'good');
  });

  test('low energy caps recovery at okay', () => {
    assert.equal(effectiveRecovery(baseInput({ recovery_state: 'good', energy: 'low' })), 'okay');
  });

  test('nothing reported is good, not a middle state', () => {
    // The rule that decides which version of a session an athlete is offered.
    // `okay` is deliberately unreachable from here: green variants require
    // `good`, so answering `okay` to silence meant the Full version of every
    // session was withheld from every athlete who had simply not checked in —
    // the app disagreeing with the plan it had just sold them.
    assert.equal(recoveryFromEnergy(undefined), 'good');
    assert.equal(recoveryFromEnergy(null), 'good');
    assert.equal(recoveryFromEnergy('normal'), 'good');
    assert.equal(recoveryFromEnergy('high'), 'good');
    assert.equal(recoveryFromEnergy('low'), 'poor');
  });

  test('a middle state comes from a reason, not from silence', () => {
    // `okay` is what effectiveRecovery lowers to when something was actually
    // reported — which is what makes it mean anything.
    const quiet = baseInput({ recovery_state: recoveryFromEnergy('normal'), sleep_hours: null });
    assert.equal(effectiveRecovery(quiet), 'good');
    assert.equal(effectiveRecovery({ ...quiet, sleep_hours: 4.5 }), 'okay');
    assert.equal(effectiveRecovery({ ...quiet, symptom_flags: ['Something hurts'] }), 'okay');
  });

  test('recovery is never revised upward', () => {
    assert.equal(effectiveRecovery(baseInput({
      recovery_state: 'poor', energy: 'high', sleep_hours: 9,
    })), 'poor');
  });

  test('recoveryFit penalises hard work more steeply than easy work', () => {
    const hard = TEMPLATES.find(t => t.intensity_target === 'RPE 7')!;
    const easy = TEMPLATES.find(t => t.intensity_target === 'RPE 2-3')!;
    assert.ok(recoveryFit(easy, 'poor') > recoveryFit(hard, 'poor'));
  });
});

describe('Stimulus urgency', () => {
  test('a satisfied requirement contributes nothing', () => {
    const t = TEMPLATES.find(x => x.stimulus === 'aerobic_base')!;
    assert.equal(stimulusUrgency(t, [
      { stimulus_type: 'aerobic_base', target_exposures: 2, completed_exposures: 2, priority: 1 },
    ]), 0);
  });

  test('an untouched high-priority requirement outranks a partly-served one', () => {
    const t = TEMPLATES.find(x => x.stimulus === 'aerobic_base')!;
    const untouched = stimulusUrgency(t, [
      { stimulus_type: 'aerobic_base', target_exposures: 2, completed_exposures: 0, priority: 1 },
    ]);
    const partial = stimulusUrgency(t, [
      { stimulus_type: 'aerobic_base', target_exposures: 2, completed_exposures: 1, priority: 1 },
    ]);
    assert.ok(untouched > partial);
  });
});

describe('Readiness (PRD §9.5)', () => {
  test('scores are whole numbers, never false precision', () => {
    const r = computeReadiness({
      aerobic_minutes_14d: 210, threshold_sessions_14d: 2, run_sessions_7d: 2,
      longest_run_km: 9, strength_completion_rate: 0.8, stations_covered_21d: 6,
      stimulus_adherence_4w: 0.75, recovery_signal: 0.6, observed_days: 25,
    });
    assert.equal(r.overall, Math.round(r.overall));
    for (const v of Object.values(r.components)) assert.equal(v, Math.round(v));
    assert.ok(r.overall >= 0 && r.overall <= 100);
  });

  test('confidence reflects how much was actually observed', () => {
    const base = {
      aerobic_minutes_14d: 100, threshold_sessions_14d: 1, run_sessions_7d: 1,
      longest_run_km: 5, strength_completion_rate: 0.5, stations_covered_21d: 3,
      stimulus_adherence_4w: 0.5, recovery_signal: 0.5,
    };
    assert.equal(computeReadiness({ ...base, observed_days: 3 }).confidence, 'low');
    assert.equal(computeReadiness({ ...base, observed_days: 14 }).confidence, 'medium');
    assert.equal(computeReadiness({ ...base, observed_days: 30 }).confidence, 'high');
  });

  test('an athlete with no history scores zero at low confidence', () => {
    const r = computeReadiness({
      aerobic_minutes_14d: 0, threshold_sessions_14d: 0, run_sessions_7d: 0,
      longest_run_km: 0, strength_completion_rate: 0, stations_covered_21d: 0,
      stimulus_adherence_4w: 0, recovery_signal: 0, observed_days: 0,
    });
    assert.equal(r.overall, 0);
    assert.equal(r.confidence, 'low');
  });
});

describe('Readiness renormalisation', () => {
  const base = {
    aerobic_minutes_14d: 300, threshold_sessions_14d: 4, run_sessions_7d: 3,
    longest_run_km: 12, strength_completion_rate: 0, stations_covered_21d: 0,
    stimulus_adherence_4w: 0, recovery_signal: 0, observed_days: 14,
  };

  test('an unobserved component neither drags the score down nor passes it', () => {
    const all = computeReadiness(base);
    const some = computeReadiness({
      ...base,
      observed: { aerobic: true, running: true },
    });
    assert.equal(all.overall, 40, 'counting the four unmeasured as zero');
    assert.equal(some.overall, 100, 'renormalised over what was measured');
    assert.deepEqual(some.observed, ['aerobic', 'running']);
  });

  test('a measured zero still counts against the score', () => {
    const r = computeReadiness({
      ...base,
      observed: { aerobic: true, running: true, strength: true },
    });
    // aerobic .2 + running .2 at full, strength .15 at zero -> .4/.55
    assert.equal(r.overall, 73);
  });

  test('an athlete with nothing measured has no score rather than a zero', () => {
    const r = computeReadiness({ ...base, observed: {} });
    assert.equal(r.overall, null);
    assert.deepEqual(r.observed, []);
    assert.equal(r.confidence, 'medium', 'confidence still reflects days seen');
  });

  test('omitting `observed` keeps every component in, as before', () => {
    assert.deepEqual(computeReadiness(base).observed,
      ['aerobic', 'running', 'strength', 'stations', 'consistency', 'recovery']);
  });
});

describe('Athlete override', () => {
  /** Depleted enough that the recovery guardrails bite. */
  const depleted = (over: Partial<EngineInput> = {}) => baseInput({
    recovery_state: 'poor',
    energy: 'low',
    sleep_hours: 4.5,
    ...over,
  });

  test('a severe symptom is not overridable', () => {
    // The one boundary the override must never cross. It is checked in
    // `recommend` before any guardrail reads the flag, so the flag cannot
    // reach it — this pins that ordering.
    const d = recommend(
      depleted({ symptom_flags: ['chest pain'], athlete_override: true }), EXERCISES);
    assert.equal(d.kind, 'no_session');
    assert.ok(d.kind === 'no_session' && d.guidance.length > 0,
      'the safety guidance still stands');
  });

  test('an override does not invent equipment', () => {
    // Equipment is not advice about how hard today should be, it is a
    // statement about what exists in the room.
    const d = recommend(
      depleted({ available_equipment: [], athlete_override: true }), EXERCISES);
    if (d.kind === 'session') {
      const ids = d.blocks.flatMap(b => b.exercises.map(e => e.exercise_id));
      const index = new Map(EXERCISES.map(e => [e.id, e]));
      for (const id of ids) {
        const equipment = index.get(id)?.equipment ?? [];
        assert.ok(
          equipment.length === 0 || equipment.includes('bodyweight'),
          `${id} needs equipment the athlete does not have`);
      }
    }
  });

  test('the intensity ceiling holds without an override', () => {
    const d = recommend(depleted(), EXERCISES);
    if (d.kind === 'session') {
      const peak = Math.max(
        ...(d.template.intensity_target ?? '').match(/\d+/g)?.map(Number) ?? [0]);
      assert.ok(peak <= 6, `poor recovery was handed RPE ${peak}`);
    }
  });

  test('an override lifts the ceiling it was asked about', () => {
    // The reported bug: an athlete assigned a reduced session who wants the
    // full one is told they are not allowed to. With the override they are.
    const hard = TEMPLATES.filter(t => {
      const nums = (t.intensity_target ?? '').match(/\d+/g)?.map(Number) ?? [];
      return nums.length > 0 && Math.max(...nums) > 6;
    });
    assert.ok(hard.length > 0, 'fixture has no session above the poor-recovery ceiling');

    const blocked = recommend(depleted({ candidates: hard }), EXERCISES);
    assert.equal(blocked.kind, 'no_session', 'precondition: this is refused normally');

    const allowed = recommend(
      depleted({ candidates: hard, athlete_override: true }), EXERCISES);
    assert.equal(allowed.kind, 'session', 'the override was not honoured');
  });

  test('an overridden decision says so in its reason codes', () => {
    const d = recommend(baseInput({ athlete_override: true }), EXERCISES);
    assert.equal(d.kind, 'session');
    assert.ok(d.kind === 'session' && d.reason_codes.includes('ATHLETE_OVERRIDE'),
      'an overridden session must be replayable as one');
  });

  test('no override, no code', () => {
    const d = recommend(baseInput(), EXERCISES);
    assert.ok(d.kind === 'session' && !d.reason_codes.includes('ATHLETE_OVERRIDE'));
  });
});
