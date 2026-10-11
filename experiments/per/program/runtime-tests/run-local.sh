#!/usr/bin/env bash
set -euo pipefail
test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The canonical workflow rebuilds both SBF artifacts before running this suite.
# It never invokes a cluster or faucet; no stale binary is accepted silently.
exec bash "$test_dir/../build-local.sh"
