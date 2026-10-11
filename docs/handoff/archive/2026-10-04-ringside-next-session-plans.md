# Ringside — yeni oturum için uygulama planları (4 Ekim 2026)

Bu planlar salt-okunur paralel incelemelerle (4 ajan) üretildi; kod değiştirilmedi. Yeni oturum her maddeyi ölçüm → değişiklik → test → gerçek sahne zinciriyle uygulamalı.

## Layered capsule contact: a deterministic engine body model and a renderer-only penetration resolver
_Layered capsule contact: a deterministic engine body model and a renderer-only penetration resolver_

**Kök nedenler / mevcut durum**
- combat-sparring.ts:232 constrain() only keeps the two pelvis roots 0.78 m apart (BODY_DISTANCE, line 67). It ignores facing, torso lean and the arms.
- HURT_ZONES (line 248) has only two spheres per fighter, head r0.16 and chest r0.24. limbDepth() and retractFromBody() test only the striking glove, so forearms, elbows and the guard glove never collide with anything.
- In boxing-mixamo-athletes.ts updateFighter(), the clip pelvis tracks (LOWER_TRACK) carry roughly 0.2-0.3 m of hip travel in cross, hook and hit_* clips. settle() smooths the pelvis but never clamps it, and contact IK (around lines 207-228) solves only the striking hand. The guard IK at line 196 aims at the engine pose, which knows nothing about the opponent.
- The knockdown and knockout falls are authored clips. lyingBodyPoint() assumes the body falls backward, but nothing stops a fall clip from landing on the other fighter.

**Değişecek dosyalar**
- /Users/macmini/Desktop/Sollish/packages/protocol/src/combat-capsules.ts (new)
- /Users/macmini/Desktop/Sollish/packages/protocol/src/combat-sparring.ts
- /Users/macmini/Desktop/Sollish/apps/web/components/boxing-contact-resolver.ts (new)
- /Users/macmini/Desktop/Sollish/apps/web/components/boxing-mixamo-athletes.ts
- /Users/macmini/Desktop/Sollish/apps/web/components/boxing-sparring-scene.tsx
- /Users/macmini/Desktop/Sollish/packages/protocol/test/combat-sparring.test.ts
- /Users/macmini/Desktop/Sollish/scripts/boxing-assets/mixamo-contact.test.ts (new, run the same way as test-fightkit-replay.mjs)

**Adımlar**
- Engine (bump to sparring-5; tickets accepted under sparring-4 keep their rules). In combat-capsules.ts, write sparringCapsules(pose), which builds capsules from sparringPose points:
- torso: pelvis to chest, r0.17
- head: r0.12
- upper arm: shoulder to elbow, r0.06
- forearm: elbow to glove, r0.055
- glove: sphere r0.095
- thigh: hip to knee, r0.08
Add segSegDistance(), using deterministic closest points between two segments.
- In constrain(), keep the root test as a cheap broadphase. Then compute the deepest torso, head or thigh capsule overlap against the other fighter and push the roots apart along its normal, splitting the move with the existing wall-room logic. Iterate at most 3 times. Arms are left out of root separation.
- Replace HURT_ZONES with head and torso capsules, and extend sweep() to swept-sphere-vs-capsule. Add guard capsules (both forearms and gloves): a strike that meets them first counts as blocked and calls settleAtSurface() there. For limbDepth(), take the maximum over all opponent capsules, so retractFromBody() also stops on forearms.
- During a count, separate against the lying body: add a pelvis-to-head capsule along lyingBodyPoint's axis, r0.18.
- Renderer, new boxing-contact-resolver.ts. Build per-bone capsules from the actual skinned rig at scale 1.05: spine_01 to Head r0.16, Head r0.11, upperarm r0.055, lowerarm r0.05, hand plus glove r0.09, thigh r0.085, calf r0.06. Fit each radius as the 90th-percentile vertex distance among vertices whose skin weight is above 0.5, and freeze the fitted values in a JSON file.
- resolveContacts(rigA, rigB) runs after IK and settle(), every frame:
- (a) Add a root-level visual offset along the torso-overlap normal, clamped to 0.12 m and eased over 80 ms. It applies to source.root only and never writes engine state.
- (b) For an offending arm, solveLimb() to its closest out-of-contact point, with the pole away from the opponent. The striking glove instead stops on the guard or forearm surface.
- (c) For the legs, rotate the thigh at most 10 degrees.
- (d) Remove pelvis-track forward travel toward the opponent beyond 0.05 m.
- In the scene, extend the ?probe=1 data with maxPenetration per frame and the worst pair of bones.

