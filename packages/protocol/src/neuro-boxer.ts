/**
 * NeuroBoxer: a controller for the non-monetary sparring engine whose memory is a recurrent network
 * on a real MaleCNS v1.0 descending-neuron subgraph (128 nodes, 4 949 directed edges, CC BY 4.0,
 * FlyEM/HHMI Janelia, Cambridge, MRC LMB, Google Research). Anatomical edges are fixed; the sensory
 * projection and action readout are learned from fight outcomes (experiments/neuro-boxer).
 *
 * Observations are only what a fighter can perceive: geometry, the opponent's visible movement and
 * strike phase, its own body state and the ropes. Never wagers, balances, identities or seeds.
 * Not a whole brain, not biological simulation and not consciousness.
 */
import { SPARRING_ATTACKS, SPARRING_DAZE_KNOCKDOWN, SPARRING_HZ, type SparringAttack, type SparringCommand, type SparringInput, type SparringSide, type SparringState } from "./combat-sparring";

export const NEURO_NODES = 128;
export const NEURO_OBS = 22;
export const NEURO_MOVES = ["stay", "fwd", "back", "left", "right", "fwdLeft", "fwdRight", "backLeft", "backRight"] as const;
export const NEURO_COMMANDS = ["none", "jab", "cross", "hook", "uppercut", "slip", "dash"] as const;
export const NEURO_OUT = NEURO_MOVES.length + 2 + NEURO_COMMANDS.length;
export const NEURO_IN_PARAMS = NEURO_NODES * (NEURO_OBS + 1);
export const NEURO_OUT_PARAMS = NEURO_OUT * (1 + NEURO_OBS + NEURO_NODES);
/** One decision every 4 engine ticks (15 Hz); the recurrent state advances once per decision. */
export const NEURO_DECISION_TICKS = 4;

export type NeuroGraph = { pre: readonly number[]; post: readonly number[]; weights: readonly number[] };
export type NeuroParams = { inW: Float64Array; outW: Float64Array; leak: number; recurrent: boolean };
/** temperature > 0 samples each head from its softmax with a hash of (bout seed, tick, side): varied bouts,
 * still exactly replayable from the committed seed. 0 (default) is greedy. */
export type NeuroSampling = { temperature: number };
export type NeuroMemory = { h: Float64Array; held: SparringInput; obs: Float64Array; logits: Float64Array };
export type NeuroThought = { move: string; guard: boolean; command: string; moveP: number[]; commandP: number[] };

export const createNeuroMemory = (): NeuroMemory => ({ h: new Float64Array(NEURO_NODES), held: { moveX: 0, moveZ: 0, guard: false, action: null }, obs: new Float64Array(NEURO_OBS), logits: new Float64Array(NEURO_OUT) });

