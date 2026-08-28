/**
 * Minimal-equipment coverage gate.
 *
 * The dumbbell expansion spec asks for a QA acceptance test: simulate an
 * athlete whose equipment profile is exactly `Dumbbells=true`, and check the
 * planner has "multiple eligible candidates across every training phase and
 * time budget, without repeated dead-ends or pathological workout repetition".
 *
 * This is that test, expressed against the constraint path the engine actually
 * runs — `checkEligibility` + `eligibleVariants`, the same two calls
 * `recommend()` makes — rather than against a template's `required_equipment`
 * metadata, which the engine never reads.
 *
 * Two profiles are measured, because since 0009 running is equipment like
 * anything else:
 *
 *   `db`             dumbbells indoors, no treadmill and nowhere to run
 *   `db` + `outdoor` dumbbells and somewhere to run
 *
 * The first is the binding one. Every session it can reach, the second can too.
 *
 * ── On the floors ────────────────────────────────────────────────────────────
 *
 * A floor is not "some content exists", it is "enough content that a 16-week
 * block does not repeat itself". So it is derived from what the planner asks
 * for: BASE_STIMULI in periodization.ts requests aerobic_durability, threshold
 * and strength twice a week and race_specific and recovery once, and a stimulus
 * wanted twice a week needs more distinct sessions behind it than one wanted
 * once. Hence 6 and 3.
 *
 * Poor recovery is floored lower, at 2, and threshold and race_specific are
 * exempt from it entirely. That exemption is deliberate and load-bearing: the
 * intensity ceiling is *supposed* to exclude RPE 7+ work from a depleted
 * athlete, and a floor there would push authoring toward RPE 6 sessions labelled
 * "threshold" to satisfy a test — content shaped to a gate rather than to an
 * athlete. What must never be empty at poor recovery is the athlete's way out:
 * aerobic durability, strength and recovery.
 *
 * Family diversity is checked alongside the counts because six templates from
 * one family is one session retuned six times, which is the repetition the
 * spec asks to avoid, and a count on its own cannot see it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { recommend } from './index.ts';
import { checkEligibility, eligibleVariants, effectiveRecovery } from './guardrails.ts';
import { matchesStimulus } from './rank.ts';
import type {
  EngineInput, Exercise, RecoveryState, Substitution, WorkoutTemplate,
} from './types.ts';

const fixture = JSON.parse(readFileSync(
  new URL('../../../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));

const EXERCISES: Exercise[] = fixture.exercises;
const TEMPLATES: WorkoutTemplate[] = fixture.templates;
const SUBSTITUTIONS: Substitution[] = fixture.substitutions;

const EXERCISE_INDEX = new Map(EXERCISES.map(e =>
  [e.id, { equipment: e.equipment, impact_level: e.impact_level }]));

/** The five goals the planner ever asks for (BASE_STIMULI). */
const GOALS = ['aerobic_durability', 'threshold', 'strength', 'race_specific', 'recovery'] as const;
type Goal = typeof GOALS[number];

const RECOVERY_STATES: RecoveryState[] = ['good', 'okay', 'poor'];

/** Time budgets from the adapt sheet, in minutes. */
const TIME_BUDGETS = [20, 30, 45, 60];

const PROFILES = {
  'db': ['db'],
  'db + outdoor': ['db', 'outdoor'],
} as const;

/**
 * Distinct sessions a goal must have behind it, by how often the planner asks
 * for it. `null` means the cell is allowed to be empty — see the header.
 */
const FLOORS: Record<Goal, Record<RecoveryState, number | null>> = {
  aerobic_durability: { good: 6, okay: 6, poor: 2 },
  threshold:          { good: 6, okay: 6, poor: null },
  strength:           { good: 6, okay: 6, poor: 2 },
  race_specific:      { good: 3, okay: 3, poor: null },
  recovery:           { good: 3, okay: 3, poor: 2 },
};

/** Distinct families required wherever a count floor applies. */
const FAMILY_FLOOR = 2;

/** Eligible candidates a phase must offer, for any goal. */
const PHASE_FLOOR = 3;

function athlete(over: Partial<EngineInput> = {}): EngineInput {
  return {
    local_date: '2026-08-27',
    phase_type: 'build',
    days_to_race: 60,
    stimulus_requirements: [],
    recent_sessions: [],
    recovery_state: 'good',
    energy: 'normal',
    sleep_hours: 7.5,
    available_minutes: 60,
    available_equipment: ['db'],
    low_impact_required: false,
    symptom_flags: [],
    considerations: [],
    candidates: TEMPLATES,
    substitutions: SUBSTITUTIONS,
    ...over,
  };
}

/**
 * Templates the engine would actually consider — the goal it serves, the hard
 * constraints it clears, and at least one variant that fits the clock.
 */
function candidatesFor(input: EngineInput, goal?: Goal): WorkoutTemplate[] {
  const recovery = effectiveRecovery(input);
  return TEMPLATES.filter(t =>
    (goal === undefined || matchesStimulus(t, goal))
    && checkEligibility(t, input, EXERCISE_INDEX, recovery).eligible
    && eligibleVariants(t, input, recovery).length > 0);
}

const familiesOf = (ts: WorkoutTemplate[]) => new Set(ts.map(t => t.workout_family));

