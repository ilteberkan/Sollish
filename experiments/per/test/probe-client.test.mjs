import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { delegateBufferPdaFromDelegatedAccountAndOwnerProgram, delegationRecordPdaFromDelegatedAccount, delegationMetadataPdaFromDelegatedAccount, permissionPdaFromAccount } from '@magicblock-labs/ephemeral-rollups-sdk';
import { base58, LOADER, LOADER_V4, sha256 } from '../lib.mjs';
import { PIN, KEY_NAMES, PROBE_FEE_POLICY, ProbeWriteJournal, authExpiry, authenticate, capture, createOriginPacer, initializedAccountAddresses, reconcileInitializedContinuation, rpc, validateInitializedContinuation, classifyIsolation, containsSecret, decodeReceipt, decodeRound, inspectDeployment, loadKeys, makePlan, observationSummary, probeInstruction, requireWriteOptIn, sendOwnInstruction, signedTransaction, simulationInstruction, simulationParams, u64, validateLocalArtifacts, validatePlan, verifyDeployedBytes } from '../probe-client.mjs';
import { offlineSequence, parseArguments } from '../probe-runner.mjs';

import { syntheticArtifacts } from './helpers/synthetic-artifacts.mjs';

// This file tests the client/validator logic with explicitly synthetic bytes.
// Real compiled ELF integrity is covered only by npm run test:artifacts.
const artifacts = await syntheticArtifacts();
const keys = Object.fromEntries(['inspector', 'playerA', 'playerB'].map((role, i) => [role, Keypair.fromSeed(Buffer.alloc(32, i + 41))]));
const plan = makePlan(keys.inspector.publicKey, [keys.playerA.publicKey, keys.playerB.publicKey], 1234567890123456789n);
const account = (bytes, owner = PIN.program, executable = false) => ({ data: [bytes.toString('base64'), 'base64'], owner, executable, lamports: 1 });
function roundAccount(status = 3) {
  const b = Buffer.alloc(178);
  Buffer.from(artifacts.idl.accounts.find(a => a.name === 'ProbeRound').discriminator).copy(b);
  keys.inspector.publicKey.toBuffer().copy(b, 8); keys.playerA.publicKey.toBuffer().copy(b, 40); keys.playerB.publicKey.toBuffer().copy(b, 72);
  u64(plan.roundId).copy(b, 104); new PublicKey(plan.round).toBuffer().copy(b, 112); Buffer.alloc(32, 9).copy(b, 144); b[176] = status;
  return account(b);
}
function programData(binary = artifacts.binary) {
  const b = Buffer.alloc(45 + binary.length + 10); b.writeUInt32LE(3); b[12] = 1; keys.inspector.publicKey.toBuffer().copy(b, 13); binary.copy(b, 45);
  return account(b, LOADER);
}

test('canonical PDA derivation matches pinned SDK and participant/round isolation', () => {
  const round = new PublicKey(plan.round), owner = new PublicKey(PIN.program);
  assert.equal(plan.permission, permissionPdaFromAccount(round).toBase58());
  assert.equal(plan.roundDelegation.buffer, delegateBufferPdaFromDelegatedAccountAndOwnerProgram(round, owner).toBase58());
  assert.equal(plan.roundDelegation.record, delegationRecordPdaFromDelegatedAccount(round).toBase58());
  assert.equal(plan.roundDelegation.metadata, delegationMetadataPdaFromDelegatedAccount(round).toBase58());
  assert.notEqual(plan.receipts[0].address, plan.receipts[1].address);
  assert.notEqual(plan.round, makePlan(plan.inspector, plan.players, 1).round);
  assert.deepEqual(validatePlan(plan, keys), plan);
  assert.throws(() => makePlan(plan.inspector, [plan.inspector, plan.players[1]], 1));
  assert.throws(() => validatePlan({ ...plan, round: plan.receipts[0].address }, keys));
});

test('u64 boundaries reject unsafe JS numbers, negative values and overflow', () => {
  assert.equal(u64('18446744073709551615').toString('hex'), 'ffffffffffffffff');
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 18446744073709551616n, '1e6', true]) assert.throws(() => u64(value));
});

test('explicit metas preserve player signer, private round readonly and own public receipt', () => {
  const ix = probeInstruction(artifacts.idl, plan, 'submit_probe', { playerIndex: 1, nonce: 7n });
  assert.deepEqual(ix.keys.map(a => [a.pubkey.toBase58(), a.isSigner, a.isWritable]), [[plan.players[1], true, false], [plan.round, false, false], [plan.receipts[1].address, false, true]]);
  assert.equal(ix.data.readBigUInt64LE(8), 7n);
  assert.throws(() => probeInstruction(artifacts.idl, plan, 'consume_probe_randomness'));
  assert.throws(() => probeInstruction(artifacts.idl, { ...plan, permission: plan.round }, 'prepare_private'));
  const broken = structuredClone(artifacts.idl); broken.instructions.find(i => i.name === 'delegate_round').accounts.find(a => a.name === 'owner_program').address = plan.inspector;
  assert.throws(() => probeInstruction(broken, plan, 'delegate_round'));
});

