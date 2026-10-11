/**
 * NeuroBoxer v2 (neuro-2) bout runner for training, evaluation and ablations on the real sparring engine.
 * neuro-1's env.ts is untouched (its runs stay reproducible); this file only reuses its graph helpers.
 * Style control of the learner: the learned strategist, a fixed style (stage A, fixed-style ablation),
 * random switching or an authored rule (ablations). Shaping terms per style are computed for every bout
 * from public events/state; outcome fitness is neuro-1's formula.
 */
import { Worker } from "node:worker_threads";
import { createSparring, stepSparring, sparringBotInput, SPARRING_DAZE_KNOCKDOWN, SPARRING_HZ, type SparringInput, type SparringSide, type SparringState } from "../../packages/protocol/src/combat-sparring";
import { FIGHT_STYLES, type FightStyle } from "../../packages/protocol/src/fight-style";
import { createNeuroMemory, neuroInput, type NeuroGraph } from "../../packages/protocol/src/neuro-boxer";
import { NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS } from "../../packages/protocol/src/neuro-boxer-model";
import { createNeuro2Memory, neuro2Input, neuro2Params, neuro2Strategic, neuro2Track, NEURO2_MIN_HOLD_TICKS, NEURO2_STRATEGIC_OBS, NEURO2_STRATEGY_DECISIONS, type Neuro2Memory, type Neuro2Params } from "../../packages/protocol/src/neuro-boxer-2";
import { GRAPH, shuffledGraph, type Variant } from "./env";
import { cautiousBotInput, outboxerBotInput } from "./baselines";

export type { Variant };
export type BotStyle = "balanced" | "pressure" | "counter";
export type ScriptStyle = "cautious" | "outboxer";
/** How a neuro-2 corner's style is chosen. randomFixed = one seeded random style for the whole bout (style-locked snapshot). */
export type Control = { mode: "strategist" } | { mode: "fixed"; style: FightStyle } | { mode: "random" } | { mode: "rule" } | { mode: "randomFixed" };
export type Opponent = { kind: "bot"; style: BotStyle } | { kind: "script"; style: ScriptStyle } | { kind: "neuro1" } | { kind: "neuro2"; theta: Float64Array; variant: Variant; control: Control };
export type Format = { seconds: number; rounds: number; breakSeconds: number };
/** Product bout (boxing-sparring.tsx: 3 x 45 s); breaks only walk fighters to corners, so training uses 2 s. */
export const PRODUCT_FORMAT: Format = { seconds: 45, rounds: 3, breakSeconds: 8 };
export const FIXED_OPPONENTS: Opponent[] = [{ kind: "bot", style: "balanced" }, { kind: "bot", style: "pressure" }, { kind: "bot", style: "counter" }, { kind: "script", style: "cautious" }, { kind: "script", style: "outboxer" }, { kind: "neuro1" }];
export const opponentName = (o: Opponent) => o.kind === "bot" || o.kind === "script" ? `${o.kind}:${o.style}` : o.kind;

let shuffledCache: NeuroGraph | null = null;
export const graph2For = (v: Variant): NeuroGraph => v === "shuffled" ? (shuffledCache ??= shuffledGraph()) : GRAPH;
export const params2For = (theta: Float64Array, v: Variant): Neuro2Params => neuro2Params(theta, { recurrent: v !== "norecur" });
const hashUnit = (...parts: number[]) => { let h = 2166136261; for (const p of parts) { h ^= p >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; } return (h >>> 8) / 16777216; };

/** Authored rule-based strategist (ablation baseline, not learned): reads the same 12 strategic inputs. */
export function ruleStyle(x: ArrayLike<number>, o = 0): FightStyle {
  const cards = x[o]!, finalRound = x[o + 1]! > .5, ownKd = x[o + 2]! > -1, opKd = x[o + 3]! > -1, roundDamage = x[o + 4]!, opTired = x[o + 5]! > 0;
  const opAttack = x[o + 7]!, opBlock = x[o + 8]!, opCounter = x[o + 11]!;
  if (opTired && (opKd || roundDamage > .3)) return "finisher";
  if (ownKd && cards >= 0) return "cautious";
  if (finalRound && cards < 0) return "pressure";
  if (opCounter > .2) return "outboxer";
  if (opBlock > .3) return "body";
  if (opAttack > .2) return "counter";
  return roundDamage < 0 ? "pressure" : "cautious";
}

