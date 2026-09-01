/**
 * Merges the exercise ontology into the seed dump (addendum §3, §20).
 *
 * The dump is SQLite, which has no array type, so the multi-valued fields are
 * carried as JSON text and turned into Postgres array literals by
 * convert-seed.mjs. That keeps one authoring source rather than introducing a
 * second file the two generators would have to agree about.
 *
 * §20 requires this to land BEFORE the strength library expands: a movement
 * authored without a progression class either gets no progression at all or
 * gets load-and-reps by default, and load-and-reps applied to a box jump is
 * how a plyometric ladder turns into an injury.
 *
 *   node scripts/import-ontology.mjs [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const PACK = new URL('../data/exercise-ontology.json', import.meta.url);
const quiet = process.argv.includes('--quiet');

/** Column name and SQLite storage type, in the order they are appended. */
const ADDED = [
  ['movement_families', 'TEXT'],
  ['training_qualities', 'TEXT'],
  ['movement_characters', 'TEXT'],
  ['complexity_level', 'TEXT'],
  ['exercise_role_eligibility', 'TEXT'],
  ['progression_class', 'TEXT'],
  ['progression_tracks', 'TEXT'],
  ['exercise_family_id', 'TEXT'],
  ['history_comparability_group', 'TEXT'],
];

let sql = readFileSync(SRC, 'utf8');
const pack = JSON.parse(readFileSync(PACK, 'utf8'));

const createRe = /CREATE TABLE exercises\(([^)]*)\);/;
const create = sql.match(createRe);
if (!create) throw new Error('exercises CREATE TABLE not found');

const present = ADDED.filter(([n]) => new RegExp(`\\b${n}\\b`).test(create[1]));
if (present.length && present.length !== ADDED.length) {
  throw new Error('dump is half-migrated');
}
if (!present.length) {
  sql = sql.replace(createRe, `CREATE TABLE exercises(${create[1]},`
    + ADDED.map(([n, t]) => `${n} ${t}`).join(',') + ');');
}

const BASE = create[1].split(',').length - (present.length ? ADDED.length : 0);

const lit = v => v === null || v === undefined
  ? 'NULL'
  : `'${String(v).replace(/'/g, "''")}'`;

/** Arrays travel as JSON text; convert-seed turns them into array literals. */
const arr = v => `'${JSON.stringify(v ?? []).replace(/'/g, "''")}'`;

const seen = new Set();
const unclassified = [];

/**
 * Split a VALUES(...) tuple into raw SQL literals, respecting '' escapes.
 *
 * A plain `body.split(',')` looks sufficient and is not: `notes` is prose and
 * contains commas — "marching, A-skips, ankling" — so two rows split into more
 * fields than the table has columns, were read as already-merged, and were
 * silently skipped.
 */
function splitValues(body) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") { cur += "'"; i++; }
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

sql = sql.replace(/INSERT INTO "exercises" VALUES\((.*)\);/g, (line, body) => {
  const id = body.match(/^'([^']+)'/)?.[1];
  if (!id) return line;

  const values = splitValues(body);
  // Already merged: leave it alone, but still count what is unclassified so
  // the report describes the dump rather than this run.
  if (values.length > BASE) {
    if (!pack.exercises[id]) unclassified.push(id);
    return line;
  }

  const o = pack.exercises[id];
  if (!o) { unclassified.push(id); }
  seen.add(id);

  const [families, qualities, characters, complexity, roles, cls, tracks, family, comparability] =
    o ?? [[], [], [], null, [], null, [], null, null];

  const tail = [
    arr(families), arr(qualities), arr(characters), lit(complexity),
    arr(roles), lit(cls), arr(tracks), lit(family), lit(comparability),
  ];
  return `INSERT INTO "exercises" VALUES(${body},${tail.join(',')});`;
});

const unknown = Object.keys(pack.exercises).filter(id => !seen.has(id) && seen.size);
if (unknown.length) {
  console.error(`pack names exercises that are not in the library:\n  ${unknown.join('\n  ')}`);
  process.exit(1);
}

writeFileSync(SRC, sql);

if (!quiet) {
  const classes = {};
  for (const o of Object.values(pack.exercises)) {
    classes[o[5] ?? 'not governed'] = (classes[o[5] ?? 'not governed'] ?? 0) + 1;
  }
  console.log(seen.size ? `classified ${seen.size} exercises` : 'dump already carries the ontology');
  for (const [c, n] of Object.entries(classes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${c}`);
  }
  if (unclassified.length) {
    console.log(`\n${unclassified.length} exercise(s) have no ontology entry:`);
    for (const id of unclassified) console.log(`  ${id}`);
    console.log('add them to data/exercise-ontology.json before authoring against them');
  }
}
