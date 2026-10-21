/** Exact RTP of every Damla mode with BigInt rationals (binomial sum, no sampling).
 * Run: bash scripts/use-node.sh node experiments/damla/exact.ts [--out <path.json>]
 * RTP(mode) = sum_k C(R,k) * pool[k] / (100 * 2^R); variance from the same sums. Prints a table and optionally writes JSON. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DAMLA_MODES, DAMLA_PAYTABLES, type DamlaMode } from "../../packages/protocol/src/damla.ts";

const choose = (n: number, k: number): bigint => { let r = 1n; for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i); return r; };
const decimal = (num: bigint, den: bigint, digits: number): string => {
  const scaled = num * 10n ** BigInt(digits) / den, s = scaled.toString().padStart(digits + 1, "0");
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
};
export interface ExactRow {
  mode: DamlaMode; rows: number; rtpNumerator: string; rtpDenominator: string; rtp: number; rtpPct: string; houseEdgePct: string;
  stdDev: number; maxMultiplier: number; hitRateNonLoss: number; pools: readonly number[];
}
export function exactRow(mode: DamlaMode): ExactRow {
  const rows = Number(mode.split("-")[1]), pools = DAMLA_PAYTABLES[mode]!, den = 100n * (1n << BigInt(rows));
  let num = 0n, sq = 0n, ge1 = 0n;
  for (let k = 0; k <= rows; k++) {
    const w = choose(rows, k), m = BigInt(pools[k]!);
    num += w * m; sq += w * m * m; if (m >= 100n) ge1 += w;
  }
  // E[X] = num/den, E[X^2] = sq / (10^4 * 2^R); variance in bets^2 = E[X^2] - E[X]^2
  const ex2den = 10_000n * (1n << BigInt(rows));
  const varNum = sq * den * den - num * num * ex2den, varDen = ex2den * den * den;
  const stdDev = Math.sqrt(Number(varNum * 1_000_000_000_000n / varDen) / 1e12);
  return {
    mode, rows, rtpNumerator: num.toString(), rtpDenominator: den.toString(), rtp: Number(num * 1_000_000_000n / den) / 1e9, rtpPct: decimal(num * 100n, den, 6),
    houseEdgePct: decimal((den - num) * 100n, den, 6), stdDev, maxMultiplier: Math.max(...pools) / 100, hitRateNonLoss: Number(ge1 * 1_000_000n / (1n << BigInt(rows))) / 1e6, pools,
  };
}
export const exactTable = (): ExactRow[] => DAMLA_MODES.map(exactRow);

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const table = exactTable();
  for (const r of table) console.log(`${r.mode.padEnd(10)} RTP ${r.rtpPct}%  edge ${r.houseEdgePct}%  sd ${r.stdDev.toFixed(3)}  max ${r.maxMultiplier}x  P(>=1x) ${r.hitRateNonLoss}`);
  const out = process.argv.indexOf("--out");
  if (out > 0) { mkdirSync(dirname(process.argv[out + 1]!), { recursive: true }); writeFileSync(process.argv[out + 1]!, JSON.stringify({ kind: "damla-exact-rtp", engine: "damla-terraces-1", modes: table }, null, 2) + "\n"); }
}
