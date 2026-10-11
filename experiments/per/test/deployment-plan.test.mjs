import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../lib.mjs';
import { calculateRentPlan, validateBuild } from '../deployment-plan.mjs';

const id = '11111111111111111111111111111111';
function build() {
  const artifacts = {
    sourceSha256: Buffer.from(`declare_id!("${id}");`),
    binarySha256: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]),
    idlSha256: Buffer.from(JSON.stringify({ address: id })),
    cargoLockSha256: Buffer.from('locked-test-dependencies')
  };
  return { artifacts, report: { programId: id, localArtifactConsistency: 'PASS', binaryBytes: 5, ...Object.fromEntries(Object.entries(artifacts).map(([name, bytes]) => [name, sha256(bytes)])) } };
}

test('rent envelope keeps temporary buffer separate and never counts a negative shortfall', () => {
  const low = calculateRentPlan({ program: 1, programData: 100, buffer: 90 }, 15);
  assert.equal(low.permanentRentLamports, 101);
  assert.equal(low.conservativeRentEnvelopeLamports, 191);
  assert.equal(low.rentEnvelopeShortfallLamports, 176);
  assert.equal(low.feesAndExperimentFundingIncluded, false);
  assert.equal(calculateRentPlan({ program: 1, programData: 100, buffer: 90 }, 500).rentEnvelopeShortfallLamports, 0);
});

test('malformed or overflowing RPC rent and balance inputs cannot look funded', () => {
  for (const invalid of [-1, 1.5, NaN, null, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateRentPlan({ program: invalid, programData: 1, buffer: 1 }, 10));
    assert.throws(() => calculateRentPlan({ program: 1, programData: 1, buffer: 1 }, invalid));
  }
  assert.throws(() => calculateRentPlan({ program: 1, buffer: 2 }, 10));
  assert.throws(() => calculateRentPlan({ program: Number.MAX_SAFE_INTEGER, programData: 1, buffer: 1 }, 0));
});

test('stale, incomplete or changed local artifacts cannot use a previous build result', () => {
  const { artifacts, report } = build();
  assert.equal(validateBuild(report, artifacts, id), 5);
  for (const field of Object.keys(artifacts)) {
    assert.throws(() => validateBuild(report, { ...artifacts, [field]: Buffer.from('changed') }, id));
    const missing = { ...artifacts }; delete missing[field];
    assert.throws(() => validateBuild(report, missing, id));
  }
  assert.throws(() => validateBuild({ ...report, localArtifactConsistency: 'BLOCKED' }, artifacts, id));
  assert.throws(() => validateBuild(report, artifacts, 'different-program'));
  assert.throws(() => validateBuild({ ...report, binaryBytes: 4 }, artifacts, id));
});

test('matching hashes alone cannot conceal an IDL or source identity mismatch', () => {
  for (const field of ['sourceSha256', 'idlSha256']) {
    const { artifacts, report } = build();
    artifacts[field] = field === 'sourceSha256' ? Buffer.from('declare_id!("other");') : Buffer.from('{"address":"other"}');
    report[field] = sha256(artifacts[field]);
    assert.throws(() => validateBuild(report, artifacts, id));
  }
});
