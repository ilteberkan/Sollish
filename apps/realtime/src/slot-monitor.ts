/** Global observed-RTP monitor for the slot service (one instance, "global"). Counters only: game, mode, rounds, cost,
 * payout, sum of squared costs, largest payout. No session, token, seed, IP or other personal data. Math: slot-stats.ts.
 */
import { DurableObject } from "cloudflare:workers";
import { slotGame } from "@sollish/protocol";
import { rtpMinRounds, slotErrorResponse, slotJson, type SlotEnv } from "./slots";
import { parseDeltas, rtpAlert, rtpDeviation, type StatDelta } from "./slot-stats";

type Row = { game: string; mode: string; rounds: number; cost: number; payout: number; cost_sq: number; max_payout: number; last_alert_at: number };
const ALERT_EVERY_MS = 10 * 60 * 1000;

/** One global instance ("global"). Receives batched counter deltas from SlotWallet alarms (never on the round path). */
export class SlotMonitor extends DurableObject<SlotEnv> {
  constructor(ctx: DurableObjectState, env: SlotEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS monitor_stats (game TEXT NOT NULL, mode TEXT NOT NULL, rounds INTEGER NOT NULL, cost INTEGER NOT NULL, payout INTEGER NOT NULL, cost_sq REAL NOT NULL, max_payout INTEGER NOT NULL, last_alert_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(game, mode))`);
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/stats") {
      const rows = this.ctx.storage.sql.exec<Row>("SELECT * FROM monitor_stats ORDER BY game, mode").toArray();
      return slotJson({ stats: rows.map(r => ({ game: r.game, mode: r.mode, rounds: r.rounds, costCents: r.cost, payoutCents: r.payout, maxPayoutCents: r.max_payout, observedRtp: r.cost > 0 ? r.payout / r.cost : null, z: rtpDeviation({ rounds: r.rounds, costCents: r.cost, payoutCents: r.payout, costSquares: r.cost_sq }, slotGame(r.game)?.rtp[r.mode] ?? { rtp: 0, stdDev: 0 })?.z ?? null })) });
    }
    if (path !== "/add" || request.method !== "POST") return slotErrorResponse("NOT_FOUND");
    let deltas: StatDelta[] | null = null;
    try { deltas = parseDeltas(await request.json()); } catch { /* fixed response */ }
    if (!deltas) return slotErrorResponse("INVALID_MESSAGE");
    const now = Date.now(), alerts: Record<string, unknown>[] = [];
    this.ctx.storage.transactionSync(() => {
      for (const d of deltas!) {
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
}
