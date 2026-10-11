/** Monte Carlo evidence for the Candy Cascade engine (DEMO only, not a certified RTP).
 * Run: bash scripts/use-node.sh node --import tsx experiments/candy-cascade/simulate.ts --rounds 20000000 --seed <text> --out <path> [--workers 4]
 * Round seeds come from per-worker xoshiro streams derived from sha256(seed:worker), so a given
 * (seed, rounds, workers) triple always reproduces the same numbers. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import {
  CASCADE_BASE_WEIGHTS, CASCADE_CRYSTAL_WEIGHTS, CASCADE_ENGINE_ID, CASCADE_FREE_WEIGHTS, CASCADE_MAX_FREE_SPINS, CASCADE_MAX_TUMBLES,
  CASCADE_MAX_WIN_MULTIPLIER, CASCADE_PAYTABLE, CASCADE_SCATTER_PAY, __cascadeTest, cascadeSeedFromEntropy, playCascadeRound,
} from "../../packages/protocol/src/cascade.ts";

const STAKE_CENTS = 100; // 1 cent == 1 hundredth of stake, so payoutCents equals totalHundredths exactly
const THRESHOLDS = [1, 10, 50, 100, 500, 1000, 2000, 5000] as const;

interface Partial {
  rounds: number; sumH: number; sumSqH: string; sumPayoutCents: number; baseH: number; freeH: number; scatterH: number;
  baseHitSpins: number; triggers: number; retriggers: number; freeSpinsPlayed: number; capHits: number;
  maxMultiplierSum: number; maxRoundHundredths: number; maxTumblesInSpin: number; maxFreeSpinsInRound: number;
  maxSpinsWithCrystals: number; roundsAtLeast: number[];
}

function simulateChunk(seed: string, worker: number, rounds: number): Partial {
  const state = createHash("sha256").update(`${seed}:${worker}`).digest("hex").slice(0, 32);
  const rng = __cascadeTest.createRng(state);
  const p: Partial = {
    rounds, sumH: 0, sumSqH: "0", sumPayoutCents: 0, baseH: 0, freeH: 0, scatterH: 0, baseHitSpins: 0, triggers: 0, retriggers: 0,
    freeSpinsPlayed: 0, capHits: 0, maxMultiplierSum: 0, maxRoundHundredths: 0, maxTumblesInSpin: 0, maxFreeSpinsInRound: 0,
    maxSpinsWithCrystals: 0, roundsAtLeast: THRESHOLDS.map(() => 0),
  };
  let sumSq = 0n;
  const entropy = new Uint32Array(4);
  for (let i = 0; i < rounds; i++) {
    entropy[0] = rng(); entropy[1] = rng(); entropy[2] = rng(); entropy[3] = rng();
    const round = playCascadeRound(cascadeSeedFromEntropy(entropy), STAKE_CENTS);
    const total = round.totalHundredths;
    p.sumH += total; sumSq += BigInt(total) * BigInt(total); p.sumPayoutCents += round.payoutCents;
    if (total > p.maxRoundHundredths) p.maxRoundHundredths = total;
    if (round.capped) p.capHits++;
    if (round.freeSpinsTriggered) p.triggers++;
    THRESHOLDS.forEach((x, k) => { if (total >= x * 100) p.roundsAtLeast[k]!++; });
    let previous = 0, freeInRound = 0;
    for (const spin of round.spins) {
      const delta = spin.totalHundredthsAfter - previous; // cap-aware contribution of this spin
      previous = spin.totalHundredthsAfter;
      if (spin.kind === "base") {
        p.baseH += delta;
        if (spin.winHundredths > 0) p.baseHitSpins++;
        p.scatterH += spin.scatterHundredths;
      } else { p.freeH += delta; p.freeSpinsPlayed++; freeInRound++; if (spin.freeSpinsAwarded > 0) p.retriggers++; }
      if (spin.multiplierSum > p.maxMultiplierSum) p.maxMultiplierSum = spin.multiplierSum;
      if (spin.steps.length > p.maxTumblesInSpin) p.maxTumblesInSpin = spin.steps.length;
    }
    if (freeInRound > p.maxFreeSpinsInRound) p.maxFreeSpinsInRound = freeInRound;
  }
  p.sumSqH = sumSq.toString();
  return p;
}

if (!isMainThread) {
  const { seed, worker, rounds } = workerData as { seed: string; worker: number; rounds: number };
  parentPort!.postMessage(simulateChunk(seed, worker, rounds));
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const rounds = Number(args.get("rounds") ?? 2_000_000), seed = args.get("seed") ?? "candy-cascade-20261011", out = args.get("out");
  const workers = Number(args.get("workers") ?? 4);
  if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(workers) || workers < 1 || !out) {
    console.error("usage: simulate.ts --rounds N --seed TEXT --out PATH [--workers N]"); process.exit(2);
  }
  const started = Date.now();
  const share = Array.from({ length: workers }, (_, w) => Math.floor(rounds / workers) + (w < rounds % workers ? 1 : 0));
  const parts = await Promise.all(share.map((n, w) => new Promise<Partial>((ok, fail) => {
    if (n === 0) return ok(simulateChunk(seed, w, 0));
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { seed, worker: w, rounds: n } });
    worker.once("message", ok); worker.once("error", fail);
  })));
  const sum = (f: (p: Partial) => number): number => parts.reduce((a, p) => a + f(p), 0);
  const max = (f: (p: Partial) => number): number => parts.reduce((a, p) => Math.max(a, f(p)), 0);
  const sumH = sum(p => p.sumH), sumSq = parts.reduce((a, p) => a + BigInt(p.sumSqH), 0n);
  const mean = sumH / rounds / 100; // per-round return in stakes
  const meanSq = Number(sumSq) / rounds / 10_000;
  const variance = Math.max(0, (meanSq - mean * mean) * rounds / (rounds - 1));
  const half = 1.96 * Math.sqrt(variance / rounds);
  const pct = (x: number): number => Number((x * 100).toFixed(4));
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/protocol/src/cascade.ts"));
  const triggers = sum(p => p.triggers), freeSpins = sum(p => p.freeSpinsPlayed);
  const result = {
    kind: "candy-cascade-rtp-simulation", scope: "DEMO credits only; Monte Carlo estimate, not a certified or guaranteed RTP",
    engine: CASCADE_ENGINE_ID, engineSourceSha256: createHash("sha256").update(source).digest("hex"),
    rounds, seed, workers, stakeCents: STAKE_CENTS,
    rtp: {
      pointEstimatePct: pct(mean), ci95Pct: [pct(mean - half), pct(mean + half)], ci95HalfWidthPct: pct(half),
      method: "normal approximation on the per-round return (total/stake); heavy tail makes the interval optimistic",
      integerPayoutCheckPct: pct(sum(p => p.sumPayoutCents) / rounds / 100),
      perRoundStdDevStakes: Number(Math.sqrt(variance).toFixed(4)),
    },
    contributionPct: {
      baseGame: pct(sum(p => p.baseH) / rounds / 100), freeSpins: pct(sum(p => p.freeH) / rounds / 100),
      scatterPayInBase: pct(sum(p => p.scatterH) / rounds / 100),
    },
    baseHitFrequency: Number((sum(p => p.baseHitSpins) / rounds).toFixed(5)),
    freeSpinTrigger: { frequency: Number((triggers / rounds).toFixed(6)), oneIn: triggers ? Number((rounds / triggers).toFixed(1)) : null, count: triggers },
    freeSpins: {
      played: freeSpins, avgPlayedPerTrigger: triggers ? Number((freeSpins / triggers).toFixed(3)) : null,
      retriggers: sum(p => p.retriggers), maxInOneRound: max(p => p.maxFreeSpinsInRound),
      avgWinPerTriggerStakes: triggers ? Number((sum(p => p.freeH) / 100 / triggers).toFixed(2)) : null,
    },
    maxObservedMultiplierSum: max(p => p.maxMultiplierSum),
    maxObservedRoundWinStakes: max(p => p.maxRoundHundredths) / 100,
    maxTumblesInOneSpin: max(p => p.maxTumblesInSpin),
    capHits: sum(p => p.capHits), capStakes: CASCADE_MAX_WIN_MULTIPLIER,
    roundsWithWinAtLeast: Object.fromEntries(THRESHOLDS.map((x, k) => [`${x}x`, sum(p => p.roundsAtLeast[k]!)])),
    tables: {
      paytableHundredths: CASCADE_PAYTABLE, scatterPayHundredths: CASCADE_SCATTER_PAY, baseWeights: CASCADE_BASE_WEIGHTS,
      freeWeights: CASCADE_FREE_WEIGHTS, crystalWeights: CASCADE_CRYSTAL_WEIGHTS, maxFreeSpins: CASCADE_MAX_FREE_SPINS, maxTumbles: CASCADE_MAX_TUMBLES,
    },
    runtimeSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    node: process.version, generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(out!)), { recursive: true });
  writeFileSync(resolve(out!), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ rtp: result.rtp.pointEstimatePct, ci: result.rtp.ci95Pct, base: result.contributionPct, runtimeSeconds: result.runtimeSeconds }));
}
