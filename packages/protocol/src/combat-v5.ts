/** Ringside Contact 5: the Contact 4 ring, physics, damage, knockdown count and referee, with every
 * tactical choice (which punch, whether to continue a combination, range and defence) made by an
 * in-match learner (contact-learner.ts) that reads observable fight state and a public corner plan
 * (corner-plan.ts). Only physical feasibility stays as rules: stamina, stun, the clinch range, the
 * count and the referee. Contact 3 and 4 are untouched and keep settling their own tickets.
 *
 * Determinism: same seed + initial state + plan log = same replay, including every weight update.
 * Positions are integer mm, one tick is 50 ms, plans arrive every 180 ticks (9 s).
 *
 * Tempo (V5_TEMPO, part of the engine id): a punch can only be thrown from within its reach (plus the
 * step a straight or hook carries), a combination holds at most three punches, and after it the fighter
 * resets (0.6 s plus 0.5 s per punch thrown) before the next attack unless a counter window is open.
 */
import type { FighterId } from './combat';
import { contactGuardPose, separateBodies, type ContactInitial, type ContactPose, type Point3 } from './combat-v3';
import type { V4Referee } from './combat-v4';
import { V5_STRIKES, isV5Kick, isV5Strike, type V5Action, type V5Event, type V5Fighter, type V5Frame, type V5Strike } from './combat-v5-strikes';
import { LEARNER_ACTIONS, LEARNER_FAST_SIZE, LEARNER_FEATURES, createLearner, learnerAct, learnerFinish, learnerReward, learnerState, reservoirStep, LEARNER_INFO, LEARNER_RULE, type Learner, type LearnerAction, type LearnerParams, type LearnerRates, type ReservoirGraph } from './contact-learner';
import { CONTACT_V5_PARAMS, CONTACT_V5_WEIGHTS_SHA, COMBAT_V5_VERSION } from './contact-v5-weights';
import { PLAN_COUNT, PLAN_TICKS, PLAN_WINDOW_TICKS, cornerObsHash, fallbackPlans, type CornerObservation, type CornerPlan, type CornerFighterObservation, type PlanEntry } from './corner-plan';
import { FIGHT_STYLES, canonicalJson, sha256Utf8Hex } from './fight-style';

export { COMBAT_V5_VERSION };
export const COMBAT_V5_DURATION_MS = 45_000;
export const V5_TICK_MS = 50;
const LAST_TICK = COMBAT_V5_DURATION_MS / V5_TICK_MS;
export const V5_PLAN_LEAD_MS = 2500;

/** Frozen reward shaping (observable events only) and action spans, part of the engine id. */
export const V5_REWARD = Object.freeze({ dealt: 0.01, taken: -0.01, blocked: -0.02, dodged: -0.06, dodge: 0.06, miss: -0.04, knockdown: 2, knocked: -2, adherence: 0.03 });
/** The referee lets a clinch happen at most once per 5 s (from the last break). */
export const V5_CLINCH_COOLDOWN = 100;
/** Published fighter traits for Contact 5 (Contact 4's shape, rebalanced for learning corners). */
export const V5_FIGHTERS: V5Traits = Object.freeze({
  kor: { reach: -25, power: 1.06, chin: 0.96, guard: 1 },
  ayaz: { reach: 35, power: 1, chin: 0.94, guard: 1.02 },
});
/** Physical rhythm rules, frozen with the engine: range gate (mm beyond reach), combination length,
 * guard reset after a combination (ticks), stamina recovery per tick and footwork spans (ticks). */
export const V5_TEMPO = Object.freeze({ strikeMargin: 100, comboMax: 3, reset: 10, resetPerPunch: 12, regen: 3, regenStriking: 0, regenClinch: 6, stunDecay: 2,
  spans: Object.freeze({ advance: 8, retreat: 8, circleLeft: 12, circleRight: 12, guard: 8, slip: 7, roll: 8 }) });
/** Kick and knee rules, frozen with the engine. A kick is a single blow (it never chains into a next blow, but it may
 * finish a combination). A kick that misses leaves the kicker open: the opponent gets a counter window of `openTicks`.
 * A head kick is blocked a little more often than a hook when the defender is not actively guarding (headBlock x the hook
 * base chance). While two fighters are clinched each gets a decision every `clinchDecision` ticks: hold, or knee out of it. */
export const V5_KICK_RULES = Object.freeze({ openTicks: 8, headBlock: 1.3, clinchDecision: 8 });
const SPANS: Readonly<Record<Exclude<LearnerAction, V5Strike | 'clinch'>, number>> = V5_TEMPO.spans;

/** Opponent model and lessons, frozen with the engine (part of the engine id). Every value is built from public fight
 * events only. `decay` is the weight of the newest observation of the opponent's choices, `defenceDecay` of its reactions
 * to my wind-ups, `successDecay` of its strike outcomes. They reset at the first round of a bout and carry over after. */
export const V5_MODEL = Object.freeze({ decay: 0.1, defenceDecay: 0.25, successDecay: 0.15, groups: Object.freeze(['straight', 'hook', 'upper', 'bodyPunch', 'lowKick', 'kick', 'teep', 'knee', 'clinch'] as const) });
const GROUP_OF: Readonly<Partial<Record<LearnerAction, number>>> = { jab: 0, cross: 0, leadHook: 1, rearHook: 1, uppercut: 2, bodyHook: 3, lowKick: 4, bodyKick: 5, headKick: 5, teep: 6, knee: 7, clinch: 8 };
const LESSON_ORDER = Object.keys(V5_STRIKES) as V5Strike[];
const LESSON_INDEX: Readonly<Record<V5Strike, number>> = Object.fromEntries(LESSON_ORDER.map((k, i) => [k, i])) as Record<V5Strike, number>;
/** What one fighter carries from a round to the next round of the same bout. Plain finite numbers (JSON safe).
 * actor/critic/fast are the learner's weights (empty arrays for a scripted corner); the rest is the opponent model:
 * freq (9 groups), defence (slip, roll, guard after my wind-up), success (opponent strike success rate) and the lessons
 * (landed / not landed per own technique). */
