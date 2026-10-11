"""Record current local evidence identity; no network, deployment or training."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).parent
ROOT = HERE.resolve().parents[1]


def main():
    rows = []
    for path in sorted(HERE.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts or path == HERE / "evidence/manifest.json":
            continue
        raw = path.read_bytes()
        rows.append({"path": str(path.relative_to(HERE)), "bytes": len(raw),
                     "sha256": hashlib.sha256(raw).hexdigest()})
    work = ROOT / ".tooling/combat-motor-reuse"
    runtime = json.loads((HERE / "evidence/runtime-provenance.json").read_text())
    validation = json.loads((HERE / "evidence/validation.json").read_text())
    report = {
        "schema": "sollish-motor-reuse-manifest-v2", "atUtc": datetime.now(timezone.utc).isoformat(),
        "status": "LEARNED_MOTOR_OBSERVED_QUALITY_NOT_READY",
        "learnedPolicyLoaded": True, "trainingPerformed": False,
        "runtime": "PyBullet3.2.7 CPU; published DeepMimic mean actor evaluated in NumPy",
        "policyOrigin": runtime["checkpointOrigin"], "runtimeProvenance": "evidence/runtime-provenance.json",
        "canonicalRuns": ["spinkick-240hz-10iterations", "walk-240hz-10iterations"],
        "experimentalRuns": ["spinkick-600hz-10iterations", "walk-600hz-10iterations", "spinkick-1200hz-50iterations", "walk-1200hz-50iterations"],
        "unitAndRuntimeTests": {"passed": 13, "pureDataTests": 11, "realBulletGeometryTests": 2},
        "traceValidation": validation["status"], "qualityReady": False,
        "allRecordedRunsQualityReady": all(x["qualityReady"] for x in validation["traces"]),
        "cmuAssistedEvidenceChanged": False, "frozenV3Changed": False,
        "historicalManifest": "evidence/manifest-newton-historical.json",
        "sourceIdentityScope": "Current scripts and installed dependency hashes; historical traces preserve their original bytes. Not TensorFlow bit-parity or original C++ runtime equivalence.",
        "networkBudgetBytes": 500_000_000,
        "additionalNetworkEstimateBytesUpper": 90_000_000,
        "networkAccounting": "80.508MB PyBullet sdist, 0.629MB reader sdist retrieved twice, small dependencies/primary metadata; bounded estimate, not packet-level measurement. Prior Newton downloads separate.",
        "isolatedWorkspaceFileBytes": sum(p.stat().st_size for p in work.rglob("*") if p.is_file() and not p.is_symlink()),
        "freeDiskBytes": shutil.disk_usage(ROOT).free, "minimumFreeDiskBytes": 10 * 1024**3,
        "largestMeasuredRolloutPeakRssBytes": max(json.loads(p.read_text())["peakRssBytes"] for p in (HERE / "evidence").glob("*iterations-metrics.json")),
        "buildPeakRssScope": "Compiler constrained to one process; no rigorous peak-RSS trace was collected for the complete build.",
        "files": rows,
    }
    (HERE / "evidence/manifest.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps({key: report[key] for key in ("status", "unitAndRuntimeTests", "freeDiskBytes", "isolatedWorkspaceFileBytes", "largestMeasuredRolloutPeakRssBytes")}, indent=2))


if __name__ == "__main__":
    main()
