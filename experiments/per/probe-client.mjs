import { createPrivateKey, sign } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { base58, decodeData, LOADER, LOADER_V4, redact, rpc as unpacedRpc, sha256, validateAuthChallenge } from './lib.mjs';
import { validateProbeIdl } from './program/validate-idl.mjs';

export const PIN = Object.freeze({
  program: 'AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va',
  base: 'https://api.devnet.solana.com', tee: 'https://devnet-tee.magicblock.app',
  genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  delegation: 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh',
  permission: 'ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1',
  vrf: 'Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz',
  queue: '5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc',
  magic: 'Magic11111111111111111111111111111111111111',
  vault: 'MagicVau1t999999999999999999999999999999999',
  slots: 'SysvarS1otHashes111111111111111111111111111',
  validator: 'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo',
});
export const KEY_DIR = new URL('../../.tooling/per/', import.meta.url);
export const KEY_NAMES = Object.freeze({ inspector: 'probe-payer-keypair.json', playerA: 'probe-player-a-keypair.json', playerB: 'probe-player-b-keypair.json' });
// Experimental network-fee limits only. Account rent and provider CPI charges
// require a separate funding decision; getFeeForMessage does not quote those.
export const PROBE_FEE_POLICY = Object.freeze({ perTransaction: 100_000, cumulative: 2_000_000, minimumL1Balance: 100_000, minimumTeeBalance: 0 });
const safeLamports = value => Number.isSafeInteger(value) && value >= 0;
const PROBE_ACTIONS = ['initialize_round', 'initialize_receipt', 'delegate_round', 'delegate_receipt', 'prepare_private', 'request_probe_randomness', 'submit_probe', 'reveal_probe'];

/** One serialized queue per origin, shared by probe RPC and captured responses.
 * URLs/tokens are not retained. A failed call is not retried by the scheduler. */
export function createOriginPacer({ now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), interval = 600 } = {}) {
  if (!Number.isSafeInteger(interval) || interval < 600) throw new Error('Probe pacing must be at least600ms');
  const tails = new Map(), starts = new Map();
  return (url, operation) => {
    const origin = new URL(url).origin;
    const next = (tails.get(origin) ?? Promise.resolve()).then(async () => {
      const delay = starts.has(origin) ? Math.max(0, starts.get(origin) + interval - now()) : 0;
      if (delay) await wait(delay);
      starts.set(origin, now()); return operation();
    });
    tails.set(origin, next.catch(() => {})); return next;
  };
}
const paceProbeRequest = createOriginPacer();
export function rpc(url, method, params = [], { pace = paceProbeRequest, call = unpacedRpc } = {}) {
  return pace(url, () => call(url, method, params));
}

/** Before-broadcast journal: public identifiers/digests only, never wires, auth,
 * account bytes, randomness or provider error text. Every attempt stays charged
 * against the fee budget, including failed/unknown attempts. No automatic retry. */
