/**
 * NeuroBoxer v2 ("neuro-2"): a learned strategist head commits a fighting style (fight-style.ts) during
 * the bout and a style-conditioned tactical brain fights in it. The recurrent memory is the same fixed
 * 128-node MaleCNS v1.0 descending-neuron subgraph as neuro-1 (CC BY 4.0; FlyEM/HHMI Janelia, Cambridge,
 * MRC LMB, Google Research). Projections, readouts and the strategist are trained with evolution
 * strategies on fight outcomes (experiments/neuro-boxer/train-style.ts). neuro-1 (neuro-boxer.ts) is
 * unchanged and stays selectable.
 *
 * Observations (40): neuro-1's 22 perceived values, 12 strategic values (scorecards, round, both knockdown
 * counts, this round's judged damage margin, the opponent's bucketed visible fatigue, six opponent-tendency
 * EMAs from public per-tick evidence) and the committed style one-hot. Never wagers, balances, identities,
 * seeds or future ticks. The style label is a learned latent choice, not reasoning or consciousness, and a
 * 128-node subgraph is not a fly brain.
 */
import { SPARRING_HZ, type SparringCommand, type SparringInput, type SparringSide, type SparringState } from "./combat-sparring";
import { FIGHT_STYLES, type FightStyle } from "./fight-style";
import { NEURO_COMMANDS, NEURO_DECISION_TICKS, NEURO_MOVES, NEURO_NODES, NEURO_OBS, neuroObserve, type NeuroGraph } from "./neuro-boxer";

export const NEURO2_VERSION = "neuro-2" as const;
/** Strategic inputs, in observation order after neuro-1's 22. */
export const NEURO2_STRATEGIC = ["cards", "round", "ownKnockdowns", "opKnockdowns", "roundDamage", "opFatigue", "opJabShare", "opAttackRate", "opBlockShare", "opForward", "opSlipDash", "opCounters"] as const;
export type Neuro2StrategicKey = typeof NEURO2_STRATEGIC[number];
export const NEURO2_STRATEGIC_OBS = NEURO2_STRATEGIC.length;
export const NEURO2_STRATEGIC_OFFSET = NEURO_OBS;
export const NEURO2_STYLE_OFFSET = NEURO_OBS + NEURO2_STRATEGIC_OBS;
export const NEURO2_OBS = NEURO2_STYLE_OFFSET + FIGHT_STYLES.length;
export const NEURO2_OUT = NEURO_MOVES.length + 2 + NEURO_COMMANDS.length;
export const NEURO2_IN_PARAMS = NEURO_NODES * (NEURO2_OBS + 1);
export const NEURO2_OUT_PARAMS = NEURO2_OUT * (1 + NEURO2_OBS + NEURO_NODES);
/** Strategist row: [bias, 12 strategic inputs, 128 memory nodes] per style. */
export const NEURO2_STYLE_WIDTH = 1 + NEURO2_STRATEGIC_OBS + NEURO_NODES;
export const NEURO2_STYLE_PARAMS = FIGHT_STYLES.length * NEURO2_STYLE_WIDTH;
export const NEURO2_DIM = NEURO2_IN_PARAMS + NEURO2_OUT_PARAMS + NEURO2_STYLE_PARAMS;
/** The strategist is evaluated at roundstart, after a knockdown/getup, and every 45 decisions (3 s at 15 Hz). */
export const NEURO2_STRATEGY_DECISIONS = 45;
/** Hysteresis: hold a committed style >= 3 s; switch only when the candidate's probability beats it by >= 0.15. */
export const NEURO2_MIN_HOLD_TICKS = 3 * SPARRING_HZ;
export const NEURO2_SWITCH_MARGIN = .15;
/** Attribution entries per style: bias, the 12 strategic inputs, then the 128-node memory as one aggregate. */
export const NEURO2_ATTRIBUTION = 1 + NEURO2_STRATEGIC_OBS + 1;

