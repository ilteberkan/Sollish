// Read-only, bounded observation parser. This does NOT verify a Ristretto VRF proof.
// Pinned official ABI: api/src/{instruction,macros,sdk}.rs and
// program/src/{lib,provide_randomness,request_randomness}.rs at SOURCE_COMMIT.
import { createHash } from 'node:crypto';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { base58 } from './lib.mjs';

export const SOURCE_COMMIT = '52b103c5d55d72e07456a445044b3c006cb87c1a';
export const VRF_PROGRAM = 'Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz';
export const OWN_PROGRAM = 'AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va';
export const OWN_QUEUE = '5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc';
export const PROVIDE_BYTES = 168;
const LIMIT = Object.freeze({ jsonBytes: 256 * 1024, wireBytes: 1232, keys: 256, instructions: 256, dataBytes: 4096 });
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const hash = bytes => createHash('sha256').update(bytes).digest();
const canonicalKey = value => {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) throw new Error('Invalid public key encoding');
  const key = new PublicKey(value);
  if (key.toBase58() !== value) throw new Error('Noncanonical public key');
  return value;
};
const list = (value, bound, label) => {
  if (!Array.isArray(value) || value.length > bound) throw new Error(`Missing or oversized ${label}`);
  return value;
};
const index = (n, length) => {
  if (!Number.isInteger(n) || n < 0 || n >= length) throw new Error('Out-of-range account/instruction index');
  return n;
};

function bytes58(value, maxBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 1.37)) throw new Error('Oversized or nonstring base58');
  let n = 0n;
  for (const c of value) {
    const digit = B58.indexOf(c);
    if (digit < 0) throw new Error('Invalid base58');
    n = n * 58n + BigInt(digit);
  }
  let zeroes = 0; while (value[zeroes] === '1') zeroes++;
  const hex = n.toString(16);
  const bytes = Buffer.concat([Buffer.alloc(zeroes), n ? Buffer.from(hex.padStart(Math.ceil(hex.length / 2) * 2, '0'), 'hex') : Buffer.alloc(0)]);
  if (bytes.length > maxBytes || base58(bytes) !== value) throw new Error('Oversized or noncanonical base58');
  return bytes;
}

function bytes64(value, maxBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid or oversized base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== value) throw new Error('Noncanonical base64');
  return bytes;
}

function loadedKeys(meta, lookups, version) {
  let writableCount = 0, readonlyCount = 0;
  if (version === 0) {
    for (const lookup of list(lookups, LIMIT.keys, 'address lookups')) {
      canonicalKey(lookup.accountKey);
      for (const [name, count] of [['writableIndexes', 'writable'], ['readonlyIndexes', 'readonly']]) {
        const indices = list(lookup[name], LIMIT.keys, 'lookup indices');
        indices.forEach(i => index(i, 256));
        if (new Set(indices).size !== indices.length) throw new Error('Duplicate lookup indices');
        if (count === 'writable') writableCount += indices.length; else readonlyCount += indices.length;
      }
    }
  } else if (lookups?.length) throw new Error('Legacy transaction cannot contain address lookups');
  const loaded = meta.loadedAddresses ?? { writable: [], readonly: [] };
  const writable = list(loaded.writable, LIMIT.keys, 'loaded writable addresses').map(canonicalKey);
  const readonly = list(loaded.readonly, LIMIT.keys, 'loaded readonly addresses').map(canonicalKey);
  if (writable.length !== writableCount || readonly.length !== readonlyCount) throw new Error('Missing or mismatched loaded addresses');
  return [...writable, ...readonly]; // Solana order: static, loaded writable, loaded readonly.
}

