// Bundle with esbuild's nodePaths: ['apps/worker/node_modules']; the resulting
// Node 24 ESM file needs no installed packages. Never loads credential files.
import postgres from 'postgres';
import { X509Certificate } from 'node:crypto';
import { getCACertificates } from 'node:tls';
import { isAbsolute, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DB_HOST = 'db.lutwdmwkogtzajxvbuiy.supabase.co';
export const DB_ROLE = 'sollish_worker';
export const CA_FINGERPRINT = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';
const LOCK_KEY = 'sollish:managed-db-acceptance';
const FUNCTIONS = [
  'public.ingest_coinflip(text,text,text,text,bigint,text,text,text,text,text,timestamp with time zone)',
  'public.advance_chain_cursor(text,text,text,bigint)',
  'public.chain_cursor()', 'public.claim_outbox(uuid,integer)', 'public.ack_outbox(uuid,uuid)',
];
const FORBIDDEN_FUNCTIONS = [
  'public.verify_chat_session(uuid,uuid)', 'public.submit_chat(uuid,uuid,uuid,text)',
  'sollish.assert_session(uuid,uuid)',
];
const TABLES = [
  'sollish.settings', 'sollish.wallet_accounts', 'sollish.chat_bans', 'sollish.index_state',
  'sollish.chain_facts', 'sollish.streams', 'sollish.chat_messages', 'sollish.outbox',
  'auth.users', 'auth.identities', 'auth.sessions',
];
const FAILURE_CODES = new Set([
  'INVALID_RUNTIME', 'INVALID_DATABASE_CONFIG', 'CA_NOT_LOADED', 'TLS_NOT_VERIFIED',
  'ROLE_MISMATCH', 'ROLE_PRIVILEGED', 'ROLE_MEMBERSHIP', 'GRANTS_MISMATCH',
  'LOCK_BUSY', 'LOCK_RELEASE_FAILED', 'SESSION_CHANGED', 'ACCESS_NOT_DENIED',
  'CURSOR_INVALID', 'CLEANUP_FAILED',
]);
class ProbeFailure extends Error {
  constructor(code) { super(code); this.probeCode = code; }
}
const requireCheck = (ok, code) => { if (!ok) throw new ProbeFailure(code); };

export function classifyError(error) {
  if (error instanceof ProbeFailure && FAILURE_CODES.has(error.probeCode)) return error.probeCode;
  switch (error?.code) {
    case '28P01': case '28000': return 'DB_AUTHENTICATION_FAILED';
    case '42501': return 'DB_PERMISSION_DENIED';
    case '57014': case 'CONNECT_TIMEOUT': case 'ETIMEDOUT': return 'DB_TIMEOUT';
    case 'ECONNREFUSED': case 'ENETUNREACH': case 'EHOSTUNREACH': case 'ENOTFOUND': case 'EAI_AGAIN': return 'DB_UNREACHABLE';
    case 'SELF_SIGNED_CERT_IN_CHAIN': case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID': return 'DB_TLS_FAILED';
    default: return 'DB_CHECK_FAILED';
  }
}

export function validateConfig(env, fingerprints, version = process.version) {
  requireCheck(/^v24\./.test(version), 'INVALID_RUNTIME');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new ProbeFailure('INVALID_DATABASE_CONFIG'); }
  let username;
  try { username = decodeURIComponent(url.username); } catch { throw new ProbeFailure('INVALID_DATABASE_CONFIG'); }
  requireCheck(['postgres:', 'postgresql:'].includes(url.protocol)
    && url.hostname === DB_HOST && url.port === '5432' && url.pathname === '/postgres'
    && username === DB_ROLE && url.password.length > 0 && !url.search && !url.hash
    && typeof env.DATABASE_URL === 'string' && !/[\r\n\0]/.test(env.DATABASE_URL)
    && typeof env.NODE_EXTRA_CA_CERTS === 'string' && isAbsolute(env.NODE_EXTRA_CA_CERTS)
    && !/[\r\n\0]/.test(env.NODE_EXTRA_CA_CERTS) && env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  'INVALID_DATABASE_CONFIG');
  requireCheck(fingerprints.includes(CA_FINGERPRINT), 'CA_NOT_LOADED');
  return url.href;
}

