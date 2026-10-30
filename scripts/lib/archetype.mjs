/**
 * Which kind of strength session a template is, from its exercises
 * (see scripts/apply-archetypes.mjs for the rule and why it is shaped so).
 */

/** Migration 0024's strength vocabulary. */
export const STRENGTH_ARCHETYPES = ['foundational', 'athletic', 'complex', 'mixed'];

/**
 * @param {(string|null)[]} kinds each exercise's archetype from its
 *   `methodology_bucket`, in the order performed; null where unclassified.
 * @returns {string|null} null when nothing in the session is classified.
 */
export function deriveArchetype(kinds) {
  const known = kinds.filter(k => k !== null);
  if (!known.length) return null;
  const share = k => known.filter(x => x === k).length / known.length;
  if (share('athletic') >= 0.6) return 'athletic';
  if (share('complex') >= 0.6) return 'complex';
  // The opening lift is the anchor that sets the session's purpose: a jump or
  // a clean before the squats makes it a mixed session whatever follows.
  if (known[0] !== 'foundational' || 1 - share('foundational') >= 0.4) return 'mixed';
  return 'foundational';
}