function normalizeTransaction(result, expectedSignature) {
  if (!result || !result.meta || !Object.hasOwn(result.meta, 'err')) throw new Error('Missing transaction or execution metadata');
  if (Buffer.byteLength(JSON.stringify(result)) > LIMIT.jsonBytes) throw new Error('Oversized transaction observation');
  let version, message, signatures, wire = false;
  if (Array.isArray(result.transaction)) {
    if (result.transaction.length !== 2 || result.transaction[1] !== 'base64') throw new Error('Unsupported transaction encoding');
    const bytes = bytes64(result.transaction[0], LIMIT.wireBytes);
    const tx = VersionedTransaction.deserialize(bytes);
    if (!Buffer.from(tx.serialize()).equals(bytes)) throw new Error('Noncanonical or trailing transaction bytes');
    version = tx.version; wire = true; signatures = tx.signatures.map(s => base58(s));
    if (!['legacy', 0].includes(version)) throw new Error('Unsupported transaction version');
    message = version === 0 ? {
      accountKeys: tx.message.staticAccountKeys.map(k => k.toBase58()), header: tx.message.header,
      addressTableLookups: tx.message.addressTableLookups.map(l => ({ accountKey: l.accountKey.toBase58(), writableIndexes: l.writableIndexes, readonlyIndexes: l.readonlyIndexes })),
      instructions: tx.message.compiledInstructions.map(i => ({ programIdIndex: i.programIdIndex, accounts: [...i.accountKeyIndexes], data: Buffer.from(i.data) })),
    } : {
      accountKeys: tx.message.accountKeys.map(k => k.toBase58()), header: tx.message.header,
      instructions: tx.message.instructions,
    };
    if (result.version !== undefined && result.version !== version) throw new Error('Wire/result transaction version mismatch');
  } else {
    version = result.version ?? 'legacy';
    if (!['legacy', 0].includes(version)) throw new Error('Unsupported transaction version');
    message = result.transaction?.message; signatures = result.transaction?.signatures;
  }
  if (!message) throw new Error('Missing message');
  const signatureList = list(signatures, 64, 'signatures');
  signatureList.forEach(s => { if (bytes58(s, 64).length !== 64) throw new Error('Invalid signature length'); });
  if (!signatureList.length || expectedSignature && signatureList[0] !== expectedSignature) throw new Error('Wrong own-history transaction signature');
  const staticKeys = list(message.accountKeys, LIMIT.keys, 'static account keys').map(canonicalKey);
  const header = message.header;
  if (!header || !Number.isInteger(header.numRequiredSignatures) || header.numRequiredSignatures < 1 || header.numRequiredSignatures > staticKeys.length || header.numRequiredSignatures !== signatureList.length) throw new Error('Invalid message signature header');
  if (!Number.isInteger(header.numReadonlySignedAccounts) || header.numReadonlySignedAccounts < 0 || header.numReadonlySignedAccounts > header.numRequiredSignatures || !Number.isInteger(header.numReadonlyUnsignedAccounts) || header.numReadonlyUnsignedAccounts < 0 || header.numReadonlyUnsignedAccounts > staticKeys.length - header.numRequiredSignatures) throw new Error('Invalid message readonly header');
  const keys = [...staticKeys, ...loadedKeys(result.meta, message.addressTableLookups, version)];
  if (keys.length > LIMIT.keys || new Set(keys).size !== keys.length) throw new Error('Oversized or ambiguous combined account keys');
  const instructions = [];
  const top = list(message.instructions, LIMIT.instructions, 'top-level instructions');
  const push = (ix, location, binaryData = false) => {
    if (instructions.length >= LIMIT.instructions) throw new Error('Too many instructions');
    const program = keys[index(ix.programIdIndex, keys.length)];
    const accounts = list(ix.accounts, LIMIT.keys, 'instruction accounts').map(i => keys[index(i, keys.length)]);
    if (binaryData && !Buffer.isBuffer(ix.data)) throw new Error('Expected binary instruction data');
    instructions.push({ program, accounts, data: ix.data, binaryData, location });
  };
  top.forEach((ix, i) => push(ix, `top:${i}`, wire && version === 0));
  const groups = result.meta.innerInstructions ?? [];
  const seen = new Set();
  for (const group of list(groups, LIMIT.instructions, 'inner instruction groups')) {
    index(group.index, top.length);
    if (seen.has(group.index)) throw new Error('Duplicate inner instruction group');
    seen.add(group.index);
    list(group.instructions, LIMIT.instructions, 'inner instructions').forEach((ix, i) => push(ix, `inner:${group.index}:${i}`));
  }
  return { version, instructions, transactionSucceeded: result.meta.err === null, encoding: wire ? 'base64' : 'json' };
}

/** Only scope-checked ProvideRandomness payloads are decoded. Returned objects
 * never contain input/output/proof bytes or the derived/revealed randomness. */