export type V5SideCarry = { actor: number[]; critic: number[]; fast: number[]; freq: number[]; defence: number[]; success: number; hit: number[]; fail: number[] };
export type V5Carry = { kor: V5SideCarry; ayaz: V5SideCarry };
const finiteArray = (x: unknown, n: number[]): x is number[] => Array.isArray(x) && n.includes(x.length) && x.every(v => typeof v === 'number' && Number.isFinite(v));
export function parseV5Carry(x: unknown): V5Carry | null {
  if (typeof x !== 'object' || x === null) return null;
  const keys = Object.keys(x).sort();
  if (keys.join() !== 'ayaz,kor') return null;
  const side = (c: unknown): c is V5SideCarry => {
    if (typeof c !== 'object' || c === null || Object.keys(c).sort().join() !== 'actor,critic,defence,fail,fast,freq,hit,success') return false;
    const o = c as Record<string, unknown>, full = Array.isArray(o.actor) && o.actor.length > 0, A = LEARNER_ACTIONS.length;
    return finiteArray(o.actor, full ? [A * LEARNER_FEATURES] : [0]) && finiteArray(o.critic, full ? [LEARNER_FEATURES] : [0]) && finiteArray(o.fast, full ? [LEARNER_FAST_SIZE] : [0])
      && finiteArray(o.freq, [V5_MODEL.groups.length]) && finiteArray(o.defence, [3]) && typeof o.success === 'number' && Number.isFinite(o.success) && finiteArray(o.hit, [LESSON_ORDER.length]) && finiteArray(o.fail, [LESSON_ORDER.length]);
  };
  const c = x as Record<string, unknown>;
  return side(c.kor) && side(c.ayaz) ? { kor: c.kor, ayaz: c.ayaz } : null;
}
/** SHA-256 over the canonical JSON of a carry: what a round's end state is committed to in audits. */
export const carryHash = (c: Readonly<V5Carry>): string => sha256Utf8Hex(canonicalJson(c));

export type V5Mind = { tick: number; side: FighterId; action: LearnerAction; p: number; top: [LearnerAction, number][]; value: number; td: number };
export type V5Learning = { updates: number; drift: number };
export type V5Replay = { version: typeof COMBAT_V5_VERSION; policy: string; seed: string; frames: V5Frame[]; events: V5Event[]; minds: V5Mind[]; carry: V5Carry; plans: { kor: CornerPlan; ayaz: CornerPlan }[]; learning: { kor: V5Learning; ayaz: V5Learning }; winner: FighterId | 'draw'; firstHit: FighterId | 'simultaneous' | 'none'; knockdown: 'yes' | 'no'; finish: 'stoppage' | 'decision'; points: { kor: number; ayaz: number } };

/** What a scripted (non-learning) evaluation opponent sees: the same observable state. */
export type V5ScriptView = { tick: number; distance: number; me: Readonly<V5Fighter>; opponent: Readonly<V5Fighter>; plan: CornerPlan; legal: (a: LearnerAction) => boolean; random: () => number };
export type V5Corner = { kind: 'learner'; params?: LearnerParams; learn?: boolean; graph?: ReservoirGraph; rates?: LearnerRates } | { kind: 'script'; control: (view: V5ScriptView) => LearnerAction };
export type V5Traits = Readonly<Record<FighterId, { reach: number; power: number; chin: number; guard: number }>>;
export type V5Options = { fighters?: V5Traits; round?: number; corners?: readonly [V5Corner, V5Corner]; minds?: boolean; carry?: V5Carry; onFinish?: (learners: readonly [Learner | null, Learner | null]) => void };

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const unit = (n: number) => n > 1 ? 1 : n < -1 ? -1 : n;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (x: number, y: number, z: number): Point3 => ({ x: Math.round(x), y: Math.round(y), z: Math.round(z) });
const BODY_RADIUS = 300, BOUND = 3100, NEUTRAL = 3100;
function rng(seed: string, stream: number) {
  let a = (parseInt(seed.slice(stream * 16, stream * 16 + 8), 16) ^ parseInt(seed.slice(stream * 16 + 8, stream * 16 + 16), 16)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return (t ^ t >>> 14) >>> 0; };
}

type Outcome = 'hit' | 'block' | 'dodge' | 'miss' | null;
/** What a fighter has learned about its opponent so far in the bout. */
type V5Memory = { freq: number[]; defence: number[]; success: number; hit: number[]; fail: number[] };
const freshMemory = (): V5Memory => ({ freq: new Array(V5_MODEL.groups.length).fill(0), defence: [0, 0, 0], success: 0.5, hit: new Array(LESSON_ORDER.length).fill(0), fail: new Array(LESSON_ORDER.length).fill(0) });
type Agent = V5Fighter & { leg: number; rng: () => number; points: number; resolved: boolean; counter: boolean; counterUntil: number; resetUntil: number; lastStrike: number; high: number; low: number; corner: { x: number; z: number } | null;
  side: 1 | -1; outcome: Outcome; plan: CornerPlan; memory: V5Memory; brain: Learner | null; script: ((view: V5ScriptView) => LearnerAction) | null };
const view = (a: Agent): V5Fighter => ({ id: a.id, x: a.x, z: a.z, yawMilliRad: a.yawMilliRad, health: a.health, stamina: a.stamina, stun: a.stun, action: a.action, actionAt: a.actionAt, until: a.until, phase: a.phase, combo: a.combo, hits: a.hits, knockdowns: a.knockdowns, pose: structuredClone(a.pose) });

