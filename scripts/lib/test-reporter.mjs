/**
 * A machine-readable reporter for `node --test`, so CI can tell a known
 * coverage gap from a new break.
 *
 * One JSON line per leaf test: its fully-qualified id and whether it passed.
 * Not a parse of the human reporter's output — that format is for people and
 * changes when it should, and a build that goes green because a bullet
 * character moved is worse than no build.
 *
 * ── The id ──────────────────────────────────────────────────────────────────
 *
 * `file :: describe > test`, because a leaf name alone is not unique. Three
 * suites in this repo have a test called "the fullest version that fits" or
 * similar, and an allowlist keyed on the leaf would suppress failures in files
 * nobody looked at.
 *
 * Ancestors come from `test:start`, which fires before a test's children and
 * carries its nesting depth; suites complete after their children, so the
 * completion events cannot be used to build the path. The stack is truncated on
 * each start so a sibling never inherits the previous branch's ancestors.
 */
export default async function* ciReporter(source) {
  const stack = [];

  for await (const event of source) {
    const { type, data } = event;

    if (type === 'test:start') {
      stack.length = data.nesting;
      stack[data.nesting] = data.name;
      continue;
    }

    if (type !== 'test:pass' && type !== 'test:fail') continue;
    // A suite's own pass/fail is the roll-up of its children, and counting it
    // would double every failure and put a suite name in the allowlist.
    if (data.details?.type === 'suite') continue;
    // A skipped or todo test is neither a pass nor a failure to act on.
    if (data.skip || data.todo) continue;

    const path = [...stack.slice(0, data.nesting), data.name].filter(Boolean);
    yield `${JSON.stringify({
      id: `${relative(data.file)} :: ${path.join(' > ')}`,
      ok: type === 'test:pass',
    })}\n`;
  }
}

/** Repo-relative, so an id does not change with the checkout directory. */
function relative(file) {
  if (!file) return '(unknown file)';
  const at = file.indexOf('/pivot/');
  return at === -1 ? file : file.slice(at + '/pivot/'.length);
}
