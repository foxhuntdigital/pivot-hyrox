/**
 * POST /v1/onboarding/plan — create the athlete baseline and initial program
 * (PRD §12, §6.1 steps 3-9).
 *
 * This is the only writer of `races`, `programs`, `program_phases`,
 * `weekly_cycles` and `stimulus_requirements`. Onboarding calls it once; a
 * later change to race date or division calls it again, and the existing
 * program is superseded rather than mutated — `programs.version` exists for
 * exactly that (PRD §20). Completed sessions keep pointing at the version they
 * were performed under, so history survives a replan.
 *
 * Session queue items are deliberately not written here: the engine chooses
 * what to do each day from the stimulus requirements, and a pre-baked queue
 * would be stale by the second day.
 */
import {
  clientFor, corsHeaders, HttpError, json, loadContent, requireEntitlement, requireUser, localDate,
} from '../_shared/context.ts';
import { ensureWeekQueue } from '../_shared/queue.ts';
import {
  blockEndDate, clampBlockWeeks, MAX_BLOCK_WEEKS, MIN_BLOCK_WEEKS, planBlockPhases,
  planPhases, stimuliFor, weeksUntil, type PhaseType,
} from '../_shared/periodization.ts';

interface PlanRequest {
  /** A plan counted back from an event. Mutually exclusive with `block`. */
  race?: {
    event_name: string;
    event_date: string;
    division?: string | null;
    goal_type?: 'finish_healthy' | 'performance' | 'custom';
    goal_value?: string | null;
  } | null;
  /**
   * A plan for an athlete with nothing entered: a fixed number of weeks instead
   * of a date to count back from. Deliberately not open-ended — every phase
   * length in this program is a proportion of the runway, so a plan with no end
   * has no phases to speak of.
   */
  block?: { weeks: number } | null;
  equipment?: string[];
  profile?: {
    typical_session_minutes?: number;
    schedule_predictability?: number;
    impact_tolerance?: 'low' | 'normal' | 'high';
    considerations?: string[];
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const db = clientFor(req);
    const user = await requireUser(db);
    await requireEntitlement(db, user.id);
    const today = localDate(user.timezone);

    const body = await req.json().catch(() => null) as PlanRequest | null;
    const race = body?.race ?? null;
    const block = body?.block ?? null;

    // Exactly one. Both would leave the program's end date ambiguous, and the
    // caller has certainly not decided which it meant.
    if (!race && !block) throw new HttpError(400, 'Either race or block is required');
    if (race && block) throw new HttpError(400, 'Send race or block, not both');

    if (race) {
      if (!race.event_name?.trim()) throw new HttpError(400, 'race.event_name is required');
      if (!race.event_date || !ISO_DATE.test(race.event_date)) {
        throw new HttpError(400, 'race.event_date must be an ISO date (YYYY-MM-DD)');
      }
      if (race.event_date < today) {
        throw new HttpError(400, 'race.event_date is in the past');
      }
    }

    // Rejected rather than clamped: the client offers a fixed set of lengths,
    // so a value outside the range is a bug worth surfacing, not a preference
    // worth quietly rewriting.
    if (block) {
      if (typeof block.weeks !== 'number' || !Number.isFinite(block.weeks)) {
        throw new HttpError(400, 'block.weeks must be a number');
      }
      if (block.weeks < MIN_BLOCK_WEEKS || block.weeks > MAX_BLOCK_WEEKS) {
        throw new HttpError(400,
          `block.weeks must be between ${MIN_BLOCK_WEEKS} and ${MAX_BLOCK_WEEKS}`);
      }
    }

    // Profile fields that shape the plan are saved before generating from them,
    // so a retry after a failure generates from the same inputs.
    if (body?.profile) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.profile.typical_session_minutes != null) {
        patch.typical_session_minutes = body.profile.typical_session_minutes;
      }
      if (body.profile.schedule_predictability != null) {
        const p = body.profile.schedule_predictability;
        // The column has a 0–1 check constraint; rejecting here names the field
        // instead of surfacing a constraint violation as "could not save".
        if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
          throw new HttpError(400, 'profile.schedule_predictability must be between 0 and 1');
        }
        patch.schedule_predictability = p;
      }
      if (body.profile.impact_tolerance) patch.impact_tolerance = body.profile.impact_tolerance;
      if (body.profile.considerations) patch.considerations = body.profile.considerations;

      const { error } = await db.from('athlete_profiles')
        .update(patch).eq('user_id', user.id);
      if (error) throw new HttpError(500, `Could not save profile: ${error.message}`);
    }

    // One active race at a time. An earlier one is archived rather than deleted
    // so its completed sessions keep a race to belong to.
    const { data: existingRace } = await db.from('races')
      .select('id').eq('user_id', user.id).eq('status', 'active').maybeSingle();

    let raceId: string | null = null;
    if (!race) {
      // Switching to a block retires the race rather than leaving it active.
      // Today reads the active race for its countdown independently of the
      // program, so a race left behind here would head a plan that was not
      // built for it — a date counting down to nothing.
      if (existingRace) {
        const { error } = await db.from('races')
          .update({ status: 'archived' }).eq('id', existingRace.id);
        if (error) throw new HttpError(500, `Could not archive race: ${error.message}`);
      }
    } else if (existingRace) {
      const { error } = await db.from('races').update({
        event_name: race.event_name.trim(),
        event_date: race.event_date,
        division: race.division ?? null,
        goal_type: race.goal_type ?? 'performance',
        goal_value: race.goal_value ?? null,
      }).eq('id', existingRace.id);
      if (error) throw new HttpError(500, `Could not update race: ${error.message}`);
      raceId = existingRace.id;
    } else if (race) {
      const { data, error } = await db.from('races').insert({
        user_id: user.id,
        event_name: race.event_name.trim(),
        event_date: race.event_date,
        division: race.division ?? null,
        goal_type: race.goal_type ?? 'performance',
        goal_value: race.goal_value ?? null,
        status: 'active',
      }).select('id').single();
      if (error || !data) throw new HttpError(500, `Could not create race: ${error?.message}`);
      raceId = data.id;
    }

    if (body?.equipment) await saveEquipment(db, user.id, body.equipment);

    // Supersede whatever the athlete was on and take the next version, so the
    // new plan is additive and the old one stays readable.
    //
    // Both the version sequence and the supersede are scoped to the athlete
    // rather than to the race. Scoped to the race, a block (race_id null) would
    // start its own sequence at version 1 and leave the race program active
    // beside it — two active plans, and no rule for which one Today follows.
    const { data: priorPrograms } = await db.from('programs')
      .select('id, version').eq('user_id', user.id)
      .order('version', { ascending: false });

    const nextVersion = (priorPrograms?.[0]?.version ?? 0) + 1;
    if (priorPrograms?.length) {
      const { error } = await db.from('programs')
        .update({ status: 'superseded' })
        .eq('user_id', user.id).eq('status', 'active');
      if (error) throw new HttpError(500, `Could not supersede program: ${error.message}`);
    }

    const totalWeeks = race
      ? weeksUntil(today, race.event_date)
      : clampBlockWeeks(block!.weeks);
    const endDate = race ? race.event_date : blockEndDate(today, block!.weeks);
    const phases = race
      ? planPhases(today, race.event_date)
      : planBlockPhases(today, block!.weeks);

    const { data: program, error: programError } = await db.from('programs').insert({
      user_id: user.id,
      race_id: raceId,
      version: nextVersion,
      start_date: today,
      end_date: endDate,
      status: 'active',
    }).select('id').single();
    if (programError || !program) {
      throw new HttpError(500, `Could not create program: ${programError?.message}`);
    }

    // Phases, then their weeks, then each week's stimulus targets. Written in
    // that order because each level references the one above it.
    const { data: phaseRows, error: phaseError } = await db.from('program_phases').insert(
      phases.map(p => ({
        program_id: program.id,
        phase_type: p.phase_type,
        phase_order: p.phase_order,
        start_date: p.start_date,
        end_date: p.end_date,
      })),
    ).select('id, phase_type, phase_order');
    if (phaseError || !phaseRows) {
      throw new HttpError(500, `Could not create phases: ${phaseError?.message}`);
    }

    // `week_index` is the week's position **within its phase**, restarting at 1
    // for each one. That is what `_shared/context.ts` reads it as — it offsets
    // the phase's own start date by it to find the current week's window — and
    // a program-wide counter here put that window weeks into the future and
    // double-counted the program week on top of it.
    const byOrder = new Map(phaseRows.map(r => [r.phase_order, r]));
    const cycleRows: { phase_id: string; week_index: number; status: string }[] = [];
    let programWeek = 1;
    for (const phase of phases) {
      const row = byOrder.get(phase.phase_order)!;
      for (let w = 0; w < phase.weeks; w++) {
        cycleRows.push({
          phase_id: row.id,
          week_index: w + 1,
          // The first week of the program is live immediately; the rest wait
          // their turn. Nothing advances this later — the current week is
          // derived from the calendar — so it is a starting state, not a
          // cursor.
          status: programWeek === 1 ? 'active' : 'pending',
        });
        programWeek++;
      }
    }

    const { data: cycles, error: cycleError } = await db.from('weekly_cycles')
      .insert(cycleRows).select('id, phase_id, week_index');
    if (cycleError || !cycles) {
      throw new HttpError(500, `Could not create weekly cycles: ${cycleError?.message}`);
    }

    const phaseTypeById = new Map(phaseRows.map(r => [r.id, r.phase_type]));
    const requirements = cycles.flatMap(cycle =>
      stimuliFor(phaseTypeById.get(cycle.phase_id) as PhaseType).map(s => ({
        weekly_cycle_id: cycle.id,
        stimulus_type: s.stimulus_type,
        target_exposures: s.target_exposures,
        priority: s.priority,
      })),
    );

    const { error: reqError } = await db.from('stimulus_requirements').insert(requirements);
    if (reqError) {
      throw new HttpError(500, `Could not create stimulus requirements: ${reqError.message}`);
    }

    // Week 1 of the *first phase*. Now that week_index restarts per phase, a
    // bare `week_index === 1` matches once per phase, and which of those a
    // `.find` returns is an accident of insertion order.
    const firstPhase = phases[0];
    const firstPhaseId = byOrder.get(firstPhase.phase_order)?.id;
    const firstWeek = cycles.find(c => c.phase_id === firstPhaseId && c.week_index === 1);

    // The first week gets its sessions now, so the summary the athlete sees and
    // the Plan tab they open next both have a week in them rather than a set of
    // targets with nothing against them.
    await planFirstWeek(db, firstWeek, firstPhase, body, today);
    return json({
      program_id: program.id,
      version: nextVersion,
      race: race && raceId
        ? { id: raceId, event_name: race.event_name.trim(), event_date: race.event_date }
        : null,
      // Present for both kinds of plan, so a caller that only wants to say how
      // long the program is does not have to know which kind it got.
      block: race ? null : { weeks: totalWeeks, end_date: endDate },
      total_weeks: totalWeeks,
      phases: phases.map(p => ({
        phase_type: p.phase_type,
        phase_order: p.phase_order,
        start_date: p.start_date,
        end_date: p.end_date,
        weeks: p.weeks,
      })),
      current_phase: firstPhase && {
        phase_type: firstPhase.phase_type,
        week: 1,
        total_weeks: firstPhase.weeks,
      },
      first_week_stimuli: firstWeek
        ? requirements
            .filter(r => r.weekly_cycle_id === firstWeek.id)
            .map(({ stimulus_type, target_exposures, priority }) =>
              ({ stimulus_type, target_exposures, priority }))
        : [],
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});