test('offline plan initializes both receipts before delegation and creates privacy before VRF', () => {
  const steps = offlineSequence(artifacts.idl, plan);
  assert.equal(steps.filter(s => s.instruction === 'initialize_receipt').length, 2);
  assert.equal(steps.findIndex(s => s.instruction === 'prepare_private'), 6);
  assert.equal(steps.findIndex(s => s.instruction === 'request_probe_randomness'), 7);
  assert.equal(steps.at(-1).instruction, 'reveal_probe');
  assert.equal(steps[8].accounts.find(a => a.name === 'round').writable, false);
});

test('real serialized signed simulation requests exact secret and receipt return bytes', () => {
  const wire = signedTransaction(probeInstruction(artifacts.idl, plan, 'submit_probe'), keys.playerA, new PublicKey(Buffer.alloc(32, 7)).toBase58());
  const decoded = Transaction.from(Buffer.from(wire, 'base64'));
  assert.equal(decoded.verifySignatures(), true);
  assert.equal(decoded.instructions[0].programId.toBase58(), PIN.program);
  assert.deepEqual(simulationParams(wire, plan, 0)[1], { encoding: 'base64', sigVerify: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [plan.round, plan.receipts[0].address] } });
  assert.throws(() => signedTransaction(probeInstruction(artifacts.idl, plan, 'submit_probe'), keys.playerB, plan.round));
});

test('adversarial signed simulation promotes only the private round to writable', () => {
  const baseline = simulationInstruction(artifacts.idl, plan, 1, 9n, 'readonly');
  const promoted = simulationInstruction(artifacts.idl, plan, 1, 9n, 'writable-promoted');
  assert.deepEqual(baseline.data, promoted.data);
  assert.deepEqual(baseline.keys.map(k => k.isWritable), [false, false, true]);
  assert.deepEqual(promoted.keys.map(k => k.isWritable), [false, true, true]);
  const tx = Transaction.from(Buffer.from(signedTransaction(promoted, keys.playerB, plan.round), 'base64'));
  assert.equal(tx.verifySignatures(), true);
  assert.equal(tx.instructions[0].keys[1].isWritable, true);
  assert.throws(() => simulationInstruction(artifacts.idl, plan, 1, 1n, 'unknown'));
});

test('synthetic artifact validator requires matching lock, source, IDL and fake ELF hashes', () => {
  const input = artifacts.input;
  assert.equal(input.report.synthetic, true);
  assert.match(input.report.scope, /SYNTHETIC/);
  assert.equal(validateLocalArtifacts(input).report.localArtifactConsistency, 'PASS');
  assert.throws(() => validateLocalArtifacts({ ...input, lock: Buffer.concat([input.lock, Buffer.from('\n')]) }), /Cargo.lock/);
  assert.throws(() => validateLocalArtifacts({ ...input, report: { ...input.report, localArtifactConsistency: 'BLOCKED' } }));
  assert.throws(() => validateLocalArtifacts({ ...input, binary: Buffer.alloc(8) }));
  const foreignSource = Buffer.from(`declare_id!("${plan.inspector}");`);
  assert.throws(() => validateLocalArtifacts({ ...input, source: foreignSource, report: { ...input.report, sourceSha256: sha256(foreignSource) } }), /source program identity/);
});

test('private and receipt decoders bind discriminators, owner, players and round', () => {
  assert.equal(decodeRound(roundAccount(), artifacts.idl, plan).status, 3);
  assert.throws(() => decodeRound({ ...roundAccount(), owner: PIN.vrf }, artifacts.idl, plan));
  assert.throws(() => decodeRound(roundAccount(), artifacts.idl, { ...plan, roundId: '1' }));
  const b = Buffer.alloc(89); Buffer.from(artifacts.idl.accounts.find(a => a.name === 'ProbeReceipt').discriminator).copy(b);
  new PublicKey(plan.round).toBuffer().copy(b, 8); keys.playerA.publicKey.toBuffer().copy(b, 40); u64(3n).copy(b, 72); u64(3n).copy(b, 80);
  assert.equal(decodeReceipt(account(b), artifacts.idl, plan, 0).lastNonce, '3');
  assert.throws(() => decodeReceipt(account(b), artifacts.idl, plan, 1));
});

