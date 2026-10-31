/**
 * The week as the Plan and Today tabs both show it, assembled in one place so
 * the two can never count it differently.
 *
 * `lookOf` turns a template into its shape, kind and effort, cached per id.
 * `useWeek` works out today's claim on the queue exactly as the old Plan tab
 * did: a session finished on this device stands in for today until the server
 * has it, and only the one queue item the server would claim for today is
 * taken out of what is still to come.
 */
import { useMemo } from 'react';

import { EXERCISES, TEMPLATES } from '@/data/content';
import { rpeOf, sessionKind, sessionShape, type ShapeBar, type ShapeBlock } from '@/data/sessionShape';
import { buildWeek, effortOf, type TemplateLook } from '@/data/planWeek';
import { useApp } from '@/state/store';

export const templateById = new Map(TEMPLATES.map(tpl => [tpl.id, tpl]));
const exerciseIndex = new Map(EXERCISES.map(e => [e.id, e]));

export type Look = TemplateLook & { bars: ShapeBar[] };

const looks = new Map<string, Look | null>();

/** A template's look. Pass `blocks` for a variant or an adapted session; that one is not cached. */
export function lookOf(templateId: string, blocks?: ShapeBlock[]): Look | null {
  if (!blocks && looks.has(templateId)) return looks.get(templateId)!;
  const tpl = templateById.get(templateId);
  if (!tpl) { looks.set(templateId, null); return null; }
  const bars = sessionShape(blocks ?? tpl.blocks, {
    exercises: exerciseIndex, intensityTarget: tpl.intensity_target,
  });
  const look: Look = {
    bars,
    kind: sessionKind(tpl, bars),
    effort: effortOf(rpeOf(tpl.intensity_target)),
    description: tpl.description ?? null,
    supplemental: (tpl.workout_role ?? 'primary') === 'supplemental',
    circuit: tpl.session_type === 'strength_endurance',
  };
  if (!blocks) looks.set(templateId, look);
  return look;
}

export function useWeek() {
  const { session, plan } = useApp();
  return useMemo(() => {
    const todayTemplateId = plan.pendingSession?.template_id
      ?? (session.kind === 'session' ? session.template.id : null);
    const claimedToday = todayTemplateId
      ? [...plan.week.queue].sort((a, b) => a.rank - b.rank).find(q => q.template_id === todayTemplateId)
      : undefined;
    const upNext = plan.week.queue.filter(q => q.id !== claimedToday?.id);
    const todayOpen = session.kind === 'session' && !plan.pendingCompletion && !plan.pendingSession;
    const week = buildWeek({
      completed: plan.week.completed,
      pendingSession: plan.pendingSession,
      today: todayOpen && session.kind === 'session'
        ? {
            templateId: session.template.id, name: session.template.name,
            minutes: session.estimated_minutes, queued: claimedToday ?? null,
          }
        : null,
      upNext,
      skipped: plan.week.skipped,
      opportunities: plan.week.opportunities,
      look: id => lookOf(id),
    });
    return { week, todayTemplateId, claimedToday };
  }, [plan, session]);
}