export class ProbeWriteJournal {
  constructor(path, binding, data) { this.path = path; this.binding = binding; this.data = data; this.closed = false; }
  static async acquire(plan, { directory = KEY_DIR } = {}) {
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const st = await directoryHandle.stat(); if (!st.isDirectory() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid?.()) throw new Error('Unsafe probe journal directory'); }
    finally { await directoryHandle.close(); }
    const path = new URL(`probe-writes-${plan.round}.json`, directory), lock = new URL(`${path.href}.lock`);
    await mkdir(lock, { mode: 0o700 });
    try {
      const binding = { version: 1, genesis: PIN.genesis, program: PIN.program, round: plan.round, inspector: plan.inspector, players: plan.players };
      let data = { ...binding, entries: [] };
      try {
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const st = await file.stat(); if (!st.isFile() || (st.mode & 0o777) !== 0o600 || st.uid !== process.getuid?.() || st.size > 1_000_000) throw new Error('Unsafe probe journal file'); data = JSON.parse(await file.readFile('utf8')); }
        finally { await file.close(); }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (Object.keys(data).sort().join() !== [...Object.keys(binding), 'entries'].sort().join() || Object.keys(binding).some(k => JSON.stringify(data[k]) !== JSON.stringify(binding[k])) || !Array.isArray(data.entries) || data.entries.length > 11) throw new Error('Wrong probe journal binding');
      let fees = 0;
      const actions = new Set();
      for (const e of data.entries) {
        const expectedFields = ['action', 'role', 'chain', 'signature', 'messageSha256', 'lastValidBlockHeight', 'feeLamports', 'state'];
        if (Object.keys(e).sort().join() !== expectedFields.sort().join() || !PROBE_ACTIONS.includes(e.action) || !['inspector', 'playerA', 'playerB'].includes(e.role) || !['L1', 'TEE'].includes(e.chain) || !isCanonicalTransactionSignature(e.signature) || !/^[a-f0-9]{64}$/.test(e.messageSha256) || !safeLamports(e.lastValidBlockHeight) || !safeLamports(e.feeLamports) || e.feeLamports > PROBE_FEE_POLICY.perTransaction || !['prepared', 'confirmed', 'failed'].includes(e.state)) throw new Error('Invalid probe journal entry');
        const action = `${e.chain}:${e.action}:${e.role}`;
        if (actions.has(action)) throw new Error('Duplicate probe journal action');
        actions.add(action); fees += e.feeLamports;
      }
      if (!safeLamports(fees) || fees > PROBE_FEE_POLICY.cumulative) throw new Error('Probe journal fee budget exceeded');
      return new ProbeWriteJournal(path, binding, data);
    } catch (e) { await rm(lock, { recursive: true }); throw e; }
  }
  assertUnattempted(action, role, chain) {
    if (this.closed) throw new Error('Probe journal closed');
    if (this.data.entries.some(e => e.action === action && e.role === role && e.chain === chain)) throw new Error('Own action already attempted; inspect saved signature, never rebroadcast automatically');
  }
  guard(fee, balance, role, chain) {
    const total = this.data.entries.reduce((sum, e) => sum + e.feeLamports, 0);
    // Retain even confirmed fees here. This modest experiment prefers conservative
    // double accounting over relying on an RPC bank newer than a confirmation.
    const reserved = this.data.entries.filter(e => e.role === role && e.chain === chain).reduce((sum, e) => sum + e.feeLamports, 0);
    const minimum = chain === 'L1' ? PROBE_FEE_POLICY.minimumL1Balance : PROBE_FEE_POLICY.minimumTeeBalance;
    if (!safeLamports(fee) || !safeLamports(balance) || fee > PROBE_FEE_POLICY.perTransaction || total + fee > PROBE_FEE_POLICY.cumulative || balance < minimum + reserved + fee) throw new Error('Own probe network fee/balance limit exceeded');
  }
  async reserve(entry, balance) {
    this.assertUnattempted(entry.action, entry.role, entry.chain);
    this.guard(entry.feeLamports, balance, entry.role, entry.chain);
    if (this.data.entries.length >= 11) throw new Error('Own probe action count exceeded');
    this.data.entries.push({ ...entry, state: 'prepared' }); await this.save();
  }
  async mark(signature, state) {
    if (!['confirmed', 'failed'].includes(state)) throw new Error('Invalid own journal outcome');
    const entry = this.data.entries.find(e => e.signature === signature);
    if (!entry || entry.state !== 'prepared') throw new Error('Invalid own journal transition');
    entry.state = state; await this.save();
  }
  summary() { return { ...this.binding, feePolicy: PROBE_FEE_POLICY, entries: this.data.entries.map(e => ({ ...e })), rawResponsesPersisted: false, automaticRetry: false }; }
  async save() {
    const temporary = new URL(`${this.path.href}.tmp`), directory = new URL('./', this.path);
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify(this.data) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, this.path); const parent = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW); try { await parent.sync(); } finally { await parent.close(); }
  }
  async close() { if (!this.closed) { await rm(new URL(`${this.path.href}.lock`), { recursive: true }); this.closed = true; } }
}
const pk = value => value instanceof PublicKey ? value : new PublicKey(value);
export const u64 = value => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe u64 number');
  if (!['number', 'string', 'bigint'].includes(typeof value) || typeof value === 'string' && !/^\d+$/.test(value)) throw new Error('Invalid u64');
  const n = BigInt(value);
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error('u64 out of range');
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(n); return bytes;
};
const pda = (seeds, owner = PIN.program) => PublicKey.findProgramAddressSync(seeds, pk(owner))[0];

export async function loadKeys({ create = false, directory = KEY_DIR } = {}) {
  const keys = {};
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [role, name] of Object.entries(KEY_NAMES)) {
    const path = new URL(name, directory);
    let raw;
    try { raw = await readFile(path, 'utf8'); }
    catch (e) {
      if (e.code !== 'ENOENT' || !create) throw e;
      const generated = Keypair.generate();
      await writeFile(path, JSON.stringify([...generated.secretKey]) + '\n', { mode: 0o600, flag: 'wx' });
      raw = await readFile(path, 'utf8');
    }
    if ((await stat(path)).mode & 0o077) throw new Error(`Own ${role} key must have mode 0600`);
    const bytes = JSON.parse(raw);
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error(`Malformed own ${role} key`);
    keys[role] = Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  if (new Set(Object.values(keys).map(k => k.publicKey.toBase58())).size !== 3 || Object.values(keys).some(k => k.publicKey.toBase58() === PIN.program)) throw new Error('Inspector, two players and program identity must differ');
  return keys;
}

