# Bounded local Ringside load experiments

These experiments use real workerd, SQLite, WebSockets, CSPRNG and the frozen Contact v3 implementation. They do not send load to a public endpoint, deploy a service, override the clock/seed, add wallets or transfer assets. Credits are the existing resettable DEMO ledger.

From the repository root, run **sequentially**, while other CPU-heavy tasks are stopped:

```sh
node --import tsx experiments/load/contact-rooms.mjs
node --import tsx experiments/load/single-round-fanout.mjs
node --import tsx --test experiments/load/public-delta.test.ts
node --import tsx experiments/load/single-round-delta.mjs
```

The first command attempts 1,120 bettors across **five independent** existing rooms, 224 connections each. It also checks same-ID retry, reconnect, cutoff rejection and the final ledger, even if the admission target is missed. `ADMISSION_TARGET_NOT_MET_LEDGER_VERIFIED` is deliberately not a throughput success. The retained first-burst evidence stopped after the admission miss and therefore does **not** verify settlement.

The second command connects **1,000 spectators to one shared round**, with 64 private bettors and one internal relay session. Four public fanout objects receive only strictly validated public snapshots from the unchanged single ledger. Spectators cannot create a financial session, place a bet, issue a financial ACK, or change a balance. The read-only denial is checked against actual SQL aggregates. The ledger's `online` field retains its original meaning; the relay does not fabricate it into an audience count.

The delta comparison uses the same 1,000-spectator/64-bettor topology, with a separate relay that coalesces public updates to at most four flushes per second. A first connection/resync gets a full snapshot; later messages carry a sequence/base sequence and changed public fields. Twenty clients deliberately discard one delta; the next gap must request and receive a full snapshot before continuing. This is a client-consumer fault injection, not packet-loss or server-restart proof. Five small reducer tests cover private/malformed fields, invalid conservation/clock state, stale/conflicting sequence and resync.

Ports **18889/18890/18891** are pinned to `127.0.0.1`; occupied ports are rejected. Each run creates a unique `.tooling/load/<name>-<timestamp>` directory, only starts its own child process and removes only that run's SQLite state after shutdown. Generated configuration/source remain for inspection. Runtime wall timer, bounded client counts, traffic/frame limits and memory sampling limit the experiment. A detected resource bound fails the target; it is not an infrastructure autoscaler. The SSH capacity inspection was read-only; no remote installation or load was performed.

Reports in [`evidence/`](evidence/) include source SHA256, generated worker entry SHA256, machine/runtime identity, timings, traffic and SQL conservation. Both pass and failed-target reports are retained. `sourceHashes` must match the checkout before reusing a report. The JSON artifacts are the authoritative measurements; [the report](../../docs/load-validation.md) explains their limits.

## Experimental fanout boundaries

`public-fanout-worker.ts` is **not in a production binding or route**. Its relay subscribes to one anonymous DEMO session and discards private frames; only a binding RPC forwards public snapshots to read-only spectator objects. There is no external publish route. The relay requests a fresh snapshot every five seconds; a fanout without a fresh source for 15 seconds rejects new connections/sync. It does not promise instant failure notification to an already connected, idle viewer.

This is a measured architecture slice, not a production-ready fanout library. Before promotion: persist/rebuild snapshot state across hibernation and restart, exercise source/relay/bucket failures, authenticate/rate-limit viewer admission, audit privacy, implement audience count semantics and run hosted multi-region soak tests with a cost budget. The delta relay bounds pending source state to one coalesced snapshot; a production restart still needs a persisted sequence/epoch so restarting sequence numbers cannot conflict with surviving fanout state. This restart case is explicitly unimplemented. The relay's outgoing socket/alarm activity is not assumed free or hibernatable. A transport shard must never become a second financial writer.

The 1,000-viewer result does **not** establish 1,000 bettors in one round. Existing per-ledger 256-ticket/256-socket/512-session limits remain unchanged. The burst result demonstrates that merely adding rooms on the same local runtime does not eliminate the current admission/broadcast bottleneck. No test changes real-asset release gates.
