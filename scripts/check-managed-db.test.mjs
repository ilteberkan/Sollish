import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'sollish-db-probe-'));
const artifact = join(directory, 'check-managed-db.mjs');
await build({ absWorkingDir: root, entryPoints: ['scripts/check-managed-db.mjs'], outfile: artifact,
  bundle: true, platform: 'node', target: 'node24', format: 'esm',
  nodePaths: [join(root, 'apps/worker/node_modules')], sourcemap: false, legalComments: 'eof' });
after(() => rm(directory, { recursive: true, force: true }));
const { runAcceptance, classifyError, DB_HOST, CA_FINGERPRINT } = await import(pathToFileURL(artifact).href);
const secret = 'never-output-this-password';
const env = { DATABASE_URL: `postgresql://sollish_worker:${secret}@${DB_HOST}:5432/postgres`, NODE_EXTRA_CA_CERTS: '/trusted/ca.crt' };
const base = { fingerprints: [CA_FINGERPRINT], version: 'v24.21.0' };
function fixture(options = {}) {
  const calls = []; let released = false, ended = false, settings;
  const session = {
    async unsafe(query, args) {
      calls.push([query, args]);
      if (options.failAt && query.includes(options.failAt)) throw Object.assign(new Error(secret), { code: options.errorCode ?? 'XX000' });
      if (query.includes('from pg_roles')) return [{ pid: 81, role: 'sollish_worker', database: 'postgres', read_only: 'on', rolcanlogin: true,
        rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
        ssl: true, tls_version: 'TLSv1.3', memberships: 0, ...options.role }];
      if (query.includes('has_database_privilege')) return [{ db_connect: true, public_usage: true, public_create: false, private_usage: false, private_create: false }];
      if (query.includes('has_function_privilege')) return [{ allowed: !/verify_chat_session|submit_chat|assert_session/.test(args[1]) }];
      if (query.includes('has_table_privilege')) return [{ allowed: options.tableGranted === true }];
      if (query.includes('pg_try_advisory_lock')) return [{ pid: 81, locked: options.locked !== false }];
      if (query.startsWith('select *')) {
        if (options.selectAllowed) return [];
        throw Object.assign(new Error(`denied ${secret}`), { code: options.denialCode ?? '42501' });
      }
      if (query.includes('public.chain_cursor()')) return [{ pid: options.cursorPid ?? 81, cursor: null }];
      if (query.includes('pg_advisory_unlock')) return [{ unlocked: options.unlocked !== false }];
      return [];
    },
    release() { released = true; },
  };
  const connect = (url, config) => { settings = config; return { reserve: async () => session, end: async () => { ended = true; } }; };
  return { calls, connect, state: () => ({ released, ended, settings }) };
}

test('exact project, user, database, port and startup CA are required before connection', async () => {
  const invalid = [
    {}, { ...env, DATABASE_URL: env.DATABASE_URL.replace(DB_HOST, 'attacker.example') },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace('sollish_worker:', 'postgres:') },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace(':5432', ':6543') },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace('/postgres', '/other') },
    { ...env, DATABASE_URL: env.DATABASE_URL + '?sslmode=disable' },
    { ...env, DATABASE_URL: env.DATABASE_URL + '#fragment' },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace(secret, '') },
    { ...env, NODE_EXTRA_CA_CERTS: 'relative.crt' }, { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  ];
  for (const config of invalid) {
    let connected = false;
    const report = await runAcceptance(config, { ...base, connect: () => { connected = true; throw Error(secret); } });
    assert.equal(report.status, 'FAIL'); assert.equal(connected, false);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
  assert.equal((await runAcceptance(env, { ...base, fingerprints: [] })).code, 'CA_NOT_LOADED');
  assert.equal((await runAcceptance(env, { ...base, version: 'v22.0.0' })).code, 'INVALID_RUNTIME');
});

