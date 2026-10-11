/**
 * NeuroBoxer v2 (neuro-2) training with the same estimator as neuro-1's train.ts (antithetic evolution
 * strategies, centred ranks, Adam, small weight decay), in three stages on the real sparring engine:
 *  A  tactical brain only (inW, outW). Every candidate fights all six styles once (style fixed per bout);
 *     fitness = outcome + 0.5 x that style's shaping term. 3 x 20 s bouts keep round/scorecard inputs in range.
 *  B  strategist head only (Ws), tactical weights frozen. 3-round bouts (3 x 30 s), outcome fitness only.
 *  C  everything at lr 0.01. Half the bouts strategist-driven (outcome only), half style-locked with shaping so
 *     the six behaviours stay distinct while the strategist and tactics adapt together.
 * Opponents: the three scripted corners, experiment-only cautious/outboxer scripts, frozen neuro-1 and league
 * snapshots of this run (style-locked from A, strategist-driven from B/C; 30% of bouts in A, 50% in B/C). Train seeds < 1e6; validation seeds
 * 2000+; the held-out banks 5000-5049 / 6000-6099 are only touched by evaluate-style.ts. Sampling temperature 0.8
 * (the product's) for the learner and neuro opponents. Stages resume from stageA.json / stageB.json.
 *   node --import tsx experiments/neuro-boxer/train-style.ts <variant> <seed> [A,B,C gens] [workers] [outDir] [initTheta.json]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SPARRING_VERSION } from "../../packages/protocol/src/combat-sparring";
import { FIGHT_STYLES, type FightStyle } from "../../packages/protocol/src/fight-style";
import { NEURO2_DIM, NEURO2_IN_PARAMS, NEURO2_OUT_PARAMS, NEURO2_VERSION } from "../../packages/protocol/src/neuro-boxer-2";
import { FIXED_OPPONENTS, opponentName, StylePool, type Bout2Result, type Control, type Format, type Variant } from "./env-style";
import type { BoutSpec, OpponentSpec } from "./worker-style";

const [variant = "connectome", seedArg = "1", gensArg = "200,60,60", workersArg = "4", outArg, initArg] = process.argv.slice(2) as [Variant, string, string, string, string?, string?];
const SEED = Number(seedArg), WORKERS = Math.min(4, Number(workersArg)), [GA, GB, GC] = gensArg.split(",").map(Number) as [number, number, number];
const OUT = outArg ?? `experiments/neuro-boxer/runs-v2/${variant}-s${SEED}`;
const PAIRS = 24, SIGMA = .04, DECAY = .005, TEMPERATURE = .8, LEAGUE_MAX = 6;
// The capsule-contact engine costs ~4x more per tick than sparring-4, so B/C train on 3 x 30 s rounds (evaluation uses 3 x 45 s).
const FORMAT_A: Format = { seconds: 20, rounds: 3, breakSeconds: 1 }, FORMAT_BC: Format = { seconds: 30, rounds: 3, breakSeconds: 2 };
const TACTICAL = NEURO2_IN_PARAMS + NEURO2_OUT_PARAMS;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
// Hash the files this script actually imports (a pinned snapshot can run from another directory).
const fileSha = (p: string) => { const u = new URL(p, import.meta.url); return existsSync(u) ? sha(readFileSync(u)) : null; };
const engineFiles = () => ({ version: SPARRING_VERSION, combatSparringSha256: fileSha("../../packages/protocol/src/combat-sparring.ts"), combatRefereeSha256: fileSha("../../packages/protocol/src/combat-referee.ts"), neuroBoxer2Sha256: fileSha("../../packages/protocol/src/neuro-boxer-2.ts") });
const engineAtStart = engineFiles();
mkdirSync(OUT, { recursive: true });

// One RNG stream per stage so a resumed run equals an uninterrupted one.
let r = 0; const reseed = (stage: number) => { r = (Math.imul(SEED, 2654435761) ^ Math.imul(stage + 1, 40503)) >>> 0; };
const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const round6 = (t: Float64Array) => Float64Array.from(t, x => +x.toFixed(6));
const save = (file: string, theta: Float64Array, stage: string, generation: number) => { const raw = JSON.stringify({ version: NEURO2_VERSION, variant, seed: SEED, stage, generation, dim: NEURO2_DIM, theta: Array.from(theta) }); writeFileSync(`${OUT}/${file}`, raw); return sha(raw); };
const load = (file: string) => { const j = JSON.parse(readFileSync(file, "utf8")); if (j.dim !== NEURO2_DIM) throw new Error(`${file}: dim ${j.dim} != ${NEURO2_DIM}`); return Float64Array.from(j.theta as number[]); };

let theta: Float64Array;
if (initArg) theta = load(initArg);
else {
  reseed(-1); theta = new Float64Array(NEURO2_DIM);
  for (let i = 0; i < NEURO2_IN_PARAMS; i++) theta[i] = gauss() * .5;            // sensory projection (as neuro-1)
  for (let i = NEURO2_IN_PARAMS; i < NEURO2_DIM; i++) theta[i] = gauss() * .02;   // readout and strategist start near zero
  theta = round6(theta);
}
const pool = new StylePool(WORKERS);
type LeagueEntry = { id: string; control: Control; theta: Float64Array };
let league: LeagueEntry[] = [];
const addLeague = (id: string, control: Control, snapshot = new Float64Array(theta)) => { pool.league(id, snapshot, variant); league.push({ id, control, theta: snapshot }); if (league.length > LEAGUE_MAX) league.shift(); };
// The league is saved with each stage (full precision) so a resumed run meets the same snapshots.
const saveLeague = (stage: string) => writeFileSync(`${OUT}/league-after-${stage}.json`, JSON.stringify(league.map(l => ({ id: l.id, control: l.control, theta: Array.from(l.theta) }))));
const loadLeague = (stage: string) => { league = []; for (const l of JSON.parse(readFileSync(`${OUT}/league-after-${stage}.json`, "utf8")) as { id: string; control: Control; theta: number[] }[]) addLeague(l.id, l.control, Float64Array.from(l.theta)); };
// The fixed pool is beaten in every style by the end of stage A, so B/C draw more league (self-play) bouts.
const opponent = (leagueShare = .3): OpponentSpec => {
  if (league.length && rnd() < leagueShare) { const l = league[Math.floor(rnd() * league.length)]!; return { kind: "league", id: l.id, control: l.control }; }
  return FIXED_OPPONENTS[Math.floor(rnd() * FIXED_OPPONENTS.length)] as OpponentSpec;
};
const trainSeed = () => 10 + Math.floor(rnd() * 999_000);
const log: Record<string, unknown>[] = existsSync(`${OUT}/log.json`) ? JSON.parse(readFileSync(`${OUT}/log.json`, "utf8")) : [];
const t0 = Date.now();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Validation on seeds 2000+ (never the held-out banks), run on the workers. */
async function validate(stage: "A" | "B" | "C", wide = false) {
  const specs: (BoutSpec & { opp: string; style?: FightStyle })[] = [];
  if (stage === "A") FIGHT_STYLES.forEach((style, k) => FIXED_OPPONENTS.forEach((o, j) => specs.push({ opponent: o as OpponentSpec, seed: 2000 + k * 6 + j, side: ((k + j) % 2) as 0 | 1, control: { mode: "fixed", style }, format: FORMAT_A, temperature: TEMPERATURE, shaping: style, opp: opponentName(o), style })));
  else for (const [j, o] of FIXED_OPPONENTS.entries()) for (let k = 0; k < (wide ? 10 : 4); k++) for (const side of wide ? [0, 1] as const : [((k + j) % 2) as 0 | 1]) specs.push({ opponent: o as OpponentSpec, seed: 2000 + k, side, control: { mode: "strategist" }, format: FORMAT_BC, temperature: TEMPERATURE, shaping: null, opp: opponentName(o) });
  const chunks: typeof specs[] = []; for (let i = 0; i < specs.length; i += 3) chunks.push(specs.slice(i, i + 3));
  const results = (await Promise.all(chunks.map(c => pool.bouts(theta, variant, c)))).flat() as Bout2Result[];
  const byOpp: Record<string, number[]> = {};
  results.forEach((b, i) => (byOpp[specs[i]!.opp] ??= []).push(b.score));
  const out: Record<string, unknown> = { score: +mean(results.map(b => b.score)).toFixed(3), outcome: +mean(results.map(b => b.outcome)).toFixed(3), byOpponent: Object.fromEntries(Object.entries(byOpp).map(([k, v]) => [k, +mean(v).toFixed(2)])) };
  if (stage === "A") out.shapingOwnStyle = Object.fromEntries(FIGHT_STYLES.map(style => [style, +mean(results.filter((_, i) => specs[i]!.style === style).map(b => b.shaping[style])).toFixed(3)]));
  else {
    const share = Object.fromEntries(FIGHT_STYLES.map(k => [k, +mean(results.map(b => b.styles.share[k])).toFixed(3)]));
    out.styleShare = share; out.switchesPerRound = +(results.reduce((a, b) => a + b.styles.switches, 0) / results.reduce((a, b) => a + b.styles.perRound.length, 0)).toFixed(3);
    out.trackGaps = results.reduce((a, b) => a + b.styles.gaps, 0);
  }
  return out;
}