async function expectSelectDenied(session, statement) {
  // Each permission error aborts a transaction until its savepoint is restored.
  // WHERE false prevents row output even if privileges are unexpectedly broad.
  await session.unsafe('savepoint sollish_access_probe');
  let denied = false;
  try { await session.unsafe(statement); }
  catch (error) { if (error?.code === '42501') denied = true; else throw error; }
  finally {
    await session.unsafe('rollback to savepoint sollish_access_probe');
    await session.unsafe('release savepoint sollish_access_probe');
  }
  requireCheck(denied, 'ACCESS_NOT_DENIED');
}

async function functionPrivilege(session, signature) {
  const [qualified, args] = signature.slice(0, -1).split('(');
  const [schema, name] = qualified.split('.');
  // Resolve through catalogs: a role without private-schema USAGE must still be
  // auditable without name resolution itself causing permission denied.
  const rows = await session.unsafe(`select has_function_privilege(current_user,p.oid,'EXECUTE') as allowed
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname=$1 and p.proname=$2 and oidvectortypes(p.proargtypes)=$3`,
  [schema, name, args.replaceAll(',', ', ')]);
  requireCheck(rows.length === 1, 'GRANTS_MISMATCH');
  return rows[0].allowed;
}

export async function inspectSession(session, checks) {
  let transaction = false, locked = false, failure;
  try {
    await session.unsafe('begin read only'); transaction = true;
    await session.unsafe("set local statement_timeout = '8s'");
    await session.unsafe("set local lock_timeout = '2s'");
    const rows = await session.unsafe(`select pg_backend_pid() as pid, current_user as role,
      current_database() as database, current_setting('transaction_read_only') as read_only,
      r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
      s.ssl, s.version as tls_version,
      (select count(*)::integer from pg_auth_members m where m.member=r.oid) as memberships
      from pg_roles r join pg_stat_ssl s on s.pid=pg_backend_pid() where r.rolname=current_user`);
    requireCheck(rows.length === 1, 'ROLE_MISMATCH');
    const row = rows[0];
    requireCheck(row.role === DB_ROLE && row.database === 'postgres' && row.read_only === 'on' && row.rolcanlogin === true, 'ROLE_MISMATCH');
    requireCheck(row.ssl === true && ['TLSv1.2', 'TLSv1.3'].includes(row.tls_version), 'TLS_NOT_VERIFIED');
    requireCheck([row.rolsuper, row.rolbypassrls, row.rolcreatedb, row.rolcreaterole, row.rolreplication].every(v => v === false), 'ROLE_PRIVILEGED');
    requireCheck(row.memberships === 0, 'ROLE_MEMBERSHIP');
    checks.push('verified-tls', 'dedicated-unprivileged-login', 'no-role-memberships', 'read-only-transaction');

    const [privileges] = await session.unsafe(`select
      has_database_privilege(current_user,current_database(),'CONNECT') as db_connect,
      has_schema_privilege(current_user,'public','USAGE') as public_usage,
      has_schema_privilege(current_user,'public','CREATE') as public_create,
      has_schema_privilege(current_user,'sollish','USAGE') as private_usage,
      has_schema_privilege(current_user,'sollish','CREATE') as private_create`);
    requireCheck(privileges?.db_connect === true && privileges.public_usage === true
      && privileges.public_create === false && privileges.private_usage === false && privileges.private_create === false, 'GRANTS_MISMATCH');
    for (const name of FUNCTIONS) {
      requireCheck(await functionPrivilege(session, name) === true, 'GRANTS_MISMATCH');
    }
    for (const name of FORBIDDEN_FUNCTIONS) {
      requireCheck(await functionPrivilege(session, name) === false, 'GRANTS_MISMATCH');
    }
    for (const name of TABLES) {
      const rows = await session.unsafe(`select has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname=$1 and c.relname=$2 and c.relkind in ('r','p')`, name.split('.'));
      requireCheck(rows.length === 1 && rows[0].allowed === false, 'GRANTS_MISMATCH');
    }
    checks.push('five-function-grants', 'no-private-or-auth-table-privileges');

    const [lock] = await session.unsafe('select pg_backend_pid() as pid,pg_try_advisory_lock(hashtextextended($1,31)) as locked', [LOCK_KEY]);
    locked = lock?.locked === true;
    requireCheck(lock?.pid === row.pid, 'SESSION_CHANGED');
    requireCheck(locked, 'LOCK_BUSY');
    await expectSelectDenied(session, 'select * from sollish.wallet_accounts where false');
    await expectSelectDenied(session, 'select * from auth.identities where false');
    checks.push('actual-private-select-denied', 'actual-auth-select-denied');
    const [cursor] = await session.unsafe('select pg_backend_pid() as pid, public.chain_cursor() as cursor');
    requireCheck(cursor?.pid === row.pid, 'SESSION_CHANGED');
    requireCheck(cursor.cursor === null || typeof cursor.cursor === 'object' && !Array.isArray(cursor.cursor), 'CURSOR_INVALID');
    checks.push(cursor.cursor === null ? 'empty-chain-cursor-readable' : 'chain-cursor-readable');
    // No cursor values, rows, wallet addresses or signatures are emitted.
  } catch (error) { failure = error; }
  finally {
    // Roll back before unlocking so even an aborted transaction can clean up.
    if (transaction) {
      try { await session.unsafe('rollback'); } catch { failure = new ProbeFailure('CLEANUP_FAILED'); }
    }
    if (locked) {
      try {
        const [unlock] = await session.unsafe('select pg_advisory_unlock(hashtextextended($1,31)) as unlocked', [LOCK_KEY]);
        requireCheck(unlock?.unlocked === true, 'LOCK_RELEASE_FAILED');
        checks.push('session-advisory-lock-released');
      } catch { failure = new ProbeFailure('LOCK_RELEASE_FAILED'); }
    }
  }
  if (failure) throw failure;
}

