// Offline evidence inventory, not a deployment authorization or runtime feature flag.
// Exit 2: known launch blockers. Exit 1: missing/stale/inconsistent evidence.
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RECOVERY = 'experiments/vrf-recovery/';
const COMMIT = '52b103c5d55d72e07456a445044b3c006cb87c1a';
const SHA = /^[a-f0-9]{64}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const positive = value => Number.isSafeInteger(value) && value > 0;
const requireTrue = value => { if (!value) throw new Error('INVALID_EVIDENCE'); };
const SOURCES = ['program/src/capture/tests.rs', 'program/src/capture.rs', 'program/src/lib.rs', 'program/src/provider.rs'];
const TESTS = ['tests/tests/provider.rs', 'tests/tests/recovery.rs', 'tests/tests/root_games_provider.rs'];
const PER_CHECKS = [
  'same-round-finalized-initializers', 'private-prepared-before-vrf', 'own-scoped-callback-ready',
  'playerA-submit-with-readonly-private-round', 'playerB-submit-with-readonly-private-round',
  'captured-responses-secret-scan', 'vrf-output-derived-secret-scan',
  'streaming-log-and-account-subscriptions', 'vrf-queue-inflight-own-request-visibility', 'G1-G3-production-acceptance',
];
for (const phase of ['prepared', 'ready']) {
  for (const role of ['anonymous', 'inspector', 'playerA', 'playerB']) {
    if (role !== 'inspector') PER_CHECKS.push(`${phase}-${role}-round-read-isolation`);
    for (const receipt of ['receiptA', 'receiptB']) PER_CHECKS.push(`${phase}-${role}-${receipt}-public-read`);
  }
}

