import { readFile } from 'node:fs/promises';
import { getAuthToken, verifyTeeIntegrity, verifyTeeRpcIntegrity } from '@magicblock-labs/ephemeral-rollups-sdk';
import { getCollateral, Quote, verify as verifyQuote } from '@phala/dcap-qvl';
import { accountSummary, aggregate, programDataSummary, redact, ROOT, rpc, saveReport, sha256, tcbPolicy, validateAuthChallenge, wallet } from './lib.mjs';

const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), scope: 'G0 read-only RPC/deployment/auth/attestation preflight; no transactions, no VRF request, no counter writes',
  node: process.version, manifest, checks: [], snapshots: {}, quotes: [], sources: [],
  limitations: [
    'A successful RPC response or HTTPS connection is not attestation.',
    'Observed binary hashes do not prove a match to pinned source; no reproducible build was compared.',
    'SDK quote verification does not check an expected application measurement allowlist.',
    'No private counter, VRF callback, cash-out, settlement, or outage experiment is implemented by this preflight.'
  ]
};
const add = (id, status, evidence) => report.checks.push({ id, status, evidence });
async function attempt(id, fn) {
  try { const evidence = await fn(); add(id, 'PASS', evidence); return evidence; }
  catch (e) { add(id, 'BLOCKED', { error: redact(e.message) }); return null; }
}

await attempt('installed-sdk-version', async () => {
  const installed = JSON.parse(await readFile(new URL('node_modules/@magicblock-labs/ephemeral-rollups-sdk/package.json', ROOT), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('package-lock.json', ROOT), 'utf8'));
  report.installedSdk = { version: installed.version, integrity: lock.packages['node_modules/@magicblock-labs/ephemeral-rollups-sdk'].integrity };
  for (const name of ['auth', 'verify']) {
    const bytes = await readFile(new URL(`node_modules/@magicblock-labs/ephemeral-rollups-sdk/lib/access-control/${name}.js`, ROOT));
    report.installedSdk[`${name}CompiledSha256`] = sha256(bytes);
  }
  if (installed.version !== manifest.sdkVersion) throw new Error('Installed SDK does not match manifest');
  return report.installedSdk;
});

// Only public quote responses are captured. Never persist /auth/login or token-bearing URLs.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const response = await nativeFetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (url.origin === manifest.teeRpc && ['/quote', '/fast-quote'].includes(url.pathname)) {
    const body = await response.clone().json();
    report.quotes.push({ method: url.pathname, httpStatus: response.status, requestedChallengeBase64: url.searchParams.get('challenge'), body, quoteSha256: typeof body.quote === 'string' ? sha256(Buffer.from(body.quote, 'base64')) : null });
  }
  return response;
};

const genesis = await attempt('base-genesis', async () => {
  const value = await rpc(manifest.baseRpc, 'getGenesisHash');
  if (value !== manifest.devnetGenesisHash) throw new Error('Endpoint is not the pinned Solana devnet genesis');
  return value;
});
for (const [name, url] of [['base', manifest.baseRpc], ['tee', manifest.teeRpc], ['er', manifest.erRpc]]) {
  await attempt(`${name}-version`, () => rpc(url, 'getVersion'));
  await attempt(`${name}-identity`, async () => {
    const value = await rpc(url, 'getIdentity');
    if (name === 'tee' && value.identity !== manifest.teeValidator) throw new Error('TEE validator differs from pinned documentation');
    return value;
  });
}
await attempt('tee-reported-genesis', () => rpc(manifest.teeRpc, 'getGenesisHash'));