export async function runAcceptance(env = process.env, dependencies = {}) {
  const checks = [];
  let sql, session, failure;
  try {
    const fingerprints = dependencies.fingerprints ?? getCACertificates('extra').map(pem => new X509Certificate(pem).fingerprint256);
    const url = validateConfig(env, fingerprints, dependencies.version ?? process.version);
    checks.push('exact-direct-project-host-role', 'trusted-ca-loaded');
    sql = (dependencies.connect ?? postgres)(url, {
      max: 1, prepare: false, connect_timeout: 8, idle_timeout: 2,
      ssl: { rejectUnauthorized: true }, onnotice: () => {},
      connection: { application_name: 'sollish-db-acceptance' },
    });
    session = await sql.reserve();
    await inspectSession(session, checks);
  } catch (error) { failure = error; }
  finally {
    if (session) { try { await session.release(); } catch { failure = new ProbeFailure('CLEANUP_FAILED'); } }
    if (sql) { try { await sql.end({ timeout: 3 }); } catch { failure = new ProbeFailure('CLEANUP_FAILED'); } }
  }
  return {
    schemaVersion: 1, checkedAt: new Date().toISOString(),
    status: failure ? 'FAIL' : 'PASS', ...(failure ? { code: classifyError(failure) } : {}), checks,
    scope: 'Read-only managed DB acceptance; no facts/cursor/outbox writes. Only listed checks succeeded.',
  };
}

function isEntrypoint() {
  try { return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isEntrypoint()) {
  const report = await runAcceptance();
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
