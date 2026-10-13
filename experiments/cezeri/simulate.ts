/** Monte Carlo evidence for the Cezeri engine `cezeri-gears-1` (DEMO only, not a certified RTP).
 * Run: bash scripts/use-node.sh node --import tsx experiments/cezeri/simulate.ts --rounds 20000000 --seed <text> --out <path> [--modes standard,ante,buy] [--workers 4]
 * Tuning runs only: --tune <json file> overrides the engine tuning ({"tables":{"ante":{"base":[{"strip":"...","vesselStop":30},...]}},"paytable":{...}}); the
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
  CEZERI_BET_LEVELS_CENTS, CEZERI_COST_FRACTION, CEZERI_ENGINE_ID, CEZERI_FALCON_COUNT, CEZERI_GEAR_PAY, CEZERI_MAX_WIN_MULTIPLIER, CEZERI_MODE_TABLES, CEZERI_MODES,
  CEZERI_PAYTABLE, CEZERI_SCATTER_PAY, __cezeriTest, cezeriSeedFromEntropy, type CezeriMode, type CezeriTuning,
} from "../../packages/protocol/src/cezeri.ts";

/** The RTP constants live inside cezeri.ts and are filled from this very evidence, so the engine hash is taken
 * over the file with the marked evidence block removed (engine code, tables and docs only). */
export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
const BET_CENTS = 100; // 1 cent == 1 hundredth of bet, so payoutCents equals totalHundredths exactly
const TIERS = [10, 25, 50, 100, 500, 1000, 2000, 5000, 10000] as const; // x bet

interface Part {
  rounds: number; sumH: number; sumSqH: string; sumPayoutCents: number; baseH: number; freeH: number; scatterH: number; chainBaseH: number;
  baseHitSpins: number; baseChainHitSpins: number; triggers: number; retriggers: number; freeSpinsPlayed: number; freeWinSpins: number;
  rotationsHist: number[]; freeRotationsHist: number[]; freeRespins: number; finalHubSum: number; finalHubMax: number; falconVisits: number; finalWildsSum: number;
  capHits: number; maxRoundHundredths: number; maxFreeSpinsInRound: number; minVesselsInBaseBoard: number; costMismatch: number; roundsAtLeast: number[];
  freeSpinsByTrigger: number; vesselsHist: number[]; chainCaps: number;
}

function simulateChunk(seed: string, mode: CezeriMode, worker: number, rounds: number, tuning: CezeriTuning): Part {
  const state = createHash("sha256").update(`${seed}:${mode}:${worker}`).digest("hex").slice(0, 32);
  const rng = __cezeriTest.createRng(state);
  const p: Part = {
    rounds, sumH: 0, sumSqH: "0", sumPayoutCents: 0, baseH: 0, freeH: 0, scatterH: 0, chainBaseH: 0, baseHitSpins: 0, baseChainHitSpins: 0, triggers: 0,
    retriggers: 0, freeSpinsPlayed: 0, freeWinSpins: 0, rotationsHist: new Array<number>(12).fill(0), freeRotationsHist: new Array<number>(12).fill(0), chainCaps: 0, freeRespins: 0, finalHubSum: 0, finalHubMax: 0,
    falconVisits: 0, finalWildsSum: 0, capHits: 0, maxRoundHundredths: 0, maxFreeSpinsInRound: 0, minVesselsInBaseBoard: 48, costMismatch: 0,
    roundsAtLeast: TIERS.map(() => 0), freeSpinsByTrigger: 0, vesselsHist: [0, 0, 0, 0, 0, 0],
  };
  let sumSq = 0n;
  const play = __cezeriTest.player(tuning);
  const entropy = new Uint32Array(4);
  const expectedCost = (BET_CENTS * CEZERI_COST_FRACTION[mode][0]) / CEZERI_COST_FRACTION[mode][1];
  for (let i = 0; i < rounds; i++) {
    entropy[0] = rng(); entropy[1] = rng(); entropy[2] = rng(); entropy[3] = rng();
    const round = play(cezeriSeedFromEntropy(entropy), BET_CENTS, mode);
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
        if (spin.chainHundredths > 0) p.baseChainHitSpins++;
        p.chainBaseH += spin.chainHundredths;
        p.scatterH += spin.scatterHundredths;
        p.rotationsHist[spin.rotations]!++;
        if (spin.steps.some(st => st.type === "end" && st.chainCapped)) p.chainCaps++;
        p.vesselsHist[Math.min(5, spin.vesselCount)]!++;
        const first = spin.steps.find(s => s.type === "rotate");
        if (first && first.type === "rotate") {
          let v = 0;
          for (const ring of first.board) for (const sym of ring) if (sym === "vessel") v++;
          if (v < p.minVesselsInBaseBoard) p.minVesselsInBaseBoard = v;
        }
      } else {
        p.freeH += delta; p.freeSpinsPlayed++; freeInRound++;
        if (spin.freeSpinsAwarded > 0) p.retriggers++;
        if (spin.chainHundredths > 0) p.freeWinSpins++;
        p.freeRotationsHist[spin.rotations]!++;
        if (spin.steps.some(st => st.type === "end" && st.chainCapped)) p.chainCaps++;
        p.freeRespins += spin.respins;
        if (spin.steps.some(s => s.type === "falcon")) p.falconVisits++;
      }
    }
    if (round.freeSpinsTriggered) {
      const last = round.spins.at(-1)!;
      p.finalHubSum += last.hubEnd;
      if (last.hubEnd > p.finalHubMax) p.finalHubMax = last.hubEnd;
      p.finalWildsSum += last.wilds.length;
      p.freeSpinsByTrigger += freeInRound;
    }
    if (freeInRound > p.maxFreeSpinsInRound) p.maxFreeSpinsInRound = freeInRound;
  }
  p.sumSqH = sumSq.toString();
  return p;
}

