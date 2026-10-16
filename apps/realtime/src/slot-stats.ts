/** Pure observed-RTP arithmetic for the slot service (no Durable Object imports, unit-testable in Node).
 *
 * Deviation: with per-round return r_i = payout_i / cost_i, expected mean `rtp` and standard deviation `stdDev` (cost
 * units, from the engine's simulation evidence), the total payout P over costs c_i has E[P] = rtp * sum(c) and
 * Var[P] = stdDev^2 * sum(c^2). z = (P - rtp * sum(c)) / (stdDev * sqrt(sum(c^2))). A |z| >= 4 after at least
 * SLOT_RTP_MIN_ROUNDS rounds writes one JSON log line. The normal approximation is optimistic for these heavy tails: a
 * single very large win can trip it; it is an alarm for a human, never an automatic action on a result or payout.
 * Counters only: no session, token, seed, IP or other personal data.
 */
import { slotGame } from "@sollish/protocol";
import { SLOT_LIMITS, type SlotEnv } from "./slots";

export interface RtpTotals { rounds: number; costCents: number; payoutCents: number; costSquares: number }
export interface RtpDeviation { observedRtp: number; expectedRtp: number; z: number }

export function rtpDeviation(totals: RtpTotals, expected: { rtp: number; stdDev: number }): RtpDeviation | null {
  if (!(totals.rounds > 0 && totals.costCents > 0 && totals.costSquares > 0 && expected.stdDev > 0)) return null;
  const z = (totals.payoutCents - expected.rtp * totals.costCents) / (expected.stdDev * Math.sqrt(totals.costSquares));
  return Number.isFinite(z) ? { observedRtp: totals.payoutCents / totals.costCents, expectedRtp: expected.rtp, z } : null;
}
/** The log record, or null when no alert is due. */
export function rtpAlert(scope: "global" | "session", game: string, mode: string, totals: RtpTotals, minRounds: number, sigma = SLOT_LIMITS.rtpAlertSigma): Record<string, unknown> | null {
  const expected = slotGame(game)?.rtp[mode];
  if (!expected || totals.rounds < minRounds) return null;
  const d = rtpDeviation(totals, expected);
  if (!d || Math.abs(d.z) < sigma) return null;
  return { event: "slot_rtp_deviation", scope, game, mode, rounds: totals.rounds, costCents: totals.costCents, payoutCents: totals.payoutCents, observedRtp: Number(d.observedRtp.toFixed(4)), expectedRtp: d.expectedRtp, z: Number(d.z.toFixed(2)), sigma };
}

export interface StatDelta { game: string; mode: string; rounds: number; cost: number; payout: number; costSq: number; maxPayout: number }
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
export function parseDeltas(value: unknown): StatDelta[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { deltas?: unknown }).deltas)) return null;
  const list = (value as { deltas: unknown[] }).deltas;
  if (list.length > 64) return null;
  const out: StatDelta[] = [];
  for (const raw of list) {
    const d = raw as Record<string, unknown>;
    if (!d || typeof d !== "object" || typeof d.game !== "string" || typeof d.mode !== "string" || !slotGame(d.game)?.modes.includes(d.mode)) return null;
    if (!isCount(d.rounds) || !isCount(d.cost) || !isCount(d.payout) || !isCount(d.maxPayout) || typeof d.costSq !== "number" || !Number.isFinite(d.costSq) || d.costSq < 0) return null;
    out.push({ game: d.game, mode: d.mode, rounds: d.rounds, cost: d.cost, payout: d.payout, costSq: d.costSq, maxPayout: d.maxPayout });
  }
  return out;
}

/* ---------------------------------------------------------------- monitor sharding (docs/architecture/scale.md) */
// Two levels so no single object takes one request per active session: SlotWallet -> "shard:<k>" (every
// SLOT_MONITOR_FLUSH_MS while it has new rounds) -> "global" (every SLOT_MONITOR_ROLLUP_MS while the shard holds deltas).
// At-least-once at both hops (a lost acknowledgement can count a batch twice); alerts are for humans, never for payouts.
const intVar = (raw: string | undefined, min: number, max: number, fallback: number): number => {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
};
/** 0 means "post straight to global" (the original single-object path). */
export function monitorShardCount(env: Pick<SlotEnv, "SLOT_MONITOR_SHARDS">): number { return intVar(env.SLOT_MONITOR_SHARDS, 0, 1024, SLOT_LIMITS.monitorShards); }
export function monitorFlushMs(env: Pick<SlotEnv, "SLOT_MONITOR_FLUSH_MS">): number { return intVar(env.SLOT_MONITOR_FLUSH_MS, 1000, 3_600_000, SLOT_LIMITS.monitorFlushMs); }
export function monitorRollupMs(env: Pick<SlotEnv, "SLOT_MONITOR_ROLLUP_MS">): number { return intVar(env.SLOT_MONITOR_ROLLUP_MS, 1000, 3_600_000, SLOT_LIMITS.monitorRollupMs); }
export const MONITOR_GLOBAL = "global";
/** Stable shard of one session: the first 8 hex of its SHA-256 token hash (uniform) modulo the shard count. */
export function monitorTarget(tokenHash: string, shards: number): { name: string; path: "/add" | "/shard/add" } {
  if (shards <= 0 || !/^[0-9a-f]{8}/.test(tokenHash)) return { name: MONITOR_GLOBAL, path: "/add" };
  return { name: `shard:${Number.parseInt(tokenHash.slice(0, 8), 16) % shards}`, path: "/shard/add" };
}
