/** Contact 5 in-match learner: a fixed MaleCNS reservoir plus an actor-critic readout whose weights
 * change during the match.
 *
 * What is frozen for a match (and hashed into the engine id): the reservoir graph, the input
 * projection, the learning rule, its hyperparameters and the initial readout weights. What changes:
 * the readout weights, only through `learnerAct`/`learnerFinish`, only from rewards built from
 * observable fight events. Same seed + same plan log = same weights at every tick.
 *
 * Determinism: only + - * / and comparisons on float64 (IEEE-754 round-to-nearest, no fused ops in
 * JS). tanh and exp are our own fixed polynomial/rational forms, not Math.tanh/Math.exp, whose results
 * the spec leaves implementation-defined. The physics around it (combat-v5.ts) still uses Math.hypot/
 * atan2 like Contact 4, so cross-engine bit equality is measured in V8, not claimed everywhere.
 *
 * Contact 5 with kicks (10 Oct 2026): five more actions (teep, lowKick, bodyKick, headKick, knee, appended after 'clinch') and
 * six more inputs (kick and knee reach, a visible kick wind-up, a leg kick taken, being in a clinch) appended at the end.
 *
 * Inputs are observable fight state and the public corner plan. No wager, balance, exposure, house
 * result, identity or future seed is an input.
 */
import { RESERVOIR, RESERVOIR_INFO } from './connectome-reservoir';

export const LEARNER_ACTIONS = ['jab', 'cross', 'leadHook', 'rearHook', 'uppercut', 'bodyHook', 'advance', 'retreat', 'circleLeft', 'circleRight', 'guard', 'slip', 'roll', 'clinch', 'teep', 'lowKick', 'bodyKick', 'headKick', 'knee'] as const;
export type LearnerAction = typeof LEARNER_ACTIONS[number];
export const LEARNER_INPUT_NAMES = [
  'distance', 'inJabReach', 'inHookReach', 'inUpperReach', 'myHealth', 'myStamina', 'myStun', 'oppHealth', 'oppStamina', 'oppStun',
  'oppWindupStraight', 'oppWindupHook', 'oppWindupUpper', 'oppWindupBody', 'oppRecovery', 'oppGuard', 'oppRetreat', 'meNearRopes', 'oppNearRopes',
  'lastHit', 'lastBlocked', 'lastDodged', 'lastMissed', 'inCombo', 'counterWindow', 'sinceStrike', 'timeLeft', 'pointsLead', 'tookHead', 'tookBody',
  'planPressure', 'planCounter', 'planCautious', 'planOutboxer', 'planBody', 'planFinisher', 'planTargetHead', 'planTargetBody',
  'threatStraight', 'threatHook', 'threatUpper', 'threatBody',
  'inTeepReach', 'inKickReach', 'inKneeReach', 'oppWindupKick', 'tookLeg', 'inClinch',
  // Rule v5m (10 Oct 2026): round of the bout, an opponent model built from what the opponent actually did (decayed
  // frequencies of its choices, its defence habits after my wind-up, its success rate) and lessons about my own
  // techniques against this opponent. All three are kept for the whole bout and carried from round to round.
  'round',
  'oppFreqStraight', 'oppFreqHook', 'oppFreqUpper', 'oppFreqBodyPunch', 'oppFreqLowKick', 'oppFreqKick', 'oppFreqTeep', 'oppFreqKnee', 'oppFreqClinch',
  'oppSlip', 'oppRoll', 'oppGuard', 'oppSuccess',
  'lessonJab', 'lessonCross', 'lessonLeadHook', 'lessonRearHook', 'lessonUppercut', 'lessonBodyHook', 'lessonTeep', 'lessonLowKick', 'lessonBodyKick', 'lessonHeadKick', 'lessonKnee',
] as const;
export const LEARNER_INPUTS = LEARNER_INPUT_NAMES.length;
const A = LEARNER_ACTIONS.length, N = RESERVOIR.nodes, D = 1 + LEARNER_INPUTS + N, FI = 1 + LEARNER_INPUTS;
export const LEARNER_FEATURES = D;

