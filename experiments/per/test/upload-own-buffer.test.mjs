import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey, Transaction } from '@solana/web3.js';
import { UPLOAD, validateBinary, validateBuffer, missingChunks, writeInstruction, validateWriteFee, finalizedStatus, createPacedRpc, appendWal, withUploadLock, broadcastOnce, readPrivateFile, validatePrivateDirectory, validateWalEntries, validateRunPlan, validateExpiryObservation, expirePending } from '../upload-own-buffer.mjs';
import { base58 } from '../lib.mjs';

function account() {
  const bytes = Buffer.alloc(UPLOAD.binaryBytes + 37); bytes.writeUInt32LE(1); bytes[4] = 1;
  new PublicKey(UPLOAD.payer).toBuffer().copy(bytes, 5);
  return { owner: UPLOAD.loader, executable: false, lamports: 1486189560, data: [bytes.toString('base64'), 'base64'] };
}

test('synthetic ELF never passes pinned real binary gate; no actual artifact read', () => {
  assert.throws(() => validateBinary(Buffer.alloc(UPLOAD.binaryBytes)), /WRONG_LOCAL_ELF/);
});

test('buffer requires canonical loader state, authority, size, encoding and funded rent', () => {
  assert.equal(validateBuffer(account(), 1486148920).length, UPLOAD.binaryBytes);
  for (const patch of [{ owner: UPLOAD.payer }, { executable: true }, { lamports: 0 }, { data: ['AA==', 'base64'] }, { data: ['?', 'base64'] }]) {
    assert.throws(() => validateBuffer({ ...account(), ...patch }, 1486148920));
  }
  for (const offset of [0, 4, 5]) {
    const a = account(), bytes = Buffer.from(a.data[0], 'base64'); bytes[offset] ^= 1; a.data[0] = bytes.toString('base64');
    assert.throws(() => validateBuffer(a, 1486148920), /WRONG_BUFFER_AUTHORITY/);
  }
});

test('only differing 960-byte slices are planned, including exact final slice', () => {
  const binary = Buffer.alloc(UPLOAD.binaryBytes, 1), current = Buffer.from(binary);
  current[960] = 0; current[current.length - 1] = 0;
  const chunks = missingChunks(binary, current);
  assert.deepEqual(chunks.map(c => [c.offset, c.bytes.length]), [[960, 960], [291840, 544]]);
  assert.equal(missingChunks(binary, binary).length, 0);
  assert.equal(missingChunks(binary, Buffer.alloc(binary.length)).length, 305);
});

test('write ABI and account privileges match official loader, no extra instructions', () => {
  const ix = writeInstruction(960, Buffer.alloc(960, 7));
  assert.equal(ix.programId.toBase58(), UPLOAD.loader);
  assert.deepEqual(ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[UPLOAD.buffer, false, true], [UPLOAD.payer, true, false]]);
  assert.equal(ix.data.readUInt32LE(0), 1); assert.equal(ix.data.readUInt32LE(4), 960); assert.equal(ix.data.readBigUInt64LE(8), 960n);
  assert.deepEqual(ix.data.subarray(16), Buffer.alloc(960, 7));
  const tx = new Transaction({ feePayer: new PublicKey(UPLOAD.payer), recentBlockhash: '11111111111111111111111111111111' }).add(ix);
  const message = tx.compileMessage();
  assert.equal(message.header.numRequiredSignatures, 1); assert.equal(message.instructions.length, 1);
  assert.ok(1 + 64 + message.serialize().length <= 1232);
  for (const [offset, length] of [[1, 960], [0, 959], [UPLOAD.binaryBytes, 960], [291840, 960]]) assert.throws(() => writeInstruction(offset, Buffer.alloc(length)));
});

test('strict fee and aggregate cap reject malformed or oversized quotes', () => {
  validateWriteFee(5000, 1595000);
  for (const [fee, spent] of [[5000, 1600000], [5001, 0], [null, 0], [0, 0], [false, 0], [5000, -1]]) assert.throws(() => validateWriteFee(fee, spent));
});

