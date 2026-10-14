# Cezeri (`cezeri-gears-1`) Monte Carlo

DEMO credits only. The numbers are Monte Carlo estimates of this engine, not a certified or guaranteed RTP.

Run (repo root, pinned Node wrapper). The evidence driver runs every mode in its own process, writes `ops/evidence/cezeri-20261012/parts/rtp-<mode>.json` as soon as a
mode finishes, skips modes whose part is already current for the engine sha (delete the part to force a rerun) and merges the parts into `rtp.json`:

```
bash scripts/use-node.sh node --import tsx experiments/cezeri/run-evidence.ts --rounds 20000000 --seed cezeri-20261012-evidence --workers 2
```

A single run of `simulate.ts` (any mode subset, also used for tuning):

```
bash scripts/use-node.sh node --import tsx experiments/cezeri/simulate.ts \
  --rounds 20000000 --seed cezeri-20261012-evidence --out <path> --modes standard --workers 2
```

- `--tune <json>` overrides the engine tuning (`tables` incl. `respin`, `paytable`, `gearPay`, `scatterPay`, `falconCount`, `maxRespins`, caps) for tuning runs only. The override is
  recorded in the output (`tuningOverride`); evidence runs never use it and a test checks that. Tuning seeds start with `cezeri-tune-`, the evidence
  seed is different.
- Round seeds come from per-worker xoshiro streams derived from `sha256(seed:mode:worker)`, so `(seed, rounds, workers, modes)` reproduces the numbers.
- RTP is return / COST (standard = bet, ante = 5/4 bet, buy = 100 bet). The 95% interval is a normal approximation on the per-round return and is
  optimistic for this heavy tail. Win tiers are round total / bet.
- `engineSourceSha256` is the sha256 of `packages/protocol/src/cezeri.ts` with the `CEZERI_RTP` evidence block removed (the constants are
  copied from the evidence after the run). `packages/protocol/test/cezeri.test.ts` checks the hash and that `CEZERI_RTP` equals the evidence.
- `make-strips.ts` regenerates the frozen ring strips from the symbol counts in its `SPEC` (deterministic). The engine does not call it; its output
  is pasted into `BASE_STRIPS`, `RESPIN_STRIPS` and `FREE_STRIPS`.
- The output also reports the chain length: `respinChain` has the rotation histogram, average respins per winning base chain, the share of chains with
  3+ / 5+ respins and the number of chains ended by the 10-respin cap.

Tuning procedure used (rule: winning slices are held, all four rings re-spin, hub +1 per respin, up to 10 respins, runs from ring 0 or ring 1):

1. Chain length: with runs from ring 0 only, one respin in three continued (1.6 respins per winning chain) and the first-rotation hit rate was 28.7%. Runs
   from ring 0 or ring 1 raise both, so the first-rotation strips carry no gears (hit rate 29.5%) and the base-game respins turn on separate strips with one
   gear per ring; that lifts the average to about 2.06 respins per winning chain with 7.5% of chains running 5+ respins and about 0.1% reaching the cap.
2. Base game: the paytable scale was set so the base chain returns about 53% of the bet.
3. Feature rate: the vessel stop weight (a "virtual reel" weight for the stops whose 12-slice window shows a vessel; every other stop weighs 100) is
   the knob, standard 22 (about 1 in 320), ante 28 (about 1 in 170).
4. Free spins: the carried hub climbs by every respin of every winning free spin, so the free vessel stop (retriggers) and the hub draw weights are the
   knobs per mode (free vessel stop standard 23, ante 21, buy 19). A buy-mode run is a cheap, low-noise way to measure the average free-spin win.
5. Every candidate was checked with `--tune` runs of 1-30 million rounds on tuning seeds; the evidence run uses a fresh seed and the shipped tables.
