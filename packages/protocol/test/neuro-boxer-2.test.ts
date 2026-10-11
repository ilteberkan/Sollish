import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSparring, stepSparring, sparringBotInput, type SparringInput, type SparringState } from "../src/combat-sparring";
import { FIGHT_STYLES, type FightStyle } from "../src/fight-style";
import { NEURO_BOXER_GRAPH, NEURO_BOXER_INFO } from "../src/neuro-boxer-model";
import { createNeuro2Memory, neuro2Input, neuro2Observe, neuro2Params, neuro2Thought, neuro2Track, NEURO2_DIM, NEURO2_IN_PARAMS, NEURO2_MIN_HOLD_TICKS, NEURO2_OBS, NEURO2_STYLE_OFFSET, NEURO2_SWITCH_MARGIN, NEURO2_VERSION, type Neuro2Memory, type Neuro2Params } from "../src/neuro-boxer-2";
import { NEURO2_GRAPH, NEURO2_INFO, NEURO2_PARAMS } from "../src/neuro-boxer-2-model";

const sha = (path: string) => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
const BOUT = { durationSeconds: 15, rounds: 3, breakSeconds: 2 };
/** Deterministic random parameters with a loud strategist (frequent candidate changes) for schedule tests. */
function loudParams(seed: number, styleScale = 2.5): Neuro2Params {
  let r = seed >>> 0; const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const theta = new Float64Array(NEURO2_DIM);
  for (let i = 0; i < NEURO2_DIM; i++) theta[i] = g() * (i < NEURO2_IN_PARAMS ? .5 : i < NEURO2_DIM - 6 * 141 ? .3 : styleScale);
  return neuro2Params(theta);
}
type Trace = { inputs: string[]; styles: string[]; events: string[]; state: SparringState; mems: [Neuro2Memory, Neuro2Memory] };
function bout(seed: number, p: Neuro2Params, opts: { temperature?: number; override?: (tick: number, side: 0 | 1) => FightStyle | null; bot?: boolean; onTick?: (s: SparringState, mems: [Neuro2Memory, Neuro2Memory]) => void } = {}): Trace {
  let s = createSparring(seed, BOUT); const mems: [Neuro2Memory, Neuro2Memory] = [createNeuro2Memory(), createNeuro2Memory()];
  const inputs: string[] = [], styles: string[] = [], events: string[] = [];
  while (!s.finished) {
    const a = neuro2Input(s, 0, NEURO2_GRAPH, p, mems[0], { temperature: opts.temperature ?? .8, style: opts.override?.(s.tick, 0) ?? null });
    const b: SparringInput = opts.bot ? sparringBotInput(s, 1, "balanced") : neuro2Input(s, 1, NEURO2_GRAPH, p, mems[1], { temperature: opts.temperature ?? .8, style: opts.override?.(s.tick, 1) ?? null });
    inputs.push(JSON.stringify([s.tick, a, b])); styles.push(`${s.tick}:${mems[0].style}@${mems[0].styleSince}/${mems[1].style}@${mems[1].styleSince}`);
    opts.onTick?.(s, mems);
    s = stepSparring(s, [a, b]);
    for (const e of s.events) events.push(`${e.tick}:${e.type}:${e.actor}:${e.attack}:${e.damage}`);
  }
  return { inputs, styles, events, state: s, mems };
}

test("neuro-2: generated model is versioned, uses neuro-1's real graph, declares no brain or consciousness claim", () => {
  assert.equal(NEURO2_INFO.version, NEURO2_VERSION); assert.equal(NEURO2_INFO.wholeBrain, false); assert.equal(NEURO2_INFO.consciousness, false);
  assert.equal(typeof NEURO2_INFO.provisional, "boolean"); assert.match(NEURO2_INFO.thetaSha256, /^[0-9a-f]{64}$/); assert.match(NEURO2_INFO.engine, /^sparring-\d+$/);
  assert.equal(NEURO2_INFO.graphSha256, NEURO_BOXER_INFO.graphSha256); assert.equal(NEURO2_GRAPH, NEURO_BOXER_GRAPH);
  assert.equal(NEURO2_PARAMS.inW.length + NEURO2_PARAMS.outW.length + NEURO2_PARAMS.styleW.length, NEURO2_DIM);
});

test("neuro-2: neuro-1 stays byte-frozen", () => {
  assert.equal(sha("../src/neuro-boxer-model.ts"), "4a97f03f64ce95460a94dfbf197eb275845077adddf28709526b35feb13a2c2a");
  assert.equal(sha("../src/neuro-boxer.ts"), "2d616fa84a30c863a0201d12d1bf2ef248ca4491c42e71b986219798d0d648e6");
  assert.equal(NEURO_BOXER_INFO.thetaSha256, "8cde29cdc11542aabb2b348894477fc43b77503bb83870d4514541182c0e958e");
});