export type Neuro2Params = { inW: Float64Array; outW: Float64Array; styleW: Float64Array; leak: number; recurrent: boolean };
export type Neuro2StyleSource = "neuro" | "external";
export type Neuro2Options = {
  /** > 0 samples every head (and the strategist) from a hash of (bout seed, tick, side): exact replay. 0 = greedy. */
  temperature?: number;
  /** Externally committed style (TypeSafe Jev, fallback or cache, from a decision log). It enters the tactical
   * brain from that tick on; the strategist head is still evaluated for display and never overrides it. */
  style?: FightStyle | null;
};
export type Neuro2Memory = {
  version: typeof NEURO2_VERSION;
  h: Float64Array; held: SparringInput; obs: Float64Array; logits: Float64Array;
  /** Committed style, the tick it was committed (-1 before the first commit) and who committed it. */
  style: FightStyle; styleSince: number; styleSource: Neuro2StyleSource;
  /** Strategist head at its last evaluation: softmax probabilities (FIGHT_STYLES order, temperature 1), its own pick. */
  styleP: number[]; styleLogits: Float64Array; suggested: FightStyle; styleEvaluatedAt: number;
  /** Centred logit attribution [style][bias, strategic..., memory] and the strategic inputs it was computed from. */
  attribution: Float64Array; strategicAtEval: Float64Array;
  /** Raw opponent-tendency EMAs (see neuro2Track): jab share, attacks/s, block share, forward m/s, slip+dash/s, counters per own attack. */
  tendency: Float64Array;
  decisions: number; strategyAt: number; strategyDue: boolean; evaluations: number; switches: number;
  /** Last tick handed to neuro2Input / tracked; ticks skipped by a caller are counted (events would be missed). */
  tick: number; trackedTick: number; trackRoundTick: number; trackGaps: number;
  tickInput: SparringInput;
  incoming: Float64Array; next: Float64Array;
};
export type Neuro2Reason = { key: Neuro2StrategicKey | "memory" | "bias"; label: string; weight: number };
export type Neuro2Thought = {
  style: FightStyle; styleSource: Neuro2StyleSource; styleP: number[]; heldTicks: number; suggested: FightStyle;
  reasons: Neuro2Reason[]; move: string; guard: boolean; command: string; moveP: number[]; commandP: number[];
};

const NEUTRAL: SparringInput = Object.freeze({ moveX: 0, moveZ: 0, guard: false, action: null });
// Tendency priors and EMA rates: events average over ~10 occurrences, per-tick rates over ~15 s of fighting.
const TENDENCY_PRIOR = [.5, .75, .4, 0, .05, .15] as const, EVENT_RATE = .1, TICK_RATE = 1 / (15 * SPARRING_HZ);

export function createNeuro2Memory(): Neuro2Memory {
  return { version: NEURO2_VERSION, h: new Float64Array(NEURO_NODES), held: { ...NEUTRAL }, obs: new Float64Array(NEURO2_OBS), logits: new Float64Array(NEURO2_OUT),
    style: FIGHT_STYLES[0], styleSince: -1, styleSource: "neuro", styleP: FIGHT_STYLES.map(() => 1 / FIGHT_STYLES.length), styleLogits: new Float64Array(FIGHT_STYLES.length), suggested: FIGHT_STYLES[0], styleEvaluatedAt: -1,
    attribution: new Float64Array(FIGHT_STYLES.length * NEURO2_ATTRIBUTION), strategicAtEval: new Float64Array(NEURO2_STRATEGIC_OBS), tendency: Float64Array.from(TENDENCY_PRIOR),
    decisions: 0, strategyAt: 0, strategyDue: true, evaluations: 0, switches: 0, tick: -1, trackedTick: -1, trackRoundTick: 0, trackGaps: 0, tickInput: { ...NEUTRAL },
    incoming: new Float64Array(NEURO_NODES), next: new Float64Array(NEURO_NODES) };
}
/** Splits a flat theta (inW | outW | styleW) into parameter views. */
export function neuro2Params(theta: Float64Array, options: { leak?: number; recurrent?: boolean } = {}): Neuro2Params {
  if (theta.length !== NEURO2_DIM) throw new RangeError(`neuro-2 theta must have ${NEURO2_DIM} values`);
  return { inW: theta.subarray(0, NEURO2_IN_PARAMS), outW: theta.subarray(NEURO2_IN_PARAMS, NEURO2_IN_PARAMS + NEURO2_OUT_PARAMS), styleW: theta.subarray(NEURO2_IN_PARAMS + NEURO2_OUT_PARAMS), leak: options.leak ?? .35, recurrent: options.recurrent ?? true };
}

