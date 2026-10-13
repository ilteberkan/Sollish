# Ebru: Mürekkep Bahçesi (`ebru-ink-1`) Monte Carlo

DEMO credits only. The numbers are Monte Carlo estimates of this engine, not a certified or guaranteed RTP.

Run (repo root, pinned Node wrapper):

```
bash scripts/use-node.sh node --import tsx experiments/ebru/simulate.ts \
  --rounds 20000000 --seed ebru-20261012-evidence \
  --out ops/evidence/ebru-20261012/rtp.json --workers 4
```

- `--modes standard,ante,buy` limits the modes, `--workers N` sets the worker threads.
- `--tune <json>` overrides the engine tuning (`tables`, `paytable`, `scatterPay`, `amplitudes`, `rowSteps`, caps) for tuning runs only. The
  override is recorded in the output (`tuningOverride`); evidence runs never use it and a test checks that. Tuning seeds start with `ebru-tune-`,
  the evidence seed (`ebru-20261012-evidence`) is different.
- Round seeds come from per-worker xoshiro streams derived from `sha256(seed:mode:worker)`, so `(seed, rounds, workers, modes)` reproduces the numbers.
- The simulator plays the engine with `record = false` (no step objects, same RNG use); `ebru.test.ts` proves the totals and spin summaries equal the
  recorded rounds.
- RTP is return / COST (standard = bet, ante = 5/4 bet, buy = 100 bet). The 95% interval is a normal approximation on the per-round return and is
  optimistic for this heavy tail. Win tiers are round total / bet.
- `engineSourceSha256` is the sha256 of `packages/protocol/src/ebru.ts` with the `EBRU_RTP` evidence block removed (the constants are copied from the
  evidence after the run). `packages/protocol/test/ebru.test.ts` checks the hash and that `EBRU_RTP` equals the evidence.

Extra statistics in the evidence: `comb` (comb-created wins per spin, share of base hits that needed the comb, passes per spin), `tumbles`, and
`stains` (share of free-spin clusters crossing a stain, stained cells and highest stain at the end of the feature).

Tuning procedure used: eight inks (7x7 with six inks hit more than 50% of spins, eight give a ~28% hit rate). The paytable scale was set so the
base game returns about 49% of cost, the base comb weight sets the feature rate (standard 57, ante 72, about 1 in 325 and 1 in 172). The free-spin
table drains c8 and uses the weight of c7 as the intensity knob per mode (standard 108, ante 285, buy 495): fewer c7 means more same-colour
clusters, so the stains and the stain sums grow faster. A buy-mode run is a cheap, low-noise way to measure the average free-spin win of a free
table because its standard deviation is small.