test('only explicit null error at finalized status succeeds', () => {
  assert.equal(finalizedStatus({ confirmationStatus: 'finalized', err: null, slot: 1 }), true);
  for (const status of [null, { confirmationStatus: 'confirmed', err: null, slot: 1 }]) assert.equal(finalizedStatus(status), false);
  for (const err of [undefined, false, 0, { InstructionError: [0, 'InvalidAccountData'] }]) assert.throws(() => finalizedStatus({ confirmationStatus: 'finalized', err, slot: 1 }));
  assert.throws(() => finalizedStatus({ confirmationStatus: 'finalized', err: null }));
});

test('RPC pacing is sequential >=550ms; 429 stops without retry', async () => {
  let clock = 0, calls = 0; const times = [];
  const rpc = createPacedRpc(async url => { assert.equal(url, UPLOAD.rpc); calls++; times.push(clock); return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: null }) }; }, async ms => { clock += ms; }, () => clock);
  await rpc('getGenesisHash'); await rpc('getBalance'); await rpc('getAccountInfo');
  assert.deepEqual(times, [0, 550, 1100]); assert.equal(calls, 3);
  let failedCalls = 0;
  const limited = createPacedRpc(async () => { failedCalls++; return { ok: false, status: 429 }; }, async () => {}, () => 0);
  await assert.rejects(limited('sendTransaction'), /RPC_RATE_LIMIT_STOP/); assert.equal(failedCalls, 1);
});

test('RPC envelope requires exact version/id and forbids every error property', async () => {
  for (const body of [{ result: null }, { jsonrpc: '2.0', id: 2, result: null }, { jsonrpc: '2.0', id: 1 }, ...[null, false, 0, {}].map(error => ({ jsonrpc: '2.0', id: 1, result: null, error }))]) {
    const rpc = createPacedRpc(async () => ({ ok: true, json: async () => body }), async () => {}, () => 0);
    await assert.rejects(rpc('getBalance'), /RPC_RESPONSE_STOP/);
  }
});

test('WAL fsync append completes before broadcast; unknown result gets one send only', async () => {
  const sequence = [], entry = { signature: 'test-signature' };
  await assert.rejects(broadcastOnce({ entry, wire: Buffer.from('synthetic'), append: async e => { assert.equal(e, entry); sequence.push('durable'); }, rpc: async method => { sequence.push(method); throw new Error('unknown network outcome'); } }), /unknown network outcome/);
  assert.deepEqual(sequence, ['durable', 'sendTransaction']);
  await assert.rejects(broadcastOnce({ entry, wire: Buffer.from('synthetic'), append: async () => { throw new Error('disk'); }, rpc: async () => assert.fail('must not send without WAL') }), /disk/);
});

test('expected local signature binding and preflight/maxRetries cannot be bypassed', async () => {
  let calls = 0;
  const rpc = async (method, params) => { calls++; assert.equal(method, 'sendTransaction'); assert.deepEqual(params[1], { encoding: 'base64', skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 3 }); return 'wrong-signature'; };
  await assert.rejects(broadcastOnce({ rpc, append: async () => {}, entry: { signature: 'expected' }, wire: Buffer.from('synthetic') }), /SEND_SIGNATURE_MISMATCH_STOP/);
  assert.equal(calls, 1);
});

function preparedEntry(index = 0, offset = 0) {
  const bytes = Buffer.alloc(64); bytes.writeUInt32LE(index + 1, 60);
  return { type: 'prepared', buffer: UPLOAD.buffer, binarySha256: UPLOAD.binarySha256, genesis: UPLOAD.genesis, signature: base58(bytes), offset, length: 960, lastValidBlockHeight: 100, fee: 5000, messageSha256: 'a'.repeat(64) };
}
function expiredEntry(prepared) {
  return { type: 'expired', buffer: UPLOAD.buffer, binarySha256: UPLOAD.binarySha256, genesis: UPLOAD.genesis, signature: prepared.signature, slot: 500, finalizedBlockHeight: 133, statusObservedNull: true, safetyBlocks: 32, bufferPayloadSha256: 'b'.repeat(64) };
}

