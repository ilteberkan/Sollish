import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from '@solana/web3.js';
import { base58 } from '../lib.mjs';
import { OWN_PROGRAM, OWN_QUEUE, PROVIDE_BYTES, SOURCE_COMMIT, VRF_PROGRAM, inspectOwnVrfVisibility } from '../vrf-visibility.mjs';

// Synthetic bytes test parsing and SHA256 comparison, NOT a valid Ristretto proof.
const oracle = Keypair.fromSeed(Buffer.alloc(32, 33));
const round = Keypair.fromSeed(Buffer.alloc(32, 34)).publicKey.toBase58();
const otherRound = Keypair.fromSeed(Buffer.alloc(32, 35)).publicKey.toBase58();
const output = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 17));
const secret = createHash('sha256').update(output).digest();
const input = Buffer.alloc(32, 45);
const scopedIdentity = PublicKey.findProgramAddressSync([Buffer.from('identity'), new PublicKey(OWN_PROGRAM).toBuffer()], new PublicKey(VRF_PROGRAM))[0];
const oracleData = PublicKey.findProgramAddressSync([Buffer.from('oracle'), oracle.publicKey.toBuffer()], new PublicKey(VRF_PROGRAM))[0];
const blockhash = Keypair.fromSeed(Buffer.alloc(32, 36)).publicKey.toBase58();
function provideData() {
  const data = Buffer.alloc(PROVIDE_BYTES, 56); data.fill(0, 0, 8); data[0] = 4;
  input.copy(data, 8); output.copy(data, 40); return data;
}
function provideInstruction({ program = VRF_PROGRAM, targetRound = round, data = provideData() } = {}) {
  return new TransactionInstruction({ programId: new PublicKey(program), keys: [
    { pubkey: oracle.publicKey, isSigner: true, isWritable: true },
    { pubkey: scopedIdentity, isSigner: false, isWritable: false },
    { pubkey: oracleData, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(OWN_QUEUE), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(OWN_PROGRAM), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(targetRound), isSigner: false, isWritable: true },
  ], data });
}
function legacyResult(options = {}) {
  const tx = new Transaction({ feePayer: oracle.publicKey, recentBlockhash: blockhash }).add(provideInstruction(options));
  tx.sign(oracle);
  const message = tx.compileMessage();
  const signatures = [base58(tx.signature)];
  return {
    slot: 1, version: 'legacy', meta: { err: null, innerInstructions: [] },
    transaction: { signatures, message: { header: message.header, accountKeys: message.accountKeys.map(k => k.toBase58()), instructions: message.instructions } },
    wire: tx.serialize(),
  };
}
function withoutWire(result) { const { wire, ...rpc } = result; return rpc; }
function analyze(result, scope = {}) { return inspectOwnVrfVisibility(result, { round, revealedRandomness: secret, ...scope }); }
function versionedResult(encoding) {
  const addresses = [new PublicKey(OWN_QUEUE), new PublicKey(round), scopedIdentity, oracleData, new PublicKey(OWN_PROGRAM)];
  const lookup = new AddressLookupTableAccount({ key: new PublicKey(otherRound), state: { deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses } });
  const message = new TransactionMessage({ payerKey: oracle.publicKey, recentBlockhash: blockhash, instructions: [provideInstruction()] }).compileToV0Message([lookup]);
  const tx = new VersionedTransaction(message); tx.sign([oracle]);
  const loadedAddresses = { writable: [], readonly: [] };
  for (const l of message.addressTableLookups) {
    loadedAddresses.writable.push(...l.writableIndexes.map(i => addresses[i].toBase58()));
    loadedAddresses.readonly.push(...l.readonlyIndexes.map(i => addresses[i].toBase58()));
  }
  const jsonMessage = {
    header: message.header, accountKeys: message.staticAccountKeys.map(k => k.toBase58()),
    addressTableLookups: message.addressTableLookups.map(l => ({ accountKey: l.accountKey.toBase58(), writableIndexes: l.writableIndexes, readonlyIndexes: l.readonlyIndexes })),
    instructions: message.compiledInstructions.map(i => ({ programIdIndex: i.programIdIndex, accounts: [...i.accountKeyIndexes], data: base58(i.data) })),
  };
  return { slot: 2, version: 0, meta: { err: null, innerInstructions: [], loadedAddresses }, transaction: encoding === 'base64' ? [Buffer.from(tx.serialize()).toString('base64'), 'base64'] : { signatures: tx.signatures.map(s => base58(s)), message: jsonMessage } };
}

