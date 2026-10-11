// Lifetime training of the Contact 5 learner's initial weights. The fighter learns with the exact
// in-match rule across many training bouts of up to three rounds (rule v5m: the learner carry - weights, opponent model, lessons -
// is threaded from round to round exactly as in the arena; seeds "<tag>:<bout>:r<round>"), against the TRAIN script pool and a
// learning copy of itself; the weights at the end become the frozen checkpoint every match starts from.
// The readout starts from zeroLearnerParams(), so a new action/input set (Contact 5 with kicks, rule v5k) trains from scratch.
// Usage: node --import tsx experiments/ringside-learner/train.ts --matches 4000 --graph malecns --out <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { zeroLearnerParams, type LearnerParams } from '../../packages/protocol/src/contact-learner';
import type { V5Corner } from '../../packages/protocol/src/combat-v5';
import { TRAIN } from './opponents';
import { GRAPHS, arg, fullBout, kickShare, margin, randomPlan, seedOf, won } from './common';

const matches = Number(arg('matches', '6000')), graphName = arg('graph', 'malecns'), out = arg('out', 'experiments/ringside-learner/runs/latest');
const rates = { actor: Number(arg('actor', '0.02')), critic: Number(arg('critic', '0.01')), fast: Number(arg('fast', '0.5')), entropy: Number(arg('entropy', '0.05')) };
const graph = GRAPHS[graphName]!, tag = arg('tag', 'train');
mkdirSync(out, { recursive: true });
let params: LearnerParams = zeroLearnerParams();
const pool = [...Object.keys(TRAIN), 'self'];
let block: Record<string, { n: number; win: number; margin: number; kick: number }> = {};
const started = performance.now(), log: unknown[] = [];
let state = [...tag].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 0x1234567);
const r = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };

for (let m = 0; m < matches; m++) {
  const name = pool[m % pool.length]!, side = (Math.floor(m / pool.length) % 2 ? 'ayaz' : 'kor') as 'kor' | 'ayaz';
  const me: V5Corner = { kind: 'learner', params, graph, rates };
  const opponent: V5Corner = name === 'self' ? { kind: 'learner', params, graph, rates } : { kind: 'script', control: TRAIN[name]! };
  const fresh = r() < 0.75, initial = fresh ? undefined : { health: { kor: 500 + Math.floor(r() * 500), ayaz: 500 + Math.floor(r() * 500) }, stamina: { kor: 400 + Math.floor(r() * 600), ayaz: 400 + Math.floor(r() * 600) } };
  const randomPlans = r() < 0.3;
  const b = fullBout(`${tag}:${m}`, side, me, opponent, { ...(initial ? { initial } : {}), ...(randomPlans ? { plans: () => ({ kor: randomPlan(r), ayaz: randomPlan(r) }) } : {}) });
  params = b.params!;
  const s = (block[name] ??= { n: 0, win: 0, margin: 0, kick: 0 });
  s.n++; s.win += won(b); s.margin += margin(b); s.kick += kickShare(b);
  if ((m + 1) % 600 === 0) {
    const row = { matches: m + 1, seconds: Math.round((performance.now() - started) / 1000), ...Object.fromEntries(Object.entries(block).map(([k, v]) => [k, { win: +(v.win / v.n).toFixed(3), margin: Math.round(v.margin / v.n), kicks: +(v.kick / v.n).toFixed(3) }])) };
    log.push(row); console.log(JSON.stringify(row)); block = {};
  }
}
writeFileSync(`${out}/params.json`, JSON.stringify(params));
writeFileSync(`${out}/train-log.json`, JSON.stringify({ matches, unit: 'bouts of up to three rounds, learner carry threaded', graph: graphName, rates, tag, seeds: `${tag}:0..${matches - 1}`, pool, log, seconds: (performance.now() - started) / 1000 }, null, 1));
console.log('wrote', out);