/** One neuro-2 corner: memory plus the style controller around it. */
class Neuro2Corner {
  readonly mem: Neuro2Memory = createNeuro2Memory(); private readonly x = new Float64Array(NEURO2_STRATEGIC_OBS); private style: FightStyle | null = null;
  constructor(readonly graph: NeuroGraph, readonly p: Neuro2Params, readonly control: Control, readonly side: SparringSide, readonly temperature: number, seed: number) {
    if (control.mode === "fixed") this.style = control.style;
    if (control.mode === "randomFixed") this.style = FIGHT_STYLES[Math.floor(hashUnit(seed, side, 77) * FIGHT_STYLES.length)]!;
  }
  input(s: SparringState): SparringInput {
    const mode = this.control.mode;
    if (mode === "random" || mode === "rule") {
      // Same schedule as the learned head (roundstart, knockdown/getup, every 45 decisions) and the same minimum hold.
      neuro2Track(s, this.side, this.mem);
      const me = s.fighters[this.side], decisionTick = !s.finished && s.phase === "fight" && me.phase !== "hitstun" && me.action !== "knockdown" && me.action !== "getup" && s.tick % 4 === 0;
      if (decisionTick && (this.mem.strategyDue || this.mem.decisions - this.mem.strategyAt >= NEURO2_STRATEGY_DECISIONS || this.style === null)) {
        neuro2Strategic(s, this.side, this.mem, this.x, 0);
        const next = mode === "random" ? FIGHT_STYLES[Math.floor(hashUnit(s.seed, s.tick, this.side, 5) * FIGHT_STYLES.length)]! : ruleStyle(this.x);
        if (this.style === null || (next !== this.style && s.tick - this.mem.styleSince >= NEURO2_MIN_HOLD_TICKS)) this.style = next;
      }
    }
    return neuro2Input(s, this.side, this.graph, this.p, this.mem, { temperature: this.temperature, style: this.style });
  }
}
type Corner = { input: (s: SparringState) => SparringInput; neuro2?: Neuro2Corner };
function corner(o: Opponent, side: SparringSide, temperature: number, seed: number): Corner {
  if (o.kind === "bot") return { input: s => sparringBotInput(s, side, o.style) };
  if (o.kind === "script") return { input: o.style === "cautious" ? s => cautiousBotInput(s, side) : s => outboxerBotInput(s, side) };
  if (o.kind === "neuro1") { const mem = createNeuroMemory(), sampling = temperature > 0 ? { temperature } : undefined; return { input: s => neuroInput(s, side, NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS, mem, sampling) }; }
  const c = new Neuro2Corner(graph2For(o.variant), params2For(o.theta, o.variant), o.control, side, temperature, seed);
  return { input: s => c.input(s), neuro2: c };
}

export type Signature = { distance: number; attackRate: number; guardRate: number; forwardRatio: number; bodyShare: number; counterShare: number };
export const SIGNATURE_KEYS: readonly (keyof Signature)[] = ["distance", "attackRate", "guardRate", "forwardRatio", "bodyShare", "counterShare"];
export type Bout2Result = {
  score: number; won: boolean; draw: boolean; ko: boolean; method: string | null; dealt: number; taken: number; kdFor: number; kdAgainst: number; passivity: number;
  outcome: number; shaping: Record<FightStyle, number>; signature: Signature; ticks: number; fightTicks: number;
  /** Learner style trace: commits per round, completed hold lengths (ticks), share of fight ticks per style. */
  styles: { switches: number; perRound: number[]; holds: number[]; lastHold: number; share: Record<FightStyle, number>; first: FightStyle | null; evaluations: number; gaps: number };
  attacks: Record<string, number>;
};
export const SHAPING_WEIGHT = .5;

