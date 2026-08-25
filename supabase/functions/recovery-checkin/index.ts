/**
 * POST /v1/recovery-checkins — the manual recovery check-in (PRD §12, FR-015).
 *
 * One row per athlete per local day, upserted: checking in twice on the same
 * day corrects the entry rather than stacking a second one, which is why the
 * table carries `unique (user_id, local_date)`.
 *
 * Every field is optional. An athlete who only wants to log that they slept
 * badly should not have to answer four more questions, and `recoverySignal`
 * scores whatever was given rather than penalising the silence.
 *
 * The day is computed in the athlete's own timezone (PRD §11.1), so a check-in
 * at 1am belongs to the day they are actually in.
 */
import { recoverySignal } from '../../../packages/engine/src/index.ts';
import {
  clientFor, corsHeaders, HttpError, json, localDate, requireUser,
} from '../_shared/context.ts';

/** 1–5 scales, or null. Anything else is a client bug worth surfacing. */
function scale(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new HttpError(400, `${field} must be an integer 1–5`);
  }
  return value;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');

    const db = clientFor(req);
    const user = await requireUser(db);
    const today = localDate(user.timezone);

    const body = await req.json() as {
      sleep_hours?: number | null;
      energy?: 'low' | 'normal' | 'high' | null;
      stress?: number | null;
      soreness?: number | null;
      motivation?: number | null;
      symptoms?: Record<string, unknown> | null;
    };

    let sleep_hours: number | null = null;
    if (body.sleep_hours !== null && body.sleep_hours !== undefined) {
      if (typeof body.sleep_hours !== 'number' || !Number.isFinite(body.sleep_hours)
          || body.sleep_hours < 0 || body.sleep_hours > 24) {
        throw new HttpError(400, 'sleep_hours must be between 0 and 24');
      }
      // Stored to the minute; the client enters hours and minutes.
      sleep_hours = Math.round(body.sleep_hours * 60) / 60;
    }

    if (body.energy && !['low', 'normal', 'high'].includes(body.energy)) {
      throw new HttpError(400, 'energy must be low, normal or high');
    }

    const row = {
      user_id: user.id,
      local_date: today,
      sleep_hours,
      energy: body.energy ?? null,
      stress: scale(body.stress, 'stress'),
      soreness: scale(body.soreness, 'soreness'),
      motivation: scale(body.motivation, 'motivation'),
      symptom_json: body.symptoms ?? {},
    };

    const { data, error } = await db
      .from('recovery_checkins')
      .upsert(row, { onConflict: 'user_id,local_date' })
      .select('local_date, sleep_hours, energy, stress, soreness, motivation')
      .single();

    if (error) throw new HttpError(500, `check-in failed: ${error.message}`);

    return json({
      recovery: {
        ...data,
        source: 'self_reported' as const,
        observed_on: data.local_date,
      },
      /**
       * Returned so the client can show the effect immediately. Readiness
       * itself is recomputed by `/v1/today`, which is authoritative — this is
       * the input, not the score.
       */
      recovery_signal: recoverySignal(data),
    }, 200, origin);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'check-in failed';
    return json({ error: message }, status, origin);
  }
});
