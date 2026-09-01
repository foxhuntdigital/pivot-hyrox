/**
 * The migration gate for the canonical exercise vocabulary. IMPORTS NOTHING.
 *
 * The review workbook proposes 212 canonical exercises. The library has 46, of
 * which 22 match by name, four were renamed, and six that the live templates
 * and substitution graph depend on are absent entirely. Importing that as a
 * replacement would create a second Deadlift, orphan the history attached to
 * the first, and quietly delete the exercise that makes HYROX Push A reachable
 * without a barbell.
 *
 * So this resolves every proposed row into one of seven dispositions and
 * writes a report. Nothing reaches the dump until a human has ruled on it, and
 * every row stays `Review` — the 212 were an over-complete candidate list, not
 * 212 approved production exercises.
 *
 *   EXACT_EXISTING       same canonical exercise; preserve the id
 *   RENAME_EXISTING      same exercise, new preferred name; preserve the id
 *   ALIAS_EXISTING       alternate terminology; preserve id, add an alias
 *   VARIANT_OF_EXISTING  a real variant deserving its own id, with a parent
 *   NEW_CANONICAL        genuinely new movement
 *   DUPLICATE_CANDIDATE  adds no distinction over another proposed row
 *   REQUIRES_REVIEW      ambiguous; a human decides
 *
 * And for every existing exercise absent from the sheet: KEEP_EXISTING or
 * DEPRECATION_CANDIDATE. Never an implicit delete.
 *
 * ── What this script will and will not decide ────────────────────────────────
 *
 * It auto-classifies only what a string comparison can honestly settle: an
 * exact normalised name match. Every other relationship — that "Conventional
 * Deadlift" is the deadlift we already have, that `dumbbell` means `db` — is a
 * human ruling read from data/vocabulary-reconcile-rules.json. Where a row
 * merely LOOKS related to something, it is reported as REQUIRES_REVIEW with
 * the candidate named, rather than guessed into a disposition.
 *
 *   node scripts/reconcile-vocabulary.mjs <workbook.xlsx> [--quiet]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

import { readWorkbook, asTable } from './lib/xlsx.mjs';

const workbookPath = process.argv.find(a => a.endsWith('.xlsx'));
const quiet = process.argv.includes('--quiet');
if (!workbookPath) {
  console.error('usage: node scripts/reconcile-vocabulary.mjs <workbook.xlsx>');
  process.exit(1);
}

const RULES = JSON.parse(readFileSync(new URL('../data/vocabulary-reconcile-rules.json', import.meta.url), 'utf8'));
const LIB = JSON.parse(readFileSync(new URL('../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));
const OUT_JSON = new URL('../data/review/vocabulary.reconcile.json', import.meta.url);
const OUT_CSV = new URL('../data/review/vocabulary.reconcile.csv', import.meta.url);
const OUT_ABSENT_CSV = new URL('../data/review/vocabulary.absent.csv', import.meta.url);

/** Vocabularies the schema constrains (migrations 0014 + the approved additions). */
const VOCAB = {
  movement_families: 'squat hinge lunge horizontal_push vertical_push horizontal_pull vertical_pull carry trunk rotation olympic_explosive jump_plyometric ground_get_up sled_resisted_locomotion complex_total_body accessory_isolation',
  training_qualities: 'absolute_strength functional_strength hypertrophy power plyometric_reactive strength_endurance athletic_multiplanar integrated_complex structural_resilience',
  movement_characters: 'foundational simple complex unilateral bilateral contralateral ipsilateral explosive reactive ballistic rotational multiplanar loaded_locomotion stability_demanding technical hybrid_specific anti_rotation anti_lateral_flexion anti_extension dynamic',
  exercise_role_eligibility: 'primer power primary_strength secondary_strength accessory trunk_carry finisher',
  progression_tracks: 'load reps volume tempo range_of_motion distance density technical velocity plyometric work_rest duration complexity none',
};
const ALLOWED = Object.fromEntries(
  Object.entries(VOCAB).map(([k, v]) => [k, new Set(v.split(' '))]));
const PROGRESSION_CLASSES = new Set(['anchor', 'accessory_anchor', 'developmental', 'variable_complex']);
const COMPLEXITY = new Set(['basic', 'intermediate', 'advanced']);

