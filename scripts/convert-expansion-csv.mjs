/**
 * Converts the authored expansion sheets into canonical-v1 packs.
 *
 * The strength (48) and muscular endurance (24) expansions arrive as CSV with
 * the prescription written as prose (`ref_prescription`). Every line in them
 * follows a small, fixed grammar, so it is parsed exactly rather than guessed:
 * a line that does not match is a refusal naming the template and the line,
 * never a best effort. That is the same rule prepare-pack.mjs holds the prose
 * packs to, for the same reason — a parser that is nearly right writes wrong
 * prescriptions into an athlete's session.
 *
 * Writes, per sheet:
 *   data/<stem>.json                        the pack import-workouts.mjs reads
 * and once for both:
 *   data/review/expansion-demand.v1.changeset.json
 *                                           the authored demand grades, applied by
 *                                           apply-demand-changeset.mjs
 *
 * Ranges become one number only where the schema has room for one:
 *   - reps keep their range (reps_min / reps_max);
 *   - rest is the top of its range — strength rests fully;
 *   - target_rpe is the top of its range — the range is the athlete's window,
 *     and its top is the effort the session is graded at;
 *   - a carry distance or hold time is the middle of its range, to the nearest
 *     5, with the authored range kept in the item's intensity note.
 *
 *   node scripts/convert-expansion-csv.mjs data/source/<strength>.csv data/source/<me>.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readCsv } from './lib/csv.mjs';

const paths = process.argv.slice(2);
if (!paths.length) throw new Error('usage: convert-expansion-csv.mjs <sheet.csv> [...]');

const lib = JSON.parse(readFileSync(new URL('../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));
const exerciseByName = new Map(lib.exercises.map(e => [e.name.toLowerCase(), e.id]));

/**
 * Movements done one side at a time. The sheets write "/side as applicable",
 * which is the author deferring to the movement, so the movement decides.
 */
const UNILATERAL = /single|1-arm|offset|contralateral|split|lunge|step-up|lateral|cossack|half-kneeling|tall-kneeling|bottoms-up|renegade|bird dog|chop|rotation|rotational|suitcase|waiter|side plank|copenhagen|pallof|get-up|\bdb row\b|dead bug/i;
/** Trunk work written "8-12/side or 25-35 s": these are held, the rest are reps. */
const HELD = /plank|hold|bear crawl/i;

const mid5 = (a, b) => Math.round((a + b) / 2 / 5) * 5;
const top = (a, b) => (b == null ? a : b);
const num = s => (s == null ? null : Number(s));

function exerciseId(name, where, refs) {
  const byName = exerciseByName.get(name.toLowerCase());
  if (byName) return byName;
  // The strength sheet lists its ids in order beside the prose; trust that list
  // only for a name the library spells differently.
  if (refs) return refs;
  throw new Error(`${where}: no exercise named ${JSON.stringify(name)}`);
}