export async function loadArtifacts() {
  const root = new URL('program/', import.meta.url);
  const [idlBytes, binary, source, lock, reportRaw] = await Promise.all([
    readFile(new URL('artifacts/per_probe.idl.json', root)), readFile(new URL('target/deploy/per_probe.so', root)),
    readFile(new URL('src/lib.rs', root)), readFile(new URL('Cargo.lock', root)), readFile(new URL('artifacts/own-probe-build.json', root), 'utf8'),
  ]);
  return validateLocalArtifacts({ idlBytes, binary, source, lock, report: JSON.parse(reportRaw) });
}

export function validateLocalArtifacts({ idlBytes, binary, source, lock, report }) {
  const idl = JSON.parse(idlBytes);
  validateProbeIdl(idl, PIN.program);
  if (/declare_id!\("([^"]+)"\)/.exec(source.toString())?.[1] !== PIN.program) throw new Error('Wrong own source program identity');
  if (report.localArtifactConsistency !== 'PASS' || report.programId !== PIN.program || sha256(binary) !== report.binarySha256 || binary.length !== report.binaryBytes || sha256(source) !== report.sourceSha256 || sha256(idlBytes) !== report.idlSha256 || sha256(lock) !== report.cargoLockSha256) throw new Error('Own probe build / source / IDL / Cargo.lock mismatch; rebuild and verify artifacts');
  if (!binary.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) throw new Error('Expected own ELF');
  return { idl, binary, report };
}

export function makePlan(inspector, players, roundId) {
  if (!Array.isArray(players) || players.length !== 2) throw new Error('Exactly two players required');
  const ids = [inspector, ...players].map(x => pk(x).toBase58());
  if (new Set(ids).size !== 3 || ids.includes(PIN.program) || ids.includes(SystemProgram.programId.toBase58())) throw new Error('Invalid participant identities');
  const round = pda([Buffer.from('probe'), pk(inspector).toBuffer(), u64(roundId)]);
  const delegated = account => ({
    buffer: pda([Buffer.from('buffer'), account.toBuffer()]).toBase58(),
    record: pda([Buffer.from('delegation'), account.toBuffer()], PIN.delegation).toBase58(),
    metadata: pda([Buffer.from('delegation-metadata'), account.toBuffer()], PIN.delegation).toBase58(),
  });
  return {
    version: 1, program: PIN.program, roundId: BigInt(roundId).toString(), inspector: ids[0], players: ids.slice(1),
    round: round.toBase58(), permission: pda([Buffer.from('permission:'), round.toBuffer()], PIN.permission).toBase58(),
    identity: pda([Buffer.from('identity')]).toBase58(), roundDelegation: delegated(round),
    receipts: players.map(player => {
      const address = pda([Buffer.from('receipt'), round.toBuffer(), pk(player).toBuffer()]);
      return { address: address.toBase58(), player: pk(player).toBase58(), ...delegated(address) };
    }),
  };
}

export function validatePlan(plan, keys) {
  const expected = makePlan(keys.inspector.publicKey, [keys.playerA.publicKey, keys.playerB.publicKey], plan.roundId);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('Stored plan differs from canonical own-wallet PDA plan');
  return expected;
}

export function probeInstruction(idl, plan, name, { playerIndex = 0, nonce = 1n } = {}) {
  if (!['initialize_round', 'initialize_receipt', 'delegate_round', 'delegate_receipt', 'prepare_private', 'request_probe_randomness', 'submit_probe', 'reveal_probe'].includes(name)) throw new Error('Instruction not allowed in own client');
  if (![0, 1].includes(playerIndex)) throw new Error('Invalid player index');
  if (JSON.stringify(plan) !== JSON.stringify(makePlan(plan.inspector, plan.players, plan.roundId))) throw new Error('Noncanonical own probe plan');
  const ix = idl.instructions.find(i => i.name === name);
  if (!ix || idl.address !== PIN.program || plan.program !== PIN.program) throw new Error('Wrong own IDL/program');
  const receipt = plan.receipts[playerIndex];
  const mapping = {
    inspector: plan.inspector, player: plan.players[playerIndex], round: plan.round, receipt: receipt.address,
    permission: plan.permission, permission_program: PIN.permission, ephemeral_vault: PIN.vault, magic_program: PIN.magic,
    oracle_queue: PIN.queue, program_identity: plan.identity, vrf_program: PIN.vrf, slot_hashes: PIN.slots,
    owner_program: PIN.program, delegation_program: PIN.delegation, system_program: SystemProgram.programId.toBase58(),
    buffer_round: plan.roundDelegation.buffer, delegation_record_round: plan.roundDelegation.record, delegation_metadata_round: plan.roundDelegation.metadata,
    buffer_receipt: receipt.buffer, delegation_record_receipt: receipt.record, delegation_metadata_receipt: receipt.metadata,
  };
  const keys = ix.accounts.map(a => {
    if (!mapping[a.name] || a.address && a.address !== mapping[a.name]) throw new Error(`Missing or wrong explicit account ${a.name}`);
    return { pubkey: pk(mapping[a.name]), isSigner: a.signer === true, isWritable: a.writable === true };
  });
  let args = Buffer.alloc(0);
  if (name === 'initialize_round') args = Buffer.concat([u64(plan.roundId), ...plan.players.map(p => pk(p).toBuffer())]);
  if (name === 'delegate_round') args = u64(plan.roundId);
  if (name === 'submit_probe') args = u64(nonce);
  return new TransactionInstruction({ programId: pk(PIN.program), keys, data: Buffer.concat([Buffer.from(ix.discriminator), args]) });
}

