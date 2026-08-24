/**
 * Normalises the packs' Express / Micro / progression columns into
 * content.station_programming_rules.
 *
 * The station matrix looks like a 96-cell rules grid, but its rule columns are
 * *constant* across all 96 rows — the only per-cell variation is the
 * prescription itself. Emitting 96 copies of one paragraph would not be
 * normalising it. So rules land at the grain the data actually has: one row per
 * stimulus, with station '*' meaning "any station". Per-station overrides can be
 * added later without moving anything.
 *
 * The running expansion carries its own distinct rule text, and running is a
 * station in HYROX terms, so those rows are keyed station = 'Run'.
 *
 *   node scripts/import-programming-rules.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);
const CREATE = 'CREATE TABLE station_programming_rules(id TEXT PRIMARY KEY,station TEXT,stimulus TEXT,'
  + 'express_rule TEXT,micro_rule TEXT,progression_rule TEXT,tracking_metrics TEXT,'
  + 'race_reference TEXT,content_version TEXT);';

const q = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const slug = s => (s === '*' ? 'any' : s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));

const packs = [
  { file: 'hyrox-station-matrix.json', station: '*' },
  { file: 'running-expansion.json', station: 'Run' },
];

const rows = [];
for (const { file, station } of packs) {
  const pack = JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
  const m = pack.meta;
  const stimuli = [...new Set(pack.workouts.map(w => w.primary_goal))].sort();
  for (const stimulus of stimuli) {
    rows.push(`INSERT INTO "station_programming_rules" VALUES(${[
      q(`spr_${slug(station)}_${stimulus}`), q(station), q(stimulus),
      q(m.express_rule), q(m.micro_rule), q(m.progression_rule),
      q(JSON.stringify(m.tracking_metrics)), 'NULL', q(m.content_version ?? 'v1'),
    ].map(v => v).join(',')});`);
  }
  console.log(`${file.padEnd(28)} ${stimuli.length} stimuli -> station ${station}`);
}

let sql = readFileSync(SRC, 'utf8');
// Idempotent: drop any prior emission of this table, then re-add.
sql = sql.split('\n').filter(l =>
  !l.startsWith('INSERT INTO "station_programming_rules"') && l !== CREATE).join('\n');

const anchor = sql.lastIndexOf('CREATE TABLE substitutions(');
if (anchor === -1) throw new Error('could not find an anchor to insert the table before');
sql = sql.slice(0, anchor) + CREATE + '\n' + rows.join('\n') + '\n' + sql.slice(anchor);

writeFileSync(SRC, sql);
console.log(`\n${rows.length} programming rules written to the dump`);
console.log('Now run: node scripts/convert-seed.mjs && node scripts/build-fixtures.mjs');
