#!/usr/bin/env bash
set -euo pipefail

SOLLISH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SOLLISH_ROOT"
export PATH="$SOLLISH_ROOT/.tooling/bin:$PATH"

if [[ ! -x "$SOLLISH_ROOT/.tooling/bin/cargo-build-sbf" ]]; then
  echo "Missing pinned SBF builder. Run bash scripts/toolchain-setup.sh first." >&2
  exit 1
fi

# Pin SBPFv2 while the production runtime/PER compatibility is under evaluation.
# Build each manifest separately: the host test's no-entrypoint feature must not
# be unified into the deployable house program.
cargo-build-sbf --manifest-path programs/house/Cargo.toml \
  --sbf-out-dir "$SOLLISH_ROOT/target/deploy" --arch v2 -- --locked
cargo-build-sbf --manifest-path programs/games/Cargo.toml \
  --sbf-out-dir "$SOLLISH_ROOT/target/deploy" --arch v2 -- --locked
cargo-build-sbf --manifest-path programs/incentives/Cargo.toml \
  --sbf-out-dir "$SOLLISH_ROOT/target/deploy" --arch v2 -- --locked
cargo-build-sbf --manifest-path tests/fixtures/mock-game/Cargo.toml \
  --sbf-out-dir "$SOLLISH_ROOT/target/deploy" --arch v2 -- --locked --features test-fixture
cargo-build-sbf --manifest-path tests/fixtures/mock-vrf/Cargo.toml \
  --sbf-out-dir "$SOLLISH_ROOT/target/deploy" --arch v2 -- --locked --features test-fixture

shasum -a 256 target/deploy/house.so target/deploy/games.so target/deploy/incentives.so \
  target/deploy/mock_game.so target/deploy/mock_vrf.so > target/deploy/artifacts.sha256
mkdir -p target/idl target/types
"$SOLLISH_ROOT/.tooling/bin/anchor" idl build -p house \
  -o target/idl/house.json -t target/types/house.ts -- --locked
"$SOLLISH_ROOT/.tooling/bin/anchor" idl build -p games \
  -o target/idl/games.json -t target/types/games.ts -- --locked
"$SOLLISH_ROOT/.tooling/bin/anchor" idl build -p incentives \
  -o target/idl/incentives.json -t target/types/incentives.ts -- --locked
echo "SBF artifacts built. mock_game.so and mock_vrf.so are ONLY for local tests."