export function instructionSummary(idl, instruction, name) {
  const definition = idl.instructions.find(i => i.name === name);
  return { instruction: name, dataBytes: instruction.data.length, dataSha256: sha256(instruction.data), accounts: instruction.keys.map((a, i) => ({ name: definition.accounts[i].name, address: a.pubkey.toBase58(), signer: a.isSigner, writable: a.isWritable })) };
}

function accountBytes(account, idl, name, bytes) {
  if (!account || account.owner !== PIN.program || account.executable !== false) throw new Error(`Missing or wrong-owner ${name}`);
  const data = decodeData(account), discriminator = idl.accounts.find(a => a.name === name)?.discriminator;
  if (!discriminator || data.length !== bytes || !data.subarray(0, 8).equals(Buffer.from(discriminator))) throw new Error(`Invalid ${name} layout`);
  return data;
}
export function decodeRound(account, idl, plan) {
  const b = accountBytes(account, idl, 'ProbeRound', 178);
  const out = { inspector: base58(b.subarray(8, 40)), players: [base58(b.subarray(40, 72)), base58(b.subarray(72, 104))], id: b.readBigUInt64LE(104).toString(), tag: b.subarray(112, 144), randomness: b.subarray(144, 176), status: b[176], bump: b[177] };
  if (out.inspector !== plan.inspector || out.id !== plan.roundId || out.players.some((x, i) => x !== plan.players[i]) || !out.tag.equals(pk(plan.round).toBuffer()) || out.status > 4) throw new Error('Round binding/state mismatch');
  return out;
}
export function decodeReceipt(account, idl, plan, index) {
  const b = accountBytes(account, idl, 'ProbeReceipt', 89);
  const out = { round: base58(b.subarray(8, 40)), player: base58(b.subarray(40, 72)), lastNonce: b.readBigUInt64LE(72).toString(), acceptedCount: b.readBigUInt64LE(80).toString() };
  if (out.round !== plan.round || out.player !== plan.players[index]) throw new Error('Receipt binding mismatch');
  return out;
}

function initializerEntries(entries) {
  const expected = [['initialize_round', 'inspector'], ['initialize_receipt', 'playerA'], ['initialize_receipt', 'playerB']];
  if (!Array.isArray(entries) || entries.length !== 3 || entries.some((e, i) => !e || e.action !== expected[i][0] || e.role !== expected[i][1] || e.chain !== 'L1' || !['prepared', 'confirmed'].includes(e.state) || !isCanonicalTransactionSignature(e.signature) || !/^[a-f0-9]{64}$/.test(e.messageSha256))) throw new Error('Resume requires exactly the three original initializer journal entries');
  if (new Set(entries.map(e => e.signature)).size !== 3) throw new Error('Resume initializer signatures must be distinct');
  return entries;
}

export function initializedAccountAddresses(plan) {
  if (JSON.stringify(plan) !== JSON.stringify(makePlan(plan.inspector, plan.players, plan.roundId))) throw new Error('Noncanonical initialized resume plan');
  return [plan.round, ...plan.receipts.map(r => r.address), ...[plan.roundDelegation, ...plan.receipts].flatMap(d => [d.buffer, d.record, d.metadata])];
}

/** Exact checkpoint only: no pending status, extra action, delegated account or
 * changed nonce may be resumed. Raw transaction bytes remain memory-only. */
