# Candy Cascade — Monte Carlo simulation (DEMO only)

Engine `candy-cascade-1` (`packages/protocol/src/cascade.ts`), spec `docs/product/candy-cascade-spec.md`.

```
bash scripts/use-node.sh node --import tsx experiments/candy-cascade/simulate.ts \
  --rounds 20000000 --seed candy-cascade-20261011-evidence \
  --out ops/evidence/candy-cascade-20261011/rtp.json [--workers 4]
```

## Method
- Each round is played by the production `playCascadeRound(seed, 100)` (stake 1 cent per hundredth, so `payoutCents` equals `totalHundredths` exactly; the report cross-checks both).
- Round seeds come from per-worker xoshiro128** streams seeded with `sha256("<seed>:<worker>")`; `(seed, rounds, workers)` reproduces the numbers exactly. `worker_threads` only split the rounds.
- RTP point estimate = mean of `totalHundredths / 100` per round. The 95% interval is the normal approximation on the per-round return (`mean ± 1.96 · s / √n`).
- Base and free-spin contributions are the cap-aware increments of `totalHundredthsAfter` per spin. Base hit frequency = base spins with any win (tumble or scatter) / rounds. Trigger frequency = rounds with `freeSpinsTriggered` / rounds.
- The report stores the sha256 of the `cascade.ts` bytes (independent of git), the paytable and every weight table. A change to any of them invalidates the evidence; rerun and publish a new engine id for new behavior.

## Tuning record
Weights and paytable were tuned with throwaway runs (about 4 x 1-4 M rounds each, different seeds from the evidence run): base-game symbol weights fix the hit frequency (about 26.5%) and the star weight fixes the trigger frequency (about 1 in 480). The free-spin table is richer than the base table (flatter toward the high symbols, plus crystals), because crystals alone could not lift the free-spin share enough. The paytable was scaled until the pooled estimate sat at about 96%. The evidence run uses a separate seed that was not used for tuning.

## Limits
- DEMO credits only. This is a Monte Carlo estimate of this engine's return, not a certified, audited or guaranteed RTP, and it says nothing about any real-money product.
- Heavy tail: the free-spin multiplier (sum of crystals up to 100x each) and the 5000x cap make the per-round standard deviation about 14 stakes. The normal-approximation interval is optimistic for such a distribution; rare large rounds (cap hits are about 1 in tens of millions) are barely sampled, so the true RTP may sit outside the printed interval.
- Counts of rare events (cap hits, 2000x+) are too small for statistical claims; they only show the branch is reachable.
- The estimate holds for the frozen tables of this engine id only. Stake size does not change the dealt cards; it changes the payout by `floor`, which the estimate (stake 100) cannot show for other stakes (for stake not multiple of 100, rounding down lowers the realised payout slightly).
- No claim is made about player behaviour, session length or volatility beyond the numbers in the JSON.
