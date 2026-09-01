/**
 * What an engine decision stores about the inputs it was given.
 *
 * `adaptation_events.inputs_json` exists so a recommendation can be reproduced
 * from stored inputs (PRD §11.1, §24), and the straightforward way to
 * guarantee that is to store the `EngineInput` verbatim. That is what `today`
 * and `adapt` did, and it writes the entire candidate library — all 203
 * templates with their blocks, variants and exercises — into every row:
 *
 *     full EngineInput        325 KB per call
 *     candidates as ids         6 KB per call
 *
 * A row is written on every `/today`, not only on an adaptation, and `/adapt`
 * fires again on each change in the adapt sheet. At a thousand athletes that
 * is ~113 GB a year of the same library copied back on itself.
 *
 * The candidate *set* is still part of the decision — which templates were on
 * the table changes what ranking means — so it cannot simply be dropped. It is
 * stored as ids plus the content version they were read at, which is the same
 * information as long as content is versioned, and content is: `content_versions`
 * (0002) and `station_programming_rules.content_version` (0006) both exist for
 * exactly this.
 *
 * Substitutions stay inline. They are small, they are the reason a swap
 * happened, and a decision that swapped an exercise is unreadable without
 * them.
 */
import type { EngineInput } from '../../../packages/engine/src/index.ts';

/** The schema version of the audit row itself, so a reader knows which shape it has. */
export const AUDIT_FORMAT = '2';

/** `EngineInput` with the candidate library reduced to what identifies it. */
export type AuditInputs =
  & Omit<EngineInput, 'candidates'>
  & {
    audit_format: string;
    candidate_ids: string[];
    candidate_count: number;
    content_version: string | null;
  };

/**
 * Trims an `EngineInput` to what is worth keeping for replay.
 *
 * Everything except `candidates` is carried through untouched, including the
 * fields that decide the outcome — recovery, minutes, equipment, symptom flags
 * and `athlete_override`. Replay reads `candidate_ids` back against the named
 * content version.
 */
export function auditInputs(
  input: EngineInput,
  contentVersion: string | null = null,
): AuditInputs {
  const { candidates, ...rest } = input;
  return {
    ...rest,
    audit_format: AUDIT_FORMAT,
    candidate_ids: candidates.map(c => c.id),
    candidate_count: candidates.length,
    content_version: contentVersion,
  };
}
