import { readFile } from 'node:fs/promises';
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk';
import { classifyReadResponse, redact, ROOT, saveReport, validateAuthChallenge, wallet } from './lib.mjs';

const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
const own = await wallet();
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), scope: 'Read only our dedicated wallet account with anonymous, valid and invalid auth; not a private-account proof', publicKey: own.pubkey, status: 'BLOCKED', checks: [], rows: [] };
let token;
try {
  const auth = await getAuthToken(manifest.teeRpc, own.publicKey, async message => { validateAuthChallenge(message, own.pubkey); return own.sign(message); });
  token = auth.token;
  report.checks.push({ id: 'own-wallet-auth', status: 'PASS', evidence: { expiresAt: auth.expiresAt, tokenPersisted: false } });
} catch (e) { report.checks.push({ id: 'own-wallet-auth', status: 'BLOCKED', evidence: redact(e.message) }); }

const altered = token ? `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}` : null;
const unsignedExpired = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: own.pubkey, exp: 1 })).toString('base64url')}.`;
const cases = [
  ['anonymous', null, false], ['valid-own-wallet', token, false],
  ['malformed-token', 'sollish-invalid-token', true], ['tampered-issued-token', altered, true],
  ['unsigned-expired-claims', unsignedExpired, true]
];
for (const [name, candidate, intentionallyInvalid] of cases) {
  if (name === 'valid-own-wallet' && !token || name === 'tampered-issued-token' && !altered) { report.rows.push({ name, outcome: 'BLOCKED', reason: 'No issued auth token' }); continue; }
  try {
    const url = new URL(manifest.teeRpc);
    if (candidate) url.searchParams.set('token', candidate);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [own.pubkey, { encoding: 'base64', commitment: 'confirmed' }] }), signal: AbortSignal.timeout(15000) });
    let body;
    try { body = await response.json(); } catch { body = null; }
    const observation = classifyReadResponse(response.status, body);
    report.rows.push({ name, intentionallyInvalid, ...observation });
    if (intentionallyInvalid) report.checks.push({ id: `${name}-rejection`, status: observation.outcome === 'AUTH_REJECTED' ? 'PASS' : 'BLOCKED', evidence: { outcome: observation.outcome, meaning: 'Only invalid-token rejection on this endpoint/method; an absent or public wallet account cannot demonstrate private state isolation.' } });
  } catch (e) { report.rows.push({ name, outcome: 'BLOCKED', reason: redact(e.message) }); }
}
report.checks.push({ id: 'genuinely-expired-issued-token', status: 'BLOCKED', evidence: 'No legitimately signed expired token available. An unsigned expired claim is also invalid-signature input and cannot isolate expiry enforcement.' });
report.checks.push({ id: 'private-counter-read-isolation', status: 'BLOCKED', evidence: 'No own deployed/delegated counter with initialized private permission exists. Only our public/absent wallet was queried.' });
report.checks.push({ id: 'G2', status: 'BLOCKED', evidence: 'No private VRF request/callback or role visibility matrix was exercised.' });
report.finishedAt = new Date().toISOString();
await saveReport('read-matrix-latest', report);
process.exitCode = 2;