const clamp = (n: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n));
const hashUnit = (...parts: number[]) => { let h = 2166136261; for (const p of parts) { h ^= p >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; } return (h >>> 8) / 16777216; };
const sample = (v: ArrayLike<number>, from: number, count: number, t: number, u: number) => { let m = -Infinity; for (let i = from; i < from + count; i++) m = Math.max(m, v[i]!); let sum = 0; const e: number[] = []; for (let i = from; i < from + count; i++) { const x = Math.exp((v[i]! - m) / t); e.push(x); sum += x; } let acc = 0; for (let i = 0; i < count; i++) { acc += e[i]! / sum; if (u < acc) return i; } return count - 1; };
const argmax = (v: ArrayLike<number>, from: number, count: number) => { let best = from; for (let i = from + 1; i < from + count; i++) if (v[i]! > v[best]!) best = i; return best - from; };
const softmax = (v: ArrayLike<number>, from: number, count: number) => { let m = -Infinity; for (let i = from; i < from + count; i++) m = Math.max(m, v[i]!); const e = Array.from({ length: count }, (_, i) => Math.exp(v[from + i]! - m)); const sum = e.reduce((a, b) => a + b, 0); return e.map(x => x / sum); };

/**
 * Opponent-tendency tracker. Must see every tick (fight, count and break): s.events holds only the events of
 * the step that produced s, so each tick is consumed exactly once (repeat calls for a tick are ignored, a
 * skipped tick is counted in trackGaps). Evidence is public and causal: this tick's events plus the
 * opponent's visible velocity/action now. Also flags the strategist after roundstart, knockdown and getup.
 */
export function neuro2Track(s: Readonly<SparringState>, side: SparringSide, mem: Neuro2Memory): void {
  if (s.tick <= mem.trackedTick) return;
  if (mem.trackedTick >= 0 && s.tick !== mem.trackedTick + 1) mem.trackGaps++;
  mem.trackedTick = s.tick;
  const T = mem.tendency, other: SparringSide = side === 0 ? 1 : 0;
  let opAttacks = 0;
  for (const e of s.events) {
    if (e.type === "roundstart" || e.type === "knockdown" || e.type === "getup") mem.strategyDue = true;
    else if (e.type === "attack" && e.actor === other && e.attack) { opAttacks++; T[0] += EVENT_RATE * ((e.attack === "jab" ? 1 : 0) - T[0]!); }
    else if (e.type === "attack" && e.actor === side) T[5] *= 1 - EVENT_RATE;
    else if ((e.type === "hit" || e.type === "block") && e.actor === side) T[2] += EVENT_RATE * ((e.type === "block" ? 1 : 0) - T[2]!);
    else if (e.type === "counter" && e.actor === other) T[5] += EVENT_RATE;
  }
  // Per-second rates advance only on simulated fight ticks (roundTick moved), not during counts or breaks.
  if (s.roundTick !== mem.trackRoundTick && s.roundTick > 0) {
    const me = s.fighters[side], op = s.fighters[other], dx = me.x - op.x, dz = me.z - op.z, d = Math.max(1e-6, Math.hypot(dx, dz));
    const evade = op.actionAt === s.tick && (op.action === "slip" || op.action === "dash") ? 1 : 0;
    T[1] += TICK_RATE * (opAttacks * SPARRING_HZ - T[1]!);
    T[3] += TICK_RATE * ((op.vx * dx + op.vz * dz) / d - T[3]!);
    T[4] += TICK_RATE * (evade * SPARRING_HZ - T[4]!);
  }
  mem.trackRoundTick = s.roundTick;
}

/** The 12 strategic values in [-1, 1], written at out[offset..offset+11]. Public match state + tracker only. */
export function neuro2Strategic(s: Readonly<SparringState>, side: SparringSide, mem: Readonly<Neuro2Memory>, out: Float64Array, offset = NEURO2_STRATEGIC_OFFSET): Float64Array {
  const me = s.fighters[side], op = s.fighters[side === 0 ? 1 : 0], T = mem.tendency;
  let cards = 0; for (const [a, b] of s.scores) cards += side === 0 ? a - b : b - a;
  out[offset] = clamp(cards / 3);
  out[offset + 1] = s.rounds > 1 ? clamp((s.round - 1) / (s.rounds - 1) * 2 - 1) : 1;
  out[offset + 2] = clamp(me.knockdowns - 1);
  out[offset + 3] = clamp(op.knockdowns - 1);
  out[offset + 4] = clamp((me.roundDamage - op.roundDamage) / 150);
  out[offset + 5] = [1, 1 / 3, -1 / 3, -1][Math.min(3, Math.max(0, Math.floor(op.stamina / 250)))]!; // exhausted +1 … fresh -1
  out[offset + 6] = clamp(T[0]! * 2 - 1);
  out[offset + 7] = clamp(T[1]! / 1.5 * 2 - 1);
  out[offset + 8] = clamp(T[2]! * 2 - 1);
  out[offset + 9] = clamp(T[3]!);
  out[offset + 10] = clamp(T[4]! / .2 * 2 - 1);
  out[offset + 11] = clamp(T[5]! / .6 * 2 - 1);
  return out;
}

