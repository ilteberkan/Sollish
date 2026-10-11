/**
 * OpenAI-style evolution strategies (antithetic, centred ranks, Adam) on the NeuroBoxer sensory
 * projection + readout, with fixed anatomical recurrence. Real sparring-4 bouts; opponents are the
 * three scripted corners and frozen snapshots of the learner (league). Train seeds < 1e6; validation
 * seeds 2000-2099; the final held-out bank (5000+) is only used by evaluate.ts after training.
 *   node --import tsx experiments/neuro-boxer/train.ts <variant> <generations> <seed> [workers]
 */
import { Worker } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NEURO_IN_PARAMS, NEURO_OUT_PARAMS } from "../../packages/protocol/src/neuro-boxer";
import { runBout, type Opponent, type Variant } from "./env";

const [variant = "connectome", gensArg = "200", seedArg = "1", workersArg = "5"] = process.argv.slice(2) as [Variant, string, string, string];
const GENS = Number(gensArg), SEED = Number(seedArg), WORKERS = Number(workersArg);
const PAIRS = 24, SIGMA = .04, LR = .03, BOUTS = 4, DIM = NEURO_IN_PARAMS + NEURO_OUT_PARAMS;
let r = (SEED * 2654435761) >>> 0; const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const theta = new Float64Array(DIM);
for (let i = 0; i < NEURO_IN_PARAMS; i++) theta[i] = gauss() * .5;          // sensory projection
for (let i = NEURO_IN_PARAMS; i < DIM; i++) theta[i] = gauss() * .02;        // readout starts near zero
const m = new Float64Array(DIM), v2 = new Float64Array(DIM); let step = 0;
const league: Float64Array[] = [];
const out = `experiments/neuro-boxer/runs/${variant}-s${SEED}`; mkdirSync(out, { recursive: true });
const workers = Array.from({ length: WORKERS }, () => new Worker(new URL("./worker.ts", import.meta.url), { execArgv: ["--import", "tsx"] }));
let nextId = 0; const pending = new Map<number, (f: number) => void>();
workers.forEach(w => w.on("message", (msg: { id: number; fitness: number }) => { pending.get(msg.id)!(msg.fitness); pending.delete(msg.id); }));
let rr = 0; const evaluate = (t: Float64Array, bouts: unknown[]) => new Promise<number>(resolve => { const id = nextId++; pending.set(id, resolve); workers[rr++ % WORKERS]!.postMessage({ id, theta: t, variant, bouts }); });
const styles = ["balanced", "pressure", "counter"] as const;
const validate = () => {
  let score = 0, n = 0, ko = 0; const attacks: Record<string, number> = {}; let passivity = 0;
  for (const style of styles) for (let k = 0; k < 6; k++) { const b = runBout(theta, variant, { kind: "bot", style }, 2000 + k, (k % 2) as 0 | 1); score += b.score; n++; if (b.ko && b.won) ko++; passivity += b.passivity; for (const [a, c] of Object.entries(b.attacks)) attacks[a] = (attacks[a] ?? 0) + c; }
  return { score: +(score / n).toFixed(3), koWins: ko, passivity: +(passivity / n).toFixed(3), attacks };
};
const log: unknown[] = []; const t0 = Date.now();
for (let gen = 1; gen <= GENS; gen++) {
  // Same opponents and seeds for every candidate of a generation (common random numbers).
  const bouts = Array.from({ length: BOUTS }, (_, k) => {
    const useLeague = league.length > 0 && k === BOUTS - 1;
    const opponent: Opponent = useLeague ? { kind: "neuro", theta: league[Math.floor(rnd() * league.length)]! } : { kind: "bot", style: styles[(gen + k) % 3]! };
    return { opponent, seed: 10 + Math.floor(rnd() * 999_000), side: (k % 2) as 0 | 1 };
  });
  const noise = Array.from({ length: PAIRS }, () => { const e = new Float64Array(DIM); for (let i = 0; i < DIM; i++) e[i] = gauss(); return e; });
  const jobs: Promise<number>[] = [];
  for (const e of noise) for (const sign of [1, -1]) { const t = new Float64Array(DIM); for (let i = 0; i < DIM; i++) t[i] = theta[i]! + sign * SIGMA * e[i]!; jobs.push(evaluate(t, bouts)); }
  const fit = await Promise.all(jobs);
  const order = fit.map((f, i) => [f, i] as const).sort((a, b) => a[0] - b[0]), ranks = new Float64Array(fit.length);
  order.forEach(([, i], k) => { ranks[i] = k / (fit.length - 1) - .5; });
  const grad = new Float64Array(DIM);
  noise.forEach((e, p) => { const w = ranks[2 * p]! - ranks[2 * p + 1]!; for (let i = 0; i < DIM; i++) grad[i] += w * e[i]!; });
  step++;
  for (let i = 0; i < DIM; i++) {
    const g = -grad[i]! / (PAIRS * SIGMA) + .005 * theta[i]!; // ascent on fitness with small weight decay
    m[i] = .9 * m[i]! + .1 * g; v2[i] = .999 * v2[i]! + .001 * g * g;
    theta[i] -= LR * (m[i]! / (1 - .9 ** step)) / (Math.sqrt(v2[i]! / (1 - .999 ** step)) + 1e-8);
  }
  if (gen % 25 === 0) league.push(new Float64Array(theta)); if (league.length > 6) league.shift();
  const meanFit = fit.reduce((a, b) => a + b, 0) / fit.length;
  const entry: Record<string, unknown> = { gen, meanFitness: +meanFit.toFixed(4), best: +Math.max(...fit).toFixed(4), seconds: Math.round((Date.now() - t0) / 1000) };
  if (gen % 10 === 0 || gen === GENS) { entry.validation = validate(); writeFileSync(`${out}/theta.json`, JSON.stringify({ variant, seed: SEED, generation: gen, dim: DIM, theta: Array.from(theta, x => +x.toFixed(6)) })); }
  log.push(entry); console.log(JSON.stringify(entry));
  writeFileSync(`${out}/log.json`, JSON.stringify(log));
}
const final = JSON.stringify({ variant, seed: SEED, generation: GENS, dim: DIM, theta: Array.from(theta, x => +x.toFixed(6)) });
writeFileSync(`${out}/theta.json`, final);
writeFileSync(`${out}/summary.json`, JSON.stringify({ variant, seed: SEED, generations: GENS, pairs: PAIRS, sigma: SIGMA, lr: LR, boutsPerCandidate: BOUTS, thetaSha256: createHash("sha256").update(final).digest("hex"), seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
await Promise.all(workers.map(w => w.terminate()));
