#!/usr/bin/env bash
# Local dev with the live arena: the realtime worker (wrangler dev, :8787) plus the web dev server (:3000) pointed at it.
# Ringside is a shared LIVE game and only runs against this server; plain `pnpm dev` has no live server, so Ringside shows
# "offline". Run through the Node wrapper: `bash scripts/use-node.sh pnpm dev:live`. Stop both with Ctrl+C.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ORIGINS="http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
pnpm --filter @sollish/realtime exec wrangler dev --port 8787 --var "ALLOWED_ORIGINS:$ORIGINS" &
REALTIME=$!
trap 'kill "$REALTIME" 2>/dev/null || true' EXIT INT TERM
NEXT_PUBLIC_API_URL="http://localhost:8787" pnpm --filter @sollish/web dev
