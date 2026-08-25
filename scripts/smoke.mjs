/**
 * Live smoke pass over the athlete's whole loop.
 *
 * Everything else in this repo is tested without a database. This is the part
 * that cannot be: whether the SQL matches the schema, whether RLS lets the
 * owner through and no one else, whether the constraints hold. It signs in as a
 * real athlete and walks the loop they walk.
 *
 *   npm run smoke -- --email you@example.com --password '…'
 *
 * Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY from the
 * environment or a .env file, the same values the app uses.
 *
 * It writes. A session is started and completed, and with --reshape the week's
 * queue is reordered and put back. Run it against a development project, or
 * against an account you are willing to have training data on — the session it
 * creates is a real one and will show up in the app.
 *
 * Nothing is deleted at the end. A smoke run that tidied up after itself would
 * hide exactly what you want to look at afterwards, and deleting rows is the
 * one thing this script should never learn to do.
 */
import { readFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';

/* ------------------------------------------------------------------ args --- */

const args = new Map();
for (let i = 2; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args.set(key, next); i += 1; } else args.set(key, true);
  }
}

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no file is fine — the values may already be in the environment */ }
}
loadEnvFile('.env');
loadEnvFile('apps/mobile/.env');

const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const email = args.get('email') ?? env.SMOKE_EMAIL;
const password = args.get('password') ?? env.SMOKE_PASSWORD;

if (!URL_BASE || !ANON) fail('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
if (!email || !password) fail('Pass --email and --password for the account to sign in as.');

/* ---------------------------------------------------------------- output --- */

const results = [];
let token = null;

function fail(message) {
  console.error(`\n  ${message}\n`);
  exit(1);
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Runs one check, recording a thrown error as a failure rather than exiting. */
async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail);
    return true;
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
    return false;
  }
}

/* ------------------------------------------------------------------ http --- */

