#!/usr/bin/env bash
# Rule v3 evaluation (validation seeds val4, test seeds test3; earlier rules used val/val2/val3 and test/test2). 1) choose in-match rates on validation seeds against VALIDATION-pool learned
# opponents (rule-v1 checkpoints); 2) one held-out test on fresh seeds "test2" against rule-v2 held-out
# checkpoints and the HELD_OUT scripts; 3) live balance. Writes to ops/evidence/ringside-contact5-20261009/.
set -euo pipefail
cd "$(dirname "$0")/../.."
R=experiments/ringside-learner/runs E=ops/evidence/ringside-contact5-20261009/rule-v3
EV="bash scripts/use-node.sh node --import tsx experiments/ringside-learner/eval.ts --params $R/main/params.json --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1"
mode=${1:-validate}
if [ "$mode" = validate ]; then
  for f in 2 4; do for a in 0.5 1; do
    $EV --mactor $a --mcritic 0.05 --mfast $f --mentropy 0.03 --opps learned --against $R/rule-v2/heldout-a/params.json,$R/rule-v2/heldout-b/params.json --seeds val4 --n 150 --out $E/validate-fast$f-actor$a.json > /dev/null
    python3 -c "import json;d=json.load(open('$E/validate-fast$f-actor$a.json'));print('fast $f actor $a', d['comparisons']['learningVsFrozenMargin'], d['comparisons']['learningVsFrozenWin'])"
  done; done
else
  A=${2:?actor} F=${3:?fast}
  $EV --mactor $A --mcritic 0.05 --mfast $F --mentropy 0.03 --shuffled $R/shuffled-control/params.json --opps learned --against $R/heldout-a/params.json,$R/heldout-b/params.json --seeds test3 --n 200 --out $E/test3-learned.json > /dev/null
  $EV --mactor $A --mcritic 0.05 --mfast $F --mentropy 0.03 --shuffled $R/shuffled-control/params.json --opps heldout --seeds test3 --n 200 --out $E/test3-scripts.json > /dev/null
  python3 -c "
import json
for f in ['test3-learned','test3-scripts']:
  d=json.load(open('$E/'+f+'.json'));print('==',f);print(json.dumps(d['summary']));print(json.dumps(d['comparisons']))"
fi
