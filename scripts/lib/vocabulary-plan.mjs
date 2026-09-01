/**
 * Turns a set of rulings into a migration plan, or into the reasons it is not
 * one yet. Pure: no files, no console, no process — so every refusal below is
 * directly testable, which is the point. A validation rule nobody exercises is
 * the rule that lets a bad ruling reach canonical data.
 *
 * Called by scripts/apply-vocabulary.mjs, which supplies the files.
 */

/**
 * Instruction-shaped language in a free-text note.
 *
 * A reviewer writing "CREATE_AS: Cable Fly" in a notes column means it, and a
 * pipeline that treats notes as decoration will drop that on the floor and
 * create an exercise under the wrong name. So notes are never PARSED as
 * instructions — that is fragile in the other direction — but they are
 * SCANNED, and any row carrying an instruction the rules file does not encode
 * is an error. The reviewer's intent either reaches the plan explicitly or
 * stops it.
 */
const INSTRUCTION_PATTERNS = [
  { re: /CREATE_AS/i, rule: 'create_as', label: 'a CREATE_AS name override' },
  { re: /progression_class\s*=\s*accessory_anchor|accept the bucket implication|source correction/i,
    rule: 'accessory_anchor', label: 'an accessory_anchor class correction' },
];

export function buildPlan({ rulings, absentRulings, detail, library, rules = {} }) {
  const existingById = new Map(library.exercises.map(e => [e.id, e]));
  const detailByName = new Map(detail.proposed.map(r => [r.proposed_name, r]));

/** Dispositions that name an existing exercise, and what they do to it. */
  const TARGETED = {
    EXACT_EXISTING: 'ontology update, id and name unchanged',
    RENAME_EXISTING: 'ontology update, canonical name replaced, old name kept as an alias',
    ALIAS_EXISTING: 'ontology update, proposed name added as an alias',
    VARIANT_OF_EXISTING: 'new exercise created with a parent relationship',
  };
  const UNTARGETED = {
    NEW_CANONICAL: 'new exercise created',
    DUPLICATE_CANDIDATE: 'dropped; adds no distinction',
  };
  const LEGAL = new Set([...Object.keys(TARGETED), ...Object.keys(UNTARGETED), 'REQUIRES_REVIEW']);
  
  /** Which exercises live content points at, so a deprecation can be refused. */
  const references = new Map();
  const note = (id, what) => {
    if (!id) return;
    if (!references.has(id)) references.set(id, []);
    references.get(id).push(what);
  };
  for (const t of library.templates) {
    for (const b of t.blocks) for (const be of b.exercises) note(be.exercise_id, `template ${t.id}`);
  }
  for (const s of library.substitutions) {
    note(s.exercise_id, `substitution ${s.exercise_id}->${s.substitute_exercise_id}`);
    note(s.substitute_exercise_id, `substitution ${s.exercise_id}->${s.substitute_exercise_id}`);
  }
  
  // ── Validation ──────────────────────────────────────────────────────────────
  
    const errors = [];
  const claimedExisting = new Map();
  const mintedIds = new Map();
  const plan = { update: [], rename: [], alias: [], variant: [], create: [], drop: [], unresolved: [] };
  
  for (const r of rulings) {
    const where = `row ${r.row || '?'} "${r.proposed_name}"`;
    const ruling = (r.ruling || '').trim();
    const target = (r.ruling_target_id || '').trim();
  
    if (!LEGAL.has(ruling)) {
      errors.push(`${where}: "${ruling || '(blank)'}" is not a disposition`);
      continue;
    }
    if (ruling === 'REQUIRES_REVIEW') {
      plan.unresolved.push({ name: r.proposed_name, note: r.note });
      continue;
    }
  
    if (ruling in TARGETED) {
      if (!target) {
        errors.push(`${where}: ${ruling} needs a ruling_target_id`);
        continue;
      }
      if (!existingById.has(target)) {
        errors.push(`${where}: ruling_target_id "${target}" is not an exercise in the library`);
        continue;
      }
      // VARIANT_OF mints a new id and merely points at its parent, so it is the
      // one targeted disposition that does not consume the target exclusively.
      if (ruling !== 'VARIANT_OF_EXISTING') {
        if (claimedExisting.has(target)) {
          errors.push(`${where}: ${target} is already claimed by "${claimedExisting.get(target)}"`);
          continue;
        }
        claimedExisting.set(target, r.proposed_name);
      }
    } else if (target) {
      errors.push(`${where}: ${ruling} must not name a ruling_target_id (found "${target}")`);
      continue;
    }
  
    const d = detailByName.get(r.proposed_name);

    /**
     * The ruling must belong to a row the gate actually proposed.
     *
     * If it does not, the two files have come apart: the CSV was regenerated
     * against a different workbook, rows were reordered by hand, or — the case
     * that found this check — a comma was typed into an unquoted note and every
     * column after it shifted by one. A shifted row still looks like a valid
     * NEW_CANONICAL, so without this it passes review and mints an exercise
     * named after whatever landed in the name column.
     */
    if (!d) {
      errors.push(`${where}: no proposed row by this name in the reconciliation report — `
        + 'the ruling file and the report have come apart (a stray comma in an '
        + 'unquoted note will do it). Re-run vocab:reconcile and re-apply the rulings.');
      continue;
    }
    const newId = ruling === 'VARIANT_OF_EXISTING' || ruling === 'NEW_CANONICAL'
      ? (r.proposed_id || d?.proposed_id) : null;
  
    if (newId) {
      if (existingById.has(newId)) {
        errors.push(`${where}: would mint "${newId}", which already exists — rule it as an existing disposition instead`);
        continue;
      }
      if (mintedIds.has(newId)) {
        errors.push(`${where}: id "${newId}" is already minted by "${mintedIds.get(newId)}"`);
        continue;
      }
      mintedIds.set(newId, r.proposed_name);
    }
  
    // ── Product rulings, applied from the rules file ────────────────────────
    const createAs = rules.create_as?.[r.proposed_name];
    const canonicalName = createAs?.canonical_name ?? r.proposed_name;
    const extraAliases = createAs?.aliases ?? [];

    const bucketImplied = rules.accept_bucket_implies_class
      && /accessory/i.test(r.bucket_in_sheet || '') ? 'accessory_anchor' : null;
    const override = rules.progression_class_overrides?.[r.proposed_name];
    const resolvedClass = override ?? bucketImplied
      ?? (r.progression_class || d?.progression_class) ?? null;

    // Every instruction in a note must have a rule behind it.
    for (const { re, rule, label } of INSTRUCTION_PATTERNS) {
      if (!re.test(r.ruling_notes || '')) continue;
      const encoded = rule === 'create_as'
        ? Boolean(createAs)
        : Boolean(override || bucketImplied);
      if (!encoded) {
        errors.push(`${where}: the note carries ${label}, and no rule in `
          + 'data/vocabulary-reconcile-rules.json encodes it — it would be dropped silently');
      }
    }

    const approved = /^approved$/i.test(r.review_status || '');
    const entry = {
      name: canonicalName,
      proposed_name: r.proposed_name,
      renamed_before_creation: canonicalName !== r.proposed_name,
      id: newId ?? target,
      parent: ruling === 'VARIANT_OF_EXISTING' ? target : null,
      aliases: [...new Set([
        ...(r.ruling_aliases || '').split(';').map(s => s.trim()).filter(Boolean),
        ...extraAliases,
      ])],
      variant_parent: (r.ruling_variant_parent || '').trim() || null,
      approved,
      effect: TARGETED[ruling] ?? UNTARGETED[ruling],
      ontology: d ? {
        movement_families: d.movement_families,
        training_qualities: d.training_qualities,
        movement_characters: d.movement_characters,
        complexity_level: d.complexity_level,
        exercise_role_eligibility: d.exercise_role_eligibility,
        progression_class: resolvedClass,
        progression_class_source: override ? 'product override'
          : bucketImplied ? 'accepted bucket implication'
          : 'sheet',
        progression_tracks: d.progression_tracks,
        methodology_bucket: d.methodology_bucket,
        equipment: d.equipment?.map(e => e.resolved) ?? [],
      } : null,
      // An issue the rules now answer is not unresolved. The bucket-implication
      // warning exists to stop the class being derived silently; once product
      // has ruled that it may be derived, the warning has done its job.
      unresolved_issues: (d?.issues ?? []).filter(i =>
        !(rules.accept_bucket_implies_class && /implies progression_class/.test(i))),
    };
  
    ({
      EXACT_EXISTING: plan.update, RENAME_EXISTING: plan.rename, ALIAS_EXISTING: plan.alias,
      VARIANT_OF_EXISTING: plan.variant, NEW_CANONICAL: plan.create, DUPLICATE_CANDIDATE: plan.drop,
    })[ruling].push(entry);
  }
  
  // ── Absent exercises ────────────────────────────────────────────────────────
  
  const ABSENT_LEGAL = new Set(['KEEP_EXISTING', 'DEPRECATION_CANDIDATE']);
  const deprecations = [];
  for (const a of absentRulings) {
    const ruling = (a.ruling || '').trim();
    if (!ABSENT_LEGAL.has(ruling)) {
      errors.push(`absent "${a.id}": "${ruling || '(blank)'}" is not KEEP_EXISTING or DEPRECATION_CANDIDATE`);
      continue;
    }
    if (ruling !== 'DEPRECATION_CANDIDATE') continue;
  
    const used = references.get(a.id) ?? [];
    if (used.length) {
      errors.push(
        `absent "${a.id}": cannot deprecate — ${used.length} live reference(s), e.g. ${used[0]}`);
      continue;
    }
    deprecations.push({ id: a.id, name: a.name, note: a.ruling_notes || '' });
  }
  
  // ── Equipment ───────────────────────────────────────────────────────────────
  
  const newEquipment = Object.entries(detail.equipment ?? {})
    .filter(([, v]) => v.status === 'new')
    .map(([id, v]) => ({ id, uses: v.uses, proposed_tier: v.proposed_tier }));

  return { errors, plan, deprecations, newEquipment, references };
}