/**
 * Replaces the default equipment profile's items. Equipment changes what the
 * engine may select, so it is stored as a profile rather than free text.
 */
async function saveEquipment(
  db: ReturnType<typeof clientFor>, userId: string, equipment: string[],
) {
  const { data: existing } = await db.from('equipment_profiles')
    .select('id').eq('user_id', userId).eq('is_default', true).maybeSingle();

  let profileId = existing?.id;
  if (!profileId) {
    const { data, error } = await db.from('equipment_profiles')
      .insert({ user_id: userId, name: 'Default', is_default: true })
      .select('id').single();
    if (error || !data) throw new HttpError(500, `Could not create equipment profile: ${error?.message}`);
    profileId = data.id;
  } else {
    await db.from('equipment_profile_items').delete().eq('profile_id', profileId);
  }

  if (equipment.length === 0) return;
  const { error } = await db.from('equipment_profile_items').insert(
    equipment.map(equipment_id => ({ profile_id: profileId, equipment_id })),
  );
  if (error) throw new HttpError(500, `Could not save equipment: ${error.message}`);
}


/**
 * Fills the first week's queue.
 *
 * Best-effort by design: a program with a plan but no queue is usable — the
 * engine still picks a session each day — and failing plan creation over the
 * list would cost the athlete their whole onboarding.
 */