export function inspectOwnVrfVisibility(result, { round, revealedRandomness, expectedInput = null, signature = null } = {}) {
  const observation = {
    sourceCommit: SOURCE_COMMIT, proofVerified: false, status: 'BLOCKED', exposed: false,
    inputBinding: expectedInput === null ? 'ACCOUNT_SCOPE_ONLY_INPUT_NOT_INDEPENDENTLY_BOUND' : 'SUPPLIED_EXPECTED_INPUT',
    candidates: [], limitations: ['Pinned source ABI is not a deployed-provider reproducible-build proof', 'RPC data/transaction execution metadata are observations, not a locally verified VRF proof'],
  };
  try {
    canonicalKey(round);
    if (!Buffer.isBuffer(revealedRandomness) || revealedRandomness.length !== 32) throw new Error('Expected revealed 32-byte randomness');
    if (expectedInput !== null && (!Buffer.isBuffer(expectedInput) || expectedInput.length !== 32)) throw new Error('Expected independently supplied 32-byte request input');
    const tx = normalizeTransaction(result, signature);
    observation.transactionSucceeded = tx.transactionSucceeded; observation.encoding = tx.encoding; observation.version = tx.version;
    const scopedIdentity = PublicKey.findProgramAddressSync([Buffer.from('identity'), new PublicKey(OWN_PROGRAM).toBuffer()], new PublicKey(VRF_PROGRAM))[0].toBase58();
    for (const ix of tx.instructions) {
      if (ix.program !== VRF_PROGRAM) continue;
      // Own probe has exactly one callback account. Do not decode another round's output.
      if (ix.accounts.length !== 6 || ix.accounts[3] !== OWN_QUEUE || ix.accounts[4] !== OWN_PROGRAM || ix.accounts[5] !== round) continue;
      if (ix.accounts[1] !== scopedIdentity) { observation.limitations.push('Own-looking instruction has wrong scoped identity'); continue; }
      const oracleData = PublicKey.findProgramAddressSync([Buffer.from('oracle'), new PublicKey(ix.accounts[0]).toBuffer()], new PublicKey(VRF_PROGRAM))[0].toBase58();
      if (ix.accounts[2] !== oracleData) { observation.limitations.push('Own-looking instruction has wrong oracle-data PDA'); continue; }
      const data = ix.binaryData ? ix.data : bytes58(ix.data, LIMIT.dataBytes);
      if (data.length < 1 || data[0] !== 4) continue;
      if (data.length !== PROVIDE_BYTES) throw new Error('Wrong ProvideRandomness byte length');
      const canonicalHeader = data.subarray(1, 8).every(b => b === 0);
      // The pinned runtime checks tag4 but ignores reserved bytes1..7. Preserve
      // their noncanonical status while still detecting a derivable secret.
      if (expectedInput !== null && !data.subarray(8, 40).equals(expectedInput)) {
        observation.limitations.push('Own-looking fulfillment input differs from independently supplied request input');
        continue;
      }
      const derivedRandomnessMatch = hash(data.subarray(40, 72)).equals(revealedRandomness);
      observation.candidates.push({ location: ix.location, bytes: PROVIDE_BYTES, canonicalHeader, derivedRandomnessMatch, transactionSucceeded: tx.transactionSucceeded, inputBinding: observation.inputBinding, proofVerified: false });
      observation.exposed ||= derivedRandomnessMatch;
    }
    // A public output matching the revealed secret exposes it even when the
    // containing transaction failed; that does not prove fulfillment succeeded.
    if (observation.exposed) observation.status = 'FAIL';
    observation.outcome = observation.exposed ? 'DERIVABLE_SECRET_OBSERVED' : observation.candidates.length ? 'NO_MATCH_IN_OWN_SCOPED_CANDIDATES' : 'NO_OWN_SCOPED_FULFILLMENT_OBSERVED';
  } catch (e) {
    observation.outcome = 'UNPARSEABLE_OR_INCOMPLETE';
    observation.reason = e instanceof Error ? e.message : 'Unknown parsing error';
    // If an earlier own candidate already exposed a secret, later malformed
    // instructions cannot erase that observation.
    if (observation.exposed) observation.status = 'FAIL';
  }
  return observation;
}