**Testler ve kabul**
- Protocol test: over 200 seeded bot bouts at every tick, the maximum torso, head or thigh capsule overlap is at most 0.002 m, the guard stops the glove (glove-to-forearm overlap at most 0.005 m), and replay is byte-identical.
- GLB CPU test, using the real Mixamo GLB with hashes checked and 3 full bouts sampled at 120 Hz with alpha steps of 0.25:
- torso-to-torso: at most 0.010 m
- arm-to-torso: at most 0.015 m
- glove-to-glove or glove-to-forearm: at most 0.020 m
- leg-to-leg: at most 0.015 m
- a falling body over the standing fighter: 0
- the resolver's root offset is at most 0.12 m, and engine state hashes are unchanged with the resolver on and off.
- Write an evidence JSON with the scope stated as 'CPU skin; not GPU or browser'.

**Riskler ve sınırlar**
- The capsule radii above are estimates from engine values and the measured 0.24 m skin allowance. They must be refit from the actual vertex weights.
- Changing the engine changes results, so it needs a new rules version, re-run ES training and evaluation for neuro-boxer, and no silent migration of existing tickets.
- The renderer resolver can make limbs look stiff in the clinch. Reviewers should check desktop and mobile visuals; passing tests are not proof that the scene looks right.
- Mixamo clips are authored; the resolver adds procedural corrections on top. Neither is motion capture of a real contact, and the UI should say so.

## NeuroBoxer v2: a learned strategist that picks a fighting style, feeding the existing tactical brain
_NeuroBoxer v2: a learned strategist that picks a fighting style, feeding the existing tactical brain_

**Kök nedenler / mevcut durum**
- neuro-boxer.ts:38-69 neuroObserve gives only 22 inputs about the current tick. Nothing in it summarises how the opponent has been fighting, the scorecards (s.scores), the round number or knockdowns, so the brain has nothing to base a style choice on.
- neuroStep:72-91 has a single flat readout with three heads (move, guard, command) and no style head. env.ts:45 uses one fitness for every bout, so the shipped model collapses onto jab/cross (README reports about 1 bit of technique entropy).
- train.ts only ever fights the three sparringBotInput styles plus copies of itself. These opponents are too weak to reward adapting (README says every architecture already beats them).

**Değişecek dosyalar**
- /Users/macmini/Desktop/Sollish/packages/protocol/src/neuro-boxer.ts
- /Users/macmini/Desktop/Sollish/packages/protocol/test/neuro-boxer.test.ts
- /Users/macmini/Desktop/Sollish/experiments/neuro-boxer/env.ts
- /Users/macmini/Desktop/Sollish/experiments/neuro-boxer/baselines.ts
- /Users/macmini/Desktop/Sollish/experiments/neuro-boxer/train-style.ts (new)
- /Users/macmini/Desktop/Sollish/experiments/neuro-boxer/evaluate-style.ts (new)
- /Users/macmini/Desktop/Sollish/experiments/neuro-boxer/export.ts
- /Users/macmini/Desktop/Sollish/apps/web/components/neuro-thinking-panel.tsx
- /Users/macmini/Desktop/Sollish/apps/web/components/boxing-sparring.tsx
- /Users/macmini/Desktop/Sollish/experiments/neuro-boxer/README.md