test("neuro-2: the same seed replays identically with both corners; seeds differ; commands only on the shared decision tick", () => {
  const a = bout(5201, NEURO2_PARAMS), b = bout(5201, NEURO2_PARAMS);
  assert.deepEqual(a.inputs, b.inputs); assert.deepEqual(a.styles, b.styles); assert.deepEqual(a.events, b.events); assert.deepEqual(a.state.fighters, b.state.fighters);
  for (const row of a.inputs) { const [tick, x, y] = JSON.parse(row) as [number, SparringInput, SparringInput]; if (x.action || y.action) assert.equal(tick % 4, 0); }
  assert.ok(new Set([5202, 5203, 5204, 5205].map(seed => bout(seed, NEURO2_PARAMS).events.join("|"))).size >= 3, "different seeds give different bouts");
  assert.equal(a.mems[0].trackGaps + a.mems[1].trackGaps, 0);
});

test("neuro-2: observation buffer is 40 values from allowed match state only; wagers/balances in context never enter", () => {
  // Every property the perception, strategic inputs and tracker may read; anything else (wagers, balances, ids, seed) is a failure.
  const allowed = new Set(["tick", "roundTick", "durationTicks", "round", "rounds", "scores", "events", "fighters", "phase", "finished",
    "f.x", "f.z", "f.vx", "f.vz", "f.facing", "f.action", "f.phase", "f.actionAt", "f.actionUntil", "f.stamina", "f.health", "f.daze", "f.lastHitAt", "f.knockdowns", "f.roundDamage",
    "e.type", "e.actor", "e.attack"]);
  const read = new Set<string>();
  const spy = <T extends object>(o: T, prefix: string): T => new Proxy(o, { get(t, k, r) {
    const v = Reflect.get(t, k, r); if (typeof k === "symbol" || (Array.isArray(t) && (/^\d+$/.test(k) || k === "length" || typeof v === "function"))) return v && typeof v === "object" ? spy(v, prefix) : v;
    read.add(prefix + k); return v && typeof v === "object" && (k === "fighters" || k === "events" || k === "scores") ? spy(v, k === "fighters" ? "f." : k === "events" ? "e." : "scores.") : v; } });
  let s = createSparring(77, BOUT); const mem = createNeuro2Memory(), clean = createNeuro2Memory(), p = loudParams(3), seen = new Set<string>();
  for (let i = 0; i < 2400 && !s.finished; i++) {
    const withContext = { ...s, wager: 5_000_000, balance: 123_456, wallet: "So1ana", sessionId: "secret", fighters: s.fighters.map(f => ({ ...f, wager: 999, balance: 42 })) } as unknown as SparringState;
    read.clear(); neuro2Track(spy(withContext, ""), 0, mem); const obs = neuro2Observe(spy(withContext, ""), 0, mem, new Float64Array(NEURO2_OBS));
    for (const k of read) { seen.add(k); if (!k.startsWith("scores.")) assert.ok(allowed.has(k), `observation read a disallowed field: ${k}`); }
    neuro2Track(s, 0, clean); const ref = neuro2Observe({ ...s, seed: (s.seed + 99991) >>> 0 }, 0, clean, new Float64Array(NEURO2_OBS));
    assert.equal(obs.length, 40); assert.deepEqual(Array.from(obs), Array.from(ref), "context fields and the seed never change the observation");
    for (let k = 0; k < NEURO2_OBS; k++) assert.ok(obs[k]! >= -1 && obs[k]! <= 1 && Number.isFinite(obs[k]!));
    assert.equal(obs.slice(NEURO2_STYLE_OFFSET).reduce((a, b) => a + b, 0), 1, "style one-hot");
    const a = neuro2Input(s, 0, NEURO2_GRAPH, p, mem), b = sparringBotInput(s, 1, "pressure");
    neuro2Input(s, 0, NEURO2_GRAPH, p, clean);
    s = stepSparring(s, [a, b]);
  }
  for (const k of ["f.x", "f.health", "f.knockdowns", "scores", "round", "e.type", "e.actor"]) assert.ok(seen.has(k), `spy saw ${k}`);
});

test("neuro-2: style hysteresis holds every commit >= 3 s and switches only on a >= 0.15 probability margin", () => {
  let switches = 0;
  for (const seed of [11, 12, 13]) {
    const p = loudParams(seed);
    let prev: [FightStyle, number][] = [["pressure", -1], ["pressure", -1]];
    bout(6000 + seed, p, { onTick: (_s, mems) => {
      mems.forEach((m, side) => {
        const [style, since] = prev[side]!;
        if (since >= 0 && m.styleSince !== since) {
          switches++;
          assert.ok(m.styleSince - since >= NEURO2_MIN_HOLD_TICKS, `held only ${m.styleSince - since} ticks`);
          assert.notEqual(m.style, style);
          assert.ok(m.styleP[FIGHT_STYLES.indexOf(m.style)]! - m.styleP[FIGHT_STYLES.indexOf(style)]! >= NEURO2_SWITCH_MARGIN - 1e-12, "switch margin");
          assert.equal(m.styleEvaluatedAt, m.styleSince);
        }
        prev[side] = [m.style, m.styleSince];
      });
    } });
  }
  assert.ok(switches > 0, "the schedule test must actually observe switches");
});

