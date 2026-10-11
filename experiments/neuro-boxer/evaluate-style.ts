/**
 * NeuroBoxer v2 (neuro-2) held-out evaluation, run once after training on the final engine. Product bout format
 * (3 x 45 s, 8 s breaks), seeded sampling at 0.8 (the product's), held-out bout seeds 5000-5049 and 6000-6099 in
 * both corners. Opponents: the three scripted corners, experiment-only cautious/outboxer scripts, frozen neuro-1 and
 * two snapshots of a separate training seed that no model trained against. Sections: win rates; style switching;
 * behaviour signatures per style + a classifier (train 5000-5049, test 6000-6099, chance 1/6); ablations (fixed
 * styles, random switching, an authored rule strategist, tendency inputs zeroed); shuffled-graph and no-recurrence
 * controls; mirror-bout corner balance over 600 bouts; all hashes.
 *   node --import tsx experiments/neuro-boxer/evaluate-style.ts [--workers 4] [--dry] [--out file]
 * --dry swaps every seed bank for 8000+ banks to exercise the code without touching the held-out banks.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SPARRING_VERSION } from "../../packages/protocol/src/combat-sparring";
import { FIGHT_STYLES, type FightStyle } from "../../packages/protocol/src/fight-style";
import { NEURO2_DIM, NEURO2_IN_PARAMS, NEURO2_OUT_PARAMS, NEURO2_STYLE_WIDTH } from "../../packages/protocol/src/neuro-boxer-2";
import { FIXED_OPPONENTS, graph2For, opponentName, PRODUCT_FORMAT, SIGNATURE_KEYS, StylePool, type Bout2Result, type Control, type Variant } from "./env-style";
import type { BoutSpec, OpponentSpec } from "./worker-style";

const argv = process.argv.slice(2), flag = (k: string) => argv.includes(k), opt = (k: string, d: string) => argv.includes(k) ? argv[argv.indexOf(k) + 1]! : d;
const DRY = flag("--dry"), WORKERS = Math.min(4, Number(opt("--workers", "4"))), RUNS = opt("--runs", "experiments/neuro-boxer/runs-v2");
const OUT = opt("--out", DRY ? "/dev/null" : "experiments/neuro-boxer/evidence-style.json");
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const BANK1 = DRY ? range(8000, 2) : range(5000, 50), BANK2 = DRY ? range(8100, 2) : range(6000, 100), HELD = [...BANK1, ...BANK2];
const MIRROR = DRY ? range(8500, 6) : range(7000, 600), T = .8, FORMAT = PRODUCT_FORMAT;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
// Hash the files this script actually imports (it may run from a pinned snapshot directory).
const here = (p: string) => new URL(p, import.meta.url), fileSha = (p: string) => existsSync(here(p)) ? sha(readFileSync(here(p))) : null;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const r3 = (x: number) => +x.toFixed(3);
const quant = (xs: number[], q: number) => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(q * v.length))]!; };

type Model = { key: string; variant: Variant; seed: number; theta: Float64Array; sha256: string; stageSha256: Record<string, string>; engineSha256: string; validationWide: number | null; validationOutcome: number | null };
const loadRun = (variant: Variant, seed: number, file = "theta.json"): Model | null => {
  const dir = `${RUNS}/${variant}-s${seed}`; if (!existsSync(`${dir}/${file}`) || !existsSync(`${dir}/summary.json`)) return null;
  const raw = readFileSync(`${dir}/${file}`, "utf8"), j = JSON.parse(raw), sum = JSON.parse(readFileSync(`${dir}/summary.json`, "utf8"));
  if (j.dim !== NEURO2_DIM) throw new Error(`${dir}/${file}: wrong dim`);
  return { key: `${variant}-s${seed}`, variant, seed, theta: Float64Array.from(j.theta as number[]), sha256: sha(raw), stageSha256: sum.stageSha256, engineSha256: sum.engine.combatSparringSha256, validationWide: sum.validationWide?.score ?? null, validationOutcome: sum.validationWide?.outcome ?? null };
};
const connectome = [1, 2, 3].map(s => loadRun("connectome", s)).filter((m): m is Model => !!m).slice(0, DRY ? 1 : 3);
const controls = (["shuffled", "norecur"] as const).flatMap(v => [1, 2, 3].map(s => loadRun(v, s))).filter((m): m is Model => !!m);
const heldA = loadRun("connectome", 101, "stageA.json"), heldC = loadRun("connectome", 101);
if (!connectome.length || !heldA || !heldC) throw new Error("missing trained runs (connectome-s1..3 and the held-out connectome-s101)");
const engineSha = fileSha("../../packages/protocol/src/combat-sparring.ts");
const pool = new StylePool(WORKERS);
pool.league("heldA", heldA.theta, "connectome"); pool.league("heldC", heldC.theta, "connectome");
const OPPONENTS: { name: string; spec: OpponentSpec }[] = [...FIXED_OPPONENTS.map(o => ({ name: opponentName(o), spec: o as OpponentSpec })),
  { name: "heldout:styleLocked", spec: { kind: "league", id: "heldA", control: { mode: "randomFixed" } } }, { name: "heldout:strategist", spec: { kind: "league", id: "heldC", control: { mode: "strategist" } } }];
// Ablations/signatures use the opponents that are not saturated (the scripted pool is beaten in every style; see validation logs).
const STRONG = OPPONENTS.filter(o => o.name === "neuro1" || o.name.startsWith("heldout:"));
const t0 = Date.now(); let done = 0;
type Row = { opp: string; seed: number; side: 0 | 1; r: Bout2Result };
/** Runs `control` for `theta` against every opponent on `seeds` (both corners) in chunks on the pool. */
async function sweep(theta: Float64Array, variant: Variant, control: Control, seeds: number[], opponents = OPPONENTS, sides: readonly (0 | 1)[] = [0, 1]): Promise<Row[]> {
  const rows: Omit<Row, "r">[] = [], specs: BoutSpec[] = [];
  for (const o of opponents) for (const seed of seeds) for (const side of sides) { rows.push({ opp: o.name, seed, side }); specs.push({ opponent: o.spec, seed, side, control, format: FORMAT, temperature: T, shaping: null }); }
  const chunks: Promise<Bout2Result[]>[] = []; for (let i = 0; i < specs.length; i += 10) chunks.push(pool.bouts(theta, variant, specs.slice(i, i + 10)).then(r => { done += r.length; return r; }));
  const results = (await Promise.all(chunks)).flat();
  return rows.map((row, i) => ({ ...row, r: results[i]! }));
}
const summary = (rows: Row[]) => {
  const byOpp = Object.fromEntries(OPPONENTS.map(o => { const rs = rows.filter(x => x.opp === o.name); return [o.name, rs.length ? r3(mean(rs.map(x => x.r.score))) : null]; }).filter(([, v]) => v !== null));
  return { bouts: rows.length, score: r3(mean(rows.map(x => x.r.score))), winRate: r3(rows.filter(x => x.r.won).length / Math.max(1, rows.length)), koWins: r3(rows.filter(x => x.r.won && x.r.ko).length / Math.max(1, rows.length)), byOpponent: byOpp };
};
const switching = (rows: Row[]) => {
  const rounds = rows.reduce((a, x) => a + x.r.styles.perRound.length, 0), holds = rows.flatMap(x => x.r.styles.holds.map(t => t / 60));
  const share = Object.fromEntries(FIGHT_STYLES.map(k => [k, r3(mean(rows.map(x => x.r.styles.share[k])))]));
  const first = Object.fromEntries(FIGHT_STYLES.map(k => [k, rows.filter(x => x.r.styles.first === k).length]));
  return { switchesPerRound: r3(rows.reduce((a, x) => a + x.r.styles.switches, 0) / Math.max(1, rounds)), boutsWithSwitch: r3(rows.filter(x => x.r.styles.switches > 0).length / Math.max(1, rows.length)),
    completedHoldSeconds: { n: holds.length, p10: quant(holds, .1), median: quant(holds, .5), p90: quant(holds, .9) }, finalHoldSecondsMedian: quant(rows.map(x => x.r.styles.lastHold / 60), .5),
    distinctStylesPerBout: r3(mean(rows.map(x => FIGHT_STYLES.filter(k => x.r.styles.share[k] > 0).length))), timeShare: share, firstStyle: first, trackGaps: rows.reduce((a, x) => a + x.r.styles.gaps, 0) };
};
/** Paired difference (strategist - ablation) over identical (opponent, seed, corner) bouts. */
const paired = (a: Row[], b: Row[]) => {
  const key = (x: Row) => `${x.opp}:${x.seed}:${x.side}`, m = new Map(b.map(x => [key(x), x.r.score])), d = a.filter(x => m.has(key(x))).map(x => x.r.score - m.get(key(x))!);
  const se = sd(d) / Math.sqrt(Math.max(1, d.length));
  return { n: d.length, meanDiff: r3(mean(d)), ci95: [r3(mean(d) - 1.96 * se), r3(mean(d) + 1.96 * se)] };
};
const zeroTendencies = (theta: Float64Array) => { const t = new Float64Array(theta), base = NEURO2_IN_PARAMS + NEURO2_OUT_PARAMS; for (let k = 0; k < FIGHT_STYLES.length; k++) for (let j = 6; j < 12; j++) t[base + k * NEURO2_STYLE_WIDTH + 1 + j] = 0; return t; };

