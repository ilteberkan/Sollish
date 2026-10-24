/** Independent RTP re-simulation of every server-playable slot game and mode (RTP audit 2026-10-23).
 *
 * Run:  bash scripts/use-node.sh node --import tsx ops/rtp-audit/resim.ts --rounds 2000000 --workers 2 --out ops/evidence/rtp-audit-20261023/resim.json
 *       [--games cascade,tarhun] [--modes standard] [--parts DIR]
 *
 * Independence from the original evidence runs (experiments/<game>/simulate.ts):
 * - The originals drew round seeds from per-worker xoshiro streams (sha256("<game>-<date>-evidence:<mode>:<worker>")) and called the
 *   engines' internal test entry (`__<game>Test.play` with a tuning argument). This audit calls the PUBLIC registry entry
 *   `SLOT_GAMES[game].play/cost` (the exact functions the RGS server and the browser run) and derives every round seed with the
 *   provably-fair rule of the RGS (packages/protocol/src/slot-fair.ts deriveSeedHex):
 *     serverSeed(game, mode) = sha256("sollish-rtp-audit-20261023/resim/<game>/<mode>")   (32 raw bytes)
 *     clientSeed             = "rtp-audit-20261023"
 *     seedHex(nonce)         = first 16 bytes of HMAC-SHA256(serverSeed, "<clientSeed>:<nonce>"), nonce = 0 .. rounds-1
 *   That namespace was never used by any evidence run. The nonce range is split into contiguous blocks per worker and the integer
 *   sums are merged exactly (BigInt), so the result is identical for any worker count.
 * - Bet = 100 cents (1 DEMO), RTP = sum(payoutCents) / sum(costCents) (what the ledger credits / debits). The bet-unit total
 *   (totalHundredths) is summed too, as a cross-check.
 * - Statistics: per-round return r = payout / cost; mean, sample standard deviation, 95% CI = mean +- 1.96 * sd / sqrt(n)
 *   (normal approximation; optimistic for heavy-tailed modes, same method as the originals).
 */
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import { SLOT_GAMES } from "../../packages/protocol/src/slot-games.ts";
import { deriveSeedHex } from "../../packages/protocol/src/slot-fair.ts";

export const AUDIT_NAMESPACE = "sollish-rtp-audit-20261023/resim";
export const AUDIT_CLIENT_SEED = "rtp-audit-20261023";
const BET_CENTS = 100;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Original evidence per game (claimed RTP and its interval). */
export const EVIDENCE: Readonly<Record<string, { dir: string; engineFile: string }>> = {
  cascade: { dir: "ops/evidence/candy-cascade-2-20261011", engineFile: "packages/protocol/src/cascade-2.ts" },
  tarhun: { dir: "ops/evidence/storm-throne-20261012", engineFile: "packages/protocol/src/storm-throne.ts" },
  ebru: { dir: "ops/evidence/ebru-20261012", engineFile: "packages/protocol/src/ebru.ts" },
  cezeri: { dir: "ops/evidence/cezeri-20261012", engineFile: "packages/protocol/src/cezeri.ts" },
  asena: { dir: "ops/evidence/asena-20261012", engineFile: "packages/protocol/src/asena.ts" },
  goreme: { dir: "ops/evidence/goreme-20261021", engineFile: "packages/protocol/src/goreme.ts" },
  damla: { dir: "ops/evidence/damla-20261021", engineFile: "packages/protocol/src/damla.ts" },
};

export function serverSeedOf(game: string, mode: string, namespace: string = AUDIT_NAMESPACE): Buffer {
  return createHash("sha256").update(`${namespace}/${game}/${mode}`).digest();
}
/** Synchronous twin of slot-fair deriveSeedHex (checked against it before every run). */
export function seedHexOf(serverSeed: Buffer, nonce: number): string {
  return createHmac("sha256", serverSeed).update(`${AUDIT_CLIENT_SEED}:${nonce}`).digest().subarray(0, 16).toString("hex");
}