function pose(a: Agent, b: Agent, tick: number): ContactPose {
  const p = contactGuardPose(a);
  if (a.action === 'down') return { ...p, head: point(a.x, 260, a.z), chest: point(a.x, 220, a.z), leftHand: point(a.x - 200, 80, a.z), rightHand: point(a.x + 200, 80, a.z), leftElbow: point(a.x - 220, 160, a.z), rightElbow: point(a.x + 220, 160, a.z) };
  if (!isV5Strike(a.action)) return p;
  const s = V5_STRIKES[a.action], age = tick - a.actionAt, leg = s.limb === 'leadLeg' || s.limb === 'rearLeg';
  const hand = a.action === 'knee' ? 'rightKnee' : ({ leadHand: 'leftHand', rearHand: 'rightHand', leadLeg: 'leftFoot', rearLeg: 'rightFoot' } as const)[s.limb];
  const out = age < s.wind ? age / s.wind * .2 : age < s.wind + s.active ? 1 : Math.max(0, 1 - (age - s.wind - s.active) / Math.max(1, s.end - s.wind - s.active));
  const height = leg ? (a.action === 'knee' ? 1000 : s.target === 'head' ? 1500 : s.target === 'leg' ? 450 : 1050) : s.target === 'head' ? 1620 : 1150;
  const target = point(b.x, height, b.z), from = p[hand];
  p[hand] = point(from.x + (target.x - from.x) * out * .8, from.y + (target.y - from.y) * out * .8, from.z + (target.z - from.z) * out * .8);
  return p;
}

const DEFAULT_PLAN: CornerPlan = Object.freeze({ intent: 'outboxer', target: 'head', threat: 'straight' }) as CornerPlan;
const INTENT_FAMILY: Readonly<Record<CornerPlan['intent'], readonly LearnerAction[]>> = {
  pressure: ['jab', 'cross', 'leadHook', 'rearHook', 'uppercut', 'bodyHook', 'advance', 'lowKick', 'bodyKick', 'knee'],
  counter: ['guard', 'slip', 'roll'],
  cautious: ['guard', 'retreat', 'circleLeft', 'circleRight', 'clinch', 'teep'],
  outboxer: ['jab', 'cross', 'retreat', 'circleLeft', 'circleRight', 'teep', 'lowKick'],
  body: ['bodyHook', 'uppercut', 'bodyKick', 'lowKick', 'knee'],
  finisher: ['cross', 'leadHook', 'rearHook', 'uppercut', 'headKick'],
};
const THREAT_DEFENCE = { straight: 'slip', hook: 'roll', upper: 'guard', body: 'guard' } as const;
/** Which defence family a visible wind-up belongs to (what the corner plan's threat names). Kicks to the body, legs and the knee count as body shots. */
const KIND_OF: Readonly<Record<V5Strike, 'straight' | 'hook' | 'upper' | 'body'>> = { jab: 'straight', cross: 'straight', leadHook: 'hook', rearHook: 'hook', uppercut: 'upper', bodyHook: 'body', teep: 'body', lowKick: 'body', bodyKick: 'body', headKick: 'hook', knee: 'body' };

