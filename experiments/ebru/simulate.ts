/** Monte Carlo evidence for the Ebru engine `ebru-ink-1` (DEMO only, not a certified RTP).
 * Run: bash scripts/use-node.sh node --import tsx experiments/ebru/simulate.ts --rounds 20000000 --seed <text> --out <path> [--modes standard,ante,buy] [--workers 4]
 * Tuning runs only: --tune <json file> overrides the engine tuning ({"tables":{"ante":{"base":[...]}},"paytable":{...},"scatterPay":{...}}); the
 * override is recorded in the output and evidence runs never use it.
 * Round seeds come from per-worker xoshiro streams derived from sha256(seed:mode:worker), so a given
 * (seed, rounds, workers, modes) tuple always reproduces the same numbers. RTP is return / COST.
 * Win tiers are multiples of the BET (round total / bet), the same measure as the in-game tier screens.
 * The simulation plays the engine with record = false (no step objects); the engine test proves the totals and
 * spin summaries are identical to the recorded rounds. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import {
  EBRU_BET_LEVELS_CENTS, EBRU_COMB_AMPLITUDE_WEIGHTS, EBRU_COMB_STEP_WEIGHTS, EBRU_COST_FRACTION, EBRU_ENGINE_ID, EBRU_MAX_WIN_MULTIPLIER,
  EBRU_MODE_TABLES, EBRU_MODES, EBRU_PAYTABLE, EBRU_SCATTER_PAY, EBRU_CLUSTER_TIER_STARTS, __ebruTest, ebruSeedFromEntropy, type EbruMode, type EbruTuning,
} from "../../packages/protocol/src/ebru.ts";

/** The RTP constants live inside ebru.ts and are filled from this very evidence, so the engine hash is taken
 * over the file with the marked evidence block removed (engine code, tables and docs only). */
export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
const BET_CENTS = 100; // 1 cent == 1 hundredth of bet, so payoutCents equals totalHundredths exactly
const TIERS = [10, 25, 50, 100, 500, 1000, 2000, 5000, 10000] as const; // x bet
const STAIN_LEVELS = [0, 2, 4, 8, 16, 32, 64, 128, 256] as const;

interface Part {
  rounds: number; sumH: number; sumSqH: string; sumPayoutCents: number; baseH: number; freeH: number; scatterH: number;
  baseHitSpins: number; baseClusterHitSpins: number; triggers: number; retriggers: number; freeSpinsPlayed: number; freeWinSpins: number;
  capHits: number; maxRoundHundredths: number; maxTumblesInSpin: number; maxFreeSpinsInRound: number; minScattersInBaseGrid: number; costMismatch: number;
  roundsAtLeast: number[];
  baseSpins: number; baseCombWins: number; baseCombPasses: number; baseSpinsWithCombWin: number; baseTumbles: number; baseClusters: number;
  baseHitOnlyAfterComb: number;
  freeCombWins: number; freeCombPasses: number; freeSpinsWithCombWin: number; freeTumbles: number; freeClusters: number; freeStainedClusters: number;
  featureFinalMaxStain: number[]; featureFinalStainedCellsSum: number; featureFinalStainedCellsMax: number; featureWinSum: number;
}

