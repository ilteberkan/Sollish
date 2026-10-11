#!/usr/bin/env bash
# Rule v4b (rule v4 with lower chins, 9 Oct 2026): trains four checkpoints one after another (8 GB machine), freezes the main
# one into the engine, then runs the pre-registered test (seeds test5) and the live balance.
# Output: experiments/ringside-learner/runs/rule-v4b/ and ops/evidence/ringside-contact5-20261009/rule-v4b/.
set -euo pipefail
cd "$(dirname "$0")/../.."
R=experiments/ringside-learner/runs/rule-v4b E=ops/evidence/ringside-contact5-20261009/rule-v4b N="bash scripts/use-node.sh node --import tsx"
T="$N experiments/ringside-learner/train.ts"
$T --matches 12000 --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --graph malecns --tag v4bmain --out $R/main
$N experiments/ringside-learner/freeze.ts --run $R/main --rule v4b --evidence $E
$N experiments/ringside-learner/balance.ts --params frozen --n 300 --out $E/balance.json
$T --matches 12000 --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --graph shuffled --tag v4bmain --out $R/shuffled-control
$T --matches 6000 --actor 0.2 --critic 0.1 --fast 1 --entropy 0.05 --graph malecns --tag v4bheldoutA --out $R/heldout-a
$T --matches 6000 --actor 0.05 --critic 0.025 --fast 0 --entropy 0.15 --graph malecns --tag v4bheldoutB --out $R/heldout-b
EV="$N experiments/ringside-learner/eval.ts --params $R/main/params.json --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --mactor 1 --mcritic 0.05 --mfast 2 --mentropy 0.03 --shuffled $R/shuffled-control/params.json --seeds test5 --n 200"
$EV --opps learned --against $R/heldout-a/params.json,$R/heldout-b/params.json --out $E/test5-learned.json > /dev/null
$EV --opps heldout --out $E/test5-scripts.json > /dev/null
echo done