// Static paths only: evidence JSON cannot redirect reads to credentials or other files.
export async function readRepositoryFile(path, root = ROOT) {
  requireTrue(typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..'));
  const full = resolve(root, path);
  const info = await lstat(full);
  requireTrue(info.isFile() && !info.isSymbolicLink() && info.size <= 8 * 1024 * 1024);
  const data = await readFile(full);
  requireTrue(data.length <= 8 * 1024 * 1024);
  return data;
}

export async function checkLaunchReadiness({ read = readRepositoryFile, now = new Date() } = {}) {
  const records = [];
  const json = async path => {
    const bytes = await read(path);
    const value = JSON.parse(bytes.toString('utf8'));
    requireTrue(value && typeof value === 'object' && !Array.isArray(value));
    return { value, digest: sha256(bytes) };
  };
  const matches = async (path, expected) => {
    requireTrue(typeof expected === 'string' && SHA.test(expected));
    requireTrue(sha256(await read(path)) === expected);
  };
  const observedAt = value => {
    const time = Date.parse(value);
    requireTrue(typeof value === 'string' && Number.isFinite(time) && time <= now.getTime());
    return value;
  };
  async function inspect(id, path, verify) {
    try {
      const { value, digest } = await json(path);
      const details = await verify(value);
      records.push({ id, path, integrity: 'CONSISTENT_WITH_CHECKED_FILES', sha256: digest, ...details });
    } catch {
      // Never forward arbitrary filesystem/parser error messages or input data.
      records.push({ id, path, integrity: 'MISSING_STALE_OR_INCONSISTENT', error: 'EVIDENCE_CHECK_FAILED' });
    }
  }

  await inspect('recovery-local', `${RECOVERY}evidence.json`, async e => {
    requireTrue(e.upstream_commit === COMMIT && e.tests_failed === 0 && positive(e.tests_passed));
    requireTrue(e.scope === 'NON-PRODUCTION local SBF experiment; no Coinflip integration or network transactions');
    requireTrue(e.clippy_deny_warnings === 'passed' && e.rustfmt === 'passed');
    requireTrue(e.test_groups && Object.keys(e.test_groups).sort().join(',') === 'capture_unit,proof_vm,provider_vm');
    requireTrue(Object.values(e.test_groups).every(positive) && Object.values(e.test_groups).reduce((a, b) => a + b, 0) === e.tests_passed);
    for (const [paths, map] of [[SOURCES, e.source_sha256], [TESTS, e.test_sha256]]) {
      requireTrue(map && Object.keys(map).sort().join(',') === [...paths].sort().join(','));
      for (const path of paths) await matches(`${RECOVERY}${path}`, map[path]);
    }
    await matches(`${RECOVERY}Cargo.lock`, e.cargo_lock_sha256);
    await matches(`${RECOVERY}verification.log`, e.verification_log_sha256);
    await matches(`${RECOVERY}LICENSE.md`, e.license_sha256);
    await matches(`${RECOVERY}target/deploy/vrf_recovery_experiment.so`, e.artifact_sha256);
    await matches('.tooling/vrf-provider-build/artifacts/solana_vrf_program.so', e.provider_artifact_sha256);
    return { scope: 'LOCAL_EXPERIMENT_ONLY', observedAt: observedAt(e.verified_at_utc), testsReported: e.tests_passed };
  });
  await inspect('coinflip-provider-local', `${RECOVERY}games-provider-evidence.json`, async e => {
    requireTrue(e.providerCommit === COMMIT && e.testsPassed === 6 && e.testsFailed === 0 && e.skipped === 0);
    requireTrue(e.signatureVerificationEnabled === true && e.mockOracleUsed === false);
    requireTrue(Array.isArray(e.vmTransplantCallbacks) && e.vmTransplantCallbacks.length === 2);
    requireTrue(e.vmTransplantCallbacks.map(row => row.payoutLamports).sort((a, b) => a - b).join(',') === '0,19600000');
    await matches(`${RECOVERY}tests/tests/root_games_provider.rs`, e.testSha256);
    await matches(`${RECOVERY}Cargo.lock`, e.cargoLockSha256);
    await matches(`${RECOVERY}games-provider-verification.log`, e.verificationLogSha256);
    await matches('.tooling/vrf-provider-build/artifacts/solana_vrf_program.so', e.providerArtifactSha256);
    for (const name of ['house', 'games']) await matches(`target/deploy/${name}.so`, e.rootArtifacts?.[name]);
    return { scope: 'LOCAL_VM_QUEUE_TRANSPLANT_ONLY', observedAt: observedAt(e.verifiedAtUtc), testsReported: e.testsPassed };
  });
  await inspect('per-limited-live', 'experiments/per/evidence/probe-resume-initialized-latest.json', async e => {
    requireTrue(e.schemaVersion === 1 && e.status === 'BLOCKED' && e.G0 === 'BLOCKED' && e.productionApproval === false);
    requireTrue(e.runOutcome === 'COMPLETED_LIMITED_EXPERIMENT' && e.scope === 'Own PER probe resume-initialized; no game/funds payout');
    requireTrue(Array.isArray(e.rows) && e.rows.length > 0 && Array.isArray(e.checks) && Array.isArray(e.leakSearch) && e.leakSearch.length > 0);
    requireTrue(e.checks.every(check => check && typeof check.id === 'string' && ['PASS', 'FAIL', 'BLOCKED'].includes(check.status)));
    const ids = e.checks.map(check => check.id);
    requireTrue(new Set(ids).size === ids.length && ids.sort().join(',') === [...PER_CHECKS].sort().join(','));
    const derivations = e.leakSearch.filter(row => row.kind === 'VRF_OUTPUT_DERIVATION');
    requireTrue(derivations.length > 0 && derivations.every(row => Array.isArray(row.observation?.candidates)));
    return {
      scope: 'HISTORICAL_LIMITED_LIVE_REPORT_ONLY', observedAt: observedAt(e.finishedAt),
      httpRows: e.rows.length, blockedChecks: e.checks.filter(row => row.status === 'BLOCKED').length,
      failedChecks: e.checks.filter(row => row.status === 'FAIL').length,
      derivationObservations: derivations.length,
      parsedVrfCandidates: derivations.reduce((sum, row) => sum + row.observation.candidates.length, 0),
      privacyProved: false, l1GamePayoutProved: false,
    };
  });
  await inspect('per-identity-policy', 'experiments/per/manifest.json', async e => {
    requireTrue(e.devnetGenesisHash === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    requireTrue(e.sources?.vrfCommit === COMMIT && e.observedOwnProbeDeployment?.productionApproval === false);
    // A populated object is not an independently verified attestation policy.
    return { scope: 'CONFIGURATION_OBSERVATION_ONLY', measurementPolicyPresent: e.expectedTeeMeasurements != null, approvedG0DeploymentPresent: e.approvedOwnCounterDeployment != null };
  });

  const gates = [
    ['coinflip.same-proof-integration', 'Original input/key capture and both consumption paths are isolated experiments; root wagering integration and migration acceptance remain required.'],
    ['coinflip.proof-availability', 'Retaining input/key verifies an available proof; it cannot produce a proof withheld by the oracle. No reroll or selective refund fallback.'],
    ['coinflip.recovery-license', 'Pinned prover/verifier production-use clearance remains unresolved; local BSL experiment is not a production grant.'],
    ['coinflip.live-provider', 'Local queue transplantation does not prove deployed source equivalence, live callback delivery, or a funded finalized payout.'],
    ['crash.attestation', 'Independent approved measurement and quote-to-validator-to-program binding remain required.'],
    ['crash.privacy', 'Full lifecycle/streaming/in-flight queue and independently bound VRF derivation observations remain incomplete.'],
    ['crash.manual-cashout', 'Readonly probe commands are not timed cashout acceptance/order, concurrency or reconnect validation.'],
    ['crash.payment-recovery', 'Exactly-once L1 game-payment rights and interruption recovery are not implemented by this probe.'],
    ['launch.independent-review', 'A game/house audit, deployment-specific controls and operational launch approval are outside these experiment records.'],
  ].map(([id, reason]) => ({ id, status: 'BLOCKED', reason }));
  return {
    schemaVersion: 1, checkedAt: now.toISOString(), status: 'BLOCKED', productionApproved: false,
    scope: 'Offline core-game evidence inventory; no RPC, credentials, transactions, licensing opinion or deployment authorization.',
    evidenceStatus: records.every(row => row.integrity === 'CONSISTENT_WITH_CHECKED_FILES') ? 'CONSISTENT' : 'INCOMPLETE_OR_STALE',
    records, gates,
    limitations: ['Hashes detect drift against checked local records, not authenticity or independent audit.', 'Historical live records are not revalidated against the network.', 'No record or test count can automatically authorize production; gate closure requires a separately reviewed implementation and new acceptance evidence.'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error(JSON.stringify({ status: 'BLOCKED', error: 'NO_ARGUMENTS_SUPPORTED' }));
    process.exitCode = 1;
  } else {
    try {
      const report = await checkLaunchReadiness();
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.evidenceStatus === 'CONSISTENT' ? 2 : 1;
    } catch {
      console.error(JSON.stringify({ status: 'BLOCKED', error: 'READINESS_CHECK_FAILED' }));
      process.exitCode = 1;
    }
  }
}
