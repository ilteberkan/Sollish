# NeuroBoxer — a learned fighter whose memory is a real fly connectome subgraph

4 October 2026. Non-monetary Combat Club engine (`sparring-4`). Not a whole fly brain, not
biological simulation, not consciousness, and not connected to wagers or payouts.

## What runs

| Stage | Implementation (`packages/protocol/src/neuro-boxer.ts`) |
|---|---|
| Perception | 22 values in [-1, 1] that a fighter can observe: distance, bearings, opponent movement/guard/strike phase and type, own stamina/health/concussion, opponent health, rope proximity, time since hits, round time, closing speed. Never wagers, balances, identities or future seeds. |
| Memory | 128 real MaleCNS v1.0 descending neurons, 4 949 directed edges (graph SHA256 `284dca2f…`, CC BY 4.0; FlyEM/HHMI Janelia, Cambridge, MRC LMB, Google Research). `h' = 0.65 h + 0.35 tanh(W_in [1, o] + W_graph h)`; anatomical `W_graph` is fixed (incoming weight per target normalised to 0.8, all positive: no validated excitatory/inhibitory signs). |
| Decision | Learned readout from `[1, o, h']` to three heads: movement (9 directions relative to the opponent), guard (on/off), command (none/jab/cross/hook/uppercut/slip/dash). |
| Action | Engine input every 4 ticks (15 Hz), held in between. Both corners decide on the same tick from the same snapshot. |
| Learning | Evolution strategies (antithetic, centred ranks, Adam) on the sensory projection and readout (5 662 parameters) from real bout outcomes: win, damage difference, knockdowns, minus a passivity penalty. Opponents: three scripted corners and frozen snapshots of the learner. |

The product uses seeded sampling (temperature 0.8) from the readout's softmax: every bout plays out
differently, yet replays exactly from the committed bout seed.

## Protocol

- Train seeds: random per generation (< 1e6). Validation: bout seeds 2000+, used only for logging and
  for choosing which connectome training seed ships. Final held-out bank: bout seeds 5000-5049 (both
  corners), run once after all training.
- Controls with the same budget and training seeds: `shuffled` (degree-preserving target permutation of
  the same edges, renormalised) and `norecur` (no recurrence: a feed-forward tanh layer of the same size).
- Three training seeds per architecture; baselines: random policy and relentless mixed aggression.

A first round used staggered decision ticks (corner 1 decided one tick after corner 0); in mirror bouts
corner 0 won 0/200. That information advantage was removed and every model was retrained
(`runs-staggered/` is kept as the historical record, not used).

```sh
bash scripts/use-node.sh node --import tsx experiments/neuro-boxer/train.ts connectome 300 1 5
bash scripts/use-node.sh node --import tsx experiments/neuro-boxer/evaluate.ts
bash scripts/use-node.sh node --import tsx experiments/neuro-boxer/export.ts
```

## Results (held-out bout seeds 5000-5049, both corners; `evidence-heldout.json`)

| Architecture (3 training seeds each) | Score vs the three scripted corners | Technique entropy | Clean hits / bout |
|---|---|---|---|
| Connectome (real MaleCNS graph) | 0.991 ± 0.016 | 1.01 bits | 24.3 |
| Shuffled graph (degree-preserving control) | 1.000 ± 0.000 | 1.20 bits | 23.6 |
| No recurrence (feed-forward control) | 0.971 ± 0.051 | 1.23 bits | 25.0 |
| Random policy / relentless aggression (baselines) | 0.00-0.02 / 0.00-0.24 | — | — |

Head-to-head between matching training seeds: connectome vs shuffled 0.50, connectome vs no-recurrence
0.33, no-recurrence vs shuffled 0.00.

**Conclusions.** Learning is real: trained controllers beat the scripted corners almost every bout while
the baselines almost never do. **An advantage of the real connectome topology is not shown**: all three
architectures saturate against the scripted corners and the round robin does not favour the connectome.
The scripted corners are too weak to discriminate architectures; a stronger, held-out opponent pool is the
next requirement before any architectural claim.

