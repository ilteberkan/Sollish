/** Monte Carlo evidence for the Storm Throne engine `storm-throne-1` (DEMO only, not a certified RTP).
 * Run: bash scripts/use-node.sh node --import tsx experiments/storm-throne/simulate.ts --rounds 20000000 --seed <text> --out <path> [--modes standard,ante,buy] [--workers 4]
 * Tuning runs only: --tune <json file> overrides the engine tuning ({"tables":{"ante":{"base":[...]}},"paytable":{...},"orbs":[...]}); the
 * override is recorded in the output and evidence runs never use it.
 * Round seeds come from per-worker xoshiro streams derived from sha256(seed:mode:worker), so a given
 * (seed, rounds, workers, modes) tuple always reproduces the same numbers. RTP is return / COST.
 * Win tiers are multiples of the BET (round total / bet), the same measure as the in-game tier screens. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import {
  STORM_BET_LEVELS_CENTS, STORM_COST_FRACTION, STORM_ENGINE_ID, STORM_MAX_WIN_MULTIPLIER, STORM_MODE_TABLES, STORM_MODES, STORM_ORB_WEIGHTS,
  STORM_PAYTABLE, STORM_SCATTER_PAY, __stormTest, stormSeedFromEntropy, type StormMode, type StormTuning,
} from "../../packages/protocol/src/storm-throne.ts";

/** The RTP constants live inside storm-throne.ts and are filled from this very evidence, so the engine hash is taken
 * over the file with the marked evidence block removed (engine code, tables and docs only). */
export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
const BET_CENTS = 100; // 1 cent == 1 hundredth of bet, so payoutCents equals totalHundredths exactly
const TIERS = [10, 25, 50, 100, 500, 1000, 2000, 5000] as const; // x bet

interface Part {
  rounds: number; sumH: number; sumSqH: string; sumPayoutCents: number; baseH: number; freeH: number; scatterH: number;
  baseHitSpins: number; baseOrbSpins: number; baseOrbWinSpins: number; triggers: number; retriggers: number; freeSpinsPlayed: number; freeWinSpins: number;
  freeOrbSpins: number; finalTotalMultiplierSum: number; finalTotalMultiplierMax: number; capHits: number;
  maxOrbSum: number; maxRoundHundredths: number; maxTumblesInSpin: number; maxFreeSpinsInRound: number;
  minScattersInBaseGrid: number; costMismatch: number; roundsAtLeast: number[];
}

function simulateChunk(seed: string, mode: StormMode, worker: number, rounds: number, tuning: StormTuning): Part {
  const state = createHash("sha256").update(`${seed}:${mode}:${worker}`).digest("hex").slice(0, 32);
  const rng = __stormTest.createRng(state);
  const p: Part = {
    rounds, sumH: 0, sumSqH: "0", sumPayoutCents: 0, baseH: 0, freeH: 0, scatterH: 0, baseHitSpins: 0, baseOrbSpins: 0, baseOrbWinSpins: 0, triggers: 0,
    retriggers: 0, freeSpinsPlayed: 0, freeWinSpins: 0, freeOrbSpins: 0, finalTotalMultiplierSum: 0, finalTotalMultiplierMax: 0, capHits: 0,
    maxOrbSum: 0, maxRoundHundredths: 0, maxTumblesInSpin: 0, maxFreeSpinsInRound: 0, minScattersInBaseGrid: 30, costMismatch: 0,
    roundsAtLeast: TIERS.map(() => 0),
  };
  let sumSq = 0n;
  const entropy = new Uint32Array(4);
  const expectedCost = (BET_CENTS * STORM_COST_FRACTION[mode][0]) / STORM_COST_FRACTION[mode][1];
  for (let i = 0; i < rounds; i++) {
    entropy[0] = rng(); entropy[1] = rng(); entropy[2] = rng(); entropy[3] = rng();
    const round = __stormTest.play(stormSeedFromEntropy(entropy), BET_CENTS, mode, tuning);
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
        p.baseH += delta;
        if (spin.winHundredths > 0) p.baseHitSpins++;
        if (spin.orbSum > 0) { p.baseOrbSpins++; if (spin.tumbleHundredths > 0) p.baseOrbWinSpins++; }
        p.scatterH += spin.scatterHundredths;
        let scatters = 0;
        for (const column of spin.steps[0]!.grid) for (const cell of column) if (cell.symbol === "scatter") scatters++;
        if (scatters < p.minScattersInBaseGrid) p.minScattersInBaseGrid = scatters;
      } else {
        p.freeH += delta; p.freeSpinsPlayed++; freeInRound++;
        if (spin.freeSpinsAwarded > 0) p.retriggers++;
        if (spin.tumbleHundredths > 0) p.freeWinSpins++;
        if (spin.orbSum > 0) p.freeOrbSpins++;
      }
      if (spin.orbSum > p.maxOrbSum) p.maxOrbSum = spin.orbSum;
      if (spin.steps.length > p.maxTumblesInSpin) p.maxTumblesInSpin = spin.steps.length;
    }
    if (round.freeSpinsTriggered) {
      const last = round.spins.at(-1)!.totalMultiplierAfter;
      p.finalTotalMultiplierSum += last;
      if (last > p.finalTotalMultiplierMax) p.finalTotalMultiplierMax = last;
    }
    if (freeInRound > p.maxFreeSpinsInRound) p.maxFreeSpinsInRound = freeInRound;
  }
  p.sumSqH = sumSq.toString();
  return p;
}