/** Full 40-value observation for the current style (callers normally use neuro2Input). */
export function neuro2Observe(s: Readonly<SparringState>, side: SparringSide, mem: Neuro2Memory, out: Float64Array = mem.obs): Float64Array {
  neuroObserve(s, side, out);
  neuro2Strategic(s, side, mem, out);
  for (let k = 0; k < FIGHT_STYLES.length; k++) out[NEURO2_STYLE_OFFSET + k] = FIGHT_STYLES[k] === mem.style ? 1 : 0;
  return out;
}

/** Strategist head: logits = Ws·[1, strategic, h] from the memory before this decision's update. */
function strategize(s: Readonly<SparringState>, side: SparringSide, p: Neuro2Params, mem: Neuro2Memory, t: number): void {
  const S = FIGHT_STYLES.length, W = p.styleW, x = mem.obs, z = mem.styleLogits, A = mem.attribution;
  for (let k = 0; k < S; k++) {
    const row = k * NEURO2_STYLE_WIDTH; let v = W[row]!;
    for (let j = 0; j < NEURO2_STRATEGIC_OBS; j++) v += W[row + 1 + j]! * x[NEURO2_STRATEGIC_OFFSET + j]!;
    for (let n = 0; n < NEURO_NODES; n++) v += W[row + 1 + NEURO2_STRATEGIC_OBS + n]! * mem.h[n]!;
    z[k] = v;
  }
  // Attribution relative to the mean over styles: a term that raises every style equally explains no choice.
  for (let e = 0; e < NEURO2_ATTRIBUTION; e++) {
    const term = (k: number) => {
      const row = k * NEURO2_STYLE_WIDTH;
      if (e === 0) return W[row]!;
      if (e <= NEURO2_STRATEGIC_OBS) return W[row + e]! * x[NEURO2_STRATEGIC_OFFSET + e - 1]!;
      let v = 0; for (let n = 0; n < NEURO_NODES; n++) v += W[row + 1 + NEURO2_STRATEGIC_OBS + n]! * mem.h[n]!; return v;
    };
    let mean = 0; const v = Array.from({ length: S }, (_, k) => { const y = term(k); mean += y / S; return y; });
    for (let k = 0; k < S; k++) A[k * NEURO2_ATTRIBUTION + e] = v[k]! - mean;
  }
  for (let j = 0; j < NEURO2_STRATEGIC_OBS; j++) mem.strategicAtEval[j] = x[NEURO2_STRATEGIC_OFFSET + j]!;
  const P = softmax(z, 0, S), pick = t > 0 ? sample(z, 0, S, t, hashUnit(s.seed, s.tick, side, 4)) : argmax(z, 0, S);
  mem.styleP = P; mem.suggested = FIGHT_STYLES[pick]!; mem.styleEvaluatedAt = s.tick; mem.evaluations++;
  mem.strategyAt = mem.decisions; mem.strategyDue = false;
  if (mem.styleSource === "external") return; // shown, never overrides an externally committed style
  if (mem.styleSince < 0) { mem.style = FIGHT_STYLES[pick]!; mem.styleSince = s.tick; return; }
  const current = FIGHT_STYLES.indexOf(mem.style);
  if (pick !== current && s.tick - mem.styleSince >= NEURO2_MIN_HOLD_TICKS && P[pick]! - P[current]! >= NEURO2_SWITCH_MARGIN) {
    mem.style = FIGHT_STYLES[pick]!; mem.styleSince = s.tick; mem.switches++;
  }
}