export function validateInitializedContinuation({ artifacts, plan, entries, statuses, transactions, accounts }) {
  initializerEntries(entries);
  const addresses = initializedAccountAddresses(plan);
  if (!Array.isArray(statuses) || statuses.length !== 3 || !Array.isArray(transactions) || transactions.length !== 3) throw new Error('Missing finalized initializer evidence');
  const confirmed = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i], status = statuses[i], observed = transactions[i];
    if (!status || status.confirmationStatus !== 'finalized' || !Object.hasOwn(status, 'err') || status.err !== null || !safeLamports(status.slot)) throw new Error('Initializer is not explicitly finalized successfully');
    if (!observed || observed.slot !== status.slot || !observed.meta || !Object.hasOwn(observed.meta, 'err') || observed.meta.err !== null || observed.version !== undefined && observed.version !== 'legacy' || !Array.isArray(observed.transaction) || observed.transaction.length !== 2 || observed.transaction[1] !== 'base64') throw new Error('Missing or inconsistent finalized initializer transaction');
    const encoded = observed.transaction[0];
    if (typeof encoded !== 'string' || encoded.length > 2000 || Buffer.from(encoded, 'base64').toString('base64') !== encoded) throw new Error('Malformed bounded initializer transaction bytes');
    const tx = Transaction.from(Buffer.from(encoded, 'base64'));
    if (!tx.signature || !tx.verifySignatures() || tx.signatures.length !== 1 || base58(tx.signature) !== entry.signature || sha256(tx.serializeMessage()) !== entry.messageSha256) throw new Error('Initializer transaction signature or message hash differs from journal');
    const expected = probeInstruction(artifacts.idl, plan, entry.action, { playerIndex: i === 2 ? 1 : 0 }), actual = tx.instructions[0], payer = i === 0 ? plan.inspector : plan.players[i - 1];
    if (tx.feePayer?.toBase58() !== payer || tx.instructions.length !== 1 || !actual.programId.equals(expected.programId) || !actual.data.equals(expected.data) || actual.keys.length !== expected.keys.length || actual.keys.some((a, n) => !a.pubkey.equals(expected.keys[n].pubkey) || a.isSigner !== expected.keys[n].isSigner || a.isWritable !== expected.keys[n].isWritable)) throw new Error('Initializer message differs from canonical own instruction');
    confirmed.push({ name: entry.action, role: entry.role, chain: 'L1', signature: entry.signature, slot: status.slot, messageSha256: entry.messageSha256, reconciledFromFinalized: true });
  }
  const minimumSlot = Math.max(...statuses.map(s => s.slot));
  if (!safeLamports(accounts?.context?.slot) || accounts.context.slot < minimumSlot || !Array.isArray(accounts.value) || accounts.value.length !== addresses.length) throw new Error('Missing or stale initialized account snapshot');
  const round = decodeRound(accounts.value[0], artifacts.idl, plan);
  if (round.status !== 0 || round.randomness.some(x => x !== 0)) throw new Error('Own round is no longer an untouched INITIALIZED round');
  for (let i = 0; i < 2; i++) {
    const receipt = decodeReceipt(accounts.value[1 + i], artifacts.idl, plan, i);
    if (receipt.lastNonce !== '0' || receipt.acceptedCount !== '0') throw new Error('Own receipt is no longer untouched');
  }
  if (accounts.value.slice(3).some(a => a !== null)) throw new Error('A delegation PDA already exists; initialized-only resume refused');
  return { round: plan.round, accountSnapshotSlot: accounts.context.slot, confirmed, initializationRebroadcast: false };
}

export async function reconcileInitializedContinuation({ artifacts, plan, journal, call = rpc }) {
  if (!(journal instanceof ProbeWriteJournal) || journal.binding.round !== plan.round) throw new Error('Own resume journal required');
  const entries = initializerEntries(journal.summary().entries);
  if (await call(PIN.base, 'getGenesisHash') !== PIN.genesis) throw new Error('Resume requires pinned devnet genesis');
  const statuses = (await call(PIN.base, 'getSignatureStatuses', [entries.map(e => e.signature), { searchTransactionHistory: true }]))?.value;
  if (!Array.isArray(statuses) || statuses.length !== 3 || statuses.some(s => !s || s.confirmationStatus !== 'finalized' || s.err !== null || !safeLamports(s.slot))) throw new Error('Initializer is not explicitly finalized successfully');
  const transactions = [];
  for (const entry of entries) transactions.push(await call(PIN.base, 'getTransaction', [entry.signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]));
  const accounts = await call(PIN.base, 'getMultipleAccounts', [initializedAccountAddresses(plan), { encoding: 'base64', commitment: 'finalized', minContextSlot: Math.max(...statuses.map(s => s.slot)) }]);
  const proof = validateInitializedContinuation({ artifacts, plan, entries, statuses, transactions, accounts });
  // Only the complete proof allows local journal reconciliation. This performs
  // no transaction and never automatically reconciles later experiment stages.
  for (const entry of entries) if (entry.state === 'prepared') await journal.mark(entry.signature, 'confirmed');
  return proof;
}