/** The whole matrix, printed on failure so a shortfall says where it is. */
function matrix(profile: keyof typeof PROFILES): string {
  const lines = [`  ${profile}:`];
  for (const recovery of RECOVERY_STATES) {
    lines.push(`    recovery=${recovery}`.padEnd(24)
      + TIME_BUDGETS.map(m => `${m}m`.padStart(6)).join(''));
    for (const goal of GOALS) {
      const counts = TIME_BUDGETS.map(minutes => candidatesFor(athlete({
        available_equipment: [...PROFILES[profile]],
        available_minutes: minutes,
        recovery_state: recovery,
      }), goal));
      const floor = FLOORS[goal][recovery];
      lines.push(`      ${goal.padEnd(20)}`
        + counts.map(c => String(c.length).padStart(6)).join('')
        + `   floor ${floor ?? '-'}`
        + `, families ${familiesOf(counts[counts.length - 1]).size}`);
    }
  }
  return lines.join('\n');
}

describe('dumbbell-only coverage (expansion spec, QA acceptance test)', () => {
  for (const [profile, equipment] of Object.entries(PROFILES)) {
    for (const recovery of RECOVERY_STATES) {
      for (const goal of GOALS) {
        const floor = FLOORS[goal][recovery];
        if (floor === null) continue;

        test(`${profile} · ${recovery} recovery · ${goal} · ${floor}+ sessions at every time budget`, () => {
          for (const minutes of TIME_BUDGETS) {
            const found = candidatesFor(athlete({
              available_equipment: [...equipment],
              available_minutes: minutes,
              recovery_state: recovery,
            }), goal);

            assert.ok(found.length >= floor,
              `${profile}, ${recovery} recovery, ${minutes} min: ${found.length} ${goal} `
              + `session(s), need ${floor}\n${matrix(profile as keyof typeof PROFILES)}`);

            assert.ok(familiesOf(found).size >= FAMILY_FLOOR,
              `${profile}, ${recovery} recovery, ${minutes} min: ${goal} coverage comes from `
              + `${familiesOf(found).size} family/families (${[...familiesOf(found)].join(', ')}), `
              + `need ${FAMILY_FLOOR} — that is one session retuned, not variety`);
          }
        });
      }
    }
  }

  /**
   * Taper is the cell that fails silently. `checkEligibility` narrows it to
   * recovery, micro and quality families, so a library whose dumbbell content
   * is all strength and density leaves the athlete with nothing in the week
   * that matters most — and every other phase looks fine.
   */
  test('every training phase offers candidates, taper included', () => {
    const phases: EngineInput['phase_type'][] =
      ['foundation', 'build', 'specific', 'peak', 'taper', 'race'];

    for (const [profile, equipment] of Object.entries(PROFILES)) {
      for (const phase_type of phases) {
        const found = candidatesFor(athlete({
          available_equipment: [...equipment],
          phase_type,
          days_to_race: phase_type === 'taper' ? 10 : 60,
        }));
        assert.ok(found.length >= PHASE_FLOOR,
          `${profile} in ${phase_type}: ${found.length} eligible session(s), need ${PHASE_FLOOR}`
          + (found.length ? ` — only ${[...familiesOf(found)].join(', ')}` : ' — dead end'));
      }
    }
  });

  /**
   * The spec's "pathological workout repetition".
   *
   * Walks a week the way the real loop does: each day's pick becomes history,
   * and satisfying a stimulus decrements what the week still wants, so demand
   * moves on rather than asking for the same thing seven times. Repetition that
   * survives that is the library's, not the simulation's.
   */
  test('a week of dumbbell-only training does not repeat the same session', () => {
    /** The base week (BASE_STIMULI), by goal. */
    const WEEKLY_TARGET: Record<Goal, { target: number; priority: number }> = {
      aerobic_durability: { target: 2, priority: 1 },
      threshold:          { target: 2, priority: 1 },
      strength:           { target: 2, priority: 2 },
      race_specific:      { target: 1, priority: 2 },
      recovery:           { target: 1, priority: 3 },
    };

    for (const [profile, equipment] of Object.entries(PROFILES)) {
      const completed: Record<string, number> = {};
      const history: (EngineInput['recent_sessions'][number] & { on_day: number })[] = [];
      const given: string[] = [];

      for (let day = 0; day < 7; day++) {
        const decision = recommend(athlete({
          available_equipment: [...equipment],
          recent_sessions: history.map(s => ({ ...s, days_ago: day - s.on_day })),
          stimulus_requirements: GOALS.map(stimulus_type => ({
            stimulus_type,
            target_exposures: WEEKLY_TARGET[stimulus_type].target,
            completed_exposures: completed[stimulus_type] ?? 0,
            priority: WEEKLY_TARGET[stimulus_type].priority,
          })),
        }), EXERCISES);

        if (decision.kind !== 'session') continue;

        const goal = decision.template.primary_goal;
        completed[goal] = (completed[goal] ?? 0) + 1;
        given.push(decision.template.id);
        history.push({
          template_id: decision.template.id,
          workout_family: decision.template.workout_family,
          primary_goal: goal,
          days_ago: 0,
          impact_level: decision.template.impact_level,
          session_rpe: 6,
          on_day: day,
        });
      }

      const distinct = new Set(given);
      assert.ok(given.length >= 5,
        `${profile}: only ${given.length} of 7 days produced a session`);
      assert.ok(distinct.size >= 4,
        `${profile}: 7 days produced ${distinct.size} distinct session(s) `
        + `(${[...distinct].join(', ')}) — the athlete is repeating`);
    }
  });
});
