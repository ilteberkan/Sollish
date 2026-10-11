#!/usr/bin/env bash
set -euo pipefail
EXPERIMENT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOLLISH_ROOT="$(cd "$EXPERIMENT_ROOT/../.." && pwd)"
cd "$EXPERIMENT_ROOT"
validate_local() {
  bash "$EXPERIMENT_ROOT/build-provider.sh"
  "$SOLLISH_ROOT/.tooling/bin/cargo-build-sbf" \
  --manifest-path program/Cargo.toml --sbf-out-dir "$EXPERIMENT_ROOT/target/deploy" \
  --arch v2 -- --locked --features test-fixture
  cargo test --workspace --locked -- --nocapture
  cargo clippy --workspace --all-targets --locked -- -D warnings
  cargo fmt --all -- --check
}
validate_local 2>&1 | tee "$EXPERIMENT_ROOT/verification.log"
python3 "$EXPERIMENT_ROOT/record-evidence.py"