test('manual expiry requires strictly past finalized safety window and explicit singleton null status', () => {
  const prepared = preparedEntry(), observed = { context: { slot: 500 }, value: [null] };
  validateExpiryObservation(prepared, 133, observed);
  for (const height of [0, 100, 132, null, false, 133.5]) assert.throws(() => validateExpiryObservation(prepared, height, observed), /EXPIRY_NOT_FINALIZED/);
  for (const statuses of [{ value: [null] }, { context: { slot: 500 }, value: [] }, { context: { slot: 500 }, value: [undefined] }, { context: { slot: 500 }, value: [false] }, { context: { slot: 500 }, value: [{ confirmationStatus: 'finalized', err: null, slot: 500 }] }]) assert.throws(() => validateExpiryObservation(prepared, 133, statuses), /EXPIRY_REQUIRES_EXPLICIT_NULL_STATUS/);
});

test('manual expiry only appends evidence after buffer checks, never sends or signs', async () => {
  const prepared = preparedEntry(), calls = [], appended = [];
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === 'getBlockHeight') { assert.deepEqual(params, [{ commitment: 'finalized' }]); return 133; }
    if (method === 'getSignatureStatuses') { assert.deepEqual(params[0], [prepared.signature]); return { context: { slot: 500 }, value: [null] }; }
    if (method === 'getMinimumBalanceForRentExemption') return 1486148920;
    if (method === 'getAccountInfo') { assert.equal(params[0], UPLOAD.buffer); return { context: { slot: 501 }, value: account() }; }
    assert.fail('unexpected mutation RPC');
  };
  const evidence = await expirePending({ rpc, append: async entry => appended.push(entry), entries: [prepared], signature: prepared.signature });
  assert.equal(evidence.type, 'expired'); assert.equal(evidence.finalizedBlockHeight, 133); assert.equal(evidence.slot, 501);
  assert.deepEqual(appended, [evidence]); assert.equal(calls.includes('sendTransaction'), false);
  validateWalEntries([prepared, evidence]);
  const wrongBufferRpc = async (method, params) => method === 'getAccountInfo' ? { context: { slot: 501 }, value: { ...account(), owner: UPLOAD.payer } } : rpc(method, params);
  await assert.rejects(expirePending({ rpc: wrongBufferRpc, append: async () => assert.fail('bad buffer cannot append'), entries: [prepared], signature: prepared.signature }), /WRONG_BUFFER_OWNER/);
});

test('one exact pending signature is mandatory; expired terminal permits later same-offset preparation only once', async () => {
  const first = preparedEntry(), second = preparedEntry(1, 960), expired = expiredEntry(first);
  for (const [entries, signature] of [[[first], second.signature], [[first, second], first.signature], [[first, expired], first.signature]]) {
    await assert.rejects(expirePending({ rpc: async () => assert.fail('must refuse before RPC'), append: async () => assert.fail('must not append'), entries, signature }), /EXPIRY_REQUIRES_EXACT_SOLE_PENDING_SIGNATURE/);
  }
  assert.throws(() => validateRunPlan([first], [{ offset: 960 }]), /PRIOR_UNKNOWN_WRITE/);
  assert.equal(validateRunPlan([first, expired], [{ offset: 0 }]), 5000);
  const retry = preparedEntry(2);
  validateWalEntries([first, expired, retry]);
  assert.throws(() => validateWalEntries([first, expired, expired]), /INVALID_WAL_COMPLETION/);
  assert.throws(() => validateWalEntries([first, expired, retry, preparedEntry(3)]), /INVALID_WAL_PREPARATION/);
  assert.throws(() => validateRunPlan([first, expired, retry], [{ offset: 960 }]), /PRIOR_UNKNOWN_WRITE/);
});

