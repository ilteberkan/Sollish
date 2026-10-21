/** Monte Carlo evidence for the Göreme engine `goreme-balloons-1` (DEMO only, not a certified RTP).
 * Run (one mode per process): bash scripts/use-node.sh node --import tsx experiments/goreme/simulate.ts --rounds 20000000 --seed <text> --out <path> --modes standard [--workers 2] [--chunks 40]
 * Crash safety: --chunks N splits the run into N independent sub-runs (seed "<seed>/c<k>"); the raw counters of every finished chunk
 * are written to <out>.ckpt/ (or --ckpt DIR) at once, and a restarted run with the same arguments loads them and only plays the
 * missing chunks. The final report is written only when all chunks are present.
 * Tuning runs only: --tune <json file> overrides the engine tuning ({"tables":{"ante":{"base":[...]}},"paytable":{...}}); the override
 * is recorded in the output and evidence runs never use it.
 * Round seeds come from per-worker xoshiro streams derived from sha256(seed:mode:worker), so a given (seed, rounds, workers, chunks,
 * modes) tuple always reproduces the same numbers. RTP is return / COST. Win tiers are multiples of the BET (round total / bet). */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import {
  GOREME_BET_LEVELS_CENTS, GOREME_COST_FRACTION, GOREME_ENGINE_ID, GOREME_MAX_WIN_MULTIPLIER, GOREME_MODE_TABLES, GOREME_MODES, GOREME_PAYTABLE,
  GOREME_SCATTER_AWARDS, GOREME_WIND_WEIGHTS, __goremeTest, goremeSeedFromEntropy, type GoremeMode, type GoremeTuning,
} from "../../packages/protocol/src/goreme.ts";

/** The RTP constants live inside goreme.ts and are filled from this very evidence, so the engine hash is taken
 * over the file with the marked evidence block removed (engine code, tables and docs only). */
export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
const BET_CENTS = 100; // 1 cent == 1 hundredth of bet, so payoutCents equals totalHundredths exactly
const TIERS = [10, 25, 50, 100, 500, 1000, 2000, 5000, 10000] as const; // x bet
const SKY_BUCKETS = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const; // final sky value >= bucket

export interface Part {
  rounds: number; sumH: number; sumSqH: string; sumPayoutCents: number; baseH: number; freeH: number; scatterH: number;
  baseHitSpins: number; triggers: number; retriggers: number; freeSpinsPlayed: number; freeWinSpins: number; capHits: number;
  maxRoundHundredths: number; maxFreeSpinsInRound: number; minScattersInFirstBoard: number; costMismatch: number; roundsAtLeast: number[];
  baseSpins: number; baseLifts: number; baseSpinsWithLift: number; maxLiftsInSpin: number; liftChainHist: number[];
  firstBoardsWithBalloon: number; balloonsLandedBase: number; balloonsLandedFree: number; mergesBase: number; mergesFree: number; exitsBase: number; moorings: number;
  maxBalloonMultiplier: number; maxSky: number; skySum: number; skyAtLeast: number[]; windCounts: number[]; baseWaysH: number; liftWaysH: number;
  freeLifts: number; maxWeightedWays: number;
}
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);
const newPart = (rounds: number): Part => ({
  rounds, sumH: 0, sumSqH: "0", sumPayoutCents: 0, baseH: 0, freeH: 0, scatterH: 0, baseHitSpins: 0, triggers: 0, retriggers: 0, freeSpinsPlayed: 0, freeWinSpins: 0,
  capHits: 0, maxRoundHundredths: 0, maxFreeSpinsInRound: 0, minScattersInFirstBoard: 30, costMismatch: 0, roundsAtLeast: zeros(TIERS.length),
  baseSpins: 0, baseLifts: 0, baseSpinsWithLift: 0, maxLiftsInSpin: 0, liftChainHist: zeros(21), firstBoardsWithBalloon: 0, balloonsLandedBase: 0, balloonsLandedFree: 0,
  mergesBase: 0, mergesFree: 0, exitsBase: 0, moorings: 0, maxBalloonMultiplier: 0, maxSky: 1, skySum: 0, skyAtLeast: zeros(SKY_BUCKETS.length), windCounts: zeros(3),
  baseWaysH: 0, liftWaysH: 0, freeLifts: 0, maxWeightedWays: 0,
});

