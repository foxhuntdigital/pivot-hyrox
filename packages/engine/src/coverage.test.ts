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

/** The full exercise record, for the ontology the eligibility index drops. */
const EXERCISE_BY_ID = new Map(EXERCISES.map(e => [e.id, e]));

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

/**
 * True-strength coverage gate.
 *
 * The gate above already demands six distinct `strength` sessions for a
 * dumbbell athlete, and it passes. It passes because `matchesStimulus` reads
 * `primary_goal`, and twenty-one of the twenty-five templates carrying
 * `primary_goal = 'strength'` are sled pushes, erg intervals, hill repeats and
 * carries. The library says the week's two strength exposures are covered. What
 * the athlete is handed is *Burpee Broad Jump — Strength-Power*.
 *
 * So this is the same floor asked honestly. Nothing here is a new standard: it
 * reuses FLOORS.strength, because the argument for six has not changed — the
 * planner asks for strength twice a week (BASE_STIMULI) and a twice-weekly
 * stimulus needs six distinct sessions behind it not to repeat across a block.
 *
 * ── Why the test is structural and not a label ────────────────────────────────
 *
 * `isTrueStrength` does not ask what a template is *called*. It asks whether it
 * prescribes working sets with deliberate rest between them — `sets` and
 * `rest_seconds` on a block exercise (migration 0011). That is the PRD's own
 * definition of true strength, and making the gate structural is what stops the
 * cheapest possible fix from working: relabelling a metcon `training_domain =
 * 'strength'` moves it no closer to passing, because it still has no sets and
 * no rest. To satisfy this gate a session has to actually be one.
 *
 * ── This gate ships red, and that is the point ────────────────────────────────
 *
 * Today it reports zero for every profile. Four templates in the library are
 * true strength (HYROX Legs A/B, Push A, Pull A), none of them reachable
 * without a barbell, and none yet carrying a structured prescription. Red here
 * is the honest reading of the library, and it is the release gate for the one
 * line in rank.ts that switches `matchesStimulus` from `primary_goal` to
 * `training_domain`. Flipping that while this is red would take the week's two
 * strength exposures from a library of four — zero for a dumbbell athlete — and
 * `today` would start returning no_session for strength.
 *
 * Green means the flip is safe. Nothing else does.
 */
