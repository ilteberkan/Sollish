import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLaunchReadiness, readRepositoryFile } from './check-launch-readiness.mjs';

const prefix = 'experiments/vrf-recovery/';
const now = new Date('2026-10-02T00:00:00Z');
const commit = '52b103c5d55d72e07456a445044b3c006cb87c1a';
function fixture() {
  const files = new Map();
  const bind = path => { const bytes = Buffer.from(`test bytes ${path}`); files.set(path, bytes); return createHash('sha256').update(bytes).digest('hex'); };
  const sources = ['program/src/capture/tests.rs', 'program/src/capture.rs', 'program/src/lib.rs', 'program/src/provider.rs'];
  const tests = ['tests/tests/provider.rs', 'tests/tests/recovery.rs', 'tests/tests/root_games_provider.rs'];
  const recovery = {
    upstream_commit: commit, tests_failed: 0, tests_passed: 35, test_groups: { capture_unit: 12, proof_vm: 15, provider_vm: 8 },
    scope: 'NON-PRODUCTION local SBF experiment; no Coinflip integration or network transactions',
    clippy_deny_warnings: 'passed', rustfmt: 'passed', verified_at_utc: '2026-10-01T19:40:00Z',
    source_sha256: Object.fromEntries(sources.map(path => [path, bind(prefix + path)])),
    test_sha256: Object.fromEntries(tests.map(path => [path, bind(prefix + path)])),
    cargo_lock_sha256: bind(prefix + 'Cargo.lock'), verification_log_sha256: bind(prefix + 'verification.log'),
    license_sha256: bind(prefix + 'LICENSE.md'), artifact_sha256: bind(prefix + 'target/deploy/vrf_recovery_experiment.so'),
    provider_artifact_sha256: bind('.tooling/vrf-provider-build/artifacts/solana_vrf_program.so'),
  };
  const provider = {
    providerCommit: commit, testsPassed: 6, testsFailed: 0, skipped: 0, signatureVerificationEnabled: true, mockOracleUsed: false,
    vmTransplantCallbacks: [{ payoutLamports: 19_600_000 }, { payoutLamports: 0 }],
    testSha256: recovery.test_sha256[tests[2]], cargoLockSha256: recovery.cargo_lock_sha256,
    verificationLogSha256: bind(prefix + 'games-provider-verification.log'), providerArtifactSha256: recovery.provider_artifact_sha256,
    rootArtifacts: { house: bind('target/deploy/house.so'), games: bind('target/deploy/games.so') }, verifiedAtUtc: '2026-10-01T19:39:00Z',
  };
  const perIds = ['same-round-finalized-initializers', 'private-prepared-before-vrf', 'own-scoped-callback-ready',
    'playerA-submit-with-readonly-private-round', 'playerB-submit-with-readonly-private-round',
    'captured-responses-secret-scan', 'vrf-output-derived-secret-scan', 'streaming-log-and-account-subscriptions',
    'vrf-queue-inflight-own-request-visibility', 'G1-G3-production-acceptance'];
  for (const phase of ['prepared', 'ready']) for (const role of ['anonymous', 'inspector', 'playerA', 'playerB']) {
    if (role !== 'inspector') perIds.push(`${phase}-${role}-round-read-isolation`);
    for (const receipt of ['receiptA', 'receiptB']) perIds.push(`${phase}-${role}-${receipt}-public-read`);
  }
  const per = { schemaVersion: 1, status: 'BLOCKED', G0: 'BLOCKED', productionApproval: false,
    runOutcome: 'COMPLETED_LIMITED_EXPERIMENT', scope: 'Own PER probe resume-initialized; no game/funds payout',
    rows: [{ phase: 'ready', role: 'anonymous', method: 'getTransaction' }],
    checks: perIds.map(id => ({ id, status: 'BLOCKED' })),
    leakSearch: [{ kind: 'VRF_OUTPUT_DERIVATION', observation: { candidates: [] } }], finishedAt: '2026-10-01T14:49:00Z' };
  const manifest = { devnetGenesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', sources: { vrfCommit: commit }, observedOwnProbeDeployment: { productionApproval: false }, expectedTeeMeasurements: null, approvedOwnCounterDeployment: null };
  const records = { [`${prefix}evidence.json`]: recovery, [`${prefix}games-provider-evidence.json`]: provider,
    'experiments/per/evidence/probe-resume-initialized-latest.json': per, 'experiments/per/manifest.json': manifest };
  const read = async path => {
    if (Object.hasOwn(records, path)) return Buffer.from(JSON.stringify(records[path]));
    if (!files.has(path)) throw new Error('arbitrary secret-bearing filesystem message');
    return files.get(path);
  };
  return { files, recovery, provider, per, manifest, read };
}
const evaluate = input => checkLaunchReadiness({ read: input.read, now });

test('consistent local evidence never opens a production gate', async () => {
  const report = await evaluate(fixture());
  assert.equal(report.evidenceStatus, 'CONSISTENT');
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.productionApproved, false);
  assert.equal(report.gates.length, 9);
  assert.ok(report.gates.every(gate => gate.status === 'BLOCKED'));
});

