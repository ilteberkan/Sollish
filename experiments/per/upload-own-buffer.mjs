// One-purpose recovery tool for our already-created devnet buffer. Never creates
// accounts, deploys programs, transfers funds, or changes authority. No automatic
// application rebroadcast/re-sign; explicit --expire can unlock a later --run.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { base58 } from './lib.mjs';
import { isCanonicalTransactionSignature } from './probe-client.mjs';

export const UPLOAD = Object.freeze({
  rpc: 'https://api.devnet.solana.com', genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  program: 'AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va',
  buffer: '3CdYfKFw4HXLmRnu48SLNm6AVEQmxvvyZXePnyjtkBb2',
  payer: '2By6MdhFoXhCxdhQMPt15PLPJo8Q3Ge3pw1QAJ2J4waA',
  loader: 'BPFLoaderUpgradeab1e11111111111111111111111',
  binaryBytes: 292384, binarySha256: '197a965662b28971bca434633abfaaf2d5d826bdc3ce2f54a1d746554cd99aae',
  chunkBytes: 960, feeCap: 1600000, writeFeeCap: 5000, batchSize: 10,
});
const privateRoot = new URL('../../.tooling/per/', import.meta.url);
const walPath = new URL('upload-buffer-wal.jsonl', privateRoot);
const hash = b => createHash('sha256').update(b).digest('hex');
const requireThat = (test, code) => { if (!test) throw new Error(code); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const publicKey = s => new PublicKey(s);

export function validateBinary(binary) {
  requireThat(binary.length === UPLOAD.binaryBytes && hash(binary) === UPLOAD.binarySha256, 'WRONG_LOCAL_ELF');
}

export function validateBuffer(account, rentMinimum) {
  requireThat(integer(rentMinimum) && rentMinimum > 0, 'INVALID_RENT');
  requireThat(account && account.owner === UPLOAD.loader && account.executable === false, 'WRONG_BUFFER_OWNER');
  requireThat(integer(account.lamports) && account.lamports >= rentMinimum, 'BUFFER_UNDERFUNDED');
  requireThat(Array.isArray(account.data) && account.data[1] === 'base64' && typeof account.data[0] === 'string', 'WRONG_BUFFER_ENCODING');
  const bytes = Buffer.from(account.data[0], 'base64');
  requireThat(bytes.toString('base64') === account.data[0] && bytes.length === UPLOAD.binaryBytes + 37, 'WRONG_BUFFER_SIZE');
  requireThat(bytes.readUInt32LE(0) === 1 && bytes[4] === 1 && bytes.subarray(5, 37).equals(publicKey(UPLOAD.payer).toBuffer()), 'WRONG_BUFFER_AUTHORITY');
  return bytes.subarray(37);
}

export function missingChunks(binary, current) {
  requireThat(binary.length === UPLOAD.binaryBytes && current.length === binary.length, 'WRONG_PAYLOAD_SIZE');
  const chunks = [];
  for (let offset = 0; offset < binary.length; offset += UPLOAD.chunkBytes) {
    const bytes = binary.subarray(offset, offset + UPLOAD.chunkBytes);
    if (!bytes.equals(current.subarray(offset, offset + bytes.length))) chunks.push({ offset, bytes });
  }
  return chunks;
}

export function writeInstruction(offset, bytes) {
  requireThat(integer(offset) && offset % UPLOAD.chunkBytes === 0 && offset < UPLOAD.binaryBytes, 'INVALID_WRITE_OFFSET');
  requireThat(Buffer.isBuffer(bytes) && bytes.length === Math.min(UPLOAD.chunkBytes, UPLOAD.binaryBytes - offset), 'INVALID_WRITE_LENGTH');
  // Official solana-loader-v3-interface bincode ABI: Write enum u32, offset u32,
  // Vec length u64, bytes. Offset excludes the 37-byte loader account header.
  const data = Buffer.alloc(16 + bytes.length);
  data.writeUInt32LE(1, 0); data.writeUInt32LE(offset, 4); data.writeBigUInt64LE(BigInt(bytes.length), 8); bytes.copy(data, 16);
  return new TransactionInstruction({ programId: publicKey(UPLOAD.loader), keys: [
    { pubkey: publicKey(UPLOAD.buffer), isWritable: true, isSigner: false },
    { pubkey: publicKey(UPLOAD.payer), isWritable: false, isSigner: true },
  ], data });
}

export function validateWriteFee(quote, alreadyReserved) {
  requireThat(integer(quote) && quote > 0 && quote <= UPLOAD.writeFeeCap, 'UNEXPECTED_WRITE_FEE');
  requireThat(integer(alreadyReserved) && alreadyReserved + quote <= UPLOAD.feeCap, 'UPLOAD_FEE_CAP');
}

export function finalizedStatus(status) {
  if (!status || status.confirmationStatus !== 'finalized') return false;
  requireThat(Object.hasOwn(status, 'err') && status.err === null && integer(status.slot), 'FINALIZED_WRITE_FAILED_OR_MALFORMED');
  return true;
}

export function createPacedRpc(fetchImpl = fetch, wait = sleep, now = Date.now) {
  let previous = -Infinity;
  return async (method, params = []) => {
    await wait(Math.max(0, 550 - (now() - previous)));
    previous = now();
    const response = await fetchImpl(UPLOAD.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
    requireThat(response.ok, response.status === 429 ? 'RPC_RATE_LIMIT_STOP' : 'RPC_HTTP_STOP');
    const body = await response.json();
    requireThat(body && body.jsonrpc === '2.0' && body.id === 1 && !Object.hasOwn(body, 'error') && Object.hasOwn(body, 'result'), 'RPC_RESPONSE_STOP');
    return body.result;
  };
}

const parentDirectory = path => dirname(path instanceof URL ? fileURLToPath(path) : path);
const ownedByCurrentUser = info => typeof process.getuid === 'function' && info.uid === process.getuid();
export async function validatePrivateDirectory(path) {
  const info = await lstat(path);
  requireThat(info.isDirectory() && ownedByCurrentUser(info) && (info.mode & 0o077) === 0, 'INSECURE_PRIVATE_DIRECTORY');
}
function validatePrivateFile(info, maximum = 1048576) {
  requireThat(info.isFile() && ownedByCurrentUser(info) && (info.mode & 0o077) === 0 && info.size <= maximum, 'INSECURE_PRIVATE_FILE');
}
async function syncParent(path) {
  const directory = await open(parentDirectory(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}
export async function readPrivateFile(path, maximum = 1048576) {
  await validatePrivateDirectory(parentDirectory(path));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { validatePrivateFile(await file.stat(), maximum); return await file.readFile('utf8'); }
  finally { await file.close(); }
}

export async function appendWal(path, entry) {
  await validatePrivateDirectory(parentDirectory(path));
  let file, created = false;
  try { file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW); }
  try {
    validatePrivateFile(await file.stat());
    await file.writeFile(`${JSON.stringify(entry)}\n`); await file.sync();
    if (created) await syncParent(path);
  } finally { await file.close(); }
}

export async function withUploadLock(path, action) {
  await validatePrivateDirectory(parentDirectory(path));
  let file;
  try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('UPLOAD_LOCK_EXISTS_MANUAL_REVIEW'); throw error; }
  try { validatePrivateFile(await file.stat()); await file.writeFile(`${process.pid}\n`); await file.sync(); await syncParent(path); return await action(); }
  finally { await file.close(); await unlink(path); }
}

async function loadWal() {
  let raw;
  try { raw = await readPrivateFile(walPath); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  requireThat(Buffer.byteLength(raw) < 1048576, 'WAL_TOO_LARGE');
  const entries = raw.trim() ? raw.trim().split('\n').map(line => JSON.parse(line)) : [];
  validateWalEntries(entries);
  return entries;
}

export function validateWalEntries(entries) {
  const prepared = new Map(), offsets = new Map(), completed = new Map();
  for (const e of entries) {
    requireThat(e.buffer === UPLOAD.buffer && e.binarySha256 === UPLOAD.binarySha256 && e.genesis === UPLOAD.genesis, 'WAL_IDENTITY_MISMATCH');
    requireThat(isCanonicalTransactionSignature(e.signature), 'INVALID_WAL_SIGNATURE');
    if (e.type === 'prepared') {
      const previous = offsets.get(e.offset);
      requireThat(!prepared.has(e.signature) && (!previous || completed.get(previous) === 'expired') && integer(e.offset) && e.offset % UPLOAD.chunkBytes === 0 && e.offset < UPLOAD.binaryBytes && e.length === Math.min(UPLOAD.chunkBytes, UPLOAD.binaryBytes - e.offset) && integer(e.lastValidBlockHeight) && e.fee === 5000 && /^[0-9a-f]{64}$/.test(e.messageSha256), 'INVALID_WAL_PREPARATION');
      prepared.set(e.signature, e); offsets.set(e.offset, e.signature);
    } else {
      requireThat(['finalized', 'expired'].includes(e.type) && prepared.has(e.signature) && !completed.has(e.signature) && integer(e.slot), 'INVALID_WAL_COMPLETION');
      if (e.type === 'expired') {
        requireThat(integer(e.finalizedBlockHeight) && BigInt(e.finalizedBlockHeight) > BigInt(prepared.get(e.signature).lastValidBlockHeight) + 32n && e.statusObservedNull === true && e.safetyBlocks === 32 && /^[0-9a-f]{64}$/.test(e.bufferPayloadSha256), 'INVALID_WAL_EXPIRY');
      }
      completed.set(e.signature, e.type);
    }
  }
  requireThat(prepared.size * 5000 <= UPLOAD.feeCap, 'UPLOAD_FEE_CAP');
}

export async function broadcastOnce({ rpc, append, entry, wire }) {
  await append(entry); // Durable public journal BEFORE any possible broadcast.
  // maxRetries:3 permits bounded node-side relay of these SAME signed bytes. This is
  // not an application retry, fresh signature, new blockhash, or extra fee debit.
  const returned = await rpc('sendTransaction', [wire.toString('base64'), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 3 }]);
  requireThat(returned === entry.signature, 'SEND_SIGNATURE_MISMATCH_STOP');
}

function journalEntry(type, extra) { return { type, buffer: UPLOAD.buffer, binarySha256: UPLOAD.binarySha256, genesis: UPLOAD.genesis, ...extra }; }
function pendingEntries(entries) {
  const complete = new Set(entries.filter(x => ['finalized', 'expired'].includes(x.type)).map(x => x.signature));
  return entries.filter(x => x.type === 'prepared' && !complete.has(x.signature));
}

export function validateRunPlan(entries, chunks) {
  validateWalEntries(entries);
  requireThat(pendingEntries(entries).length === 0, 'PRIOR_UNKNOWN_WRITE_RECONCILE_ONLY');
  const previous = new Map(), terminal = new Map();
  for (const e of entries) {
    if (e.type === 'prepared') previous.set(e.offset, e.signature);
    else terminal.set(e.signature, e.type);
  }
  requireThat(chunks.every(c => !previous.has(c.offset) || terminal.get(previous.get(c.offset)) === 'expired'), 'PRIOR_WRITTEN_OFFSET_MISSING_STOP');
  const reserved = entries.filter(e => e.type === 'prepared').reduce((sum, e) => sum + e.fee, 0);
  requireThat(reserved + chunks.length * 5000 <= UPLOAD.feeCap, 'UPLOAD_FEE_CAP');
  return reserved; // Expired attempts retain their entire original fee reservation.
}

export function validateExpiryObservation(prepared, finalizedBlockHeight, statuses) {
  requireThat(integer(finalizedBlockHeight) && BigInt(finalizedBlockHeight) > BigInt(prepared.lastValidBlockHeight) + 32n, 'EXPIRY_NOT_FINALIZED_PAST_SAFETY_WINDOW');
  requireThat(integer(statuses?.context?.slot) && statuses.context.slot > 0 && Array.isArray(statuses.value) && statuses.value.length === 1 && statuses.value[0] === null, 'EXPIRY_REQUIRES_EXPLICIT_NULL_STATUS');
}

export async function expirePending({ rpc, append, entries, signature }) {
  validateWalEntries(entries);
  requireThat(isCanonicalTransactionSignature(signature), 'INVALID_EXPIRY_SIGNATURE');
  const pending = pendingEntries(entries);
  requireThat(pending.length === 1 && pending[0].signature === signature, 'EXPIRY_REQUIRES_EXACT_SOLE_PENDING_SIGNATURE');
  const finalizedBlockHeight = await rpc('getBlockHeight', [{ commitment: 'finalized' }]);
  const statuses = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  validateExpiryObservation(pending[0], finalizedBlockHeight, statuses);
  const minimum = await rpc('getMinimumBalanceForRentExemption', [37 + UPLOAD.binaryBytes, { commitment: 'finalized' }]);
  const buffer = await rpc('getAccountInfo', [UPLOAD.buffer, { encoding: 'base64', commitment: 'finalized' }]);
  requireThat(integer(buffer?.context?.slot) && buffer.context.slot > 0, 'INVALID_FINALIZED_BUFFER_SLOT');
  const payload = validateBuffer(buffer?.value, minimum);
  const evidence = journalEntry('expired', { signature, finalizedBlockHeight, statusObservedNull: true, safetyBlocks: 32, slot: buffer.context.slot, bufferPayloadSha256: hash(payload) });
  await append(evidence);
  return evidence; // No send, signer, fee release, or next upload in this action.
}
async function reconcile(rpc, entries, maxPolls) {
  const pending = [...entries];
  for (let poll = 0; pending.length && poll < maxPolls; poll++) {
    if (poll) await sleep(3000);
    const result = await rpc('getSignatureStatuses', [pending.map(e => e.signature), { searchTransactionHistory: true }]);
    requireThat(Array.isArray(result?.value) && result.value.length === pending.length, 'MALFORMED_SIGNATURE_STATUSES');
    for (let i = pending.length - 1; i >= 0; i--) {
      if (finalizedStatus(result.value[i])) {
        await appendWal(walPath, journalEntry('finalized', { signature: pending[i].signature, slot: result.value[i].slot }));
        pending.splice(i, 1);
      } else if (result.value[i]?.err !== undefined && result.value[i].err !== null) throw new Error('WRITE_FAILED_STOP');
    }
  }
  requireThat(!pending.length, 'UNKNOWN_WRITE_STOP_RECONCILE_ONLY');
}

async function mainUnlocked(mode, signature) {
  const binary = await readFile(new URL('program/target/deploy/per_probe.so', import.meta.url)); validateBinary(binary);
  if (mode === '--plan') { console.log(JSON.stringify({ scope: 'Offline only; no RPC/sign/send', ...UPLOAD })); return; }
  const rpc = createPacedRpc();
  requireThat(await rpc('getGenesisHash') === UPLOAD.genesis, 'WRONG_GENESIS');
  const entries = await loadWal();
  const pending = pendingEntries(entries);
  if (mode === '--expire') {
    const evidence = await expirePending({ rpc, append: e => appendWal(walPath, e), entries, signature });
    console.log(JSON.stringify({ status: 'EXPLICIT_EXPIRY_RECORDED_NO_SEND', ...evidence })); return;
  }
  if (mode === '--reconcile') { await reconcile(rpc, pending, 10); console.log('RECORDED_FINALIZED_WRITES_RECONCILED_NO_SEND'); return; }
  requireThat(pending.length === 0, 'PRIOR_UNKNOWN_WRITE_RECONCILE_ONLY');
  const program = await rpc('getAccountInfo', [UPLOAD.program, { encoding: 'base64', commitment: 'finalized' }]);
  requireThat(program?.value === null, 'PROGRAM_ALREADY_EXISTS_STOP');
  const minimum = await rpc('getMinimumBalanceForRentExemption', [37 + binary.length, { commitment: 'finalized' }]);
  const current = await rpc('getAccountInfo', [UPLOAD.buffer, { encoding: 'base64', commitment: 'finalized' }]);
  const chunks = missingChunks(binary, validateBuffer(current?.value, minimum));
  let reserved = validateRunPlan(entries, chunks);
  const balance = await rpc('getBalance', [UPLOAD.payer, { commitment: 'finalized' }]);
  requireThat(integer(balance?.value) && balance.value >= chunks.length * 5000 + 1000000, 'INSUFFICIENT_UPLOAD_BALANCE');
  requireThat(reserved + chunks.length * 5000 <= UPLOAD.feeCap, 'UPLOAD_FEE_CAP');
  const keyPath = new URL('probe-payer-keypair.json', privateRoot);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readPrivateFile(keyPath, 8192))));
  requireThat(payer.publicKey.toBase58() === UPLOAD.payer, 'WRONG_PAYER');
  for (let start = 0; start < chunks.length; start += UPLOAD.batchSize) {
    const batch = chunks.slice(start, start + UPLOAD.batchSize);
    const recent = (await rpc('getLatestBlockhash', [{ commitment: 'finalized' }]))?.value;
    requireThat(recent && integer(recent.lastValidBlockHeight), 'MALFORMED_BLOCKHASH');
    const batchEntries = [];
    for (let index = 0; index < batch.length; index++) {
      const chunk = batch[index];
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: recent.blockhash }).add(writeInstruction(chunk.offset, chunk.bytes));
      if (index === 0) {
        const fee = (await rpc('getFeeForMessage', [tx.serializeMessage().toString('base64'), { commitment: 'finalized' }]))?.value;
        validateWriteFee(fee, reserved); requireThat(fee === 5000, 'UNEXPECTED_WRITE_FEE');
      }
      validateWriteFee(5000, reserved); tx.sign(payer);
      const wire = tx.serialize(); requireThat(wire.length <= 1232 && tx.signatures.length === 1, 'WRONG_WRITE_TRANSACTION');
      requireThat(tx.signature?.length === 64, 'MISSING_LOCAL_SIGNATURE');
      const signature = base58(tx.signature);
      const entry = journalEntry('prepared', { signature, offset: chunk.offset, length: chunk.bytes.length, messageSha256: hash(tx.serializeMessage()), lastValidBlockHeight: recent.lastValidBlockHeight, fee: 5000 });
      await broadcastOnce({ rpc, append: e => appendWal(walPath, e), entry, wire });
      reserved += 5000; batchEntries.push(entry);
    }
    await reconcile(rpc, batchEntries, 15);
    console.log(JSON.stringify({ finalizedWritesThisRun: Math.min(start + batch.length, chunks.length), missingAtStart: chunks.length, totalJournalFeeReservedLamports: reserved }));
  }
  const final = await rpc('getAccountInfo', [UPLOAD.buffer, { encoding: 'base64', commitment: 'finalized' }]);
  requireThat(integer(final?.context?.slot) && final.context.slot > 0, 'INVALID_FINALIZED_BUFFER_SLOT');
  requireThat(hash(validateBuffer(final?.value, minimum)) === UPLOAD.binarySha256, 'FINALIZED_BUFFER_HASH_MISMATCH');
  const evidence = { observedAt: new Date().toISOString(), status: 'FINALIZED_BUFFER_MATCH', buffer: UPLOAD.buffer, program: UPLOAD.program, binarySha256: UPLOAD.binarySha256, slot: final.context?.slot, writesThisRun: chunks.length, journalFeeReservedLamports: reserved, programDeployedByThisTool: false };
  await writeFile(new URL('upload-buffer-complete.json', privateRoot), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(evidence));
}

async function main(mode, signature) {
  requireThat(['--plan', '--run', '--reconcile', '--expire'].includes(mode), 'EXPECTED_PLAN_RUN_RECONCILE_OR_EXPIRE');
  requireThat(mode === '--expire' ? isCanonicalTransactionSignature(signature) : signature === undefined, 'INVALID_EXPIRY_ARGUMENTS');
  if (mode === '--plan') return mainUnlocked(mode);
  return withUploadLock(new URL('upload-buffer.lock', privateRoot), () => mainUnlocked(mode, signature));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { requireThat(process.argv.length <= 4, 'TOO_MANY_ARGUMENTS'); await main(process.argv[2] ?? '--plan', process.argv[3]); }
  catch (error) { console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UPLOAD_STOP_LOCAL_OR_RPC_ERROR'); process.exitCode = 1; }
}
