/** Observed-RTP monitor for the slot service. Counters only: game, mode, rounds, cost, payout, sum of squared costs, largest
 * payout. No session, token, seed, IP or other personal data. Math: slot-stats.ts.
 *
 * Two roles of the same class (docs/architecture/scale.md "SlotMonitor"):
 *  - "global" (one instance): POST /add merges deltas into the cumulative table and raises the 4-sigma alert; GET /stats.
 *  - "shard:<k>" (SLOT_MONITOR_SHARDS instances): POST /shard/add only accumulates pending deltas from the sessions mapped
 *    to it and, by alarm every SLOT_MONITOR_ROLLUP_MS, pushes one merged batch to "global". So "global" takes about
 *    shards / rollup-interval requests per second however many sessions play, instead of one per active session.
 * Both hops are at least once (a lost acknowledgement can count a batch twice). Nothing here is on the round path and
 * nothing here can change a result, a balance or a payout.
 */
import { DurableObject } from "cloudflare:workers";
import { slotGame } from "@sollish/protocol";
import { rtpMinRounds, slotErrorResponse, slotJson, type SlotEnv } from "./slots";
import { MONITOR_GLOBAL, monitorRollupMs, parseDeltas, rtpAlert, rtpDeviation, type StatDelta } from "./slot-stats";

type Row = { game: string; mode: string; rounds: number; cost: number; payout: number; cost_sq: number; max_payout: number; last_alert_at: number };
type Pending = { game: string; mode: string; rounds: number; cost: number; payout: number; cost_sq: number; max_payout: number };
const ALERT_EVERY_MS = 10 * 60 * 1000;

