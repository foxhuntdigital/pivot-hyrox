/**
 * The build gate: every test must pass, except the ones we have written down.
 *
 * The repo carries nine failing tests that are not regressions. They are
 * coverage floors the library does not yet meet — threshold and recovery
 * content a dumbbell athlete cannot reach, and a taper phase with nothing to
 * offer — exposed deliberately when the reclassification stopped counting
 * mislabelled sessions. They are content debt, and they are real.
 *
 * Pointing CI at `npm test` would therefore make every build red from the first
 * day, and a permanently red build teaches everyone to ignore it, which is
 * worse than no build at all. Dropping the coverage suite into a non-blocking
 * "report" job would make the gap background noise, which is how a known gap
 * becomes a forgotten one.
 *
 * So the exceptions are enumerated, in version control, by exact test id.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 *
 *   * every test not on the list must pass;
 *   * a listed test that FAILS is expected, and reported as such;
 *   * a listed test that PASSES fails the build — resolved debt has to be
 *     removed from the list, or the list becomes a graveyard of exceptions
 *     nobody can tell from live ones;
 *   * a listed id that no longer exists fails the build, because a renamed or
 *     deleted test would otherwise carry its exception silently to a test that
 *     never earned one;
 *   * growth is visible in review, because the list is a file in the repo and
 *     an addition is a diff someone has to approve.
 *
 * The summary says `N pass / M expected fail / K unexpected fail` rather than
 * "green", so nobody reads a passing build as a complete one.
 *
 *   node scripts/ci.mjs [--quiet]
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTER = fileURLToPath(new URL('./lib/test-reporter.mjs', import.meta.url));
const EXPECTED = JSON.parse(
  readFileSync(new URL('../expected-failures.json', import.meta.url), 'utf8'));

/**
 * The node suites, mirroring package.json.
 *
 * Stated here rather than shelled through the npm scripts because the reporter
 * flags have to sit among node's own options, and appending them to
 * `npm run engine:test --` would hand them to the test runner as file patterns.
 * `npm test` still runs the same suites the same way; this adds the reporter.
 */
const SUITES = [
  { name: 'engine', cwd: 'packages/engine', args: ['--experimental-strip-types', '--test', 'src/*.test.ts'] },
  { name: 'coach', cwd: 'packages/coach', args: ['--experimental-strip-types', '--test', 'src/*.test.ts'] },
  { name: 'functions', cwd: '.', args: ['--experimental-strip-types', '--test', 'supabase/functions/_shared/*.test.ts'] },
  { name: 'mobile', cwd: '.', args: ['--experimental-strip-types', '--test', 'apps/mobile/src/**/*.test.ts'] },
  { name: 'scripts', cwd: '.', args: ['--test', 'scripts/lib/*.test.mjs'] },
];

/**
 * Gates with no per-test identity, and so no exceptions available.
 *
 * The Deno type-check and the Deno tests are all-or-nothing: they pass or the
 * build fails. `npm test` omits both, which is exactly why CI must not be
 * `npm test`.
 */
const WHOLE_GATES = [
  { name: 'deno check', command: 'npm', args: ['run', 'functions:check'] },
  { name: 'deno tests', command: 'npm', args: ['run', 'functions:test:deno'] },
];

const quiet = process.argv.includes('--quiet');

function run(command, args, cwd) {
  return new Promise(resolve => {
    // No shell: node --test expands its own glob patterns, and passing args
    // through a shell means quoting them correctly for ever.
    const child = spawn(command, args, { cwd });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({ code, out, err }));
  });
}

const results = [];
const crashed = [];

for (const suite of SUITES) {
  const { code, out, err } = await run('node', [
    `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout', ...suite.args,
  ], `${ROOT}${suite.cwd}`);

  const lines = out.split('\n').filter(l => l.startsWith('{'));
  for (const line of lines) results.push(JSON.parse(line));

  // A suite that produced no results did not "pass with zero tests" — it fell
  // over before it could run, and a build that treats that as success is the
  // one failure mode this whole file exists to prevent.
  if (!lines.length) crashed.push({ suite: suite.name, code, err: err.slice(-800) });
}

const byId = new Map(results.map(r => [r.id, r.ok]));
const listed = new Map(EXPECTED.expected_failures.map(e => [e.id, e]));

const failed = results.filter(r => !r.ok);
const unexpected = failed.filter(r => !listed.has(r.id));
const expectedFailing = failed.filter(r => listed.has(r.id));
const stale = [...listed.keys()].filter(id => byId.get(id) === true);
const missing = [...listed.keys()].filter(id => !byId.has(id));

const gateFailures = [];
for (const gate of WHOLE_GATES) {
  const { code, err, out } = await run(gate.command, gate.args, ROOT);
  if (code !== 0) gateFailures.push({ name: gate.name, detail: (err || out).slice(-800) });
}

// ── Report ──────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.ok).length;
if (!quiet) {
  console.log(`\n${passed} pass / ${expectedFailing.length} expected fail `
    + `/ ${unexpected.length} unexpected fail`);
  console.log(`${results.length} tests across ${SUITES.length} suites, `
    + `plus ${WHOLE_GATES.length} whole-suite gates.\n`);

  if (expectedFailing.length) {
    console.log('Known content debt, still open:');
    const byReason = new Map();
    for (const f of expectedFailing) {
      const entry = listed.get(f.id);
      byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
    }
    for (const [reason, n] of byReason) console.log(`  ${String(n).padStart(3)}  ${reason}`);
    console.log();
  }
}

const problems = [];
if (crashed.length) {
  problems.push(...crashed.map(c =>
    `suite "${c.suite}" produced no results (exit ${c.code}) — it did not run\n${c.err}`));
}
if (unexpected.length) {
  problems.push(`${unexpected.length} unexpected failure(s):\n`
    + unexpected.map(f => `  ${f.id}`).join('\n'));
}
if (stale.length) {
  problems.push(`${stale.length} expected failure(s) now PASS and must be removed from `
    + `expected-failures.json:\n${stale.map(id => `  ${id}`).join('\n')}`);
}
if (missing.length) {
  problems.push(`${missing.length} expected failure(s) name a test that no longer exists. `
    + 'A renamed test carries no exception:\n'
    + missing.map(id => `  ${id}`).join('\n'));
}
if (gateFailures.length) {
  problems.push(...gateFailures.map(g => `gate "${g.name}" failed:\n${g.detail}`));
}

if (problems.length) {
  console.error('\nBUILD FAILED\n');
  for (const p of problems) console.error(`${p}\n`);
  process.exit(1);
}

if (!quiet) {
  console.log(expectedFailing.length
    ? 'PASS — no unexpected failures. The debt above is known and unchanged.'
    : 'PASS — and the expected-failure list is empty.');
}