function simulateChunk(seed: string, mode: EbruMode, worker: number, rounds: number, tuning: EbruTuning): Part {
  const state = createHash("sha256").update(`${seed}:${mode}:${worker}`).digest("hex").slice(0, 32);
  const rng = __ebruTest.createRng(state);
  const p: Part = {
    rounds, sumH: 0, sumSqH: "0", sumPayoutCents: 0, baseH: 0, freeH: 0, scatterH: 0, baseHitSpins: 0, baseClusterHitSpins: 0, triggers: 0,
    retriggers: 0, freeSpinsPlayed: 0, freeWinSpins: 0, capHits: 0, maxRoundHundredths: 0, maxTumblesInSpin: 0, maxFreeSpinsInRound: 0,
    minScattersInBaseGrid: 49, costMismatch: 0, roundsAtLeast: TIERS.map(() => 0),
    baseSpins: 0, baseCombWins: 0, baseCombPasses: 0, baseSpinsWithCombWin: 0, baseTumbles: 0, baseClusters: 0, baseHitOnlyAfterComb: 0,
    freeCombWins: 0, freeCombPasses: 0, freeSpinsWithCombWin: 0, freeTumbles: 0, freeClusters: 0, freeStainedClusters: 0,
    featureFinalMaxStain: STAIN_LEVELS.map(() => 0), featureFinalStainedCellsSum: 0, featureFinalStainedCellsMax: 0, featureWinSum: 0,
  };
  let sumSq = 0n;
  const entropy = new Uint32Array(4);
  const expectedCost = (BET_CENTS * EBRU_COST_FRACTION[mode][0]) / EBRU_COST_FRACTION[mode][1];
  for (let i = 0; i < rounds; i++) {
    entropy[0] = rng(); entropy[1] = rng(); entropy[2] = rng(); entropy[3] = rng();
    const round = __ebruTest.play(ebruSeedFromEntropy(entropy), BET_CENTS, mode, tuning, false);
    const total = round.totalHundredths;
    if (round.costCents !== expectedCost) p.costMismatch++;
    p.sumH += total; sumSq += BigInt(total) * BigInt(total); p.sumPayoutCents += round.payoutCents;
    if (total > p.maxRoundHundredths) p.maxRoundHundredths = total;
    if (round.capped) p.capHits++;
    if (round.freeSpinsTriggered) p.triggers++;
    TIERS.forEach((x, k) => { if (total >= x * 100) p.roundsAtLeast[k]!++; });
    let previous = 0, freeInRound = 0;
    for (const spin of round.spins) {
      const delta = spin.totalHundredthsAfter - previous; // cap-aware contribution of this spin
      previous = spin.totalHundredthsAfter;
      if (spin.kind === "base") {
        p.baseH += delta; p.baseSpins++;
        if (spin.winHundredths > 0) p.baseHitSpins++;
        if (spin.clusterCount > 0) p.baseClusterHitSpins++;
        p.scatterH += spin.scatterHundredths;
        p.baseCombWins += spin.combWins; p.baseCombPasses += spin.combPasses; p.baseTumbles += spin.tumbles; p.baseClusters += spin.clusterCount;
        if (spin.combWins > 0) p.baseSpinsWithCombWin++;
        if (spin.combWins > 0 && spin.tumbles === spin.combWins && spin.scatterHundredths === 0) p.baseHitOnlyAfterComb++;
      } else {
        p.freeH += delta; p.freeSpinsPlayed++; freeInRound++;
        if (spin.freeSpinsAwarded > 0) p.retriggers++;
        if (spin.tumbleHundredths > 0) p.freeWinSpins++;
        p.freeCombWins += spin.combWins; p.freeCombPasses += spin.combPasses; p.freeTumbles += spin.tumbles; p.freeClusters += spin.clusterCount;
        p.freeStainedClusters += spin.stainedClusterCount;
        if (spin.combWins > 0) p.freeSpinsWithCombWin++;
      }
      if (spin.tumbles + 1 > p.maxTumblesInSpin) p.maxTumblesInSpin = spin.tumbles + 1;
    }
    if (round.freeSpinsTriggered) {
      const last = round.spins.at(-1)!;
      p.featureFinalMaxStain[STAIN_LEVELS.indexOf(last.maxStain as never)]!++;
      p.featureFinalStainedCellsSum += last.stainedCells;
      if (last.stainedCells > p.featureFinalStainedCellsMax) p.featureFinalStainedCellsMax = last.stainedCells;
      p.featureWinSum += total - round.spins[0]!.totalHundredthsAfter;
    }
    if (freeInRound > p.maxFreeSpinsInRound) p.maxFreeSpinsInRound = freeInRound;
  }
  p.sumSqH = sumSq.toString();
  return p;
}

