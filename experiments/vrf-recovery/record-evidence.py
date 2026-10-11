"""Record a successful local workflow. Called only after run-local.sh succeeds."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re

base = Path(__file__).resolve().parent
log = (base / "verification.log").read_text()
counts = [int(n) for n in re.findall(r"test result: ok\. (\d+) passed; 0 failed", log)]
if not counts or "test result: FAILED" in log:
    raise SystemExit("No successful local test results to record")

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def metric(pattern):
    match = re.search(pattern, log)
    if not match:
        raise SystemExit("Missing local metric: " + pattern)
    return int(match.group(1))

binary = base / "target/deploy/vrf_recovery_experiment.so"
provider = json.loads((base / "provider-build.json").read_text())
record = {
    "scope": "NON-PRODUCTION local SBF experiment; no Coinflip integration or network transactions",
    "verified_at_utc": datetime.now(timezone.utc).isoformat(),
    "upstream_commit": provider["buildSpec"]["upstreamCommit"],
    "command": "bash experiments/vrf-recovery/run-local.sh",
    "tests_passed": sum(counts),
    "tests_failed": 0,
    "test_groups": {"capture_unit": counts[0], "provider_vm": counts[2], "proof_vm": counts[3]},
    "clippy_deny_warnings": "passed",
    "rustfmt": "passed",
    "canonical_recovery_compute_units": metric(r"original_proof_recovery_compute_units=(\d+)"),
    "provider_admission_compute_units": metric(r"provider_admission_cu=(\d+)"),
    "provider_callback_compute_units": metric(r"provider_normal_callback_cu=(\d+)"),
    "queue_load": [
        {"account_bytes": int(size), "short_fixture_records": int(records), "compute_units": int(cu)}
        for size, records, cu in re.findall(r"provider_capture_load_bytes=(\d+) records=(\d+) cu=(\d+) outcome=accepted", log)
    ],
    "default_budget_exhausted_cu": metric(r"provider_capture_default_budget_records=4800 cu=(\d+)"),
    "artifact_bytes": binary.stat().st_size,
    "artifact_sha256": digest(binary),
    "provider_artifact_sha256": provider["artifactSha256"],
    "source_sha256": {str(p.relative_to(base)): digest(p) for p in sorted(base.glob("program/src/**/*.rs"))},
    "test_sha256": {str(p.relative_to(base)): digest(p) for p in sorted(base.glob("tests/tests/*.rs"))},
    "cargo_lock_sha256": digest(base / "Cargo.lock"),
    "verification_log_sha256": digest(base / "verification.log"),
    "license_sha256": digest(base / "LICENSE.md"),
    "limitations": [
        "Provider SBF and pure parser are local tests, not a live deployment/oracle verification",
        "Snapshot account and ProgramData authority are VM genesis fixtures",
        "Queue occupancy uses short synthetic records, not concurrent users or worst-case payloads",
        "Some adversarial key/input mutations are explicit VM fault injections",
        "No Coinflip wagering, payment, PER or TDX integration",
        "Cannot recover an undisclosed oracle proof; BSL production rights unresolved",
    ],
}
temporary = base / "evidence.json.tmp"
temporary.write_text(json.dumps(record, indent=2) + "\n")
temporary.replace(base / "evidence.json")
print(json.dumps({"localEvidence": "PASS_LOCAL_ONLY", "tests": sum(counts)}))