describe('true strength coverage (the gate on reclassification)', () => {
  /**
   * Equipment an athlete plausibly has, from least to most. `db` is the binding
   * case, as above. The barbell profile is a real strength gym and deliberately
   * carries no HYROX kit — a squat rack is not a sandbag, and a library that
   * only reaches its strength content through station equipment has not solved
   * strength.
   */
  const STRENGTH_PROFILES = {
    'db': ['db'],
    'db + bench': ['db', 'bench', 'outdoor'],
    'barbell gym': ['barbell', 'rack', 'db', 'bench', 'rig', 'cable', 'bands', 'kb', 'box'],
  } as const;

  /**
   * Resistance work organised around working sets with deliberate recovery
   * between them.
   *
   * The domain check reads `training_domain` and falls back to `primary_goal`,
   * so the gate measures the same thing before and after the taxonomy pass and
   * cannot quietly change meaning underneath the flip it guards.
   */
  function isTrueStrength(t: WorkoutTemplate): boolean {
    const domain = t.training_domain ?? t.primary_goal;
    if (domain !== 'strength') return false;
    return prescribesWorkingSets(t) && containsAnchor(t);
  }

  /** Working sets with deliberate recovery between them. */
  function prescribesWorkingSets(t: WorkoutTemplate): boolean {
    return t.blocks.some(b => b.exercises.some(e =>
      e.sets != null && e.sets > 0 && e.rest_seconds != null));
  }

  /**
   * At least one stable, repeatable movement (addendum §15).
   *
   * Working sets alone are not enough. A thruster circuit written as 4 x 8 with
   * two minutes rest satisfies the structural test and is still not a session
   * anyone can progressively overload and measure across a block — thrusters
   * are `variable_complex`, and their progression is density and output, not a
   * heavier bar. Without this clause the gate could be passed by exactly the
   * kind of content the addendum exists to keep out of the strength count.
   */
  function containsAnchor(t: WorkoutTemplate): boolean {
    return t.blocks.some(b => b.exercises.some(e => {
      const cls = EXERCISE_BY_ID.get(e.exercise_id)?.progression_class;
      return cls === 'anchor' || cls === 'accessory_anchor';
    }));
  }

  /** What the library holds, printed on failure so a shortfall says where it is. */
  function inventory(): string {
    const domainStrength = TEMPLATES.filter(t =>
      (t.training_domain ?? t.primary_goal) === 'strength');
    const structured = domainStrength.filter(isTrueStrength);
    const lines = [
      `  library: ${TEMPLATES.length} templates`,
      `    claim the strength domain : ${domainStrength.length}`,
      `    prescribe sets + rest     : ${structured.length}`,
    ];
    if (structured.length) {
      lines.push(`    families: ${[...familiesOf(structured)].sort().join(', ')}`);
    }
    const unstructured = domainStrength.filter(t => !isTrueStrength(t));
    if (unstructured.length) {
      lines.push(`    claiming strength without working sets (${unstructured.length}):`);
      for (const t of unstructured.slice(0, 8)) {
        lines.push(`      ${t.workout_family.padEnd(28)} ${t.name}`);
      }
      if (unstructured.length > 8) lines.push(`      … and ${unstructured.length - 8} more`);
    }
    return lines.join('\n');
  }

  function trueStrengthFor(equipment: string[], minutes: number, recovery: RecoveryState) {
    return candidatesFor(athlete({
      available_equipment: [...equipment],
      available_minutes: minutes,
      recovery_state: recovery,
    })).filter(isTrueStrength);
  }

  for (const [profile, equipment] of Object.entries(STRENGTH_PROFILES)) {
    for (const recovery of RECOVERY_STATES) {
      const floor = FLOORS.strength[recovery];
      if (floor === null) continue;

      test(`${profile} · ${recovery} recovery · ${floor}+ true-strength sessions at every time budget`, () => {
        for (const minutes of TIME_BUDGETS) {
          const found = trueStrengthFor([...equipment], minutes, recovery);

          assert.ok(found.length >= floor,
            `${profile}, ${recovery} recovery, ${minutes} min: ${found.length} true-strength `
            + `session(s), need ${floor}\n${inventory()}`);

          /**
           * WATCH: the poor-recovery lane is the thin one.
           *
           * It cleared this by exactly nothing until the taper micros were
           * authored into true strength, which added `micro` as a third RPE<=6
           * family beside strength_maintenance_lower and _upper. Three against
           * a floor of two is a margin of one, and a single point of failure in
           * readiness coverage is the one place an athlete has no way out — so
           * any reclassification, deprecation, equipment restriction or
           * substitution collapse touching those three families should be
           * measured here before it lands.
           * Numbers in data/review/reclassification-delta.json.
           */
          assert.ok(familiesOf(found).size >= FAMILY_FLOOR,
            `${profile}, ${recovery} recovery, ${minutes} min: true strength comes from `
            + `${familiesOf(found).size} family/families (${[...familiesOf(found)].join(', ')}), `
            + `need ${FAMILY_FLOOR} — one session retuned is not a strength programme`);
        }
      });
    }
  }

  /**
   * The claim the reclassification actually makes.
   *
   * Every template asserting the strength domain must prescribe working sets.
   * This is the test that fails loudly if a future authoring pass takes the
   * shortcut of relabelling conditioning rather than writing strength.
   */
  test('nothing claims the strength domain without prescribing working sets', () => {
    const liars = TEMPLATES
      .filter(t => (t.training_domain ?? t.primary_goal) === 'strength')
      .filter(t => !isTrueStrength(t));

    assert.equal(liars.length, 0,
      `${liars.length} template(s) claim strength but prescribe no working sets `
      + `with rest — holding weights is not strength\n${inventory()}`);
  });

  /**
   * A dumbbell athlete must be able to train strength at all.
   *
   * Separated from the floors because it fails differently: a floor shortfall
   * says the library is thin, this says the athlete has no way in. Today it is
   * zero — every true-strength template opens with a barbell lift, and
   * checkEligibility drops the whole template when one exercise cannot be
   * satisfied, so `ex_back_squat` alone rules out HYROX Legs A. Authoring more
   * barbell sessions does not move this number; dumbbell-native templates or
   * substitution edges do.
   */
  test('a dumbbell athlete has some way into strength', () => {
    const found = trueStrengthFor(['db'], 60, 'good');
    assert.ok(found.length > 0,
      'a dumbbell-only athlete can reach no true-strength session at all — '
      + 'checkEligibility drops a template when a single exercise is unsatisfiable, '
      + `so a barbell opener rules out the whole session\n${inventory()}`);
  });
});

