# Damla evidence (`damla-terraces-1`)

DEMO credits only. Exact binomial RTP per mode plus a Monte Carlo cross-check through the real `playDamlaRound`.

- `generate.ts` prints the 15 paytables from the documented formula (centre floor C, edge E, exponent p solved by bisection, rounding, +-1 hundredth nudges of the four inner rings for the closest integer RTP to 98.5%). The result is pasted into `packages/protocol/src/damla.ts`.
- `exact.ts` computes the exact RTP, house edge and standard deviation with BigInt rationals (`--out <json>` writes the table).
- `simulate.ts` simulates ONE mode (own process), 20 M rounds in 1 M chunks, at most 2 worker threads, atomic flush of `mode-<mode>.json` after every chunk; rerun resumes. It keeps the exact slot histogram.
- `merge.ts` combines the 15 mode files into `rtp.json` (exact + MC, 95% interval, 3-sigma check, engine hash).
- `run.sh` loops the modes, one process each: `nohup bash experiments/damla/run.sh ops/evidence/damla-20261021 damla-20261021-evidence 20000000 >> ops/evidence/damla-20261021/run.log 2>&1 &`

`engineSourceSha256` is the sha256 of `damla.ts` without the `@evidence-block` (the `DAMLA_RTP` constants are filled from `rtp.json`); a test keeps them equal. Any engine or paytable change needs a new run.