export class SlotMonitor extends DurableObject<SlotEnv> {
  private shardReady = false;
  constructor(ctx: DurableObjectState, env: SlotEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS monitor_stats (game TEXT NOT NULL, mode TEXT NOT NULL, rounds INTEGER NOT NULL, cost INTEGER NOT NULL, payout INTEGER NOT NULL, cost_sq REAL NOT NULL, max_payout INTEGER NOT NULL, last_alert_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(game, mode))`);
  }
  private shardTable(): void {
    if (this.shardReady) return;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS monitor_pending (game TEXT NOT NULL, mode TEXT NOT NULL, rounds INTEGER NOT NULL, cost INTEGER NOT NULL, payout INTEGER NOT NULL, cost_sq REAL NOT NULL, max_payout INTEGER NOT NULL, PRIMARY KEY(game, mode))`);
    this.shardReady = true;
  }
  private async readDeltas(request: Request): Promise<StatDelta[] | null> {
    try { return parseDeltas(await request.json()); } catch { return null; }
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/stats") {
      const rows = this.ctx.storage.sql.exec<Row>("SELECT * FROM monitor_stats ORDER BY game, mode").toArray();
      return slotJson({ stats: rows.map(r => ({ game: r.game, mode: r.mode, rounds: r.rounds, costCents: r.cost, payoutCents: r.payout, maxPayoutCents: r.max_payout, observedRtp: r.cost > 0 ? r.payout / r.cost : null, z: rtpDeviation({ rounds: r.rounds, costCents: r.cost, payoutCents: r.payout, costSquares: r.cost_sq }, slotGame(r.game)?.rtp[r.mode] ?? { rtp: 0, stdDev: 0 })?.z ?? null })) });
    }
    if (request.method !== "POST") return slotErrorResponse("NOT_FOUND");
    if (path === "/shard/add") return this.shardAdd(request);
    if (path !== "/add") return slotErrorResponse("NOT_FOUND");
    const deltas = await this.readDeltas(request);
    if (!deltas) return slotErrorResponse("INVALID_MESSAGE");
    const now = Date.now(), alerts: Record<string, unknown>[] = [];
    this.ctx.storage.transactionSync(() => {
      for (const d of deltas) {
        // Sums are added inside SQLite (64-bit integers), not in JavaScript doubles.
        this.ctx.storage.sql.exec(`INSERT INTO monitor_stats(game,mode,rounds,cost,payout,cost_sq,max_payout) VALUES(?,?,?,?,?,?,?) ON CONFLICT(game,mode) DO UPDATE SET rounds=rounds+excluded.rounds, cost=cost+excluded.cost, payout=payout+excluded.payout, cost_sq=cost_sq+excluded.cost_sq, max_payout=MAX(max_payout, excluded.max_payout)`, d.game, d.mode, d.rounds, d.cost, d.payout, d.costSq, d.maxPayout);
        const row = this.ctx.storage.sql.exec<Row>("SELECT * FROM monitor_stats WHERE game=? AND mode=?", d.game, d.mode).one();
        const alert = now - row.last_alert_at >= ALERT_EVERY_MS ? rtpAlert("global", row.game, row.mode, { rounds: row.rounds, costCents: row.cost, payoutCents: row.payout, costSquares: row.cost_sq }, rtpMinRounds(this.env)) : null;
        if (alert) { alerts.push(alert); this.ctx.storage.sql.exec("UPDATE monitor_stats SET last_alert_at=? WHERE game=? AND mode=?", now, d.game, d.mode); }
      }
    });
    for (const alert of alerts) console.warn(JSON.stringify(alert));
    return slotJson({ accepted: deltas.length });
  }

  /* ---------------------------------------------------------------- shard role */
  private async shardAdd(request: Request): Promise<Response> {
    const deltas = await this.readDeltas(request);
    if (!deltas) return slotErrorResponse("INVALID_MESSAGE");
    this.shardTable();
    this.ctx.storage.transactionSync(() => {
      for (const d of deltas) this.ctx.storage.sql.exec(`INSERT INTO monitor_pending(game,mode,rounds,cost,payout,cost_sq,max_payout) VALUES(?,?,?,?,?,?,?) ON CONFLICT(game,mode) DO UPDATE SET rounds=rounds+excluded.rounds, cost=cost+excluded.cost, payout=payout+excluded.payout, cost_sq=cost_sq+excluded.cost_sq, max_payout=MAX(max_payout, excluded.max_payout)`, d.game, d.mode, d.rounds, d.cost, d.payout, d.costSq, d.maxPayout);
    });
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + monitorRollupMs(this.env));
    return slotJson({ accepted: deltas.length });
  }
  /** Shard rollup: one merged batch to "global"; on failure the deltas stay pending and the alarm retries. */
  async alarm(): Promise<void> {
    if (!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='monitor_pending'").toArray().length) return;
    this.shardReady = true;
    const rows = this.ctx.storage.sql.exec<Pending>("SELECT * FROM monitor_pending WHERE rounds > 0").toArray();
    if (!rows.length) return;
    const deltas: StatDelta[] = rows.map(r => ({ game: r.game, mode: r.mode, rounds: r.rounds, cost: r.cost, payout: r.payout, costSq: r.cost_sq, maxPayout: r.max_payout }));
    const monitor = this.env.SLOT_MONITOR;
    let ok = false;
    try { ok = !!monitor && (await monitor.get(monitor.idFromName(MONITOR_GLOBAL)).fetch("https://slot-monitor.internal/add", { method: "POST", body: JSON.stringify({ deltas }) })).ok; } catch { ok = false; }
    if (ok) {
      // Subtract what was sent; sessions may have added more while the request was in flight.
      this.ctx.storage.transactionSync(() => {
        for (const d of deltas) this.ctx.storage.sql.exec(`UPDATE monitor_pending SET rounds=rounds-?, cost=cost-?, payout=payout-?, cost_sq=MAX(0, cost_sq-?), max_payout=CASE WHEN rounds-?<=0 THEN 0 ELSE max_payout END WHERE game=? AND mode=?`, d.rounds, d.cost, d.payout, d.costSq, d.rounds, d.game, d.mode);
        this.ctx.storage.sql.exec("DELETE FROM monitor_pending WHERE rounds <= 0");
      });
    }
    const left = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM monitor_pending").one().n;
    if (left > 0) await this.ctx.storage.setAlarm(Date.now() + monitorRollupMs(this.env));
  }
}
