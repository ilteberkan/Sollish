# Combat Club mechanics audit — sparring-1 → sparring-2

Date: 4 October 2026. Scope: the **non-monetary** `/lab/ringside/play` engine
(`packages/protocol/src/combat-sparring.ts`). No wagers, wallets, LIVE rounds or accepted
tickets use this engine. Frozen LIVE sources (`combat-v3.ts`, `connectome-policy.ts`,
`ringside.ts`, `pari-mutuel.ts`, realtime arena) were not changed; their hashes still match
the prior release evidence.

## Method

`audit.ts` runs real fixed-step 60 Hz rollouts (90 s bouts, every seed played from both
corners) of an engine module against scripted probe strategies:

| Probe | What it tests |
|---|---|
| `runner` | Never attacks; backs away and circles toward the ring centre — "win by running" |
| `hitAndRun` | Balanced bot until ahead by 40 health, then runs for the clock |
| `kickSpam` / `jabSpam` | One technique at every legal opportunity |
| `balanced` / `pressure` / `counter` | The engine's own scripted bots |

Metrics: score (win 1, draw 0.5), KO share, clean hits per bout, technique share,
**limb depth inside the opponent's declared hurt spheres every tick** (head r 0.16 m, chest
r 0.24 m; glove 0.095 m, foot 0.12 m), longest no-contact gap, bout duration, share of
fighter-time below 180 stamina.

`baseline-sparring-1.ts` is a byte-identical frozen copy of the shipped engine
(SHA256 `5396da65…58dd1`, the same hash recorded in
`ops/evidence/ringside-sparring-20261003.json`).

```sh
bash scripts/use-node.sh node --import tsx experiments/combat-sparring-audit/audit.ts baseline 24 1
bash scripts/use-node.sh node --import tsx experiments/combat-sparring-audit/audit.ts candidate 48 1001
```

Seeds 1–24 were used while tuning sparring-2. Seeds 1001–1048 were run **once** afterwards
with no further rule or bot change (`evidence/*-heldout-1001-48seeds.json`).

## Reproduced failures (sparring-1, held-out seeds 1001–1048)

| Failure | Measurement |
|---|---|
| Contact passes through the body | After a hit the limb continued to full reach: depth p95 **14.3–18.3 cm**, max 21.4 cm |
| Fight ends by retreating | `runner` vs every bot: **0 contacts in 90 s**, draw; `hitAndRun` scored **0.68** |
| Single-technique exploit | `jabSpam` scored **0.865–0.885**; bots spent 94 % of fighter-time below 180 stamina (1 488 guard breaks in a 12-seed sample) |
| Kick dominance | **Not reproduced** in this engine: `kickSpam` scored 0.000. The constant-kick exploit belongs to the separate self-play research environment and is still open there |

Root causes found in code: the strike pose never knew it had landed; backward walking was as
fast as forward walking and the attack step-in was only ~3 cm, so a retreating fighter left
range during every startup; a blocked strike cost the defender 65 % of the attacker's cost
**and** restarted the regeneration delay, so guarding under pressure was a death spiral.

## sparring-2 changes

Engine (new version id, nothing migrated):

- `strikeStop`: on contact the limb stops at the struck surface (bisection against the
  curved strike path); afterwards, a defender walking into a retracting limb shortens it
  instead of overlapping. Non-damaging; one damage event per attack is unchanged.
- Directional footwork: forward 1.85, lateral 1.45, backward 1.10 m/s (guard ×0.42).
- Per-attack step-in during startup (jab 0.13, cross 0.09, hook/uppercut 0.05, kick 0.07 m).
- Block costs the defender 40 % of the strike cost and pauses regeneration 12 ticks (was 65 % + full 24-tick reset).
- Damage scaled (jab 36, cross 56, hook 62, uppercut 60, roundhouse 76) and regeneration 3/tick so bouts are not decided in ~12 s.
- Scripted bots: punish whiffed/blocked recovery, guard only against a visible threat when tired, keep a stamina reserve and work footwork instead of throwing into exhaustion. **Still scripted, not learned.**

Presentation (no authority): hook hip/torso rotation so the rendered glove reaches the
engine target (gap 7.8–10.4 cm → ≤ 2.4 cm); measured skin bounds (0.26 m) replace a 0.53 m
camera padding; lower/closer broadcast camera; three-quarter chase camera; side-rope cutaway;
taller desktop stage (370 → 468 px at 1280×720) by moving the toolbar into the heading.

## Results (held-out seeds 1001–1048, 96 bouts per row)

| Matchup (A vs B) | sparring-1 A score | sparring-2 A score | sparring-2 depth p95 / max (cm) | sparring-2 median bout (s) |
|---|---|---|---|---|
| balanced vs pressure | 0.547 | 0.604 | 0.2 / 0.2 | 59.9 |
| balanced vs counter | 0.609 | 0.417 | 0.2 / 0.2 | 90 (KO 22 %) |
| runner vs pressure | 0.500 (0 contacts) | **0.000** (KO 95 %) | 0.2 / 0.2 | 54.1 |
| hitAndRun vs balanced | 0.677 | **0.188** | 0.2 / 0.2 | 90 |
| jabSpam vs balanced | 0.865 | **0.000** | 0.2 / 0.2 | 53.3 |
| kickSpam vs balanced | 0.000 | 0.000 | 0.2 / 0.2 | 28.8 |

0.2 cm is the bisection tolerance. Full tables: `evidence/`.

## Limits

- Depth is measured against **declared spheres**, not triangle meshes, arms or legs.
- Probes are the same strategies used while tuning; only the seeds are held out. A human
  player or a learned adversary may find new exploits. No human playtest has been run.
- Bots remain scripted heuristics. This is not the learned Energy6 policy, the frozen LIVE
  imitation model or a physics-based motor.
- Character art/animation quality (Quaternius rig, authored + procedural clips) is unchanged
  and remains an open acceptance item.

## sparring-5 (5 October 2026): capsule contact and referee steering

`baseline-sparring-4.ts` is the byte-identical frozen sparring-4 engine (SHA256 `aac72f4d…693e`); sparring-4
evidence replays against it. sparring-5 is unpublished.

- **Contact** (`contact-audit.ts`, `audit-sparring5.ts`): trunk/head/thigh capsule overlap 14.1–14.4 cm → 0 over
  200 seeded bot bouts; guarded glove ≤ 0.005 m; anti-exploit probes hold on held-out seeds 1001–1048 (runner,
  jab spam, kick spam 0; hit-and-run 0.302/0.255, was 0.188/0.115). `audit.ts`'s penetration column still
  measures the old sparring-4 spheres. Evidence: `evidence/contact-*`, `evidence/sparring5-*`,
  `ops/evidence/ringside-sparring-contact-20261004/`.
- **Referee** (`referee-audit.ts`, frozen `referee-sparring4.ts` / `referee-motion-sparring4.ts`): over 60 bouts
  the fighters, events and winners are identical to the old official; clearance, no-crossing and motion limits
  pass; real-scene foot slide per step 2.51 cm max (FAIL, < 2 cm). Evidence: `evidence/referee-*`,
  `ops/evidence/ringside-referee-20261004/`.
- **Integrated real-scene check** on the production build: `sparring5-final-capture.mjs` →
  `ops/evidence/ringside-sparring5-20261005/report.json`.
