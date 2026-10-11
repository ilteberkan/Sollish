#!/usr/bin/env bash
# Trains the Contact 5 checkpoint, its shuffled-graph control and two held-out learned opponents, one after
# another (8 GB machine: never in parallel). Output: experiments/ringside-learner/runs/<name>/.
# Rule v3 (9 Oct 2026): lifetime entropy 0.1 (in-match 0.03), clinch cooldown 100 ticks, knockdown
# reward 2, rebalanced V5_FIGHTERS.
set -euo pipefail
cd "$(dirname "$0")/../.."
R=experiments/ringside-learner/runs
T="bash scripts/use-node.sh node --import tsx experiments/ringside-learner/train.ts"
$T --matches 12000 --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --graph malecns --tag main --out $R/main
$T --matches 12000 --actor 0.1 --critic 0.05 --fast 0.5 --entropy 0.1 --graph shuffled --tag main --out $R/shuffled-control
$T --matches 6000 --actor 0.2 --critic 0.1 --fast 1 --entropy 0.05 --graph malecns --tag heldoutA --out $R/heldout-a
$T --matches 6000 --actor 0.05 --critic 0.025 --fast 0 --entropy 0.15 --graph malecns --tag heldoutB --out $R/heldout-b
