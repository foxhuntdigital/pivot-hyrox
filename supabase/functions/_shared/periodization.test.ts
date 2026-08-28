/**
 * Periodization tests.
 *
 * The rules are extrapolated rather than specified (see periodization.ts), so
 * what is pinned here is the structure a plan must always have — contiguous
 * phases, an intact taper, a program that ends on race day — rather than the
 * particular week counts, which are expected to be tuned.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays, blockEndDate, clampBlockWeeks, daysBetween, MAX_BLOCK_WEEKS,
  MIN_BLOCK_WEEKS, planBlockPhases, planPhases, REFERENCE_WEEKS, stimuliFor,
  weeksUntil, type PhaseType,
} from './periodization.ts';

const START = '2026-01-01';

/** Race date that yields exactly `n` whole weeks of runway from START. */
function raceAfterWeeks(n: number): string {
  return addDays(START, n * 7 - 1);
}

describe('weeksUntil', () => {
  test('counts inclusive whole weeks', () => {
    assert.equal(weeksUntil(START, raceAfterWeeks(16)), 16);
    assert.equal(weeksUntil(START, raceAfterWeeks(1)), 1);
  });

  test('rounds a partial week up — a race 11 days out is two weeks of program', () => {
    assert.equal(weeksUntil(START, addDays(START, 10)), 2);
  });

  test('never returns less than one week', () => {
    assert.equal(weeksUntil(START, START), 1);
  });
});

describe('planPhases', () => {
  test('the reference split matches the 16-week seed programme', () => {
    // Guards the split against drifting out of step with athlete.ts, which the
    // rounding absorber would otherwise hide.
    assert.equal(REFERENCE_WEEKS, 16);
  });

  test('a 16-week runway reproduces the reference split unscaled', () => {
    const phases = planPhases(START, raceAfterWeeks(16));
    assert.deepEqual(
      phases.map(p => [p.phase_type, p.weeks]),
      [['foundation', 4], ['build', 5], ['specific', 3], ['peak', 2], ['taper', 1], ['race', 1]],
    );
  });

  test('week 7 falls in build, as the seed shows', () => {
    const phases = planPhases(START, raceAfterWeeks(16));
    let week = 0;
    for (const phase of phases) {
      if (week < 7 && 7 <= week + phase.weeks) {
        assert.equal(phase.phase_type, 'build');
        return;
      }
      week += phase.weeks;
    }
    assert.fail('week 7 fell outside every phase');
  });

  for (const total of [6, 8, 12, 16, 20, 24, 32, 52]) {
    test(`phase weeks sum to the runway (${total} weeks)`, () => {
      const phases = planPhases(START, raceAfterWeeks(total));
      assert.equal(phases.reduce((n, p) => n + p.weeks, 0), total);
    });

    test(`taper and race stay one week each (${total} weeks)`, () => {
      const phases = planPhases(START, raceAfterWeeks(total));
      assert.equal(phases.find(p => p.phase_type === 'taper')?.weeks, 1);
      assert.equal(phases.find(p => p.phase_type === 'race')?.weeks, 1);
    });

    test(`phases are contiguous with no gap or overlap (${total} weeks)`, () => {
      const phases = planPhases(START, raceAfterWeeks(total));
      for (let i = 1; i < phases.length; i++) {
        assert.equal(
          phases[i].start_date,
          addDays(phases[i - 1].end_date, 1),
          `phase ${i} does not start the day after phase ${i - 1} ends`,
        );
      }
    });

    test(`the program ends on race day (${total} weeks)`, () => {
      const race = raceAfterWeeks(total);
      const phases = planPhases(START, race);
      assert.equal(phases[phases.length - 1].end_date, race);
    });

    test(`phase_order is dense and ascending from 1 (${total} weeks)`, () => {
      const phases = planPhases(START, raceAfterWeeks(total));
      assert.deepEqual(
        phases.map(p => p.phase_order),
        phases.map((_, i) => i + 1),
      );
    });
  }

  test('a long runway does not spend it all in foundation', () => {
    const phases = planPhases(START, raceAfterWeeks(52));
    const foundation = phases.find(p => p.phase_type === 'foundation')!;
    // Proportional scaling, not "everything extra goes to the front".
    assert.ok(foundation.weeks < 52 / 2, `foundation took ${foundation.weeks} of 52 weeks`);
  });

  test('a short runway drops early phases rather than shrinking every phase', () => {
    const phases = planPhases(START, raceAfterWeeks(3));
    const types = phases.map(p => p.phase_type);
    assert.ok(!types.includes('foundation'), 'three weeks out is not a foundation block');
    assert.ok(types.includes('taper'), 'taper survives a short runway');
    assert.ok(types.includes('race'), 'race week survives a short runway');
  });

  test('a one-week runway is race week alone', () => {
    const phases = planPhases(START, raceAfterWeeks(1));
    assert.deepEqual(phases.map(p => p.phase_type), ['race']);
    assert.equal(phases[0].end_date, raceAfterWeeks(1));
  });

  test('every phase has at least one week', () => {
    for (const total of [6, 7, 9, 13, 17, 23]) {
      for (const phase of planPhases(START, raceAfterWeeks(total))) {
        assert.ok(phase.weeks >= 1, `${phase.phase_type} got ${phase.weeks} weeks at ${total}`);
      }
    }
  });
});