/** Nearest-centroid and multinomial logistic classifiers on z-scored signatures: train bank 1, test bank 2. */
function classify(rows: (Row & { style: FightStyle })[]) {
  const X = (r: Row) => SIGNATURE_KEYS.map(k => r.r.signature[k]);
  const train = rows.filter(x => BANK1.includes(x.seed)), test = rows.filter(x => BANK2.includes(x.seed));
  const mu = SIGNATURE_KEYS.map((_, j) => mean(train.map(r => X(r)[j]!))), sg = SIGNATURE_KEYS.map((_, j) => sd(train.map(r => X(r)[j]!)) || 1);
  const z = (r: Row) => X(r).map((v, j) => (v - mu[j]!) / sg[j]!), S = FIGHT_STYLES.length, D = SIGNATURE_KEYS.length;
  const centroids = FIGHT_STYLES.map(k => { const rs = train.filter(r => r.style === k).map(z); return Array.from({ length: D }, (_, j) => mean(rs.map(v => v[j]!))); });
  const nearest = (v: number[]) => { let best = 0, bd = Infinity; centroids.forEach((c, k) => { const d = c.reduce((a, cj, j) => a + (cj - v[j]!) ** 2, 0); if (d < bd) { bd = d; best = k; } }); return best; };
  const W = Array.from({ length: S }, () => new Float64Array(D + 1)), Xtr = train.map(z), ytr = train.map(r => FIGHT_STYLES.indexOf(r.style));
  const probs = (v: number[]) => { const l = W.map(w => w[0]! + v.reduce((a, x, j) => a + w[j + 1]! * x, 0)), m = Math.max(...l), e = l.map(x => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); };
  for (let it = 0; it < 400; it++) {
    const g = Array.from({ length: S }, () => new Float64Array(D + 1));
    Xtr.forEach((v, i) => { const p = probs(v); for (let k = 0; k < S; k++) { const e = p[k]! - (ytr[i] === k ? 1 : 0); g[k]![0] += e; for (let j = 0; j < D; j++) g[k]![j + 1] += e * v[j]!; } });
    for (let k = 0; k < S; k++) for (let j = 0; j <= D; j++) W[k]![j] -= .5 * (g[k]![j]! / Xtr.length + 1e-3 * (j ? W[k]![j]! : 0));
  }
  const confusion = FIGHT_STYLES.map(() => FIGHT_STYLES.map(() => 0)); let nc = 0, lr = 0;
  for (const r of test) { const v = z(r), y = FIGHT_STYLES.indexOf(r.style), a = nearest(v), p = probs(v), b = p.indexOf(Math.max(...p)); if (a === y) nc++; if (b === y) lr++; confusion[y]![b]++; }
  return { train: train.length, test: test.length, chance: r3(1 / S), nearestCentroidAccuracy: r3(nc / Math.max(1, test.length)), logisticAccuracy: r3(lr / Math.max(1, test.length)), logisticConfusion: { rows: "true style", cols: "predicted", order: FIGHT_STYLES, matrix: confusion } };
}

