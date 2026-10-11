import assert from "node:assert/strict";
import test from "node:test";
import { createSparring, stepSparring, sparringBotInput, type SparringState } from "../src/combat-sparring";
import { createNeuroMemory, neuroInput, neuroObserve, NEURO_IN_PARAMS, NEURO_OBS, NEURO_OUT_PARAMS } from "../src/neuro-boxer";
import { NEURO_BOXER_GRAPH, NEURO_BOXER_INFO, NEURO_BOXER_PARAMS } from "../src/neuro-boxer-model";

function bout(seed: number) {
  let s: SparringState = createSparring(seed, { durationSeconds: 30, rounds: 1 }); const mem = createNeuroMemory(), obs = new Float64Array(NEURO_OBS); const trace: string[] = [];
  while (!s.finished) {
    const input = neuroInput(s, 0, NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS, mem);
    neuroObserve(s, 0, obs); for (const v of obs) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1, `obs out of range ${v}`);
    if (s.phase !== "fight" || s.fighters[0].action === "knockdown" || s.fighters[0].action === "getup") assert.equal(input.action, null);
    s = stepSparring(s, [input, sparringBotInput(s, 1, "balanced")]);
    for (const e of s.events) if (e.actor === 0 && (e.type === "attack" || e.type === "hit")) trace.push(`${s.tick}:${e.type}:${e.attack}`);
  }
  return { s, trace };
}

test("NeuroBoxer: generated model has the real 128-node/4 949-edge graph and the declared parameter sizes", () => {
  assert.equal(NEURO_BOXER_GRAPH.pre.length, 4949); assert.equal(NEURO_BOXER_GRAPH.post.length, 4949);
  assert.ok(NEURO_BOXER_GRAPH.pre.every(n => n >= 0 && n < 128) && NEURO_BOXER_GRAPH.post.every(n => n >= 0 && n < 128));
  assert.equal(NEURO_BOXER_PARAMS.inW.length, NEURO_IN_PARAMS); assert.equal(NEURO_BOXER_PARAMS.outW.length, NEURO_OUT_PARAMS);
  assert.equal(NEURO_BOXER_INFO.graphSha256, "284dca2f166169c47d50a489d96bb011ceab3ae01a73922c2dd4c44da041e37d");
  assert.equal(NEURO_BOXER_INFO.wholeBrain, false); assert.equal(NEURO_BOXER_INFO.consciousness, false);
});

test("NeuroBoxer: perception stays in range, no commands while down/counted, and a bout replays identically", () => {
  const a = bout(5101), b = bout(5101);
  assert.deepEqual(a.trace, b.trace); assert.deepEqual(a.s.fighters, b.s.fighters);
  assert.ok(a.trace.length > 10, "the controller actually fights");
});

test("NeuroBoxer: seeded sampling varies bouts across seeds, replays exactly per seed, and both corners decide on the same tick", () => {
  const run = (seed: number) => {
    let s: SparringState = createSparring(seed, { durationSeconds: 20, rounds: 1 }); const m0 = createNeuroMemory(), m1 = createNeuroMemory(); const decided: number[] = [];
    while (!s.finished) {
      const a = neuroInput(s, 0, NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS, m0, { temperature: .8 }), b = neuroInput(s, 1, NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS, m1, { temperature: .8 });
      if (a.action) decided.push(s.tick % 4); if (b.action) decided.push(s.tick % 4);
      s = stepSparring(s, [a, b]);
    }
    assert.ok(decided.every(t => t === 0), "commands only on the shared decision tick");
    return JSON.stringify(s.fighters.map(f => [f.health, f.hits, f.damageDealt]));
  };
  assert.equal(run(9001), run(9001));
  assert.ok(new Set([9001, 9002, 9003, 9004, 9005].map(run)).size >= 3, "different seeds give different bouts");
});