async function planFirstWeek(
  db: ReturnType<typeof clientFor>,
  first: { id: string } | undefined,
  firstPhase: { phase_type: PhaseType },
  body: PlanRequest | null,
  today: string,
) {
  if (!first) return;

  try {
    const content = await loadContent(db);
    await ensureWeekQueue({
      db,
      cycleId: first.id,
      requirements: stimuliFor(firstPhase.phase_type).map(s => ({
        stimulus_type: s.stimulus_type,
        target_exposures: s.target_exposures,
        priority: s.priority,
      })),
      templates: content.templates,
      exercises: content.exercises,
      input: {
        local_date: today,
        phase_type: firstPhase.phase_type,
        days_to_race: null,
        stimulus_requirements: [],
        recent_sessions: [],
        recovery_state: 'okay',
        energy: 'normal',
        sleep_hours: null,
        available_minutes: body?.profile?.typical_session_minutes ?? 45,
        available_equipment: body?.equipment?.length ? body.equipment : ['bodyweight'],
        low_impact_required: body?.profile?.impact_tolerance === 'low',
        symptom_flags: [],
        considerations: body?.profile?.considerations ?? [],
        candidates: content.templates,
        substitutions: content.substitutions,
      },
    });
  } catch (e) {
    console.error('first week queue not planned', (e as Error).message);
  }
}
