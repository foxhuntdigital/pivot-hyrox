/**
 * Re-applies local fixes to native dependencies after every install.
 *
 * `npm install` rewrites node_modules, so a fix made by hand there survives
 * exactly until the next install. This runs from `postinstall` and puts them
 * back. Each patch states the version it was written against and the upstream
 * problem it works around, so it is obvious when one has outlived its cause.
 *
 * A patch that no longer matches is not an error: the file may already be
 * fixed upstream. It reports and moves on rather than failing the install.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const patches = [
  {
    name: 'expo-modules-jsi',
    /**
     * Version this was written against. A different one still gets patched —
     * the edit is matched on content, not version — but the mismatch is worth
     * knowing about, because it means upstream has moved.
     */
    version: '57.0.5',
    file: 'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h',
    /**
     * Swift 6.3 / Xcode 26 rejects SWIFT_RETURNS_RETAINED on the constructors
     * of a SWIFT_SHARED_REFERENCE type:
     *
     *   error: 'RuntimeScheduler' cannot be annotated with either
     *   SWIFT_RETURNS_RETAINED or SWIFT_RETURNS_UNRETAINED because it is not
     *   returning a SWIFT_SHARED_REFERENCE type
     *
     * The annotations are redundant — a constructor of such a type already
     * returns +1 — so dropping them changes no ownership semantics, and
     * without them `expo run:ios` cannot build at all.
     */
    edits: [
      {
        from: '  SWIFT_RETURNS_RETAINED RuntimeScheduler(void *scheduler, ScheduleFn fn) noexcept',
        to: '  RuntimeScheduler(void *scheduler, ScheduleFn fn) noexcept',
      },
      {
        from: '  SWIFT_RETURNS_RETAINED RuntimeScheduler() {}',
        to: '  RuntimeScheduler() {}',
      },
    ],
  },
];

const root = new URL('..', import.meta.url);
let changed = 0;

for (const patch of patches) {
  const path = new URL(patch.file, root);
  if (!existsSync(path)) {
    console.log(`· ${patch.name}: not installed, skipping`);
    continue;
  }

  const manifest = new URL(`node_modules/${patch.name}/package.json`, root);
  const installed = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, 'utf8')).version : null;
  if (installed && installed !== patch.version) {
    console.log(`· ${patch.name}: installed ${installed}, patch written against `
      + `${patch.version} — check whether it is still needed`);
  }

  const before = readFileSync(path, 'utf8');
  let after = before;
  let applied = 0;
  let already = 0;

  for (const edit of patch.edits) {
    if (after.includes(edit.from)) {
      after = after.replace(edit.from, edit.to);
      applied++;
    } else if (after.includes(edit.to)) {
      already++;
    }
  }

  if (applied) {
    writeFileSync(path, after);
    changed++;
    console.log(`✓ ${patch.name}: applied ${applied} edit${applied === 1 ? '' : 's'}`);
  } else if (already === patch.edits.length) {
    console.log(`· ${patch.name}: already patched`);
  } else {
    console.log(`· ${patch.name}: no edit matched — likely fixed upstream, `
      + 'remove this patch if so');
  }
}

if (changed) console.log('  (native pods rebuild on the next `expo run:ios`)');