function simulateChunk(seed: string, mode: GoremeMode, worker: number, rounds: number, tuning: GoremeTuning): Part {
  const state = createHash("sha256").update(`${seed}:${mode}:${worker}`).digest("hex").slice(0, 32);
  const rng = __goremeTest.createRng(state);
  const p = newPart(rounds);
  let sumSq = 0n;
  const entropy = new Uint32Array(4);
  const expectedCost = (BET_CENTS * GOREME_COST_FRACTION[mode][0]) / GOREME_COST_FRACTION[mode][1];
  for (let i = 0; i < rounds; i++) {
    entropy[0] = rng(); entropy[1] = rng(); entropy[2] = rng(); entropy[3] = rng();
    const round = __goremeTest.play(goremeSeedFromEntropy(entropy), BET_CENTS, mode, tuning);
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
      const base = spin.kind === "base";
      if (base) {
        p.baseH += delta; p.baseSpins++;
        if (spin.winHundredths > 0) p.baseHitSpins++;
        p.scatterH += spin.scatterHundredths;
        p.baseLifts += spin.lifts; if (spin.lifts > 0) p.baseSpinsWithLift++;
        if (spin.lifts > p.maxLiftsInSpin) p.maxLiftsInSpin = spin.lifts;
        p.liftChainHist[spin.lifts]!++;
        if (spin.scatterCount < p.minScattersInFirstBoard) p.minScattersInFirstBoard = spin.scatterCount;
      } else {
        p.freeH += delta; p.freeSpinsPlayed++; freeInRound++; p.freeLifts += spin.lifts;
        if (spin.freeSpinsAwarded > 0) p.retriggers++;
        if (spin.waysHundredths > 0) p.freeWinSpins++;
      }
      let firstWays = true;
      for (const step of spin.steps) {
        if (step.type === "spin" || step.type === "respin") {
          if (base) p.balloonsLandedBase += step.balloons.length; else p.balloonsLandedFree += step.balloons.length;
          if (base && step.type === "spin" && step.balloons.length > 0) p.firstBoardsWithBalloon++;
          for (const b of step.balloons) if (b.multiplier > p.maxBalloonMultiplier) p.maxBalloonMultiplier = b.multiplier;
        } else if (step.type === "lift") {
          p.windCounts[step.shift + 1]!++;
          if (base) { p.mergesBase += step.merges.length; p.exitsBase += step.exits.length; } else p.mergesFree += step.merges.length;
          for (const b of step.balloons) if (b.multiplier > p.maxBalloonMultiplier) p.maxBalloonMultiplier = b.multiplier;
        } else if (step.type === "sky") {
          p.moorings += step.moored.length;
        } else if (step.type === "ways") {
          if (base) { if (firstWays) p.baseWaysH += step.winHundredths; else p.liftWaysH += step.winHundredths; }
          firstWays = false;
          for (const w of step.wins) if (w.weightedWays > p.maxWeightedWays) p.maxWeightedWays = w.weightedWays;
        }
      }
    }
    if (round.freeSpinsTriggered) {
      const sky = round.spins.at(-1)!.skyAfter;
      p.skySum += sky; if (sky > p.maxSky) p.maxSky = sky;
      SKY_BUCKETS.forEach((x, k) => { if (sky >= x) p.skyAtLeast[k]!++; });
    }
    if (freeInRound > p.maxFreeSpinsInRound) p.maxFreeSpinsInRound = freeInRound;
  }
  p.sumSqH = sumSq.toString();
  return p;
}

