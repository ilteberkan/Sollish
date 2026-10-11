/**
 * Held-out evaluation (bout seeds 5000-5049, both corners; never used in training or validation),
 * run once after training. Three training seeds per architecture; greedy decisions for the
 * architecture comparison, plus product metrics (seeded sampling, mirror balance) for the shipped model.
 *   node --import tsx experiments/neuro-boxer/evaluate.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runBout, type Variant } from "./env";
import { aggroPolicy, randomPolicy, runPolicyBout } from "./baselines";

const variants: Variant[] = ["connectome", "shuffled", "norecur"], trainSeeds = [1, 2, 3];
const load = (v: Variant, seed: number) => { const raw = readFileSync(`experiments/neuro-boxer/runs/${v}-s${seed}/theta.json`, "utf8"); const j = JSON.parse(raw); const log = JSON.parse(readFileSync(`experiments/neuro-boxer/runs/${v}-s${seed}/log.json`, "utf8")); const val = [...log].reverse().find((e: { validation?: unknown }) => e.validation)?.validation; return { theta: Float64Array.from(j.theta), sha256: createHash("sha256").update(raw).digest("hex"), generation: j.generation, validationScore: val?.score ?? null }; };
const models = Object.fromEntries(variants.flatMap(v => trainSeeds.map(seed => [`${v}-s${seed}`, load(v, seed)])));
const SEEDS = Array.from({ length: 50 }, (_, i) => 5000 + i), styles = ["balanced", "pressure", "counter"] as const;
const entropy = (counts: Record<string, number>) => { const t = Object.values(counts).reduce((a, b) => a + b, 0) || 1; return -Object.values(counts).reduce((h, c) => h + (c ? c / t * Math.log2(c / t) : 0), 0); };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length, sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const report: Record<string, unknown> = { at: new Date().toISOString(), heldOutBoutSeeds: "5000-5049, both corners, greedy", models: Object.fromEntries(Object.entries(models).map(([k, m]) => [k, { sha256: m.sha256, generation: m.generation, validationScore: m.validationScore }])) };
const perModel: Record<string, { score: number; entropy: number; hits: number; koWins: number }> = {};
for (const [key, m] of Object.entries(models)) {
  const v = key.split("-s")[0] as Variant; let score = 0, n = 0, ko = 0, hits = 0; const attacks: Record<string, number> = {};
  for (const style of styles) for (const seed of SEEDS) for (const side of [0, 1] as const) {
    const b = runBout(m.theta, v, { kind: "bot", style }, seed, side); score += b.score; n++; hits += b.hits; if (b.won && b.ko) ko++;
    for (const [a, c] of Object.entries(b.attacks)) attacks[a] = (attacks[a] ?? 0) + c;
  }
  perModel[key] = { score: +(score / n).toFixed(3), entropy: +entropy(attacks).toFixed(2), hits: +(hits / n).toFixed(1), koWins: +(ko / n).toFixed(3) };
  console.log(key, JSON.stringify(perModel[key]));
}
report.vsScriptedCornersPerModel = perModel;
report.byArchitecture = Object.fromEntries(variants.map(v => { const rows = trainSeeds.map(s => perModel[`${v}-s${s}`]!); return [v, { scoreMean: +mean(rows.map(r => r.score)).toFixed(3), scoreSd: +sd(rows.map(r => r.score)).toFixed(3), entropyMean: +mean(rows.map(r => r.entropy)).toFixed(2), hitsMean: +mean(rows.map(r => r.hits)).toFixed(1) }]; }));
console.log("byArchitecture", JSON.stringify(report.byArchitecture));
// Cross-architecture round robin between matching training seeds (each side on its own architecture).
const rr: Record<string, number> = {};
for (const a of variants) for (const b of variants) if (a < b) {
  let score = 0, n = 0;
  for (const seed of trainSeeds) for (const bout of SEEDS.slice(0, 20)) for (const side of [0, 1] as const) { score += runBout(models[`${a}-s${seed}`]!.theta, a, { kind: "neuro", theta: models[`${b}-s${seed}`]!.theta, variant: b }, bout, side).score; n++; }
  rr[`${a}_vs_${b}`] = +(score / n).toFixed(3);
}
report.headToHead = rr; console.log("headToHead", JSON.stringify(rr));
// Shipped model: the connectome seed with the best VALIDATION score (not chosen on this held-out bank).
const shipped = trainSeeds.map(s => [s, models[`connectome-s${s}`]!.validationScore ?? 0] as const).sort((x, y) => y[1] - x[1])[0]![0];
const A = models[`connectome-s${shipped}`]!.theta;
let kor = 0, ko = 0, ticks = 0; const outcomes = new Set<string>();
for (let seed = 7000; seed < 7200; seed++) { const r = runBout(A, "connectome", { kind: "neuro", theta: A }, seed, 0, { rounds: 3, seconds: 45, temperature: .8 }); kor += r.won ? 1 : 0; if (r.ko) ko++; ticks += r.ticks; outcomes.add(`${r.score}:${r.dealt}:${r.taken}`); }
report.shippedModel = { connectomeTrainingSeed: shipped, mirrorBout: "3x45 s, temperature 0.8 seeded sampling, bout seeds 7000-7199", korWinShare: +(kor / 200).toFixed(3), koShare: +(ko / 200).toFixed(3), meanBoutSeconds: +(ticks / 200 / 60).toFixed(1), distinctOutcomes: outcomes.size };
console.log("shipped", JSON.stringify(report.shippedModel));
const base: Record<string, Record<string, number>> = {};
for (const [name, p] of [["random", randomPolicy], ["aggro", aggroPolicy]] as const) {
  base[name] = {}; for (const style of styles) { let sc = 0; for (const seed of SEEDS) for (const side of [0, 1] as const) sc += runPolicyBout(p, style, seed, side); base[name]![style] = +(sc / (SEEDS.length * 2)).toFixed(3); }
}
report.baselinesVsScriptedCorners = base; console.log("baselines", JSON.stringify(base));
writeFileSync("experiments/neuro-boxer/evidence-heldout.json", JSON.stringify(report, null, 1));