/** Tactical brain: one recurrent update on the anatomical graph from the 40 observations, then the readout. */
function tacticalStep(graph: NeuroGraph, p: Neuro2Params, mem: Neuro2Memory): Float64Array {
  const incoming = mem.incoming.fill(0), next = mem.next, obs = mem.obs, W1 = NEURO2_OBS + 1;
  if (p.recurrent) for (let e = 0; e < graph.pre.length; e++) incoming[graph.post[e]!] += graph.weights[e]! * mem.h[graph.pre[e]!]!;
  const leak = p.recurrent ? p.leak : 1;
  for (let n = 0; n < NEURO_NODES; n++) {
    const row = n * W1; let drive = p.inW[row]!;
    for (let i = 0; i < NEURO2_OBS; i++) drive += p.inW[row + 1 + i]! * obs[i]!;
    next[n] = (1 - leak) * mem.h[n]! + leak * Math.tanh(drive + incoming[n]!);
  }
  mem.h.set(next);
  const width = 1 + NEURO2_OBS + NEURO_NODES;
  for (let o = 0; o < NEURO2_OUT; o++) {
    const row = o * width; let z = p.outW[row]!;
    for (let i = 0; i < NEURO2_OBS; i++) z += p.outW[row + 1 + i]! * obs[i]!;
    for (let n = 0; n < NEURO_NODES; n++) z += p.outW[row + 1 + NEURO2_OBS + n]! * next[n]!;
    mem.logits[o] = z;
  }
  return mem.logits;
}

/**
 * Engine input for this tick. Call it every tick, including counts and breaks, so the tendency tracker sees
 * every event. Decisions happen every NEURO_DECISION_TICKS ticks on the shared grid (both corners decide on the
 * same tick) and are held in between; a tick's input is fixed once computed (repeat calls return it again).
 */
export function neuro2Input(s: Readonly<SparringState>, side: SparringSide, graph: NeuroGraph, p: Neuro2Params, mem: Neuro2Memory, opts: Neuro2Options = {}): SparringInput {
  if (s.tick === mem.tick) return { ...mem.tickInput };
  neuro2Track(s, side, mem);
  const external = opts.style ?? null;
  if (external) {
    if (!FIGHT_STYLES.includes(external)) throw new TypeError("Unknown fight style");
    if (mem.styleSource !== "external" || mem.style !== external) { mem.style = external; mem.styleSince = s.tick; mem.styleSource = "external"; }
  } else if (mem.styleSource === "external") { mem.styleSource = "neuro"; mem.strategyDue = true; }
  mem.tick = s.tick;
  const me = s.fighters[side];
  let input: SparringInput;
  if (s.finished || s.phase !== "fight" || me.phase === "hitstun" || me.action === "knockdown" || me.action === "getup") input = { ...NEUTRAL };
  else if (s.tick % NEURO_DECISION_TICKS !== 0) input = { ...mem.held, action: null };
  else {
    const t = opts.temperature ?? 0;
    neuroObserve(s, side, mem.obs); neuro2Strategic(s, side, mem, mem.obs);
    if (mem.strategyDue || mem.decisions - mem.strategyAt >= NEURO2_STRATEGY_DECISIONS) strategize(s, side, p, mem, t);
    for (let k = 0; k < FIGHT_STYLES.length; k++) mem.obs[NEURO2_STYLE_OFFSET + k] = FIGHT_STYLES[k] === mem.style ? 1 : 0;
    const logits = tacticalStep(graph, p, mem); mem.decisions++;
    const G = NEURO_MOVES.length;
    const move = t > 0 ? sample(logits, 0, G, t, hashUnit(s.seed, s.tick, side, 1)) : argmax(logits, 0, G);
    const guard = t > 0 ? sample(logits, G, 2, t, hashUnit(s.seed, s.tick, side, 2)) === 1 : logits[G + 1]! > logits[G]!;
    const command = NEURO_COMMANDS[t > 0 ? sample(logits, G + 2, NEURO_COMMANDS.length, t, hashUnit(s.seed, s.tick, side, 3)) : argmax(logits, G + 2, NEURO_COMMANDS.length)]!;
    const op = s.fighters[side === 0 ? 1 : 0], dx = op.x - me.x, dz = op.z - me.z, d = Math.max(1e-6, Math.hypot(dx, dz));
    const fx = dx / d, fz = dz / d, lx = -fz, lz = fx; // forward toward the opponent; left perpendicular
    const dir = ({ stay: [0, 0], fwd: [1, 0], back: [-1, 0], left: [0, 1], right: [0, -1], fwdLeft: [.7071, .7071], fwdRight: [.7071, -.7071], backLeft: [-.7071, .7071], backRight: [-.7071, -.7071] } as const)[NEURO_MOVES[move]!];
    mem.held = { moveX: clamp(fx * dir[0] + lx * dir[1]), moveZ: clamp(fz * dir[0] + lz * dir[1]), guard, action: null };
    input = { ...mem.held, action: command === "none" ? null : command as SparringCommand };
  }
  mem.tickInput = input;
  return { ...input };
}

