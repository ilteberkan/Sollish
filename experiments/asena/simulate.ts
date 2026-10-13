/** Monte Carlo evidence for the Asena engine `asena-stars-1` (DEMO only, not a certified RTP).
 * Run: bash scripts/use-node.sh node --import tsx experiments/asena/simulate.ts --rounds 20000000 --seed <text> --out <path> [--modes standard,ante,buy] [--workers 4]
 * Tuning runs only: --tune <json file> overrides the engine tuning ({"tables":{"ante":{"base":[...]}},"paytable":{...},"templateMultipliers":[...]}); the
 * override is recorded in the output and evidence runs never use it.
 * Round seeds come from per-worker xoshiro streams derived from sha256(seed:mode:worker), so a given
 * (seed, rounds, workers, modes) tuple always reproduces the same numbers. RTP is return / COST.
 * Win tiers are multiples of the BET (round total / bet), the same measure as the in-game tier screens. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import {
  ASENA_BET_LEVELS_CENTS, ASENA_COST_FRACTION, ASENA_ENGINE_ID, ASENA_MAP_MULTIPLIERS, ASENA_MAX_WIN_MULTIPLIER, ASENA_MODE_TABLES, ASENA_MODES,
  ASENA_PAYTABLE, ASENA_SCATTER_PAY, ASENA_TEMPLATES, __asenaTest, asenaSeedFromEntropy, type AsenaMode, type AsenaTuning,
} from "../../packages/protocol/src/asena.ts";

/** The RTP constants live inside asena.ts and are filled from this very evidence, so the engine hash is taken
 * over the file with the marked evidence block removed (engine code, tables and docs only). */
export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
const BET_CENTS = 100; // 1 cent == 1 hundredth of bet, so payoutCents equals totalHundredths exactly
const TIERS = [10, 25, 50, 100, 500, 1000, 2000, 5000] as const; // x bet
const T = ASENA_TEMPLATES.length;

interface Part {
  rounds: number; sumH: number; sumSqH: string; sumPayoutCents: number; baseH: number; freeH: number; scatterH: number;
  baseHitSpins: number; triggers: number; retriggers: number; freeSpinsPlayed: number; freeWinSpins: number; capHits: number;
  maxRoundHundredths: number; maxTumblesInSpin: number; maxFreeSpinsInRound: number; minScattersInBaseGrid: number; costMismatch: number; roundsAtLeast: number[];
  baseClusters: number; freeClusters: number; baseIgnitions: number[]; freeIgnitions: number[]; baseSteps: number; freeSteps: number;
  baseSpinsWithIgnition: number; freeSpinsWithIgnition: number;
  baseSpinsWithWolf: number; freeSpinsWithWolf: number; baseSpins: number; walks: number; baseWalks: number; freeWalks: number; spinsWithWalk: number; maxWalksInSpin: number;
  maxTrailsOnBoard: number; trailSpins: number; clustersWithTrail: number; maxWolfPathCells: number;
  scatterSpinsAwarded: number; mapSpinsAwarded: number; reached3: number; reached6: number; reachedTwice: number; distinctSum: number; distinctHist: number[];
  mult2: number; mult3: number; mult5: number; finalMultSum: number; mapSpinsFeatures: number; hitsByMultiplier: Record<string, number>; tiersBaseOnlyRounds: number;
  baseSpinTriggerFromMoons: number;
}
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

