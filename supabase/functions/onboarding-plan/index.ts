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
  clientFor, corsHeaders, HttpError, json, requireUser, localDate,
} from '../_shared/context.ts';
import {
  planPhases, stimuliFor, weeksUntil, type PhaseType,
} from '../_shared/periodization.ts';

interface PlanRequest {
  race: {
    event_name: string;
    event_date: string;
    division?: string | null;
    goal_type?: 'finish_healthy' | 'performance' | 'custom';
    goal_value?: string | null;
  };
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
    const today = localDate(user.timezone);

    const body = await req.json().catch(() => null) as PlanRequest | null;
    const race = body?.race;
    if (!race?.event_name?.trim()) throw new HttpError(400, 'race.event_name is required');
    if (!race.event_date || !ISO_DATE.test(race.event_date)) {
      throw new HttpError(400, 'race.event_date must be an ISO date (YYYY-MM-DD)');
    }
    if (race.event_date < today) {
      throw new HttpError(400, 'race.event_date is in the past');
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

    let raceId: string;
    if (existingRace) {
      const { error } = await db.from('races').update({
        event_name: race.event_name.trim(),
        event_date: race.event_date,
        division: race.division ?? null,
        goal_type: race.goal_type ?? 'performance',
        goal_value: race.goal_value ?? null,
      }).eq('id', existingRace.id);
      if (error) throw new HttpError(500, `Could not update race: ${error.message}`);
      raceId = existingRace.id;
    } else {
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

    // Supersede any active program for this race and take the next version, so
    // the new plan is additive and the old one stays readable.
    const { data: priorPrograms } = await db.from('programs')
      .select('id, version').eq('user_id', user.id).eq('race_id', raceId)
      .order('version', { ascending: false });

    const nextVersion = (priorPrograms?.[0]?.version ?? 0) + 1;
    if (priorPrograms?.length) {
      const { error } = await db.from('programs')
        .update({ status: 'superseded' })
        .eq('user_id', user.id).eq('race_id', raceId).eq('status', 'active');
      if (error) throw new HttpError(500, `Could not supersede program: ${error.message}`);
    }

    const phases = planPhases(today, race.event_date);
    const { data: program, error: programError } = await db.from('programs').insert({
      user_id: user.id,
      race_id: raceId,
      version: nextVersion,
      start_date: today,
      end_date: race.event_date,
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

    const byOrder = new Map(phaseRows.map(r => [r.phase_order, r]));
    const cycleRows: { phase_id: string; week_index: number; status: string }[] = [];
    let weekIndex = 1;
    for (const phase of phases) {
      const row = byOrder.get(phase.phase_order)!;
      for (let w = 0; w < phase.weeks; w++) {
        cycleRows.push({
          phase_id: row.id,
          week_index: weekIndex,
          // The first week is live immediately; the rest wait their turn.
          status: weekIndex === 1 ? 'active' : 'pending',
        });
        weekIndex++;
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

    // The summary D08 renders: which phase the athlete starts in, how long the
    // runway is, and what the first week asks of them.
    const firstPhase = phases[0];
    const firstWeek = cycles.find(c => c.week_index === 1);
    return json({
      program_id: program.id,
      version: nextVersion,
      race: { id: raceId, event_name: race.event_name.trim(), event_date: race.event_date },
      total_weeks: weeksUntil(today, race.event_date),
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