describe('stimuliFor', () => {
  test('a build week is the base five stimuli', () => {
    const stimuli = stimuliFor('build');
    assert.equal(stimuli.length, 5);
    assert.equal(stimuli.find(s => s.stimulus_type === 'threshold')?.target_exposures, 2);
  });

  test('foundation trades race-specific work for aerobic volume', () => {
    const stimuli = stimuliFor('foundation');
    assert.equal(stimuli.find(s => s.stimulus_type === 'race_specific'), undefined);
    assert.equal(stimuli.find(s => s.stimulus_type === 'aerobic_durability')?.target_exposures, 3);
  });

  test('zero-target stimuli are omitted rather than written as unmeetable rows', () => {
    for (const phase of ['foundation', 'race'] as PhaseType[]) {
      for (const s of stimuliFor(phase)) {
        assert.ok(s.target_exposures > 0, `${phase}.${s.stimulus_type} has a zero target`);
      }
    }
  });

  test('race week asks for almost nothing', () => {
    const stimuli = stimuliFor('race');
    const total = stimuli.reduce((n, s) => n + s.target_exposures, 0);
    const build = stimuliFor('build').reduce((n, s) => n + s.target_exposures, 0);
    assert.ok(total < build, 'race week should be lighter than a build week');
    assert.equal(stimuli.find(s => s.stimulus_type === 'strength'), undefined);
  });

  test('every phase produces at least one stimulus', () => {
    const phases: PhaseType[] = ['foundation', 'build', 'specific', 'peak', 'taper', 'race'];
    for (const phase of phases) {
      assert.ok(stimuliFor(phase).length > 0, `${phase} produced no stimuli`);
    }
  });
});

describe('date helpers', () => {
  test('daysBetween is inclusive of neither end', () => {
    assert.equal(daysBetween('2026-01-01', '2026-01-08'), 7);
    assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0);
  });

  test('addDays crosses month and year boundaries', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  test('addDays handles a leap day', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  });
});

describe('planBlockPhases', () => {
  test('a block has no taper and no race week', () => {
    // The whole point of the split: a taper is a taper for something, and a
    // race week with no race is a week of training the athlete did not lose.
    for (let weeks = MIN_BLOCK_WEEKS; weeks <= MAX_BLOCK_WEEKS; weeks++) {
      const types = planBlockPhases(START, weeks).map(p => p.phase_type);
      assert.ok(!types.includes('taper'), `taper appeared in a ${weeks}-week block`);
      assert.ok(!types.includes('race'), `race week appeared in a ${weeks}-week block`);
    }
  });

  test('a ten-week block scales the reference proportions', () => {
    assert.deepEqual(
      planBlockPhases(START, 10).map(p => [p.phase_type, p.weeks]),
      [['foundation', 3], ['build', 4], ['specific', 2], ['peak', 1]],
    );
  });

  test('the weeks add up to the length asked for', () => {
    for (let weeks = MIN_BLOCK_WEEKS; weeks <= MAX_BLOCK_WEEKS; weeks++) {
      const phases = planBlockPhases(START, weeks);
      assert.equal(phases.reduce((n, p) => n + p.weeks, 0), weeks, `${weeks}-week block`);
    }
  });

  test('every phase keeps at least one week at every length', () => {
    for (let weeks = MIN_BLOCK_WEEKS; weeks <= MAX_BLOCK_WEEKS; weeks++) {
      for (const phase of planBlockPhases(START, weeks)) {
        assert.ok(phase.weeks >= 1, `${phase.phase_type} got ${phase.weeks} at ${weeks}`);
      }
    }
  });

  test('phases are contiguous and the block ends on its last day', () => {
    const weeks = 12;
    const phases = planBlockPhases(START, weeks);
    assert.equal(phases[0].start_date, START);
    for (let i = 1; i < phases.length; i++) {
      assert.equal(phases[i].start_date, addDays(phases[i - 1].end_date, 1),
        `gap before ${phases[i].phase_type}`);
    }
    assert.equal(phases[phases.length - 1].end_date, blockEndDate(START, weeks));
    // Unlike a race plan, the last date is a week boundary — there is no event
    // to cut the final week short.
    assert.equal(blockEndDate(START, weeks), addDays(START, weeks * 7 - 1));
  });

  test('a length outside the allowed range is clamped, not rejected', () => {
    assert.equal(clampBlockWeeks(1), MIN_BLOCK_WEEKS);
    assert.equal(clampBlockWeeks(0), MIN_BLOCK_WEEKS);
    assert.equal(clampBlockWeeks(-4), MIN_BLOCK_WEEKS);
    assert.equal(clampBlockWeeks(52), MAX_BLOCK_WEEKS);
    assert.equal(clampBlockWeeks(10.4), 10);
    assert.equal(clampBlockWeeks(Number.NaN), MIN_BLOCK_WEEKS);
  });

  test('the shortest block still gives every phase a week', () => {
    assert.deepEqual(
      planBlockPhases(START, MIN_BLOCK_WEEKS).map(p => [p.phase_type, p.weeks]),
      [['foundation', 1], ['build', 1], ['specific', 1], ['peak', 1]],
    );
  });
});