/** Builds one mode's report from the raw counters of every chunk / worker. */
export function buildModeReport(parts: readonly Part[], mode: GoremeMode): Record<string, unknown> {
  const rounds = parts.reduce((a, p) => a + p.rounds, 0);
  const sum = (f: (p: Part) => number): number => parts.reduce((a, p) => a + f(p), 0);
  const max = (f: (p: Part) => number): number => parts.reduce((a, p) => Math.max(a, f(p)), 0);
  const sumArr = (f: (p: Part) => number[], k: number): number => parts.reduce((a, p) => a + f(p)[k]!, 0);
  const pct4 = (x: number): number => Number(x.toFixed(4));
  const ratio = (x: number): number => Number(x.toFixed(5));
  const [num, den] = GOREME_COST_FRACTION[mode];
  const costBets = num / den;
  const sumH = sum(p => p.sumH), sumSq = parts.reduce((a, p) => a + BigInt(p.sumSqH), 0n);
  const mean = sumH / rounds / 100 / costBets;
  const meanSq = Number(sumSq) / rounds / 10_000 / (costBets * costBets);
  const variance = Math.max(0, (meanSq - mean * mean) * rounds / (rounds - 1));
  const half = 1.96 * Math.sqrt(variance / rounds);
  const triggers = sum(p => p.triggers), freeSpins = sum(p => p.freeSpinsPlayed), freeWin = sum(p => p.freeWinSpins);
  const baseSpins = sum(p => p.baseSpins), baseLifts = sum(p => p.baseLifts), withLift = sum(p => p.baseSpinsWithLift);
  const winds = [0, 1, 2].map(k => sumArr(p => p.windCounts, k)), windTotal = winds[0]! + winds[1]! + winds[2]!;
  return {
    rounds, costBets,
    rtpVsCost: { pointEstimate: ratio(mean), pointEstimatePct: pct4(mean * 100), ci95: [ratio(mean - half), ratio(mean + half)], ci95Pct: [pct4((mean - half) * 100), pct4((mean + half) * 100)], ci95HalfWidthPct: pct4(half * 100) },
    integerPayoutCheckRtp: ratio(sum(p => p.sumPayoutCents) / rounds / 100 / costBets),
    hitRate: ratio(sum(p => p.baseHitSpins) / rounds),
    featureRate: Number((triggers / rounds).toFixed(6)), featureOneIn: triggers ? Number((rounds / triggers).toFixed(1)) : null, featureCount: triggers,
    avgFreeSpinsPerRound: ratio(freeSpins / rounds), avgFreeSpinsPlayedPerTrigger: triggers ? Number((freeSpins / triggers).toFixed(3)) : null,
    freeSpinsPlayed: freeSpins, retriggers: sum(p => p.retriggers), maxFreeSpinsInOneRound: max(p => p.maxFreeSpinsInRound),
    freeSpinHitRate: freeSpins ? ratio(freeWin / freeSpins) : null,
    stdDevPerRoundCostUnits: Number(Math.sqrt(variance).toFixed(4)), stdDevPerRoundBetUnits: Number((Math.sqrt(variance) * costBets).toFixed(4)),
    contributionPctOfCost: {
      baseGame: pct4(sum(p => p.baseH) / rounds / costBets), freeSpins: pct4(sum(p => p.freeH) / rounds / costBets), scatterPayInBase: pct4(sum(p => p.scatterH) / rounds / costBets),
      baseFirstBoardWays: pct4(sum(p => p.baseWaysH) / rounds / costBets), baseLiftChainWays: pct4(sum(p => p.liftWaysH) / rounds / costBets),
    },
    avgFreeWinPerTriggerBets: triggers ? Number((sum(p => p.freeH) / 100 / triggers).toFixed(2)) : null,
    winTiersShareOfRounds: Object.fromEntries(TIERS.map((x, k) => [`atLeast${x}xBet`, Number((sum(p => p.roundsAtLeast[k]!) / rounds).toPrecision(5))])),
    winTiersRounds: Object.fromEntries(TIERS.map((x, k) => [`atLeast${x}xBet`, sum(p => p.roundsAtLeast[k]!)])),
    maxObservedXBet: max(p => p.maxRoundHundredths) / 100, maxObservedXCost: Number((max(p => p.maxRoundHundredths) / 100 / costBets).toFixed(4)),
    capHits: sum(p => p.capHits), capHitShareOfRounds: Number((sum(p => p.capHits) / rounds).toPrecision(5)), capXBet: GOREME_MAX_WIN_MULTIPLIER,
    minSunsOnFirstBoard: parts.reduce((a, p) => Math.min(a, p.minScattersInFirstBoard), 30),
    costMismatches: sum(p => p.costMismatch),
    balloons: {
      firstBoardsWithBalloonShare: ratio(sum(p => p.firstBoardsWithBalloon) / baseSpins),
      balloonsLandedInBase: sum(p => p.balloonsLandedBase), balloonsLandedInFree: sum(p => p.balloonsLandedFree),
      balloonsPerFreeSpin: freeSpins ? Number((sum(p => p.balloonsLandedFree) / freeSpins).toFixed(4)) : null,
      maxBalloonMultiplierSeen: max(p => p.maxBalloonMultiplier), maxWeightedWaysOneWin: max(p => p.maxWeightedWays),
      mergesInBase: sum(p => p.mergesBase), mergesInFree: sum(p => p.mergesFree), exitsInBase: sum(p => p.exitsBase),
    },
    liftChain: {
      baseSpinsWithLiftShare: ratio(withLift / baseSpins), avgLiftsPerBaseSpin: Number((baseLifts / baseSpins).toFixed(4)),
      avgChainLengthWhenLifting: withLift ? Number((baseLifts / withLift).toFixed(3)) : null, maxLiftsInOneSpin: max(p => p.maxLiftsInSpin),
      chainLengthHistogram: Object.fromEntries(Array.from({ length: 21 }, (_, k) => [String(k), sumArr(p => p.liftChainHist, k)]).filter(([, v]) => (v as number) > 0)),
      windShare: { left: windTotal ? ratio(winds[0]! / windTotal) : null, calm: windTotal ? ratio(winds[1]! / windTotal) : null, right: windTotal ? ratio(winds[2]! / windTotal) : null },
    },
    sky: {
      features: triggers, moorings: sum(p => p.moorings), freeSpinLifts: sum(p => p.freeLifts),
      avgFinalSky: triggers ? Number((sum(p => p.skySum) / triggers).toFixed(3)) : null, maxFinalSky: max(p => p.maxSky),
      finalSkyAtLeastShare: Object.fromEntries(SKY_BUCKETS.map((x, k) => [`x${x}`, triggers ? Number((sum(p => p.skyAtLeast[k]!) / triggers).toPrecision(5)) : null])),
    },
    method: "normal approximation on the per-round return / cost; heavy tail makes the interval optimistic",
  };
}