**Adımlar**
- neuro-boxer.ts: add NEURO_STYLES = [counter, pressure, cautious, volume, body, finisher] and a new version, neuro-2. Keep neuro-1 and its theta exactly as they are; export.ts writes a separate model module. Extend NeuroMemory with a tendency tracker and the current style, its probabilities and how long it has been held.
- Add neuroTrack(s, side, mem), called every tick before the decision gate at line 103. It reads only the public s.events and keeps exponential moving averages of what the opponent does: jab share vs power-punch share, guard rate, forward-pressure rate, slip/dash rate, and its rate of counter hits on us.
- Add 12 strategic observations (NEURO_OBS goes from 22 to 40 with the 6-value style one-hot): the scorecard margin from s.scores, the round number, both fighters' knockdown counts, this round's damage margin as judged (roundDamage), the opponent's visible fatigue (bucketed op.stamina), plus the 6 tendency EMAs. No wager, balance, identity or seed values.
- Add a strategist head to neuroStep: style logits = Ws·[1, strategic obs, h]. It is evaluated only at roundstart, after a knockdown or getup, or every 45 decisions. Sample it with hashUnit(seed, tick, side, 4) for exact replay. Hysteresis: hold a style for at least 3 s, and switch only when the new style beats the current one by at least 0.15 in probability.
- Feed the chosen style's one-hot into the tactical inW/outW alongside the existing observations, so the tactical brain plays differently for each style.
- train-style.ts, stage A: train the tactical brain with a fixed random style per bout. Fitness = outcome plus that style's shaping term: counter = counter hits / attacks taken; pressure = closing distance + share of time the opponent is on the ropes; cautious = −damage taken; volume = jab rate; body = share of hits landing on the body; finisher = damage dealt while the opponent is dazed or below 30% health.
- Stage B: freeze the tactical weights and train only Ws over 3-round bouts with outcome fitness and no style bonus.
- Stage C: fine-tune everything together at learning rate 0.01.
- Opponent pool (baselines.ts + env.ts Opponent type): the 3 sparringBotInput styles, new experiment-only cautious and volume policies, the frozen neuro-1 shipped model, and snapshots of each style-locked brain. Two extra snapshots, taken from a separate training seed and never trained against, are reserved for evaluation only.
- neuroThought returns the current style, the style probabilities and the top 3 reasons, ranked by weight×input attribution on the strategic inputs and mapped to labels (e.g. behind on cards, opponent tiring, opponent counters a lot).
- neuro-thinking-panel.tsx shows a character badge, how long the style has been held, the probability bars and those reasons, labelled 'learned strategist head; attribution is approximate'. boxing-sparring.tsx: memories already reset; add a version check before loading the model.
- TypeSafe/Jev (experiments/decision-agent): offline evaluation baseline only. It answers a 6-option choice at round breaks from a perceivable summary. It is disabled by default, never in the product or replay path, and has no tool or transaction authority.

**Testler ve kabul**
- neuro-boxer.test.ts: the same seed replays identically, both corners included. A guard test sets the observation buffer while wagers or balances exist in context and checks the length is 40 with only allowed keys. Style hysteresis respects the minimum hold. Tendency EMAs are computed only from events up to the current tick.
- evaluate-style.ts on held-out bout seeds 5000-5049 and 6000-6099, both corners, run once after training: win rate against the scripted bots, neuro-1, and the held-out snapshots.
- Style-switch metrics: switches per round and how long each style is held.
- Behaviour signatures per style: mean distance, attack rate, guard rate, forward ratio, body share, counter-hit share. A classifier must predict the style from these well above chance (1/6).
- Ablations: best single fixed style; random switching; a scripted rule-based strategist; the strategist with tendency inputs zeroed; shuffled-graph and no-recurrence controls.
- Mirror-bout corner balance z-test over 600 bouts.
- Record all theta and graph SHA256 hashes in evidence-style.json.

**Riskler ve sınırlar**
- ES with roughly 9k parameters may never learn to switch; it could settle on one dominant style. Report that honestly if the ablations show no gain.
- Shaping terms can reward a style's look over winning; stage B exists to remove that bias.
- The style label is a learned latent choice, not reasoning or consciousness, and attribution only approximates why a style was picked.
- Old accepted matches and neuro-1 replays must keep using the neuro-1 model; never re-run them with v2.
- A 128-node subgraph is not a fly brain, and an advantage from the real connectome over the shuffled control is still unproven.

## Jev style layer: fighters pick a style at set points in the bout, the choice is logged, replay stays deterministic
_Jev style layer: fighters pick a style at set points in the bout, the choice is logged, replay stays deterministic_

**Kök nedenler / mevcut durum**
- What exists: experiments/decision-agent/typesafe-client.mjs is a Node-only adapter that is off by default. It is pinned to POST https://api.typesafe.ai/v1/systemone with model jev-1.13.0, allows one call at a time, cuts off at 1500ms, caps replies at 16KiB, and only accepts a 6-action choice. Its 16 offline tests use a mocked transport. Nothing in apps/ or packages/ imports it.
- No real API call has ever been made: evidence/offline-validation.json records authenticatedProviderRequests:0 and latencyBenchmark NOT_RUN. The only TypeSafe request was an anonymous fetch of the public OpenAPI file. TYPESAFE_API_KEY appears only in the experiment.
- There is no style concept during a bout. neuroInput (neuro-boxer.ts:99-115) has no style input. The fixed-rule styles in sparringBotInput (combat-sparring.ts:486) are picked once in the UI (boxing-sparring.tsx:83). No log records decisions.