const report: Record<string, unknown> = {
  at: new Date().toISOString(), dry: DRY, scope: "local CPU simulation in Node (no rendering) on a pinned copy of the engine files; not a browser, production build or hosted run", engine: { version: SPARRING_VERSION, combatSparringSha256: engineSha, combatRefereeSha256: fileSha("../../packages/protocol/src/combat-referee.ts"), neuroBoxer2Sha256: fileSha("../../packages/protocol/src/neuro-boxer-2.ts"), liveCombatSparringSha256: existsSync("packages/protocol/src/combat-sparring.ts") ? sha(readFileSync("packages/protocol/src/combat-sparring.ts")) : null, contactMarker: existsSync(".tooling/coord/engine-contact-ready.json") ? JSON.parse(readFileSync(".tooling/coord/engine-contact-ready.json", "utf8")) : null },
  protocol: { format: FORMAT, temperature: T, heldOutSeeds: DRY ? "dry banks 8000+" : "5000-5049 and 6000-6099, both corners", classifierSplit: "train on bank 1 (5000-5049), test on bank 2 (6000-6099)", ablationOpponents: "neuro1 + the two held-out snapshots (the scripted pool is saturated)", mirrorSeeds: DRY ? "8500+" : "7000-7599", opponents: OPPONENTS.map(o => o.name) },
  models: Object.fromEntries([...connectome, ...controls, heldA, heldC].map(m => [m === heldA ? "heldout-styleLocked(connectome-s101 stage A)" : m === heldC ? "heldout-strategist(connectome-s101)" : m.key, { thetaSha256: m.sha256, stageSha256: m.stageSha256, trainedOnEngineSha256: m.engineSha256, trainedOnEvaluatedEngine: m.engineSha256 === engineSha, validationWide: m.validationWide, validationOutcome: m.validationOutcome }])),
  graphs: { connectomeArraysSha256: sha(JSON.stringify(graph2For("connectome"))), shuffledArraysSha256: sha(JSON.stringify(graph2For("shuffled"))), graphFileSha256: fileSha("./graph.json"), graphSha256: JSON.parse(readFileSync(here("./graph.json"), "utf8")).graphSha256 },
  neuro1: { modelFileSha256: fileSha("../../packages/protocol/src/neuro-boxer-model.ts"), sourceSha256: fileSha("../../packages/protocol/src/neuro-boxer.ts") },
};
const progress = setInterval(() => console.log(JSON.stringify({ bouts: done, seconds: Math.round((Date.now() - t0) / 1000) })), 60_000);