/** Frozen in-match rule and hyperparameters (rates chosen on validation seeds, see
 * ops/evidence/ringside-contact5-20261009). Changing any value needs a new engine id. The checkpoint
 * itself was trained offline at slower lifetime rates with entropy 0.1 (experiments/ringside-learner). */
export const LEARNER_RULE = Object.freeze({
  name: 'reservoir-actor-critic-td0-v1',
  actorRate: 1, criticRate: 0.05, fastRate: 2, fastInputRate: 0, fastDecay: 0.02, entropy: 0.03, discount: 0.9, temperature: 1, tdClip: 2, actorBound: 6, criticBound: 10,
  inputScale: 0.18, inputSeed: 0x52494e47, reservoirStride: 2,
});
export type LearnerRule = typeof LEARNER_RULE;

// ---------------------------------------------------------------------------------------------------
// Deterministic math.

/** Lambert continued-fraction tanh, saturated at |x| >= 4.97 (|error| < 1e-4 everywhere). */
export function tanhD(x: number): number {
  if (x >= 4.97) return 1;
  if (x <= -4.97) return -1;
  const x2 = x * x, y = x * (135135 + x2 * (17325 + x2 * (378 + x2))) / (135135 + x2 * (62370 + x2 * (3150 + x2 * 28)));
  return y > 1 ? 1 : y < -1 ? -1 : y;
}
/** exp on [-30, 30]: Taylor series of x/32 to the 7th power, squared five times (relative error < 5e-5 on [-20, 20]). */
export function expD(x: number): number {
  const c = x > 30 ? 30 : x < -30 ? -30 : x, y = c / 32;
  let r = 1 + y * (1 + y / 2 * (1 + y / 3 * (1 + y / 4 * (1 + y / 5 * (1 + y / 6 * (1 + y / 7))))));
  for (let i = 0; i < 5; i++) r *= r;
  return r;
}
/** Natural log on (0, 1e300]: scale into [0.5, 1) by powers of two, then 2*atanh((m-1)/(m+1)) to 12 terms. */
export function logD(x: number): number {
  if (!(x > 0)) return -700;
  let m = x, k = 0;
  while (m >= 1) { m /= 2; k++; }
  while (m < 0.5) { m *= 2; k--; }
  const y = (m - 1) / (m + 1), y2 = y * y;
  let term = y, sum = 0;
  for (let n = 1; n <= 23; n += 2) { sum += term / n; term *= y2; }
  return 2 * sum + k * 0.6931471805599453;
}
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return (t ^ t >>> 14) >>> 0; }; }

// ---------------------------------------------------------------------------------------------------
// Reservoir.

export type ReservoirGraph = { nodes: number; leak: number; pre: readonly number[]; post: readonly number[]; weights: readonly number[] };
/** Fixed input projection (nodes x (1 + inputs)), drawn once from a published constant seed. */
function projection(): Float64Array {
  const next = mulberry(LEARNER_RULE.inputSeed), out = new Float64Array(N * (1 + LEARNER_INPUTS));
  for (let i = 0; i < out.length; i++) out[i] = ((next() / 4294967296) * 2 - 1) * LEARNER_RULE.inputScale;
  return out;
}
const PROJECTION = projection();

export type Learner = {
  graph: ReservoirGraph; h: Float64Array; actor: Float64Array; critic: Float64Array; learn: boolean;
  reward: number; last: { phi: Float64Array; action: number; probs: Float64Array; legal: Uint8Array; value: number } | null;
  updates: number; drift: number; actorRate: number; criticRate: number; fastRate: number; fastInputRate: number; entropy: number;
  /** Fast per-action weights over [1, inputs]: start at 0 at the first round of a bout, decay each decision, never stored in the checkpoint; carried to the next round of the same bout. */
  fast: Float64Array;
};
/** Rate overrides exist for offline experiments only; engines always use LEARNER_RULE. */
export type LearnerRates = { actor: number; critic: number; fast?: number; fastInputs?: number; entropy?: number };
export type LearnerParams = { actor: readonly number[]; critic: readonly number[] };
/** Everything a learner carries from one round of a bout to the next: the readout and the fast per-action weights. */
export type LearnerState = { actor: number[]; critic: number[]; fast: number[] };
export const zeroLearnerParams = (): LearnerParams => ({ actor: new Array(A * D).fill(0), critic: new Array(D).fill(0) });

