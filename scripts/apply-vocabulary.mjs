/**
 * Reads the ruled reconciliation back, validates it, and reports what it WOULD
 * change. Writes nothing to the library.
 *
 * The reconciliation gate hands out two files with a pre-filled ruling per row.
 * This is the other half: it checks that the rulings are coherent before any
 * of them is allowed near canonical data, and prints the migration they
 * describe so the plan can be read before it is run.
 *
 * ── What it refuses ──────────────────────────────────────────────────────────
 *
 * A ruling is coherent when it can be executed without guessing. So:
 *
 *   * a disposition that points at an existing exercise must name one, and it
 *     must exist — a target id typed by hand is the likeliest error in the file
 *     and the one a spreadsheet dropdown could never catch;
 *   * NEW_CANONICAL must NOT name a target, or the row is claiming two things;
 *   * no two rows may claim the same existing id, and none may mint an id that
 *     already exists — either would fork the history attached to it;
 *   * nothing may still say REQUIRES_REVIEW, because unresolved is not a plan;
 *   * an exercise may only be deprecated if nothing references it. Live content
 *     pointing at a retired movement is how a template becomes unbuildable.
 *
 * ── Approval is separate from correctness ───────────────────────────────────
 *
 * The lifecycle is Review -> Approved -> Migrated/Created -> Content Eligible.
 * A row can carry a perfectly coherent ruling and still not be ready to build,
 * because nobody has approved it. Both numbers are reported: what is coherent,
 * and what is actually approved. Only the second is ever eligible to apply.
 *
 *   node scripts/apply-vocabulary.mjs [--quiet]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { readCsv } from './lib/csv.mjs';
import { buildPlan } from './lib/vocabulary-plan.mjs';

const quiet = process.argv.includes('--quiet');

const RECONCILE = new URL('../data/review/vocabulary.reconcile.csv', import.meta.url);
const ABSENT = new URL('../data/review/vocabulary.absent.csv', import.meta.url);
const DETAIL = new URL('../data/review/vocabulary.reconcile.json', import.meta.url);
const OUT = new URL('../data/review/vocabulary.apply-plan.json', import.meta.url);
const LIB = JSON.parse(readFileSync(new URL('../tests/engine-fixtures/content.json', import.meta.url), 'utf8'));

for (const [label, url] of [['reconcile', RECONCILE], ['absent', ABSENT], ['detail', DETAIL]]) {
  if (!existsSync(url)) {
    console.error(`missing ${label} file — run: npm run vocab:reconcile <workbook.xlsx>`);
    process.exit(1);
  }
}

const rulings = readCsv(readFileSync(RECONCILE, 'utf8'));
const absentRulings = readCsv(readFileSync(ABSENT, 'utf8'));
const detail = JSON.parse(readFileSync(DETAIL, 'utf8'));
const detailByName = new Map(detail.proposed.map(r => [r.proposed_name, r]));

const existingById = new Map(LIB.exercises.map(e => [e.id, e]));

const RULES = JSON.parse(readFileSync(
  new URL('../data/vocabulary-reconcile-rules.json', import.meta.url), 'utf8'));

const { errors, plan, deprecations, newEquipment } = buildPlan({
  rulings, absentRulings, detail, library: LIB, rules: RULES,
});

// ── Report ──────────────────────────────────────────────────────────────────

const approvedCount = xs => xs.filter(x => x.approved).length;
const buildable = [...plan.create, ...plan.variant, ...plan.update, ...plan.rename, ...plan.alias];

const report = {
  status: errors.length ? 'BLOCKED' : plan.unresolved.length ? 'INCOMPLETE' : 'COHERENT',
  gate: 'NOTHING IS WRITTEN BY THIS SCRIPT.',
  lifecycle: 'Review -> Approved -> Migrated/Created -> Content Eligible',
  errors,
  summary: {
    ruled_rows: rulings.length,
    still_requires_review: plan.unresolved.length,
    would_update_existing: plan.update.length,
    would_rename_existing: plan.rename.length,
    would_alias_existing: plan.alias.length,
    would_create_variant: plan.variant.length,
    would_create_new: plan.create.length,
    would_drop_duplicate: plan.drop.length,
    approved_and_ready: approvedCount(buildable),
    new_equipment_required: newEquipment.length,
    deprecations: deprecations.length,
    rows_with_unresolved_data_issues: buildable.filter(e => e.unresolved_issues.length).length,
  },
  new_equipment: newEquipment,
  deprecations,
  plan,
};

writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

if (!quiet) {
  console.log(`status: ${report.status}\n`);
  if (errors.length) {
    console.log(`${errors.length} error(s) block this plan:`);
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
    if (errors.length > 20) console.log(`  … and ${errors.length - 20} more`);
    console.log();
  }
  for (const [k, v] of Object.entries(report.summary)) {
    console.log(`  ${String(v).padStart(4)}  ${k.replace(/_/g, ' ')}`);
  }
  if (plan.unresolved.length) {
    console.log(`\n${plan.unresolved.length} row(s) still say REQUIRES_REVIEW — rule them before applying.`);
  }
  if (report.summary.approved_and_ready === 0) {
    console.log('\nNothing is approved yet, so nothing would be built even if applied.');
    console.log('Set Review status to "Approved" on the rows that are ready.');
  }
  console.log(`\n  -> data/review/vocabulary.apply-plan.json`);
}

// A blocked plan is an error; an incomplete one is a normal state to be in.
process.exit(errors.length ? 1 : 0);
