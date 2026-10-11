import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sparringBotInput, SPARRING_VERSION, type SparringEvent } from "../src/combat-sparring";
import {
  canonicalJson, commitStyle, commitStyleFallback, createStyleHistory, createStyleSession, fallbackStyle, FIGHT_STYLES, parseStyleObservation, recordStyleEvents,
  replayStyleLog, sha256Utf8Hex, stepStyleSession, styleDecisionPoint, styleLog, styleObservation, styleObsHash, styleSessionWaiting, validateStyleLog,
  STYLE_FIGHTER_KEYS, STYLE_MIDROUND_LEAD_TICKS, STYLE_MIDROUND_TICKS, STYLE_OBSERVATION_KEYS, STYLE_RECENT_KEYS,
  type FightStyle, type StyleController, type StyleCornerSpec, type StyleDecisionLog, type StyleObservation, type StyleRequest,
} from "../src/fight-style";

// Authored test mapping onto the existing scripted bots: plumbing only, NOT a product controller or learning.
const BOT: Record<FightStyle, "balanced" | "pressure" | "counter"> = { pressure: "pressure", counter: "counter", cautious: "counter", outboxer: "balanced", body: "balanced", finisher: "pressure" };
const bots: StyleController = (s, side, style) => ({ input: sparringBotInput(s, side, style ? BOT[style] : "balanced") });
const BOUT = { durationSeconds: 20, rounds: 2, breakSeconds: 2 };
const JEV: StyleCornerSpec = { controller: "bot-mapped", model: null, strategist: "jev" };
// Stand-in for a network answer: a deterministic function of the observation digest.
const advise = (r: StyleRequest): FightStyle => FIGHT_STYLES[parseInt(r.obsHash.slice(0, 8), 16) % FIGHT_STYLES.length]!;
const answer = (r: StyleRequest) => ({ style: advise(r), source: "jev" as const, model: "jev-1.13.0", confidence: .5 });

/** Drives a session on a simulated frame clock: an answer lands delay(r) frames after its request (Infinity: never; the deadline then commits the fallback). */
function live(seed: number, delay: (r: StyleRequest) => number, deadline = Infinity, corners: [StyleCornerSpec, StyleCornerSpec] = [JEV, JEV], controller = bots) {
  const session = createStyleSession(seed, BOUT, corners), inflight = new Map<StyleRequest, number>(), events: SparringEvent[] = [], fallbacks: { request: StyleRequest; style: FightStyle }[] = [];
  let frame = 0, waits = 0;
  for (const r of session.pending) inflight.set(r, 0);
  while (!session.state.finished) {
    frame++;
    for (const [r, at] of [...inflight]) {
      if (frame - at >= delay(r)) { commitStyle(session, r, answer(r)); inflight.delete(r); }
      else if (frame - at >= deadline) { fallbacks.push({ request: r, style: commitStyleFallback(session, r)!.style }); inflight.delete(r); }
    }
    for (let k = 0; k < 3 && !session.state.finished; k++) { // several ticks per frame, like the renderer's accumulator
      if (styleSessionWaiting(session)) { waits++; break; }
      for (const r of stepStyleSession(session, controller)) inflight.set(r, frame);
      events.push(...session.state.events);
    }
  }
  return { session, events, waits, fallbacks, log: styleLog(session) };
}

test("style replay: the same (seed, log) gives an identical event list and winner, and matches the live run", () => {
  const run = live(4101, () => 0);
  assert.ok(run.log.decisions.length >= 6, "start, mid-round and roundend decisions for both corners");
  const a = replayStyleLog(run.log, bots), b = replayStyleLog(JSON.parse(JSON.stringify(run.log)) as StyleDecisionLog, bots);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.events, b.events); assert.equal(a.state.winner, b.state.winner);
  assert.deepEqual(a.events, run.events); assert.equal(a.state.winner, run.session.state.winner);
  assert.equal(canonicalJson(a.log), canonicalJson(run.log));
});

test("style replay: a delayed Jev answer with the same choice gives the same bout as an instant one (waiting is presentation only)", () => {
  const instant = live(4102, () => 0), delayed = live(4102, r => 1 + (r.requestTick % 7) * 31);
  assert.ok(delayed.waits > 0, "the simulation actually waited at an applyTick");
  assert.equal(instant.waits, 0);
  assert.deepEqual(delayed.events, instant.events); assert.equal(delayed.session.state.winner, instant.session.state.winner);
  assert.equal(canonicalJson(delayed.log), canonicalJson(instant.log));
});

