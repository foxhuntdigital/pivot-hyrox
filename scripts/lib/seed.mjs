/**
 * Reads data/adaptive_athlete_schema_and_seed.sql into plain rows.
 *
 * The dump is the source of truth every generator reads, and parsing it was
 * being re-implemented per script — build-fixtures, import-workouts and
 * prepare-pack each carry their own `splitValues`. Each copy is a chance for
 * one reader to disagree with another about what the file says, which is the
 * one thing a source of truth may not permit.
 *
 * Strict about the two things a naive parser gets wrong:
 *
 *   1. `''` inside a quoted value is one literal quote, not the end of the
 *      string. "Farmer's Carry" is a real exercise name and splitting it wrong
 *      shifts every remaining column of that row by one.
 *   2. A table constraint is not a column. `UNIQUE(workout_id,variant_code)`
 *      splits at paren depth zero so it stays one item, then is dropped —
 *      counting it would demand a value that has nowhere to go.
 *
 * Read-only by construction: nothing here writes, so a caller cannot corrupt
 * the dump by importing it.
 */
import { readFileSync } from 'node:fs';

export const SEED_PATH = new URL('../../data/adaptive_athlete_schema_and_seed.sql', import.meta.url);

const TABLE_CONSTRAINT = /^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;

/** Splits a parenthesised body on top-level commas, honouring '' escapes. */
export function splitValues(body) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "'") {
        if (body[i + 1] === "'") { cur += "'"; i++; continue; }
        inStr = false; continue;
      }
      cur += ch; continue;
    }
    if (ch === "'") { inStr = true; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Column names per table, table constraints excluded. */
export function parseSchema(sql) {
  const schema = {};
  for (const m of sql.matchAll(/CREATE TABLE (\w+)\(([\s\S]*?)\);/g)) {
    const [, table, body] = m;
    const items = [];
    let depth = 0, cur = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    schema[table] = items.filter(c => !TABLE_CONSTRAINT.test(c)).map(c => c.split(/\s+/)[0]);
  }
  return schema;
}

/**
 * `{ schema, tables }`, tables keyed by name with rows as objects.
 *
 * NULL becomes null and bare numerics become numbers; everything else stays the
 * string the dump holds. JSON-in-TEXT columns (movement_families and the other
 * ontology arrays) stay strings deliberately — a caller that wants them parsed
 * says so, because a silent parse turns a malformed array into `[]` and hides
 * the corruption it should be reporting.
 */
export function readSeed(path = SEED_PATH) {
  const sql = readFileSync(path, 'utf8');
  const schema = parseSchema(sql);
  const tables = {};
  for (const m of sql.matchAll(/INSERT INTO "(\w+)" VALUES\(([\s\S]*?)\);\n/g)) {
    const [, table, body] = m;
    const cols = schema[table];
    if (!cols) continue;
    const vals = splitValues(body);
    const row = {};
    cols.forEach((c, i) => {
      const raw = vals[i];
      row[c] = raw === undefined || raw === 'NULL' ? null
        : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw)
        : raw;
    });
    (tables[table] ??= []).push(row);
  }
  return { schema, tables };
}

/** A JSON-in-TEXT column as an array. Malformed or absent reads as empty. */
export function jsonArray(v) {
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}