if (!isMainThread) {
  const { seed, mode, worker, rounds, tuning } = workerData as { seed: string; mode: StormMode; worker: number; rounds: number; tuning: StormTuning };
  parentPort!.postMessage(simulateChunk(seed, mode, worker, rounds, tuning));
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const rounds = Number(args.get("rounds") ?? 1_000_000), seed = args.get("seed") ?? "storm-throne-20261012-evidence", out = args.get("out");
  const workers = Number(args.get("workers") ?? 4);
  const modes = (args.get("modes") ?? STORM_MODES.join(",")).split(",") as StormMode[];
  const tuneFile = args.get("tune");
  const tuning: StormTuning = tuneFile ? JSON.parse(readFileSync(resolve(tuneFile), "utf8")) : {};
  if (!Number.isSafeInteger(rounds) || rounds < 2 || !Number.isSafeInteger(workers) || workers < 1 || !out || modes.some(m => !STORM_MODES.includes(m))) {
    console.error("usage: simulate.ts --rounds N --seed TEXT --out PATH [--modes standard,ante,buy] [--workers N] [--tune FILE]"); process.exit(2);
  }
  const started = Date.now();
  const source = stripEvidenceBlock(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/protocol/src/storm-throne.ts"), "utf8"));
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
    const [num, den] = STORM_COST_FRACTION[mode];
    const costBets = num / den; // cost in units of the bet
    const sumH = sum(p => p.sumH), sumSq = parts.reduce((a, p) => a + BigInt(p.sumSqH), 0n);
    const mean = sumH / rounds / 100 / costBets;                          // return per round in COST units
    const meanSq = Number(sumSq) / rounds / 10_000 / (costBets * costBets);
    const variance = Math.max(0, (meanSq - mean * mean) * rounds / (rounds - 1));
    const half = 1.96 * Math.sqrt(variance / rounds);
    const triggers = sum(p => p.triggers), freeSpins = sum(p => p.freeSpinsPlayed), freeWin = sum(p => p.freeWinSpins);
    const tierShare = (x: number): number => sum(p => p.roundsAtLeast[TIERS.indexOf(x as never)]!) / rounds;
    report[mode] = {
      rounds, costBets,
      rtpVsCost: { pointEstimate: ratio(mean), pointEstimatePct: pct4(mean * 100), ci95: [ratio(mean - half), ratio(mean + half)], ci95Pct: [pct4((mean - half) * 100), pct4((mean + half) * 100)], ci95HalfWidthPct: pct4(half * 100) },
      integerPayoutCheckRtp: ratio(sum(p => p.sumPayoutCents) / rounds / 100 / costBets),
      hitRate: ratio(sum(p => p.baseHitSpins) / rounds),
      featureRate: Number((triggers / rounds).toFixed(6)), featureOneIn: triggers ? Number((rounds / triggers).toFixed(1)) : null, featureCount: triggers,
      avgFreeSpinsPerRound: ratio(freeSpins / rounds), avgFreeSpinsPerTrigger: triggers ? Number((freeSpins / triggers).toFixed(3)) : null,
      freeSpinsPlayed: freeSpins, retriggers: sum(p => p.retriggers), maxFreeSpinsInOneRound: max(p => p.maxFreeSpinsInRound),
      freeSpinHitRate: freeSpins ? ratio(freeWin / freeSpins) : null, freeSpinsWithOrbsShare: freeSpins ? ratio(sum(p => p.freeOrbSpins) / freeSpins) : null,
      avgFinalTotalMultiplierInFeatures: triggers ? Number((sum(p => p.finalTotalMultiplierSum) / triggers).toFixed(2)) : null,
      maxFinalTotalMultiplier: max(p => p.finalTotalMultiplierMax),
      baseSpinsWithOrbsShare: ratio(sum(p => p.baseOrbSpins) / rounds), baseSpinsWithOrbsAndTumbleWinShare: ratio(sum(p => p.baseOrbWinSpins) / rounds),
      stdDevPerRoundCostUnits: Number(Math.sqrt(variance).toFixed(4)), stdDevPerRoundBetUnits: Number((Math.sqrt(variance) * costBets).toFixed(4)),
      contributionPctOfCost: { baseGame: pct4(sum(p => p.baseH) / rounds / costBets), freeSpins: pct4(sum(p => p.freeH) / rounds / costBets), scatterPayInBase: pct4(sum(p => p.scatterH) / rounds / costBets) },
      avgFreeWinPerTriggerBets: triggers ? Number((sum(p => p.freeH) / 100 / triggers).toFixed(2)) : null,
      winTiersShareOfRounds: Object.fromEntries(TIERS.map(x => [`atLeast${x}xBet`, Number(tierShare(x).toPrecision(5))])),
      winTiersRounds: Object.fromEntries(TIERS.map((x, k) => [`atLeast${x}xBet`, sum(p => p.roundsAtLeast[k]!)])),
      maxObservedOrbSum: max(p => p.maxOrbSum),
      maxObservedXBet: max(p => p.maxRoundHundredths) / 100, maxObservedXCost: Number((max(p => p.maxRoundHundredths) / 100 / costBets).toFixed(4)),
      maxTumblesInOneSpin: max(p => p.maxTumblesInSpin),
      capHits: sum(p => p.capHits), capHitShareOfRounds: Number((sum(p => p.capHits) / rounds).toPrecision(5)), capXBet: STORM_MAX_WIN_MULTIPLIER,
      minScattersInInitialBaseGrid: parts.reduce((a, p) => Math.min(a, p.minScattersInBaseGrid), 30),
      costMismatches: sum(p => p.costMismatch),
      method: "normal approximation on the per-round return / cost; heavy tail makes the interval optimistic",
      runtimeSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    const r = report[mode] as Record<string, any>;
    console.log(JSON.stringify({
      mode, rtpPct: r.rtpVsCost.pointEstimatePct, ci: r.rtpVsCost.ci95Pct, hit: r.hitRate, feature: r.featureRate, oneIn: r.featureOneIn, sd: r.stdDevPerRoundCostUnits,
      contribution: r.contributionPctOfCost, avgFreeWin: r.avgFreeWinPerTriggerBets, avgTotMult: r.avgFinalTotalMultiplierInFeatures, freeHit: r.freeSpinHitRate,
      baseOrb: r.baseSpinsWithOrbsShare, tiers: r.winTiersShareOfRounds, cap: r.capHits, maxX: r.maxObservedXBet, sec: r.runtimeSeconds,
    }));
  }
  const result = {
    kind: "storm-throne-rtp-simulation", scope: "DEMO credits only; Monte Carlo estimate, not a certified or guaranteed RTP; RTP is return / cost",
    engine: STORM_ENGINE_ID, engineSourceSha256: createHash("sha256").update(source).digest("hex"),
    engineSourceNote: "sha256 of packages/protocol/src/storm-throne.ts with the STORM_RTP evidence block (between the @evidence-block markers) removed. The constants were filled after the run; no engine code, tables or RNG changed afterwards.",
    seed, workers, betCentsSimulated: BET_CENTS, betLevelsCents: STORM_BET_LEVELS_CENTS, winTierMeasure: "round total / bet",
    tuningOverride: tuneFile ? tuning : null,
    modes: report,
    tables: { paytableHundredths: STORM_PAYTABLE, scatterPayHundredths: STORM_SCATTER_PAY, orbWeights: STORM_ORB_WEIGHTS, modeTables: STORM_MODE_TABLES },
    runtimeSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), node: process.version, generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(out!)), { recursive: true });
  writeFileSync(resolve(out!), JSON.stringify(result, null, 2) + "\n");
}