export function createLearner(params: LearnerParams, { learn = true, graph = RESERVOIR as ReservoirGraph, rates, fast }: { learn?: boolean; graph?: ReservoirGraph; rates?: LearnerRates; fast?: readonly number[] } = {}): Learner {
  if (params.actor.length !== A * D || params.critic.length !== D) throw new TypeError('LEARNER_PARAMS_INVALID');
  if (fast && (fast.length !== A * FI || fast.some(v => !Number.isFinite(v)))) throw new TypeError('LEARNER_PARAMS_INVALID');
  return { graph, h: new Float64Array(N), actor: Float64Array.from(params.actor), critic: Float64Array.from(params.critic), learn, reward: 0, last: null, updates: 0, drift: 0,
    actorRate: rates?.actor ?? LEARNER_RULE.actorRate, criticRate: rates?.critic ?? LEARNER_RULE.criticRate, fastRate: rates?.fast ?? LEARNER_RULE.fastRate, fastInputRate: rates?.fastInputs ?? LEARNER_RULE.fastInputRate, entropy: rates?.entropy ?? LEARNER_RULE.entropy, fast: fast ? Float64Array.from(fast) : new Float64Array(A * FI) };
}

function checkInputs(x: readonly number[]) {
  if (x.length !== LEARNER_INPUTS) throw new TypeError('LEARNER_INPUT_INVALID');
  for (const v of x) if (!(v >= -1 && v <= 1)) throw new TypeError('LEARNER_INPUT_INVALID');
}
/** One recurrent step: h' = (1-leak) h + leak * tanh(P [1, x] + W h). */
export function reservoirStep(l: Learner, inputs: readonly number[]): void {
  checkInputs(inputs);
  const g = l.graph, incoming = new Float64Array(N);
  for (let e = 0; e < g.pre.length; e++) incoming[g.post[e]!]! += g.weights[e]! * l.h[g.pre[e]!]!;
  const row = 1 + LEARNER_INPUTS;
  for (let n = 0; n < N; n++) {
    let drive = PROJECTION[n * row]! + incoming[n]!;
    for (let i = 0; i < LEARNER_INPUTS; i++) drive += PROJECTION[n * row + 1 + i]! * inputs[i]!;
    l.h[n] = (1 - g.leak) * l.h[n]! + g.leak * tanhD(drive);
  }
}

function features(l: Learner, inputs: readonly number[]): Float64Array {
  const phi = new Float64Array(D);
  phi[0] = 1;
  for (let i = 0; i < LEARNER_INPUTS; i++) phi[1 + i] = inputs[i]!;
  for (let n = 0; n < N; n++) phi[1 + LEARNER_INPUTS + n] = l.h[n]!;
  return phi;
}
const dot = (w: Float64Array, offset: number, phi: Float64Array) => { let s = 0; for (let i = 0; i < D; i++) s += w[offset + i]! * phi[i]!; return s; };
const bound = (v: number, b: number) => v > b ? b : v < -b ? -b : v;

