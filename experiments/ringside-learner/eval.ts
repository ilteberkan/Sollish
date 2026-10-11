// Evaluates a frozen checkpoint with and without in-match learning (and against controls) on seeds and
// opponents chosen in advance. Pairs share the seed, side and opponent, so L-F differences are paired.
// Rule v5m: one unit is a whole bout of up to three rounds with the learner carry (weights, opponent model, lessons)
// threaded from round to round. The frozen copy never changes its weights but still sees the same observable inputs
// (its opponent model fills the same way), so the learning-vs-frozen difference is the weight learning, within and across rounds.
// Usage: node --import tsx experiments/ringside-learner/eval.ts --params <file|frozen> --opps heldout --seeds test --n 200
import { readFileSync, writeFileSync } from 'node:fs';
import { CONTACT_V5_PARAMS } from '../../packages/protocol/src/contact-v5-weights';
import { zeroLearnerParams, type LearnerParams } from '../../packages/protocol/src/contact-learner';
import type { V5Corner } from '../../packages/protocol/src/combat-v5';
import { HELD_OUT, TRAIN, VALIDATION } from './opponents';
import { GRAPHS, SEED_SETS, arg, fullBout, kickShare, margin, roundMargin, seedOf, won, type FullBout } from './common';

const paramsArg = arg('params', 'frozen'), n = Number(arg('n', '200')), seeds = arg('seeds', 'val'), opps = arg('opps', 'train');
const rates = { actor: Number(arg('actor', '0.02')), critic: Number(arg('critic', '0.01')), fast: Number(arg('fast', '0.5')), entropy: Number(arg('entropy', '0.05')) };
const matchRates = { actor: Number(arg('mactor', String(rates.actor))), critic: Number(arg('mcritic', String(rates.critic))), fast: Number(arg('mfast', String(rates.fast))), entropy: Number(arg('mentropy', String(rates.entropy))), fastInputs: Number(arg('mfastin', '0')) };
const shuffledParamsArg = arg('shuffled', '');
const params: LearnerParams = paramsArg === 'frozen' ? CONTACT_V5_PARAMS : JSON.parse(readFileSync(paramsArg, 'utf8'));
const shuffledParams: LearnerParams | null = shuffledParamsArg ? JSON.parse(readFileSync(shuffledParamsArg, 'utf8')) : null;
const opponentFiles = arg('against', '').split(',').filter(Boolean);
// Learned opponents never trained against: frozen checkpoints from other runs, and the frozen copy itself.
const learned: Record<string, V5Corner> = Object.fromEntries([
  ['mirrorFrozen', { kind: 'learner', params, rates, learn: false } as V5Corner],
  ...opponentFiles.map((f, i) => [`checkpoint${i}`, { kind: 'learner', params: JSON.parse(readFileSync(f, 'utf8')), rates, learn: false } as V5Corner]),
]);
const pool: Record<string, V5Corner> = Object.fromEntries(Object.entries(opps === 'heldout' ? HELD_OUT : opps === 'validation' ? VALIDATION : opps === 'learned' ? {} : TRAIN).map(([k, control]) => [k, { kind: 'script', control } as V5Corner]));
if (opps === 'learned') Object.assign(pool, learned);
if (!SEED_SETS[seeds]) throw new Error(`unknown seed set ${seeds}; register it in common.ts SEED_SETS`);
if (SEED_SETS[seeds] === 'test' && opps === 'train') throw new Error('test seeds are reserved for held-out opponents');