export function verifyDeployedBytes(account, binary, { tee = false, expectedAuthority } = {}) {
  const data = decodeData(account);
  let offset, authority;
  if (tee) {
    if (account.owner !== LOADER_V4 || account.executable !== true || data.length < 48 || data.readBigUInt64LE(40) !== 1n) throw new Error('Expected deployed TEE LoaderV4 copy');
    offset = 48;
  } else {
    if (account.owner !== LOADER || account.executable !== false || data.length < 45 || data.readUInt32LE(0) !== 3 || data[12] !== 1) throw new Error('Expected own upgradeable ProgramData with authority');
    offset = 45; authority = base58(data.subarray(13, 45));
    if (!expectedAuthority || authority !== expectedAuthority) throw new Error('Unexpected own upgrade authority');
  }
  const deployed = data.subarray(offset);
  if (deployed.length < binary.length || !deployed.subarray(0, binary.length).equals(binary) || deployed.subarray(binary.length).some(b => b !== 0)) throw new Error('Deployed ELF differs from approved local binary/padding');
  return { elfSha256: sha256(binary), elfBytes: binary.length, allocationPaddingBytes: deployed.length - binary.length, ...(authority ? { upgradeAuthority: authority } : {}) };
}

export async function inspectDeployment(artifacts, inspector, { teeUrl = null, call = rpc } = {}) {
  if (await call(PIN.base, 'getGenesisHash') !== PIN.genesis) throw new Error('Not pinned Solana devnet genesis');
  const own = (await call(PIN.base, 'getAccountInfo', [PIN.program, { encoding: 'base64', commitment: 'confirmed' }])).value;
  if (!own) throw new Error('Own probe is not deployed');
  const data = decodeData(own);
  if (own.owner !== LOADER || own.executable !== true || data.length !== 36 || data.readUInt32LE(0) !== 2) throw new Error('Wrong own executable loader/layout');
  const address = base58(data.subarray(4));
  if (address !== pda([pk(PIN.program).toBuffer()], LOADER).toBase58()) throw new Error('Noncanonical own ProgramData');
  const programData = (await call(PIN.base, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }])).value;
  const verified = verifyDeployedBytes(programData, artifacts.binary, { expectedAuthority: inspector });
  if (teeUrl) {
    const parsed = new URL(teeUrl);
    if (parsed.origin + parsed.pathname.replace(/\/$/, '') !== PIN.tee) throw new Error('Not pinned TEE endpoint');
    if ((await call(teeUrl, 'getIdentity')).identity !== PIN.validator) throw new Error('Not pinned TEE validator identity');
    const copied = (await call(teeUrl, 'getAccountInfo', [PIN.program, { encoding: 'base64', commitment: 'confirmed' }])).value;
    verified.teeCopy = verifyDeployedBytes(copied, artifacts.binary, { tee: true });
  }
  return { genesis: PIN.genesis, program: PIN.program, programData: address, ...verified };
}

export function requireWriteOptIn(options) {
  if (options.experimentalDevnet !== true || options.allowWrites !== true) throw new Error('Remote writes require --experimental-devnet AND --allow-writes; production approval remains false');
}

/** Parses UNVERIFIED JWT timestamps solely to shorten local request scheduling.
 * It never verifies identity, signatures, membership or attestation. The pinned
 * QFS server must still authorize every actual RPC request using the token. */
export function authExpiry(auth, expectedPubkey, now = Date.now()) {
  if (!safeLamports(now) || !auth || typeof auth !== 'object' || Array.isArray(auth) || typeof auth.token !== 'string' || auth.token.length > 8192) throw new Error('Invalid auth expiry response');
  const segments = auth.token.split('.');
  if (segments.length !== 3 || segments.some((part, i) => !/^[A-Za-z0-9_-]+$/.test(part) || part.length > [1024, 4096, 2048][i] || Buffer.from(part, 'base64url').toString('base64url') !== part)) throw new Error('Invalid bounded canonical JWT encoding');
  let header, claims;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    header = JSON.parse(decoder.decode(Buffer.from(segments[0], 'base64url')));
    claims = JSON.parse(decoder.decode(Buffer.from(segments[1], 'base64url')));
  } catch { throw new Error('Invalid JWT scheduling JSON'); }
  if (!header || typeof header !== 'object' || Array.isArray(header) || typeof header.alg !== 'string' || header.alg.toLowerCase() === 'none' || !claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('Invalid JWT scheduling shape');
  if (claims.pubkey !== expectedPubkey || !safeLamports(claims.exp) || !safeLamports(claims.iat) || !safeLamports(claims.exp * 1000) || !safeLamports(claims.iat * 1000) || claims.exp <= claims.iat || claims.exp * 1000 <= now || claims.iat * 1000 > now + 30_000) throw new Error('Invalid own JWT scheduling claims');
  const explicit = Object.hasOwn(auth, 'expiresAt');
  if (explicit && (!safeLamports(auth.expiresAt) || auth.expiresAt <= now)) throw new Error('Invalid explicit auth expiry milliseconds');
  const expiresAt = Math.min(claims.exp * 1000, explicit ? auth.expiresAt : Infinity, now + 30 * 60_000);
  if (!safeLamports(expiresAt) || expiresAt <= now) throw new Error('Invalid local auth deadline');
  return { expiresAt, expirySource: explicit ? 'EXPLICIT_AND_UNVERIFIED_JWT_MINIMUM' : 'UNVERIFIED_JWT_LOCAL_DEADLINE', jwtSignatureVerified: false, authorizationGrantedLocally: false };
}