test('official fixed header/offsets find derivable randomness absent from callback bytes', () => {
  const result = withoutWire(legacyResult());
  assert.equal(provideData().includes(secret), false);
  const observed = analyze(result);
  assert.equal(observed.sourceCommit, SOURCE_COMMIT);
  assert.equal(observed.status, 'FAIL'); assert.equal(observed.exposed, true);
  assert.equal(observed.candidates[0].canonicalHeader, true);
  assert.equal(observed.inputBinding, 'ACCOUNT_SCOPE_ONLY_INPUT_NOT_INDEPENDENTLY_BOUND');
  assert.equal(observed.proofVerified, false);
  const report = JSON.stringify(observed);
  for (const sensitive of [secret, output, input, provideData()]) {
    assert.equal(report.includes(sensitive.toString('hex')), false);
    assert.equal(report.includes(sensitive.toString('base64')), false);
    assert.equal(report.includes(base58(sensitive)), false);
  }
});

test('legacy base64 wire transaction yields same bounded own-output observation', () => {
  const result = legacyResult();
  const observed = analyze({ ...withoutWire(result), transaction: [result.wire.toString('base64'), 'base64'] });
  assert.equal(observed.exposed, true); assert.equal(observed.encoding, 'base64');
});

test('inner ProvideRandomness is resolved against full message account keys', () => {
  const result = withoutWire(legacyResult());
  const ownProvide = result.transaction.message.instructions[0];
  result.transaction.message.instructions = [{ programIdIndex: 0, accounts: [], data: '' }];
  result.meta.innerInstructions = [{ index: 0, instructions: [ownProvide] }];
  const observed = analyze(result);
  assert.equal(observed.exposed, true); assert.equal(observed.candidates[0].location, 'inner:0:0');
});

test('wrong provider, callback round, queue and scoped identity do not decode another request', () => {
  for (const options of [{ program: OWN_PROGRAM }, { targetRound: otherRound }]) {
    const observed = analyze(withoutWire(legacyResult(options)));
    assert.equal(observed.exposed, false); assert.equal(observed.candidates.length, 0); assert.equal(observed.status, 'BLOCKED');
  }
  for (const name of [OWN_QUEUE, scopedIdentity.toBase58(), oracleData.toBase58()]) {
    const result = withoutWire(legacyResult());
    const pos = result.transaction.message.accountKeys.indexOf(name);
    result.transaction.message.accountKeys[pos] = otherRound;
    assert.equal(analyze(result).exposed, false);
  }
});

test('known input is compared separately and never confused with caller seed or round', () => {
  assert.equal(analyze(withoutWire(legacyResult()), { expectedInput: input }).exposed, true);
  const wrong = analyze(withoutWire(legacyResult()), { expectedInput: new PublicKey(round).toBuffer() });
  assert.equal(wrong.exposed, false); assert.equal(wrong.status, 'BLOCKED');
  assert.ok(wrong.limitations.some(s => s.includes('differs')));
  assert.equal(analyze(withoutWire(legacyResult()), { expectedInput: Buffer.alloc(31) }).outcome, 'UNPARSEABLE_OR_INCOMPLETE');
});

test('failed transaction can expose bytes but cannot prove accepted fulfillment', () => {
  const result = withoutWire(legacyResult()); result.meta.err = { InstructionError: [0, { Custom: 1 }] };
  const observed = analyze(result);
  assert.equal(observed.exposed, true); assert.equal(observed.status, 'FAIL');
  assert.equal(observed.transactionSucceeded, false); assert.equal(observed.proofVerified, false);
});

test('noncanonical reserved header stays visible because pinned runtime ignores those bytes', () => {
  const data = provideData(); data[2] = 123;
  const observed = analyze(withoutWire(legacyResult({ data })));
  assert.equal(observed.exposed, true); assert.equal(observed.candidates[0].canonicalHeader, false);
});