/** Runs one bout: the learner (neuro-2 theta on `variant`, styled by `control`) against `opponent`. */
export function runBout2(theta: Float64Array, variant: Variant, control: Control, opponent: Opponent, seed: number, side: SparringSide, format: Format, temperature: number): Bout2Result {
  const other: SparringSide = side === 0 ? 1 : 0;
  const me = corner({ kind: "neuro2", theta, variant, control }, side, temperature, seed), op = corner(opponent, other, temperature, seed ^ 0x5bd1e995);
  let s: SparringState = createSparring(seed, { durationSeconds: format.seconds, rounds: format.rounds, breakSeconds: format.breakSeconds });
  const attacks: Record<string, number> = {};
  let hits = 0, bodyHits = 0, counters = 0, jabHits = 0, myAttacks = 0, opAttacks = 0, inside = 0, kdFor = 0, kdAgainst = 0, windows = 0, quiet = 0, attacked = false;
  let fight = 0, dist = 0, guard = 0, moving = 0, forward = 0, ropes = 0, range = 0, finishDamage = 0;
  const share = Object.fromEntries(FIGHT_STYLES.map(k => [k, 0])) as Record<FightStyle, number>, holds: number[] = [], perRound: number[] = [];
  let first: FightStyle | null = null, lastStyle: FightStyle | null = null, lastSince = -1, switchesThisRound = 0;
  const mem = me.neuro2!.mem;
  while (!s.finished) {
    const a = me.input(s), b = op.input(s), prev = s;
    s = stepSparring(prev, side === 0 ? [a, b] : [b, a]);
    const f = s.fighters[side], o = s.fighters[other];
    // Opponent condition before this tick's impacts (finisher shaping credits damage dealt into a hurt opponent).
    const hurt = prev.fighters[other].health < 300 || prev.fighters[other].daze >= .5 * (SPARRING_DAZE_KNOCKDOWN + prev.fighters[other].health * .28);
    for (const e of s.events) {
      if (e.type === "attack") {
        if (e.actor === side) { myAttacks++; attacked = true; if (e.attack) attacks[e.attack] = (attacks[e.attack] ?? 0) + 1; if ((e.attack === "hook" || e.attack === "uppercut") && Math.hypot(o.x - f.x, o.z - f.z) < .95) inside++; }
        else opAttacks++;
      }
      else if (e.type === "hit" && e.actor === side) { hits++; if (o.lastHitKind === "body") bodyHits++; if (e.attack === "jab") jabHits++; if (hurt) finishDamage += e.damage; }
      else if (e.type === "counter" && e.actor === side) counters++;
      else if (e.type === "knockdown") { if (e.actor === side) kdFor++; else kdAgainst++; }
      else if (e.type === "roundend") { perRound.push(switchesThisRound); switchesThisRound = 0; }
    }
    if (s.phase === "fight" && s.roundTick > 0) {
      fight++; const dx = o.x - f.x, dz = o.z - f.z, d = Math.max(1e-6, Math.hypot(dx, dz)); dist += d;
      if (f.action === "guard") guard++;
      if (Math.hypot(f.vx, f.vz) > .2) { moving++; if ((f.vx * dx + f.vz * dz) / d > .2) forward++; }
      if (3.15 - Math.max(Math.abs(o.x), Math.abs(o.z)) < .7) ropes++;
      if (d >= .95 && d <= 1.6) range++;
      share[mem.style]++;
      if (s.roundTick % 180 === 0) { windows++; if (!attacked) quiet++; attacked = false; }
    }
    // Every commit (learned, external, random or rule) after the first counts as a switch.
    if (mem.styleSince >= 0 && (mem.style !== lastStyle || mem.styleSince !== lastSince)) {
      if (lastStyle === null) first = mem.style; else { holds.push(mem.styleSince - lastSince); switchesThisRound++; }
      lastStyle = mem.style; lastSince = mem.styleSince;
    }
  }
  if (perRound.length < s.round) perRound.push(switchesThisRound); // stopped mid-round (KO/TKO): no roundend
  const won = s.winner === side, draw = s.winner === "draw", score = won ? 1 : draw ? .5 : 0;
  const dealt = s.fighters[side].damageDealt, taken = s.fighters[other].damageDealt, passivity = windows ? quiet / windows : 0;
  const outcome = score + .0006 * (dealt - taken) + .2 * (kdFor - kdAgainst) - .25 * passivity;
  const seconds = Math.max(1, fight / SPARRING_HZ), attackRate = myAttacks / seconds, forwardRatio = moving ? forward / moving : 0;
  const shaping: Record<FightStyle, number> = {
    pressure: .4 * forwardRatio + .3 * Math.min(1, 2 * ropes / Math.max(1, fight)) + .3 * Math.min(1, attackRate / 1.5),
    counter: .5 * Math.min(1, counters / Math.max(5, opAttacks)) + .5 * counters / Math.max(3, myAttacks),
    cautious: Math.max(0, 1 - taken / (300 * format.rounds)),
    outboxer: .4 * Math.min(1, jabHits / seconds / .4) + .3 * range / Math.max(1, fight) + .3 * (attacks.jab ?? 0) / Math.max(3, myAttacks),
    // sparring-5 has no aimed body punches (body contact is incidental), so half the term is close-range hook/uppercut work.
    body: .5 * bodyHits / Math.max(3, hits) + .5 * inside / Math.max(3, myAttacks),
    finisher: Math.min(1, finishDamage / (200 * format.rounds)),
  };
  for (const k of FIGHT_STYLES) share[k] /= Math.max(1, fight);
  return { score, won, draw, ko: s.method === "ko" || s.method === "tko", method: s.method, dealt, taken, kdFor, kdAgainst, passivity, outcome, shaping, ticks: s.tick, fightTicks: fight, attacks,
    signature: { distance: dist / Math.max(1, fight), attackRate, guardRate: guard / Math.max(1, fight), forwardRatio, bodyShare: bodyHits / Math.max(1, hits), counterShare: counters / Math.max(1, hits) },
    styles: { switches: holds.length, perRound, holds, lastHold: lastSince >= 0 ? s.tick - lastSince : 0, share, first, evaluations: mem.evaluations, gaps: mem.trackGaps } };
}