test('synthetic deployed-byte verifier excludes metadata and accepts only zero allocation padding', () => {
  const good = programData();
  assert.equal(verifyDeployedBytes(good, artifacts.binary, { expectedAuthority: plan.inspector }).elfSha256, sha256(artifacts.binary));
  assert.throws(() => verifyDeployedBytes(good, artifacts.binary, { expectedAuthority: plan.players[0] }));
  const changed = Buffer.from(good.data[0], 'base64'); changed[changed.length - 1] = 1;
  assert.throws(() => verifyDeployedBytes(account(changed, LOADER), artifacts.binary, { expectedAuthority: plan.inspector }));
  const tee = Buffer.alloc(48 + artifacts.binary.length); tee.writeBigUInt64LE(1n, 40); artifacts.binary.copy(tee, 48);
  assert.equal(verifyDeployedBytes(account(tee, LOADER_V4, true), artifacts.binary, { tee: true }).elfBytes, artifacts.binary.length);
  tee.writeBigUInt64LE(0n, 40);
  assert.throws(() => verifyDeployedBytes(account(tee, LOADER_V4, true), artifacts.binary, { tee: true }));
});

test('deployment gate rejects wrong genesis before account reads and requires canonical own loader state', async () => {
  const calls = [];
  await assert.rejects(inspectDeployment(artifacts, plan.inspector, { call: async (url, method) => { calls.push(method); return 'wrong-network'; } }), /genesis/);
  assert.deepEqual(calls, ['getGenesisHash']);
  const address = PublicKey.findProgramAddressSync([new PublicKey(PIN.program).toBuffer()], new PublicKey(LOADER))[0];
  const executable = Buffer.alloc(36); executable.writeUInt32LE(2); address.toBuffer().copy(executable, 4);
  const mock = async (url, method, params) => method === 'getGenesisHash' ? PIN.genesis : { value: params[0] === PIN.program ? account(executable, LOADER, true) : programData() };
  assert.equal((await inspectDeployment(artifacts, plan.inspector, { call: mock })).upgradeAuthority, plan.inspector);
  await assert.rejects(inspectDeployment(artifacts, plan.inspector, { teeUrl: 'https://attacker.invalid', call: mock }), /pinned TEE/);
  const wrongTeeIdentity = async (url, method, params) => method === 'getIdentity' ? { identity: plan.inspector } : mock(url, method, params);
  await assert.rejects(inspectDeployment(artifacts, plan.inspector, { teeUrl: PIN.tee, call: wrongTeeIdentity }), /TEE validator/);
});

test('no write reaches network without both opt-ins, correct destination and verified deployment', async () => {
  let calls = 0;
  const call = async () => { calls++; return 'wrong-network'; };
  const input = { artifacts, plan, name: 'initialize_round', key: keys.inspector, url: PIN.base, call };
  await assert.rejects(sendOwnInstruction({ ...input, options: { allowWrites: true } }), /experimental/);
  assert.equal(calls, 0);
  await assert.rejects(sendOwnInstruction({ ...input, url: PIN.tee, options: { allowWrites: true, experimentalDevnet: true } }), /wrong chain/);
  assert.equal(calls, 0);
  await assert.rejects(sendOwnInstruction({ ...input, options: { allowWrites: true, experimentalDevnet: true } }), /genesis/);
  assert.equal(calls, 1);
  assert.throws(() => requireWriteOptIn({ experimentalDevnet: true }));
});

test('missing/filtered/private errors never become privacy PASS; real returned data fails', () => {
  const observed = result => ({ httpStatus: 200, text: JSON.stringify(result), body: { jsonrpc: '2.0', id: 1, result } });
  assert.equal(classifyIsolation(roundAccount(), observed({ value: null }), artifacts.idl, plan), 'BLOCKED');
  assert.equal(classifyIsolation(roundAccount(), observed({ value: roundAccount() }), artifacts.idl, plan), 'FAIL');
  assert.equal(classifyIsolation(roundAccount(), { httpStatus: 403, text: '', body: null }, artifacts.idl, plan), 'PASS');
  assert.equal(classifyIsolation(roundAccount(0), { httpStatus: 403, text: '', body: null }, artifacts.idl, plan), 'BLOCKED');
  assert.equal(observationSummary({ httpStatus: 200, text: '{}', body: {} }).outcome, 'BLOCKED');
  assert.throws(() => classifyIsolation(null, observed(null), artifacts.idl, plan));
});

test('reveal comparison detects embedded bytes in account base64 and callback base58 without persistence', () => {
  const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 17));
  const payload = Buffer.concat([Buffer.alloc(11, 255), secret, Buffer.alloc(9, 252)]);
  for (const body of [{ data: [payload.toString('base64'), 'base64'] }, { innerInstructions: [{ data: base58(payload) }] }, { logs: [`value ${secret.toString('hex')}`] }, { returnData: [...payload] }]) assert.equal(containsSecret(body, secret), true);
  assert.equal(containsSecret({ result: { value: null } }, secret), false);
  assert.equal(containsSecret({ data: Buffer.alloc(32, 1).toString('base64') }, secret), false);
});