**Shipped model.** Connectome training seed 1 (best validation score; chosen without the held-out bank),
theta SHA256 `8cde29cd…`. Mirror bouts (same model in both corners, seeded sampling, 3×45 s): KO share
0.23, mean bout 144 s, 199 distinct outcomes in 200; corner balance over 600 bouts: KOR 0.505 (z = 0.24).

**Limits.** The connectome controllers favour jab/cross (≈1 bit entropy); the action space is high level
(no learned joint torques or balance); bout outcomes in the engine are mostly deterministic apart from the
committed seed's sampling; this is a 128-node subgraph with assumed dynamics, not a fly brain.

## NeuroBoxer v2 (`neuro-2`) — a learned strategist picks a fighting style during the bout

4–5 October 2026. Same non-monetary Combat Club, now engine `sparring-5` (capsule body contact; unpublished).
neuro-1 above is byte-frozen and stays selectable ("Sinek beyni v1"); old neuro-1 bouts are never re-run with v2.

| Stage | Implementation (`packages/protocol/src/neuro-boxer-2.ts`) |
|---|---|
| Perception (40 values) | neuro-1's 22 values; 12 strategic values: scorecard margin (`s.scores`), round progress, both knockdown counts, this round's judged damage margin, the opponent's stamina in 4 visible buckets, and six opponent-tendency EMAs: jab share of its punches, its punch rate, the share of my contacts it blocks, its velocity toward me, its slip/dash rate and its counter hits per punch I throw. The EMAs read only each tick's public `s.events` plus the opponent's visible velocity/action, every tick (counts and breaks included), each tick once. Then the committed style as a 6-way one-hot. Never wagers, balances, identities, seeds or future ticks (a proxy test fails on any other field read). |
| Memory | The same 128-node MaleCNS v1.0 subgraph and dynamics as neuro-1 (graph SHA256 `284dca2f…`). |
| Strategist head | Style logits = `Ws·[1, 12 strategic, h]` (846 parameters), evaluated at round start, after a knockdown/getup and every 45 decisions (3 s). Sampled with a hash of (bout seed, tick, side), so replay is exact. Hysteresis: a style is held ≥ 3 s and replaced only when the candidate's probability beats it by ≥ 0.15. An externally committed style (TypeSafe Jev, fallback rule or cache, from the decision log) is used from the tick it is passed; the head is still evaluated for display and never overrides it. |
| Tactical brain | neuro-1's architecture with 40 inputs (8 290 parameters): movement, guard and command heads, decisions every 4 ticks on the shared grid. |
| Explanation | The panel's three reasons rank `(w_style − mean_w)·input` over the strategic inputs, the bias and the 128-node memory as one aggregate. This is an approximate logit attribution, not reasoning. |

**Training** (`train-style.ts`; same ES estimator as neuro-1: 24 antithetic pairs, σ 0.04, centred ranks, Adam, weight decay 0.005; sampling temperature 0.8 as in the product):

- **Curriculum (pre-contact engine):** 125 generations of stage A per run on the frozen `sparring-4` engine (`experiments/combat-sparring-audit/baseline-sparring-4.ts`, SHA256 `aac72f4d…`, behaviour-identical to pre-contact `sparring-5`). connectome-s1 ran on the live pre-contact file (`39a867c5…`) with an earlier body term (body-hit share only) and uses its own generation-125 snapshot. This happened while the contact engine was still being written.
- **Stage A (final engine):** tactical weights only. Every candidate fights all six styles (style fixed per bout, 3 × 20 s); fitness = outcome + 0.5 × that style's shaping term: pressure (forward ratio, opponent on the ropes, punch rate), counter (counter hits per opponent punch and per own punch), cautious (1 − damage taken), outboxer (landed jabs, time at 0.95–1.6 m, jab share), body (body-hit share + close-range hook/uppercut share, because `sparring-5` has no aimed body punch) and finisher (damage dealt into a hurt or dazed opponent).
- **Stage B:** strategist only (`Ws`), tactics frozen; 3-round bouts (3 × 30 s), outcome fitness only (no style bonus).
- **Stage C:** everything at learning rate 0.01; half the bouts strategist-driven (outcome only), half style-locked with shaping so the six behaviours stay distinct.
- **Opponents:** the three scripted corners, experiment-only cautious and outboxer scripts (`baselines.ts`), frozen neuro-1, and this run's league snapshots (style-locked from A, strategist-driven from B/C; 30 % of bouts in A, 50 % in B/C).
- **Seeds:** train < 1e6 (random per generation); validation 2000+ (logging and choosing the shipped seed); held-out 5000–5049 and 6000–6099 in both corners and mirror bouts 7000–7599, used once by `evaluate-style.ts`. Two snapshots of a separate training seed (connectome-s101, stage-A and final) are evaluation-only opponents that no model trained against.

