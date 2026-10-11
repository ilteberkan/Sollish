#!/usr/bin/env bash
set -euo pipefail
probe_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$probe_dir/../../.." && pwd)"
cd "$probe_dir"
export PATH="$project_dir/.tooling/bin:$PATH"
key_path="$project_dir/.tooling/per/probe-program-keypair.json"
[[ -f "$key_path" ]] || { echo 'Missing owned probe program key; do not generate a replacement silently.' >&2; exit 1; }
mkdir -p target/deploy target/idl target/types
key_pubkey="$("$project_dir/.tooling/agave/4.1.2/bin/solana-keygen" pubkey "$key_path")"
[[ "$key_pubkey" == 'AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va' ]] || { echo 'Owned program key mismatch' >&2; exit 1; }
install -m 600 "$key_path" target/deploy/per_probe-keypair.json
cargo +1.95.0 test --lib --locked
cargo +1.95.0 clippy --lib --tests --locked -- -D warnings
cargo +1.95.0 fmt -- --check
cargo-build-sbf --manifest-path Cargo.toml --sbf-out-dir "$probe_dir/target/deploy" --arch v2 -- --locked
cargo-build-sbf --manifest-path runtime-tests/callback-fixture/Cargo.toml \
  --sbf-out-dir "$probe_dir/target/deploy" --arch v2 --features test-fixture -- --locked
cargo +1.95.0 test -p per-probe-runtime-tests --locked
cargo +1.95.0 clippy -p per-probe-runtime-tests -p per-probe-callback-fixture --all-targets --locked -- -D warnings
cargo +1.95.0 fmt --all -- --check
"$project_dir/.tooling/anchor/1.2.0/anchor" idl build -p per_probe \
  -o target/idl/per_probe.json -t target/types/per_probe.ts -- --locked
node --test validate-idl.test.mjs
node verify-artifacts.mjs
