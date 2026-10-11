import test from 'node:test';
import assert from 'node:assert/strict';
import { base58, sha256 } from '../lib.mjs';
import { isCanonicalTransactionSignature, observationSummary } from '../probe-client.mjs';
import { safeFailure, selectOwnHistory, summarizeSimulation } from '../probe-runner.mjs';

const secret = 'PRIVATE_RANDOMNESS_OR_VRF_PROOF_SHOULD_NEVER_PERSIST';
const captured = (err, extra = {}) => ({ httpStatus: 200, text: 'mock RPC response', body: { jsonrpc: '2.0', id: 1, result: { value: { err } }, ...extra } });

test('simulation errors persist only fixed classifications and hashes, never strings or nested proof bytes', () => {
  for (const err of [secret, { InstructionError: [0, secret] }, { data: { output: secret, proof: [...Buffer.from(secret)] } }, 17]) {
    const summary = summarizeSimulation(captured(err));
    assert.equal(summary.simulationSucceeded, false);
    assert.equal(summary.simulationError.rawErrorPersisted, false);
    assert.equal(JSON.stringify(summary).includes(secret), false);
    assert.match(summary.simulationError.errorSha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(summarizeSimulation(captured({ InstructionError: [0, secret] })).simulationError.classification, 'INSTRUCTION_ERROR');
});

test('simulation success requires explicit null error in a successful unambiguous RPC envelope', () => {
  assert.equal(summarizeSimulation(captured(null)).simulationSucceeded, true);
  const missing = captured(null); delete missing.body.result.value.err;
  const wrongEnvelope = captured(null); wrongEnvelope.body.id = 2;
  for (const observation of [missing, captured(undefined), wrongEnvelope, { ...captured(null), httpStatus: 403 }, captured(null, { error: { code: -32000, message: secret } })]) {
    const summary = summarizeSimulation(observation);
    assert.equal(summary.simulationSucceeded, false);
    assert.equal(JSON.stringify(summary).includes(secret), false);
  }
  assert.equal(summarizeSimulation(captured(null)).simulationError.classification, 'NONE');
});

test('RPC, send-status and timeout exceptions cannot copy remote error contents to reports or stderr', () => {
  for (const prefix of ['RPC -32000: ', 'HTTP 403: ', 'Own submit_probe transaction failed:', 'Own round state timeout:', 'unclassified ']) {
    const error = new Error(prefix + secret);
    const summary = safeFailure(error);
    assert.equal(summary.rawErrorPersisted, false);
    assert.equal(summary.errorSha256, sha256(error.message));
    assert.equal(JSON.stringify(summary).includes(secret), false);
  }
  assert.equal(safeFailure(new Error('Own probe is not deployed')).classification, 'OWN_PROGRAM_NOT_DEPLOYED');
  assert.equal(safeFailure(new Error('Own inspector wallet is unfunded; no automatic faucet/transfer')).classification, 'OWN_WALLET_UNFUNDED');
  assert.equal(JSON.stringify(safeFailure({ error: secret })).includes(secret), false);
});

test('transaction signature validation enforces exact64-byte canonical base58 before reuse', () => {
  const canonical = base58(Buffer.alloc(64, 55));
  assert.equal(isCanonicalTransactionSignature(canonical), true);
  assert.equal(isCanonicalTransactionSignature(base58(Buffer.alloc(64))), true);
  for (const bad of [null, {}, secret, base58(Buffer.alloc(63, 7)), base58(Buffer.alloc(65, 7)), canonical + '\n', '0' + canonical.slice(1), '1'.repeat(89)]) assert.equal(isCanonicalTransactionSignature(bad), false);
});

test('own history discards malformed records before RPC/rows, deduplicates and caps selection', () => {
  const canonical = base58(Buffer.alloc(64, 55));
  const selected = selectOwnHistory([{ signature: canonical }, { signature: secret }, { signature: base58(Buffer.alloc(63)) }, null, { signature: canonical }]);
  assert.deepEqual(selected.signatures, [canonical]); assert.equal(selected.malformedCount, 3); assert.equal(selected.duplicateCount, 1);
  assert.equal(JSON.stringify(selected).includes(secret), false);
  assert.equal(selectOwnHistory({ secret }).missing, true);
  const capped = selectOwnHistory(Array.from({ length: 31 }, (_, i) => ({ signature: base58(Buffer.alloc(64, i + 1)) })));
  assert.equal(capped.truncated, true); assert.equal(capped.signatures.length, 30);
});

test('observation metadata omits malformed RPC code strings/objects and keeps safe integer codes', () => {
  for (const code of [secret, { proof: secret }, [secret], null, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const summary = observationSummary({ httpStatus: 200, text: secret, body: { jsonrpc: '2.0', id: 1, error: { code, message: secret } } });
    assert.equal(Object.hasOwn(summary, 'rpcCode'), false);
    assert.equal(JSON.stringify(summary).includes(secret), false);
  }
  assert.equal(observationSummary({ httpStatus: 200, text: secret, body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: secret } } }).rpcCode, -32000);
});