export async function authenticate(key, { fetchImpl = fetch, now = () => Date.now(), pace = paceProbeRequest } = {}) {
  const pubkey = key.publicKey.toBase58();
  const response = await pace(PIN.tee, () => fetchImpl(`${PIN.tee}/auth/challenge?pubkey=${pubkey}`, { signal: AbortSignal.timeout(20000) }));
  if (response.status !== 200) throw new Error(`Auth challenge HTTP ${response.status}`);
  const { challenge } = await response.json();
  if (typeof challenge !== 'string') throw new Error('Missing auth challenge');
  validateAuthChallenge(Buffer.from(challenge), pubkey, now());
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(key.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
  const signature = base58(sign(null, Buffer.from(challenge), privateKey));
  const login = await pace(PIN.tee, () => fetchImpl(`${PIN.tee}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey, challenge, signature }), signal: AbortSignal.timeout(20000) }));
  if (login.status !== 200) throw new Error(`Auth login HTTP ${login.status}`);
  const auth = await login.json();
  const expiry = authExpiry(auth, pubkey, now());
  const url = new URL(PIN.tee); url.searchParams.set('token', auth.token);
  return { url: url.toString(), ...expiry };
}

export function signedTransaction(instruction, signer, blockhash) {
  const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(instruction);
  tx.sign(signer); return tx.serialize().toString('base64');
}
export function simulationParams(serialized, plan, index) {
  return [serialized, { encoding: 'base64', sigVerify: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [plan.round, plan.receipts[index].address] } }];
}

export function simulationInstruction(idl, plan, index, nonce, variant) {
  if (!['readonly', 'writable-promoted'].includes(variant)) throw new Error('Unknown simulation variant');
  const instruction = probeInstruction(idl, plan, 'submit_probe', { playerIndex: index, nonce });
  if (variant === 'writable-promoted') {
    const round = instruction.keys.find(a => a.pubkey.toBase58() === plan.round);
    if (!round || round.isWritable || round.isSigner) throw new Error('Unexpected private-round baseline metas');
    round.isWritable = true;
  }
  return instruction;
}

export async function sendOwnInstruction({ artifacts, plan, name, key, playerIndex = 0, nonce = 1n, url, options, journal, call = rpc, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  requireWriteOptIn(options);
  if (![PIN.base, PIN.tee].includes(new URL(url).origin + new URL(url).pathname.replace(/\/$/, ''))) throw new Error('Unapproved endpoint');
  const tee = new URL(url).origin === PIN.tee;
  const baseOnly = ['initialize_round', 'initialize_receipt', 'delegate_round', 'delegate_receipt'];
  if (tee === baseOnly.includes(name)) throw new Error('Instruction routed to the wrong chain');
  await inspectDeployment(artifacts, plan.inspector, { teeUrl: tee ? url : null, call });
  if (!(journal instanceof ProbeWriteJournal) || journal.binding.round !== plan.round) throw new Error('Own write-ahead journal required');
  const signer = key.publicKey.toBase58(), role = signer === plan.inspector ? 'inspector' : signer === plan.players[0] ? 'playerA' : signer === plan.players[1] ? 'playerB' : null, chain = tee ? 'TEE' : 'L1';
  if (!role) throw new Error('Own participant signer required');
  journal.assertUnattempted(name, role, chain);
  const recent = (await call(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  if (!recent || !safeLamports(recent.lastValidBlockHeight)) throw new Error('Missing own blockhash expiry height');
  const bytes = signedTransaction(probeInstruction(artifacts.idl, plan, name, { playerIndex, nonce }), key, recent.blockhash);
  const signed = Transaction.from(Buffer.from(bytes, 'base64')), message = signed.serializeMessage();
  if (!signed.signature || !signed.verifySignatures()) throw new Error('Invalid own locally signed transaction');
  const signature = base58(signed.signature);
  const fee = (await call(url, 'getFeeForMessage', [message.toString('base64'), { commitment: 'confirmed' }]))?.value;
  const balance = (await call(url, 'getBalance', [signer, { commitment: 'confirmed' }]))?.value;
  journal.guard(fee, balance, role, chain);
  await journal.reserve({ action: name, role, chain, signature, messageSha256: sha256(message), lastValidBlockHeight: recent.lastValidBlockHeight, feeLamports: fee }, balance);
  // Up to3 node relay retries reuse these exact signed bytes. The application
  // makes one send call and never re-signs or rebroadcasts this action itself.
  const returned = await call(url, 'sendTransaction', [bytes, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
  if (returned !== signature) throw new Error('Own transaction returned signature differs from local signature; outcome unknown');
  // Submission is never repeated automatically after an ambiguous network result.
  for (let attempt = 0; attempt < 25; attempt++) {
    const status = (await call(url, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value?.[0];
    if (status) {
      if (!Object.hasOwn(status, 'err') || status.err === undefined || !safeLamports(status.slot)) throw new Error('Malformed own transaction confirmation; outcome unknown');
      if (status.err !== null) {
        const err = status.err;
        if (!(typeof err === 'string' && err.length > 0 || err && typeof err === 'object' && !Array.isArray(err) && Object.keys(err).length > 0)) throw new Error('Malformed own transaction error; outcome unknown');
        await journal.mark(signature, 'failed'); throw new Error('Own transaction execution failed; inspect saved signature');
      }
      if (['confirmed', 'finalized'].includes(status.confirmationStatus)) { await journal.mark(signature, 'confirmed'); return signature; }
    }
    const height = await call(url, 'getBlockHeight', [{ commitment: 'confirmed' }]);
    if (!safeLamports(height)) throw new Error('Malformed own confirmation height; outcome unknown');
    if (height > recent.lastValidBlockHeight) throw new Error('Own transaction blockhash expired; inspect saved signature, no automatic retry');
    await wait(1000);
  }
  throw new Error(`Confirmation unresolved for own ${name}, signature ${signature}; do not rerun initialization blindly`);
}

export async function capture(url, method, params, { pace = paceProbeRequest, fetchImpl = fetch } = {}) {
  try {
    return await pace(url, async () => {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const text = await response.text();
      let body; try { body = JSON.parse(text); } catch { body = null; }
      return { httpStatus: response.status, body, text };
    });
  } catch (e) { return { httpStatus: null, body: null, text: '', transportError: redact(e.message) }; }
}

export function observationSummary(observation) {
  const { httpStatus, body, text } = observation;
  const validEnvelope = body?.jsonrpc === '2.0' && body.id === 1;
  let outcome = 'BLOCKED';
  if ([401, 403].includes(httpStatus)) outcome = 'AUTH_REJECTED';
  else if (httpStatus === 200 && validEnvelope && body.error) outcome = 'RPC_ERROR';
  else if (httpStatus === 200 && validEnvelope && Object.hasOwn(body, 'result')) outcome = body.result === null || body.result?.value === null ? 'ABSENT_OR_FILTERED' : 'RESULT';
  const rpcCode = body?.error?.code;
  return { httpStatus, outcome, responseBytes: Buffer.byteLength(text), responseSha256: sha256(text), ...(Number.isSafeInteger(rpcCode) ? { rpcCode } : {}) };
}

export function classifyIsolation(inspectorAccount, otherObservation, idl, plan) {
  const state = decodeRound(inspectorAccount, idl, plan); // a null inspector result cannot establish anything
  if (![1, 2, 3].includes(state.status)) return 'BLOCKED';
  const summary = observationSummary(otherObservation);
  if (otherObservation.body?.result?.value?.data) return 'FAIL';
  return summary.outcome === 'AUTH_REJECTED' ? 'PASS' : 'BLOCKED';
}

function decode58(text) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const char of text) { const digit = alphabet.indexOf(char); if (digit < 0) return null; n = n * 58n + BigInt(digit); }
  let b = n ? Buffer.from(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0'), 'hex') : Buffer.alloc(0);
  let zeros = 0; while (text[zeros] === '1') zeros++;
  return Buffer.concat([Buffer.alloc(zeros), b]);
}
export function isCanonicalTransactionSignature(value) {
  if (typeof value !== 'string' || value.length < 64 || value.length > 88 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  const bytes = decode58(value);
  return bytes?.length === 64 && base58(bytes) === value;
}
export function containsSecret(value, secret) {
  if (!Buffer.isBuffer(secret) || secret.length !== 32) throw new Error('Expected revealed 32-byte randomness');
  if (typeof value === 'string') {
    if ([secret.toString('hex'), secret.toString('base64'), base58(secret)].some(pattern => value.includes(pattern))) return true;
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0 && Buffer.from(value, 'base64').includes(secret)) return true;
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(value) && value.length < 100000 && decode58(value)?.includes(secret)) return true;
    return false;
  }
  if (Array.isArray(value) && value.length >= 32 && value.every(x => Number.isInteger(x) && x >= 0 && x <= 255) && Buffer.from(value).includes(secret)) return true;
  if (value && typeof value === 'object') return Object.values(value).some(child => containsSecret(child, secret));
  return false;
}
