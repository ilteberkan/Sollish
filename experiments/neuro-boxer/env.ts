/** Shared bout runner for training, evaluation and ablations (real sparring-4 engine). */
import { createSparring, stepSparring, sparringBotInput, type SparringSide, type SparringState, type SparringInput } from "../../packages/protocol/src/combat-sparring";
import { createNeuroMemory, neuroInput, NEURO_IN_PARAMS, NEURO_NODES, type NeuroGraph, type NeuroParams } from "../../packages/protocol/src/neuro-boxer";
import graphJson from "./graph.json" with { type: "json" };

export type Variant = "connectome" | "shuffled" | "norecur";
export type Opponent = { kind: "bot"; style: "balanced" | "pressure" | "counter" } | { kind: "neuro"; theta: Float64Array; variant?: Variant };
export const GRAPH: NeuroGraph = { pre: graphJson.pre, post: graphJson.post, weights: graphJson.weights };

/** Degree-preserving control: permute edge targets (seeded), renormalise incoming weight to 0.8. */
export function shuffledGraph(seed = 777): NeuroGraph {
  let r = seed >>> 0; const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  const post = [...GRAPH.post];
  for (let i = post.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [post[i], post[j]] = [post[j]!, post[i]!]; }
  const sum = new Float64Array(NEURO_NODES); GRAPH.weights.forEach((w, e) => { sum[post[e]!] += w; });
  return { pre: GRAPH.pre, post, weights: GRAPH.weights.map((w, e) => w / sum[post[e]!]! * .8) };
}
export const graphFor = (v: Variant) => v === "shuffled" ? shuffledGraph() : GRAPH;
export const paramsFrom = (theta: Float64Array, v: Variant): NeuroParams => ({ inW: theta.subarray(0, NEURO_IN_PARAMS), outW: theta.subarray(NEURO_IN_PARAMS), leak: .35, recurrent: v !== "norecur" });

export type BoutResult = { score: number; fitness: number; won: boolean; draw: boolean; ko: boolean; dealt: number; taken: number; kdFor: number; kdAgainst: number; attacks: Record<string, number>; hits: number; passivity: number; ticks: number };

export function runBout(theta: Float64Array, v: Variant, opponent: Opponent, seed: number, side: SparringSide, opts: { seconds?: number; rounds?: number; temperature?: number } = {}): BoutResult {
  const graph = graphFor(v), p = paramsFrom(theta, v), mem = createNeuroMemory();
  const opVariant = opponent.kind === "neuro" ? opponent.variant ?? v : v, opGraph = graphFor(opVariant);
  const opMem = createNeuroMemory(), opP = opponent.kind === "neuro" ? paramsFrom(opponent.theta, opVariant) : null;
  let s: SparringState = createSparring(seed, { durationSeconds: opts.seconds ?? 45, rounds: opts.rounds ?? 1, breakSeconds: 4 });
  const other: SparringSide = side === 0 ? 1 : 0, attacks: Record<string, number> = {};
  let hits = 0, kdFor = 0, kdAgainst = 0, windows = 0, quietWindows = 0, attackedThisWindow = false;
  while (!s.finished) {
    const sampling = opts.temperature ? { temperature: opts.temperature } : undefined;
    const mine = neuroInput(s, side, graph, p, mem, sampling);
    const theirs: SparringInput = opponent.kind === "bot" ? sparringBotInput(s, other, opponent.style) : neuroInput(s, other, opGraph, opP!, opMem, sampling);
    s = stepSparring(s, side === 0 ? [mine, theirs] : [theirs, mine]);
    for (const e of s.events) {
      if (e.type === "attack" && e.actor === side && e.attack) { attacks[e.attack] = (attacks[e.attack] ?? 0) + 1; attackedThisWindow = true; }
      if (e.type === "hit" && e.actor === side) hits++;
      if (e.type === "knockdown") { if (e.actor === side) kdFor++; else kdAgainst++; }
    }
    if (s.phase === "fight" && s.roundTick % 180 === 0) { windows++; if (!attackedThisWindow) quietWindows++; attackedThisWindow = false; }
  }
  const me = s.fighters[side], op = s.fighters[other];
  const won = s.winner === side, draw = s.winner === "draw", score = won ? 1 : draw ? .5 : 0;
  const passivity = windows ? quietWindows / windows : 0, dealt = me.damageDealt, taken = op.damageDealt;
  const fitness = score + .0006 * (dealt - taken) + .2 * (kdFor - kdAgainst) - .25 * passivity;
  return { score, fitness, won, draw, ko: s.method === "ko" || s.method === "tko", dealt, taken, kdFor, kdAgainst, attacks, hits, passivity, ticks: s.tick };
}