function simulateChunk(seed: string, mode: AsenaMode, worker: number, rounds: number, tuning: AsenaTuning): Part {
  const state = createHash("sha256").update(`${seed}:${mode}:${worker}`).digest("hex").slice(0, 32);
  const rng = __asenaTest.createRng(state);
  const p: Part = {
    rounds, sumH: 0, sumSqH: "0", sumPayoutCents: 0, baseH: 0, freeH: 0, scatterH: 0, baseHitSpins: 0, triggers: 0, retriggers: 0, freeSpinsPlayed: 0, freeWinSpins: 0, capHits: 0,
    maxRoundHundredths: 0, maxTumblesInSpin: 0, maxFreeSpinsInRound: 0, minScattersInBaseGrid: 36, costMismatch: 0, roundsAtLeast: TIERS.map(() => 0),
    baseClusters: 0, freeClusters: 0, baseIgnitions: zeros(T), freeIgnitions: zeros(T), baseSteps: 0, freeSteps: 0, baseSpinsWithIgnition: 0, freeSpinsWithIgnition: 0,
    baseSpinsWithWolf: 0, freeSpinsWithWolf: 0, baseSpins: 0, walks: 0, baseWalks: 0, freeWalks: 0, spinsWithWalk: 0, maxWalksInSpin: 0, maxTrailsOnBoard: 0, trailSpins: 0,
    clustersWithTrail: 0, maxWolfPathCells: 0, scatterSpinsAwarded: 0, mapSpinsAwarded: 0, reached3: 0, reached6: 0, reachedTwice: 0, distinctSum: 0, distinctHist: zeros(T + 1),
    mult2: 0, mult3: 0, mult5: 0, finalMultSum: 0, mapSpinsFeatures: 0, hitsByMultiplier: {}, tiersBaseOnlyRounds: 0, baseSpinTriggerFromMoons: 0,
  };
  let sumSq = 0n;
  const entropy = new Uint32Array(4);
  const expectedCost = (BET_CENTS * ASENA_COST_FRACTION[mode][0]) / ASENA_COST_FRACTION[mode][1];
  for (let i = 0; i < rounds; i++) {
    entropy[0] = rng(); entropy[1] = rng(); entropy[2] = rng(); entropy[3] = rng();
    const round = __asenaTest.play(asenaSeedFromEntropy(entropy), BET_CENTS, mode, tuning);
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
        let moons = 0;
        for (const column of spin.steps[0]!.grid) for (const cell of column) if (cell.symbol === "moon") moons++;
        if (moons < p.minScattersInBaseGrid) p.minScattersInBaseGrid = moons;
      } else {
        p.freeH += delta; p.freeSpinsPlayed++; freeInRound++;
        if (spin.freeSpinsAwarded > 0) p.retriggers++;
        if (spin.tumbleHundredths > 0) p.freeWinSpins++;
      }
      p.scatterSpinsAwarded += spin.scatterSpinsAwarded; p.mapSpinsAwarded += spin.mapSpinsAwarded;
      if (spin.steps.length > p.maxTumblesInSpin) p.maxTumblesInSpin = spin.steps.length;
      // wolf / trail / constellation statistics
      let hadWolf = false, ignited = false, walksInSpin = 0;
      for (const grid of [spin.steps[0]!.grid]) for (const column of grid) for (const cell of column) if (cell.symbol === "wolf") hadWolf = true;
      if (hadWolf) { if (base) p.baseSpinsWithWolf++; else p.freeSpinsWithWolf++; }
      for (const step of spin.steps) {
        if (base) p.baseSteps++; else p.freeSteps++;
        for (const cluster of step.clusters) {
          if (base) p.baseClusters++; else p.freeClusters++;
          if (cluster.constellation) { ignited = true; (base ? p.baseIgnitions : p.freeIgnitions)[cluster.constellation.templateIndex]!++; }
        }
        walksInSpin += step.wolfWalks.length;
        if (step.clusters.length > 0) {
          let trailBoard = false;
          for (const column of step.grid) for (const cell of column) if (cell.symbol === "trail") trailBoard = true;
          if (trailBoard) for (const cluster of step.clusters) {
            const ids = new Set(cluster.cells);
            let has = false;
            for (const column of step.grid) for (const cell of column) if (cell.symbol === "trail" && ids.has(cell.id)) has = true;
            if (has) p.clustersWithTrail++;
          }
        }
      }
      if (ignited) { if (base) p.baseSpinsWithIgnition++; else p.freeSpinsWithIgnition++; }
      p.walks += walksInSpin; if (base) p.baseWalks += walksInSpin; else p.freeWalks += walksInSpin;
      if (walksInSpin > 0) p.spinsWithWalk++;
      if (walksInSpin > p.maxWalksInSpin) p.maxWalksInSpin = walksInSpin;
      let trails = 0;
      for (const column of spin.steps.at(-1)!.grid) for (const cell of column) if (cell.symbol === "trail") trails++;
      if (trails > 0) p.trailSpins++;
      if (trails > p.maxTrailsOnBoard) p.maxTrailsOnBoard = trails;
      for (const path of spin.wolfPaths) if (path.cells.length > p.maxWolfPathCells) p.maxWolfPathCells = path.cells.length;
    }
    if (round.freeSpinsTriggered) {
      const last = round.spins.at(-1)!;
      const distinct = last.mapAfter.filter(x => x >= 1).length;
      p.distinctSum += distinct; p.distinctHist[distinct]!++;
      p.finalMultSum += last.globalMultiplierAfter;
      if (distinct >= 3) p.reached3++;
      if (distinct >= 6) p.reached6++;
      if (last.mapAfter.every(x => x >= 2)) p.reachedTwice++;
      if (last.globalMultiplierAfter >= 2) p.mult2++;
      if (last.globalMultiplierAfter >= 3) p.mult3++;
      if (last.globalMultiplierAfter >= 5) p.mult5++;
      const key = String(last.globalMultiplierAfter);
      p.hitsByMultiplier[key] = (p.hitsByMultiplier[key] ?? 0) + 1;
    }
    if (freeInRound > p.maxFreeSpinsInRound) p.maxFreeSpinsInRound = freeInRound;
  }
  p.sumSqH = sumSq.toString();
  return p;
}

