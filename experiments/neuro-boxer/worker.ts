import { parentPort } from "node:worker_threads";
import { runBout, type Opponent, type Variant } from "./env";
type Job = { id: number; theta: Float64Array; variant: Variant; bouts: { opponent: { kind: "bot"; style: "balanced" | "pressure" | "counter" } | { kind: "neuro"; theta: Float64Array }; seed: number; side: 0 | 1 }[] };
parentPort!.on("message", (job: Job) => {
  let fitness = 0;
  for (const b of job.bouts) fitness += runBout(job.theta, job.variant, b.opponent as Opponent, b.seed, b.side).fitness;
  parentPort!.postMessage({ id: job.id, fitness: fitness / job.bouts.length });
});