**Değişecek dosyalar**
- /Users/macmini/Desktop/Sollish/packages/protocol/src/fight-style.ts (new)
- /Users/macmini/Desktop/Sollish/packages/protocol/src/neuro-boxer.ts
- /Users/macmini/Desktop/Sollish/experiments/decision-agent/typesafe-client.mjs (+ new style-client.mjs)
- /Users/macmini/Desktop/Sollish/apps/web/app/api/ringside/style/route.ts (new, runtime nodejs) or apps/worker
- /Users/macmini/Desktop/Sollish/apps/web/components/boxing-sparring.tsx
- /Users/macmini/Desktop/Sollish/experiments/neuro-boxer/env.ts, train.ts (phase 2)

**Adımlar**
- fight-style.ts: define a closed list STYLES = pressure | counter | cautious | outboxer | balanced. Add styleObservation(state, side), built only from public match state: both fighters' health, stamina and knockdowns, round number, scores, and a count of the opponent's last 30 attack/block/dodge events. It must not include the seed, any future tick, wagers or identities. Add fallbackStyle(obs), a pure deterministic rule. Add the type StyleDecision = {side, requestTick, applyTick, style, source: jev | fallback | cache, model, confidence, obsHash}.
- Decision points: at each roundend, with applyTick set to the next roundstart (the 8 s break covers the 1.5 s deadline), plus every 900 ticks mid-round with applyTick = requestTick + 120. When the sim reaches applyTick it waits for the decision, which always settles within the deadline as either a Jev answer or the fallback. Waiting affects presentation only. The result then depends only on (seed, decision log), never on how fast the network was.
- neuro-boxer.ts: give neuroInput an optional style argument, applied at lines 104-108 as a fixed logit bias per style before sampling. Do not change how hashUnit draws from the seed. Label this bias as authored modulation, not learning.
- Generalize parseDecision/decisionRequest so the choice list is a parameter. Add styleRequest that asks one choice question over STYLES. Raise maxRequests to cover about 12 calls per bout.
- Server route: exact-key schema, rate limiting, logs only sanitized codes. The key lives only in server env (TYPESAFE_API_KEY, e.g. /etc/sollish/worker.env), never under NEXT_PUBLIC_ and never in the browser.
- boxing-sparring.tsx: put the decision log next to the seed, replay from it without network calls, and show each corner's style with a source badge. The static demo uses fallback plus a cached JSON table with source hashes; Jev is used only when the route is enabled.
- Phase 2: a separately trained style-conditioned version, neuro-boxer-v2 (NEURO_OBS 22 plus a style one-hot), with per-style fitness in env.ts:45 and held-out evidence.

**Testler ve kabul**
- Protocol: replaying the same (seed, log) gives an identical event list and winner; a delayed vs instant Jev answer with the same choice gives the same result; a timeout commits fallbackStyle.
- Adapter: offline tests with network blocked for the style schema, rejection of extra fields, and argmax.
- Grep check that the build output contains no TYPESAFE string.

**Riskler ve sınırlar**
- A live bout's outcome depends on whether Jev answered, not on how fast; replay stays exact only through the committed log.
- The style bias is an authored overlay, not learning, until the phase 2 training has evidence.
- Latency, cost, account authorization and decision quality are still unmeasured. A real call needs the user's key and explicit opt-in.
- Jev picks only the style label: it gets no authority over transactions, tools or the result.

## Referee motion: smooth engine steering and gait-matched rendering
_Referee motion: smooth engine steering and gait-matched rendering_

**Kök nedenler / mevcut durum**
- combat-sparring.ts:392-394. Clearance is a 0.9 m circle around each root. That ignores a fighter's body and skin (about 0.26 m), the referee's own radius (about 0.25 m), punch reach (0.64-0.88 m) and the lying body, which lyingBodyPoint puts up to 1.85 m behind the root. When the referee gets too close, the code moves him straight to the edge of the circle in one tick, which looks like a teleport.
- Side choice (lines 386-387). The referee switches sides whenever pz>0, and the |pz|<.2 hysteresis never applies. When the fighters rotate, his target jumps about 3.4 m to the other side and he walks straight between them.
- Steering. He moves at a constant 1.7 m/s with no acceleration, so he starts and stops instantly. Facing is recomputed with atan2 every tick with no turn-rate limit.
- boxing-mixamo-athletes.ts:239-249. Facing is applied straight from the engine, and position is extrapolated using a vx that includes the teleport pushes. The forward Walk_Formal_Loop (in place, 1.333 s cycle) plays at a fixed 0.9 rate whatever the speed, even when he moves sideways or backwards. The walk/idle blend is on/off, and the Mixamo strafe and walk-back clips are never added to the referee rig (line 72 skips it with `continue`).
- The referee is not included in cast.bounds, so camera framing can cut him off.