interface Part {
  from: number; to: number; rounds: number; sumPayout: string; sumPayoutSq: string; sumCost: string; sumTotalHundredths: string;
  hits: number; capped: number; features: number; maxPayoutCents: number; maxTotalHundredths: number; maxSeedHex: string; costMismatches: number; firstSeeds: string[];
}

function runPart(game: string, mode: string, from: number, to: number, namespace: string): Part {
  const def = SLOT_GAMES[game]!;
  const serverSeed = serverSeedOf(game, mode, namespace);
  const expectedCost = def.cost(BET_CENTS, mode);
  let sumPayout = 0, sumCost = 0, sumTotal = 0, sumSq = 0n, hits = 0, capped = 0, features = 0, maxPayout = -1, maxTotal = 0, maxSeed = "", costMismatches = 0;
  const firstSeeds: string[] = [];
  for (let nonce = from; nonce < to; nonce++) {
    const seedHex = seedHexOf(serverSeed, nonce);
    if (firstSeeds.length < 2) firstSeeds.push(seedHex);
    const round = def.play(seedHex, BET_CENTS, mode);
    const p = round.payoutCents;
    if (round.costCents !== expectedCost) costMismatches++;
    sumPayout += p; sumCost += round.costCents; sumTotal += round.totalHundredths;
    if (p > 0) { hits++; sumSq += BigInt(p) * BigInt(p); }
    if (round.capped) capped++;
    if (round.freeSpinsTriggered) features++;
    if (p > maxPayout) { maxPayout = p; maxSeed = seedHex; }
    if (round.totalHundredths > maxTotal) maxTotal = round.totalHundredths;
    if (!Number.isSafeInteger(sumPayout)) throw new Error("sum overflow");
  }
  return {
    from, to, rounds: to - from, sumPayout: String(sumPayout), sumPayoutSq: String(sumSq), sumCost: String(sumCost), sumTotalHundredths: String(sumTotal),
    hits, capped, features, maxPayoutCents: maxPayout, maxTotalHundredths: maxTotal, maxSeedHex: maxSeed, costMismatches, firstSeeds,
  };
}

if (!isMainThread) {
  const { game, mode, from, to, namespace } = workerData as { game: string; mode: string; from: number; to: number; namespace: string };
  parentPort!.postMessage(runPart(game, mode, from, to, namespace));
}

/* ------------------------------------------------------------------ claimed values from the original evidence */
interface Claim {
  claimedRtp: number; claimedSource: string; originalPoint: number; originalCi95: [number, number]; originalRounds: number; originalStdDev: number | null;
  originalHitRate: number | null; originalSeed: string; codeConstantRtp: number | null;
}
export function claimOf(game: string, mode: string): Claim {
  const ev = JSON.parse(readFileSync(resolve(ROOT, EVIDENCE[game]!.dir, "rtp.json"), "utf8"));
  const m = ev.modes[mode];
  if (!m) throw new Error(`no evidence for ${game}/${mode}`);
  const code = SLOT_GAMES[game]!.rtp[mode]?.rtp ?? null;
  if (game === "damla") {
    return { claimedRtp: m.exactRtp, claimedSource: "exact binomial RTP (modes.<mode>.exactRtp)", originalPoint: m.mcRtp, originalCi95: m.ci95, originalRounds: m.rounds,
      originalStdDev: m.stdDev, originalHitRate: null, originalSeed: ev.seed, codeConstantRtp: code };
  }
  return { claimedRtp: m.rtpVsCost.pointEstimate, claimedSource: "Monte Carlo point estimate (modes.<mode>.rtpVsCost.pointEstimate)", originalPoint: m.rtpVsCost.pointEstimate,
    originalCi95: m.rtpVsCost.ci95, originalRounds: m.rounds, originalStdDev: m.stdDevPerRoundCostUnits ?? null, originalHitRate: m.hitRate ?? null, originalSeed: ev.seed, codeConstantRtp: code };
}

function writeAtomic(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path); }
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

