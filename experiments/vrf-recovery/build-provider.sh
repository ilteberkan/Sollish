#!/usr/bin/env bash
set -euo pipefail

# NON-PRODUCTION ONLY. Builds public upstream source for local VM integration.
# No wallet, faucet, deployment, cluster, or production license grant is involved.
experiment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$experiment_dir/../.." && pwd)"
build_dir="$project_dir/.tooling/vrf-provider-build"
source_dir="$build_dir/source"
artifact_dir="$build_dir/artifacts"
artifact_file="$artifact_dir/solana_vrf_program.so"
report_file="$experiment_dir/provider-build.json"
provider_commit='52b103c5d55d72e07456a445044b3c006cb87c1a'
provider_lock_sha='16513fabe8ac2833e061569bc032262f2dc5da1fe5a090ea9c09ff9ecb21571f'
builder="$project_dir/.tooling/bin/cargo-build-sbf"

mkdir -p "$build_dir" "$artifact_dir"
if [[ ! -e "$source_dir" ]]; then
  git clone --no-checkout https://github.com/magicblock-labs/solana-vrf.git "$source_dir"
  git -C "$source_dir" -c advice.detachedHead=false checkout --detach "$provider_commit"
fi
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$provider_commit" ]] || {
  echo 'Provider checkout commit mismatch; refusing to reset an existing checkout.' >&2; exit 1;
}
[[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=no)" ]] || {
  echo 'Provider tracked source or lock has local changes; refusing build.' >&2; exit 1;
}
[[ "$(shasum -a 256 "$source_dir/Cargo.lock" | cut -d ' ' -f 1)" == "$provider_lock_sha" ]] || {
  echo 'Pinned upstream Cargo.lock digest mismatch.' >&2; exit 1;
}

# The report also pins the actual local build tooling. A stale report, changed
# artifact, source tree, build script, or toolchain forces a fresh --locked build.
python3 - "$source_dir" "$builder" "$report_file" "$artifact_file" "$build_dir" "$0" <<'PY'
import hashlib, json, pathlib, subprocess, sys
source, wrapper, report, artifact, work, script = map(pathlib.Path, sys.argv[1:])
project = work.parent.parent
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
run = lambda args: subprocess.check_output(args, text=True).strip()
spec = {
    'upstreamCommit': run(['git', '-C', str(source), 'rev-parse', 'HEAD']),
    'sourceTree': run(['git', '-C', str(source), 'rev-parse', 'HEAD^{tree}']),
    'upstreamCargoLockSha256': digest(source / 'Cargo.lock'),
    'sbfArch': 'v2',
    'cargoLocked': True,
    'defaultFeatures': [],
    'enabledFeatures': [],
    'buildScriptSha256': digest(script.resolve()),
    'builderWrapperSha256': digest(wrapper),
    'builderBinarySha256': digest(project / '.tooling/cargo-build-sbf/4.4.0/bin/cargo-build-sbf'),
    'builderVersion': run([str(project / '.tooling/cargo-build-sbf/4.4.0/bin/cargo-build-sbf'), '--version']),
    'rustcBinarySha256': digest(project / '.tooling/platform-tools/v1.57/rust/bin/rustc'),
    'rustcVersion': run([str(project / '.tooling/platform-tools/v1.57/rust/bin/rustc'), '--version']),
}
(work / 'build-spec.json').write_text(json.dumps(spec, indent=2) + '\n')
try:
    existing = json.loads(report.read_text())
except (FileNotFoundError, json.JSONDecodeError):
    existing = {}
reusable = artifact.is_file() and existing.get('buildSpec') == spec and existing.get('artifactSha256') == digest(artifact)
(work / 'cache-status').write_text('verified' if reusable else 'build-required')
PY

if [[ "$(cat "$build_dir/cache-status")" == 'verified' ]]; then
  echo 'Verified existing local provider SBF artifact and pinned build inputs.'
  exit 0
fi

# No test-sbf/unit_test_config authority override and no ephemeral-test-queue
# fee exemption. The unmodified upstream program's default features are empty.
"$builder" --manifest-path "$source_dir/program/Cargo.toml" \
  --sbf-out-dir "$artifact_dir" --arch v2 -- --locked 2>&1 | tee "$build_dir/build.log"

[[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=no)" ]] || {
  echo 'Provider build changed tracked source or lock; artifact is not accepted.' >&2; exit 1;
}
python3 - "$build_dir" "$report_file" "$artifact_file" <<'PY'
import datetime, hashlib, json, pathlib, sys
work, report, artifact = map(pathlib.Path, sys.argv[1:])
spec = json.loads((work / 'build-spec.json').read_text())
result = {
    'schemaVersion': 1,
    'scope': 'NON-PRODUCTION LOCAL SBF BUILD ONLY; NOT A DEPLOYED-PROGRAM OR VRF LIVENESS VERIFICATION',
    'verifiedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'upstreamRepository': 'https://github.com/magicblock-labs/solana-vrf.git',
    'programId': 'Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz',
    'license': 'Business Source License 1.1; non-production experiment only',
    'buildSpec': spec,
    'trackedSourceUnchanged': True,
    'artifactPath': '.tooling/vrf-provider-build/artifacts/solana_vrf_program.so',
    'artifactBytes': artifact.stat().st_size,
    'artifactSha256': hashlib.sha256(artifact.read_bytes()).hexdigest(),
    'buildLogPath': '.tooling/vrf-provider-build/build.log',
    'generatedKeypair': 'Ignored tool output; not the provider identity; never deploy it',
}
temporary = report.with_suffix('.json.tmp')
temporary.write_text(json.dumps(result, indent=2) + '\n')
temporary.replace(report)
print(json.dumps({'providerBuild': 'PASS', 'artifactBytes': result['artifactBytes'], 'artifactSha256': result['artifactSha256']}))
PY
