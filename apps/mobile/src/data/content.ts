/**
 * Offline content cache.
 *
 * PRD §15.1 requires the workout templates referenced by the queue, exercise
 * metadata and last performance values to be cached so an active workout keeps
 * working with no network. The curated library is small (43 exercises, 34
 * templates) so the whole thing ships with the binary and is refreshed from
 * Supabase on launch rather than fetched on demand.
 */
import type { Exercise, Substitution, WorkoutTemplate } from '@pivot/engine';
import raw from './content.json';

export const EXERCISES = raw.exercises as Exercise[];
export const TEMPLATES = raw.templates as WorkoutTemplate[];
export const SUBSTITUTIONS = raw.substitutions as Substitution[];
export const EQUIPMENT = raw.equipment as { id: string; name: string; category: string }[];

export const exerciseById = new Map(EXERCISES.map(e => [e.id, e]));
export const templateById = new Map(TEMPLATES.map(t => [t.id, t]));

/**
 * A common gym, pre-selected on the onboarding equipment step.
 *
 * A starting suggestion the athlete edits before they submit — not a claim
 * about what they own, and never used after onboarding. Starting empty reads
 * as "you own nothing", which is a worse first question than this is an answer.
 */
export const COMMON_EQUIPMENT = ['treadmill', 'outdoor', 'ski', 'bike', 'db', 'kb',
  'box', 'wall_ball', 'sled', 'rope', 'sandbag'];

/**
 * Equipment the athlete is never asked about.
 *
 * These stay in the catalogue — the engine still selects against them, and the
 * seed is unchanged — they are simply not questions worth putting to an
 * athlete:
 *
 * - `bodyweight` and `wall` are assumed. `resolveEquipment` already treats
 *   bodyweight as always available regardless of what was claimed, and the only
 *   three exercises gated on a wall list `medicine_ball` as an alternative, so
 *   hiding both costs no content.
 * - `reformer` gates a single recovery exercise and reads as noise in a picker
 *   about training kit.
 */
const HIDDEN_EQUIPMENT = new Set(['bodyweight', 'wall', 'reformer']);

/** The catalogue as an athlete should see it, from any source. */
export function visibleEquipment<T extends { id: string }>(list: T[]): T[] {
  return list.filter(e => !HIDDEN_EQUIPMENT.has(e.id));
}

/** Equipment the Profile screen offers, in the design's presentation order. */
export const EQUIPMENT_CHOICES = visibleEquipment(EQUIPMENT);