**Run actually executed.** Six runs: connectome seeds 1–3, the evaluation-only connectome seed 101, and one seed each of the shuffled and no-recurrence controls. Final engine `sparring-5`: `combat-sparring.ts` `b5e3a11c…`, `combat-capsules.ts` `9e02ecab…` (contact marker 17:50Z). Recipe: stage A 30, stage B 40, stage C 30 generations (connectome-s101: A 30, B 20, no C). The capsule engine costs about 4× more per tick than `sparring-4`, so B/C and the validation bouts use 3 × 30 s rounds; all evaluation uses the product format (3 × 45 s, 8 s breaks). Training ran 22:25–23:40Z, evaluation 23:40–00:17Z (36 420 bouts). Both used 4 worker threads, local CPU only, no rendering, from pinned copies of these files that were byte-identical to the repo's. The live `combat-sparring.ts` later changed to `c1ca71f9…` in referee code only; fighters and events stay identical over 8 bouts / 69 504 ticks with the final model.

## neuro-2 results (held-out banks, both corners, sampling 0.8; `evidence-style.json`)

| Model | 6 fixed opponents* | vs held-out style-locked | vs held-out strategist | Switches / round | Style time share |
|---|---|---|---|---|---|
| connectome-s1 | 1.000 | 0.543 | 0.578 | 3.30 | counter 62 %, body 17 %, cautious 12 % |
| connectome-s2 | 1.000 | 0.980 | 0.993 | 3.01 | pressure 71 %, cautious 23 % |
| connectome-s3 (shipped) | 1.000 | 0.998 | 0.998 | 0.22 | pressure 98.5 % |
| shuffled-s1 | 0.537 | 0.000 | 0.000 | 2.92 | outboxer 68 % |
| norecur-s1 | 1.000 | 0.235 | 0.052 | 0.24 | body 98 % |

\*Scripted balanced/pressure/counter, the cautious/outboxer scripts and frozen neuro-1; 300 bouts per opponent. Score = win 1, draw ½. The median completed hold is 6 s (s1, s2) and 3 s (s3). No tracker gaps occurred.

**Ablations** (opponents: neuro-1 and both held-out snapshots, 900 bouts per condition, paired by opponent/seed/corner; strategist minus ablation, 95 % CI):

| Seed | Strategist | Best fixed style (picked on held-out) | Random switching | Authored rule strategist | Tendency inputs zeroed |
|---|---|---|---|---|---|
| s1 | 0.707 | body 0.772: −0.065 [−0.094, −0.036] | 0.642: +0.066 [0.036, 0.095] | 0.651: +0.056 [0.027, 0.085] | 0.696: +0.012 [−0.005, 0.028] |
| s2 | 0.991 | body 0.999: −0.008 [−0.013, −0.003] | 0.996: −0.005 [−0.010, 0.000] | 0.987: +0.004 [−0.002, 0.011] | 0.991: 0.000 |
| s3 | 0.999 | pressure 0.999: 0.000 | 0.994: +0.005 [0.001, 0.009] | 0.999: 0.000 | 0.999: 0.000 |

**Style behaviour.** A classifier predicts the fixed style from six signatures: mean distance, punch rate, guard rate, forward ratio, body share and counter-hit share. It trains on 5000–5049 and tests on 6000–6099 (3 600 test bouts per seed). Nearest-centroid accuracy is 0.35 / 0.32 / 0.46 and logistic 0.50 / 0.36 / 0.67 for s1 / s2 / s3; chance is 0.167. Styles are distinguishable, but not all of them match their names:
- Body share is 0 in every style. `sparring-5` has no aimed body punch and the close-range term stayed near 0, so "Gövdeci" never acquired its intended behaviour.
- On s3, "Temkinli" moves forward more often than "Baskıcı".