const EQUIPMENT = new Set(LIB.equipment.map(e => e.id));

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = s => 'ex_' + String(s ?? '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const split = v => String(v ?? '').split('|').map(x => x.trim()).filter(Boolean);

/** Content words, for spotting a row that looks related to something existing. */
const STOP = new Set(['the', 'a', 'and', 'with', 'to', 'of', 'arm', 'leg', 'single', '1']);
const words = s => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const tokens = s => new Set(words(s).filter(w => !STOP.has(w)));

/**
 * The movement itself, as opposed to how it is loaded or set up.
 *
 * "Incline DB Curl" and "Incline DB Press" share two words out of three and are
 * not the same exercise; "DB Bench Press" and "Incline DB Press" share two and
 * are worth a ruling. Shared-word counting cannot tell those apart, and a
 * report that cries wolf on curls is one a reviewer stops reading.
 *
 * The head noun is the last content word — press, row, squat, curl, carry —
 * which is the part of an English exercise name that says what it is. The
 * modifiers in front say how.
 */
const headNoun = (s) => {
  const w = words(s).filter(x => !STOP.has(x));
  return w.length ? w[w.length - 1].replace(/s$/, '') : '';
};

// ── Inputs ───────────────────────────────────────────────────────────────────

const wb = readWorkbook(workbookPath);
const sheet = wb.get('Canonical Vocabulary');
if (!sheet) {
  console.error(`workbook has no "Canonical Vocabulary" sheet; found: ${[...wb.keys()].join(', ')}`);
  process.exit(1);
}
const proposed = asTable(sheet);
const ladders = wb.has('Progression Ladders') ? asTable(wb.get('Progression Ladders')) : [];

const existingByNorm = new Map(LIB.exercises.map(e => [norm(e.name), e]));
const existingById = new Map(LIB.exercises.map(e => [e.id, e]));

/** Exercises the live library actually references, and where. */
const references = new Map();
for (const t of LIB.templates) {
  for (const b of t.blocks) {
    for (const be of b.exercises) {
      (references.get(be.exercise_id) ?? references.set(be.exercise_id, []).get(be.exercise_id))
        .push(`template ${t.id}`);
    }
  }
}
for (const s of LIB.substitutions) {
  (references.get(s.exercise_id) ?? references.set(s.exercise_id, []).get(s.exercise_id))
    .push(`substitution from ${s.exercise_id}`);
  (references.get(s.substitute_exercise_id) ?? references.set(s.substitute_exercise_id, []).get(s.substitute_exercise_id))
    .push(`substitution to ${s.substitute_exercise_id}`);
}

// ── Row-level reconciliation ────────────────────────────────────────────────

const rows = [];
const seenSlug = new Map();

for (const [i, p] of proposed.entries()) {
  const name = p.Exercise?.trim();
  if (!name) continue;

  const issues = [];
  const key = norm(name);
  const proposedId = slug(name);

  // Vocabulary conformance, reported per row so a fix is addressable.
  const fields = {
    movement_families: split(p['Movement family']),
    training_qualities: split(p['Training quality']),
    movement_characters: split(p['Movement character']),
    exercise_role_eligibility: split(p['Role eligibility']),
    progression_tracks: split(p['Progression tracks']),
  };
  for (const [field, values] of Object.entries(fields)) {
    for (const v of values) {
      if (!ALLOWED[field].has(v)) issues.push(`unknown ${field}: ${v}`);
    }
  }
  const complexity = (p.Complexity || '').trim();
  if (complexity && !COMPLEXITY.has(complexity)) issues.push(`unknown complexity: ${complexity}`);

  // Equipment: alias what a ruling covers, flag what is genuinely new.
  const equipment = [];
  for (const raw of split(p.Equipment)) {
    const mapped = RULES.equipment_aliases[raw] ?? raw;
    if (EQUIPMENT.has(mapped)) {
      equipment.push({ token: raw, resolved: mapped, status: raw === mapped ? 'known' : 'aliased' });
    } else if (RULES.equipment_new[mapped]) {
      const { tier, category } = RULES.equipment_new[mapped];
      equipment.push({ token: raw, resolved: mapped, status: 'new', proposed_tier: tier, proposed_category: category });
    } else {
      equipment.push({ token: raw, resolved: mapped, status: 'unresolved' });
      issues.push(`equipment token has no ruling: ${raw}`);
    }
  }

  // Bucket and the progression class it implies.
  const rawBucket = (p['50/25/25 bucket'] || '').trim();
  const bucketRule = RULES.bucket_normalisation[rawBucket];
  if (rawBucket && !bucketRule) issues.push(`unknown 50/25/25 bucket: ${rawBucket}`);

  const sheetClass = (p['Progression class'] || '').trim();
  if (sheetClass && !PROGRESSION_CLASSES.has(sheetClass)) {
    issues.push(`unknown progression class: ${sheetClass}`);
  }
  let proposedClass = sheetClass;
  if (bucketRule?.implies_class && bucketRule.implies_class !== sheetClass) {
    // Reported, never applied. The bucket says what kind of exposure this is;
    // the class says how the progression engine treats it. One must not be
    // silently derived from the other.
    issues.push(
      `bucket "${rawBucket}" implies progression_class ${bucketRule.implies_class}, `
      + `sheet says ${sheetClass || 'nothing'} — set it at source`);
    proposedClass = null;
  }

  // Disposition.
  let disposition, targetId = null, note = '';
  const renameTarget = RULES.renames[name];
  const exact = existingByNorm.get(key);

  if (exact) {
    disposition = 'EXACT_EXISTING';
    targetId = exact.id;
    note = 'name matches an existing exercise exactly';
  } else if (renameTarget) {
    if (!existingById.has(renameTarget)) {
      disposition = 'REQUIRES_REVIEW';
      note = `rename ruling points at ${renameTarget}, which is not in the library`;
    } else {
      disposition = 'RENAME_EXISTING';
      targetId = renameTarget;
      note = `preferred name for ${renameTarget} (was "${existingById.get(renameTarget).name}")`;
    }
  } else {
    // Nothing certain. Look for a relative and hand it to a human rather than
    // inventing a relationship: "Split-Stance Cable Row" and "Cable Row" share
    // every word and are not the same prescription.
    const mine = tokens(name);
    const myHead = headNoun(name);
    const myMods = new Set([...mine].filter(w => w.replace(/s$/, '') !== myHead));

    const near = LIB.exercises
      .map(e => {
        const theirs = tokens(e.name);
        const theirHead = headNoun(e.name);
        const theirMods = new Set([...theirs].filter(w => w.replace(/s$/, '') !== theirHead));
        const sharedMods = [...myMods].filter(w => theirMods.has(w)).length;
        // One name wholly inside the other: "Trap-Bar Deadlift" contains
        // "Deadlift", which is the clearest variant signal there is and the one
        // a shared-modifier count misses, because the shorter name has none.
        const contains = [...theirs].every(w => mine.has(w))
          || [...mine].every(w => theirs.has(w));
        return { id: e.id, name: e.name, sameHead: theirHead === myHead, sharedMods, contains };
      })
      /**
       * Related means the same movement, differently set up or differently
       * loaded. Three tests, all necessary:
       *
       *   same head noun    — a curl is not a press, however alike the names
       *   AND a shared modifier or containment
       *                     — without it every press matches every other press,
       *                       and a report that flags Bench Press against Push
       *                       Press is one a reviewer stops reading
       */
      .filter(c => c.sameHead && (c.sharedMods >= 1 || c.contains))
      .sort((a, b) => (b.contains - a.contains) || (b.sharedMods - a.sharedMods))
      .slice(0, 3);

    if (near.length) {
      disposition = 'REQUIRES_REVIEW';
      note = `looks related to ${near.map(c => `${c.id} (${c.name})`).join(', ')}`
        + ' — rule ALIAS_EXISTING, VARIANT_OF_EXISTING or NEW_CANONICAL';
    } else {
      disposition = 'NEW_CANONICAL';
      note = 'no existing exercise resembles this';
    }
  }

  // Two proposed rows landing on one id is a duplicate candidate, whichever
  // disposition they carry.
  if (seenSlug.has(proposedId)) {
    disposition = 'DUPLICATE_CANDIDATE';
    note = `same proposed id as "${seenSlug.get(proposedId)}"`;
  } else {
    seenSlug.set(proposedId, name);
  }

  rows.push({
    row: i + 2,
    proposed_name: name,
    disposition,
    existing_id: targetId,
    proposed_id: targetId ?? proposedId,
    canonical_name: name,
    aliases: targetId && existingById.get(targetId)?.name !== name
      ? [existingById.get(targetId).name] : [],
    movement_families: fields.movement_families,
    training_qualities: fields.training_qualities,
    movement_characters: fields.movement_characters,
    complexity_level: complexity || null,
    exercise_role_eligibility: fields.exercise_role_eligibility,
    progression_class: proposedClass || null,
    progression_class_in_sheet: sheetClass || null,
    progression_tracks: fields.progression_tracks,
    methodology_bucket: bucketRule?.bucket ?? null,
    bucket_in_sheet: rawBucket || null,
    variant_parent: (p['Progression / prerequisite family'] || '').trim() || null,
    equipment,
    review_status: (p['Review status'] || 'Review').trim(),
    review_notes: (p['Review notes'] || '').trim(),
    issues,
    note,
  });
}

// ── Existing exercises absent from the sheet ────────────────────────────────

const proposedNorms = new Set(rows.map(r => norm(r.proposed_name)));
const claimed = new Set(rows.map(r => r.existing_id).filter(Boolean));
const outOfScope = new Set(RULES.keep_existing.out_of_scope);
const productRuling = new Set(RULES.keep_existing.product_ruling);

const absent = [];
for (const e of LIB.exercises) {
  if (claimed.has(e.id) || proposedNorms.has(norm(e.name))) continue;
  const used = references.get(e.id) ?? [];
  const disposition = (outOfScope.has(e.id) || productRuling.has(e.id) || used.length)
    ? 'KEEP_EXISTING' : 'DEPRECATION_CANDIDATE';
  absent.push({
    id: e.id,
    name: e.name,
    disposition,
    referenced_by: used.length,
    reason: outOfScope.has(e.id) ? 'out of scope: not a strength movement'
      : productRuling.has(e.id) ? 'kept by product ruling'
      : used.length ? `referenced by ${used.length} live reference(s)`
      : 'unreferenced and absent from the sheet — review for deliberate deprecation',
  });
}

// ── Report ──────────────────────────────────────────────────────────────────

const count = (xs, k) => xs.reduce((m, x) => (m[x[k]] = (m[x[k]] ?? 0) + 1, m), {});

const equipmentSummary = {};
for (const r of rows) {
  for (const e of r.equipment) {
    const s = equipmentSummary[e.resolved] ??= { status: e.status, uses: 0, from: new Set() };
    s.uses++; s.from.add(e.token);
    if (e.proposed_tier) s.proposed_tier = e.proposed_tier;
  }
}
for (const v of Object.values(equipmentSummary)) v.from = [...v.from];

const report = {
  generated_from: workbookPath.split('/').pop(),
  gate: 'NOTHING IS IMPORTED BY THIS SCRIPT. Every row stays Review until ruled on.',
  lifecycle: 'Review -> Approved -> Migrated/Created -> Content Eligible',
  summary: {
    proposed_rows: rows.length,
    dispositions: count(rows, 'disposition'),
    rows_with_issues: rows.filter(r => r.issues.length).length,
    existing_exercises: LIB.exercises.length,
    existing_absent_from_sheet: absent.length,
    absent_dispositions: count(absent, 'disposition'),
  },
  equipment: equipmentSummary,
  proposed: rows,
  absent_from_sheet: absent,
  progression_ladders: ladders,
};

mkdirSync(new URL('../data/review/', import.meta.url), { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');

/**
 * A ruled file is an input, not an output.
 *
 * Regenerating the report is the natural thing to do after any change to the
 * workbook or the rules — and doing it after a review has been completed would
 * silently overwrite every ruling with the gate's own proposals. Hours of
 * canonical-identity decisions, gone, with a cheerful summary printed over the
 * top of them.
 *
 * So the CSV is only written when it does not exist, or when nothing in it has
 * been ruled on yet. A file that has been touched is preserved and the new
 * proposals go beside it as `.new`, for a human to merge.
 */
function hasRulings(url) {
  if (!existsSync(url)) return false;
  const [header, ...lines] = readFileSync(url, 'utf8').split('\n').filter(Boolean);
  const cols = header.split(',');
  const ruling = cols.indexOf('ruling');
  const gate = cols.indexOf('gate_disposition');
  const status = cols.indexOf('review_status');
  if (ruling < 0) return false;
  return lines.some(line => {
    const cells = line.split(',').map(c => c.replace(/^"|"$/g, ''));
    return (gate >= 0 && cells[ruling] !== cells[gate])
      || (status >= 0 && /approved/i.test(cells[status] ?? ''));
  });
}

/**
 * The review file.
 *
 * Ruling columns come first and are PRE-FILLED with what the gate proposes, so
 * a reviewer changes only what is wrong rather than transcribing 212 rows.
 * `ruling` left as the gate proposed it means "agreed"; everything after
 * `review_status` is context the gate supplies and the reviewer does not edit.
 *
 * CSV rather than a workbook on purpose: these are canonical identity
 * decisions, and in a text file a ruling is a reviewable line in a diff —
 * who changed which exercise's identity, and when. A binary workbook loses
 * exactly the history this data most needs. The validation a spreadsheet's
 * dropdowns would give is done on the way back in instead, where it can also
 * check that a target id actually exists.
 */
const csvCols = [
  // ── edit these ──────────────────────────────────────────────────────────
  'ruling', 'ruling_target_id', 'ruling_aliases', 'ruling_variant_parent', 'ruling_notes',
  // ── context ─────────────────────────────────────────────────────────────
  'row', 'proposed_name', 'proposed_id', 'gate_disposition', 'existing_id',
  'progression_class_in_sheet', 'progression_class', 'bucket_in_sheet', 'methodology_bucket',
  'review_status', 'issues', 'note',
];

const csvValue = (v) => `"${String(Array.isArray(v) ? v.join('; ') : (v ?? '')).replace(/"/g, '""')}"`;

const csv = [csvCols.join(',')];
for (const r of rows) {
  const record = {
    ...r,
    gate_disposition: r.disposition,
    // Pre-filled with the proposal. Overwrite to overrule it.
    ruling: r.disposition,
    ruling_target_id: r.existing_id ?? '',
    ruling_aliases: r.aliases,
    ruling_variant_parent: r.variant_parent ?? '',
    ruling_notes: '',
  };
  csv.push(csvCols.map(c => csvValue(record[c])).join(','));
}
const reconcileRuled = hasRulings(OUT_CSV);
writeFileSync(
  reconcileRuled ? new URL(`${OUT_CSV.pathname}.new`, 'file://') : OUT_CSV,
  csv.join('\n') + '\n');

/**
 * The other half of the ruling, and the one that is easy to forget: every
 * existing exercise the sheet does not mention. Absence is not a decision, so
 * each one is listed with a disposition to confirm rather than being silently
 * carried forward or silently dropped.
 */
const absentCols = ['ruling', 'ruling_notes', 'id', 'name', 'gate_disposition',
  'referenced_by', 'reason'];
const absentCsv = [absentCols.join(',')];
for (const a of absent) {
  absentCsv.push(absentCols.map(c => csvValue(
    c === 'ruling' ? a.disposition
    : c === 'ruling_notes' ? ''
    : c === 'gate_disposition' ? a.disposition
    : a[c])).join(','));
}
const absentRuled = hasRulings(OUT_ABSENT_CSV);
writeFileSync(
  absentRuled ? new URL(`${OUT_ABSENT_CSV.pathname}.new`, 'file://') : OUT_ABSENT_CSV,
  absentCsv.join('\n') + '\n');

if (!quiet) {
  console.log(`reconciled ${rows.length} proposed rows against ${LIB.exercises.length} existing\n`);
  for (const [d, n] of Object.entries(report.summary.dispositions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${d}`);
  }
  console.log(`\n  ${report.summary.rows_with_issues} row(s) carry a data issue`);
  console.log(`\nexisting exercises absent from the sheet: ${absent.length}`);
  for (const [d, n] of Object.entries(report.summary.absent_dispositions)) {
    console.log(`  ${String(n).padStart(4)}  ${d}`);
  }
  const dep = absent.filter(a => a.disposition === 'DEPRECATION_CANDIDATE');
  if (dep.length) for (const a of dep) console.log(`        ${a.id} — ${a.reason}`);

  const newEq = Object.entries(equipmentSummary).filter(([, v]) => v.status === 'new');
  console.log(`\nequipment: ${Object.keys(equipmentSummary).length} tokens, ${newEq.length} new`);
  for (const [id, v] of newEq.sort((a, b) => b[1].uses - a[1].uses)) {
    console.log(`  ${String(v.uses).padStart(4)}  ${id.padEnd(16)} proposed tier: ${v.proposed_tier}`);
  }
  if (reconcileRuled || absentRuled) {
    console.log('\nA completed review is already on disk and was NOT overwritten.');
    console.log('New proposals were written alongside it as *.csv.new — merge by hand.');
  }
  console.log(`\n  -> data/review/vocabulary.reconcile.csv   ${rows.length} rows to rule on`);
  console.log(`  -> data/review/vocabulary.absent.csv      ${absent.length} existing exercises to confirm`);
  console.log(`  -> data/review/vocabulary.reconcile.json  full detail`);
}