if (!isMainThread) {
  const { seed, mode, worker, rounds, tuning } = workerData as { seed: string; mode: EbruMode; worker: number; rounds: number; tuning: EbruTuning };
  parentPort!.postMessage(simulateChunk(seed, mode, worker, rounds, tuning));
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const rounds = Number(args.get("rounds") ?? 1_000_000), seed = args.get("seed") ?? "ebru-20261012-evidence", out = args.get("out");
  const workers = Number(args.get("workers") ?? 4);
  const modes = (args.get("modes") ?? EBRU_MODES.join(",")).split(",") as EbruMode[];
  const tuneFile = args.get("tune");
  const tuning: EbruTuning = tuneFile ? JSON.parse(readFileSync(resolve(tuneFile), "utf8")) : {};
  if (!Number.isSafeInteger(rounds) || rounds < 2 || !Number.isSafeInteger(workers) || workers < 1 || !out || modes.some(m => !EBRU_MODES.includes(m))) {
    console.error("usage: simulate.ts --rounds N --seed TEXT --out PATH [--modes standard,ante,buy] [--workers N] [--tune FILE]"); process.exit(2);
  }
  const started = Date.now();
  const source = stripEvidenceBlock(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/protocol/src/ebru.ts"), "utf8"));
  const pct4 = (x: number): number => Number(x.toFixed(4));
  const ratio = (x: number): number => Number(x.toFixed(5));
  const report: Record<string, unknown> = {};
  for (const mode of modes) {
    const t0 = Date.now();
    const share = Array.from({ length: workers }, (_, w) => Math.floor(rounds / workers) + (w < rounds % workers ? 1 : 0));
    const parts = await Promise.all(share.map((n, w) => new Promise<Part>((ok, fail) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { seed, mode, worker: w, rounds: n, tuning }, execArgv: process.execArgv });
      worker.once("message", ok); worker.once("error", fail);
    })));
    const sum = (f: (p: Part) => number): number => parts.reduce((a, p) => a + f(p), 0);
    const max = (f: (p: Part) => number): number => parts.reduce((a, p) => Math.max(a, f(p)), 0);
    const [num, den] = EBRU_COST_FRACTION[mode];
    const costBets = num / den; // cost in units of the bet
    const sumH = sum(p => p.sumH), sumSq = parts.reduce((a, p) => a + BigInt(p.sumSqH), 0n);
    const mean = sumH / rounds / 100 / costBets;                          // return per round in COST units
    const meanSq = Number(sumSq) / rounds / 10_000 / (costBets * costBets);
    const variance = Math.max(0, (meanSq - mean * mean) * rounds / (rounds - 1));
    const half = 1.96 * Math.sqrt(variance / rounds);
    const triggers = sum(p => p.triggers), freeSpins = sum(p => p.freeSpinsPlayed), freeWin = sum(p => p.freeWinSpins);
    const baseSpins = sum(p => p.baseSpins);
    const tierShare = (x: number): number => sum(p => p.roundsAtLeast[TIERS.indexOf(x as never)]!) / rounds;
    const allSpins = baseSpins + freeSpins;
    const allCombWins = sum(p => p.baseCombWins + p.freeCombWins);
    report[mode] = {
      rounds, costBets,
      rtpVsCost: { pointEstimate: ratio(mean), pointEstimatePct: pct4(mean * 100), ci95: [ratio(mean - half), ratio(mean + half)], ci95Pct: [pct4((mean - half) * 100), pct4((mean + half) * 100)], ci95HalfWidthPct: pct4(half * 100) },
      integerPayoutCheckRtp: ratio(sum(p => p.sumPayoutCents) / rounds / 100 / costBets),
      hitRate: ratio(sum(p => p.baseHitSpins) / rounds),
      baseClusterHitRate: ratio(sum(p => p.baseClusterHitSpins) / rounds),
      featureRate: Number((triggers / rounds).toFixed(6)), featureOneIn: triggers ? Number((rounds / triggers).toFixed(1)) : null, featureCount: triggers,
      avgFreeSpinsPerRound: ratio(freeSpins / rounds), avgFreeSpinsPerTrigger: triggers ? Number((freeSpins / triggers).toFixed(3)) : null,
      freeSpinsPlayed: freeSpins, retriggers: sum(p => p.retriggers), maxFreeSpinsInOneRound: max(p => p.maxFreeSpinsInRound),
      freeSpinHitRate: freeSpins ? ratio(freeWin / freeSpins) : null,
      stdDevPerRoundCostUnits: Number(Math.sqrt(variance).toFixed(4)), stdDevPerRoundBetUnits: Number((Math.sqrt(variance) * costBets).toFixed(4)),
      contributionPctOfCost: { baseGame: pct4(sum(p => p.baseH) / rounds / costBets), freeSpins: pct4(sum(p => p.freeH) / rounds / costBets), scatterPayInBase: pct4(sum(p => p.scatterH) / rounds / costBets) },
      avgFreeWinPerTriggerBets: triggers ? Number((sum(p => p.freeH) / 100 / triggers).toFixed(2)) : null,
      winTiersShareOfRounds: Object.fromEntries(TIERS.map(x => [`atLeast${x}xBet`, Number(tierShare(x).toPrecision(5))])),
      winTiersRounds: Object.fromEntries(TIERS.map((x, k) => [`atLeast${x}xBet`, sum(p => p.roundsAtLeast[k]!)])),
      maxObservedXBet: max(p => p.maxRoundHundredths) / 100, maxObservedXCost: Number((max(p => p.maxRoundHundredths) / 100 / costBets).toFixed(4)),
      maxStepsPerSpinTumblesPlusOne: max(p => p.maxTumblesInSpin),
      capHits: sum(p => p.capHits), capHitShareOfRounds: Number((sum(p => p.capHits) / rounds).toPrecision(5)), capXBet: EBRU_MAX_WIN_MULTIPLIER,
      comb: {
        avgCombCreatedWinsPerSpin: ratio(allCombWins / allSpins), avgCombCreatedWinsPerBaseSpin: ratio(sum(p => p.baseCombWins) / baseSpins),
        avgCombCreatedWinsPerFreeSpin: freeSpins ? ratio(sum(p => p.freeCombWins) / freeSpins) : null,
        avgCombPassesPerSpin: ratio(sum(p => p.baseCombPasses + p.freeCombPasses) / allSpins),
        baseSpinsWithCombCreatedWinShare: ratio(sum(p => p.baseSpinsWithCombWin) / baseSpins),
        baseHitsThatNeededTheCombShare: ratio(sum(p => p.baseHitOnlyAfterComb) / Math.max(1, sum(p => p.baseHitSpins))),
        freeSpinsWithCombCreatedWinShare: freeSpins ? ratio(sum(p => p.freeSpinsWithCombWin) / freeSpins) : null,
      },
      tumbles: { avgPerBaseSpin: ratio(sum(p => p.baseTumbles) / baseSpins), avgPerFreeSpin: freeSpins ? ratio(sum(p => p.freeTumbles) / freeSpins) : null,
        avgClustersPerBaseSpin: ratio(sum(p => p.baseClusters) / baseSpins), avgClustersPerFreeSpin: freeSpins ? ratio(sum(p => p.freeClusters) / freeSpins) : null },
      stains: {
        shareOfFreeSpinClustersCrossingAStain: sum(p => p.freeClusters) ? ratio(sum(p => p.freeStainedClusters) / sum(p => p.freeClusters)) : null,
        avgStainedCellsAtFeatureEnd: triggers ? Number((sum(p => p.featureFinalStainedCellsSum) / triggers).toFixed(2)) : null,
        maxStainedCellsAtFeatureEnd: max(p => p.featureFinalStainedCellsMax),
        featureEndMaxStainShare: Object.fromEntries(STAIN_LEVELS.map((v, k) => [`max${v}`, triggers ? Number((sum(p => p.featureFinalMaxStain[k]!) / triggers).toPrecision(4)) : null])),
        featureEndMaxStainCount: Object.fromEntries(STAIN_LEVELS.map((v, k) => [`max${v}`, sum(p => p.featureFinalMaxStain[k]!)])),
      },
      minCombsInInitialBaseGrid: parts.reduce((a, p) => Math.min(a, p.minScattersInBaseGrid), 49),
      costMismatches: sum(p => p.costMismatch),
      method: "normal approximation on the per-round return / cost; heavy tail makes the interval optimistic",
      runtimeSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    const r = report[mode] as Record<string, any>;
    console.log(JSON.stringify({
      mode, rtpPct: r.rtpVsCost.pointEstimatePct, ci: r.rtpVsCost.ci95Pct, hit: r.hitRate, clusterHit: r.baseClusterHitRate, feature: r.featureRate, oneIn: r.featureOneIn, sd: r.stdDevPerRoundCostUnits,
      contribution: r.contributionPctOfCost, avgFreeWin: r.avgFreeWinPerTriggerBets, freeHit: r.freeSpinHitRate, avgFree: r.avgFreeSpinsPerTrigger,
      comb: r.comb, tumbles: r.tumbles, stains: { cross: r.stains.shareOfFreeSpinClustersCrossingAStain, cells: r.stains.avgStainedCellsAtFeatureEnd },
      tiers: r.winTiersShareOfRounds, cap: r.capHits, maxX: r.maxObservedXBet, sec: r.runtimeSeconds,
    }));
  }
  const result = {
    kind: "ebru-rtp-simulation", scope: "DEMO credits only; Monte Carlo estimate, not a certified or guaranteed RTP; RTP is return / cost",
    engine: EBRU_ENGINE_ID, engineSourceSha256: createHash("sha256").update(source).digest("hex"),
    engineSourceNote: "sha256 of packages/protocol/src/ebru.ts with the EBRU_RTP evidence block (between the @evidence-block markers) removed. The constants were filled after the run; no engine code, tables or RNG changed afterwards.",
    seed, workers, betCentsSimulated: BET_CENTS, betLevelsCents: EBRU_BET_LEVELS_CENTS, winTierMeasure: "round total / bet",
    tuningOverride: tuneFile ? tuning : null,
    modes: report,
    tables: {
      clusterTierStarts: EBRU_CLUSTER_TIER_STARTS, paytableHundredths: EBRU_PAYTABLE, scatterPayHundredths: EBRU_SCATTER_PAY,
      combAmplitudeWeights: EBRU_COMB_AMPLITUDE_WEIGHTS, combRowStepWeights: EBRU_COMB_STEP_WEIGHTS, modeTables: EBRU_MODE_TABLES,
    },
    runtimeSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), node: process.version, generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(out!)), { recursive: true });
  writeFileSync(resolve(out!), JSON.stringify(result, null, 2) + "\n");
}
