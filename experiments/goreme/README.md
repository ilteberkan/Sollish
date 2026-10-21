# Göreme: Şafak Balonları (`goreme-balloons-1`) Monte Carlo

DEMO credits only. The numbers are Monte Carlo estimates of this engine, not a certified or guaranteed RTP.

Evidence runs (repo root, pinned Node wrapper), one mode per process so a crash or limit only touches one mode:

```
for m in standard ante buy; do
  nohup bash scripts/use-node.sh node --import tsx experiments/goreme/simulate.ts \
    --rounds <N> --seed goreme-20261021-evidence --modes $m --workers 2 --chunks <K> \
    --out ops/evidence/goreme-20261021/mode-$m.json >> ops/evidence/goreme-20261021/run.log 2>&1 &
done   # (or one after the other; at most 4 worker threads in total on the shared machine)
bash scripts/use-node.sh node --import tsx experiments/goreme/merge.ts --out ops/evidence/goreme-20261021/rtp.json \
  ops/evidence/goreme-20261021/mode-standard.json ops/evidence/goreme-20261021/mode-ante.json ops/evidence/goreme-20261021/mode-buy.json
```

The exact commands, round counts and chunk counts used are at the top of `ops/evidence/goreme-20261021/run.log`.

- Crash safety: `--chunks K` splits a mode into K independent sub-runs (seed `<seed>/c<k>`). After every chunk the raw counters are written
  atomically to `<out>.ckpt/` together with the engine hash, chunk seed and tuning. A restarted run with the same arguments loads the
  finished chunks and plays only the missing ones; a checkpoint of another engine, seed or tuning is refused.
  `merge.ts --partial <out>.ckpt --mode <m> --out <file>` builds an interim report (marked `partial`, never evidence) from whatever chunks exist.
- `--tune <json>` overrides the engine tuning (`tables`, `paytable`, `scatterAwards`, `windWeights`, caps) for tuning runs only. The
  override is recorded in the output (`tuningOverride`); evidence runs never use it and a test checks that. Tuning seeds start with
  `goreme-tune-`; the evidence seed is different.
- Round seeds come from per-worker xoshiro streams derived from `sha256(seed:mode:worker)`, so `(seed, rounds, workers, chunks, mode)` reproduces the numbers.
- RTP is return / COST (standard = bet, ante = 5/4 bet, buy = 100 bet). The 95% interval is a normal approximation on the per-round return
  and is optimistic for this heavy tail. Win tiers are round total / bet (10x ... 10 000x).
- `engineSourceSha256` is the sha256 of `packages/protocol/src/goreme.ts` with the `GOREME_RTP` evidence block removed (the constants are
  copied from the evidence after the run). `packages/protocol/test/goreme.test.ts` checks the hash and that `GOREME_RTP` equals the evidence.
- Besides RTP, hit rate (base spins with any win per round), feature rate, free spin counts, std deviation, contributions (first board,
  lift chain, scatter, free spins), win tiers and cap hits, the report holds: balloons landed, merges, exits, largest balloon multiplier and
  weighted way count seen, the lift chain (share of base spins with a lift, average chain length when lifting, histogram, wind shares) and
  the sky band (moorings, average and maximum final sky multiplier, distribution).

Tuning procedure used:
1. Paytable shape first (per-way pay in ten-thousandths of the bet), stack weight for the base hit rate (about 36%), then the balloon
   weights: balloons are very strong (they add to every symbol on their reel and grow on each lift), so the base balloon weight is small
   and the respin weight smaller. A base-only run (`{"maxFreeSpins":0}`) measures the base return (standard deviation about 5).
2. Base sun weights: standard and ante give a feature about every 250 and 125 rounds.
3. Free tables: the free-spin balloon weight is the knob per mode (the feature value grows about 2% per weight unit of 1/16 000).
   Buy-mode runs (standard deviation about 4 cost units) measure the average feature win of a free table cheaply.
   Required average free win A = (target return - base return) / feature probability, per mode.
