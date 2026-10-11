import test from 'node:test';
import assert from 'node:assert/strict';
import { accountSummary, aggregate, base58, classifyReadResponse, decodeData, LOADER, LOADER_V4, parseRpc, programDataSummary, redact, sha256, tcbPolicy, validateAuthChallenge } from '../lib.mjs';

test('RPC transport, error and malformed envelopes fail closed; explicit null remains missing account', () => {
  const ok = { jsonrpc: '2.0', id: 1, result: null };
  assert.equal(parseRpc(200, ok, 1), null);
  for (const [status, body] of [[403, ok], [200, {}], [200, { ...ok, id: 2 }], [200, { jsonrpc: '2.0', id: 1 }], [200, { ...ok, error: { code: -1, message: 'denied' } }]]) assert.throws(() => parseRpc(status, body, 1));
});

test('readiness cannot pass with absent, unknown, duplicate or blocked evidence', () => {
  assert.equal(aggregate([], ['G0']), 'BLOCKED');
  assert.equal(aggregate([{ id: 'G0', status: 'PASS' }], ['G0', 'G1']), 'BLOCKED');
  assert.equal(aggregate([{ id: 'G0', status: 'UNKNOWN' }], ['G0']), 'BLOCKED');
  assert.equal(aggregate([{ id: 'G0', status: 'PASS' }, { id: 'G0', status: 'PASS' }], ['G0']), 'BLOCKED');
  assert.equal(aggregate([{ id: 'G0', status: 'PASS' }, { id: 'G1', status: 'FAIL' }], ['G0', 'G1']), 'FAIL');
  assert.equal(aggregate([{ id: 'G0', status: 'PASS' }], ['G0']), 'PASS');
  assert.equal(aggregate([], []), 'BLOCKED');
});

test('base58 preserves leading zeroes and canonical base64 is mandatory', () => {
  assert.equal(base58(Buffer.alloc(32)), '11111111111111111111111111111111');
  assert.equal(base58(Buffer.from([0, 0, 1])), '112');
  assert.throws(() => decodeData({ data: ['@@', 'base64'] }));
  assert.throws(() => decodeData({ data: ['', 'base58'] }));
  assert.deepEqual(accountSummary(null), { exists: false });
});

test('Program and ProgramData variants, authority option, and byte boundaries are validated', () => {
  const program = Buffer.alloc(36); program.writeUInt32LE(2); program.fill(1, 4);
  const account = { owner: LOADER, executable: true, lamports: 1, data: [program.toString('base64'), 'base64'] };
  assert.equal(accountSummary(account).programDataAddress, base58(Buffer.alloc(32, 1)));
  const bytes = Buffer.alloc(49); bytes.writeUInt32LE(3); bytes.writeBigUInt64LE(123n, 4); bytes[12] = 1; bytes.fill(2, 13, 45); bytes.fill(7, 45);
  const data = { owner: LOADER, executable: false, data: [bytes.toString('base64'), 'base64'] };
  const parsed = programDataSummary(data);
  assert.equal(parsed.lastDeploySlot, '123'); assert.equal(parsed.upgradeAuthority, base58(Buffer.alloc(32, 2)));
  assert.equal(parsed.binarySha256IncludingAllocationPadding, sha256(Buffer.alloc(4, 7)));
  bytes[12] = 0; data.data[0] = bytes.toString('base64'); assert.equal(programDataSummary(data).upgradeAuthority, null);
  bytes[12] = 2; data.data[0] = bytes.toString('base64'); assert.throws(() => programDataSummary(data));
  assert.throws(() => programDataSummary({ ...data, owner: 'other' }));
  assert.throws(() => accountSummary({ ...account, data: [program.subarray(0, 35).toString('base64'), 'base64'] }));
});

test('errors redact bearer credentials in RPC URLs', () => {
  assert.equal(redact('https://host/?token=secret&method=x Bearer other'), 'https://host/?token=[REDACTED]&method=x Bearer [REDACTED]');
});

test('auth signing is restricted to fresh QFS text for our own wallet', () => {
  const pubkey = '11111111111111111111111111111111';
  const challenge = Buffer.from(`Login to Query Filtering Service\nTimestamp: 1790814000\nUser: ${pubkey}`);
  validateAuthChallenge(challenge, pubkey, 1790814000000);
  assert.throws(() => validateAuthChallenge(challenge, pubkey, 1790815000000));
  assert.throws(() => validateAuthChallenge(challenge, '22222222222222222222222222222222', 1790814000000));
  assert.throws(() => validateAuthChallenge(Buffer.from('arbitrary transaction bytes'), pubkey));
});

test('unknown or advisory-bearing TCB statuses never pass', () => {
  assert.equal(tcbPolicy({ status: 'UpToDate', advisory_ids: [] }), 'PASS');
  for (const value of [null, {}, { status: 'UpToDate' }, { status: 'OutOfDate', advisory_ids: [] }, { status: 'UpToDate', advisory_ids: ['INTEL-SA-example'] }]) assert.equal(tcbPolicy(value), 'BLOCKED');
});

test('LoaderV4 binary hash strips exactly 48 bytes; finalization changes authority meaning', () => {
  const bytes = Buffer.alloc(52); bytes.writeBigUInt64LE(123n); bytes.fill(2, 8, 40); bytes.writeBigUInt64LE(2n, 40); bytes.fill(7, 48);
  const account = { owner: LOADER_V4, executable: true, data: [bytes.toString('base64'), 'base64'] };
  const result = accountSummary(account).deployment;
  assert.equal(result.status, 'Finalized'); assert.equal(result.binarySha256IncludingAllocationPadding, sha256(Buffer.alloc(4, 7)));
  assert.match(result.authorityMeaning, /not an upgrade authority/);
  bytes.writeBigUInt64LE(3n, 40); account.data[0] = bytes.toString('base64'); assert.throws(() => accountSummary(account));
});

test('missing accounts and server errors are not treated as private-read rejection', () => {
  assert.equal(classifyReadResponse(401, null).outcome, 'AUTH_REJECTED');
  assert.equal(classifyReadResponse(500, {}).outcome, 'BLOCKED');
  assert.equal(classifyReadResponse(200, { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: null } }).outcome, 'ACCOUNT_ABSENT');
  assert.equal(classifyReadResponse(200, { error: { code: -32603, message: 'internal' } }).outcome, 'RPC_ERROR');
  assert.equal(classifyReadResponse(200, {}).outcome, 'BLOCKED');
});