const clamp = (n: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const attackKinds: readonly SparringAttack[] = ["jab", "cross", "hook", "uppercut", "roundhouse"];

/** Perception: 22 values in [-1, 1] from the side's own point of view. */
export function neuroObserve(s: Readonly<SparringState>, side: SparringSide, out: Float64Array): Float64Array {
  const me = s.fighters[side], op = s.fighters[side === 0 ? 1 : 0];
  const dx = op.x - me.x, dz = op.z - me.z, d = Math.hypot(dx, dz), toOp = Math.atan2(dx, dz);
  const opAttack = attackKinds.includes(op.action as SparringAttack) ? op.action as SparringAttack : null;
  const spec = opAttack ? SPARRING_ATTACKS[opAttack] : null, age = s.tick - op.actionAt;
  const total = spec ? spec.startup + spec.active + spec.recovery : 1;
  const RING = 3.15, rope = (x: number, z: number) => clamp((RING - Math.max(Math.abs(x), Math.abs(z))) / RING * 2 - 1);
  const rvx = op.vx - me.vx, rvz = op.vz - me.vz, closing = d > 1e-6 ? -(rvx * dx + rvz * dz) / d : 0;
  out[0] = clamp((d - .78) / 2.4 * 2 - 1);
  out[1] = wrap(toOp - me.facing) / Math.PI;
  out[2] = wrap(Math.atan2(-dx, -dz) - op.facing) / Math.PI;
  out[3] = op.action === "idle" || op.action === "move" ? 1 : -1;
  out[4] = op.action === "guard" ? 1 : -1;
  out[5] = op.phase === "startup" ? 1 : -1;
  out[6] = op.phase === "active" ? 1 : -1;
  out[7] = op.phase === "recovery" ? 1 : -1;
  out[8] = op.action === "hitstun" || op.action === "knockdown" || op.action === "getup" ? 1 : -1;
  out[9] = opAttack ? [-.5, 0, .5, 1, 1][attackKinds.indexOf(opAttack)]! : -1;
  out[10] = opAttack ? clamp(age / total * 2 - 1) : -1;
  out[11] = me.stamina / 500 - 1;
  out[12] = me.health / 500 - 1;
  out[13] = op.health / 500 - 1;
  out[14] = clamp(me.daze / (SPARRING_DAZE_KNOCKDOWN + me.health * .28) * 2 - 1);
  out[15] = rope(me.x, me.z);
  out[16] = rope(op.x, op.z);
  out[17] = s.tick < me.actionUntil ? 1 : -1;
  out[18] = clamp((s.tick - op.lastHitAt) / (SPARRING_HZ * 3) * 2 - 1);
  out[19] = clamp((s.tick - me.lastHitAt) / (SPARRING_HZ * 3) * 2 - 1);
  out[20] = clamp(1 - 2 * s.roundTick / Math.max(1, s.durationTicks));
  out[21] = clamp(closing / 2);
  return out;
}

/** Memory + decision: one recurrent update on the anatomical graph, then the learned readout. */
export function neuroStep(graph: NeuroGraph, p: NeuroParams, mem: NeuroMemory, obs: Float64Array): Float64Array {
  const incoming = new Float64Array(NEURO_NODES);
  if (p.recurrent) for (let e = 0; e < graph.pre.length; e++) incoming[graph.post[e]!] += graph.weights[e]! * mem.h[graph.pre[e]!]!;
  const next = new Float64Array(NEURO_NODES);
  for (let n = 0; n < NEURO_NODES; n++) {
    const row = n * (NEURO_OBS + 1); let drive = p.inW[row]!;
    for (let i = 0; i < NEURO_OBS; i++) drive += p.inW[row + 1 + i]! * obs[i]!;
    const leak = p.recurrent ? p.leak : 1;
    next[n] = (1 - leak) * mem.h[n]! + leak * Math.tanh(drive + incoming[n]!);
  }
  mem.h.set(next);
  const width = 1 + NEURO_OBS + NEURO_NODES;
  for (let o = 0; o < NEURO_OUT; o++) {
    const row = o * width; let z = p.outW[row]!;
    for (let i = 0; i < NEURO_OBS; i++) z += p.outW[row + 1 + i]! * obs[i]!;
    for (let n = 0; n < NEURO_NODES; n++) z += p.outW[row + 1 + NEURO_OBS + n]! * next[n]!;
    mem.logits[o] = z;
  }
  return mem.logits;
}

const hashUnit = (...parts: number[]) => { let h = 2166136261; for (const p of parts) { h ^= p >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; } return (h >>> 8) / 16777216; };
const sample = (v: Float64Array, from: number, count: number, t: number, u: number) => { let m = -Infinity; for (let i = from; i < from + count; i++) m = Math.max(m, v[i]!); let sum = 0; const e: number[] = []; for (let i = from; i < from + count; i++) { const x = Math.exp((v[i]! - m) / t); e.push(x); sum += x; } let acc = 0; for (let i = 0; i < count; i++) { acc += e[i]! / sum; if (u < acc) return i; } return count - 1; };
const argmax = (v: Float64Array, from: number, count: number) => { let best = from; for (let i = from + 1; i < from + count; i++) if (v[i]! > v[best]!) best = i; return best - from; };
const softmax = (v: Float64Array, from: number, count: number) => { let m = -Infinity; for (let i = from; i < from + count; i++) m = Math.max(m, v[i]!); const e = Array.from({ length: count }, (_, i) => Math.exp(v[from + i]! - m)); const sum = e.reduce((a, b) => a + b, 0); return e.map(x => x / sum); };

/** Engine input for this tick. Decisions are taken every NEURO_DECISION_TICKS ticks and held between. */
export function neuroInput(s: Readonly<SparringState>, side: SparringSide, graph: NeuroGraph, p: NeuroParams, mem: NeuroMemory, sampling?: NeuroSampling): SparringInput {
  const me = s.fighters[side];
  if (s.finished || s.phase !== "fight" || me.phase === "hitstun" || me.action === "knockdown" || me.action === "getup") return { moveX: 0, moveZ: 0, guard: false, action: null };
  // Both corners decide on the same tick from the same snapshot: no side sees the other's newest move first.
  if (s.tick % NEURO_DECISION_TICKS !== 0) return { ...mem.held, action: null };
  const logits = neuroStep(graph, p, mem, neuroObserve(s, side, mem.obs));
  const t = sampling?.temperature ?? 0, G = NEURO_MOVES.length;
  const move = t > 0 ? sample(logits, 0, G, t, hashUnit(s.seed, s.tick, side, 1)) : argmax(logits, 0, G);
  const guard = t > 0 ? sample(logits, G, 2, t, hashUnit(s.seed, s.tick, side, 2)) === 1 : logits[G + 1]! > logits[G]!;
  const command = NEURO_COMMANDS[t > 0 ? sample(logits, G + 2, NEURO_COMMANDS.length, t, hashUnit(s.seed, s.tick, side, 3)) : argmax(logits, G + 2, NEURO_COMMANDS.length)]!;
  const op = s.fighters[side === 0 ? 1 : 0], dx = op.x - me.x, dz = op.z - me.z, d = Math.max(1e-6, Math.hypot(dx, dz));
  const fx = dx / d, fz = dz / d, lx = -fz, lz = fx; // forward toward the opponent; left perpendicular
  const dir = ({ stay: [0, 0], fwd: [1, 0], back: [-1, 0], left: [0, 1], right: [0, -1], fwdLeft: [.7071, .7071], fwdRight: [.7071, -.7071], backLeft: [-.7071, .7071], backRight: [-.7071, -.7071] } as const)[NEURO_MOVES[move]!];
  mem.held = { moveX: clamp(fx * dir[0] + lx * dir[1]), moveZ: clamp(fz * dir[0] + lz * dir[1]), guard, action: null };
  return { ...mem.held, action: command === "none" ? null : command as SparringCommand };
}

/** Human-readable view of the last decision (for the on-screen "thinking" panel). */
export function neuroThought(mem: NeuroMemory): NeuroThought {
  const l = mem.logits, moveP = softmax(l, 0, NEURO_MOVES.length), commandP = softmax(l, NEURO_MOVES.length + 2, NEURO_COMMANDS.length);
  return { move: NEURO_MOVES[argmax(l, 0, NEURO_MOVES.length)]!, guard: l[NEURO_MOVES.length + 1]! > l[NEURO_MOVES.length]!, command: NEURO_COMMANDS[argmax(l, NEURO_MOVES.length + 2, NEURO_COMMANDS.length)]!, moveP, commandP };
}
