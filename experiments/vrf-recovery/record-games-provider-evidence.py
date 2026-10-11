"""Record only a successful explicit Games/provider local validation run."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re

base = Path(__file__).resolve().parent
root = base.parent.parent
log_path = base / 'games-provider-verification.log'
log = log_path.read_text()
result = re.findall(r'test result: ok\. (\d+) passed; 0 failed; 0 ignored', log)
if len(result) != 1 or int(result[0]) != 6 or 'test result: FAILED' in log:
    raise SystemExit('Expected explicit real-provider target with no skipped tests')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def numbers(pattern):
    match = re.search(pattern, log)
    if not match:
        raise SystemExit('Missing measured metric: ' + pattern)
    return [int(item) for item in match.groups()]

first = numbers(r'root_games_real_provider_first_wallet_cu=(\d+) legacy_bytes=(\d+) provider_fee=(\d+) vm_rent_total=(\d+)')
callbacks = [[int(value) for value in row] for row in re.findall(r'root_games_vm_transplant_provider_callback_cu=(\d+) permissionless_settle_close_cu=(\d+) payout=(\d+)', log)]
if len(callbacks) != 2 or sorted(row[2] for row in callbacks) != [0, 19_600_000]:
    raise SystemExit('Missing deterministic winning and losing settlement evidence')
provider = json.loads((base / 'provider-build.json').read_text())
record = {
    'scope': 'NON-PRODUCTION LOCAL VM; REAL PINNED PROVIDER SBF; CALLBACK USES EXPLICIT QUEUE TRANSPLANT; NOT LIVE DEVNET PROOF',
    'verifiedAtUtc': datetime.now(timezone.utc).isoformat(),
    'command': 'bash experiments/vrf-recovery/run-games-provider.sh',
    'testsPassed': int(result[0]), 'testsFailed': 0, 'skipped': 0,
    'signatureVerificationEnabled': True, 'mockOracleUsed': False,
    'firstWallet': dict(zip(['computeUnits', 'legacyTransactionBytes', 'providerFeeLamports', 'vmAccountRentLamports'], first)),
    'vmTransplantCallbacks': [dict(zip(['computeUnits', 'settleCloseComputeUnits', 'payoutLamports'], row)) for row in callbacks],
    'deliberatelyInsufficientBudgetComputeUnits': numbers(r'root_games_provider_insufficient_budget_cu=(\d+)')[0],
    'syntheticQueueOccupancy': [dict(zip(['allocatedBytes', 'shortFixtureRecords', 'computeUnits', 'accepted'], [int(size), int(count), int(cu), accepted == 'true'])) for size, count, cu, accepted in re.findall(r'root_games_provider_occupancy_bytes=(\d+) short_records=(\d+) cu=(\d+) accepted=(true|false)', log)],
    'providerCommit': provider['buildSpec']['upstreamCommit'],
    'providerArtifactSha256': provider['artifactSha256'],
    'rootArtifacts': {name: digest(root / f'target/deploy/{name}.so') for name in ['house', 'games']},
    'testSha256': digest(base / 'tests/tests/root_games_provider.rs'),
    'cargoLockSha256': digest(base / 'Cargo.lock'),
    'verificationLogSha256': digest(log_path),
    'limitations': [
        'Provider upgrade authority, local oracle key, clock/slot hashes and initial queue accounts are VM fixtures',
        'Default queue admission is genuine provider SBF; callback request bytes are transplanted to a test-oracle canonical queue',
        'No provider private key impersonation, transaction signature bypass, or Games/House state replacement',
        'No proof of deployed provider binary matching this source, live delivery, concurrency/TPS, or timeout recovery',
        'VM rent schedule is measured locally and differs from current devnet rent; fetch current RPC rent before funding',
        'Oracle queue purge leaves an Awaiting bet and reserved SOL; production recovery gate remains unresolved',
        'BSL upstream source remains a local non-production test dependency only',
    ],
}
(base / 'games-provider-evidence.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'gamesProviderEvidence': 'PASS_LOCAL_ONLY', 'tests': int(result[0])}))
