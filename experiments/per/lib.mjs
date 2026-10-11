import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = new URL('./', import.meta.url);
export const WALLET_PATH = new URL('../../.tooling/per/devnet-wallet.pem', import.meta.url);
export const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const LOADER_V4 = 'LoaderV411111111111111111111111111111111111';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function base58(bytes) {
  const b = Buffer.from(bytes);
  let n = b.length ? BigInt('0x' + b.toString('hex')) : 0n;
  let s = '';
  while (n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (let i = 0; i < b.length && b[i] === 0; i++) s = '1' + s;
  return s;
}

export function decodeData(account) {
  if (!account || !Array.isArray(account.data) || account.data[1] !== 'base64') throw new Error('Expected base64 account data');
  const value = account.data[0];
  if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value) throw new Error('Invalid base64 account data');
  return Buffer.from(value, 'base64');
}

export function accountSummary(account) {
  if (account === null) return { exists: false };
  const data = decodeData(account);
  if (typeof account.owner !== 'string' || typeof account.executable !== 'boolean') throw new Error('Invalid account metadata');
  const result = { exists: true, owner: account.owner, executable: account.executable, lamports: account.lamports, dataBytes: data.length, accountDataSha256: sha256(data) };
  if (account.owner === LOADER && account.executable) {
    if (data.length !== 36 || data.readUInt32LE(0) !== 2) throw new Error('Invalid upgradeable Program layout');
    result.programDataAddress = base58(data.subarray(4, 36));
  }
  if (account.owner === LOADER_V4 && account.executable) {
    if (data.length < 48 || data.readBigUInt64LE(40) > 2n) throw new Error('Invalid LoaderV4 layout');
    const status = Number(data.readBigUInt64LE(40));
    result.deployment = {
      loader: 'v4', lastDeploySlot: data.readBigUInt64LE(0).toString(),
      status: ['Retracted', 'Deployed', 'Finalized'][status],
      authorityOrNextVersion: base58(data.subarray(8, 40)),
      authorityMeaning: status === 2 ? 'Next-version address; not an upgrade authority' : 'Loader management authority; ER copy semantics need provider confirmation',
      binaryBytesIncludingAllocationPadding: data.length - 48,
      binarySha256IncludingAllocationPadding: sha256(data.subarray(48))
    };
  }
  return result;
}

export function programDataSummary(account) {
  if (!account || account.owner !== LOADER || account.executable !== false) throw new Error('Invalid ProgramData owner/executable');
  const data = decodeData(account);
  if (data.length < 45 || data.readUInt32LE(0) !== 3 || ![0, 1].includes(data[12])) throw new Error('Invalid ProgramData layout');
  return {
    lastDeploySlot: data.readBigUInt64LE(4).toString(),
    upgradeAuthority: data[12] === 1 ? base58(data.subarray(13, 45)) : null,
    binaryBytesIncludingAllocationPadding: data.length - 45,
    binarySha256IncludingAllocationPadding: sha256(data.subarray(45)),
    hashMeaning: 'Observed deployed bytes excluding 45-byte loader metadata, including allocation padding; not a reproducible source-build match.'
  };
}

export function parseRpc(status, body, id) {
  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (!body || body.jsonrpc !== '2.0' || body.id !== id) throw new Error('Invalid RPC envelope');
  if ('error' in body) throw new Error(`RPC ${body.error?.code ?? 'error'}: ${String(body.error?.message ?? '').slice(0, 160)}`);
  if (!Object.hasOwn(body, 'result')) throw new Error('Missing RPC result');
  return body.result;
}

export function redact(value) {
  return String(value).replace(/([?&]token=)[^&\s"']+/gi, '$1[REDACTED]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
}

export function validateAuthChallenge(message, pubkey, now = Date.now()) {
  const text = Buffer.from(message).toString('utf8');
  const match = /^Login to Query Filtering Service\nTimestamp: (\d{10})\nUser: ([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(text);
  if (!match || match[2] !== pubkey || Math.abs(now / 1000 - Number(match[1])) > 300) throw new Error('Unexpected, stale, or wrong-wallet auth challenge; refusing to sign');
}

export async function rpc(url, method, params = []) {
  const id = 1;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`HTTP ${response.status}: non-JSON response`); }
  return parseRpc(response.status, body, id);
}

export function aggregate(checks, requiredIds) {
  if (!Array.isArray(checks) || !Array.isArray(requiredIds) || requiredIds.length === 0) return 'BLOCKED';
  if (new Set(checks.map(x => x.id)).size !== checks.length) return 'BLOCKED';
  const selected = requiredIds.map(id => checks.find(c => c.id === id));
  if (selected.some(c => c?.status === 'FAIL')) return 'FAIL';
  return selected.every(c => c?.status === 'PASS') ? 'PASS' : 'BLOCKED';
}

export function tcbPolicy(verifiedReport) {
  return verifiedReport?.status === 'UpToDate' && Array.isArray(verifiedReport.advisory_ids) && verifiedReport.advisory_ids.length === 0 ? 'PASS' : 'BLOCKED';
}

export function classifyReadResponse(httpStatus, body) {
  if ([401, 403].includes(httpStatus)) return { outcome: 'AUTH_REJECTED', httpStatus };
  if (httpStatus !== 200) return { outcome: 'BLOCKED', httpStatus, reason: 'Transport failure is not an authorization result' };
  if (body?.error) return { outcome: 'RPC_ERROR', code: body.error.code, message: redact(body.error.message ?? '').slice(0, 160) };
  try {
    const result = parseRpc(httpStatus, body, 1);
    if (!result || !Object.hasOwn(result, 'value')) throw new Error('Missing account result');
    return { outcome: result.value === null ? 'ACCOUNT_ABSENT' : 'ACCOUNT_READ', slot: result.context?.slot, account: accountSummary(result.value) };
  } catch { return { outcome: 'BLOCKED', reason: 'Malformed RPC response' }; }
}

export async function wallet() {
  let pem;
  try { pem = await readFile(WALLET_PATH, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const pair = generateKeyPairSync('ed25519');
    pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    await mkdir(new URL('./', WALLET_PATH), { recursive: true, mode: 0o700 });
    await writeFile(WALLET_PATH, pem, { mode: 0o600, flag: 'wx' });
  }
  const key = createPrivateKey(pem);
  const publicDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const pubkey = base58(publicDer.subarray(-32));
  return { publicKey: { toString: () => pubkey }, pubkey, sign: message => sign(null, message, key) };
}

export async function saveReport(name, report) {
  await mkdir(new URL('evidence/', ROOT), { recursive: true });
  const path = new URL(`evidence/${name}.json`, ROOT);
  const archive = new URL(`evidence/${name.replace(/-latest$/, '')}-${report.startedAt.replaceAll(':', '-')}.json`, ROOT);
  await writeFile(archive, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: fileURLToPath(path), status: report.status, counts: report.checks?.reduce((r, c) => ({ ...r, [c.status]: (r[c.status] ?? 0) + 1 }), {}) }));
}