test('expired attempts never release the lifetime fee cap', () => {
  const entries = [];
  for (let i = 0; i < 320; i++) { const prepared = preparedEntry(i); entries.push(prepared, expiredEntry(prepared)); }
  validateWalEntries(entries);
  assert.equal(validateRunPlan(entries, []), 1600000);
  assert.throws(() => validateRunPlan(entries, [{ offset: 0 }]), /UPLOAD_FEE_CAP/);
});

test('WAL is mode0600 and contains only supplied public journal fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sollish-upload-wal-'));
  try {
    const path = join(dir, 'wal.jsonl'), entry = { type: 'prepared', signature: 'public', messageSha256: 'a'.repeat(64), offset: 0, lastValidBlockHeight: 5 };
    await appendWal(path, entry);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse((await readFile(path, 'utf8')).trim()), entry);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('exclusive process lock prevents concurrent fee reservations and clears on handled failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sollish-upload-lock-'));
  try {
    const path = join(dir, 'lock');
    await assert.rejects(withUploadLock(path, async () => {
      await assert.rejects(withUploadLock(path, async () => assert.fail('concurrent writer')), /UPLOAD_LOCK_EXISTS_MANUAL_REVIEW/);
      throw new Error('handled failure');
    }), /handled failure/);
    await withUploadLock(path, async () => {});
    await assert.rejects(stat(path), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('private reads/WAL refuse symlinks, public modes and nonregular files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sollish-upload-files-'));
  try {
    const target = join(dir, 'target'), link = join(dir, 'link');
    await writeFile(target, 'unchanged', { mode: 0o600 }); await symlink(target, link);
    await assert.rejects(readPrivateFile(link)); await assert.rejects(appendWal(link, { bad: true }));
    assert.equal(await readFile(target, 'utf8'), 'unchanged');
    await chmod(target, 0o644); await assert.rejects(readPrivateFile(target), /INSECURE_PRIVATE_FILE/);
    await assert.rejects(appendWal(target, { bad: true }), /INSECURE_PRIVATE_FILE/);
    await mkdir(join(dir, 'directory'), { mode: 0o700 }); await assert.rejects(readPrivateFile(join(dir, 'directory')), /INSECURE_PRIVATE_FILE/);
    await chmod(dir, 0o755); await assert.rejects(validatePrivateDirectory(dir), /INSECURE_PRIVATE_DIRECTORY/);
    await chmod(dir, 0o700);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('WAL enforces canonical64-byte signatures, unique offsets and bound completions', () => {
  const prepared = { type: 'prepared', buffer: UPLOAD.buffer, binarySha256: UPLOAD.binarySha256, genesis: UPLOAD.genesis, signature: '1'.repeat(64), offset: 0, length: 960, lastValidBlockHeight: 10, fee: 5000, messageSha256: 'a'.repeat(64) };
  const complete = { type: 'finalized', buffer: UPLOAD.buffer, binarySha256: UPLOAD.binarySha256, genesis: UPLOAD.genesis, signature: prepared.signature, slot: 1 };
  validateWalEntries([prepared, complete]);
  assert.throws(() => validateWalEntries([{ ...prepared, signature: '1'.repeat(63) }]), /INVALID_WAL_SIGNATURE/);
  assert.throws(() => validateWalEntries([prepared, { ...prepared, signature: base58(Buffer.alloc(64, 2)) }]), /INVALID_WAL_PREPARATION/);
  assert.throws(() => validateWalEntries([prepared, complete, complete]), /INVALID_WAL_COMPLETION/);
  assert.throws(() => validateWalEntries([complete]), /INVALID_WAL_COMPLETION/);
});
