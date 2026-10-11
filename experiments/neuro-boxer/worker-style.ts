/** Worker for neuro-2 training/evaluation: runs bouts on the real sparring engine. League snapshots are sent once and referenced by id. */
import { parentPort } from "node:worker_threads";
import type { FightStyle } from "../../packages/protocol/src/fight-style";
import { boutFitness, runBout2, type Bout2Result, type Control, type Format, type Opponent, type Variant } from "./env-style";

export type OpponentSpec = Exclude<Opponent, { kind: "neuro2" }> | { kind: "league"; id: string; control: Control };
export type BoutSpec = { opponent: OpponentSpec; seed: number; side: 0 | 1; control: Control; format: Format; temperature: number; shaping: FightStyle | null };
export type WorkerMessage =
  | { type: "league"; id: string; theta: Float64Array; variant: Variant }
  | { type: "fitness"; id: number; theta: Float64Array; variant: Variant; bouts: BoutSpec[] }
  | { type: "bouts"; id: number; theta: Float64Array; variant: Variant; bouts: BoutSpec[] };
const league = new Map<string, { theta: Float64Array; variant: Variant }>();
const resolve = (o: OpponentSpec): Opponent => {
  if (o.kind !== "league") return o;
  const l = league.get(o.id); if (!l) throw new Error(`unknown league snapshot ${o.id}`);
  return { kind: "neuro2", theta: l.theta, variant: l.variant, control: o.control };
};
const run = (theta: Float64Array, variant: Variant, b: BoutSpec): Bout2Result => runBout2(theta, variant, b.control, resolve(b.opponent), b.seed, b.side, b.format, b.temperature);
parentPort!.on("message", (msg: WorkerMessage) => {
  if (msg.type === "league") { league.set(msg.id, { theta: msg.theta, variant: msg.variant }); return; }
  if (msg.type === "fitness") {
    let fitness = 0; for (const b of msg.bouts) fitness += boutFitness(run(msg.theta, msg.variant, b), b.shaping);
    parentPort!.postMessage({ id: msg.id, fitness: fitness / msg.bouts.length });
    return;
  }
  parentPort!.postMessage({ id: msg.id, results: msg.bouts.map(b => run(msg.theta, msg.variant, b)) });
});