/** TD(0) actor-critic step for the previous decision, given the value of the new state (0 at the end). */
function update(l: Learner, nextValue: number): number {
  const last = l.last;
  if (!last || !l.learn) { l.reward = 0; return 0; }
  const R = LEARNER_RULE;
  const td = bound(l.reward + R.discount * nextValue - last.value, R.tdClip);
  l.reward = 0;
  const step = l.criticRate * td / D;
  for (let i = 0; i < D; i++) l.critic[i] = bound(l.critic[i]! + step * last.phi[i]!, R.criticBound);
  // Entropy bonus over the legal actions keeps the repertoire varied: dH/dz_a = -p_a (log p_a + H).
  let H = 0;
  for (let a = 0; a < A; a++) if (last.legal[a] && last.probs[a]! > 0) H -= last.probs[a]! * logD(last.probs[a]!);
  let drift = 0;
  for (let a = 0; a < A; a++) {
    for (let i = 0; i < FI; i++) l.fast[a * FI + i] = (1 - R.fastDecay) * l.fast[a * FI + i]!;
    if (!last.legal[a]) continue;
    const p = last.probs[a]!, signal = td * ((a === last.action ? 1 : 0) - p) - l.entropy * (p > 0 ? p * (logD(p) + H) : 0), g = l.actorRate * signal / D;
    l.fast[a * FI] = bound(l.fast[a * FI]! + l.fastRate * signal, R.actorBound);
    if (l.fastInputRate) for (let i = 1; i < FI; i++) l.fast[a * FI + i] = bound(l.fast[a * FI + i]! + l.fastInputRate * signal * last.phi[i]! / LEARNER_INPUTS, R.actorBound);
    if (g === 0) continue;
    for (let i = 0; i < D; i++) { const k = a * D + i, v = bound(l.actor[k]! + g * last.phi[i]!, R.actorBound); drift += v > l.actor[k]! ? v - l.actor[k]! : l.actor[k]! - v; l.actor[k] = v; }
  }
  l.updates++; l.drift += drift;
  return td;
}

export type LearnerChoice = { action: LearnerAction; index: number; probs: Float64Array; value: number; td: number };
/** Learns from the reward since the last decision, then samples the next action. `u` in [0, 1). */
export function learnerAct(l: Learner, inputs: readonly number[], legal: Uint8Array, u: number): LearnerChoice {
  checkInputs(inputs);
  if (legal.length !== A || !legal.some(Boolean)) throw new TypeError('LEARNER_MASK_INVALID');
  if (!(u >= 0 && u < 1)) throw new TypeError('LEARNER_SAMPLE_INVALID');
  const phi = features(l, inputs), value = dot(l.critic, 0, phi), td = update(l, value);
  const logits = new Float64Array(A);
  let max = -Infinity;
  for (let a = 0; a < A; a++) if (legal[a]) { let fast = l.fast[a * FI]!;
    for (let i = 1; i < FI; i++) fast += l.fast[a * FI + i]! * phi[i]!;
    logits[a] = (dot(l.actor, a * D, phi) + fast) / LEARNER_RULE.temperature; if (logits[a]! > max) max = logits[a]!; }
  const probs = new Float64Array(A);
  let sum = 0;
  for (let a = 0; a < A; a++) if (legal[a]) { probs[a] = expD(logits[a]! - max); sum += probs[a]!; }
  for (let a = 0; a < A; a++) probs[a] = probs[a]! / sum;
  let index = -1, acc = 0;
  for (let a = 0; a < A; a++) { if (!legal[a]) continue; acc += probs[a]!; index = a; if (u < acc) break; }
  l.last = { phi, action: index, probs, legal: legal.slice(), value };
  return { action: LEARNER_ACTIONS[index]!, index, probs, value, td };
}
export const learnerReward = (l: Learner, r: number) => { if (Number.isFinite(r)) l.reward += r; };
/** Terminal update at the end of the round. */
export function learnerFinish(l: Learner): number { const td = update(l, 0); l.last = null; return td; }
export const learnerParams = (l: Learner): LearnerParams => ({ actor: Array.from(l.actor), critic: Array.from(l.critic) });
/** Readout plus fast weights: the learner's whole carried state (the reservoir restarts from rest each round). */
export const learnerState = (l: Learner): LearnerState => ({ actor: Array.from(l.actor), critic: Array.from(l.critic), fast: Array.from(l.fast) });
export const LEARNER_FAST_SIZE = A * FI;

export const LEARNER_INFO = Object.freeze({ rule: LEARNER_RULE.name, reservoir: RESERVOIR_INFO.reservoirSha256, graph: RESERVOIR_INFO.graphSha256, actions: A, inputs: LEARNER_INPUTS, features: D });