**Mirror bouts** of the shipped model (600, seeds 7000–7599): KOR 47 wins, AYAZ 39, draws 514; corner z = 0.86, so no corner bias was detected. KO share is 0, the mean bout lasts 151 s and there were 218 distinct outcomes.

**Conclusions.**
- Learning against the fixed pool is real (every connectome seed scores 1.000), but that pool is saturated in every style, as it was for neuro-1.
- **The learned strategist does not beat the best single fixed style** picked on the same bouts (s1 −0.065, s2 −0.008, s3 0.000). It beats random switching and the authored rule only on s1, the one seed whose evaluation was not saturated. Zeroing the six tendency inputs changes nothing measurable. There is no evidence that choosing a style during the bout improves results; the head behaves like a learned, mostly fixed preference with some state-dependent switching.
- **A connectome advantage is not shown.** The connectome scores 0.962 over 3 seeds against 0.403 for shuffled and 0.786 for no-recurrence, but each control has only one seed. The shuffled seed was already weak after the curriculum (validation 0.79 against ≥ 0.94 for the others), and neuro-1's three-seed comparison found no advantage.
- The held-out opponents (seed 101) had less training than seeds 2 and 3, which saturate against them as well. A stronger held-out opponent is still needed.
- The shipped model, chosen on validation, almost always fights "Baskıcı" (0.22 switches per round), so the panel will mostly show one style. s1 and s2 switch about 3 times per round. Mirror bouts end in a points draw 86 % of the time, which is a risk for the default v2-vs-v2 bout.

**Product model (coordinator decision, 5 October).** The default Combat Club bout puts neuro-2 in both corners, so mirror behaviour decides whether the bout is watchable. A separate check (`mirror-product.ts`, 60 mirror bouts per model, seed bank 9000–9059, product format; `evidence-mirror-product.json`) showed that s2 and s3 almost never attack each other: no attack in round 1 in 93 % / 72 % of bouts, 0.2 / 2.1 hits per bout, 98 % / 82 % draws. s1 attacks from the first tick (85 round-1 attacks, 47.6 hits per bout, 3 % draws, about 10 style switches per corner per bout); neuro-1's mirror is the reference (71 hits, 30 % KO). The product therefore ships **s1** (theta `d1e8f30d…`), not the validation-rule pick s3. This is a spectator criterion chosen after the held-out results were known, not a performance claim; s1 is weaker than s2/s3 against the held-out snapshots (0.543 / 0.578), and no neuro-2 mirror bout ended in a KO.

**Limits.**
- A 128-node subgraph is not a fly brain.
- The style label is a learned latent choice, not reasoning or consciousness.
- The panel's attribution is approximate.
- The training budget was cut to fit the slower engine.
- The curriculum ran on the behaviour-identical pre-contact engine, not on the final engine.
- Evaluation is local Node simulation: not a browser, production build or hosted run.

```sh
# curriculum (pinned sparring-4 copy), then final engine, evaluation and export
node --import tsx experiments/neuro-boxer/train-style.ts connectome 2 125,0,0 4 experiments/neuro-boxer/runs-v2/curriculum-precontact/connectome-s2
node --import tsx experiments/neuro-boxer/train-style.ts connectome 2 30,40,30 4 experiments/neuro-boxer/runs-v2/connectome-s2 experiments/neuro-boxer/runs-v2/curriculum-precontact/connectome-s2/stageA.json
node --import tsx experiments/neuro-boxer/evaluate-style.ts --workers 4
node --import tsx experiments/neuro-boxer/mirror-product.ts s1 9000 60   # spectator check per model (s1, s2, s3, v1)
node --import tsx experiments/neuro-boxer/export-style.ts experiments/neuro-boxer/runs-v2/connectome-s1 --note "…"   # product pick (s3 was the validation-rule pick)
```
League checkpoints (36 files, 25 MB) were moved out of the repository; their SHA256 values are listed in `runs-v2/league-checkpoints.sha256`.
