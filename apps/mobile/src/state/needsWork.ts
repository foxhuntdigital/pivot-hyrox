/**
 * "What needs work": the athlete's own read on themselves, asked in onboarding
 * and on Profile, and shown on Progress as "You said this needs work".
 *
 * Capped at three. The answer nudges which sessions rank first, and every
 * pick counts the same, so ticking all seven boosts everything and therefore
 * nothing. Three is enough to say what matters most and few enough to mean it.
 *
 * The cap stops a fourth being added; it never removes picks. An athlete who
 * chose more before the cap keeps them until they take some off, and is told
 * how many to remove.
 *
 * Pure, so the same rule runs in onboarding and Profile and can be tested.
 */

export const MAX_NEEDS_WORK = 3;

export interface NeedsWorkToggle {
  next: string[];
  /** Whether `value` is now picked. */
  picked: boolean;
  /** True when the tap was refused because the cap is reached. */
  blocked: boolean;
}

export function toggleNeedsWork(current: string[], value: string): NeedsWorkToggle {
  if (current.includes(value)) {
    return { next: current.filter(v => v !== value), picked: false, blocked: false };
  }
  if (current.length >= MAX_NEEDS_WORK) {
    return { next: current, picked: false, blocked: true };
  }
  return { next: [...current, value], picked: true, blocked: false };
}

/** Whether an unpicked option can still be picked. */
export function canPickMore(current: string[]): boolean {
  return current.length < MAX_NEEDS_WORK;
}

/** The line under the list: progress toward the cap, or how many to remove. */
export function needsWorkNote(current: string[]): string {
  const n = current.length;
  if (n > MAX_NEEDS_WORK) {
    const extra = n - MAX_NEEDS_WORK;
    return `You have ${n} picked. Remove ${extra} to keep the ${MAX_NEEDS_WORK} that matter most.`;
  }
  return `Pick up to ${MAX_NEEDS_WORK}. ${n} of ${MAX_NEEDS_WORK} picked.`;
}
