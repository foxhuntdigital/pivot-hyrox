/**
 * Merges the authored substitution edges into the seed dump.
 *
 * The graph had nine edges for forty-six exercises, and none of them left a
 * barbell. `resolveEquipment` drops the WHOLE template when one exercise cannot
 * be satisfied, so `ex_back_squat` alone made HYROX Legs A unreachable for a
 * dumbbell athlete — and with it every true-strength session in the library.
 * No amount of new content fixes that while the graph is empty.
 *
 * Resolution is ONE HOP: the engine takes the first satisfiable substitute by
 * priority and does not chain. So each fallback tier needs its own direct edge,
 * which is why the data reads repetitively — back squat names both the goblet
 * squat and the swing rather than relying on goblet squat's own fallbacks.
 *
 * Existing edges are never overwritten. The nine that were there were authored
 * deliberately, `sub_1`..`sub_9` are referenced by no code but are stable ids,
 * and a merge that silently re-pointed one would change what an athlete is
 * handed without anyone asking for it.
 *
 *   node scripts/import-substitutions.mjs [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const EDGES = new URL('../data/substitutions-expansion.json', import.meta.url);
const quiet = process.argv.includes('--quiet');

const sql = readFileSync(SRC, 'utf8');
const { edges } = JSON.parse(readFileSync(EDGES, 'utf8'));

/** Exercises that exist, so a typo in the pack fails here and not at import. */
const known = new Set(
  [...sql.matchAll(/INSERT INTO "exercises" VALUES\('([^']+)'/g)].map(m => m[1]));

/** Pairs already in the dump, whichever id they carry. */
const existing = new Set(
  [...sql.matchAll(/INSERT INTO "substitutions" VALUES\('[^']*','([^']+)','([^']+)'/g)]
    .map(m => `${m[1]}->${m[2]}`));

const lines = [];
const skipped = [];
const bad = [];

for (const [from, to, reason, priority] of edges) {
  if (!known.has(from)) { bad.push(`unknown exercise ${from}`); continue; }
  if (!known.has(to)) { bad.push(`unknown substitute ${to}`); continue; }
  if (from === to) { bad.push(`${from} substitutes for itself`); continue; }

  const key = `${from}->${to}`;
  if (existing.has(key)) { skipped.push(key); continue; }
  existing.add(key);

  const id = `sub_${from.replace(/^ex_/, '')}_${to.replace(/^ex_/, '')}`;
  lines.push(`INSERT INTO "substitutions" VALUES('${id}','${from}','${to}',`
    + `'${reason.replace(/'/g, "''")}',${priority});`);
}

if (bad.length) {
  console.error('refusing to import:\n  ' + bad.join('\n  '));
  process.exit(1);
}

if (lines.length) {
  // Appended after the last existing substitution so the file stays grouped by
  // table, which is how every other generator leaves it.
  const anchor = sql.lastIndexOf('INSERT INTO "substitutions"');
  const end = sql.indexOf('\n', anchor) + 1;
  writeFileSync(SRC, sql.slice(0, end) + lines.join('\n') + '\n' + sql.slice(end));
}

if (!quiet) {
  console.log(`added ${lines.length} substitution edge(s)`);
  if (skipped.length) console.log(`kept ${skipped.length} existing edge(s) untouched`);
  console.log(`graph is now ${existing.size} edges over ${known.size} exercises`);
}
