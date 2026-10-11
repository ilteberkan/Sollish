#!/usr/bin/env bash
set -euo pipefail
SOLLISH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOLLISH_NODE_VERSION="24.21.0"
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) SOLLISH_NODE_PLATFORM="darwin-arm64"; SOLLISH_NODE_SHA="6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe" ;;
  Linux:x86_64) SOLLISH_NODE_PLATFORM="linux-x64"; SOLLISH_NODE_SHA="fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6" ;;
  Linux:aarch64) SOLLISH_NODE_PLATFORM="linux-arm64"; SOLLISH_NODE_SHA="6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2" ;;
  *) echo "This bootstrap supports the development Mac, the ARM VPS and x64 Linux cloud sessions only." >&2; exit 1 ;;
esac
SOLLISH_RUNTIME="$SOLLISH_ROOT/.tooling/runtime"
SOLLISH_ARCHIVE="node-v$SOLLISH_NODE_VERSION-$SOLLISH_NODE_PLATFORM.tar.xz"
SOLLISH_NODE_DIR="$SOLLISH_RUNTIME/node-v$SOLLISH_NODE_VERSION-$SOLLISH_NODE_PLATFORM"
mkdir -p "$SOLLISH_RUNTIME"
if [[ ! -x "$SOLLISH_NODE_DIR/bin/node" ]]; then
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "https://nodejs.org/dist/v$SOLLISH_NODE_VERSION/$SOLLISH_ARCHIVE" -o "$SOLLISH_RUNTIME/$SOLLISH_ARCHIVE"
  if [[ "$SOLLISH_NODE_PLATFORM" == darwin-arm64 ]]; then
    SOLLISH_ACTUAL_SHA="$(/usr/bin/shasum -a 256 "$SOLLISH_RUNTIME/$SOLLISH_ARCHIVE" | awk '{print $1}')"
  else
    SOLLISH_ACTUAL_SHA="$(sha256sum "$SOLLISH_RUNTIME/$SOLLISH_ARCHIVE" | awk '{print $1}')"
  fi
  [[ "$SOLLISH_ACTUAL_SHA" == "$SOLLISH_NODE_SHA" ]] || { echo "Node checksum mismatch" >&2; exit 1; }
  tar -xJf "$SOLLISH_RUNTIME/$SOLLISH_ARCHIVE" -C "$SOLLISH_RUNTIME"
fi
export PATH="$SOLLISH_NODE_DIR/bin:$PATH"
exec "$@"
