/** Monte Carlo evidence for ONE Damla mode (DEMO only). One process per mode (see run.sh); results are flushed to disk after every chunk
 * so an interrupted run loses at most the chunk in progress and a rerun resumes.
 * Run: bash scripts/use-node.sh node experiments/damla/simulate.ts --mode medium-12 --rounds 20000000 --seed <text> --out <dir> [--workers 2] [--chunk 1000000]
 * Every round is played through the real engine function playDamlaRound (bet 100 cents, so payoutCents == totalHundredths). Round seeds
 * come from per-(chunk, worker) xoshiro streams derived from sha256(seed:mode:chunk:worker), so a (seed, mode, rounds, workers, chunk)
 * tuple reproduces the same numbers. The output keeps the exact slot histogram, from which RTP and variance are computed exactly. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import { DAMLA_MODES, DAMLA_PAYTABLES, __damlaTest, damlaSeedFromEntropy, playDamlaRound, type DamlaMode } from "../../packages/protocol/src/damla.ts";

const BET_CENTS = 100;
export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
export const engineSha256 = (): string => createHash("sha256").update(stripEvidenceBlock(readFileSync(new URL("../../packages/protocol/src/damla.ts", import.meta.url), "utf8"))).digest("hex");

interface Job { mode: DamlaMode; rounds: number; streamSeed: string }
interface ChunkResult { histogram: number[]; capHits: number; mismatches: number }
function runBlock(job: Job): ChunkResult {
  const rows = Number(job.mode.split("-")[1]), histogram = new Array<number>(rows + 1).fill(0), rng = __damlaTest.createRng(job.streamSeed), table = DAMLA_PAYTABLES[job.mode]!;
  let capHits = 0, mismatches = 0;
  for (let i = 0; i < job.rounds; i++) {
    const round = playDamlaRound(damlaSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])), BET_CENTS, job.mode);
    histogram[round.slot]!++;
    if (round.capped) capHits++;
    if (round.payoutCents !== table[round.slot]! || round.payoutCents !== round.totalHundredths) mismatches++;
  }
  return { histogram, capHits, mismatches };
}
const streamSeed = (seed: string, mode: string, chunk: number, worker: number): string => createHash("sha256").update(`${seed}:${mode}:${chunk}:${worker}`).digest("hex").slice(0, 32);

if (!isMainThread) {
  parentPort!.postMessage(runBlock(workerData as Job));
} else {
  const arg = (name: string, fallback?: string): string => { const i = process.argv.indexOf(`--${name}`); const v = i > 0 ? process.argv[i + 1] : fallback; if (v === undefined) throw new Error(`missing --${name}`); return v; };
  const mode = arg("mode") as DamlaMode, rounds = Number(arg("rounds", "20000000")), seed = arg("seed"), workers = Math.min(2, Number(arg("workers", "2"))), chunk = Number(arg("chunk", "1000000"));
  if (!DAMLA_MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
  const dir = resolve(arg("out")), file = `${dir}/mode-${mode}.json`, rows = Number(mode.split("-")[1]);
  mkdirSync(dir, { recursive: true });
  const sha = engineSha256();
  const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { kind: "damla-mode-simulation", engine: "damla-terraces-1", engineSourceSha256: sha, mode, seed, chunk, workers, targetRounds: rounds, betCentsSimulated: BET_CENTS, chunksDone: 0, rounds: 0, histogram: new Array(rows + 1).fill(0), capHits: 0, mismatches: 0, startedAt: new Date().toISOString() };
  if (state.engineSourceSha256 !== sha || state.seed !== seed || state.chunk !== chunk || state.workers !== workers) throw new Error(`${file} was produced with other settings or engine bytes; remove it to start over`);
  const total = Math.ceil(rounds / chunk);
  const runChunk = (index: number): Promise<ChunkResult> => {
    const size = Math.min(chunk, rounds - index * chunk), per = Math.ceil(size / workers);
    return Promise.all(Array.from({ length: workers }, (_, w) => new Promise<ChunkResult>((res, rej) => {
      const count = Math.min(per, size - w * per);
      if (count <= 0) return res({ histogram: new Array(rows + 1).fill(0), capHits: 0, mismatches: 0 });
      const worker = new Worker(new URL(import.meta.url), { workerData: { mode, rounds: count, streamSeed: streamSeed(seed, mode, index, w) } satisfies Job, execArgv: process.execArgv });
      worker.once("message", res); worker.once("error", rej);
    }))).then(parts => ({
      histogram: parts[0]!.histogram.map((_, k) => parts.reduce((s, p) => s + p.histogram[k]!, 0)),
      capHits: parts.reduce((s, p) => s + p.capHits, 0), mismatches: parts.reduce((s, p) => s + p.mismatches, 0),
    }));
  };
  for (let index = state.chunksDone; index < total; index++) {
    const t0 = Date.now(), r = await runChunk(index);
    state.histogram = state.histogram.map((v: number, k: number) => v + r.histogram[k]!);
    state.rounds += r.histogram.reduce((s, v) => s + v, 0); state.capHits += r.capHits; state.mismatches += r.mismatches; state.chunksDone = index + 1; state.updatedAt = new Date().toISOString();
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2) + "\n"); renameSync(`${file}.tmp`, file); // flush after every chunk
    console.log(`${mode} chunk ${index + 1}/${total} rounds ${state.rounds} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  console.log(`${mode} done: ${state.rounds} rounds`);
}