const arms: Record<string, V5Corner> = {
  learning: { kind: 'learner', params, rates: matchRates, learn: true },
  frozen: { kind: 'learner', params, rates, learn: false },
  untrainedLearning: { kind: 'learner', params: zeroLearnerParams(), rates: matchRates, learn: true },
  ...(shuffledParams ? { shuffledGraphLearning: { kind: 'learner', params: shuffledParams, rates: matchRates, learn: true, graph: GRAPHS.shuffled! } as V5Corner } : {}),
};
type Row = { margin: number[]; win: number[]; early: number[]; late: number[]; kick: number[]; rounds: (number | null)[][] };
const result: Record<string, Record<string, Row>> = {};
const started = performance.now();
// Hits landed minus hits taken in the first and last 15 s: in-round adaptation.
const swing = (b: FullBout, from: number, to: number) => b.rounds.flatMap(r => r.events).filter(e => e.type === 'hit' && e.tick >= from && e.tick < to).reduce((s, e) => s + (e.actor === b.learnerSide ? e.damage : -e.damage), 0);
for (const [armName, arm] of Object.entries(arms)) {
  for (const [oppName, opponent] of Object.entries(pool)) {
    const row: Row = { margin: [], win: [], early: [], late: [], kick: [], rounds: [[], [], []] };
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 'ayaz' : 'kor';
      const b = fullBout(seedOf(`${seeds}:${oppName}:${i}`), side, arm, opponent);
      row.margin.push(margin(b)); row.win.push(won(b)); row.early.push(swing(b, 0, 300)); row.late.push(swing(b, 600, 901)); row.kick.push(kickShare(b)); for (let k = 0; k < 3; k++) row.rounds[k]!.push(roundMargin(b, k));
    }
    (result[armName] ??= {})[oppName] = row;
  }
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
/** Paired bootstrap 95% interval of mean(a - b), fixed resampling seed. */
function pairedCi(a: number[], b: number[]) {
  const d = a.map((v, i) => v - b[i]!), out: number[] = [];
  let s = 99;
  const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (let k = 0; k < 2000; k++) { let t = 0; for (let i = 0; i < d.length; i++) t += d[Math.floor(r() * d.length)]!; out.push(t / d.length); }
  out.sort((x, y) => x - y);
  return { mean: +mean(d).toFixed(2), lo: +out[50]!.toFixed(2), hi: +out[1949]!.toFixed(2) };
}
const summary: Record<string, unknown> = {};
for (const [armName, rows] of Object.entries(result)) summary[armName] = Object.fromEntries(Object.entries(rows).map(([o, r]) => [o, { win: +mean(r.win).toFixed(3), margin: Math.round(mean(r.margin)), adaptation: Math.round(mean(r.late) - mean(r.early)), kickShare: +mean(r.kick).toFixed(3), roundMargin: r.rounds.map(x => { const v = x.filter((m): m is number => m !== null); return v.length ? Math.round(mean(v)) : null; }) }]));
const comparisons: Record<string, unknown> = {};
const all = (arm: string, key: 'margin' | 'win' | 'early' | 'late' | 'kick') => Object.values(result[arm]!).flatMap(r => r[key]);
const adapt = (arm: string) => Object.values(result[arm]!).flatMap(r => r.late.map((v, i) => v - r.early[i]!));
comparisons.learningVsFrozenMargin = pairedCi(all('learning', 'margin'), all('frozen', 'margin'));
comparisons.learningVsFrozenWin = pairedCi(all('learning', 'win'), all('frozen', 'win'));
comparisons.learningVsFrozenAdaptation = pairedCi(adapt('learning'), adapt('frozen'));
comparisons.learningVsUntrainedMargin = pairedCi(all('learning', 'margin'), all('untrainedLearning', 'margin'));
if (shuffledParams) comparisons.malecnsVsShuffledMargin = pairedCi(all('learning', 'margin'), all('shuffledGraphLearning', 'margin'));
for (const o of Object.keys(pool)) comparisons[`learningVsFrozenMargin:${o}`] = pairedCi(result.learning![o]!.margin, result.frozen![o]!.margin);
// Exploratory (not part of the claim): does the learner's advantage over its frozen copy grow from round 1 to round 3?
// Pairs exist only where both arms played the round (a stoppage ends a bout early).
const roundDiff = (k: number) => { const L: number[] = [], F: number[] = []; for (const o of Object.keys(pool)) result.learning![o]!.rounds[k]!.forEach((v, i) => { const f = result.frozen![o]!.rounds[k]![i]; if (v !== null && f !== null && f !== undefined) { L.push(v); F.push(f); } }); return { L, F }; };
comparisons.exploratoryPerRound = [0, 1, 2].map(k => { const { L, F } = roundDiff(k); return { round: k + 1, n: L.length, ...(L.length ? pairedCi(L, F) : {}) }; });
{
  const A: number[] = [], B: number[] = [];
  for (const o of Object.keys(pool)) { const l = result.learning![o]!.rounds, f = result.frozen![o]!.rounds; l[0]!.forEach((_, i) => { if ([0, 2].every(k => l[k]![i] !== null && f[k]![i] !== null)) { A.push(l[2]![i]! - f[2]![i]!); B.push(l[0]![i]! - f[0]![i]!); } }); }
  comparisons.exploratoryGrowthRound3MinusRound1 = { n: A.length, ...(A.length ? pairedCi(A, B) : {}) };
}
const report = { params: paramsArg, rates, matchRates, seeds, opps, n, summary, comparisons, seconds: +((performance.now() - started) / 1000).toFixed(1) };
console.log(JSON.stringify(report, null, 1));
const out = arg('out', '');
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
