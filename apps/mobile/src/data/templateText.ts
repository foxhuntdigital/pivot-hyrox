/**
 * Words a template carries that are fit to put in front of an athlete.
 *
 * The importer once stamped every pack's workouts with a provenance line
 * ("Adaptive Athlete Follow-up v2 workout.") where a description was missing.
 * The library no longer carries them, but a server that has not run migration
 * 0026 still sends them, and they mean nothing to anyone training. So the app
 * reads a description through here and treats that line as no description.
 */
const PROVENANCE = /^Adaptive Athlete\b.*\bv\d+(\s+workout)?\.?$/i;

export function readableDescription(description: string | null | undefined): string | null {
  const text = description?.trim();
  if (!text || PROVENANCE.test(text)) return null;
  return text;
}
