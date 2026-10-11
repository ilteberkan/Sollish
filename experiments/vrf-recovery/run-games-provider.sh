#!/usr/bin/env bash
set -euo pipefail
# Explicit, NON-PRODUCTION test target. Never substitutes mock_vrf.so.
experiment_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sollish_root="$(cd "$experiment_root/../.." && pwd)"
cd "$sollish_root"
validate_games_provider() {
  bash "$experiment_root/build-provider.sh"
  # Rebuild the unchanged root programs before using their SBF artifacts.
  bash "$sollish_root/scripts/build-contracts.sh"
  cargo test --manifest-path "$experiment_root/Cargo.toml" -p vrf-recovery-tests \
    --features root-games-provider --test root_games_provider --locked -- --nocapture
  cargo clippy --manifest-path "$experiment_root/Cargo.toml" -p vrf-recovery-tests \
    --features root-games-provider --test root_games_provider --locked -- -D warnings
  cargo fmt --manifest-path "$experiment_root/Cargo.toml" --all -- --check
}
validate_games_provider 2>&1 | tee "$experiment_root/games-provider-verification.log"
python3 "$experiment_root/record-games-provider-evidence.py"