// 1. Learned strategist: win rates and switching, every model.
const strategist: Record<string, Row[]> = {};
for (const m of [...connectome, ...controls]) { strategist[m.key] = await sweep(m.theta, m.variant, { mode: "strategist" }, HELD); console.log(m.key, JSON.stringify(summary(strategist[m.key]!))); }
report.strategist = Object.fromEntries(Object.entries(strategist).map(([k, rows]) => [k, { ...summary(rows), switching: switching(rows) }]));
// 2. Ablations and signatures on each connectome seed.
const ablations: Record<string, unknown> = {}, signatures: Record<string, unknown> = {}, classifiers: Record<string, unknown> = {};
for (const m of connectome) {
  const fixed: Record<string, Row[]> = {};
  for (const style of FIGHT_STYLES) fixed[style] = await sweep(m.theta, m.variant, { mode: "fixed", style }, HELD, STRONG);
  const random = await sweep(m.theta, m.variant, { mode: "random" }, HELD, STRONG), rule = await sweep(m.theta, m.variant, { mode: "rule" }, HELD, STRONG), zeroed = await sweep(zeroTendencies(m.theta), m.variant, { mode: "strategist" }, HELD, STRONG);
  const s = strategist[m.key]!.filter(x => STRONG.some(o => o.name === x.opp)), oracle = FIGHT_STYLES.reduce((a, b) => mean(fixed[b]!.map(x => x.r.score)) > mean(fixed[a]!.map(x => x.r.score)) ? b : a);
  ablations[m.key] = { opponents: STRONG.map(o => o.name), strategist: summary(s),
    fixedStyles: Object.fromEntries(FIGHT_STYLES.map(k => [k, summary(fixed[k]!)])),
    bestFixedOnHeldOut: { style: oracle, score: summary(fixed[oracle]!).score, strategistMinusIt: paired(s, fixed[oracle]!), note: "selected on the held-out bank itself (optimistic for the ablation)" },
    randomSwitching: { ...summary(random), switching: switching(random), strategistMinusIt: paired(s, random) },
    ruleStrategist: { ...summary(rule), switching: switching(rule), strategistMinusIt: paired(s, rule) },
    tendenciesZeroed: { ...summary(zeroed), switching: switching(zeroed), strategistMinusIt: paired(s, zeroed) } };
  console.log(m.key, "ablations", JSON.stringify({ strategistVsStrong: summary(s).score, oracle, oracleScore: summary(fixed[oracle]!).score, random: summary(random).score, rule: summary(rule).score, zeroed: summary(zeroed).score }));
  const labelled = FIGHT_STYLES.flatMap(style => fixed[style]!.map(x => ({ ...x, style })));
  signatures[m.key] = Object.fromEntries(FIGHT_STYLES.map(k => [k, { ...Object.fromEntries(SIGNATURE_KEYS.map(f => [f, r3(mean(fixed[k]!.map(x => x.r.signature[f])))])), shapingOwnStyle: r3(mean(fixed[k]!.map(x => x.r.shaping[k]))) }]));
  classifiers[m.key] = classify(labelled);
  console.log(m.key, "classifier", JSON.stringify({ nc: (classifiers[m.key] as { nearestCentroidAccuracy: number }).nearestCentroidAccuracy, lr: (classifiers[m.key] as { logisticAccuracy: number }).logisticAccuracy }));
}
report.ablations = ablations; report.signatures = signatures; report.styleClassifier = classifiers;
// 3. Architecture controls vs the connectome (strategist condition, same bouts).
const meanOf = (keys: string[]) => keys.length ? r3(mean(keys.map(k => summary(strategist[k]!).score))) : null;
report.controls = { connectome: meanOf(connectome.map(m => m.key)), shuffled: meanOf(controls.filter(m => m.variant === "shuffled").map(m => m.key)), norecur: meanOf(controls.filter(m => m.variant === "norecur").map(m => m.key)),
  perSeed: Object.fromEntries([...connectome, ...controls].map(m => [m.key, summary(strategist[m.key]!).score])) };