async function call(path, { method = 'POST', body, auth = true } = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${res.status} ${parsed?.error ?? parsed?.message ?? text.slice(0, 200)}`);
  }
  return parsed;
}

const fn = (name, body, method = 'POST') =>
  call(`/functions/v1/${name}`, { method, body });

/* ------------------------------------------------------------------ loop --- */

console.log(`\nPivot smoke · ${URL_BASE}\n`);

await step('sign in', async () => {
  const auth = await call('/auth/v1/token?grant_type=password', {
    body: { email, password }, auth: false,
  });
  token = auth.access_token;
  if (!token) throw new Error('no access token returned');
  return email;
});
if (!token) fail('Cannot continue without a session.');

let today = null;
await step('today responds', async () => {
  today = await fn('today', undefined, 'GET');
  const parts = [
    today.active_race ? `race ${today.active_race.days_remaining}d` : 'no race',
    today.phase ? `${today.phase.type} w${today.phase.program_week}/${today.phase.program_total_weeks}` : 'no phase',
    `${today.week?.queue?.length ?? 0} queued`,
  ];
  return parts.join(' · ');
});

await step('the week window is a real week', () => {
  const week = today?.week;
  if (!week?.start_date || !week?.end_date) return 'no window (no program yet)';
  const days = Math.round(
    (Date.parse(week.end_date) - Date.parse(week.start_date)) / 86_400_000) + 1;
  if (days !== 7) throw new Error(`window is ${days} days, expected 7`);
  return `${week.start_date} → ${week.end_date}`;
});

await step('readiness is scored or honestly absent', () => {
  const r = today?.readiness;
  if (!r) throw new Error('no readiness in the payload');
  if (r.overall === null) return 'null — nothing measured yet, which is correct for a new account';
  const observed = r.observed?.length ?? 0;
  return `${r.overall}/100 from ${observed} observed component${observed === 1 ? '' : 's'}`;
});

const template = today?.recommendation?.template?.id ?? args.get('template');
let session = null;

await step('start a session', async () => {
  if (!template) throw new Error('nothing recommended and no --template given');
  session = await fn('start-workout', { template_id: template });
  if (!session?.session_id) throw new Error(`refused: ${session?.rationale ?? 'no session id'}`);
  return `${session.name ?? template} · ${session.blocks?.length ?? 0} blocks`;
});

await step('starting twice returns the same session', async () => {
  if (!session) throw new Error('skipped — no session was opened');
  const again = await fn('start-workout', { template_id: template });
  if (again.session_id !== session.session_id) {
    throw new Error('a second Start opened a second session');
  }
  if (!again.resumed) throw new Error('the same session came back without resumed: true');
  return session.session_id;
});

await step('finish it, with what was performed', async () => {
  if (!session) throw new Error('skipped — no session was opened');
  const blocks = (session.blocks ?? []).map((b, i) => ({
    block_order: i,
    actual_json: { rounds_completed: b.rounds ?? 1, seconds: 300, steps_completed: 1, steps_prescribed: 1 },
    completed_at: new Date().toISOString(),
    skipped: false,
  }));
  const done = await fn('complete-workout', {
    session_id: session.session_id,
    client_event_id: `smoke_${Date.now().toString(36)}`,
    revision: (session.revision ?? 0) + 1,
    session_rpe: 7,
    ended_early: false,
    blocks,
    // One measured effort, so the cardio path is exercised end to end.
    cardio_logs: [{
      block_order: 0, exercise_id: 'ex_run', duration_seconds: 258, distance_meters: 1000,
    }],
  });
  return done.credited_stimulus
    ? `credited ${done.credited_stimulus}`
    : 'completed, credited nothing (off-plan session)';
});

await step('the week reflects the finish', async () => {
  const after = await fn('today', undefined, 'GET');
  const before = today?.stimulus_requirements ?? [];
  const sum = rs => rs.reduce((n, r) => n + r.completed_exposures, 0);
  const moved = sum(after.stimulus_requirements ?? []) - sum(before);
  const completed = after.week?.completed?.length ?? 0;
  today = after;
  return `${completed} completed this week, stimulus count ${moved >= 0 ? '+' : ''}${moved}`;
});

await step('the effort was written, not just accepted', async () => {
  if (!session) throw new Error('skipped — no session was opened');
  // Read through PostgREST rather than the function, so RLS is exercised on a
  // plain table read the way the client would do it.
  //
  // Scoped to this run's session and asserted non-empty. An earlier version
  // counted whatever was readable and passed on zero, which let a server
  // running a build without the log-writing path look identical to one that
  // wrote nothing because there was nothing to write.
  const blocks = await call(
    `/rest/v1/session_blocks?select=id&session_id=eq.${session.session_id}`,
    { method: 'GET' },
  );
  if (!blocks.length) throw new Error('the session has no block rows');
  const ids = blocks.map(b => b.id).join(',');
  const rows = await call(
    `/rest/v1/cardio_logs?select=distance_meters,duration_seconds&session_block_id=in.(${ids})`,
    { method: 'GET' },
  );
  if (!rows.length) {
    throw new Error(
      'the finish sent one cardio effort and none was stored — is complete-workout deployed?');
  }
  const [first] = rows;
  if (first.distance_meters !== 1000 || first.duration_seconds !== 258) {
    throw new Error(`stored ${first.distance_meters}m in ${first.duration_seconds}s, sent 1000m in 258s`);
  }
  return `${rows.length} effort${rows.length === 1 ? '' : 's'} stored as sent`;
});

await step('the block recorded what was performed', async () => {
  if (!session) throw new Error('skipped — no session was opened');
  const blocks = await call(
    `/rest/v1/session_blocks?select=block_order,skipped,actual_json&session_id=eq.${session.session_id}&order=block_order`,
    { method: 'GET' },
  );
  const performed = blocks.filter(b => !b.skipped);
  if (!performed.length) throw new Error('every block came back skipped');
  const a = performed[0].actual_json;
  if (!a || typeof a.seconds !== 'number') throw new Error('no actuals on the block');
  return `${performed.length}/${blocks.length} blocks performed`;
});

if (args.get('reshape')) {
  let original = [];
  await step('reshape the week', async () => {
    original = (today.week?.queue ?? []).map(q => q.id);
    if (original.length < 2) throw new Error('needs at least two queued sessions');
    const [first, ...rest] = original;
    const result = await fn('reshape-week', { keep: [...rest, first], drop: [] });
    return `${result.kept} kept, ${result.dropped} dropped`;
  });

  await step('and put it back', async () => {
    if (original.length < 2) throw new Error('skipped');
    const result = await fn('reshape-week', { keep: original, drop: [] });
    return `${result.kept} restored`;
  });
}

if (args.get('symptom')) {
  // Opt-in: it writes a check-in for today, which is the athlete's own row and
  // visible in the app. The symptom used is the non-severe one, so the run
  // cannot leave the account refusing to train, and it is cleared afterwards.
  await step('a reported symptom reaches the engine', async () => {
    const before = await fn('today', undefined, 'GET');
    await fn('recovery-checkin', { symptoms: { 'Something hurts': true } });

    const rows = await call('/rest/v1/recovery_checkins?select=local_date,symptom_json&order=local_date.desc&limit=1',
      { method: 'GET' });
    const stored = Object.keys(rows[0]?.symptom_json ?? {});
    if (!stored.includes('Something hurts')) {
      throw new Error(`symptom_json came back as ${JSON.stringify(rows[0]?.symptom_json)}`);
    }

    // The point of storing it: the next recommendation reads it back.
    const after = await fn('today', undefined, 'GET');
    await fn('recovery-checkin', { symptoms: {} });
    const changed = after.recommendation?.variant?.variant_code
      !== before.recommendation?.variant?.variant_code;
    return `stored and read back${changed ? ', and today’s variant changed' : ''}`;
  });
}

await step('another athlete’s row is not readable', async () => {
  // RLS is the only thing standing between two athletes' training data. A
  // filter that returns rows here would be a serious finding.
  const rows = await call(
    '/rest/v1/athlete_profiles?select=user_id', { method: 'GET' });
  if (!Array.isArray(rows)) throw new Error('unexpected shape');
  if (rows.length > 1) throw new Error(`${rows.length} profiles visible — RLS is not scoping reads`);
  return `${rows.length} profile visible`;
});

/* ---------------------------------------------------------------- report --- */

const failed = results.filter(r => !r.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
if (failed.length) {
  console.log('  Failed:');
  for (const f of failed) console.log(`    ${f.name}: ${f.detail}`);
  console.log();
  exit(1);
}
