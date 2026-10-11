#!/usr/bin/env bash
# Pinned Apple Silicon binaries under .tooling; standard Solana cache link only.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tooling_root="$project_root/.tooling"
download_root="$tooling_root/downloads"

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'This pinned bootstrap currently supports macOS Apple Silicon only.' >&2
  exit 1
fi
for dependency in curl shasum tar python3 cargo; do
  command -v "$dependency" >/dev/null || { echo "Missing prerequisite: $dependency" >&2; exit 1; }
done
cargo +1.95.0 --version >/dev/null
mkdir -p "$download_root" "$tooling_root/bin" "$tooling_root/sources"

download_verified() {
  local url="$1" destination="$2" expected="$3" actual
  if [[ ! -f "$destination" ]]; then
    curl --fail --location --retry 3 --silent --show-error \
      --output "$destination.partial" "$url"
    mv "$destination.partial" "$destination"
  fi
  actual="$(shasum -a 256 "$destination" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "SHA-256 mismatch: $destination; remove this archive and retry." >&2
    exit 1
  fi
  echo "Verified: $(basename "$destination")"
}

# SHA-256 digests published in the official GitHub release API, verified 2026-10-01.
download_verified \
  'https://github.com/otter-sec/anchor/releases/download/v1.2.0/anchor-1.2.0-aarch64-apple-darwin' \
  "$download_root/anchor-1.2.0-aarch64-apple-darwin" \
  '986d99392a520dfc50b63caf4eda9b9d7619c78ffb53fc57b6f8677c60b6d27e'
download_verified \
  'https://github.com/anza-xyz/agave/releases/download/v4.1.2/solana-release-aarch64-apple-darwin.tar.bz2' \
  "$download_root/solana-release-4.1.2-aarch64-apple-darwin.tar.bz2" \
  '51a44318e6fb8be0cfa69cdfdb3252f4c76a5eb2866740694e91de3d2fc5a75b'
download_verified \
  'https://github.com/anza-xyz/platform-tools/releases/download/v1.57/platform-tools-osx-aarch64.tar.bz2' \
  "$download_root/platform-tools-v1.57-osx-aarch64.tar.bz2" \
  '48c32c2ec3ac3729b5caf1fdd6c4145496125edf043b2662b0586bfbc932b34a'
# crates.io sparse registry checksum: https://index.crates.io/ca/rg/cargo-build-sbf
download_verified \
  'https://static.crates.io/crates/cargo-build-sbf/cargo-build-sbf-4.4.0.crate' \
  "$download_root/cargo-build-sbf-4.4.0.crate" \
  '949c3fb7a1267e995f2b7215bf11b5afee7f97ee1774bf71561bc58e9c9ff09e'

anchor_root="$tooling_root/anchor/1.2.0"
agave_root="$tooling_root/agave/4.1.2"
platform_root="$tooling_root/platform-tools/v1.57"
builder_root="$tooling_root/cargo-build-sbf/4.4.0"
mkdir -p "$anchor_root" "$agave_root" "$platform_root" "$builder_root"
cp "$download_root/anchor-1.2.0-aarch64-apple-darwin" "$anchor_root/anchor"
chmod 755 "$anchor_root/anchor"
if [[ ! -x "$agave_root/bin/solana" ]]; then
  tar -xjf "$download_root/solana-release-4.1.2-aarch64-apple-darwin.tar.bz2" \
    -C "$agave_root" --strip-components=1
fi
if [[ ! -x "$platform_root/rust/bin/rustc" ]]; then
  tar -xjf "$download_root/platform-tools-v1.57-osx-aarch64.tar.bz2" -C "$platform_root"
fi
# Upstream expects this standard cache location. Refuse to replace existing tools;
# only a link to our verified release is created. HOME and rustup are not changed.
python3 - "$platform_root" <<'PY'
from pathlib import Path
import sys

platform = Path(sys.argv[1]).resolve()
cache = Path.home() / '.cache/solana/v1.57/platform-tools'
if cache.exists() or cache.is_symlink():
    if cache.resolve() != platform:
        raise SystemExit(f'Existing Solana cache preserved: {cache}; review it before retrying')
else:
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.symlink_to(platform, target_is_directory=True)
print(f'Solana cache: {cache} -> {platform}')
PY

# cargo-build-sbf 4.4.0 publishes source, not a native release binary. Its bundled
# Cargo.lock pins dependencies. Cargo verifies registry source/dependency checksums.
# Install unmodified upstream source, with Cargo caches/build artifacts kept local.
if [[ ! -x "$builder_root/bin/cargo-build-sbf" || ! -f "$builder_root/.upstream-4.4.0" ]]; then
  CARGO_HOME="$tooling_root/cargo-home" \
    CARGO_TARGET_DIR="$tooling_root/cargo-build-sbf-target" \
    cargo +1.95.0 install cargo-build-sbf --version '=4.4.0' --locked --force --root "$builder_root"
  touch "$builder_root/.upstream-4.4.0"
fi

ln -sfn ../anchor/1.2.0/anchor "$tooling_root/bin/anchor"
for binary in solana solana-keygen solana-test-validator; do
  ln -sfn "../agave/4.1.2/bin/$binary" "$tooling_root/bin/$binary"
done
cat > "$tooling_root/bin/cargo-build-sbf" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
tooling_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
platform_root="$tooling_root/platform-tools/v1.57"
export CARGO_HOME="${CARGO_HOME:-$tooling_root/cargo-home}"
export RUSTC="$platform_root/rust/bin/rustc"
export CARGO="$platform_root/rust/bin/cargo"
export PATH="$platform_root/rust/bin:$PATH"
exec "$tooling_root/cargo-build-sbf/4.4.0/bin/cargo-build-sbf" \
  --skip-tools-install --no-rustup-override --tools-version v1.57 "$@"
SH
chmod 755 "$tooling_root/bin/cargo-build-sbf"

"$tooling_root/bin/anchor" --version
"$tooling_root/bin/solana" --version
"$tooling_root/bin/cargo-build-sbf" --version
echo 'cargo-build-sbf is unmodified upstream 4.4.0; its standard cache links to .tooling.'
echo 'No shell profile, global PATH, Solana configuration, or rustup toolchain was changed.'