export function createContactV5(seed: string, initial: ContactInitial = { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } }, options: V5Options = {}) {
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new TypeError('Expected a 32-byte lowercase seed');
  for (const key of ['health', 'stamina'] as const) for (const side of ['kor', 'ayaz'] as const) if (!Number.isInteger(initial[key][side]) || initial[key][side] < 1 || initial[key][side] > 1000) throw new TypeError('Invalid initial fighter state');
  const round = options.round ?? 1, F = options.fighters ?? V5_FIGHTERS;
  if (options.carry && !parseV5Carry(options.carry)) throw new TypeError('CARRY_INVALID');
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new TypeError('Invalid round');
  const corners = options.corners ?? [{ kind: 'learner' }, { kind: 'learner' }];
  const keepMinds = options.minds !== false;
  const create = (id: FighterId, index: number): Agent => {
    const base = { id, x: index ? 1300 : -1300, z: 0, yawMilliRad: index ? -1571 : 1571 }, c = corners[index]!, carried = options.carry?.[id];
    const memory: V5Memory = carried ? { freq: [...carried.freq], defence: [...carried.defence], success: carried.success, hit: [...carried.hit], fail: [...carried.fail] } : freshMemory();
    const learned = carried && carried.actor.length > 0 ? carried : null;
    return { ...base, health: initial.health[id], stamina: initial.stamina[id], stun: 0, action: 'guard', actionAt: 0, until: 6 + index * 3, phase: 'idle', combo: 0, hits: 0, knockdowns: 0, pose: contactGuardPose(base), rng: rng(seed, index),
      points: 0, resolved: true, counter: false, counterUntil: -1, resetUntil: 0, lastStrike: 0, high: -99, low: -99, leg: -99, corner: null, side: index ? -1 : 1, outcome: null, plan: DEFAULT_PLAN, memory,
      brain: c.kind === 'learner' ? createLearner(learned ? { actor: learned.actor, critic: learned.critic } : c.params ?? CONTACT_V5_PARAMS, { learn: c.learn ?? true, ...(learned ? { fast: learned.fast } : {}), ...(c.graph ? { graph: c.graph } : {}), ...(c.rates ? { rates: c.rates } : {}) }) : null, script: c.kind === 'script' ? c.control : null };
  };
  const agents = [create('kor', 0), create('ayaz', 1)] as [Agent, Agent];
  const judge = rng(seed, 2), ref: V4Referee = { x: 0, z: -1600, yawMilliRad: 0, mode: 'watch', count: 0 };
  const frames: V5Frame[] = [], events: V5Event[] = [], minds: V5Mind[] = [], plans: { kor: CornerPlan; ayaz: CornerPlan }[] = [];
  type Knock = { down: Agent; standing: Agent; at: number; count: number; stop: boolean };
  let stopped = false, winner: V5Replay['winner'] = 'draw', knock = null as Knock | null, clinchUntil = -1, lastBreak = -V5_CLINCH_COOLDOWN, tick = 0, finished = false;
  const emit = (t: number, type: V5Event['type'], a: Agent, b: Agent, technique: V5Action, damage = 0, extra: Partial<V5Event> = {}) => events.push({ tick: t, type, actor: a.id, target: b.id, technique, damage, ...extra });
  const set = (a: Agent, action: V5Action, t: number, span: number) => { a.action = action; a.actionAt = t; a.until = t + span; a.phase = isV5Strike(action) ? 'windup' : 'idle'; a.combo = isV5Strike(action) ? a.combo : 0; };
  const reachOf = (a: Agent, s: V5Strike) => V5_STRIKES[s].reach + F[a.id].reach;
  const separate = () => { for (let pass = 0; pass < 3; pass++) { separateBodies(agents[0], agents[1], BODY_RADIUS * 2); for (const x of agents) { x.x = clamp(x.x, -BOUND, BOUND); x.z = clamp(x.z, -BOUND, BOUND); } } };
  const reward = (a: Agent, r: number) => { if (a.brain) learnerReward(a.brain, r); };

  const inputs = (a: Agent, b: Agent): number[] => {
    const d = dist(a, b), bearing = Math.atan2(b.x - a.x, b.z - a.z), delta = Math.atan2(Math.sin(bearing - a.yawMilliRad / 1000), Math.cos(bearing - a.yawMilliRad / 1000)), visible = Math.abs(delta) <= Math.PI / 3;
    const windup = visible && isV5Strike(b.action) && b.phase === 'windup' ? KIND_OF[b.action] : null, p = a.plan;
    const windupKick = visible && isV5Kick(b.action) && b.phase === 'windup';
    const flag = (v: boolean) => v ? 1 : -1, intent = FIGHT_STYLES.indexOf(p.intent);
    return [
      unit(d / 1000 - 1.2), flag(d <= reachOf(a, 'jab')), flag(d <= reachOf(a, 'leadHook')), flag(d <= reachOf(a, 'uppercut')),
      a.health / 500 - 1, a.stamina / 500 - 1, unit(a.stun / 50 - 1), b.health / 500 - 1, b.stamina / 500 - 1, unit(b.stun / 50 - 1),
      flag(windup === 'straight'), flag(windup === 'hook'), flag(windup === 'upper'), flag(windup === 'body'), flag(visible && b.phase === 'recovery'), flag(b.action === 'guard'), flag(b.action === 'retreat'),
      flag(Math.abs(a.x) > 2600 || Math.abs(a.z) > 2600), flag(Math.abs(b.x) > 2600 || Math.abs(b.z) > 2600),
      flag(a.outcome === 'hit'), flag(a.outcome === 'block'), flag(a.outcome === 'dodge'), flag(a.outcome === 'miss'),
      isV5Strike(a.action) && !isV5Kick(a.action) && tick >= a.until ? unit(a.combo / 2) : -1, flag(tick < a.counterUntil), unit((tick - a.lastStrike) / 40 - 1), (LAST_TICK - tick) / LAST_TICK * 2 - 1, unit((a.points - b.points) / 300),
      flag(tick - a.high < 30), flag(tick - a.low < 30),
      ...FIGHT_STYLES.map((_, i) => flag(i === intent)), flag(p.target === 'head'), flag(p.target === 'body'),
      flag(p.threat === 'straight'), flag(p.threat === 'hook'), flag(p.threat === 'upper'), flag(p.threat === 'body'),
      flag(d <= reachOf(a, 'teep')), flag(d <= reachOf(a, 'bodyKick')), flag(d <= reachOf(a, 'knee')), flag(windupKick), flag(tick - a.leg < 30), flag(a.action === 'clinch' && tick < a.until),
      round - 2,
      ...a.memory.freq.map(f => unit(f * 3 - 1)), ...a.memory.defence.map(f => unit(f * 3 - 1)), unit(a.memory.success * 2 - 1),
      ...LESSON_ORDER.map((_, i) => (a.memory.hit[i]! - a.memory.fail[i]!) / (a.memory.hit[i]! + a.memory.fail[i]! + 2)),
    ];
  };
  /** A fighter in a clinch decides only between holding and a knee (which breaks the clinch for both). */
  const clinched = (a: Agent) => a.action === 'clinch' && tick < a.until;
  /** A blow continues a combination only after a punch that ended this very tick; a kick never chains. */
  const chains = (a: Agent) => isV5Strike(a.action) && !isV5Kick(a.action) && tick === a.until;
  const legal = (a: Agent, b: Agent, action: LearnerAction) => {
    const inClinch = clinched(a);
    if (isV5Strike(action)) {
      if (a.stun > 70 || a.stamina < V5_STRIKES[action].cost || dist(a, b) > reachOf(a, action) + V5_TEMPO.strikeMargin) return false;
      if (inClinch) return action === 'knee';
      return chains(a) ? a.combo + 1 < V5_TEMPO.comboMax : tick >= a.resetUntil || tick < a.counterUntil;
    }
    if (inClinch) return action === 'clinch';
    if (action === 'clinch') return dist(a, b) < 820 && tick - lastBreak >= V5_CLINCH_COOLDOWN && (a.stun > 40 || a.stamina < 300);
    return true;
  };
  const adherence = (a: Agent, b: Agent, action: LearnerAction) => {
    const p = a.plan;
    let bonus = INTENT_FAMILY[p.intent].includes(action) ? 1 : 0;
    if (isV5Strike(action) && (V5_STRIKES[action].target !== 'head') === (p.target === 'body')) bonus += 1;
    if (isV5Strike(b.action) && b.phase === 'windup' && action === THREAT_DEFENCE[p.threat]) bonus += 1;
    return bonus * V5_REWARD.adherence;
  };
  const startStrike = (a: Agent, b: Agent, s: V5Strike, combo: number, counter: boolean) => {
    const spec = V5_STRIKES[s];
    set(a, s, tick, combo > 0 ? spec.end - 2 : spec.end); a.combo = combo; a.counter = counter;
    a.stamina = Math.max(0, a.stamina - spec.cost); a.lastStrike = tick; a.resolved = false;
    // The reset runs from the end of this punch, however the combination ends (choice, stagger, break).
    a.resetUntil = a.until + V5_TEMPO.reset + V5_TEMPO.resetPerPunch * (combo + 1);
    emit(tick, 'strike', a, b, s, 0, { combo, ...(counter ? { counter: true } : {}) });
  };
  const clinch = (a: Agent, b: Agent) => {
    const span = 18 + judge() % 10;
    for (const x of [a, b]) set(x, 'clinch', tick, span);
    clinchUntil = tick + span; emit(tick, 'clinch', a, b, 'clinch');
  };
  /** A knee out of a clinch ends it for both: the other fighter is released into a short guard. */
  const breakClinch = (a: Agent, b: Agent) => { clinchUntil = -1; lastBreak = tick; emit(tick, 'break', a, b, 'clinch'); set(b, 'guard', tick, 5); };
  /** `me` watches `opp` choose: decayed frequency of its choice, and its reaction when I am winding up. */
  const observe = (me: Agent, opp: Agent, action: LearnerAction, held: boolean) => {
    const m = me.memory, g = held ? -1 : GROUP_OF[action] ?? -1, d = V5_MODEL.decay;
    for (let i = 0; i < m.freq.length; i++) m.freq[i] = m.freq[i]! * (1 - d) + (i === g ? d : 0);
    if (isV5Strike(me.action) && me.phase === 'windup' && !held) {
      const e = V5_MODEL.defenceDecay;
      (['slip', 'roll', 'guard'] as const).forEach((x, i) => { m.defence[i] = m.defence[i]! * (1 - e) + (action === x ? e : 0); });
    }
    void opp;
  };
  const decide = (a: Agent, b: Agent) => {
    const mask = new Uint8Array(LEARNER_ACTIONS.length);
    LEARNER_ACTIONS.forEach((action, i) => { mask[i] = legal(a, b, action) ? 1 : 0; });
    let action: LearnerAction;
    if (a.brain) {
      const choice = learnerAct(a.brain, inputs(a, b), mask, a.rng() / 4294967296);
      action = choice.action;
      if (keepMinds) {
        const order = LEARNER_ACTIONS.map((x, i) => [x, Math.round(choice.probs[i]! * 1000)] as [LearnerAction, number]).sort((x, y) => y[1] - x[1]).slice(0, 3);
        minds.push({ tick, side: a.id, action, p: Math.round(choice.probs[choice.index]! * 1000), top: order, value: Math.round(choice.value * 1000), td: Math.round(choice.td * 1000) });
      }
    } else {
      const r = a.rng;
      action = a.script!({ tick, distance: dist(a, b), me: a, opponent: b, plan: a.plan, legal: x => legal(a, b, x), random: () => r() % 100 });
      if (!legal(a, b, action)) action = clinched(a) ? 'clinch' : 'guard';
    }
    reward(a, adherence(a, b, action));
    const chain = chains(a), held = clinched(a);
    observe(b, a, action, held);
    if (isV5Strike(action)) { if (held) breakClinch(a, b); startStrike(a, b, action, chain ? a.combo + 1 : 0, tick < a.counterUntil); }
    else if (action === 'clinch') { if (!held) clinch(a, b); }
    else set(a, action === 'circleLeft' || action === 'circleRight' ? 'circle' : action, tick, SPANS[action]);
    if (action === 'circleLeft') a.side = 1; else if (action === 'circleRight') a.side = -1;
    if (!isV5Strike(action)) a.counter = false;
  };
  const resolve = (a: Agent, b: Agent) => {
    const s = a.action as V5Strike, spec = V5_STRIKES[s], d = dist(a, b), kick = isV5Kick(s), leg = spec.target === 'leg';
    a.resolved = true;
    const extra = { combo: a.combo, ...(a.counter ? { counter: true } : {}) };
    if (d > reachOf(a, s) || ['down', 'rise', 'neutral', 'clinch'].includes(b.action)) {
      a.outcome = 'miss'; reward(a, V5_REWARD.miss); emit(tick, 'miss', a, b, s, 0, extra);
      a.memory.fail[LESSON_INDEX[s]!]!++; b.memory.success *= 1 - V5_MODEL.successDecay;
      // A kicker who misses is still on one leg: the opponent gets the same short window a dodge gives.
      if (kick && d > reachOf(a, s)) b.counterUntil = Math.max(b.counterUntil, tick + V5_KICK_RULES.openTicks);
      return;
    }
    const busy = isV5Strike(b.action) && b.phase !== 'recovery' && !b.resolved, stunned = b.stun > 70;
    const staminaF = .55 + .45 * b.stamina / 1000, roll = judge() % 1000 / 1000;
    let outcome: 'hit' | 'block' | 'dodge' = 'hit', mult = 1;
    if (spec.target === 'head') {
      const early = tick - b.actionAt <= 4 && roll < .72;
      if (b.action === 'slip' && spec.kind === 'straight' && early) outcome = 'dodge';
      else if (b.action === 'roll' && spec.kind === 'hook' && early) outcome = 'dodge';
      else if (b.action === 'roll' && spec.kind === 'upper') mult = 1.35;
      else if (b.action === 'guard') outcome = spec.kind === 'upper' && roll < .5 ? 'hit' : 'block';
      else {
        const block = busy ? .08 : ({ straight: .36, hook: .26, upper: .18 } as const)[spec.kind] * (kick ? V5_KICK_RULES.headBlock : 1) * F[b.id].guard * staminaF * (stunned ? .45 : 1);
        const slip = (b.action === 'circle' || b.action === 'retreat') && spec.kind === 'straight' ? .12 : .04;
        outcome = roll < block ? 'block' : roll < block + slip ? 'dodge' : 'hit';
      }
    } else {
      const block = busy ? .05 : (b.action === 'guard' ? .3 : .22) * F[b.id].guard * staminaF;
      outcome = roll < block ? 'block' : 'hit';
    }
    a.outcome = outcome;
    // Both corners see how the blow ended: lessons for the attacker, the opponent's success rate for the defender.
    const li = LESSON_INDEX[s]!, sd = V5_MODEL.successDecay;
    if (outcome === 'hit') a.memory.hit[li]!++; else a.memory.fail[li]!++;
    b.memory.success = b.memory.success * (1 - sd) + (outcome === 'hit' ? sd : 0);
    if (outcome === 'dodge') { b.counterUntil = tick + (kick ? V5_KICK_RULES.openTicks : 8); reward(a, V5_REWARD.dodged); reward(b, V5_REWARD.dodge); emit(tick, 'dodge', a, b, s, 0, extra); return; }
    const base = spec.damage * F[a.id].power * (.6 + .4 * a.stamina / 1000);
    if (outcome === 'block') {
      const dmg = Math.floor(base / 6);
      b.health = Math.max(Math.min(b.health, leg ? 1 : 0), b.health - dmg); b.stamina = Math.max(0, b.stamina - 15); if (!leg) b.stun += 2; a.points += dmg; b.counterUntil = tick + 5;
      reward(a, V5_REWARD.blocked + dmg * V5_REWARD.dealt); reward(b, dmg * V5_REWARD.taken);
      emit(tick, 'block', a, b, s, dmg, { ...extra, bodyPart: 'guard' }); return;
    }
    const dmg = Math.round(base * mult * (.85 + judge() % 300 / 1000) * (a.counter ? 1.3 : 1) * (busy ? 1.15 : 1));
    // A low kick scores and drains stamina but can never finish a fighter: health stays at 1 or more.
    b.health = Math.max(Math.min(b.health, leg ? 1 : 0), b.health - dmg); a.hits++; a.points += dmg;
    reward(a, dmg * V5_REWARD.dealt); reward(b, dmg * V5_REWARD.taken);
    if (spec.target === 'head') { b.stun += Math.round(spec.stun * dmg / spec.damage / F[b.id].chin); b.high = tick; }
    else { b.stamina = Math.max(0, b.stamina - spec.drain); if (leg) b.leg = tick; else b.low = tick; }
    emit(tick, 'hit', a, b, s, dmg, { ...extra, bodyPart: spec.target });
    if (spec.push > 0) { const u = d || 1; b.x = Math.round(b.x + (b.x - a.x) / u * spec.push); b.z = Math.round(b.z + (b.z - a.z) / u * spec.push); separate(); }
    if (busy || b.stun > 55) { if (isV5Strike(b.action) && b.resolved) b.until = Math.min(b.until, tick + 3); else set(b, 'stagger', tick, b.stun > 55 ? 7 : 4); }
    const threshold = (40 + b.health / 14) * F[b.id].chin;
    if (!leg && (b.health <= 0 || (spec.target === 'head' && b.stun >= threshold))) {
      b.knockdowns++; a.points += 120; reward(a, V5_REWARD.knockdown); reward(b, V5_REWARD.knocked);
      set(b, 'down', tick, 999); if (isV5Strike(a.action)) a.until = Math.min(a.until, tick + 4); else set(a, 'neutral', tick, 999);
      const corners = [{ x: -NEUTRAL, z: -NEUTRAL }, { x: NEUTRAL, z: NEUTRAL }];
      a.corner = dist(corners[0]!, b) > dist(corners[1]!, b) ? corners[0]! : corners[1]!;
      const stop = b.health <= 0 || b.knockdowns >= 3;
      knock = { down: b, standing: a, at: tick, count: stop ? 0 : clamp(3 + b.rng() % 4 + Math.floor((1000 - b.health) / 300), 3, 9), stop };
      emit(tick, 'knockdown', a, b, s, 0);
    }
  };

  const step = () => {
    if (!stopped) {
      for (const a of agents) { a.stun = Math.max(0, a.stun - V5_TEMPO.stunDecay); a.stamina = Math.min(1000, a.stamina + (isV5Strike(a.action) ? V5_TEMPO.regenStriking : a.action === 'clinch' ? V5_TEMPO.regenClinch : V5_TEMPO.regen)); }
      if (tick % LEARNER_RULE.reservoirStride === 0) for (let i = 0; i < 2; i++) { const a = agents[i]!; if (a.brain) reservoirStep(a.brain, inputs(a, agents[1 - i]!)); }
      if (knock) {
        const k = knock, since = tick - k.at;
        if (k.standing.action !== 'neutral' && tick >= k.standing.until) set(k.standing, 'neutral', tick, 999);
        if (k.stop && since === 30) { stopped = true; winner = k.standing.id; ref.mode = 'stop'; set(k.standing, 'guard', tick, 999); emit(tick, 'finish', k.standing, k.down, 'down'); }
        else if (!k.stop && since > 0 && since % 20 === 0 && since / 20 <= k.count) { ref.count = since / 20; emit(tick, 'count', k.standing, k.down, 'down', 0, { count: ref.count }); }
        if (!k.stop && since === k.count * 20 + 4) { set(k.down, 'rise', tick, 16); k.down.stun = 20; emit(tick, 'rise', k.down, k.standing, 'rise'); }
        if (!k.stop && since === k.count * 20 + 20) { set(k.down, 'guard', tick, 8); set(k.standing, 'advance', tick, 8); k.standing.corner = null; knock = null; ref.mode = 'watch'; ref.count = 0; }
      }
      if (clinchUntil === tick) { lastBreak = tick; emit(tick, 'break', agents[0], agents[1], 'clinch'); for (const a of agents) set(a, 'retreat', tick, 6); }
      if (!stopped && !knock) for (let i = 0; i < 2; i++) {
        const a = agents[i]!, b = agents[1 - i]!;
        if (clinched(a)) { if (tick > a.actionAt && (tick - a.actionAt) % V5_KICK_RULES.clinchDecision === 0) decide(a, b); continue; }
        if (tick >= a.until) decide(a, b);
      }
      for (let i = 0; i < 2; i++) {
        const a = agents[i]!, b = agents[1 - i]!, d = dist(a, b) || 1, dx = (b.x - a.x) / d, dz = (b.z - a.z) / d, side = a.side;
        const move = (f: number, l: number) => { a.x += Math.round(dx * f - dz * l); a.z += Math.round(dz * f + dx * l); };
        if (isV5Strike(a.action)) {
          const s = V5_STRIKES[a.action], age = tick - a.actionAt; a.phase = age < s.wind ? 'windup' : age < s.wind + s.active ? 'active' : 'recovery';
          // Punches step in to their usual range; a kick or knee only closes the last gap to its own reach.
          if (age <= s.wind) { if (isV5Kick(a.action)) { if (d > reachOf(a, a.action) - 60) move(28, 0); } else if (d > (s.kind === 'straight' ? 940 : 800)) move(s.kind === 'straight' ? 45 : 28, 0); }
        }
        else if (a.action === 'advance') { if (d > 720) move(Math.min(65, d - 700), 0); }
        else if (a.action === 'retreat') move(-45, 0);
        else if (a.action === 'circle') move(d < 1000 ? -15 : d > 1300 ? 15 : 0, 30 * side);
        else if (a.action === 'slip' || a.action === 'roll') move(-8, 12 * side);
        else if (a.action === 'stagger') move(-22, 10 * side);
        else if (a.action === 'guard') { if (d < 700) move(-15, 0); }
        else if (a.action === 'clinch') { if (d > 640) move(Math.min(30, (d - 620) / 2), 0); }
        else if (a.action === 'neutral' && a.corner) { const cd = dist(a, a.corner); if (cd > 350) { a.x += Math.round((a.corner.x - a.x) / cd * Math.min(55, cd - 350)); a.z += Math.round((a.corner.z - a.z) / cd * Math.min(55, cd - 350)); } }
      }
      separate();
      for (let i = 0; i < 2; i++) { const a = agents[i]!, b = agents[1 - i]!; if (a.action !== 'down' && a.action !== 'neutral') a.yawMilliRad = Math.round(Math.atan2(b.x - a.x, b.z - a.z) * 1000); else if (a.action === 'neutral' && a.corner && dist(a, a.corner) > 360) a.yawMilliRad = Math.round(Math.atan2(a.corner.x - a.x, a.corner.z - a.z) * 1000); }
      for (let i = 0; i < 2; i++) { const a = agents[i]!, b = agents[1 - i]!; if (isV5Strike(a.action) && !a.resolved && tick - a.actionAt === V5_STRIKES[a.action].wind && !knock) resolve(a, b); }
      const [k0, a0] = agents, mid = { x: (k0.x + a0.x) / 2, z: (k0.z + a0.z) / 2 };
      let goal: { x: number; z: number };
      if (knock) { ref.mode = knock.stop ? 'stop' : 'count'; const v = dist(ref, knock.down) || 1; goal = { x: knock.down.x + (ref.x - knock.down.x) / v * 950, z: knock.down.z + (ref.z - knock.down.z) / v * 950 }; }
      else {
        const ax = a0.x - k0.x, az = a0.z - k0.z, n = Math.hypot(ax, az) || 1, px = -az / n, pz = ax / n, sgn = (ref.x - mid.x) * px + (ref.z - mid.z) * pz >= 0 ? 1 : -1;
        const span = k0.action === 'clinch' ? 520 : 1550; ref.mode = k0.action === 'clinch' ? 'break' : 'watch';
        goal = { x: clamp(mid.x + px * span * sgn, -BOUND, BOUND), z: clamp(mid.z + pz * span * sgn, -BOUND, BOUND) };
      }
      const rd = dist(ref, goal);
      if (rd > 1) { const st = Math.min(42, rd); ref.x = Math.round(ref.x + (goal.x - ref.x) / rd * st); ref.z = Math.round(ref.z + (goal.z - ref.z) / rd * st); }
      for (let pass = 0; pass < 3; pass++) for (const a of agents) { const d = dist(ref, a), min = ref.mode === 'break' ? 420 : 680; if (d < min) { const ux = d ? (ref.x - a.x) / d : 0, uz = d ? (ref.z - a.z) / d : -1; ref.x = Math.round(a.x + ux * (min + 2)); ref.z = Math.round(a.z + uz * (min + 2)); } }
      ref.x = clamp(ref.x, -BOUND, BOUND); ref.z = clamp(ref.z, -BOUND, BOUND);
      const look = knock ? knock.down : mid; ref.yawMilliRad = Math.round(Math.atan2(look.x - ref.x, look.z - ref.z) * 1000);
      agents[0].pose = pose(agents[0], agents[1], tick); agents[1].pose = pose(agents[1], agents[0], tick);
    }
    frames.push({ tick, kor: view(agents[0]), ayaz: view(agents[1]), referee: { ...ref } });
    tick++;
  };

  /** Public corner observation at the current tick, built from the last 18 seconds of events. */
  const observation = (): CornerObservation => {
    const from = tick - PLAN_WINDOW_TICKS, recent = events.filter(e => e.tick >= from && e.tick < tick);
    const fighter = (a: Agent): CornerFighterObservation => {
      const mine = recent.filter(e => e.actor === a.id), mix = { straight: 0, hook: 0, upper: 0, body: 0 };
      for (const e of mine) if (e.type === 'strike' && isV5Strike(e.technique)) mix[KIND_OF[e.technique]]++;
      return { health: a.health, stamina: a.stamina, knockdowns: a.knockdowns, points: a.points, thrown: mine.filter(e => e.type === 'strike').length, landed: mine.filter(e => e.type === 'hit').length,
        blocked: mine.filter(e => e.type === 'block').length, slipped: mine.filter(e => e.type === 'dodge').length, headLanded: mine.filter(e => e.type === 'hit' && e.bodyPart === 'head').length,
        bodyLanded: mine.filter(e => e.type === 'hit' && e.bodyPart === 'body').length, mix };
    };
    return { round, rounds: 3, secondsLeft: Math.floor((LAST_TICK - tick) * V5_TICK_MS / 1000), kor: fighter(agents[0]), ayaz: fighter(agents[1]) };
  };
  const planIndex = () => plans.length;
  const finish = (): V5Replay => {
    if (!finished) { finished = true; for (const a of agents) if (a.brain) learnerFinish(a.brain); }
    const points = { kor: agents[0].points, ayaz: agents[1].points };
    if (!stopped) winner = points.kor === points.ayaz ? 'draw' : points.kor > points.ayaz ? 'kor' : 'ayaz';
    const first = events.find(e => e.type === 'hit');
    const side = (a: Agent): V5SideCarry => ({ ...(a.brain ? learnerState(a.brain) : { actor: [], critic: [], fast: [] }), freq: [...a.memory.freq], defence: [...a.memory.defence], success: a.memory.success, hit: [...a.memory.hit], fail: [...a.memory.fail] });
    const learning = (a: Agent): V5Learning => ({ updates: a.brain?.updates ?? 0, drift: Math.round((a.brain?.drift ?? 0) * 1000) });
    return { version: COMBAT_V5_VERSION, policy: `${LEARNER_INFO.rule}:${CONTACT_V5_WEIGHTS_SHA.slice(0, 16)}`, seed, frames, events, minds, carry: { kor: side(agents[0]), ayaz: side(agents[1]) }, plans, learning: { kor: learning(agents[0]), ayaz: learning(agents[1]) }, winner,
      firstHit: !first ? 'none' : events.some(e => e.type === 'hit' && e.tick === first.tick && e.actor !== first.actor) ? 'simultaneous' : first.actor,
      knockdown: events.some(e => e.type === 'knockdown') ? 'yes' : 'no', finish: stopped ? 'stoppage' : 'decision', points };
  };
  return {
    get tick() { return tick; },
    get done() { return tick > LAST_TICK; },
    planIndex, observation,
    /** Commits the plans for the current segment and plays it (180 ticks; the last one through tick 900). */
    playSegment(next: { kor: CornerPlan; ayaz: CornerPlan }) {
      const k = plans.length;
      if (k >= PLAN_COUNT || tick !== k * PLAN_TICKS) throw new Error('PLAN_OUT_OF_ORDER');
      plans.push({ kor: { ...next.kor }, ayaz: { ...next.ayaz } }); agents[0].plan = next.kor; agents[1].plan = next.ayaz;
      const end = k === PLAN_COUNT - 1 ? LAST_TICK : (k + 1) * PLAN_TICKS - 1;
      while (tick <= end) step();
    },
    replay: finish,
    learners: () => [agents[0].brain, agents[1].brain] as const,
    /** Frames, events and learner traces played so far (no terminal update). */
    partial: () => ({ frames, events, minds }),
  };
}
export type ContactV5Match = ReturnType<typeof createContactV5>;
export type V5PlanSource = readonly { kor: CornerPlan; ayaz: CornerPlan }[] | ((index: number, observation: CornerObservation) => { kor: CornerPlan; ayaz: CornerPlan });