/** Fitness for ES: outcome, plus the fixed style's shaping term when one is given (stage A / stage C style-locked bouts). */
export const boutFitness = (r: Bout2Result, shapingStyle: FightStyle | null) => r.outcome + (shapingStyle ? SHAPING_WEIGHT * r.shaping[shapingStyle] : 0);

/** Worker pool with a shared queue (each worker runs one job at a time); used by train-style.ts and evaluate-style.ts. */
export class StylePool {
  private readonly workers: Worker[]; private readonly idle: Worker[] = []; private readonly queue: { msg: Record<string, unknown>; resolve: (v: unknown) => void }[] = [];
  private readonly pending = new Map<number, (v: unknown) => void>(); private nextId = 0;
  constructor(count: number) {
    this.workers = Array.from({ length: count }, () => new Worker(new URL("./worker-style.ts", import.meta.url), { execArgv: ["--import", "tsx"] }));
    for (const w of this.workers) {
      w.on("message", (m: { id: number }) => { const done = this.pending.get(m.id)!; this.pending.delete(m.id); this.idle.push(w); this.pump(); done(m); });
      w.on("error", e => { console.error("worker error", e); process.exit(1); });
      this.idle.push(w);
    }
  }
  private pump() { while (this.idle.length && this.queue.length) { const w = this.idle.shift()!, job = this.queue.shift()!; this.pending.set(job.msg.id as number, job.resolve); w.postMessage(job.msg); } }
  private submit<T>(msg: Record<string, unknown>) { return new Promise<T>(resolve => { this.queue.push({ msg: { ...msg, id: this.nextId++ }, resolve: resolve as (v: unknown) => void }); this.pump(); }); }
  league(id: string, theta: Float64Array, variant: Variant) { for (const w of this.workers) w.postMessage({ type: "league", id, theta, variant }); }
  fitness(theta: Float64Array, variant: Variant, bouts: unknown[]) { return this.submit<{ fitness: number }>({ type: "fitness", theta, variant, bouts }).then(m => m.fitness); }
  bouts(theta: Float64Array, variant: Variant, bouts: unknown[]) { return this.submit<{ results: Bout2Result[] }>({ type: "bouts", theta, variant, bouts }).then(m => m.results); }
  close() { return Promise.all(this.workers.map(w => w.terminate())); }
}
