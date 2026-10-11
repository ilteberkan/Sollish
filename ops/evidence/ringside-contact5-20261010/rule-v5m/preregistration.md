# Rule v5m pre-registration (10 Oct 2026)

Written before any v5m checkpoint was trained or evaluated (only a pipeline smoke of 40 training bouts, 12 balance bouts and 4 evaluation bouts on
validation seeds `val7`/`smokem*`; none of it used test seeds). Nothing below is changed after a test-seed result is seen.

## Why
Rule v5k (engine ringside-contact-5-989b2917) failed its pre-registered test: learning minus frozen margin -1.8 (95% interval -19 to 15). Two causes
are addressed, nothing else: (1) every round started from the frozen checkpoint, so whatever was learned in round 1 was lost; (2) the learner saw
no model of the opponent beyond the current exchange.

## What changes
- Cross-round carry. The learner state at the end of round k (readout, critic, fast weights) and the opponent model below are the starting state of
  round k+1 of the same bout. The carry is a pure function of rounds 1..k (seed, opening state, plan log): `replay.carry`, `carryHash`,
  `replayContactV5(..., carry)`, threaded by `verifyMatchHistory` and the arena. Round 1 has none. The reservoir state restarts from rest each round.
- Observable inputs (25 new, total 73): round of the bout (1-3, as -1/0/1); an opponent model built from what the opponent actually chose - decayed
  frequencies of straight, hook, upper, body punch, low kick, body/head kick, teep, knee and clinch (decay 0.1 per choice), its reactions after my
  wind-up (slip, roll, guard; decay 0.25), its strike success rate (decay 0.15); lessons: for each of my 11 techniques (hits - failures)/(hits + failures + 2)
  against this opponent. Round time left, opponent health and stamina already existed. The model is kept for the whole bout.
- Independence: the two brains share nothing; a test replays one corner's recorded decisions through a script and shows the other learner, its fast
  weights and its opponent model unchanged.
- Training and evaluation use whole bouts (up to three rounds, stoppage ends it, opening state carried), checkpoints are trained from zero weights.
  In-match rule unchanged: actor 1, critic 0.05, fast 2, fastInputs 0, entropy 0.03.

## Hypotheses
- H1 (primary): with the same frozen checkpoint, in-match learning with carry beats its non-learning copy against learned held-out opponents over whole bouts.
  The frozen copy never changes weights but sees the same inputs (its opponent model fills the same way); the difference is weight learning within and across rounds.
- H2 (secondary): the same comparison against the scripted held-out styles (`switcher`, `bodySnatcher`, `slipper`, `mover`).
- H3 (secondary): learning from the trained checkpoint beats learning from zero weights (`untrainedLearning`).
- H4 (descriptive): MaleCNS reservoir vs the shuffled-graph control.
- E1 (exploratory, no claim): does the learner's advantage over its frozen copy grow from round 1 to round 3? Reported per round with paired intervals and as
  (round 3 - round 1) difference of (learning - frozen) round margin, on bouts where both arms played both rounds.

## Primary criterion
H1 is claimed only if the paired bootstrap 95% interval (2000 resamples, resampling seed 99, as in `eval.ts`) of (learning - frozen) bout margin
(sum of round point margins), pooled over the learned opponents (`mirrorFrozen`, `rule-v5m/heldout-a`, `rule-v5m/heldout-b`), has a lower bound above 0.
No hyperparameter is selected on these results. If H1 fails, product text says in-match learning is not shown for v5m. H2, H3, H4, E1 never gate the claim.

## Data
- Test seeds: `test7:<opponent>:<0..199>:r<round>` (new set, registered in `common.ts`, never used before), 200 bouts per arm and opponent, sides alternating.
- Lifetime training: main and shuffled-control 4000 bouts (tag `v5mmain`; actor 0.1, critic 0.05, fast 0.5, entropy 0.1); heldout-a 2000 bouts (`v5mheldoutA`; 0.2, 0.1, 1, 0.05);
  heldout-b 2000 bouts (`v5mheldoutB`; 0.05, 0.025, 0, 0.15). A bout is up to three rounds, so the round counts equal rule v5k.
- Training pool: `TRAIN` scripts + self; `HELD_OUT` styles never appear in training.
- Probe/validation tags (`probe*`, `smoke*`, `val7`) may be used before the run to debug and to set strike numbers; the engine hash at the start of the full run is
  recorded with the results and not changed afterwards.

## Balance band (live engine, both corners learning with carry, fallback plans, `balance:0..299` bouts)
Either side wins 40-60 % of bouts (draws count half), 40-65 strikes per round, kicks and knees 15-35 % of strikes, knockdowns in 15-35 % of rounds (all measured over every
round played; per-round values are reported), every punch, kick and the knee used at least once. A miss does not change the test; it is reported and the product ships only if it is fixed with a new engine id.

## Limits
Scripted opponents are not human fighters. A passing H1 means the learning rule plus memory helps against these opponents under these seeds, not that the connectome adds anything (H4)
and not that it is a mind or a brain. Carry makes round 2 and 3 depend on round 1: a bout is one unit, and rounds within a bout are not independent samples.
