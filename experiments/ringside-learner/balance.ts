// Live-style balance of Contact 5: whole bouts of up to three rounds, both corners learn in-match from the same checkpoint and
// carry their weights, opponent model and lessons from round to round (rule v5m, 10 Oct 2026), fallback plans, fresh opening state.
// Band: either side wins 40-60 % of bouts, 40-65 strikes per round, kicks and knees 15-35 % of strikes, knockdowns in 15-35 % of
// rounds, every blow used; strikes, kicks and knockdowns are measured over every round played, and per round for rounds 1-3.
// Also reports technique and action variety, which is what spectators see, and how the kicks fare.
// Usage: node --import tsx experiments/ringside-learner/balance.ts --params <file|frozen> --n 300 [--seeds balance]
import { readFileSync, writeFileSync } from 'node:fs';
import { simulateContactCombatV5, type V5Carry, type V5Corner } from '../../packages/protocol/src/combat-v5';
import { carryInitial, matchResults, roundOutcome } from '../../packages/protocol/src/ringside-match';
import { CONTACT_V5_PARAMS } from '../../packages/protocol/src/contact-v5-weights';
import { isV5Kick, V5_STRIKES } from '../../packages/protocol/src/combat-v5-strikes';
import type { LearnerParams } from '../../packages/protocol/src/contact-learner';
import { arg, seedOf } from './common';
import { fallbackPlans } from '../../packages/protocol/src/corner-plan';

const paramsArg = arg('params', 'frozen'), N = Number(arg('n', '300')), tag = arg('seeds', 'balance');
const params: LearnerParams = paramsArg === 'frozen' ? CONTACT_V5_PARAMS : JSON.parse(readFileSync(paramsArg, 'utf8'));
const rates = arg('mactor', '') ? { actor: Number(arg('mactor', '1')), critic: Number(arg('mcritic', '0.05')), fast: Number(arg('mfast', '4')), entropy: Number(arg('mentropy', '0.05')) } : undefined;
const traits = arg('traits', '') ? JSON.parse(arg('traits', '')) : undefined;
const corner: V5Corner = { kind: 'learner', params, ...(rates ? { rates } : {}) };
const out = { bouts: N, rounds: 0, kor: 0, ayaz: 0, draw: 0, knockdown: 0, stoppage: 0, strikesPerRound: 0, minStrikes: Infinity, hitsPerRound: 0, kicks: 0, legHitsPerRound: 0, kneesFromClinch: 0, techniques: {} as Record<string, number>, outcomes: {} as Record<string, Record<string, number>>, actionShare: {} as Record<string, number>, msPerRound: 0 };
const perRound = [0, 1, 2].map(() => ({ rounds: 0, strikes: 0, kicks: 0, knockdowns: 0, hits: 0 }));
const started = performance.now();
let frames = 0;
for (let i = 0; i < N; i++) {
  const played = [];
  let carry: V5Carry | undefined, initial = undefined as ReturnType<typeof carryInitial> | undefined;
  for (let k = 1; k <= 3; k++) {
    const r = simulateContactCombatV5(seedOf(`${tag}:${i}:r${k}`), initial, (_i, o) => fallbackPlans(o), { round: k, corners: [corner, corner], minds: false, ...(carry ? { carry } : {}), ...(traits ? { fighters: traits } : {}) });
    played.push(r); carry = r.carry;
    out.rounds++;
    if (r.knockdown === 'yes') out.knockdown++;
    if (r.finish === 'stoppage') out.stoppage++;
    const strikes = r.events.filter(e => e.type === 'strike'), pr = perRound[k - 1]!;
    out.strikesPerRound += strikes.length; out.minStrikes = Math.min(out.minStrikes, strikes.length); out.hitsPerRound += r.events.filter(e => e.type === 'hit').length;
    pr.rounds++; pr.strikes += strikes.length; pr.knockdowns += r.knockdown === 'yes' ? 1 : 0; pr.hits += r.events.filter(e => e.type === 'hit').length;
    for (const e of strikes) { out.techniques[e.technique] = (out.techniques[e.technique] ?? 0) + 1; if (isV5Kick(e.technique)) { out.kicks++; pr.kicks++; } }
    for (const e of r.events) if (e.type === 'hit' || e.type === 'block' || e.type === 'dodge' || e.type === 'miss') { const o = (out.outcomes[e.technique] ??= {}); o[e.type] = (o[e.type] ?? 0) + 1; }
    out.legHitsPerRound += r.events.filter(e => e.type === 'hit' && e.bodyPart === 'leg').length;
    for (const kn of strikes.filter(e => e.technique === 'knee')) if (r.events.some(e => e.type === 'break' && e.tick === kn.tick)) out.kneesFromClinch++;
    for (const f of r.frames) for (const side of ['kor', 'ayaz'] as const) { out.actionShare[f[side].action] = (out.actionShare[f[side].action] ?? 0) + 1; frames++; }
    if (r.finish === 'stoppage') break;
    initial = carryInitial(r.frames.at(-1)!);
  }
  out[matchResults(played.map(roundOutcome))['match-winner'] as 'kor' | 'ayaz' | 'draw']++;
}
const rounds = out.rounds;
for (const k of ['kor', 'ayaz', 'draw'] as const) out[k] = +(out[k] / N).toFixed(3);
for (const k of ['knockdown', 'stoppage', 'strikesPerRound', 'hitsPerRound', 'legHitsPerRound'] as const) out[k] = +(out[k] / rounds).toFixed(3);
const total = Object.values(out.techniques).reduce((a, b) => a + b, 0);
const kickShare = +(out.kicks / total).toFixed(3);
const missing = Object.keys(V5_STRIKES).filter(k => !out.techniques[k]);
for (const k of Object.keys(out.techniques)) out.techniques[k] = +(out.techniques[k]! / total).toFixed(3);
for (const k of Object.keys(out.actionShare)) out.actionShare[k] = +(out.actionShare[k]! / frames).toFixed(3);
out.msPerRound = +((performance.now() - started) / rounds).toFixed(1);
const byRound = perRound.map((p, i) => ({ round: i + 1, rounds: p.rounds, strikes: +(p.strikes / p.rounds).toFixed(1), kickShare: +(p.kicks / p.strikes).toFixed(3), knockdowns: +(p.knockdowns / p.rounds).toFixed(3), hits: +(p.hits / p.rounds).toFixed(1) }));
const share = out.kor + out.draw / 2;
const band = { eitherSideWins40to60: share >= .4 && share <= .6, strikes40to65: out.strikesPerRound >= 40 && out.strikesPerRound <= 65, kickShare15to35: kickShare >= .15 && kickShare <= .35, knockdowns15to35: out.knockdown >= .15 && out.knockdown <= .35, everyBlowUsed: missing.length === 0 };
const report = { params: paramsArg, rates: rates ?? 'engine', seeds: `${tag}:0..${N - 1} (bouts of up to 3 rounds)`, ...out, kickShare, byRound, missingTechniques: missing, band, pass: Object.values(band).every(Boolean) };
console.log(JSON.stringify(report));
const file = arg('out', '');
if (file) writeFileSync(file, JSON.stringify(report, null, 1));
