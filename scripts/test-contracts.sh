#!/usr/bin/env bash
set -euo pipefail

SOLLISH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SOLLISH_ROOT"
bash scripts/build-contracts.sh
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
