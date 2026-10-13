# Asena: Yildiz Kurdu (`asena-stars-1`) Monte Carlo

DEMO credits only. The numbers are Monte Carlo estimates of this engine, not a certified or guaranteed RTP.

Run (repo root, pinned Node wrapper):

```
bash scripts/use-node.sh node --import tsx experiments/asena/simulate.ts \
  --rounds 20000000 --seed asena-20261012-evidence \
  --out ops/evidence/asena-20261012/rtp.json --workers 4
```

- `--modes standard,ante,buy` limits the modes, `--workers N` sets the worker threads.
- `--tune <json>` overrides the engine tuning (`tables`, `paytable`, `templateMultipliers`, `mapMultipliers`, `scatterPay`, caps) for tuning runs only.
  The override is recorded in the output (`tuningOverride`); evidence runs never use it and a test checks that. Tuning seeds start with `asena-tune-`;
  the evidence seed is different.
- Round seeds come from per-worker xoshiro streams derived from `sha256(seed:mode:worker)`, so `(seed, rounds, workers, modes)` reproduces the numbers.
- RTP is return / COST (standard = bet, ante = 5/4 bet, buy = 80 bet). The 95% interval is a normal approximation on the per-round return and is
  optimistic for this heavy tail. Win tiers are round total / bet.
- `engineSourceSha256` is the sha256 of `packages/protocol/src/asena.ts` with the `ASENA_RTP` evidence block removed (the constants are copied from
  the evidence after the run). `packages/protocol/test/asena.test.ts` checks the hash and that `ASENA_RTP` equals the evidence.
- Besides RTP, hit rate (base spins with any win per round), feature rate, free spin counts, std deviation, win tiers (>= 10 / 25 / 50 / 100 / 500 /
  1000 / 2000 / 5000 x bet) and cap hits, the report holds: ignitions per constellation (per cluster, per base spin, per free spin), wolf walk
  statistics (walks per spin, trail wilds, longest wolf path) and the Ergenekon map statistics (distinct constellations at the end of a feature,
  final global multiplier histogram, free spins granted by moons and by the map).

Tuning procedure used (the RTP is very sensitive to the wolf weight, so every weight is written in hundredths of a base unit):
1. Base game: symbol weights give a base spin hit rate of about 25%; the base wolf weight is the intensity knob (a base-only run, `maxFreeSpins: 0`,
   measures the base return, the trigger probability and its standard error at a fraction of the cost of a full round).
2. Moon weights: standard 640 and ante 830 (base game) give a feature about every 320 and 175 rounds.
3. Free spins: a more clustered table (fewer effective symbols) lights the constellations; the wolf weight in the free table is the knob per mode.
   A buy-mode run is a cheap, low-noise way to measure the average free-spin win of a free table (a standard deviation of about 2.5 cost units).
   Required average free win A = (target return - base return) / feature probability, per mode.