let weightsChecked = false;
/** Full round. A plan array replays a published log; a function supplies plans live (fallback by default). */
export function simulateContactCombatV5(seed: string, initial?: ContactInitial, source: V5PlanSource = (_, o) => fallbackPlans(o), options: V5Options = {}): V5Replay {
  if (!weightsChecked) { if (!/^[0-9a-f]{64}$/.test(CONTACT_V5_WEIGHTS_SHA) || !COMBAT_V5_VERSION.endsWith(CONTACT_V5_WEIGHTS_SHA.slice(0, 8))) throw new Error('Frozen learner changed; create a new arena version'); weightsChecked = true; }
  const match = createContactV5(seed, initial, options);
  for (let k = 0; k < PLAN_COUNT; k++) {
    const o = match.observation();
    const plan = typeof source === 'function' ? source(k, o) : source[k];
    if (!plan) throw new Error('PLAN_MISSING');
    match.playSegment(plan);
  }
  const replay = match.replay();
  options.onFinish?.(match.learners());
  return replay;
}
export function contactFrameAtV5(replay: Pick<V5Replay, 'frames'>, elapsedMs: number) { return replay.frames[Math.floor(clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, COMBAT_V5_DURATION_MS) / V5_TICK_MS)]; }

export type V5Progress = { ok: true; frames: V5Frame[]; events: V5Event[]; minds: V5Mind[]; next: CornerObservation | null; replay: V5Replay | null } | { ok: false; index: number };
/** Replays committed plan entries and checks each entry's observation hash against the replayed state.
 * With fewer than 8 entries it returns the frames so far and the observation the next plan must answer;
 * with all 8 it returns the full replay. Servers and browsers use the same function. Chain hashes are
 * checked separately by verifyPlanChain. */