async function stage(name: "A" | "B" | "C", index: number, gens: number, lo: number, hi: number, lr: number, bouts: (gen: number) => BoutSpec[], leagueEvery: number) {
  reseed(index);
  const n = hi - lo, m = new Float64Array(n), v = new Float64Array(n); let step = 0;
  for (let gen = 1; gen <= gens; gen++) {
    const specs = bouts(gen); // common random numbers: every candidate of a generation meets the same bouts
    const noise = Array.from({ length: PAIRS }, () => { const e = new Float64Array(n); for (let i = 0; i < n; i++) e[i] = gauss(); return e; });
    const jobs: Promise<number>[] = [];
    for (const e of noise) for (const sign of [1, -1]) { const t = new Float64Array(theta); for (let i = 0; i < n; i++) t[lo + i] += sign * SIGMA * e[i]!; jobs.push(pool.fitness(t, variant, specs)); }
    const fit = await Promise.all(jobs);
    const order = fit.map((f, i) => [f, i] as const).sort((a, b) => a[0] - b[0]), ranks = new Float64Array(fit.length);
    order.forEach(([, i], k) => { ranks[i] = k / (fit.length - 1) - .5; });
    const grad = new Float64Array(n);
    noise.forEach((e, p) => { const w = ranks[2 * p]! - ranks[2 * p + 1]!; for (let i = 0; i < n; i++) grad[i] += w * e[i]!; });
    step++;
    for (let i = 0; i < n; i++) {
      const g = -grad[i]! / (PAIRS * SIGMA) + DECAY * theta[lo + i]!;
      m[i] = .9 * m[i]! + .1 * g; v[i] = .999 * v[i]! + .001 * g * g;
      theta[lo + i] -= lr * (m[i]! / (1 - .9 ** step)) / (Math.sqrt(v[i]! / (1 - .999 ** step)) + 1e-8);
    }
    if (leagueEvery && gen % leagueEvery === 0) addLeague(`${name}${gen}`, name === "A" ? { mode: "randomFixed" } : { mode: "strategist" });
    const entry: Record<string, unknown> = { stage: name, gen, meanFitness: +mean(fit).toFixed(4), best: +Math.max(...fit).toFixed(4), seconds: Math.round((Date.now() - t0) / 1000) };
    if (gen % 10 === 0 || gen === gens) entry.validation = await validate(name);
    log.push(entry); console.log(JSON.stringify(entry));
    writeFileSync(`${OUT}/log.json`, JSON.stringify(log));
  }
  theta = round6(theta);
}