test('own keys are distinct, stable, 0600 and never selected from user CLI configuration', async () => {
  const directory = pathToFileURL((await mkdtemp(`${tmpdir()}/sollish-per-keys-`)) + '/');
  try {
    const first = await loadKeys({ create: true, directory });
    const second = await loadKeys({ directory });
    assert.equal(first.inspector.publicKey.toBase58(), second.inspector.publicKey.toBase58());
    assert.equal(new Set(Object.values(first).map(k => k.publicKey.toBase58())).size, 3);
    for (const name of Object.values(KEY_NAMES)) assert.equal((await stat(new URL(name, directory))).mode & 0o777, 0o600);
    await writeFile(new URL(KEY_NAMES.playerA, directory), await readFile(new URL(KEY_NAMES.inspector, directory)));
    await assert.rejects(loadKeys({ directory }), /must differ/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI rejects accidental write flags, arbitrary endpoints and unsupported deployment commands', () => {
  assert.equal(parseArguments(['prepare']).mode, 'prepare');
  assert.equal(parseArguments(['run', '--experimental-devnet', '--allow-writes']).allowWrites, true);
  for (const args of [['run'], ['run', '--allow-writes'], ['prepare', '--allow-writes'], ['inspect', '--rpc', PIN.base], ['deploy'], ['run', '--round-id', '2']]) assert.throws(() => parseArguments(args));
});

async function writeFixture({ tee = false } = {}) {
  const directory = pathToFileURL((await mkdtemp(`${tmpdir()}/sollish-per-wal-`)) + '/');
  const journal = await ProbeWriteJournal.acquire(plan, { directory });
  const programDataAddress = PublicKey.findProgramAddressSync([new PublicKey(PIN.program).toBuffer()], new PublicKey(LOADER))[0];
  const executable = Buffer.alloc(36); executable.writeUInt32LE(2); programDataAddress.toBuffer().copy(executable, 4);
  const teeProgram = Buffer.alloc(48 + artifacts.binary.length); teeProgram.writeBigUInt64LE(1n, 40); artifacts.binary.copy(teeProgram, 48);
  let sends = 0; let signedSignature; let persistedAtSend; const calls = [];
  const overrides = {};
  const call = async (url, method, params) => {
    calls.push(method);
    if (Object.hasOwn(overrides, method)) return overrides[method](url, params);
    if (method === 'getGenesisHash') return PIN.genesis;
    if (method === 'getIdentity') return { identity: PIN.validator };
    if (method === 'getAccountInfo') return { value: url.startsWith(PIN.tee) ? account(teeProgram, LOADER_V4, true) : params[0] === PIN.program ? account(executable, LOADER, true) : programData() };
    if (method === 'getLatestBlockhash') return { value: { blockhash: new PublicKey(Buffer.alloc(32, 7)).toBase58(), lastValidBlockHeight: 500 } };
    if (method === 'getFeeForMessage') return { value: tee ? 0 : 5000 };
    if (method === 'getBalance') return { value: 1_000_000 };
    if (method === 'getBlockHeight') return 450;
    if (method === 'sendTransaction') {
      sends++; const tx = Transaction.from(Buffer.from(params[0], 'base64')); assert.equal(tx.verifySignatures(), true);
      signedSignature = base58(tx.signature); persistedAtSend = JSON.parse(await readFile(journal.path, 'utf8'));
      assert.equal(persistedAtSend.entries.at(-1).signature, signedSignature); assert.equal(persistedAtSend.entries.at(-1).state, 'prepared');
      assert.equal(persistedAtSend.entries.at(-1).messageSha256, sha256(tx.serializeMessage()));
      assert.equal(params[1].maxRetries, 3); return signedSignature;
    }
    if (method === 'getSignatureStatuses') return { value: [{ err: null, slot: 450, confirmationStatus: 'confirmed' }] };
    throw new Error(`Unexpected mock method ${method}`);
  };
  const input = { artifacts, plan, name: tee ? 'prepare_private' : 'initialize_round', key: keys.inspector, url: tee ? `${PIN.tee}?token=DO_NOT_PERSIST_THIS_TOKEN` : PIN.base, options: { experimentalDevnet: true, allowWrites: true }, journal, call, wait: async () => {} };
  return { directory, journal, input, overrides, calls, get sends() { return sends; }, get signature() { return signedSignature; }, get persistedAtSend() { return persistedAtSend; }, close: async () => { await journal.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('own write journal is persisted before broadcast and matches local signature and message digest', async () => {
  const f = await writeFixture(); try {
    const signature = await sendOwnInstruction(f.input); assert.equal(signature, f.signature); assert.equal(f.sends, 1);
    assert.equal(f.journal.summary().entries[0].state, 'confirmed'); assert.equal((await stat(f.journal.path)).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(f.persistedAtSend.entries[0]).sort(), ['action','role','chain','signature','messageSha256','lastValidBlockHeight','feeLamports','state'].sort());
    await assert.rejects(sendOwnInstruction(f.input), /already attempted/); assert.equal(f.sends, 1);
  } finally { await f.close(); }
});

test('zero TEE network fee is valid without persisting auth tokens or signed wires', async () => {
  const f = await writeFixture({ tee: true }); try {
    f.overrides.getBalance = async () => ({ value: 0 });
    await sendOwnInstruction(f.input); assert.equal(f.sends, 1); assert.equal(f.journal.summary().entries[0].feeLamports, 0);
    const persisted = await readFile(f.journal.path, 'utf8'); assert.equal(persisted.includes('DO_NOT_PERSIST_THIS_TOKEN'), false);
    assert.equal(persisted.includes('transaction'), false); assert.equal(persisted.includes('randomness'), false);
  } finally { await f.close(); }
});

test('unknown submission stays journaled across restart and never sends the action twice', async () => {
  const f = await writeFixture(); let restored;
  try {
    let attempts = 0;
    f.overrides.sendTransaction = async () => { attempts++; assert.equal(JSON.parse(await readFile(f.journal.path, 'utf8')).entries[0].state, 'prepared'); throw new Error('RPC arbitrary-private-data-not-for-disk'); };
    await assert.rejects(sendOwnInstruction(f.input), /arbitrary-private/); assert.equal(attempts, 1);
    await f.journal.close(); restored = await ProbeWriteJournal.acquire(plan, { directory: f.directory });
    await assert.rejects(sendOwnInstruction({ ...f.input, journal: restored }), /already attempted/); assert.equal(attempts, 1);
    assert.equal((await readFile(restored.path, 'utf8')).includes('arbitrary-private'), false); assert.equal(restored.summary().entries[0].state, 'prepared');
  } finally { await restored?.close(); await f.close(); }
});

test('different returned signature, malformed confirmation and expiry remain unknown rather than successful', async () => {
  for (const mode of ['signature','missing-error','undefined-error','false-error','missing-slot','expired','timeout']) {
    const f = await writeFixture(); try {
      if (mode === 'signature') f.overrides.sendTransaction = async () => base58(Buffer.alloc(64, 3));
      else if (mode === 'expired' || mode === 'timeout') { f.overrides.getSignatureStatuses = async () => ({ value: [null] }); if (mode === 'expired') f.overrides.getBlockHeight = async () => 501; }
      else f.overrides.getSignatureStatuses = async () => ({ value: [{ confirmationStatus: 'confirmed', ...(mode === 'missing-slot' ? {} : { slot: 450 }), ...(mode === 'missing-error' ? {} : { err: mode === 'undefined-error' ? undefined : mode === 'false-error' ? false : null }) }] });
      await assert.rejects(sendOwnInstruction(f.input)); assert.equal(f.journal.summary().entries[0].state, 'prepared');
      const sends = f.calls.filter(x => x === 'sendTransaction').length; assert.equal(sends, 1);
      await assert.rejects(sendOwnInstruction(f.input), /already attempted/); assert.equal(f.calls.filter(x => x === 'sendTransaction').length, 1);
      if (mode === 'timeout') assert.equal(f.calls.filter(x => x === 'getSignatureStatuses').length, 25);
    } finally { await f.close(); }
  }
});

test('fee caps, missing quotes, minimum balance, and cumulative budget reject before reservation or send', async () => {
  for (const mode of ['fee','null-fee','missing-fee','negative-fee','balance','missing-balance','expiry']) {
    const f = await writeFixture(); try {
      if (mode.includes('fee')) f.overrides.getFeeForMessage = async () => mode === 'missing-fee' ? {} : { value: mode === 'fee' ? 100001 : mode === 'null-fee' ? null : -1 };
      if (mode === 'balance' || mode === 'missing-balance') f.overrides.getBalance = async () => mode === 'balance' ? { value: 104999 } : {};
      if (mode === 'expiry') f.overrides.getLatestBlockhash = async () => ({ value: { blockhash: plan.round } });
      await assert.rejects(sendOwnInstruction(f.input)); assert.equal(f.sends, 0); assert.equal(f.journal.summary().entries.length, 0);
    } finally { await f.close(); }
  }
  // Pure guard boundary: real journal admission additionally caps action count11.
  const journal = new ProbeWriteJournal(null, {}, { entries: Array.from({ length: 20 }, () => ({ feeLamports: 100000, role: 'inspector', chain: 'L1' })) });
  assert.throws(() => journal.guard(1, 10_000_000, 'inspector', 'L1'), /fee\/balance limit/);
  assert.equal(PROBE_FEE_POLICY.cumulative, 2_000_000);
});

test('prior attempt fees remain reserved against stale balance and failed status records contain no RPC error', async () => {
  const f = await writeFixture(); try {
    f.overrides.getSignatureStatuses = async () => ({ value: [{ err: { InstructionError: [0, 'PRIVATE_RPC_SENTINEL'] }, slot: 450, confirmationStatus: 'confirmed' }] });
    await assert.rejects(sendOwnInstruction(f.input), /execution failed/); assert.equal(f.journal.summary().entries[0].state, 'failed');
    assert.equal((await readFile(f.journal.path, 'utf8')).includes('PRIVATE_RPC_SENTINEL'), false);
    assert.throws(() => f.journal.guard(5000, 109999, 'inspector', 'L1'), /fee\/balance limit/);
    assert.doesNotThrow(() => f.journal.guard(5000, 110000, 'inspector', 'L1'));
    await assert.rejects(ProbeWriteJournal.acquire(plan, { directory: f.directory }), /EEXIST/);
  } finally { await f.close(); }
});

const authNow = 1_790_864_120_314;
const authClaims = () => ({ pubkey: plan.inspector, iat: Math.floor(authNow / 1000), exp: Math.floor(authNow / 1000) + 30 * 86400 });
const testToken = (claims = authClaims(), header = { alg: 'HS256', typ: 'JWT' }) => [header, claims].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).concat(Buffer.alloc(32, 7).toString('base64url')).join('.');

test('token-only login timestamps are unverified scheduling hints capped at thirty minutes', () => {
  const expiry = authExpiry({ token: testToken() }, plan.inspector, authNow);
  assert.equal(expiry.expiresAt, authNow + 30 * 60000);
  assert.equal(expiry.expirySource, 'UNVERIFIED_JWT_LOCAL_DEADLINE');
  assert.equal(expiry.jwtSignatureVerified, false); assert.equal(expiry.authorizationGrantedLocally, false);
  assert.equal(JSON.stringify(expiry).includes(testToken()), false);
  // An arbitrary synthetic signature deliberately still parses: this function
  // cannot authenticate identity or grant rights; only QFS may authorize RPC.
  assert.equal(authExpiry({ token: testToken().replace(/\.[^.]+$/, '.AQ') }, plan.inspector, authNow).authorizationGrantedLocally, false);
});

test('explicit response expiry and JWT expiry choose the earliest bounded deadline', () => {
  const short = Math.floor(authNow / 1000) + 90;
  assert.equal(authExpiry({ token: testToken(), expiresAt: authNow + 5000 }, plan.inspector, authNow).expiresAt, authNow + 5000);
  assert.equal(authExpiry({ token: testToken({ ...authClaims(), exp: short }), expiresAt: authNow + 600000 }, plan.inspector, authNow).expiresAt, short * 1000);
  for (const expiresAt of [undefined, null, String(authNow + 5000), NaN, Infinity, authNow, authNow - 1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => authExpiry({ token: testToken(), expiresAt }, plan.inspector, authNow), /explicit auth expiry/);
  }
});

test('missing, expired, future-issued, wrong-wallet and unsafe JWT claims fail closed', () => {
  const variants = [
    {}, { ...authClaims(), exp: undefined }, { ...authClaims(), iat: undefined },
    { ...authClaims(), pubkey: plan.players[0] }, { ...authClaims(), exp: String(authClaims().exp) },
    { ...authClaims(), iat: String(authClaims().iat) }, { ...authClaims(), exp: Math.floor(authNow / 1000) },
    { ...authClaims(), iat: Math.floor(authNow / 1000) + 31 }, { ...authClaims(), exp: Number.MAX_SAFE_INTEGER },
    { ...authClaims(), iat: -1 }, { ...authClaims(), exp: authClaims().iat }, null, [],
  ];
  for (const claims of variants) assert.throws(() => authExpiry({ token: testToken(claims) }, plan.inspector, authNow));
  assert.doesNotThrow(() => authExpiry({ token: testToken({ ...authClaims(), iat: Math.floor(authNow / 1000) + 30 }) }, plan.inspector, authNow));
});

test('JWT scheduling decoder requires bounded canonical base64url and valid JSON', () => {
  const good = testToken(), [header, payload] = good.split('.');
  for (const token of ['', 'opaque-token', good + '.extra', `${header}=.${payload}.AQ`, `${header}.${payload}.AR`, `${header}.${Buffer.from('not-json').toString('base64url')}.AQ`, `${header}.${Buffer.from([0xff]).toString('base64url')}.AQ`, `${header}.${'A'.repeat(4097)}.AQ`, testToken(authClaims(), { alg: 'none' })]) assert.throws(() => authExpiry({ token }, plan.inspector, authNow));
  for (const response of [null, {}, { token: null }, { token: good.repeat(50) }]) assert.throws(() => authExpiry(response, plan.inspector, authNow));
});

test('mock QFS challenge and token-only login use strict local deadline without claiming authorization', async () => {
  const calls = [], token = testToken();
  const result = await authenticate(keys.inspector, { now: () => authNow, pace: (_url, operation) => operation(), fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.includes('/auth/challenge?')) return { status: 200, json: async () => ({ challenge: `Login to Query Filtering Service\nTimestamp: ${Math.floor(authNow / 1000)}\nUser: ${plan.inspector}` }) };
    assert.equal(url, `${PIN.tee}/auth/login`); assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body); assert.equal(body.pubkey, plan.inspector); assert.equal(typeof body.signature, 'string');
    return { status: 200, json: async () => ({ token }) };
  } });
  assert.equal(calls.length, 2); assert.equal(new URL(result.url).searchParams.get('token'), token);
  assert.equal(result.expiresAt, authNow + 30 * 60000); assert.equal(result.jwtSignatureVerified, false); assert.equal(result.authorizationGrantedLocally, false);
});

function initializedFixture() {
  const roles = ['inspector', 'playerA', 'playerB'];
  const wires = roles.map((role, i) => signedTransaction(probeInstruction(artifacts.idl, plan, i === 0 ? 'initialize_round' : 'initialize_receipt', { playerIndex: i === 2 ? 1 : 0 }), keys[role], plan.round));
  const transactions = wires.map((wire, i) => ({ transaction: [wire, 'base64'], meta: { err: null }, slot: 500 + i, version: 'legacy' }));
  const entries = wires.map((wire, i) => { const tx = Transaction.from(Buffer.from(wire, 'base64')); return { action: i === 0 ? 'initialize_round' : 'initialize_receipt', role: roles[i], chain: 'L1', signature: base58(tx.signature), messageSha256: sha256(tx.serializeMessage()), lastValidBlockHeight: 600, feeLamports: 5000, state: i === 2 ? 'prepared' : 'confirmed' }; });
  const round = roundAccount(0), roundBytes = Buffer.from(round.data[0], 'base64'); roundBytes.fill(0, 144, 176); round.data[0] = roundBytes.toString('base64');
  const receipts = [0, 1].map(i => { const bytes = Buffer.alloc(89); Buffer.from(artifacts.idl.accounts.find(a => a.name === 'ProbeReceipt').discriminator).copy(bytes); new PublicKey(plan.round).toBuffer().copy(bytes, 8); new PublicKey(plan.players[i]).toBuffer().copy(bytes, 40); return account(bytes); });
  return { artifacts, plan, entries, transactions, statuses: roles.map((_role, i) => ({ err: null, slot: 500 + i, confirmationStatus: 'finalized' })), accounts: { context: { slot: 600 }, value: [round, ...receipts, ...Array(9).fill(null)] } };
}

test('initialized resume requires both opt-ins and keeps the existing round', () => {
  assert.equal(parseArguments(['resume-initialized', '--experimental-devnet', '--allow-writes']).mode, 'resume-initialized');
  for (const args of [['resume-initialized'], ['resume-initialized', '--allow-writes'], ['resume-initialized', '--experimental-devnet', '--allow-writes', '--round-id', '9']]) assert.throws(() => parseArguments(args));
  const f = initializedFixture(), proof = validateInitializedContinuation(f);
  assert.equal(proof.round, plan.round); assert.equal(proof.confirmed.length, 3); assert.equal(proof.initializationRebroadcast, false);
  assert.deepEqual(proof.confirmed.map(e => e.signature), f.entries.map(e => e.signature));
  assert.equal(initializedAccountAddresses(plan).length, 12);
});

test('initializer resume rejects extras, failed journals, pending/unknown status and message mismatch', () => {
  for (const mutate of [
    f => f.entries.push({ ...f.entries[0], action: 'delegate_round' }),
    f => f.entries.pop(), f => { f.entries[1].state = 'failed'; }, f => { f.entries[0].role = 'playerA'; },
    f => { f.statuses[2] = null; }, f => { f.statuses[2].confirmationStatus = 'confirmed'; },
    f => { delete f.statuses[2].err; }, f => { f.statuses[2].err = { InstructionError: [0, 'failed'] }; },
    f => { f.transactions[2] = null; }, f => { f.transactions[2].meta.err = undefined; },
    f => { f.transactions[2].slot--; }, f => { f.entries[2].messageSha256 = 'f'.repeat(64); },
    f => { f.transactions[2].transaction[0] += '='; },
  ]) { const f = initializedFixture(); mutate(f); assert.throws(() => validateInitializedContinuation(f)); }
});

test('initializer resume rejects progressed/private/randomized/foreign or already-delegated accounts', () => {
  const alter = (f, index, offset, value) => { const b = Buffer.from(f.accounts.value[index].data[0], 'base64'); b[offset] = value; f.accounts.value[index].data[0] = b.toString('base64'); };
  for (const mutate of [
    f => alter(f, 0, 176, 1), f => alter(f, 0, 144, 1), f => alter(f, 1, 72, 1), f => alter(f, 2, 80, 1),
    f => { f.accounts.value[0].owner = PIN.delegation; }, f => { f.accounts.value[1].owner = PIN.delegation; },
    f => { f.accounts.value[3] = account(Buffer.alloc(0)); }, f => { f.accounts.value[11] = {}; },
    f => { f.accounts.context.slot = 499; }, f => { f.accounts.value.pop(); },
    f => { f.plan = { ...f.plan, round: plan.receipts[0].address }; },
  ]) { const f = initializedFixture(); mutate(f); assert.throws(() => validateInitializedContinuation(f)); }
});

test('resume reconciles only after all finalized messages/accounts match, without a send or re-sign', async () => {
  for (const broken of [false, true]) {
    const f = initializedFixture(), directory = pathToFileURL((await mkdtemp(`${tmpdir()}/sollish-resume-`)) + '/');
    const journal = await ProbeWriteJournal.acquire(plan, { directory });
    try {
      for (const entry of f.entries) { const { state, ...publicEntry } = entry; await journal.reserve(publicEntry, 1_000_000); if (state === 'confirmed') await journal.mark(entry.signature, 'confirmed'); }
      const before = await readFile(journal.path, 'utf8');
      if (broken) f.transactions[2] = null;
      const calls = [];
      const call = async (_url, method, params) => {
        calls.push(method);
        if (method === 'getGenesisHash') return PIN.genesis;
        if (method === 'getSignatureStatuses') return { value: f.statuses };
        if (method === 'getTransaction') { assert.equal(params[1].commitment, 'finalized'); return f.transactions[f.entries.findIndex(e => e.signature === params[0])]; }
        if (method === 'getMultipleAccounts') { assert.deepEqual(params[0], initializedAccountAddresses(plan)); assert.equal(params[1].minContextSlot, 502); assert.equal(params[1].commitment, 'finalized'); return f.accounts; }
        throw new Error('Unexpected network mutation');
      };
      if (broken) { await assert.rejects(reconcileInitializedContinuation({ artifacts, plan, journal, call })); assert.equal(await readFile(journal.path, 'utf8'), before); }
      else { const proof = await reconcileInitializedContinuation({ artifacts, plan, journal, call }); assert.equal(proof.confirmed.length, 3); assert.equal(journal.summary().entries.every(e => e.state === 'confirmed'), true); }
      assert.equal(calls.includes('sendTransaction'), false); assert.equal(calls.includes('getLatestBlockhash'), false);
    } finally { await journal.close(); await rm(directory, { recursive: true, force: true }); }
  }
});

test('RPC and capture share an origin queue with600ms spacing and independent origins', async () => {
  let time = 0; const starts = [], waits = [];
  const pace = createOriginPacer({ now: () => time, wait: async ms => { waits.push(ms); time += ms; } });
  const call = async (url, method) => { starts.push({ origin: new URL(url).origin, method, time }); if (method === 'fail') throw new Error('HTTP429'); return 'ok'; };
  const fetchImpl = async url => { starts.push({ origin: new URL(url).origin, method: 'capture', time }); return { status: 200, text: async () => '{"jsonrpc":"2.0","id":1,"result":null}' }; };
  await rpc(PIN.base, 'first', [], { pace, call });
  await capture(`${PIN.base}?token=not-retained`, 'getAccountInfo', [], { pace, fetchImpl });
  await rpc(PIN.tee, 'other-origin', [], { pace, call });
  await assert.rejects(rpc(PIN.base, 'fail', [], { pace, call }), /HTTP429/);
  await rpc(PIN.base, 'after-fail', [], { pace, call });
  assert.deepEqual(starts.map(x => x.time), [0, 600, 600, 1200, 1800]); assert.deepEqual(waits, [600, 600, 600]);
  assert.equal(starts.filter(x => x.method === 'fail').length, 1);
  assert.throws(() => createOriginPacer({ interval: 599 }));
});

test('concurrent calls to the same origin cannot bypass serialized pacing', async () => {
  let time = 0; const starts = [];
  const pace = createOriginPacer({ now: () => time, wait: async ms => { time += ms; } });
  await Promise.all([0, 1, 2].map(i => pace(`${PIN.base}?ignored=${i}`, async () => { starts.push(time); })));
  assert.deepEqual(starts, [0, 600, 1200]);
});