test('success uses strict TLS and one reserved session; NULL cursor allowed, rollback and unlock verified', async () => {
  const f = fixture(); const report = await runAcceptance(env, { ...base, connect: f.connect });
  assert.equal(report.status, 'PASS'); assert.ok(report.checks.includes('empty-chain-cursor-readable'));
  assert.ok(report.checks.includes('actual-auth-select-denied'));
  assert.deepEqual(f.state().settings.ssl, { rejectUnauthorized: true }); assert.equal(f.state().settings.max, 1);
  assert.equal(f.calls.filter(([q]) => q.includes('has_function_privilege')).length, 8);
  assert.equal(f.calls.filter(([q]) => q.includes('has_table_privilege')).length, 11);
  assert.deepEqual(f.calls.filter(([q]) => q.startsWith('select *')).map(([q]) => q), [
    'select * from sollish.wallet_accounts where false', 'select * from auth.identities where false',
  ]);
  assert.ok(f.calls.findIndex(([q]) => q === 'rollback') < f.calls.findIndex(([q]) => q.includes('pg_advisory_unlock')));
  assert.equal(f.state().released, true); assert.equal(f.state().ended, true);
  assert.equal(f.calls.some(([q]) => /^(insert|update|delete|commit|create|alter|grant)\b/i.test(q)), false);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('TLS, privileged role, memberships and unexpected table grants all fail closed', async () => {
  for (const [options, code] of [
    [{ role: { ssl: false } }, 'TLS_NOT_VERIFIED'],
    [{ role: { rolsuper: true } }, 'ROLE_PRIVILEGED'],
    [{ role: { rolbypassrls: true } }, 'ROLE_PRIVILEGED'],
    [{ role: { memberships: 1 } }, 'ROLE_MEMBERSHIP'],
    [{ role: { role: 'postgres' } }, 'ROLE_MISMATCH'],
    [{ tableGranted: true }, 'GRANTS_MISMATCH'],
  ]) {
    const f = fixture(options); assert.equal((await runAcceptance(env, { ...base, connect: f.connect })).code, code);
    assert.equal(f.state().released, true); assert.equal(f.state().ended, true);
  }
});

test('real SELECT must get permission denied, not success or unrelated SQL error', async () => {
  for (const [options, code] of [[{ selectAllowed: true }, 'ACCESS_NOT_DENIED'], [{ denialCode: '42P01' }, 'DB_CHECK_FAILED']]) {
    const f = fixture(options); const report = await runAcceptance(env, { ...base, connect: f.connect });
    assert.equal(report.code, code); assert.ok(report.checks.includes('session-advisory-lock-released'));
    assert.ok(f.calls.some(([q]) => q === 'rollback to savepoint sollish_access_probe'));
  }
});

test('lock contention, session change and failed unlock cannot produce PASS', async () => {
  for (const [options, code] of [[{ locked: false }, 'LOCK_BUSY'], [{ cursorPid: 82 }, 'SESSION_CHANGED'], [{ unlocked: false }, 'LOCK_RELEASE_FAILED']]) {
    const f = fixture(options); assert.equal((await runAcceptance(env, { ...base, connect: f.connect })).code, code);
    assert.equal(f.state().released, true); assert.equal(f.state().ended, true);
  }
});

test('query failure still rolls back and unlocks; output never includes raw error properties', async () => {
  const f = fixture({ failAt: 'public.chain_cursor()', errorCode: '57014' });
  const report = await runAcceptance(env, { ...base, connect: f.connect });
  assert.equal(report.code, 'DB_TIMEOUT'); assert.ok(report.checks.includes('session-advisory-lock-released'));
  assert.equal(JSON.stringify(report).includes(secret), false);
  for (const error of [new Error(secret), { code: secret, message: secret, detail: secret }, { code: 'XXXXX' }]) assert.equal(classifyError(error), 'DB_CHECK_FAILED');
  assert.equal(classifyError({ code: '28P01', message: secret }), 'DB_AUTHENTICATION_FAILED');
});

test('portable artifact fails before network with only sanitized JSON and no runtime dependencies', () => {
  const result = spawnSync(process.execPath, [artifact], { env: {}, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout); assert.equal(report.status, 'FAIL'); assert.equal(report.code, 'INVALID_DATABASE_CONFIG');
});
