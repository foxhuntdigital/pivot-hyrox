/**
 * Adds mobility and stretch movements to `content.exercises`.
 *
 * These arrive from supplemental packs as named routine steps — "90/90 Hip
 * Switch, 60 seconds" — and `block_exercises.exercise_id` is
 * `not null references content.exercises(id)`, so they need rows to be storable
 * at all. The alternative was a second content shape for routine steps, which
 * would mean two ways to say "this session prescribes this movement" and two
 * readers for every consumer of a block.
 *
 * ── Why this does not put them in the strength library ──────────────────────
 *
 * The strength library is not "everything in content.exercises". It is the
 * subset with a populated ontology: `movement_families`, `training_qualities`,
 * `progression_class`, the columns migration 0014 added and that
 * `data/review/strength-library.export.*` selects on. Cardio rows have lived in
 * this table with empty ontology arrays since the first seed for exactly this
 * reason, and mobility rows join them on the same terms.
 *
 * So no progression metadata is invented here. A hip flexor stretch has no
 * `progression_class`, because the question "how does this progress" has no
 * answer for it that is not made up — and `progression.ts` reads a null class
 * as `reps`, the answer that cannot put weight on anything.
 *
 * Also used for boxing, which has the same shape of problem: shadowboxing is a
 * movement a session prescribes and not a strength exercise, and `ex_boxing_bag`
 * already existed on exactly these terms.
 *
 *   node scripts/import-mobility-vocabulary.mjs [data/pack.json] [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const packArg = process.argv.slice(2).find(a => a.endsWith('.json'));
const PACK = packArg
  ? new URL(`../${packArg}`.replace('../data/', '../data/'), import.meta.url)
  : new URL('../data/mobility-vocabulary.json', import.meta.url);
const quiet = process.argv.includes('--quiet');

let sql = readFileSync(SRC, 'utf8');
const pack = JSON.parse(readFileSync(PACK, 'utf8'));

const q = v => (v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? (v ? '1' : '0')
  : `'${String(v).replace(/'/g, "''")}'`);

function splitValues(body) {
  const out = []; let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { cur += ch; if (ch === "'") { if (body[i + 1] === "'") { cur += "'"; i++; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unquote = v => (v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v === 'NULL' ? null : v);

const createRe = /CREATE TABLE exercises\(([^)]*)\);/;
const create = sql.match(createRe);
if (!create) throw new Error('exercises CREATE TABLE not found in the dump');
const columns = create[1].split(',').map(c => c.trim().split(/\s+/)[0]);

const existing = new Map();
for (const m of sql.matchAll(/INSERT INTO "exercises" VALUES\(([\s\S]*?)\);/g)) {
  existing.set(unquote(splitValues(m[1])[0]), true);
}

/**
 * A mobility row, by column name.
 *
 * Written positionally against the schema read from the dump rather than
 * against a hardcoded order, because two scripts have now been broken by
 * appending a column to a table they wrote by counting.
 */
function rowFor(ex) {
  const values = {
    id: ex.id,
    name: ex.name,
    category: ex.category ?? 'mobility',
    // Not a strength pattern. `mobility` is the honest value and no reader
    // branches on it; the column is `not null`, which is why it is stated.
    // Stated rather than defaulted; all three columns are `not null` and no
    // reader branches on them for this kind of content.
    movement_pattern: ex.movement_pattern ?? 'mobility',
    modality: ex.modality ?? 'mobility',
    default_unit: ex.default_unit ?? 's',
    impact_level: 'low',
    hyrox_relevance: 0,
    postpartum_friendly: 1,
    notes: ex.notes ?? null,
    // The ontology stays empty. See the header: no invented progression.
    movement_families: '[]',
    training_qualities: '[]',
    movement_characters: '[]',
    complexity_level: null,
    exercise_role_eligibility: '[]',
    progression_class: null,
    progression_tracks: '[]',
    exercise_family_id: null,
    history_comparability_group: null,
    canonical_name: ex.name,
    aliases: '[]',
    variant_parent: null,
    methodology_bucket: null,
    status: 'content_eligible',
  };
  const missing = columns.filter(c => !(c in values));
  if (missing.length) throw new Error(`no value for exercises column(s): ${missing.join(', ')}`);
  return `INSERT INTO "exercises" VALUES(${columns.map(c => q(values[c])).join(',')});`;
}

const added = [], skipped = [];
const rows = [];
for (const ex of pack.exercises) {
  if (existing.has(ex.id)) { skipped.push(ex.id); continue; }
  rows.push(rowFor(ex));
  added.push(ex);
}

if (rows.length) {
  const lines = sql.split('\n');
  let last = -1;
  lines.forEach((l, i) => { if (l.startsWith('INSERT INTO "exercises" VALUES(')) last = i; });
  if (last === -1) throw new Error('no existing exercises rows to append after');
  lines.splice(last + 1, 0, ...rows);
  sql = lines.join('\n');
  writeFileSync(SRC, sql);
}

if (!quiet) {
  console.log(`${added.length} mobility exercise(s) added, ${skipped.length} already present`);
  for (const a of added) console.log(`  ${a.id.padEnd(42)} ${a.name}`);
  if (rows.length) console.log('\nNow run: node scripts/convert-seed.mjs && node scripts/build-fixtures.mjs');
}