// 4. Mirror bouts of the shipped model (connectome seed with the best validation score; held-out not used to choose).
// The validation score saturates against the fixed pool, so the validation outcome (score + damage/knockdown margin) breaks ties.
const shipped = [...connectome].sort((a, b) => (b.validationWide ?? 0) - (a.validationWide ?? 0) || (b.validationOutcome ?? 0) - (a.validationOutcome ?? 0))[0]!;
pool.league("shipped", shipped.theta, "connectome");
const mirror = await sweep(shipped.theta, "connectome", { mode: "strategist" }, MIRROR, [{ name: "mirror", spec: { kind: "league", id: "shipped", control: { mode: "strategist" } } }], [0]);
const w0 = mirror.filter(x => x.r.won).length, draws = mirror.filter(x => x.r.draw).length, w1 = mirror.length - w0 - draws;
report.shipped = { model: shipped.key, thetaSha256: shipped.sha256, chosenBy: "validation seeds 2000-2009 both corners (score, then outcome), not the held-out banks",
  mirror: { bouts: mirror.length, korWins: w0, ayazWins: w1, draws, korWinShareExDraws: r3(w0 / Math.max(1, w0 + w1)), z: r3((w0 - w1) / Math.sqrt(Math.max(1, w0 + w1))), koShare: r3(mirror.filter(x => x.r.ko).length / mirror.length), meanBoutSeconds: r3(mean(mirror.map(x => x.r.ticks / 60))), distinctOutcomes: new Set(mirror.map(x => `${x.r.score}:${x.r.dealt}:${x.r.taken}`)).size, switching: switching(mirror) } };
clearInterval(progress);
report.seconds = Math.round((Date.now() - t0) / 1000);
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ written: OUT, seconds: report.seconds, shipped: shipped.key, controls: report.controls, mirror: (report.shipped as { mirror: unknown }).mirror }));
await pool.close();