**Değişecek dosyalar**
- /Users/macmini/Desktop/Sollish/packages/protocol/src/combat-sparring.ts
- /Users/macmini/Desktop/Sollish/apps/web/components/boxing-mixamo-athletes.ts
- /Users/macmini/Desktop/Sollish/apps/web/components/boxing-mocap-athletes.ts
- /Users/macmini/Desktop/Sollish/packages/protocol/test/combat-sparring.test.ts

**Adımlar**
- Engine (rewrite updateReferee). Add a tick-based state referee.side (+1/-1) and flip it only when the current side has been blocked for 30 or more ticks. Never flip when the path would cross the segment between the fighters; go around the outside on an arc of radius 1.9 m or more. Keep him away from fighters with a smooth repulsion force instead of a push to the edge: a 1.25 m capsule from pelvis to front hand while standing, and 0.75 m from lyingBodyPoint for a downed fighter. Limit acceleration to 4 m/s^2 and speed to 1.4 m/s. Limit turning to 3 rad/s and keep a dead zone of 0.05 rad.
- Versioning. This changes SparringState, so either bump SPARRING_VERSION to sparring-5 or keep the old path behind a version check. Existing sparring-4 tapes must keep replaying the same way. Use integer or tick-based logic only; never Math.random.
- Renderer, boxing-mixamo-athletes.ts line 72. Before the `continue`, add mx_strafe_left, mx_strafe_right and mx_walk_back to the referee mixer (same Quaternius bones). Strip root and pelvis horizontal translation so the clips stay in place.
- Renderer, updateReferee. Interpolate between the previous and current state (prevState from the scene) instead of extrapolating from vx. Slerp the facing. Split the velocity into forward and lateral parts relative to the referee's facing and blend Walk_Formal_Loop, the two strafes, walk_back and Idle_Loop, as locomotion() already does for the fighters.
- Gait timing. Keep a gait phase that advances each frame by speed / strideLength(clip), with stride length measured from foot-bone forward-and-back travel at load. Drive the blend weights with smooth((speed-.05)/.5). Add an exponential pose settle with a time constant of about 0.12 s.
- Bounds and port. Add the referee's bones to the camera bounds. Mirror the renderer changes in boxing-mocap-athletes.ts:263-273.
- Optional. Add a count gesture: an arm overlay on each `count` event, plus a step-in when breaking a clinch.

**Testler ve kabul**
- Engine, 20 seeds, full bot bouts: on every tick, the distance from the referee root to every fighter capsule segment is at least 0.55 m, and to every lying-body segment at least 0.6 m.
- Engine: the referee never crosses the segment between the fighters while fighting. Yaw changes by at most 0.05 rad per tick, position by at most 0.025 m per tick, and speed by at most 4/60 m/s per tick.
- Engine: replaying a committed seed gives an identical final state, and sparring-4 fixtures still pass.
- Renderer probe (local runtime evidence, labelled as such): the referee root moves at most 0.03 m per rendered frame. Foot slide, meaning a planted foot (height under 3 cm) moving horizontally, stays under 2 cm per step and averages under 0.5 cm per frame.
- Visual check on desktop and mobile: referee meshes never intersect the fighters' bounding boxes.

**Riskler ve sınırlar**
- Changing referee steering changes state hashes, so a version bump is required. Replay and the fixture harness must handle both versions.
- Stride length has to be measured from the retargeted clips. The Mixamo strafes are generic male clips scaled to the 65-bone rig and may need a speed-to-rate table.
- The capsule repulsion is presentation-only and must stay that way. Fighters never react to the referee, and results and payouts are unaffected.
- The 'cuts' may also come from fighters hiding the referee from the +z broadcast camera. Moving him to the side with clearance at least 1.9 m helps, but the shot still needs visual review.
