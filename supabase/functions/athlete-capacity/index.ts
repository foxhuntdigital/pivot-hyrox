/**
 * POST /v1/athlete/capacity — record what an athlete can absorb, and re-size
 * the weeks they have not started yet.
 *
 * Onboarding writes these two answers as part of building the first plan. This
 * exists for everyone who onboarded before the questions did: they carry a null
 * capacity, which every rule reads as "unknown, do not constrain", so they are
 * currently getting the base week whether or not it suits them.
 *
 * ── Why this re-sizes rather than only saving ─────────────────────────────
 *
 * `onboarding-plan` writes `stimulus_requirements` for every cycle in the
 * program up front. So saving a capacity and stopping would leave an athlete
 * who had just answered two questions with a plan identical to the one they had
 * before — which is precisely the failure this whole change exists to correct.
 * A question that does not move the plan is a question we should not be asking.
 *
 * ── Why the current week is left alone ────────────────────────────────────
 *
 * Only cycles the athlete has not begun are rewritten. Shrinking the week
 * someone is standing in takes away sessions they may already have arranged
 * their days around, and does it retroactively — and if they have completed
 * exposures against a requirement, lowering its target below what they have
 * already done would render as "3 / 2". The change lands at the next week
 * boundary, which is where a change of training load should land anyway.
 */
import {
  clientFor, corsHeaders, HttpError, json, requireUser,
} from '../_shared/context.ts';
import { stimuliFor, type PhaseType } from '../_shared/periodization.ts';

interface CapacityBody {
  /** 1-4. What the athlete can absorb. */
  load_capacity?: number;
  /** 1-4. How technical a session they can perform well. */
  technical_capacity?: number;
}

function validate(name: string, v: unknown): number {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 4) {
    throw new HttpError(400, `${name} must be an integer 1-4`);
  }
  return v as number;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const db = clientFor(req);
    const user = await requireUser(db);
    // Deliberately not entitlement-gated. This is the athlete describing
    // themselves, not a plan being generated, and refusing to record it would
    // leave a lapsed subscriber's profile permanently stale.
    const body = await req.json().catch(() => null) as CapacityBody | null;
    if (!body) throw new HttpError(400, 'A body is required');

    const load = validate('load_capacity', body.load_capacity);
    const technical = validate('technical_capacity', body.technical_capacity);

    const { error: saveError } = await db
      .from('athlete_profiles')
      .update({
        load_capacity: load,
        technical_capacity: technical,
        // Stated by the athlete. Nothing observes capacity yet; when something
        // does, this is what distinguishes a claim from a measurement.
        capacity_source: 'stated',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);
    if (saveError) throw new HttpError(500, `Could not save capacity: ${saveError.message}`);

    /**
     * The weeks ahead, re-sized.
     *
     * `status` on a cycle is the marker for whether it has been entered:
     * 'pending' means untouched, so those are the ones safe to rewrite.
     */
    const { data: program } = await db
      .from('programs')
      .select('id, program_phases(id, phase_type, weekly_cycles(id, status))')
      .eq('user_id', user.id).eq('status', 'active').maybeSingle();

    let cyclesResized = 0;

    for (const phase of (program?.program_phases ?? []) as any[]) {
      const pending = (phase.weekly_cycles ?? []).filter((c: any) => c.status === 'pending');
      if (!pending.length) continue;

      const targets = stimuliFor(phase.phase_type as PhaseType, load);

      for (const cycle of pending) {
        /**
         * Replaced rather than updated in place.
         *
         * A capacity change can remove a stimulus from the week entirely —
         * `stimuliFor` filters out anything that lands at zero — and an update
         * would leave that row behind as a requirement the engine reads as
         * permanently unmet.
         */
        await db.from('stimulus_requirements').delete().eq('weekly_cycle_id', cycle.id);

        const rows = targets.map(t => ({
          weekly_cycle_id: cycle.id,
          stimulus_type: t.stimulus_type,
          target_exposures: t.target_exposures,
          priority: t.priority,
        }));
        if (rows.length) {
          const { error } = await db.from('stimulus_requirements').insert(rows);
          // One cycle failing must not abort the rest: a partially re-sized
          // program is better than a saved capacity that reached no week at all.
          if (error) {
            console.error('requirement rewrite failed', cycle.id, error.message);
            continue;
          }
        }
        cyclesResized++;
      }
    }

    return json({
      load_capacity: load,
      technical_capacity: technical,
      /** How many not-yet-started weeks were rebuilt around the new capacity. */
      cycles_resized: cyclesResized,
    }, 200, origin);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: (err as Error).message }, status, origin);
  }
});
