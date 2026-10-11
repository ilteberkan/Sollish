/** Monte Carlo evidence for the Candy Cascade engine `candy-cascade-2` (DEMO only, not a certified RTP).
 * Run: bash scripts/use-node.sh node --import tsx experiments/candy-cascade/simulate-2.ts --rounds 10000000 --seed <text> --out <path> [--modes standard,ante,buy] [--workers 4]
 * Tuning runs only: --tune <json file> overrides tables ({"tables":{"ante":{"base":[...]}}}); the override is
 * recorded in the output and evidence runs never use it.
 * Round seeds come from per-worker xoshiro streams derived from sha256(seed:mode:worker), so a given
 * (seed, rounds, workers, modes) tuple always reproduces the same numbers. RTP is return / COST. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import {
  CASCADE2_BET_LEVELS_CENTS, CASCADE2_COST_FRACTION, CASCADE2_ENGINE_ID, CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_MODE_TABLES, CASCADE2_MODES,
  CASCADE2_PAYTABLE, CASCADE2_SCATTER_PAY, __cascade2Test, type Cascade2Tuning, type CascadeMode,
} from "../../packages/protocol/src/cascade-2.ts";
import { cascadeSeedFromEntropy } from "../../packages/protocol/src/cascade.ts";

/** The RTP constants live inside cascade-2.ts and are filled from this very evidence, so the engine hash is taken
 * over the file with the marked evidence block removed (engine code, tables and docs only). */
export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
const BET_CENTS = 100; // 1 cent == 1 hundredth of bet, so payoutCents equals totalHundredths exactly
const THRESHOLDS = [1, 10, 50, 100, 500, 1000, 2000, 5000] as const;

interface Part {
  rounds: number; sumH: number; sumSqH: string; sumPayoutCents: number; baseH: number; freeH: number; scatterH: number;
  baseHitSpins: number; triggers: number; retriggers: number; freeSpinsPlayed: number; capHits: number;
  maxMultiplierSum: number; maxRoundHundredths: number; maxTumblesInSpin: number; maxFreeSpinsInRound: number;
  minStarsInBaseGrid: number; costMismatch: number; roundsAtLeast: number[];
}

