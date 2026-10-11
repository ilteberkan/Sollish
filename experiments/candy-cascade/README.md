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

# Candy Cascade v2 (`candy-cascade-2`) — three modes (DEMO only)

Engine `packages/protocol/src/cascade-2.ts`, spec `docs/product/candy-cascade-spec.md` ("Sürüm 2"). `candy-cascade-1` stays frozen (a regression test hashes 200 fixed v1 rounds).

```
bash scripts/use-node.sh node --import tsx experiments/candy-cascade/simulate-2.ts \
  --rounds 20000000 --seed candy-cascade-2-20261011-evidence \
  --out ops/evidence/candy-cascade-2-20261011/rtp.json [--modes standard,ante,buy] [--workers 4]
```
`--tune <json>` overrides tables for tuning runs only (for example `{"tables":{"ante":{"base":[...]}}}`); the override is written to the output and the evidence run does not use it.

## Modes, cost and tables
| Mode | Cost | Base-game table | Free-spin table | Extra rule |
|---|---|---|---|---|
| `standard` | bet | v1 (star 21) | v1 (crystal 100) | none; replays v1 spins for the same seed |
| `ante` | bet x 5/4 | v1 with star 26 (about 2.1x trigger rate) | v1 with crystal 47 | none |
| `buy` | bet x 100 | v1 (star 21) | v1 with crystal 21 | initial base grid forced to hold >= 4 stars |

Paytable, scatter pay, crystal value weights, cap (5000 x bet), 8+ pays, tumble and RNG are identical in all modes. Wins are always measured against the bet; RTP is measured against the cost. The free-spin intensity knob is the crystal weight (the weight of the multiplier carrier among the free-spin cells); the ante and buy values were tuned so that each mode returns about 96% of its own cost.

Buy guarantee (draw order is fixed): deal the 30 initial cells as usual, then while the grid holds fewer than 4 stars, list the non-star cells in column-major order, draw one u32, take index `floor(u32 * length / 2^32)` and turn that cell into a star (id kept). That is `4 - k` extra draws (`k` = natural stars). Stars never explode, so the base spin keeps >= 4 stars and always triggers 10 free spins; the 4/5/6+ scatter pay still applies.

## Method
- Each round is played with `__cascade2Test.play(seed, 100, mode)` (bet 100 cents, so `payoutCents` equals `totalHundredths`; the report cross-checks it). The production path `playCascade2Round` is the same code with the default tables.
- RTP = mean(`totalHundredths / 100`) / (cost in bets), 95% interval = normal approximation `mean +- 1.96 s / sqrt(n)` on the per-round return in cost units. Hit rate = base spins with any win (tumble or scatter) per round. Feature rate = rounds with `freeSpinsTriggered`.
- Seeds per worker: xoshiro128** state from `sha256("<seed>:<mode>:<worker>")`. Tuning runs used seeds `tune-a` ... `tune-h`; the evidence run uses `candy-cascade-2-20261011-evidence`.
- `engineSourceSha256` covers `cascade-2.ts` without the marked `CASCADE2_RTP` block (the constants are filled from the evidence); `engineSourceSha256AtRun` is the whole file at run time. A test fails if engine code changes after the evidence.

## Tuning record
Standard keeps the v1 tables (95.7%). Ante: star weight 21 -> 26 gives about 2.1x the trigger rate (21 -> 25 is 1.8x, 30 is 3.4x: the trigger rate is very star-sensitive); the doubled feature then returns too much against the 5/4 cost, so the ante free-spin crystal weight was lowered (100 -> 47, probes 44: 94.6%, 47: 95.8%, 50: 98.2%). Buy: with v1 free spins the bought feature returned about 188% of its cost; the crystal weight was lowered to 21 (20: 93.5%, 21: 96.1%, 23: 101%).

## Limits
- DEMO credits only; Monte Carlo estimates, not certified RTP. Heavy tail: the normal-approximation interval is optimistic, and rare large rounds are barely sampled.
- Every bet level is a whole number of credits, so `floor(bet * hundredths / 100)` never loses a cent; mode costs are exact integers because every level is divisible by 4.
- The estimates hold for the frozen tables of this engine id only. Buy hits the 5000 x bet cap (50 x its cost) in about 1 of 128,000 rounds; ante and standard almost never.