const REASON_LABELS: Readonly<Record<Neuro2StrategicKey, readonly [string, string, string]>> = Object.freeze({
  // [input < 0, input ~ 0, input > 0]
  cards: ["karta göre geride", "kartlar eşit", "karta göre önde"],
  round: ["erken raunt", "orta raunt", "son raunt"],
  ownKnockdowns: ["hiç yere düşmedi", "bir kez yere düştü", "iki kez yere düştü"],
  opKnockdowns: ["rakip hiç düşmedi", "rakibi bir kez düşürdü", "rakibi iki kez düşürdü"],
  roundDamage: ["bu raunt geride", "bu raunt başa baş", "bu raunt önde"],
  opFatigue: ["rakip dinç", "rakip biraz yorgun", "rakip yoruluyor"],
  opJabShare: ["rakip güçlü yumruklara yükleniyor", "rakip jab ve güçlü yumruğu karıştırıyor", "rakip jab ağırlıklı"],
  opAttackRate: ["rakip az yumruk atıyor", "rakip orta tempoda", "rakip çok yumruk atıyor"],
  opBlockShare: ["rakip az blokluyor", "rakip ara sıra blokluyor", "rakip çok blokluyor"],
  opForward: ["rakip geri çekiliyor", "rakip yerinde", "rakip üstüne geliyor"],
  opSlipDash: ["rakip az sıyrılıyor", "rakip ara sıra sıyrılıyor", "rakip çok sıyrılıyor"],
  opCounters: ["rakip az kontra atıyor", "rakip ara sıra kontra atıyor", "rakip çok kontra atıyor"],
});
/** Short Turkish label for a strategic input's current value. */
export function neuro2ReasonLabel(key: Neuro2StrategicKey | "memory" | "bias", value = 0): string {
  if (key === "memory") return "bellek durumu (128 nöron)";
  if (key === "bias") return "genel eğilim";
  const [lo, mid, hi] = REASON_LABELS[key];
  return value < -.2 ? lo : value > .2 ? hi : mid;
}

/** Human-readable view of the last decision and the strategist (for the on-screen thinking panel). */
export function neuro2Thought(mem: Neuro2Memory): Neuro2Thought {
  const l = mem.logits, G = NEURO_MOVES.length, moveP = softmax(l, 0, G), commandP = softmax(l, G + 2, NEURO_COMMANDS.length);
  // Reasons explain the strategist's own pick when the committed style came from outside.
  const explained = FIGHT_STYLES.indexOf(mem.styleSource === "external" ? mem.suggested : mem.style), row = explained * NEURO2_ATTRIBUTION;
  const reasons: Neuro2Reason[] = mem.evaluations === 0 ? [] : Array.from({ length: NEURO2_ATTRIBUTION }, (_, e) => {
    const key = e === 0 ? "bias" as const : e <= NEURO2_STRATEGIC_OBS ? NEURO2_STRATEGIC[e - 1]! : "memory" as const;
    return { key, label: neuro2ReasonLabel(key, e === 0 || e > NEURO2_STRATEGIC_OBS ? 0 : mem.strategicAtEval[e - 1]!), weight: mem.attribution[row + e]! };
  }).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 3);
  return { style: mem.style, styleSource: mem.styleSource, styleP: [...mem.styleP], heldTicks: mem.styleSince < 0 ? 0 : Math.max(0, mem.tick - mem.styleSince), suggested: mem.suggested, reasons,
    move: NEURO_MOVES[argmax(l, 0, G)]!, guard: l[G + 1]! > l[G]!, command: NEURO_COMMANDS[argmax(l, G + 2, NEURO_COMMANDS.length)]!, moveP, commandP };
}