const stageFile = { A: "stageA.json", B: "stageB.json", C: "theta.json" } as const;
const plan: { name: "A" | "B" | "C"; gens: number; lo: number; hi: number; lr: number; leagueEvery: number; bouts: (gen: number) => BoutSpec[] }[] = [
  { name: "A", gens: GA, lo: 0, hi: TACTICAL, lr: .03, leagueEvery: 25, bouts: () => FIGHT_STYLES.map((style, k) => ({ opponent: opponent(), seed: trainSeed(), side: (k % 2) as 0 | 1, control: { mode: "fixed", style }, format: FORMAT_A, temperature: TEMPERATURE, shaping: style })) },
  { name: "B", gens: GB, lo: TACTICAL, hi: NEURO2_DIM, lr: .03, leagueEvery: 20, bouts: () => Array.from({ length: 3 }, (_, k) => ({ opponent: opponent(.5), seed: trainSeed(), side: (k % 2) as 0 | 1, control: { mode: "strategist" }, format: FORMAT_BC, temperature: TEMPERATURE, shaping: null })) },
  { name: "C", gens: GC, lo: 0, hi: NEURO2_DIM, lr: .01, leagueEvery: 20, bouts: () => Array.from({ length: 4 }, (_, k) => { const style = k < 2 ? null : FIGHT_STYLES[Math.floor(rnd() * FIGHT_STYLES.length)]!; return { opponent: opponent(.5), seed: trainSeed(), side: (k % 2) as 0 | 1, control: style ? { mode: "fixed", style } : { mode: "strategist" }, format: FORMAT_BC, temperature: TEMPERATURE, shaping: style }; }) },
];
const hashes: Record<string, string> = {};
// A curriculum init is the first league opponent; each finished stage joins the league for the next stage.
if (initArg && !existsSync(`${OUT}/${stageFile.A}`)) addLeague("init", { mode: "randomFixed" });
for (const [index, st] of plan.entries()) {
  const file = `${OUT}/${stageFile[st.name]}`;
  if (existsSync(file) && existsSync(`${OUT}/league-after-${st.name}.json`)) {
    theta = load(file); hashes[st.name] = sha(readFileSync(file, "utf8")); loadLeague(st.name);
    console.log(JSON.stringify({ resumed: st.name, sha256: hashes[st.name] })); continue;
  }
  if (st.gens > 0) await stage(st.name, index, st.gens, st.lo, st.hi, st.lr, st.bouts, st.leagueEvery);
  hashes[st.name] = save(stageFile[st.name], theta, st.name, st.gens);
  addLeague(`${st.name}-final`, st.name === "A" ? { mode: "randomFixed" } : { mode: "strategist" }); saveLeague(st.name);
}
const validation = await validate("C", true);
const engineAtEnd = engineFiles();
const summary = { version: NEURO2_VERSION, variant, seed: SEED, generations: { A: GA, B: GB, C: GC }, pairs: PAIRS, sigma: SIGMA, lr: { A: .03, B: .03, C: .01 }, decay: DECAY, temperature: TEMPERATURE,
  formats: { A: FORMAT_A, BC: FORMAT_BC }, boutsPerCandidate: { A: 6, B: 3, C: 4 }, shapingWeight: .5, init: initArg ?? "random", thetaSha256: hashes.C, stageSha256: hashes,
  engine: engineAtStart, engineChangedDuringRun: JSON.stringify(engineAtStart) !== JSON.stringify(engineAtEnd), validationWide: validation, seconds: Math.round((Date.now() - t0) / 1000) };
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
await pool.close();