test('wrong tag, truncated or extended payload and corrupt base58 cannot report scan success', () => {
  const tag = provideData(); tag[0] = 3;
  assert.equal(analyze(withoutWire(legacyResult({ data: tag }))).candidates.length, 0);
  for (const data of [provideData().subarray(0, 167), Buffer.concat([provideData(), Buffer.alloc(1)])]) {
    const observed = analyze(withoutWire(legacyResult({ data })));
    assert.equal(observed.outcome, 'UNPARSEABLE_OR_INCOMPLETE'); assert.equal(observed.status, 'BLOCKED');
  }
  const bad = withoutWire(legacyResult()); bad.transaction.message.instructions[0].data = '0notBase58';
  assert.equal(analyze(bad).outcome, 'UNPARSEABLE_OR_INCOMPLETE');
});

test('JSON and base64 version0 resolve static+writable+readonly loaded keys in correct order', () => {
  for (const encoding of ['json', 'base64']) {
    const result = versionedResult(encoding);
    const observed = analyze(result);
    assert.equal(observed.exposed, true, observed.reason); assert.equal(observed.version, 0);
    const ix = encoding === 'json' ? result.transaction.message.instructions[0] : (() => {
      const raw = VersionedTransaction.deserialize(Buffer.from(result.transaction[0], 'base64')).message.compiledInstructions[0];
      return { programIdIndex: raw.programIdIndex, accounts: [...raw.accountKeyIndexes], data: base58(raw.data) };
    })();
    result.meta.innerInstructions = [{ index: 0, instructions: [ix] }];
    assert.ok(analyze(result).candidates.some(c => c.location === 'inner:0:0' && c.derivedRandomnessMatch));
  }
});

test('missing v0 loaded keys, moved readonly keys and duplicate keys are never guessed', () => {
  const missing = versionedResult('json'); delete missing.meta.loadedAddresses;
  assert.equal(analyze(missing).outcome, 'UNPARSEABLE_OR_INCOMPLETE');
  const moved = versionedResult('base64'); moved.meta.loadedAddresses.readonly.reverse();
  assert.equal(analyze(moved).exposed, false);
  const duplicate = versionedResult('json'); duplicate.meta.loadedAddresses.writable[0] = duplicate.transaction.message.accountKeys[0];
  assert.equal(analyze(duplicate).outcome, 'UNPARSEABLE_OR_INCOMPLETE');
});

test('malformed envelope, account indices, metadata, signature and unsupported version fail closed', () => {
  const cases = [null, {}, { ...withoutWire(legacyResult()), version: 1 }];
  const badIndex = withoutWire(legacyResult()); badIndex.transaction.message.instructions[0].accounts[5] = 999; cases.push(badIndex);
  const noErr = withoutWire(legacyResult()); delete noErr.meta.err; cases.push(noErr);
  const parsedKeys = withoutWire(legacyResult()); parsedKeys.transaction.message.accountKeys = parsedKeys.transaction.message.accountKeys.map(pubkey => ({ pubkey })); cases.push(parsedKeys);
  for (const result of cases) {
    const observed = analyze(result); assert.equal(observed.status, 'BLOCKED'); assert.equal(observed.outcome, 'UNPARSEABLE_OR_INCOMPLETE');
  }
  assert.equal(analyze(withoutWire(legacyResult()), { signature: base58(Buffer.alloc(64, 111)) }).exposed, false);
});

test('noncanonical/trailing/oversized base64 wire and oversized instruction arrays are bounded', () => {
  const fixture = legacyResult();
  const samples = [[fixture.wire.toString('base64') + '\n', 'base64'], [Buffer.concat([fixture.wire, Buffer.alloc(1)]).toString('base64'), 'base64'], [Buffer.alloc(1233).toString('base64'), 'base64'], [fixture.wire.toString('base64'), 'base58']];
  for (const transaction of samples) assert.equal(analyze({ ...withoutWire(fixture), transaction }).outcome, 'UNPARSEABLE_OR_INCOMPLETE');
  const many = withoutWire(legacyResult()); many.transaction.message.instructions = Array(257).fill(many.transaction.message.instructions[0]);
  assert.equal(analyze(many).outcome, 'UNPARSEABLE_OR_INCOMPLETE');
});

test('unmatched output and absent own instruction cannot establish secrecy PASS', () => {
  const otherSecret = Buffer.alloc(32, 199);
  const observed = analyze(withoutWire(legacyResult()), { revealedRandomness: otherSecret });
  assert.equal(observed.exposed, false); assert.equal(observed.candidates.length, 1); assert.equal(observed.status, 'BLOCKED');
  assert.equal(observed.outcome, 'NO_MATCH_IN_OWN_SCOPED_CANDIDATES');
});