test("neuro-2: tendency EMAs use only events up to the current tick, each tick exactly once", () => {
  const T = 700, p = loudParams(5);
  const run = (afterT: (s: SparringState) => SparringInput) => {
    let s = createSparring(4242, BOUT); const mem = createNeuro2Memory(); let atT: number[] = [];
    while (!s.finished && s.tick <= T + 600) {
      const a = neuro2Input(s, 0, NEURO2_GRAPH, p, mem);
      if (s.tick === T) atT = Array.from(mem.tendency);
      s = stepSparring(s, [a, s.tick < T ? sparringBotInput(s, 1, "balanced") : afterT(s)]);
    }
    return { atT, end: Array.from(mem.tendency), gaps: mem.trackGaps };
  };
  const x = run(s => sparringBotInput(s, 1, "pressure")), y = run(() => ({ moveX: 0, moveZ: 0, guard: true, action: null }));
  assert.deepEqual(x.atT, y.atT, "a different future must not change the tracker at T"); assert.notDeepEqual(x.end, y.end);
  assert.equal(x.gaps, 0);
  // Re-tracking the same tick is a no-op; a skipped tick is detected.
  let s = createSparring(9, BOUT); const m = createNeuro2Memory();
  for (let i = 0; i < 300; i++) { neuro2Track(s, 0, m); const before = Array.from(m.tendency); neuro2Track(s, 0, m); assert.deepEqual(Array.from(m.tendency), before); s = stepSparring(s, [sparringBotInput(s, 0, "pressure"), sparringBotInput(s, 1, "counter")]); }
  s = stepSparring(s, [sparringBotInput(s, 0, "pressure"), sparringBotInput(s, 1, "counter")]); neuro2Track(s, 0, m); assert.equal(m.trackGaps, 1);
});

test("neuro-2: an external style is honoured exactly from the tick it is passed, never overridden, and replays exactly", () => {
  const p = loudParams(21);
  for (const T of [600, 601]) {
    const base = bout(31, p), ext = bout(31, p, { override: (tick, side) => side === 0 && tick >= T ? "body" : null });
    const k = base.inputs.findIndex(r => (JSON.parse(r) as [number])[0] === T); assert.ok(k > 0, "bout still running at the commit tick");
    assert.deepEqual(ext.inputs.slice(0, k), base.inputs.slice(0, k), "nothing changes before the commit tick");
    const committed = ext.styles[k]!.split("/")[0]; assert.equal(committed, `${T}:body@${T}`);
    for (const row of ext.styles.slice(k)) assert.ok(row.startsWith(`${row.split(":")[0]}:body@${T}/`), `external style held: ${row}`);
    assert.equal(ext.mems[0].styleSource, "external"); assert.ok(ext.mems[0].evaluations > 2, "strategist still evaluated for display");
    assert.deepEqual(bout(31, p, { override: (tick, side) => side === 0 && tick >= T ? "body" : null }).events, ext.events, "(seed, decision log) replays exactly");
  }
  // The tactical brain sees the committed one-hot at the first decision on/after the commit tick.
  let s = createSparring(31, BOUT); const mem = createNeuro2Memory(); let checked = -1;
  for (let i = 0; i < 700 && checked < 0; i++) {
    const before = mem.decisions, a = neuro2Input(s, 0, NEURO2_GRAPH, p, mem, { temperature: .8, style: s.tick >= 601 ? "outboxer" : null });
    if (s.tick >= 601 && mem.decisions > before) { checked = s.tick; assert.deepEqual(Array.from(mem.obs.slice(NEURO2_STYLE_OFFSET)), FIGHT_STYLES.map(k => k === "outboxer" ? 1 : 0)); }
    s = stepSparring(s, [a, sparringBotInput(s, 1, "balanced")]);
  }
  assert.ok(checked >= 604 && checked % 4 === 0, `first decision after the commit at ${checked}`);
});

test("neuro-2: a repeated call for the same tick returns the same input without advancing memory; thought view is consistent", () => {
  let s = createSparring(12, BOUT); const mem = createNeuro2Memory();
  assert.deepEqual(neuro2Thought(mem).reasons, []);
  for (let i = 0; i < 400; i++) {
    const a = neuro2Input(s, 0, NEURO2_GRAPH, NEURO2_PARAMS, mem, { temperature: .8 }), h = Array.from(mem.h), d = mem.decisions;
    assert.deepEqual(neuro2Input(s, 0, NEURO2_GRAPH, NEURO2_PARAMS, mem, { temperature: .8 }), a); assert.deepEqual(Array.from(mem.h), h); assert.equal(mem.decisions, d);
    s = stepSparring(s, [a, sparringBotInput(s, 1, "counter")]);
  }
  const t = neuro2Thought(mem);
  assert.ok(FIGHT_STYLES.includes(t.style)); assert.equal(t.styleSource, "neuro"); assert.ok(Math.abs(t.styleP.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(t.reasons.length, 3); for (const r of t.reasons) assert.ok(r.label.length > 3 && Number.isFinite(r.weight));
  assert.ok(t.heldTicks >= 0 && t.heldTicks <= s.tick);
});
