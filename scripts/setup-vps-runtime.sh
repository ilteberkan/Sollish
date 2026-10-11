#!/usr/bin/env bash
# Run on the authorized, inspected Debian ARM VPS with sudo. Does not touch SSH.
set -euo pipefail
[[ "$(id -u)" == 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ "$(uname -m)" == aarch64 ]] || { echo "ARM64 VPS required." >&2; exit 1; }
[[ -f /etc/debian_version ]] || { echo "Debian required." >&2; exit 1; }
SOLLISH_VERSION="24.21.0"
SOLLISH_SHA="6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2"
SOLLISH_BASE="/opt/sollish"
SOLLISH_BINARY="node-v$SOLLISH_VERSION-linux-arm64"
install -d -m 0755 "$SOLLISH_BASE/runtime" "$SOLLISH_BASE/releases"
if [[ ! -x "$SOLLISH_BASE/runtime/$SOLLISH_BINARY/bin/node" ]]; then
  SOLLISH_TMP="$(mktemp -d /tmp/sollish-runtime.XXXXXX)"
  trap 'rm -rf "$SOLLISH_TMP"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "https://nodejs.org/dist/v$SOLLISH_VERSION/$SOLLISH_BINARY.tar.xz" -o "$SOLLISH_TMP/node.tar.xz"
  printf '%s  %s\n' "$SOLLISH_SHA" "$SOLLISH_TMP/node.tar.xz" | sha256sum -c
  tar -xJf "$SOLLISH_TMP/node.tar.xz" -C "$SOLLISH_BASE/runtime" --no-same-owner
fi
if ! id sollish-worker >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/sollish-worker --shell /usr/sbin/nologin sollish-worker
fi
install -d -m 0750 -o sollish-worker -g sollish-worker /var/lib/sollish-worker
install -d -m 0700 -o root -g root /etc/sollish
"$SOLLISH_BASE/runtime/$SOLLISH_BINARY/bin/node" --version
echo "Runtime ready; application and provider configuration are deployed separately."
