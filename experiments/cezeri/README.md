# Cezeri (`cezeri-gears-1`) Monte Carlo

DEMO credits only. The numbers are Monte Carlo estimates of this engine, not a certified or guaranteed RTP.

Run (repo root, pinned Node wrapper):

```
bash scripts/use-node.sh node --import tsx experiments/cezeri/simulate.ts \
  --rounds 20000000 --seed cezeri-20261012-evidence \
  --out ops/evidence/cezeri-20261012/rtp.json --workers 4
```

- `--modes standard,ante,buy` limits the modes, `--workers N` sets the worker threads.
- `--tune <json>` overrides the engine tuning (`tables`, `paytable`, `gearPay`, `scatterPay`, `falconCount`, caps) for tuning runs only. The override is
  recorded in the output (`tuningOverride`); evidence runs never use it and a test checks that. Tuning seeds start with `cezeri-tune-`, the evidence
  seed is different.
- Round seeds come from per-worker xoshiro streams derived from `sha256(seed:mode:worker)`, so `(seed, rounds, workers, modes)` reproduces the numbers.
- RTP is return / COST (standard = bet, ante = 5/4 bet, buy = 100 bet). The 95% interval is a normal approximation on the per-round return and is
  optimistic for this heavy tail. Win tiers are round total / bet.
- `engineSourceSha256` is the sha256 of `packages/protocol/src/cezeri.ts` with the `CEZERI_RTP` evidence block removed (the constants are
  copied from the evidence after the run). `packages/protocol/test/cezeri.test.ts` checks the hash and that `CEZERI_RTP` equals the evidence.
- `make-strips.ts` regenerates the frozen ring strips from the symbol counts in its `SPEC` (deterministic). The engine does not call it; its output
  is pasted into `BASE_STRIPS`, `FREE_STRIPS` and `FREE_STRIPS_BUY`.

Tuning procedure used:

1. Base game: paytable scale and the base strips (8 pay symbols, 1 gear and 1 vessel per ring) were set so the base chain returns about 52% of the bet
   with a 28-29% hit rate.
2. Feature rate: the vessel stop weight (a "virtual reel" weight for the stops whose 12-slice window shows a vessel; every other stop weighs 100) is
   the knob, standard 24 (about 1 in 345), ante 30 (about 1 in 192).
3. Free spins: the free-spin hub draw weights are the intensity knob per mode (the carried hub ratchets, so the weight of the x10 draw matters most);
   buy mode additionally has one gear less per free ring. A buy-mode run is a cheap, low-noise way to measure the average free-spin win.
4. Every candidate was checked with `--tune` runs of 2-30 million rounds on tuning seeds; the evidence run uses a fresh seed and the shipped tables.