if (!isMainThread) {
  const { seed, mode, worker, rounds, tuning } = workerData as { seed: string; mode: CezeriMode; worker: number; rounds: number; tuning: CezeriTuning };
  parentPort!.postMessage(simulateChunk(seed, mode, worker, rounds, tuning));
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const rounds = Number(args.get("rounds") ?? 1_000_000), seed = args.get("seed") ?? "cezeri-20261012-evidence", out = args.get("out");
  const workers = Number(args.get("workers") ?? 4);
  const modes = (args.get("modes") ?? CEZERI_MODES.join(",")).split(",") as CezeriMode[];
  const tuneFile = args.get("tune");
  const tuning: CezeriTuning = tuneFile ? JSON.parse(readFileSync(resolve(tuneFile), "utf8")) : {};
  if (!Number.isSafeInteger(rounds) || rounds < 2 || !Number.isSafeInteger(workers) || workers < 1 || !out || modes.some(m => !CEZERI_MODES.includes(m))) {
    console.error("usage: simulate.ts --rounds N --seed TEXT --out PATH [--modes standard,ante,buy] [--workers N] [--tune FILE]"); process.exit(2);
  }
  const started = Date.now();
  const source = stripEvidenceBlock(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/protocol/src/cezeri.ts"), "utf8"));
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
    const hist = (f: (p: Part) => number[]): number[] => f(parts[0]!).map((_, i) => sum(p => f(p)[i]!));
    const [num, den] = CEZERI_COST_FRACTION[mode];
    const costBets = num / den; // cost in units of the bet
    const sumH = sum(p => p.sumH), sumSq = parts.reduce((a, p) => a + BigInt(p.sumSqH), 0n);
    const mean = sumH / rounds / 100 / costBets;                          // return per round in COST units
    const meanSq = Number(sumSq) / rounds / 10_000 / (costBets * costBets);
    const variance = Math.max(0, (meanSq - mean * mean) * rounds / (rounds - 1));
    const half = 1.96 * Math.sqrt(variance / rounds);
    const triggers = sum(p => p.triggers), freeSpins = sum(p => p.freeSpinsPlayed), freeWin = sum(p => p.freeWinSpins);
    const tierShare = (x: number): number => sum(p => p.roundsAtLeast[TIERS.indexOf(x as never)]!) / rounds;
    const rot = hist(p => p.rotationsHist), freeRot = hist(p => p.freeRotationsHist);
    const winningChains = rounds - 0 === 0 ? 0 : sum(p => p.baseChainHitSpins);
    const respinsBase = rot.reduce((a, n, k) => a + n * Math.max(0, k - 1), 0);
    report[mode] = {
      rounds, costBets,
      rtpVsCost: { pointEstimate: ratio(mean), pointEstimatePct: pct4(mean * 100), ci95: [ratio(mean - half), ratio(mean + half)], ci95Pct: [pct4((mean - half) * 100), pct4((mean + half) * 100)], ci95HalfWidthPct: pct4(half * 100) },
      integerPayoutCheckRtp: ratio(sum(p => p.sumPayoutCents) / rounds / 100 / costBets),
      hitRate: ratio(sum(p => p.baseHitSpins) / rounds),
      baseChainHitRate: ratio(winningChains / rounds),
      featureRate: Number((triggers / rounds).toFixed(6)), featureOneIn: triggers ? Number((rounds / triggers).toFixed(1)) : null, featureCount: triggers,
      avgFreeSpinsPerRound: ratio(freeSpins / rounds), avgFreeSpinsPerTrigger: triggers ? Number((freeSpins / triggers).toFixed(3)) : null,
      freeSpinsPlayed: freeSpins, retriggers: sum(p => p.retriggers), maxFreeSpinsInOneRound: max(p => p.maxFreeSpinsInRound),
      freeSpinHitRate: freeSpins ? ratio(freeWin / freeSpins) : null,
      respinChain: {
        baseRotationsHistogram: Object.fromEntries(rot.map((n, k) => [`rotations${k}`, n]).slice(1)),
        avgRespinsPerBaseSpin: ratio(respinsBase / rounds),
        avgRespinsPerWinningBaseChain: winningChains ? ratio(respinsBase / winningChains) : null,
        baseChainsWithAtLeast5RespinsShare: winningChains ? Number((rot.slice(6).reduce((a, n) => a + n, 0) / winningChains).toPrecision(4)) : null,
        baseChainsWithAtLeast3RespinsShare: winningChains ? Number((rot.slice(4).reduce((a, n) => a + n, 0) / winningChains).toPrecision(4)) : null,
        chainsEndedByRespinCap: sum(p => p.chainCaps),
        freeRotationsHistogram: Object.fromEntries(freeRot.map((n, k) => [`rotations${k}`, n]).slice(1)),
        avgRespinsPerFreeSpin: freeSpins ? ratio(sum(p => p.freeRespins) / freeSpins) : null,
        avgRespinsPerWinningFreeChain: freeWin ? ratio(sum(p => p.freeRespins) / freeWin) : null,
        maxRotationsInOneSpin: 11,
      },
      avgFinalHubInFeatures: triggers ? Number((sum(p => p.finalHubSum) / triggers).toFixed(2)) : null, maxFinalHub: max(p => p.finalHubMax),
      falconVisits: sum(p => p.falconVisits), avgFalconWildsAtFeatureEnd: triggers ? Number((sum(p => p.finalWildsSum) / triggers).toFixed(2)) : null,
      baseVesselsHistogram: Object.fromEntries(hist(p => p.vesselsHist).map((n, k) => [k === 5 ? "5plus" : String(k), n])),
      stdDevPerRoundCostUnits: Number(Math.sqrt(variance).toFixed(4)), stdDevPerRoundBetUnits: Number((Math.sqrt(variance) * costBets).toFixed(4)),
      contributionPctOfCost: { baseChain: pct4(sum(p => p.chainBaseH) / rounds / costBets), scatterPayInBase: pct4(sum(p => p.scatterH) / rounds / costBets), freeSpins: pct4(sum(p => p.freeH) / rounds / costBets) },
      avgFreeWinPerTriggerBets: triggers ? Number((sum(p => p.freeH) / 100 / triggers).toFixed(2)) : null,
      winTiersShareOfRounds: Object.fromEntries(TIERS.map(x => [`atLeast${x}xBet`, Number(tierShare(x).toPrecision(5))])),
      winTiersRounds: Object.fromEntries(TIERS.map((x, k) => [`atLeast${x}xBet`, sum(p => p.roundsAtLeast[k]!)])),
      maxObservedXBet: max(p => p.maxRoundHundredths) / 100, maxObservedXCost: Number((max(p => p.maxRoundHundredths) / 100 / costBets).toFixed(4)),
      capHits: sum(p => p.capHits), capHitShareOfRounds: Number((sum(p => p.capHits) / rounds).toPrecision(5)), capXBet: CEZERI_MAX_WIN_MULTIPLIER,
      minVesselsOnFirstBaseBoard: parts.reduce((a, p) => Math.min(a, p.minVesselsInBaseBoard), 48),
      costMismatches: sum(p => p.costMismatch),
      method: "normal approximation on the per-round return / cost; heavy tail makes the interval optimistic",
      runtimeSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    const r = report[mode] as Record<string, any>;
    console.log(JSON.stringify({
      mode, rtpPct: r.rtpVsCost.pointEstimatePct, ci: r.rtpVsCost.ci95Pct, hit: r.hitRate, feature: r.featureRate, oneIn: r.featureOneIn, sd: r.stdDevPerRoundCostUnits,
      contribution: r.contributionPctOfCost, avgFreeWin: r.avgFreeWinPerTriggerBets, avgFreeSpins: r.avgFreeSpinsPerTrigger, avgFinalHub: r.avgFinalHubInFeatures, freeHit: r.freeSpinHitRate,
      respin: r.respinChain.avgRespinsPerWinningBaseChain, tiers: r.winTiersShareOfRounds, cap: r.capHits, maxX: r.maxObservedXBet, sec: r.runtimeSeconds,
    }));
  }
  const result = {
    kind: "cezeri-rtp-simulation", scope: "DEMO credits only; Monte Carlo estimate, not a certified or guaranteed RTP; RTP is return / cost",
    engine: CEZERI_ENGINE_ID, engineSourceSha256: createHash("sha256").update(source).digest("hex"),
    engineSourceNote: "sha256 of packages/protocol/src/cezeri.ts with the CEZERI_RTP evidence block (between the @evidence-block markers) removed. The constants were filled after the run; no engine code, tables or RNG changed afterwards.",
    seed, workers, betCentsSimulated: BET_CENTS, betLevelsCents: CEZERI_BET_LEVELS_CENTS, winTierMeasure: "round total / bet",
    tuningOverride: tuneFile ? tuning : null,
    modes: report,
    tables: { paytableHundredths: CEZERI_PAYTABLE, gearPayHundredths: CEZERI_GEAR_PAY, scatterPayHundredths: CEZERI_SCATTER_PAY, falconCount: CEZERI_FALCON_COUNT, modeTables: CEZERI_MODE_TABLES },
    runtimeSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), node: process.version, generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(out!)), { recursive: true });
  writeFileSync(resolve(out!), JSON.stringify(result, null, 2) + "\n");
}