async function runMode(game: string, mode: string, rounds: number, workers: number, namespace: string) {
  const serverSeed = serverSeedOf(game, mode, namespace);
  for (const nonce of [0, 1, rounds - 1]) {
    if (seedHexOf(serverSeed, nonce) !== await deriveSeedHex(serverSeed.toString("hex"), AUDIT_CLIENT_SEED, nonce)) throw new Error("seed derivation differs from slot-fair deriveSeedHex");
  }
  const started = Date.now();
  const blocks = Array.from({ length: workers }, (_, w) => [Math.floor((rounds * w) / workers), Math.floor((rounds * (w + 1)) / workers)] as const);
  const parts = await Promise.all(blocks.map(([from, to]) => new Promise<Part>((ok, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { game, mode, from, to, namespace }, execArgv: process.execArgv });
    worker.once("message", ok); worker.once("error", fail);
  })));
  const n = BigInt(rounds);
  const sum = parts.reduce((a, p) => a + BigInt(p.sumPayout), 0n), sq = parts.reduce((a, p) => a + BigInt(p.sumPayoutSq), 0n), cost = parts.reduce((a, p) => a + BigInt(p.sumCost), 0n);
  const total = parts.reduce((a, p) => a + BigInt(p.sumTotalHundredths), 0n);
  const costPerRound = SLOT_GAMES[game]!.cost(BET_CENTS, mode);
  const rtp = Number(sum * 1_000_000_000_000n / cost) / 1e12;
  // sample variance of payout (cents^2) = (n*sq - sum^2) / (n*(n-1)); sd in cost units
  const varCents = Number(n * sq - sum * sum) / (Number(n) * (rounds - 1));
  const sd = Math.sqrt(varCents) / costPerRound;
  const se = sd / Math.sqrt(rounds);
  const ci: [number, number] = [rtp - 1.96 * se, rtp + 1.96 * se];
  const claim = claimOf(game, mode);
  const origHalf = (claim.originalCi95[1] - claim.originalCi95[0]) / 2, origSe = origHalf / 1.96;
  const z = game === "damla" ? (rtp - claim.claimedRtp) / se : (rtp - claim.originalPoint) / Math.sqrt(se * se + origSe * origSe);
  const maxPayout = Math.max(...parts.map(p => p.maxPayoutCents));
  const claimedInside = claim.claimedRtp >= ci[0] && claim.claimedRtp <= ci[1];
  const newInsideOriginal = rtp >= claim.originalCi95[0] && rtp <= claim.originalCi95[1];
  return {
    game, mode, engineId: SLOT_GAMES[game]!.engineId, rounds, betCents: BET_CENTS, costCentsPerRound: costPerRound,
    seed: { serverSeedText: `${namespace}/${game}/${mode}`, serverSeedHex: serverSeed.toString("hex"), clientSeed: AUDIT_CLIENT_SEED, nonces: [0, rounds - 1],
      firstSeedHex: parts[0]!.firstSeeds[0] },
    sumPayoutCents: String(sum), sumCostCents: String(cost), sumTotalHundredths: String(total),
    rtp: r6(rtp), rtpFromBetUnits: r6(Number((total * BigInt(BET_CENTS) * 1_000_000_000_000n) / (cost * 100n)) / 1e12),
    stdDevPerRoundCostUnits: Math.round(sd * 1e4) / 1e4, ci95: [r6(ci[0]), r6(ci[1])], ci95HalfWidth: r6(1.96 * se),
    hitFrequency: r6(parts.reduce((a, p) => a + p.hits, 0) / rounds), featureRate: r6(parts.reduce((a, p) => a + p.features, 0) / rounds),
    cappedRounds: parts.reduce((a, p) => a + p.capped, 0), costMismatches: parts.reduce((a, p) => a + p.costMismatches, 0),
    maxWin: { payoutCents: maxPayout, xBet: maxPayout / BET_CENTS, xCost: r6(maxPayout / costPerRound), seedHex: parts.find(p => p.maxPayoutCents === maxPayout)!.maxSeedHex,
      capXBet: SLOT_GAMES[game]!.maxMultiplier },
    claim, claimedInsideNewCi95: claimedInside, newInsideOriginalCi95: newInsideOriginal, zVsOriginal: Math.round(z * 1000) / 1000,
    verdict: claimedInside && parts.every(p => p.costMismatches === 0) ? "PASS" : "FAIL",
    runtimeSeconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

async function main() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1]!);
  const rounds = Number(args.get("rounds") ?? 2_000_000), workers = Number(args.get("workers") ?? 2);
  const out = resolve(args.get("out") ?? "ops/evidence/rtp-audit-20261023/resim.json");
  const partsDir = resolve(args.get("parts") ?? `${dirname(out)}/resim-parts`);
  const games = (args.get("games") ?? Object.keys(EVIDENCE).join(",")).split(",");
  const onlyModes = args.get("modes")?.split(",");
  const namespace = args.get("namespace") ?? AUDIT_NAMESPACE;
  if (!namespace.startsWith("sollish-rtp-audit-")) throw new Error("--namespace must start with sollish-rtp-audit- (never an evidence seed)");
  if (!Number.isSafeInteger(rounds) || rounds < 2 || !Number.isSafeInteger(workers) || workers < 1 || workers > 4) throw new Error("bad --rounds/--workers");
  const engineSha = Object.fromEntries(Object.entries(EVIDENCE).map(([g, e]) => [g, createHash("sha256").update(readFileSync(resolve(ROOT, e.engineFile))).digest("hex")]));
  const results: unknown[] = [];
  for (const game of games) {
    const def = SLOT_GAMES[game];
    if (!def) throw new Error(`unknown game ${game}`);
    for (const mode of def.modes) {
      if (onlyModes && !onlyModes.includes(mode)) continue;
      const partFile = resolve(partsDir, `${game}-${mode}.json`);
      if (existsSync(partFile)) {
        const saved = JSON.parse(readFileSync(partFile, "utf8"));
        if (saved.rounds === rounds && saved.engineSourceSha256 === engineSha[game] && saved.seed?.serverSeedText === `${namespace}/${game}/${mode}`) { results.push(saved); console.log(`${game}/${mode}: reused ${partFile}`); continue; }
      }
      const r = { ...(await runMode(game, mode, rounds, workers, namespace)), engineSourceSha256: engineSha[game] };
      writeAtomic(partFile, JSON.stringify(r, null, 2));
      results.push(r);
      console.log(JSON.stringify({ game, mode, rtp: r.rtp, ci95: r.ci95, claimed: r.claim.claimedRtp, z: r.zVsOriginal, verdict: r.verdict, sec: r.runtimeSeconds }));
    }
  }
  writeAtomic(out, JSON.stringify({
    kind: "rtp-audit-resim", date: "2026-10-23", scope: "DEMO credits only; independent Monte Carlo re-simulation, not a certification",
    command: `bash scripts/use-node.sh node --import tsx ops/rtp-audit/resim.ts --rounds ${rounds} --workers ${workers}${namespace === AUDIT_NAMESPACE ? "" : ` --namespace ${namespace}`}${args.get("games") ? ` --games ${args.get("games")}` : ""}${onlyModes ? ` --modes ${onlyModes.join(",")}` : ""} --out ${args.get("out") ?? "ops/evidence/rtp-audit-20261023/resim.json"}`,
    node: process.version, method: {
      seeds: `serverSeed = sha256("${namespace}/<game>/<mode>"), clientSeed = "${AUDIT_CLIENT_SEED}", seedHex = HMAC-SHA256(serverSeed, "<clientSeed>:<nonce>")[0..16], nonce 0..rounds-1 (slot-fair deriveSeedHex rule)`,
      engine: "SLOT_GAMES[game].play / .cost (public registry; same functions as the RGS server and the browser)",
      rtp: "sum(payoutCents) / sum(costCents) at bet 100 cents", ci: "normal approximation, mean +- 1.96 sd/sqrt(n)",
      verdict: "PASS when the claimed RTP lies inside the new 95% interval and every round cost equals the registry cost; else FAIL",
      zVsOriginal: "(new - original) / sqrt(seNew^2 + seOriginal^2); Damla: (new - exact) / seNew",
    },
    namespace, engineSourceSha256: engineSha, rounds, workers, results,
  }, null, 2));
  console.log(`wrote ${out}`);
}
if (isMainThread) main().catch(e => { console.error(e); process.exit(1); });