function simulateChunk(seed: string, mode: CascadeMode, worker: number, rounds: number, tuning: Cascade2Tuning): Part {
  const state = createHash("sha256").update(`${seed}:${mode}:${worker}`).digest("hex").slice(0, 32);
  const rng = __cascade2Test.createRng(state);
  const p: Part = {
    rounds, sumH: 0, sumSqH: "0", sumPayoutCents: 0, baseH: 0, freeH: 0, scatterH: 0, baseHitSpins: 0, triggers: 0, retriggers: 0,
    freeSpinsPlayed: 0, capHits: 0, maxMultiplierSum: 0, maxRoundHundredths: 0, maxTumblesInSpin: 0, maxFreeSpinsInRound: 0,
    minStarsInBaseGrid: 30, costMismatch: 0, roundsAtLeast: THRESHOLDS.map(() => 0),
  };
  let sumSq = 0n;
  const entropy = new Uint32Array(4);
  const expectedCost = (BET_CENTS * CASCADE2_COST_FRACTION[mode][0]) / CASCADE2_COST_FRACTION[mode][1];
  for (let i = 0; i < rounds; i++) {
    entropy[0] = rng(); entropy[1] = rng(); entropy[2] = rng(); entropy[3] = rng();
    const round = __cascade2Test.play(cascadeSeedFromEntropy(entropy), BET_CENTS, mode, tuning);
    const total = round.totalHundredths;
    if (round.costCents !== expectedCost) p.costMismatch++;
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
        let stars = 0;
        for (const column of spin.steps[0]!.grid) for (const cell of column) if (cell.symbol === "star") stars++;
        if (stars < p.minStarsInBaseGrid) p.minStarsInBaseGrid = stars;
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
  const { seed, mode, worker, rounds, tuning } = workerData as { seed: string; mode: CascadeMode; worker: number; rounds: number; tuning: Cascade2Tuning };
  parentPort!.postMessage(simulateChunk(seed, mode, worker, rounds, tuning));
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const rounds = Number(args.get("rounds") ?? 1_000_000), seed = args.get("seed") ?? "candy-cascade-2-20261011", out = args.get("out");
  const workers = Number(args.get("workers") ?? 4);
  const modes = (args.get("modes") ?? CASCADE2_MODES.join(",")).split(",") as CascadeMode[];
  const tuneFile = args.get("tune");
  const tuning: Cascade2Tuning = tuneFile ? JSON.parse(readFileSync(resolve(tuneFile), "utf8")) : {};
  if (!Number.isSafeInteger(rounds) || rounds < 2 || !Number.isSafeInteger(workers) || workers < 1 || !out || modes.some(m => !CASCADE2_MODES.includes(m))) {
    console.error("usage: simulate-2.ts --rounds N --seed TEXT --out PATH [--modes standard,ante,buy] [--workers N] [--tune FILE]"); process.exit(2);
  }
  const started = Date.now();
  const source = stripEvidenceBlock(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/protocol/src/cascade-2.ts"), "utf8"));
  const pct4 = (x: number): number => Number(x.toFixed(4));
  const ratio = (x: number): number => Number(x.toFixed(5));
  const report: Record<string, unknown> = {};
  for (const mode of modes) {
    const t0 = Date.now();
    const share = Array.from({ length: workers }, (_, w) => Math.floor(rounds / workers) + (w < rounds % workers ? 1 : 0));
    const parts = await Promise.all(share.map((n, w) => new Promise<Part>((ok, fail) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { seed, mode, worker: w, rounds: n, tuning } });
      worker.once("message", ok); worker.once("error", fail);
    })));
    const sum = (f: (p: Part) => number): number => parts.reduce((a, p) => a + f(p), 0);
    const max = (f: (p: Part) => number): number => parts.reduce((a, p) => Math.max(a, f(p)), 0);
    const [num, den] = CASCADE2_COST_FRACTION[mode];
    const costBets = num / den; // cost in units of the bet
    const sumH = sum(p => p.sumH), sumSq = parts.reduce((a, p) => a + BigInt(p.sumSqH), 0n);
    const mean = sumH / rounds / 100 / costBets;                          // return per round in COST units
    const meanSq = Number(sumSq) / rounds / 10_000 / (costBets * costBets);
    const variance = Math.max(0, (meanSq - mean * mean) * rounds / (rounds - 1));
    const half = 1.96 * Math.sqrt(variance / rounds);
    const triggers = sum(p => p.triggers), freeSpins = sum(p => p.freeSpinsPlayed);
    report[mode] = {
      rounds, costBets,
      rtpVsCost: { pointEstimate: ratio(mean), pointEstimatePct: pct4(mean * 100), ci95: [ratio(mean - half), ratio(mean + half)], ci95Pct: [pct4((mean - half) * 100), pct4((mean + half) * 100)], ci95HalfWidthPct: pct4(half * 100) },
      integerPayoutCheckRtp: ratio(sum(p => p.sumPayoutCents) / rounds / 100 / costBets),
      hitRate: ratio(sum(p => p.baseHitSpins) / rounds),
      featureRate: Number((triggers / rounds).toFixed(6)), featureOneIn: triggers ? Number((rounds / triggers).toFixed(1)) : null, featureCount: triggers,
      avgFreeSpinsPerRound: ratio(freeSpins / rounds), avgFreeSpinsPerTrigger: triggers ? Number((freeSpins / triggers).toFixed(3)) : null,
      freeSpinsPlayed: freeSpins, retriggers: sum(p => p.retriggers), maxFreeSpinsInOneRound: max(p => p.maxFreeSpinsInRound),
      stdDevPerRoundCostUnits: Number(Math.sqrt(variance).toFixed(4)),
      contributionPctOfCost: { baseGame: pct4(sum(p => p.baseH) / rounds / costBets), freeSpins: pct4(sum(p => p.freeH) / rounds / costBets), scatterPayInBase: pct4(sum(p => p.scatterH) / rounds / costBets) },
      avgFreeWinPerTriggerBets: triggers ? Number((sum(p => p.freeH) / 100 / triggers).toFixed(2)) : null,
      maxObservedMultiplierSum: max(p => p.maxMultiplierSum),
      maxObservedXBet: max(p => p.maxRoundHundredths) / 100, maxObservedXCost: Number((max(p => p.maxRoundHundredths) / 100 / costBets).toFixed(4)),
      maxTumblesInOneSpin: max(p => p.maxTumblesInSpin),
      capHits: sum(p => p.capHits), capXBet: CASCADE2_MAX_WIN_MULTIPLIER,
      minStarsInInitialBaseGrid: parts.reduce((a, p) => Math.min(a, p.minStarsInBaseGrid), 30),
      costMismatches: sum(p => p.costMismatch),
      roundsWithWinAtLeastXBet: Object.fromEntries(THRESHOLDS.map((x, k) => [`${x}x`, sum(p => p.roundsAtLeast[k]!)])),
      method: "normal approximation on the per-round return / cost; heavy tail makes the interval optimistic",
      runtimeSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    const r = report[mode] as { rtpVsCost: { pointEstimatePct: number; ci95Pct: number[] }; featureRate: number; hitRate: number };
    console.log(JSON.stringify({ mode, rtpPct: r.rtpVsCost.pointEstimatePct, ci: r.rtpVsCost.ci95Pct, feature: r.featureRate, hit: r.hitRate, contribution: (report[mode] as { contributionPctOfCost: unknown }).contributionPctOfCost, avgFreeWin: (report[mode] as { avgFreeWinPerTriggerBets: unknown }).avgFreeWinPerTriggerBets, sec: (report[mode] as { runtimeSeconds: number }).runtimeSeconds }));
  }
  const result = {
    kind: "candy-cascade-2-rtp-simulation", scope: "DEMO credits only; Monte Carlo estimate, not a certified or guaranteed RTP; RTP is return / cost",
    engine: CASCADE2_ENGINE_ID, engineSourceSha256: createHash("sha256").update(source).digest("hex"),
    seed, workers, betCentsSimulated: BET_CENTS, betLevelsCents: CASCADE2_BET_LEVELS_CENTS,
    tuningOverride: tuneFile ? tuning : null,
    modes: report,
    tables: { paytableHundredths: CASCADE2_PAYTABLE, scatterPayHundredths: CASCADE2_SCATTER_PAY, modeTables: CASCADE2_MODE_TABLES },
    runtimeSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), node: process.version, generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(out!)), { recursive: true });
  writeFileSync(resolve(out!), JSON.stringify(result, null, 2) + "\n");
}
