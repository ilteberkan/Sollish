// Shared helpers for Contact 5 learner training and evaluation (offline, CPU, deterministic seeds).
import { createHash } from 'node:crypto';
import { simulateContactCombatV5, type V5Carry, type V5Corner, type V5Replay } from '../../packages/protocol/src/combat-v5';
import { carryInitial, matchResults, roundOutcome } from '../../packages/protocol/src/ringside-match';
import { isV5Kick } from '../../packages/protocol/src/combat-v5-strikes';
import { RESERVOIR } from '../../packages/protocol/src/connectome-reservoir';
import { type LearnerParams, type LearnerRates, type ReservoirGraph } from '../../packages/protocol/src/contact-learner';
import { FIGHT_STYLES } from '../../packages/protocol/src/fight-style';
import { PLAN_TARGETS, PLAN_THREATS, fallbackPlans, type CornerPlan } from '../../packages/protocol/src/corner-plan';
import type { ContactInitial } from '../../packages/protocol/src/combat-v3';

/** Seed sets used by eval.ts (the tag in seedOf(`<tag>:<opponent>:<i>`)). Validation sets may be used to choose in-match
 * hyperparameters; a test set is spent once, pre-registered, against held-out opponents only. test6 was spent on rule v5k (kicks); test7 is new for rule v5m (carry across rounds, opponent model). */
export const SEED_SETS: Readonly<Record<string, 'validation' | 'test'>> = { val: 'validation', val2: 'validation', val3: 'validation', val4: 'validation', val6: 'validation', val7: 'validation', test: 'test', test2: 'test', test3: 'test', test4: 'test', test5: 'test', test6: 'test', test7: 'test' };
export const seedOf = (label: string) => createHash('sha256').update(`ringside-learner:${label}`).digest('hex');
export function arg(name: string, fallback: string) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : fallback; }

/** Control graph: edge targets permuted (Fisher-Yates, fixed seed), each target renormalized to 0.8. */
export function shuffledGraph(seed = 23): ReservoirGraph {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return (t ^ t >>> 14) >>> 0; };
  const post = [...RESERVOIR.post];
  for (let i = post.length - 1; i > 0; i--) { const j = next() % (i + 1); [post[i], post[j]] = [post[j]!, post[i]!]; }
  const sum = new Float64Array(RESERVOIR.nodes);
  for (let e = 0; e < post.length; e++) sum[post[e]!]! += RESERVOIR.weights[e]!;
  return { nodes: RESERVOIR.nodes, leak: RESERVOIR.leak, pre: [...RESERVOIR.pre], post, weights: RESERVOIR.weights.map((w, e) => sum[post[e]!]! ? w / sum[post[e]!]! * 0.8 : 0) };
}
export const GRAPHS: Record<string, ReservoirGraph> = { malecns: RESERVOIR as ReservoirGraph, shuffled: shuffledGraph() };

export function randomPlan(r: () => number): CornerPlan {
  return { intent: FIGHT_STYLES[Math.floor(r() * FIGHT_STYLES.length)]!, target: PLAN_TARGETS[Math.floor(r() * 2)]!, threat: PLAN_THREATS[Math.floor(r() * 4)]! };
}

/** A bout of up to three rounds, played the way the arena plays it: opening state carried (health +250, stamina +350), the
 * learner carry (weights, opponent model, lessons) threaded round to round, a stoppage ends it. Round 1 has no carry. */
export type FullBout = { rounds: V5Replay[]; learnerSide: 'kor' | 'ayaz'; params: LearnerParams | null };
/** One bout with a learner on `side` against `opponent`; returns the learner's weights at the end of the last round. */
export function fullBout(label: string, side: 'kor' | 'ayaz', me: V5Corner, opponent: V5Corner, { initial, plans }: { initial?: ContactInitial; plans?: 'fallback' | ((k: number) => { kor: CornerPlan; ayaz: CornerPlan }) } = {}): FullBout {
  const corners = (side === 'kor' ? [me, opponent] : [opponent, me]) as [V5Corner, V5Corner];
  const rounds: V5Replay[] = [];
  let carry: V5Carry | undefined, start = initial;
  for (let k = 1; k <= 3; k++) {
    const replay = simulateContactCombatV5(seedOf(`${label}:r${k}`), start, plans && plans !== 'fallback' ? i => plans(i) : (_i, o) => fallbackPlans(o), { corners, minds: false, round: k, ...(carry ? { carry } : {}) });
    rounds.push(replay); carry = replay.carry;
    if (replay.finish === 'stoppage') break;
    start = carryInitial(replay.frames.at(-1)!);
  }
  const mine = carry![side];
  return { rounds, learnerSide: side, params: mine.actor.length ? { actor: mine.actor, critic: mine.critic } : null };
}
const other = (b: FullBout) => b.learnerSide === 'kor' ? 'ayaz' : 'kor';
/** Points margin of the learner in round `k` (0-based), or null when the bout ended before it. */
export const roundMargin = (b: FullBout, k: number) => b.rounds[k] ? b.rounds[k]!.points[b.learnerSide] - b.rounds[k]!.points[other(b)] : null;
/** Points margin over the whole bout. */
export const margin = (b: FullBout) => b.rounds.reduce((s, r) => s + r.points[b.learnerSide] - r.points[other(b)], 0);
/** Share of the learner's own blows that were kicks or knees. */
export const kickShare = (b: FullBout) => { const mine = b.rounds.flatMap(r => r.events).filter(e => e.type === 'strike' && e.actor === b.learnerSide); return mine.length ? mine.filter(e => isV5Kick(e.technique)).length / mine.length : 0; };
/** 1 when the learner wins the bout under the match rules (stoppage, else rounds won), 0.5 for a draw. */
export const won = (b: FullBout) => { const w = matchResults(b.rounds.map(roundOutcome))['match-winner']; return w === b.learnerSide ? 1 : w === 'draw' ? 0.5 : 0; };
export type Rates = LearnerRates;
