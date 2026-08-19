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

/** Equipment the Profile screen offers, in the design's presentation order. */
export const EQUIPMENT_CHOICES = EQUIPMENT.filter(e => e.id !== 'bodyweight');