if (!isMainThread) {
  const { seed, mode, worker, rounds, tuning } = workerData as { seed: string; mode: AsenaMode; worker: number; rounds: number; tuning: AsenaTuning };
  parentPort!.postMessage(simulateChunk(seed, mode, worker, rounds, tuning));
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const rounds = Number(args.get("rounds") ?? 1_000_000), seed = args.get("seed") ?? "asena-20261012-evidence", out = args.get("out");
  const workers = Number(args.get("workers") ?? 4), chunks = Number(args.get("chunks") ?? 1);
  const modes = (args.get("modes") ?? ASENA_MODES.join(",")).split(",") as AsenaMode[];
  const tuneFile = args.get("tune");
  const tuning: AsenaTuning = tuneFile ? JSON.parse(readFileSync(resolve(tuneFile), "utf8")) : {};
  if (!Number.isSafeInteger(rounds) || rounds < 2 || !Number.isSafeInteger(workers) || workers < 1 || !Number.isSafeInteger(chunks) || chunks < 1 || !out || modes.some(m => !ASENA_MODES.includes(m))) {
    console.error("usage: simulate.ts --rounds N --seed TEXT --out PATH [--modes standard,ante,buy] [--workers N] [--chunks N] [--tune FILE]"); process.exit(2);
  }
  const started = Date.now();
  const source = stripEvidenceBlock(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/protocol/src/asena.ts"), "utf8"));
  const pct4 = (x: number): number => Number(x.toFixed(4));
  const ratio = (x: number): number => Number(x.toFixed(5));
  const report: Record<string, unknown> = {};
  for (const mode of modes) {
    const t0 = Date.now();
    // --chunks N splits the run into N independent sub-runs (seed "<seed>/c<k>") whose raw counters are checkpointed to <out>.ckpt/ so a killed run resumes.
    const parts: Part[] = [];
    for (let k = 0; k < chunks; k++) {
      const chunkRounds = Math.floor(rounds / chunks) + (k < rounds % chunks ? 1 : 0), chunkSeed = chunks > 1 ? `${seed}/c${k}` : seed;
      const ckpt = resolve(`${out}.ckpt`, `${mode}-${k}-of-${chunks}-${workers}w-${chunkRounds}.json`);
      if (chunks > 1 && existsSync(ckpt)) { parts.push(...(JSON.parse(readFileSync(ckpt, "utf8")) as Part[])); console.error(`chunk ${k + 1}/${chunks} of ${mode}: loaded checkpoint`); continue; }
      const share = Array.from({ length: workers }, (_, w) => Math.floor(chunkRounds / workers) + (w < chunkRounds % workers ? 1 : 0));
      const done = await Promise.all(share.map((n, w) => new Promise<Part>((ok, fail) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { seed: chunkSeed, mode, worker: w, rounds: n, tuning }, execArgv: process.execArgv });
        worker.once("message", ok); worker.once("error", fail);
      })));
      if (chunks > 1) { mkdirSync(dirname(ckpt), { recursive: true }); writeFileSync(ckpt, JSON.stringify(done)); console.error(`chunk ${k + 1}/${chunks} of ${mode}: done`); }
      parts.push(...done);
    }
    const sum = (f: (p: Part) => number): number => parts.reduce((a, p) => a + f(p), 0);
    const max = (f: (p: Part) => number): number => parts.reduce((a, p) => Math.max(a, f(p)), 0);
    const sumArr = (f: (p: Part) => number[], k: number): number => parts.reduce((a, p) => a + f(p)[k]!, 0);
    const [num, den] = ASENA_COST_FRACTION[mode];
    const costBets = num / den; // cost in units of the bet
    const sumH = sum(p => p.sumH), sumSq = parts.reduce((a, p) => a + BigInt(p.sumSqH), 0n);
    const mean = sumH / rounds / 100 / costBets;                          // return per round in COST units
    const meanSq = Number(sumSq) / rounds / 10_000 / (costBets * costBets);
    const variance = Math.max(0, (meanSq - mean * mean) * rounds / (rounds - 1));
    const half = 1.96 * Math.sqrt(variance / rounds);
    const triggers = sum(p => p.triggers), freeSpins = sum(p => p.freeSpinsPlayed), freeWin = sum(p => p.freeWinSpins);
    const baseSpins = sum(p => p.baseSpins), baseClusters = sum(p => p.baseClusters), freeClusters = sum(p => p.freeClusters);
    const tierShare = (x: number): number => sum(p => p.roundsAtLeast[TIERS.indexOf(x as never)]!) / rounds;
    const hist: Record<string, number> = {};
    for (let k = 0; k <= T; k++) hist[String(k)] = sumArr(p => p.distinctHist, k);
    const mults: Record<string, number> = {};
    for (const p of parts) for (const [k, v] of Object.entries(p.hitsByMultiplier)) mults[k] = (mults[k] ?? 0) + v;
    report[mode] = {
      rounds, costBets,
      rtpVsCost: { pointEstimate: ratio(mean), pointEstimatePct: pct4(mean * 100), ci95: [ratio(mean - half), ratio(mean + half)], ci95Pct: [pct4((mean - half) * 100), pct4((mean + half) * 100)], ci95HalfWidthPct: pct4(half * 100) },
      integerPayoutCheckRtp: ratio(sum(p => p.sumPayoutCents) / rounds / 100 / costBets),
      hitRate: ratio(sum(p => p.baseHitSpins) / rounds),
      featureRate: Number((triggers / rounds).toFixed(6)), featureOneIn: triggers ? Number((rounds / triggers).toFixed(1)) : null, featureCount: triggers,
      avgFreeSpinsPerRound: ratio(freeSpins / rounds), avgFreeSpinsPlayedPerTrigger: triggers ? Number((freeSpins / triggers).toFixed(3)) : null,
      freeSpinsPlayed: freeSpins, retriggers: sum(p => p.retriggers), maxFreeSpinsInOneRound: max(p => p.maxFreeSpinsInRound),
      freeSpinHitRate: freeSpins ? ratio(freeWin / freeSpins) : null,
      stdDevPerRoundCostUnits: Number(Math.sqrt(variance).toFixed(4)), stdDevPerRoundBetUnits: Number((Math.sqrt(variance) * costBets).toFixed(4)),
      contributionPctOfCost: { baseGame: pct4(sum(p => p.baseH) / rounds / costBets), freeSpins: pct4(sum(p => p.freeH) / rounds / costBets), scatterPayInBase: pct4(sum(p => p.scatterH) / rounds / costBets) },
      avgFreeWinPerTriggerBets: triggers ? Number((sum(p => p.freeH) / 100 / triggers).toFixed(2)) : null,
      winTiersShareOfRounds: Object.fromEntries(TIERS.map(x => [`atLeast${x}xBet`, Number(tierShare(x).toPrecision(5))])),
      winTiersRounds: Object.fromEntries(TIERS.map((x, k) => [`atLeast${x}xBet`, sum(p => p.roundsAtLeast[k]!)])),
      maxObservedXBet: max(p => p.maxRoundHundredths) / 100, maxObservedXCost: Number((max(p => p.maxRoundHundredths) / 100 / costBets).toFixed(4)),
      maxStepsInOneSpin: max(p => p.maxTumblesInSpin),
      capHits: sum(p => p.capHits), capHitShareOfRounds: Number((sum(p => p.capHits) / rounds).toPrecision(5)), capXBet: ASENA_MAX_WIN_MULTIPLIER,
      minMoonsInInitialBaseGrid: parts.reduce((a, p) => Math.min(a, p.minScattersInBaseGrid), 36),
      costMismatches: sum(p => p.costMismatch),
      constellations: {
        clustersInBase: baseClusters, clustersInFree: freeClusters,
        perTemplate: Object.fromEntries(ASENA_TEMPLATES.map((t, k) => {
          const b = sumArr(p => p.baseIgnitions, k), f = sumArr(p => p.freeIgnitions, k);
          return [t.id, {
            multiplier: t.multiplier, cells: t.cells.length, ignitionsInBase: b, ignitionsInFree: f,
            perBaseCluster: baseClusters ? Number((b / baseClusters).toPrecision(4)) : null, perFreeCluster: freeClusters ? Number((f / freeClusters).toPrecision(4)) : null,
            perBaseSpin: Number((b / baseSpins).toPrecision(4)), perFreeSpin: freeSpins ? Number((f / freeSpins).toPrecision(4)) : null,
          }];
        })),
        baseSpinsWithIgnitionShare: ratio(sum(p => p.baseSpinsWithIgnition) / baseSpins), freeSpinsWithIgnitionShare: freeSpins ? ratio(sum(p => p.freeSpinsWithIgnition) / freeSpins) : null,
        baseClustersPerSpin: Number((baseClusters / baseSpins).toFixed(4)), freeClustersPerSpin: freeSpins ? Number((freeClusters / freeSpins).toFixed(4)) : null,
      },
      wolf: {
        baseSpinsWithWolfOnInitialBoardShare: ratio(sum(p => p.baseSpinsWithWolf) / baseSpins), freeSpinsWithWolfOnInitialBoardShare: freeSpins ? ratio(sum(p => p.freeSpinsWithWolf) / freeSpins) : null,
        totalWalks: sum(p => p.walks), walksInBase: sum(p => p.baseWalks), walksInFree: sum(p => p.freeWalks),
        walksPerBaseSpin: Number((sum(p => p.baseWalks) / baseSpins).toFixed(4)), walksPerFreeSpin: freeSpins ? Number((sum(p => p.freeWalks) / freeSpins).toFixed(4)) : null,
        spinsWithAtLeastOneWalkShare: ratio(sum(p => p.spinsWithWalk) / (baseSpins + freeSpins)), spinsEndingWithTrailWildsShare: ratio(sum(p => p.trailSpins) / (baseSpins + freeSpins)),
        maxWalksInOneSpin: max(p => p.maxWalksInSpin), maxTrailWildsOnFinalBoard: max(p => p.maxTrailsOnBoard), maxWolfPathCells: max(p => p.maxWolfPathCells),
        clustersContainingATrailWild: sum(p => p.clustersWithTrail),
      },
      ergenekon: {
        features: triggers, avgDistinctConstellationsAtEnd: triggers ? Number((sum(p => p.distinctSum) / triggers).toFixed(3)) : null, distinctAtEndHistogram: hist,
        shareReaching3Distinct: triggers ? ratio(sum(p => p.reached3) / triggers) : null, shareReaching6Distinct: triggers ? Number((sum(p => p.reached6) / triggers).toPrecision(4)) : null,
        shareAllSixTwice: triggers ? Number((sum(p => p.reachedTwice) / triggers).toPrecision(4)) : null,
        finalGlobalMultiplierHistogram: mults, avgFinalGlobalMultiplier: triggers ? Number((sum(p => p.finalMultSum) / triggers).toFixed(3)) : null,
        spinsAwardedByMoons: sum(p => p.scatterSpinsAwarded), spinsAwardedByMap: sum(p => p.mapSpinsAwarded),
        avgFreeSpinsGrantedPerTrigger: triggers ? Number(((sum(p => p.scatterSpinsAwarded) + sum(p => p.mapSpinsAwarded) - triggers * 0) / triggers).toFixed(3)) : null,
      },
      method: "normal approximation on the per-round return / cost; heavy tail makes the interval optimistic",
      runtimeSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    const r = report[mode] as Record<string, any>;
    console.log(JSON.stringify({
      mode, rtpPct: r.rtpVsCost.pointEstimatePct, ci: r.rtpVsCost.ci95Pct, hit: r.hitRate, feature: r.featureRate, oneIn: r.featureOneIn, sd: r.stdDevPerRoundCostUnits,
      contribution: r.contributionPctOfCost, avgFreeWin: r.avgFreeWinPerTriggerBets, freeHit: r.freeSpinHitRate, freePerTrig: r.avgFreeSpinsPlayedPerTrigger,
      ign: Object.fromEntries(Object.entries(r.constellations.perTemplate).map(([k, v]: [string, any]) => [k, [v.perBaseSpin, v.perFreeSpin]])),
      erg: { d: r.ergenekon.avgDistinctConstellationsAtEnd, m: r.ergenekon.finalGlobalMultiplierHistogram },
      wolf: { w: r.wolf.walksPerBaseSpin, wf: r.wolf.walksPerFreeSpin }, tiers: r.winTiersShareOfRounds, cap: r.capHits, maxX: r.maxObservedXBet, sec: r.runtimeSeconds,
    }));
  }
  const result = {
    kind: "asena-rtp-simulation", scope: "DEMO credits only; Monte Carlo estimate, not a certified or guaranteed RTP; RTP is return / cost",
    engine: ASENA_ENGINE_ID, engineSourceSha256: createHash("sha256").update(source).digest("hex"),
    engineSourceNote: "sha256 of packages/protocol/src/asena.ts with the ASENA_RTP evidence block (between the @evidence-block markers) removed. The constants were filled after the run; no engine code, tables or RNG changed afterwards.",
    seed, workers, chunks, betCentsSimulated: BET_CENTS, betLevelsCents: ASENA_BET_LEVELS_CENTS, winTierMeasure: "round total / bet",
    tuningOverride: tuneFile ? tuning : null,
    modes: report,
    tables: {
      paytableHundredths: ASENA_PAYTABLE, scatterPayHundredths: ASENA_SCATTER_PAY, mapMultipliers: ASENA_MAP_MULTIPLIERS, modeTables: ASENA_MODE_TABLES,
      templates: ASENA_TEMPLATES.map(t => ({ id: t.id, name: t.name, multiplier: t.multiplier, cells: t.cells })),
    },
    runtimeSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), node: process.version, generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(out!)), { recursive: true });
  writeFileSync(resolve(out!), JSON.stringify(result, null, 2) + "\n");
}