/** "RPE 7-7.5" / "crisp quality, RPE 5-6" / "controlled" → note and target. */
function effort(text) {
  const m = text.match(/RPE (\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/);
  return { intensity: text.trim(), target_rpe: m ? top(num(m[1]), num(m[2])) : null };
}

/* ── strength ─────────────────────────────────────────────────────────────── */

const STRENGTH_LINE = /^\s*\d+\.\s+(.+?)\s+—\s+(\d+)×(.+?)\s+@\s+(.+?)\s+rest\s+(\d+)(?:-(\d+))?s\s*$/;

function strengthItem(line, where, refId) {
  const m = line.match(STRENGTH_LINE);
  if (!m) throw new Error(`${where}: unreadable line ${JSON.stringify(line.trim())}`);
  const [, name, sets, dose, eff, restA, restB] = m;
  const id = exerciseId(name, where, refId);
  const base = { exercise_id: id, exercise: name, sets: Number(sets), rest_seconds: top(num(restA), num(restB)) };
  const { intensity, target_rpe } = effort(eff);
  const side = UNILATERAL.test(name) ? 'side' : null;

  let d;
  if ((d = dose.match(/^(\d+)-(\d+) m(\/side as applicable)?$/))) {
    return { ...base, prescription_type: 'distance', quantity: mid5(+d[1], +d[2]), unit: 'm',
      intensity: `${intensity} · ${d[1]}-${d[2]} m`, target_rpe,
      side_note: d[3] && side ? 'per side' : null };
  }
  if ((d = dose.match(/^(\d+)-(\d+)\/side or (\d+)-(\d+) s$/))) {
    if (HELD.test(name)) {
      return { ...base, prescription_type: 'duration', quantity: mid5(+d[3], +d[4]), unit: 's',
        intensity: `${intensity} · ${d[3]}-${d[4]} s`, target_rpe,
        side_note: side ? 'per side' : null };
    }
    return { ...base, prescription_type: 'sets_reps', reps_min: +d[1], reps_max: +d[2],
      per_side: side, intensity, target_rpe };
  }
  if ((d = dose.match(/^(\d+)-(\d+)(\/side as applicable)?$/))) {
    return { ...base, prescription_type: 'sets_reps', reps_min: +d[1], reps_max: +d[2],
      per_side: d[3] && side ? side : null, intensity, target_rpe };
  }
  throw new Error(`${where}: unreadable dose ${JSON.stringify(dose)} in ${JSON.stringify(line.trim())}`);
}

function strengthBlocks(row) {
  const [head, ...lines] = row.ref_prescription.split('\n');
  if (!/^B1 \[Main\] continuous$/.test(head.trim())) {
    throw new Error(`${row.template_id}: unexpected block header ${JSON.stringify(head)}`);
  }
  const refs = row.ref_exercise_ids.split('|');
  const items = lines.filter(l => l.trim()).map((l, i) =>
    strengthItem(l, `${row.template_id} line ${i + 1}`, refs[i]));
  if (items.length !== refs.length) {
    throw new Error(`${row.template_id}: ${items.length} lines but ${refs.length} exercise ids`);
  }
  return [{ block_type: 'continuous', title: 'Main', rounds: null, duration_minutes: null,
    rest_seconds: null, instructions: row.coaching_notes, items }];
}

/* ── muscular endurance ───────────────────────────────────────────────────── */

/** "10 reps" / "8-12 reps" / "8/side" / "10 total" / "30-40 m" / "25 m/side" / "35s". */
function meDose(dose, where) {
  let d;
  const s = dose.trim();
  if ((d = s.match(/^(\d+)(?:-(\d+))? reps$/))) {
    return d[2] ? { prescription_type: 'reps', quantity: Math.round((+d[1] + +d[2]) / 2), unit: 'reps', note: `${d[1]}-${d[2]} reps` }
      : { prescription_type: 'reps', quantity: +d[1], unit: 'reps' };
  }
  if ((d = s.match(/^(\d+)\/side$/))) return { prescription_type: 'reps', quantity: +d[1], unit: 'reps', side_note: 'per side' };
  if ((d = s.match(/^(\d+) total$/))) return { prescription_type: 'reps', quantity: +d[1], unit: 'reps', side_note: 'total, alternating sides' };
  if ((d = s.match(/^(\d+)(?:-(\d+))? m(\/side)?$/))) {
    return { prescription_type: 'distance', quantity: d[2] ? mid5(+d[1], +d[2]) : +d[1], unit: 'm',
      note: d[2] ? `${d[1]}-${d[2]} m` : null, side_note: d[3] ? 'per side' : null };
  }
  if ((d = s.match(/^(\d+)(?:-(\d+))?s$/))) {
    return { prescription_type: 'duration', quantity: d[2] ? mid5(+d[1], +d[2]) : +d[1], unit: 's',
      note: d[2] ? `${d[1]}-${d[2]} s` : null };
  }
  throw new Error(`${where}: unreadable dose ${JSON.stringify(dose)}`);
}

function meItem(name, dose, intensity, where) {
  const q = meDose(dose, where);
  return {
    exercise_id: exerciseId(name.trim(), where), exercise: name.trim(),
    prescription_type: q.prescription_type, quantity: q.quantity, unit: q.unit,
    intensity: q.note ? `${intensity} · ${q.note}` : intensity,
    side_note: q.side_note ?? null,
  };
}

const ME_LINE = /^\s*(?:Min \d+\.|\d+\.)\s+(.+?)(?:\s+—\s+(.+))?$/;
const AFTER = /^\s*After each (?:round|rung):\s+(.+?)\s+—\s+(.+)$/;

function meBlocks(row) {
  const [head, ...rest] = row.ref_prescription.split('\n').map(l => l.replace(/\s+$/, ''));
  const spec = head.replace(/^B1 \[Main\]\s*/, '').trim();
  const intensity = row.intensity_target;
  const where = n => `${row.template_id} line ${n}`;

  const movements = [], notes = [];
  let after = null;
  rest.forEach((line, i) => {
    if (!line.trim()) return;
    let m;
    if ((m = line.match(AFTER))) after = { name: m[1], dose: m[2], where: where(i + 1) };
    else if ((m = line.match(ME_LINE))) movements.push({ name: m[1], dose: m[2] ?? null, where: where(i + 1) });
    else notes.push(line.trim());
  });
  const note = notes.join(' ');
  const block = (fields, items) => [{ block_type: 'rounds', title: 'Main', rounds: null,
    duration_minutes: null, rest_seconds: null, ...fields, items }];
  const fixed = () => movements.map(mv => {
    if (!mv.dose) throw new Error(`${mv.where}: no dose for ${mv.name}`);
    return meItem(mv.name, mv.dose, intensity, mv.where);
  });

  let m;
  if ((m = spec.match(/^EMOM, (\d+) min \((\d+) rounds\)$/))) {
    return block({ rounds: +m[2], duration_minutes: +m[1],
      instructions: `Every minute on the minute: one movement per minute, in order. ${note}`.trim() }, fixed());
  }
  if ((m = spec.match(/^(?:rounds, )?(\d+) rounds(?: for quality time)?$/))) {
    const r = note.match(/Rest (\d+)(?:-(\d+))?s after each round/);
    return block({ rounds: +m[1], rest_seconds: r ? top(num(r[1]), num(r[2])) : null,
      instructions: note || null }, fixed());
  }
  if ((m = spec.match(/^(?:chipper, complete in order|chipper)$/))) {
    return block({ block_type: 'continuous', instructions: `Complete in order. ${note}`.trim() }, fixed());
  }
  if ((m = spec.match(/^AMRAP, (\d+) min$/))) {
    return block({ block_type: 'continuous', duration_minutes: +m[1],
      instructions: `As many rounds as possible in ${m[1]} minutes. ${note}`.trim() }, fixed());
  }
  if ((m = spec.match(/^(descending|ascending) ladder, ([\d-]+) reps$/))) {
    // Each rung is written out, so the session says exactly what it asks for
    // rather than averaging a 12-10-8-6 into four nines.
    const rungs = m[2].split('-').map(Number);
    const items = [];
    for (const reps of rungs) {
      for (const mv of movements) {
        const each = /each side/.test(mv.dose ?? '');
        const split = /split evenly per side/.test(mv.dose ?? '');
        const it = meItem(mv.name, `${reps} reps`, intensity, mv.where);
        if (each) it.side_note = 'per side';
        if (split) it.side_note = 'split evenly between sides';
        items.push(it);
      }
      if (after) items.push(meItem(after.name, after.dose, intensity, after.where));
    }
    return block({ block_type: 'continuous',
      instructions: `${m[1] === 'descending' ? 'Descending' : 'Ascending'} ladder, ${m[2]} reps. ${note}`.trim() }, items);
  }
  throw new Error(`${row.template_id}: unreadable block header ${JSON.stringify(head)}`);
}

/* ── packs ────────────────────────────────────────────────────────────────── */

const grades = [];
for (const path of paths) {
  const rows = readCsv(readFileSync(path, 'utf8'));
  const isStrength = rows[0]?.training_domain === 'strength';
  const workouts = rows.map(row => {
    grades.push({
      template_id: row.template_id,
      technical_demand: Number(row.technical_demand),
      load_demand: Number(row.load_demand),
    });
    const blocks = isStrength ? strengthBlocks(row) : meBlocks(row);
    return {
      id: row.template_id,
      name: row.name,
      workout_family: row.workout_family,
      stimulus: row.stimulus,
      secondary_goal: row.secondary_goal || null,
      estimated_minutes: Number(row.estimated_minutes),
      intensity_target: row.intensity_target,
      impact_level: row.impact_level,
      hyrox_specificity: Number(row.hyrox_specificity),
      postpartum_friendly: row.postpartum_friendly === 'True',
      description: row.description,
      coaching_notes: row.coaching_notes,
      // Provenance. The importer and the classification passes decide these
      // from structure; the author's values are kept so a disagreement shows.
      authored_training_domain: row.training_domain,
      authored_session_type: row.session_type,
      authored_primary_goal: row.primary_goal,
      authored_archetype: row.strength_archetype || row.workout_format || null,
      blocks,
    };
  });
  const stem = basename(path).replace(/\.csv$/, '').replace(/^PIVOT_/, '').toLowerCase().replace(/_/g, '-');
  const pack = {
    meta: {
      pack: `PIVOT ${isStrength ? 'Strength' : 'Muscular Endurance'} Expansion v1`,
      workout_count: workouts.length,
      format: 'canonical-v1',
      source: `data/source/${basename(path)}`,
      converted_by: 'scripts/convert-expansion-csv.mjs',
      express_rule: isStrength
        ? 'drop accessory and trunk volume first; the anchor lifts keep their sets'
        : 'fewer rounds at the same per-round dose; never a faster clock',
      micro_rule: isStrength
        ? 'the anchor lift only, at the prescribed load; no intensity compensation'
        : 'two rounds of the first two movements; no intensity compensation',
    },
    workouts,
  };
  const out = new URL(`../data/${stem}.json`, import.meta.url);
  writeFileSync(out, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(`${basename(path)} → data/${stem}.json (${workouts.length} workouts)`);
}

const changeset = {
  meta: {
    changeset: 'expansion-demand',
    version: 'v1',
    sheets: paths.map(p => basename(p)),
    note: 'Demand grades authored with the strength and muscular endurance expansions. '
      + 'Applied by scripts/apply-demand-changeset.mjs --changeset data/review/expansion-demand.v1.changeset.json.',
  },
  grades,
  field_updates: [],
  prescription_edits: [],
  missing_from_sheet: [],
  problems: [],
};
writeFileSync(new URL('../data/review/expansion-demand.v1.changeset.json', import.meta.url),
  `${JSON.stringify(changeset, null, 2)}\n`);
console.log(`demand changeset → data/review/expansion-demand.v1.changeset.json (${grades.length} grades)`);
