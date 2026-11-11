/**
 * Why the engine will not build one particular session for this athlete.
 *
 * `recommend` answers a refusal with the day's generic no-session guidance
 * ("Take the rest or do something easy…"), which is right for Today and wrong
 * for a session someone tapped to read: they did not ask whether to train,
 * they asked about this workout. So each constraint is relaxed in turn, and
 * the first one whose removal lets the session build is the reason.
 *
 * `hard` says whether anything the athlete does today can change it. Skill,
 * impact, health considerations and equipment cannot, so "Do it today" is not
 * offered. Recovery and time are advice the athlete may overrule, and the
 * switch already asks them about it.
 */
export type UnavailableReason = 'skill' | 'impact' | 'considerations' | 'today' | 'equipment';

export interface RefusalInput {
  technical_capacity?: number | null;
  low_impact_required: boolean;
  considerations: string[];
  recovery_state: string;
  energy: string;
  sleep_hours: number | null;
  available_minutes: number;
  symptom_flags: string[];
}

export function whyUnavailable<I extends RefusalInput>(
  input: I,
  builds: (input: I) => boolean,
): { reason: UnavailableReason; hard: boolean } {
  if (input.technical_capacity != null && builds({ ...input, technical_capacity: null })) {
    return { reason: 'skill', hard: true };
  }
  if (input.low_impact_required && builds({ ...input, low_impact_required: false })) {
    return { reason: 'impact', hard: true };
  }
  if (input.considerations.length && builds({ ...input, considerations: [] })) {
    return { reason: 'considerations', hard: true };
  }
  if (builds({
    ...input, recovery_state: 'good', energy: 'normal', sleep_hours: 8,
    available_minutes: Math.max(input.available_minutes, 120), symptom_flags: [],
  })) {
    return { reason: 'today', hard: false };
  }
  return { reason: 'equipment', hard: true };
}

export const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  skill: 'This one asks for more movement skill than the experience you described. '
    + 'It will open up as your training builds, or if you change your experience on Profile.',
  impact: 'This one has high-impact movements, and you have asked for low-impact training. '
    + 'You can change that on Profile under Running.',
  considerations: 'This one is not suitable with what you have told us to train around. '
    + 'You can review that on Profile under Health.',
  today: 'Not with today’s check-in or time available. You can still choose it, and we will '
    + 'check with you first.',
  equipment: 'This one cannot be built from the equipment you have. You can update your '
    + 'equipment on Profile.',
};
