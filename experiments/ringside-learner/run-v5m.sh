#!/usr/bin/env bash
# Rule v5m (cross-round carry + opponent model, 10 Oct 2026): trains four checkpoints one after another (8 GB machine) on whole
# bouts of up to three rounds, freezes the main one into the engine (new engine id), then runs the pre-registered test (seeds test7)
# and the live balance over rounds of full bouts.
# Pre-registration: ops/evidence/ringside-contact5-20261010/rule-v5m/preregistration.md (written before any run).
# Output: experiments/ringside-learner/runs/rule-v5m/ and ops/evidence/ringside-contact5-20261010/rule-v5m/.
set -euo pipefail
cd "$(dirname "$0")/../.."
R=experiments/ringside-learner/runs/rule-v5m E=ops/evidence/ringside-contact5-20261010/rule-v5m N="bash scripts/use-node.sh node --import tsx"
T="$N experiments/ringside-learner/train.ts"
test -f $E/preregistration.md
mkdir -p $E
$T --matches 4000 --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --graph malecns --tag v5mmain --out $R/main
$N experiments/ringside-learner/freeze.ts --run $R/main --rule v5m --evidence $E
$N experiments/ringside-learner/balance.ts --params frozen --n 300 --out $E/balance.json
$T --matches 4000 --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --graph shuffled --tag v5mmain --out $R/shuffled-control
$T --matches 2000 --actor 0.2 --critic 0.1 --fast 1 --entropy 0.05 --graph malecns --tag v5mheldoutA --out $R/heldout-a
$T --matches 2000 --actor 0.05 --critic 0.025 --fast 0 --entropy 0.15 --graph malecns --tag v5mheldoutB --out $R/heldout-b
EV="$N experiments/ringside-learner/eval.ts --params $R/main/params.json --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --mactor 1 --mcritic 0.05 --mfast 2 --mentropy 0.03 --shuffled $R/shuffled-control/params.json --seeds test7 --n 200"
$EV --opps learned --against $R/heldout-a/params.json,$R/heldout-b/params.json --out $E/test7-learned.json > /dev/null
$EV --opps heldout --out $E/test7-scripts.json > /dev/null
echo done
