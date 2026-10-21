#!/usr/bin/env bash
# One process per mode, at most 2 worker threads each, modes one after the other. Resumable: rerun to continue.
# Usage (repo root): nohup bash experiments/damla/run.sh ops/evidence/damla-20261021 damla-20261021-evidence 20000000 >> ops/evidence/damla-20261021/run.log 2>&1 &
set -euo pipefail
OUT="${1:-ops/evidence/damla-20261021}"; SEED="${2:-damla-20261021-evidence}"; ROUNDS="${3:-20000000}"
for risk in low medium high; do for rows in 8 10 12 14 16; do
  bash scripts/use-node.sh node experiments/damla/simulate.ts --mode "$risk-$rows" --rounds "$ROUNDS" --seed "$SEED" --out "$OUT" --workers 2
done; done
bash scripts/use-node.sh node experiments/damla/merge.ts --dir "$OUT"
echo "ALL DONE"
