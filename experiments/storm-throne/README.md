# Storm Throne (`storm-throne-1`) Monte Carlo

DEMO credits only. The numbers are Monte Carlo estimates of this engine, not a certified or guaranteed RTP.

Run (repo root, pinned Node wrapper):

```
bash scripts/use-node.sh node --import tsx experiments/storm-throne/simulate.ts \
  --rounds 20000000 --seed storm-throne-20261012-evidence \
  --out ops/evidence/storm-throne-20261012/rtp.json --workers 4
```

- `--modes standard,ante,buy` limits the modes, `--workers N` sets the worker threads.
- `--tune <json>` overrides the engine tuning (`tables`, `paytable`, `orbs`, `scatterPay`, caps) for tuning runs only. The override is recorded in
  the output (`tuningOverride`); evidence runs never use it and a test checks that. Tuning seeds start with `storm-tune-`, the evidence seed is different.
- Round seeds come from per-worker xoshiro streams derived from `sha256(seed:mode:worker)`, so `(seed, rounds, workers, modes)` reproduces the numbers.
- RTP is return / COST (standard = bet, ante = 5/4 bet, buy = 100 bet). The 95% interval is a normal approximation on the per-round return and is
  optimistic for this heavy tail. Win tiers are round total / bet.
- `engineSourceSha256` is the sha256 of `packages/protocol/src/storm-throne.ts` with the `STORM_RTP` evidence block removed (the constants are
  copied from the evidence after the run). `packages/protocol/test/storm-throne.test.ts` checks the hash and that `STORM_RTP` equals the evidence.

Tuning procedure used: the paytable scale and base weights were set so the base game returns about 59% of cost with a 26-27% hit rate; the
free-spin orb weight is the intensity knob per mode (standard 405, ante 303, buy 194 on a x10 scale). A buy-mode run is a cheap, low-noise way to
measure the average free-spin win of a free table because its standard deviation is small.