test("style replay: an answer that never arrives commits fallbackStyle(observation) at the deadline and replays", () => {
  const run = live(4103, r => r.side === 1 ? Infinity : 0, 25);
  assert.ok(run.fallbacks.length >= 3);
  for (const { request, style } of run.fallbacks) assert.equal(style, fallbackStyle(request.observation));
  assert.ok(run.log.decisions.every(d => d.side === 1 ? d.source === "fallback" && d.model === null && d.confidence === null : d.source === "jev"));
  const replay = replayStyleLog(run.log, bots);
  assert.ok(replay.ok); assert.deepEqual(replay.events, run.events);
  // A late answer for an already committed request is ignored, never re-applied.
  const late = live(4103, () => 0);
  assert.equal(commitStyle(late.session, late.session.pending[0] ?? ({} as StyleRequest), answer({ obsHash: "0".repeat(64) } as StyleRequest)), null);
});

test("style observation: only allowed keys, integers/closed enums, no seed and no future ticks", () => {
  const run = live(4104, () => 0), keys = (o: object) => Object.keys(o).sort();
  const session = createStyleSession(4104, BOUT, [JEV, JEV]);
  for (const r of [...session.pending]) commitStyle(session, r, answer(r));
  let checked = 0;
  while (!session.state.finished && checked < 40) {
    const created = stepStyleSession(session, bots);
    for (const r of created) {
      const o = r.observation;
      assert.deepEqual(keys(o), [...STYLE_OBSERVATION_KEYS]); assert.deepEqual(keys(o.me), [...STYLE_FIGHTER_KEYS]); assert.deepEqual(keys(o.me.recent), [...STYLE_RECENT_KEYS]);
      assert.deepEqual(keys(o.opponent), [...STYLE_FIGHTER_KEYS]);
      const json = canonicalJson(o);
      const all: string[] = []; JSON.parse(json, (k, v) => { if (k) all.push(k); return v; });
      assert.ok(all.every(k => !/seed|tick|wager|bet|balance|wallet|stake|ident|^id$|^side$|^[xz]$/i.test(k)), json);
      assert.ok(JSON.parse(json, (_, v) => { if (typeof v === "number") assert.ok(Number.isSafeInteger(v)); return v; }));
      assert.deepEqual(parseStyleObservation(JSON.parse(json)), o);
      // Seed-independent: the same public state under another seed gives the same observation.
      assert.deepEqual(styleObservation({ ...session.state, seed: 99 }, r.side, session.history, r.point), o);
      assert.equal(r.obsHash, styleObsHash(o)); checked++;
      commitStyle(session, r, answer(r));
    }
  }
  assert.ok(checked >= 4 && run.log.decisions.length > 0);
  // The history is pinned to the state's tick: neither a stale nor a future view is accepted.
  const h = createStyleHistory(), s0 = createStyleSession(1, BOUT, [JEV, JEV]).state;
  assert.throws(() => styleObservation(s0, 0, h, "start")); recordStyleEvents(h, s0);
  assert.throws(() => recordStyleEvents(h, s0)); assert.doesNotThrow(() => styleObservation(s0, 0, h, "start"));
  assert.throws(() => styleObservation({ ...s0, tick: 1 }, 0, h, "midround"));
  const base = styleObservation(s0, 0, h, "start");
  for (const bad of [{ ...base, seed: 1 }, { ...base, round: 4 }, { ...base, me: { ...base.me, wallet: "x" } }, { ...base, me: { ...base.me, health: 1000.5 } }, { ...base, point: "later" }, { ...base, opponent: { ...base.opponent, recent: { ...base.opponent.recent, extra: 0 } } }])
    assert.equal(parseStyleObservation(bad), null);
  assert.equal(parseStyleObservation(base, ["start", "midround", "roundend"])?.point, "start");
  assert.equal(parseStyleObservation({ ...base, point: "learned" }, ["start", "midround", "roundend"]), null);
});