test('changed source, verifier binary and Games binary each invalidate their evidence', async () => {
  for (const path of [prefix + 'program/src/capture.rs', prefix + 'target/deploy/vrf_recovery_experiment.so', 'target/deploy/games.so']) {
    const f = fixture(); f.files.set(path, Buffer.from('changed after run'));
    assert.equal((await evaluate(f)).evidenceStatus, 'INCOMPLETE_OR_STALE');
  }
});

test('missing log fails closed without persisting arbitrary error text', async () => {
  const f = fixture(); f.files.delete(prefix + 'verification.log');
  const report = await evaluate(f);
  assert.equal(report.evidenceStatus, 'INCOMPLETE_OR_STALE');
  assert.equal(JSON.stringify(report).includes('secret-bearing'), false);
});

test('self-declared live approval cannot override the recorded scope', async () => {
  const f = fixture(); f.per.productionApproval = true; f.per.status = 'PASS'; f.per.G0 = 'PASS';
  const report = await evaluate(f);
  assert.equal(report.evidenceStatus, 'INCOMPLETE_OR_STALE');
  assert.equal(report.productionApproved, false);
});

test('adding arbitrary measurement pins is not attestation validation', async () => {
  const f = fixture(); f.manifest.expectedTeeMeasurements = { arbitrary: 'value' }; f.manifest.approvedOwnCounterDeployment = {};
  const report = await evaluate(f);
  assert.equal(report.records.at(-1).measurementPolicyPresent, true);
  assert.equal(report.gates.find(gate => gate.id === 'crash.attestation').status, 'BLOCKED');
});

test('injected evidence paths are rejected before any dynamic read', async () => {
  const f = fixture(); f.recovery.source_sha256['../../secrets'] = 'a'.repeat(64);
  const calls = []; const read = f.read; f.read = async path => { calls.push(path); return read(path); };
  assert.equal((await evaluate(f)).evidenceStatus, 'INCOMPLETE_OR_STALE');
  assert.equal(calls.some(path => path.includes('secrets')), false);
});

test('missing winner/loser coverage, wrong upstream and future timestamps fail closed', async () => {
  for (const alter of [f => { f.provider.vmTransplantCallbacks[0].payoutLamports = 0; }, f => { f.recovery.upstream_commit = 'other'; }, f => { f.per.finishedAt = '2027-01-01T00:00:00Z'; }]) {
    const f = fixture(); alter(f);
    assert.equal((await evaluate(f)).evidenceStatus, 'INCOMPLETE_OR_STALE');
  }
});

test('missing/null JSON records never pass by vacuous success', async () => {
  for (const bad of ['null', '[]', '{']) {
    const f = fixture(); const read = f.read; f.read = path => path === prefix + 'evidence.json' ? Promise.resolve(Buffer.from(bad)) : read(path);
    assert.equal((await evaluate(f)).evidenceStatus, 'INCOMPLETE_OR_STALE');
  }
});

test('empty live evidence, missing expected checks and duplicate check IDs are incomplete', async () => {
  for (const alter of [
    f => { f.per.rows = []; }, f => { f.per.checks = []; }, f => { f.per.leakSearch = []; },
    f => { f.per.checks.pop(); }, f => { f.per.checks[1] = { ...f.per.checks[0] }; },
    f => { f.per.leakSearch[0].kind = 'OTHER'; },
  ]) {
    const f = fixture(); alter(f);
    assert.equal((await evaluate(f)).evidenceStatus, 'INCOMPLETE_OR_STALE');
  }
});

test('filesystem reader rejects traversal, symlinks and oversized files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sollish-readiness-'));
  try {
    await writeFile(join(root, 'plain'), 'safe');
    await symlink(join(root, 'plain'), join(root, 'link'));
    await writeFile(join(root, 'large'), Buffer.alloc(8 * 1024 * 1024 + 1));
    assert.equal((await readRepositoryFile('plain', root)).toString(), 'safe');
    for (const path of ['../plain', '/plain', 'link', 'large']) await assert.rejects(readRepositoryFile(path, root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