const writeAtomic = (path: string, text: string): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path); };

if (!isMainThread) {
  const { seed, mode, worker, rounds, tuning } = workerData as { seed: string; mode: GoremeMode; worker: number; rounds: number; tuning: GoremeTuning };
  parentPort!.postMessage(simulateChunk(seed, mode, worker, rounds, tuning));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const rounds = Number(args.get("rounds") ?? 1_000_000), seed = args.get("seed") ?? "goreme-20261021-evidence", out = args.get("out");
  const workers = Number(args.get("workers") ?? 2), chunks = Number(args.get("chunks") ?? 1);
  const modes = (args.get("modes") ?? GOREME_MODES.join(",")).split(",") as GoremeMode[];
  const tuneFile = args.get("tune");
  const tuning: GoremeTuning = tuneFile ? JSON.parse(readFileSync(resolve(tuneFile), "utf8")) : {};
  if (!Number.isSafeInteger(rounds) || rounds < 2 || !Number.isSafeInteger(workers) || workers < 1 || !Number.isSafeInteger(chunks) || chunks < 1 || !out || modes.some(m => !GOREME_MODES.includes(m))) {
    console.error("usage: simulate.ts --rounds N --seed TEXT --out PATH [--modes standard,ante,buy] [--workers N] [--chunks N] [--ckpt DIR] [--tune FILE]"); process.exit(2);
  }
  const started = Date.now();
  const source = stripEvidenceBlock(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/protocol/src/goreme.ts"), "utf8"));
  const engineSourceSha256 = createHash("sha256").update(source).digest("hex");
  const report: Record<string, unknown> = {};
  for (const mode of modes) {
    const t0 = Date.now();
    const parts: Part[] = [];
    for (let k = 0; k < chunks; k++) {
      const chunkRounds = Math.floor(rounds / chunks) + (k < rounds % chunks ? 1 : 0), chunkSeed = chunks > 1 ? `${seed}/c${k}` : seed;
      const ckpt = resolve(args.get("ckpt") ?? `${out}.ckpt`, `${mode}-${k}-of-${chunks}-${workers}w-${chunkRounds}.json`);
      if (existsSync(ckpt)) {
        const saved = JSON.parse(readFileSync(ckpt, "utf8")) as { engineSourceSha256: string; seed: string; tuning: unknown; parts: Part[] };
        if (saved.engineSourceSha256 !== engineSourceSha256 || saved.seed !== chunkSeed || JSON.stringify(saved.tuning) !== JSON.stringify(tuning)) throw new Error(`checkpoint ${ckpt} belongs to another engine, seed or tuning`);
        parts.push(...saved.parts); console.error(`chunk ${k + 1}/${chunks} of ${mode}: loaded checkpoint`); continue;
      }
      const share = Array.from({ length: workers }, (_, w) => Math.floor(chunkRounds / workers) + (w < chunkRounds % workers ? 1 : 0));
      const done = await Promise.all(share.map((n, w) => new Promise<Part>((ok, fail) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { seed: chunkSeed, mode, worker: w, rounds: n, tuning }, execArgv: process.execArgv });
        worker.once("message", ok); worker.once("error", fail);
      })));
      // Written after every chunk (atomic rename), so a crash or a time limit never loses a finished chunk.
      writeAtomic(ckpt, JSON.stringify({ engineSourceSha256, seed: chunkSeed, tuning, parts: done }));
      parts.push(...done);
      const sofar = parts.reduce((a, p) => a + p.sumH, 0) / parts.reduce((a, p) => a + p.rounds, 0) / 100 / (GOREME_COST_FRACTION[mode][0] / GOREME_COST_FRACTION[mode][1]);
      console.error(`chunk ${k + 1}/${chunks} of ${mode}: done (${((Date.now() - t0) / 1000).toFixed(0)} s, running RTP ${(sofar * 100).toFixed(3)}%)`);
    }
    const r = buildModeReport(parts, mode) as Record<string, any>;
    r.runtimeSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    report[mode] = r;
    console.log(JSON.stringify({
      mode, rtpPct: r.rtpVsCost.pointEstimatePct, ci: r.rtpVsCost.ci95Pct, hit: r.hitRate, feature: r.featureRate, oneIn: r.featureOneIn, sd: r.stdDevPerRoundCostUnits,
      contribution: r.contributionPctOfCost, avgFreeWin: r.avgFreeWinPerTriggerBets, freeHit: r.freeSpinHitRate, freePerTrig: r.avgFreeSpinsPlayedPerTrigger,
      chain: r.liftChain.avgChainLengthWhenLifting, liftShare: r.liftChain.baseSpinsWithLiftShare, sky: r.sky.avgFinalSky, maxSky: r.sky.maxFinalSky,
      tiers: r.winTiersShareOfRounds, cap: r.capHits, maxX: r.maxObservedXBet, sec: r.runtimeSeconds,
    }));
  }
  const result = {
    kind: "goreme-rtp-simulation", scope: "DEMO credits only; Monte Carlo estimate, not a certified or guaranteed RTP; RTP is return / cost",
    engine: GOREME_ENGINE_ID, engineSourceSha256,
    engineSourceNote: "sha256 of packages/protocol/src/goreme.ts with the GOREME_RTP evidence block (between the @evidence-block markers) removed. The constants were filled after the run; no engine code, tables or RNG changed afterwards.",
    seed, workers, chunks, betCentsSimulated: BET_CENTS, betLevelsCents: GOREME_BET_LEVELS_CENTS, winTierMeasure: "round total / bet",
    tuningOverride: tuneFile ? tuning : null,
    modes: report,
    tables: { paytableTenThousandthsPerWay: GOREME_PAYTABLE, scatterAwards: GOREME_SCATTER_AWARDS, windWeights: GOREME_WIND_WEIGHTS, modeTables: GOREME_MODE_TABLES },
    runtimeSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), node: process.version, generatedAt: new Date().toISOString(),
  };
  writeAtomic(resolve(out!), JSON.stringify(result, null, 2) + "\n");
}