test("style obsHash: canonical key order and SHA-256 identical to node:crypto", () => {
  assert.equal(sha256Utf8Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (let n = 0; n <= 200; n += 1) { const t = "çğ-".repeat(n).slice(0, n); assert.equal(sha256Utf8Hex(t), createHash("sha256").update(t, "utf8").digest("hex")); }
  const a = { b: 1, a: { d: [2, "x"], c: null } }, b = { a: { c: null, d: [2, "x"] }, b: 1 };
  assert.equal(canonicalJson(a), '{"a":{"c":null,"d":[2,"x"]},"b":1}'); assert.equal(canonicalJson(a), canonicalJson(b));
  assert.throws(() => canonicalJson({ x: NaN })); assert.throws(() => canonicalJson({ x: undefined }));
});

test("style schedule: start before tick 0, mid-round every 900 fight ticks (+120), roundend applies at the next roundstart", () => {
  const product = { durationSeconds: 45, rounds: 3, breakSeconds: 8 };
  let distance = 0;
  for (const seed of [11, 12, 13, 14]) {
    const session = createStyleSession(seed, product, [JEV, { controller: "bot-mapped", model: null, strategist: null }]);
    const requests: StyleRequest[] = [...session.pending], starts: number[] = [];
    assert.deepEqual(requests.map(r => [r.side, r.requestTick, r.applyTick, r.point]), [[0, 0, 0, "start"]]);
    commitStyle(session, requests[0]!, answer(requests[0]!));
    let prev = session.state;
    while (!session.state.finished) {
      const created = stepStyleSession(session, bots);
      for (const r of created) { requests.push(r); commitStyle(session, r, answer(r)); }
      if (session.state.events.some(e => e.type === "roundstart")) starts.push(session.state.tick);
      const point = styleDecisionPoint(prev, session.state);
      if (point?.point === "midround") { assert.equal(session.state.roundTick % STYLE_MIDROUND_TICKS, 0); assert.equal(point.applyTick - point.requestTick, STYLE_MIDROUND_LEAD_TICKS); }
      prev = session.state;
    }
    assert.ok(requests.every(r => r.side === 0), "no requests for a corner without a style layer");
    const ends = requests.filter(r => r.point === "roundend");
    assert.deepEqual(ends.map(r => r.applyTick), starts, "every roundend decision applies exactly at the next roundstart");
    if (session.state.method === "decision" || session.state.method === "draw") { distance++; assert.equal(requests.length, 9, "1 start + 2x3 mid-round + 2 roundend for the 3x45 s product bout"); }
  }
  assert.ok(distance >= 1, "at least one bout went the distance");
});

test("style log validation: closed schema, valid styles/sources, per-corner source rules, monotonic ticks", () => {
  const { log } = live(4105, r => r.side ? Infinity : 0, 3);
  assert.ok(validateStyleLog(JSON.parse(JSON.stringify(log))).ok);
  const mutate = (f: (x: any) => void) => { const x = JSON.parse(JSON.stringify(log)); f(x); return validateStyleLog(x); };
  const code = (f: (x: any) => void) => { const r = mutate(f); return r.ok ? "OK" : r.code; };
  assert.equal(code(x => { x.extra = 1; }), "SHAPE");
  assert.equal(code(x => { x.version = "style-log-0"; }), "VERSION");
  assert.equal(code(x => { x.corners[0].secret = "k"; }), "SHAPE");
  assert.equal(code(x => { x.decisions[0].note = "free text"; }), "DECISION");
  assert.equal(code(x => { x.decisions[0].style = "brawler"; }), "DECISION");
  assert.equal(code(x => { x.decisions[0].source = "oracle"; }), "DECISION");
  assert.equal(code(x => { x.decisions[0].confidence = 1.5; }), "DECISION");
  assert.equal(code(x => { x.decisions[0].obsHash = "ABC"; }), "DECISION");
  assert.equal(code(x => { x.decisions[0].applyTick = x.decisions[0].requestTick - 1; }), "DECISION");
  assert.equal(code(x => { x.decisions[0].source = "neuro"; }), "SOURCE");
  assert.equal(code(x => { x.decisions[0].source = "cache"; }), "SOURCE");
  assert.equal(code(x => { const d = x.decisions.find((d: any) => d.source === "fallback"); d.model = "jev-1.13.0"; }), "SOURCE");
  assert.equal(code(x => { x.corners[1].strategist = null; }), "SOURCE");
  assert.equal(code(x => { x.decisions.reverse(); }), "ORDER");
  assert.equal(code(x => { x.decisions.push({ ...x.decisions.at(-1) }); }), "ORDER");
});

test("style replay rejects a log that does not match the recomputed bout", () => {
  const { log } = live(4106, () => 0), copy = () => JSON.parse(JSON.stringify(log)) as StyleDecisionLog;
  const code = (l: StyleDecisionLog) => { const r = replayStyleLog(l, bots); return r.ok ? "OK" : r.code; };
  assert.equal(code(copy()), "OK");
  assert.equal(code({ ...copy(), engine: "sparring-4" }), "ENGINE_MISMATCH");
  const tampered = copy(); tampered.decisions[2]!.obsHash = "f".repeat(64); assert.equal(code(tampered), "LOG_MISMATCH");
  const moved = copy(); moved.decisions[2]!.applyTick += 1; assert.equal(code(moved), "LOG_MISMATCH");
  const missing = copy(); missing.decisions.splice(2, 1); assert.equal(code(missing), "LOG_MISSING_DECISION");
  const extra = copy(); extra.decisions.push({ ...extra.decisions.at(-1)!, requestTick: 999_999, applyTick: 999_999 }); assert.equal(code(extra), "LOG_UNUSED_DECISION");
  const other = copy(); other.seed += 1; assert.notEqual(code(other), "OK");
});

test("learned strategist changes are logged as neuro decisions and verified on replay", () => {
  const corners: [StyleCornerSpec, StyleCornerSpec] = [{ controller: "test-learned", model: "t1", strategist: "learned" }, JEV];
  const learned: StyleController = (s, side, style) => {
    const report = side === 0 && s.phase === "fight" && s.tick % 600 === 0 ? { style: FIGHT_STYLES[(s.tick / 600) % 6]!, confidence: .25, model: "test-learned" } : null;
    return { input: sparringBotInput(s, side, BOT[report?.style ?? style ?? "outboxer"]), learned: report };
  };
  const run = live(4107, () => 2, Infinity, corners, learned);
  const neuro = run.log.decisions.filter(d => d.source === "neuro");
  assert.ok(neuro.length >= 3 && neuro.every(d => d.side === 0 && d.applyTick === d.requestTick && d.model === "test-learned"));
  assert.ok(run.log.decisions.filter(d => d.side === 1).every(d => d.source === "jev"));
  const replay = replayStyleLog(run.log, learned); assert.ok(replay.ok); assert.deepEqual(replay.events, run.events);
  const altered = JSON.parse(JSON.stringify(run.log)) as StyleDecisionLog; altered.decisions.find(d => d.source === "neuro")!.style = "body";
  const bad = replayStyleLog(altered, learned); assert.ok(!bad.ok && bad.code === "LEARNED_MISMATCH");
});

test("fallbackStyle is a pure deterministic rule covering every style", () => {
  const recent = (thrown = 5, landed = 2, blocked = 1, slipped = 0, counters = 0) => ({ thrown, landed, blocked, slipped, counters });
  const o = (me: Partial<StyleObservation["me"]>, op: Partial<StyleObservation["opponent"]>, round = 1): StyleObservation => ({ point: "midround", round, rounds: 3, roundSecondsLeft: 20,
    me: { health: 800, stamina: 700, knockdowns: 0, cardPoints: 0, recent: recent(), ...me }, opponent: { health: 800, stamina: 700, knockdowns: 0, cardPoints: 0, recent: recent(), ...op } });
  const cases: [StyleObservation, FightStyle][] = [
    [o({}, { health: 250 }), "finisher"], [o({ health: 250 }, {}), "cautious"], [o({ stamina: 150 }, {}), "cautious"],
    [o({ cardPoints: 18 }, { cardPoints: 20 }, 3), "pressure"], [o({ recent: recent(4) }, { recent: recent(6, 3, 0, 0, 2) }), "outboxer"],
    [o({}, { recent: recent(12, 2) }), "counter"], [o({ recent: recent(8, 2, 5) }, {}), "body"], [o({}, { recent: recent(2, 1) }), "pressure"],
    [o({ health: 700 }, {}), "pressure"], [o({}, {}), "outboxer"],
  ];
  for (const [obs, style] of cases) { assert.equal(fallbackStyle(obs), style, canonicalJson(obs)); assert.equal(fallbackStyle(structuredClone(obs)), style); }
  assert.deepEqual(new Set(cases.map(c => c[1])), new Set(FIGHT_STYLES));
  assert.equal(SPARRING_VERSION, createStyleSession(1, BOUT, [JEV, JEV]).state.version);
});