/**
 * Library QA reports (Strength & Athletic Development addendum §18).
 *
 * These are not floors on a single stimulus — they describe the shape of the
 * library as a whole, and each one names a way a strength library can look
 * complete while being unusable.
 *
 * They are reports first and assertions second, because most of what they
 * measure is authoring judgement rather than a number the engine can defend.
 * Where a real failure mode has a clear line, it is asserted; where it does
 * not, the numbers are printed so an authoring pass can see them.
 */
describe('strength library QA (addendum §18)', () => {
  const ANCHOR_CLASSES = new Set(['anchor', 'accessory_anchor']);

  const anchors = EXERCISES.filter(e => ANCHOR_CLASSES.has(e.progression_class ?? ''));

  /** Every equipment profile QA has to answer for. */
  const QA_PROFILES = {
    'db only': ['db'],
    'db + bench + outdoor': ['db', 'bench', 'outdoor'],
    'strength gym': ['barbell', 'rack', 'db', 'bench', 'rig', 'cable', 'bands', 'kb', 'box'],
    'minimal / bodyweight': [],
  } as const;

  const satisfiedBy = (e: WorkoutTemplate['blocks'][number]['exercises'][number] | { equipment: string[] }, have: Set<string>) =>
    !('equipment' in e) || e.equipment.length === 0 || e.equipment.some(q => have.has(q));

  test('report: primary-anchor eligibility by equipment profile', () => {
    const lines: string[] = [];
    for (const [profile, equipment] of Object.entries(QA_PROFILES)) {
      const have = new Set<string>([...equipment, 'bodyweight']);
      const reachable = anchors.filter(a => satisfiedBy(a, have));
      const families = new Set(reachable.flatMap(a => a.movement_families ?? []));
      lines.push(`  ${profile.padEnd(22)} ${String(reachable.length).padStart(3)} anchors`
        + `  across ${families.size} movement families`);
    }
    console.log(`\nanchor eligibility (${anchors.length} anchors in the library):\n${lines.join('\n')}`);

    // The one hard line: an athlete with dumbbells must be able to reach an
    // anchor in each of the primary patterns, or "progressive overload" is a
    // claim the library cannot honour for them.
    const have = new Set(['db', 'bodyweight']);
    const reachable = anchors.filter(a => satisfiedBy(a, have));
    const families = new Set(reachable.flatMap(a => a.movement_families ?? []));
    for (const required of ['squat', 'hinge', 'horizontal_push', 'horizontal_pull']) {
      assert.ok(families.has(required),
        `a dumbbell athlete can reach no anchor in the ${required} pattern — `
        + `reachable families: ${[...families].sort().join(', ') || 'none'}`);
    }
  });

  test('report: movement-family coverage, and overconcentration', () => {
    const byFamily: Record<string, number> = {};
    for (const e of anchors) {
      for (const f of e.movement_families ?? []) byFamily[f] = (byFamily[f] ?? 0) + 1;
    }
    const rows = Object.entries(byFamily).sort((a, b) => b[1] - a[1]);
    console.log(`\nanchor coverage by movement family:\n`
      + rows.map(([f, n]) => `  ${String(n).padStart(3)}  ${f}`).join('\n'));

    // Overconcentration: a library that is mostly squats and hinges reads as
    // broad on a count and trains one half of the body.
    const total = rows.reduce((n, [, c]) => n + c, 0);
    const top = rows[0];
    if (total >= 8 && top) {
      assert.ok(top[1] / total <= 0.5,
        `${top[1]} of ${total} anchors are ${top[0]} — one pattern is over half the library`);
    }

    // The addendum's own required patterns (§4). Reported rather than asserted
    // while the catalogue is still being authored; the assertion above is the
    // one that has to hold today.
    const REQUIRED = ['squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push',
      'horizontal_pull', 'vertical_pull', 'carry'];
    const missing = REQUIRED.filter(f => !byFamily[f]);
    if (missing.length) {
      console.log(`  → no anchor yet for: ${missing.join(', ')}`);
    }
  });

  test('report: progression-class distribution', () => {
    const byClass: Record<string, number> = {};
    for (const e of EXERCISES) {
      byClass[e.progression_class ?? 'not governed'] =
        (byClass[e.progression_class ?? 'not governed'] ?? 0) + 1;
    }
    console.log(`\nprogression class (${EXERCISES.length} exercises):\n`
      + Object.entries(byClass).sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `  ${String(n).padStart(3)}  ${c}`).join('\n'));

    /**
     * Complexity must not be standing in for progressive overload. A library
     * whose strength movements are mostly variable_complex has plenty to do
     * and nothing to measure.
     *
     * Counted over BOTH anchor classes, matching ANCHOR_CLASSES above. An
     * accessory anchor is progressively overloadable by definition — that is
     * what separates it from a developmental movement; what it carries less of
     * is weight in capability inference, which is a different question from
     * whether the library can measure progress at all. Counting only `anchor`
     * understated the library by the entire bodybuilding block.
     */
    const anchorCount = (byClass.anchor ?? 0) + (byClass.accessory_anchor ?? 0);
    const complexCount = byClass.variable_complex ?? 0;
    assert.ok(anchorCount >= complexCount,
      `${complexCount} variable/complex movements against ${anchorCount} progressively `
      + 'overloadable ones (anchor + accessory_anchor) — complexity is substituting '
      + 'for progressive overload');
  });

  /**
   * Every ontology field an exercise needs to be programmable.
   *
   * A movement with no progression class either gets no progression or gets
   * load-and-reps by default, and load-and-reps on a box jump is how a
   * plyometric ladder becomes an injury. Cardio and mobility are exempt: they
   * progress through the running and readiness paths, and null there means
   * "not governed by strength progression" rather than "unclassified".
   */
  test('every strength-relevant exercise carries a progression class', () => {
    // A movement that can only ever be a primer is exempt. Breathing and
    // activation work is trunk work — it earns its movement family — but it is
    // prescribed to prepare for the session, not to be overloaded across a
    // block, and inventing a progression track for it would put a number
    // behind something nobody intends to progress.
    const primerOnly = (e: Exercise) => {
      const roles = e.exercise_role_eligibility ?? [];
      return roles.length > 0 && roles.every(r => r === 'primer');
    };

    const unclassified = EXERCISES.filter(e =>
      (e.movement_families?.length ?? 0) > 0 && !e.progression_class && !primerOnly(e));

    assert.deepEqual(unclassified.map(e => e.id), [],
      'these movements have a movement family but no progression class, so the '
      + 'progression service has no rule to apply to them');
  });

  test('an anchor always has something to progress on', () => {
    const broken = anchors.filter(a =>
      (a.progression_tracks?.length ?? 0) === 0 || a.progression_tracks?.includes('none'));
    assert.deepEqual(broken.map(a => a.id), [],
      'an anchor exists to be progressed and measured; one with no track is a contradiction');
  });

  /**
   * Prescription roles must be roles the movement can actually hold (§6).
   *
   * The eligibility list is the guard against a library that quietly promotes a
   * finisher into a primary lift to fill a gap in the week.
   */
  test('no session gives a movement a role it is not eligible for', () => {
    const violations: string[] = [];
    for (const t of TEMPLATES) {
      for (const b of t.blocks) {
        for (const e of b.exercises) {
          if (!e.exercise_role) continue;
          const eligible = EXERCISE_BY_ID.get(e.exercise_id)?.exercise_role_eligibility ?? [];
          if (!eligible.includes(e.exercise_role)) {
            violations.push(`${t.id}: ${e.exercise_id} as ${e.exercise_role} `
              + `(eligible: ${eligible.join(', ') || 'none'})`);
          }
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});