export function replayContactV5(seed: string, initial: ContactInitial, round: number, entries: readonly Pick<PlanEntry, 'obsHash' | 'plans'>[], minds = true, carry?: V5Carry): V5Progress {
  if (entries.length > PLAN_COUNT) return { ok: false, index: PLAN_COUNT };
  if (carry && !parseV5Carry(carry)) return { ok: false, index: 0 };
  const match = createContactV5(seed, initial, { round, minds, ...(carry ? { carry } : {}) });
  for (let k = 0; k < entries.length; k++) {
    if (cornerObsHash(match.observation()) !== entries[k]!.obsHash) return { ok: false, index: k };
    match.playSegment(entries[k]!.plans);
  }
  if (entries.length < PLAN_COUNT) return { ok: true, ...match.partial(), next: match.observation(), replay: null };
  const replay = match.replay();
  return { ok: true, frames: replay.frames, events: replay.events, minds: replay.minds, next: null, replay };
}

/** Replays the finished rounds of a bout one after another, each starting from the carry the previous one ended with
 * (round 1 has none). The carry for the next round is `replays.at(-1).carry`. Returns null when a record does not replay. */
export function replayMatchRounds(records: readonly { seed: string; initial: ContactInitial; plans: readonly Pick<PlanEntry, 'obsHash' | 'plans'>[] }[], minds = false): V5Replay[] | null {
  const replays: V5Replay[] = [];
  let carry: V5Carry | undefined;
  for (let k = 0; k < records.length; k++) {
    const rec = records[k]!, p = replayContactV5(rec.seed, rec.initial, k + 1, rec.plans, minds, carry);
    if (!p.ok || !p.replay) return null;
    replays.push(p.replay); carry = p.replay.carry;
  }
  return replays;
}
