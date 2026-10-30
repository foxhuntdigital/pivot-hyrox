/**
 * How the athlete describes themselves, in the words they picked.
 *
 * The two capacity answers (migration 0023) replace the old `experience_level`
 * as the athlete's self-description. Coach is given the labels the athlete
 * chose in onboarding, not the 1-4 numbers, so a reply can say "as an
 * intermediate" without the model having to guess what a 2 means.
 *
 * The labels match the app's onboarding choices word for word. A number
 * outside 1-4, or no answer, reads as null: unknown, not the middle.
 */
const FITNESS = ['Beginner', 'Intermediate', 'Advanced', 'Competitive'] as const;
const EXPERIENCE = ['New to it', 'Some experience', 'Experienced', 'Highly experienced'] as const;

function pick(labels: readonly string[], value: number | null | undefined): string | null {
  return value != null && Number.isInteger(value) && value >= 1 && value <= labels.length
    ? labels[value - 1] : null;
}

export function athleteCapacity(profile: {
  load_capacity?: number | null;
  technical_capacity?: number | null;
} | null | undefined): { fitness: string | null; training_experience: string | null } {
  return {
    fitness: pick(FITNESS, profile?.load_capacity),
    training_experience: pick(EXPERIENCE, profile?.technical_capacity),
  };
}
