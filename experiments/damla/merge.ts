/** Merges the per-mode simulation files of one evidence directory into rtp.json (exact + Monte Carlo per mode).
 * Run: bash scripts/use-node.sh node experiments/damla/merge.ts --dir ops/evidence/damla-20261021 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DAMLA_MODES, DAMLA_PAYTABLES, type DamlaMode } from "../../packages/protocol/src/damla.ts";
import { exactRow } from "./exact.ts";
import { engineSha256 } from "./engine-hash.ts";

const i = process.argv.indexOf("--dir");
if (i < 0) throw new Error("usage: merge.ts --dir <evidence dir>");
const dir = resolve(process.argv[i + 1]!), sha = engineSha256(), modes: Record<string, unknown> = {};
let seed = "", engine = "";
for (const mode of DAMLA_MODES) {
  const file = `${dir}/mode-${mode}.json`;
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const s = JSON.parse(readFileSync(file, "utf8")) as { seed: string; engine: string; engineSourceSha256: string; rounds: number; targetRounds: number; histogram: number[]; capHits: number; mismatches: number; chunksDone: number };
  if (s.engineSourceSha256 !== sha) throw new Error(`${mode}: engine bytes changed since the run`);
  if (s.rounds < s.targetRounds) throw new Error(`${mode}: incomplete (${s.rounds}/${s.targetRounds})`);
  seed = s.seed; engine = s.engine;
  const pools = DAMLA_PAYTABLES[mode as DamlaMode]!, n = BigInt(s.rounds);
  let sum = 0n, sq = 0n;
  s.histogram.forEach((c, k) => { sum += BigInt(c) * BigInt(pools[k]!); sq += BigInt(c) * BigInt(pools[k]!) ** 2n; });
  const mean = Number(sum * 1_000_000_000_000n / n) / 1e14; // in bets
  const ex2 = Number(sq * 1_000_000_000_000n / n) / 1e16, variance = ex2 - mean * mean, stdDev = Math.sqrt(variance), half = 1.96 * stdDev / Math.sqrt(s.rounds);
  const exact = exactRow(mode as DamlaMode);
  modes[mode] = {
    rounds: s.rounds, exactRtp: exact.rtp, exactRtpPct: exact.rtpPct, exactStdDev: exact.stdDev,
    mcRtp: mean, mcRtpPct: Number((mean * 100).toFixed(4)), ci95: [mean - half, mean + half], stdDev, mcMinusExact: mean - exact.rtp,
    withinThreeSigma: Math.abs(mean - exact.rtp) <= 3 * stdDev / Math.sqrt(s.rounds), capHits: s.capHits, integerPayoutMismatches: s.mismatches, slotHistogram: s.histogram,
  };
}
writeFileSync(`${dir}/rtp.json`, JSON.stringify({
  kind: "damla-rtp-simulation", scope: "DEMO credits only; exact binomial RTP plus a Monte Carlo cross-check through playDamlaRound; RTP is return / cost (cost = bet)",
  engine, engineSourceSha256: sha, engineSourceNote: "sha256 of packages/protocol/src/damla.ts with the DAMLA_RTP evidence block (between the @evidence-block markers) removed.",
  seed, modes,
}, null, 2) + "\n");
console.log(`wrote ${dir}/rtp.json`);