const sourceBase = `https://raw.githubusercontent.com/magicblock-labs/magicblock-engine-examples/${manifest.sources.examplesCommit}/private-counter/anchor/`;
await attempt('counter-source-idl-alignment', async () => {
  const values = [];
  for (const path of ['programs/private-counter/src/lib.rs', 'app/src/idl/private_counter.json', 'Anchor.toml']) {
    const url = sourceBase + path;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pinned source fetch HTTP ${response.status}`);
    const body = await response.text();
    report.sources.push({ url, sha256: sha256(body) }); values.push(body);
  }
  const sourceId = /declare_id!\("([^"]+)"\)/.exec(values[0])?.[1];
  const idl = JSON.parse(values[1]);
  report.counterReference = { sourceId, bundledIdlAddress: idl.address, ownerProgram: idl.instructions.flatMap(i => i.accounts).find(a => a.name === 'owner_program')?.address, anchorTomlDefinesDevnetProgram: values[2].includes('[programs.devnet]') };
  if (!sourceId || sourceId !== idl.address || sourceId !== report.counterReference.ownerProgram) throw new Error('Pinned source declare_id and bundled IDL address/owner_program disagree; regenerate IDL for an owned deployment');
  return report.counterReference;
});

for (const [id, verify] of [['fresh-quote-cryptographic-verification', verifyTeeRpcIntegrity], ['cached-quote-cryptographic-verification', verifyTeeIntegrity]]) {
  await attempt(id, async () => { await verify(manifest.teeRpc); return { sdk: manifest.sdkVersion, verification: 'Official SDK DCAP collateral + reportData/challenge checks returned without error; no measurement allowlist check.' }; });
}
for (const quote of report.quotes) {
  await attempt(`${quote.method.slice(1)}-tcb-and-measurements`, async () => {
    if (typeof quote.body.quote !== 'string') throw new Error('No quote available');
    const bytes = Buffer.from(quote.body.quote, 'base64');
    const collateral = await getCollateral('https://pccs.phala.network/tdx/certification/v4', bytes);
    const verified = verifyQuote(bytes, collateral, Math.floor(Date.now() / 1000));
    const parsed = Quote.parse(bytes);
    const td = parsed.report.asTd10() ?? parsed.report.asTd15()?.base;
    if (!td) throw new Error('Unsupported non-TDX measurement format');
    quote.measurements = Object.fromEntries(['mrTd', 'rtMr0', 'rtMr1', 'rtMr2', 'rtMr3'].map(key => [key, Buffer.from(td[key]).toString('hex')]));
    quote.tcb = { status: verified.status, advisoryIds: verified.advisory_ids };
    if (tcbPolicy(verified) !== 'PASS') throw new Error('TCB not UpToDate or has advisories; explicit policy review required');
    return { tcb: quote.tcb, measurements: quote.measurements, expectedMeasurementComparison: 'BLOCKED: observed values are not an independently trusted allowlist' };
  });
}
add('expected-tee-application-measurement', 'BLOCKED', 'No independently approved measurement/RTMR/MRTD policy or validator-to-quote deployment binding has been supplied. A valid quote alone cannot approve the running game code.');

let teeAuthUrl;
const ownWallet = await wallet();
report.testWallet = { publicKey: ownWallet.pubkey, role: 'Dedicated, locally generated, devnet-only experiment wallet; private key excluded from evidence.' };
await attempt('tee-auth', async () => {
  const auth = await getAuthToken(manifest.teeRpc, ownWallet.publicKey, async message => {
    validateAuthChallenge(message, ownWallet.pubkey);
    return ownWallet.sign(message);
  });
  teeAuthUrl = `${manifest.teeRpc}?token=${encodeURIComponent(auth.token)}`;
  return { expiresAt: auth.expiresAt, tokenPersisted: false, ownMessageSignatureOnly: true };
});

async function inspectAccounts(name, url) {
  const entries = [...Object.entries(manifest.programs), ...Object.entries(manifest.queues)];
  await attempt(`${name}-account-snapshot`, async () => {
    const result = await rpc(url, 'getMultipleAccounts', [entries.map(([, address]) => address), { encoding: 'base64', commitment: 'confirmed' }]);
    if (!Array.isArray(result?.value) || result.value.length !== entries.length || !Number.isInteger(result?.context?.slot)) throw new Error('Malformed getMultipleAccounts response');
    const snapshot = { slot: result.context.slot, accounts: {} };
    for (let i = 0; i < entries.length; i++) {
      const [label, address] = entries[i];
      snapshot.accounts[label] = { address, ...accountSummary(result.value[i]) };
    }
    report.snapshots[name] = snapshot;
    const programs = Object.values(snapshot.accounts).filter(a => a.programDataAddress);
    if (programs.length) {
      const data = await rpc(url, 'getMultipleAccounts', [programs.map(a => a.programDataAddress), { encoding: 'base64', commitment: 'confirmed' }]);
      if (!Array.isArray(data?.value) || data.value.length !== programs.length) throw new Error('Malformed program-data response');
      for (let i = 0; i < programs.length; i++) programs[i].deployment = { observedSlot: data.context.slot, ...programDataSummary(data.value[i]) };
    }
    return { slot: snapshot.slot, count: entries.length, missing: entries.filter(([label]) => !snapshot.accounts[label].exists).map(([label]) => label) };
  });
}
if (genesis) await inspectAccounts('base', manifest.baseRpc);
await inspectAccounts('tee-anonymous', manifest.teeRpc);
if (teeAuthUrl) await inspectAccounts('tee-authenticated', teeAuthUrl);

for (const name of ['delegation', 'vrf', 'permission']) {
  const base = report.snapshots.base?.accounts[name];
  const tee = report.snapshots['tee-authenticated']?.accounts[name];
  add(`${name}-deployment-observed`, base?.exists && base.executable && base.deployment && tee?.exists && tee.executable ? 'PASS' : 'BLOCKED', { baseExists: base?.exists ?? null, baseExecutable: base?.executable ?? null, teeExists: tee?.exists ?? null, teeExecutable: tee?.executable ?? null, scope: 'Presence/metadata only, not source or permission compatibility.' });
  add(`${name}-base-tee-binary-match`, base?.deployment?.binarySha256IncludingAllocationPadding && base.deployment.binarySha256IncludingAllocationPadding === tee?.deployment?.binarySha256IncludingAllocationPadding ? 'PASS' : 'BLOCKED', { base: base?.deployment?.binarySha256IncludingAllocationPadding ?? null, tee: tee?.deployment?.binarySha256IncludingAllocationPadding ?? null, scope: 'Comparison of observed code bytes after loader metadata; not source provenance or runtime semantics.' });
}
add('tee-vrf-queue-support', 'BLOCKED', { base: report.snapshots.base?.accounts.delegated ?? null, tee: report.snapshots['tee-authenticated']?.accounts.delegated ?? null, reason: 'Queue existence/owner is only an observation. No oracle binding, delegated state decode, private request, or callback was exercised.' });
add('owned-counter-deployment', 'BLOCKED', 'An owned probe has a separate local SBF/IDL artifact report, but no owned devnet deployment has been verified. Third-party bundled IDL is not trusted or silently rewritten; no transaction was sent to third-party examples.');
add('deployed-source-binary-match', 'BLOCKED', 'Recorded hashes require reproducible builds and reviewed deployment/version bindings.');
const g0Required = ['installed-sdk-version', 'base-genesis', 'tee-identity', 'counter-source-idl-alignment', 'fresh-quote-cryptographic-verification', 'quote-tcb-and-measurements', 'expected-tee-application-measurement', 'tee-auth', 'delegation-deployment-observed', 'vrf-deployment-observed', 'permission-deployment-observed', 'tee-vrf-queue-support', 'owned-counter-deployment', 'deployed-source-binary-match'];
add('G0', aggregate(report.checks, g0Required), { required: g0Required });
for (let n = 1; n <= 8; n++) add(`G${n}`, 'BLOCKED', 'Not run: preflight prerequisites unresolved; no privacy, VRF, cash-out or payout claim.');
report.status = aggregate(report.checks, Array.from({ length: 9 }, (_, n) => `G${n}`));
report.finishedAt = new Date().toISOString();
await saveReport('g0-latest', report);
process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
