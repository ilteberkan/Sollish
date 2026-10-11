import assert from "node:assert/strict";
import test from "node:test";
import { createSparring, stepSparring, sparringPose, sparringBotInput, SPARRING_ATTACKS, SPARRING_BOXING_ATTACKS, SPARRING_COUNT_TICKS, SPARRING_NEUTRAL_INPUT, lyingBodyPoint, type SparringState, type SparringInput, type SparringAttack } from "../src/combat-sparring";
import { capsuleOverlap, pointSegDistance, sparringCapsules, SPARRING_BODY_PARTS, SPARRING_CAPSULE_RADII, SPARRING_GUARD_PARTS, SPARRING_HURT_PARTS } from "../src/combat-capsules";

const idle = () => ({ ...SPARRING_NEUTRAL_INPUT });
function close(distance = .86) { const s = createSparring(17); s.fighters[0].x = -distance / 2; s.fighters[1].x = distance / 2; return s; }
function run(state: SparringState, ticks: number, command: (i: number, s: SparringState) => readonly [SparringInput, SparringInput] = () => [idle(), idle()]) {
  let s = state; const events = [] as SparringState["events"];
  for (let i = 0; i < ticks && !s.finished; i++) { s = stepSparring(s, command(i, s)); events.push(...s.events); }
  return { s, events };
}

test("input-driven tick is immutable, bounded and rejects invalid input before state changes", () => {
  const state = close(), before = JSON.stringify(state);
  assert.throws(() => stepSparring(state, [{ ...idle(), moveX: NaN }, idle()]));
  assert.throws(() => createSparring(-1)); assert.throws(() => createSparring(1, { durationSeconds: Infinity }));
  const next = stepSparring(state, [{ ...idle(), action: "jab" }, idle()]);
  assert.equal(JSON.stringify(state), before); assert.equal(next.tick, 1); assert.equal(next.fighters[0].stamina, 935);
});

test("all boxing attacks miss outside swept reach, consuming stamina without damage", () => {
  for (const attack of SPARRING_BOXING_ATTACKS) {
    const { s, events } = run(close(2.8), 65, i => [{ ...idle(), action: i === 0 ? attack : null }, idle()]);
    assert.equal(s.fighters[1].health, 1000, attack); assert.equal(events.filter(e => e.type === "miss").length, 1, attack);
  }
});

test("all boxing attack geometries can hit once and only once per attack instance", () => {
  for (const attack of SPARRING_BOXING_ATTACKS) {
    const { s, events } = run(close(), 65, i => [{ ...idle(), action: i === 0 ? attack : null }, idle()]);
    assert.equal(events.filter(e => e.type === "hit").length, 1, attack);
    assert.equal(1000 - s.fighters[1].health, events.filter(e => e.type === "hit").reduce((n, e) => n + e.damage, 0));
  }
});

test("front guard blocks every boxing punch with finite stamina cost below the strike cost", () => {
  for (const attack of SPARRING_BOXING_ATTACKS) {
    let s = close(); const events = [] as SparringState["events"]; let staminaAtBlock = -1;
    for (let i = 0; i < 50; i++) { s = stepSparring(s, [{ ...idle(), action: i === 0 ? attack : null }, { ...idle(), guard: true }]); events.push(...s.events); if (s.events.some(e => e.type === "block")) staminaAtBlock = s.fighters[1].stamina; }
    assert.equal(events.filter(e => e.type === "block").length, 1, attack); assert.equal(s.fighters[1].hits, 0);
    assert.ok(s.fighters[1].health > 985);
    const spent = 1000 - staminaAtBlock;
    assert.ok(spent > 0 && spent < SPARRING_ATTACKS[attack].cost, `${attack}: blocking cost ${spent} must be finite and below the thrower's ${SPARRING_ATTACKS[attack].cost}`);
  }
});

test("hit interrupts startup, creates counter, hitstun and visible root knockback", () => {
  const initial = close(); let s = initial, contactX = 0; const events = [] as SparringState["events"];
  for (let i = 0; i < 20; i++) { s = stepSparring(s, [{ ...idle(), action: i === 0 ? "jab" : null }, { ...idle(), action: i === 4 ? "cross" : null }]); events.push(...s.events); if (s.events.some(e => e.type === "hit")) contactX = s.fighters[1].x; }
  assert.ok(events.some(e => e.type === "counter" && e.actor === 0));
  assert.ok(!events.some(e => e.type === "hit" && e.actor === 1));
  assert.ok(s.fighters[1].x > contactX + .035);
  assert.ok(events.some(e => e.type === "hit"));
});

test("well timed geometric slip evades jab; late slip is rejected during hitstun", () => {
  const early = run(close(), 25, i => [{ ...idle(), action: i === 0 ? "jab" : null }, { ...idle(), action: i === 0 ? "slip" : null }]);
  assert.equal(early.s.fighters[1].health, 1000); assert.ok(early.events.some(e => e.type === "dodge"));
  let s = close(); while (!s.events.some(e => e.type === "hit")) s = stepSparring(s, [{ ...idle(), action: s.tick === 0 ? "jab" : null }, idle()]);
  s = stepSparring(s, [idle(), { ...idle(), action: "slip" }]); assert.ok(s.events.some(e => e.type === "rejected" && e.reason === "hitstun"));
});

test("guardbreak interrupts exhausted guard; stamina never becomes negative", () => {
  const initial = close(); initial.fighters[1].stamina = 30; initial.fighters[1].lastSpendAt = 0;
  const { s, events } = run(initial, 15, i => [{ ...idle(), action: i === 0 ? "cross" : null }, { ...idle(), guard: true }]);
  assert.ok(events.some(e => e.type === "guardbreak")); assert.equal(s.fighters[1].stamina, 0); assert.equal(s.fighters[1].phase, "hitstun");
  const empty = close(); empty.fighters[0].stamina = 50;
  const next = stepSparring(empty, [{ ...idle(), action: "cross" }, idle()]); assert.equal(next.fighters[0].action, "idle"); assert.ok(next.events.some(e => e.reason === "stamina"));
});

test("hit-confirmed jab/cross/hook chain has a finite cancel window and chain cap", () => {
  const { s, events } = run(close(), 70, (i, state) => [{ ...idle(), action: i === 0 ? "jab" : i === 13 ? "cross" : i === 31 ? "hook" : i === 51 ? "cross" : null }, { ...idle(), guard: true }]);
  assert.equal(events.filter(e => e.type === "combo").length, 2);
  assert.ok(events.filter(e => e.type === "attack").length >= 3); assert.ok(s.fighters[0].stamina >= 0);
  const missed = run(close(3), 35, i => [{ ...idle(), action: i === 0 ? "jab" : i === 13 ? "cross" : null }, idle()]);
  assert.equal(missed.events.filter(e => e.type === "combo").length, 0);
});

test("early buffered command expires rather than firing after long recovery", () => {
  const { events } = run(close(3), 80, i => [{ ...idle(), action: i === 0 ? "uppercut" : i === 2 ? "jab" : null }, idle()]);
  assert.deepEqual(events.filter(e => e.type === "attack").map(e => e.attack), ["uppercut"]);
});

test("repeating same strike diminishes damage, distinct strike restores baseline", () => {
  let s = close(); const damages: number[] = [];
  for (const attack of ["jab", "jab", "cross"] as const) {
    s.fighters[0].x = -.43; s.fighters[1].x = .43; s.fighters[1].vx = s.fighters[1].vz = 0;
    const result = run(s, 30, i => [{ ...idle(), action: i === 0 ? attack : null }, idle()]); s = result.s;
    damages.push(result.events.find(e => e.type === "hit")!.damage);
  }
  assert.ok(damages[1]! < damages[0]!); assert.equal(damages[2], SPARRING_ATTACKS.cross.damage);
});

test("jump changes authoritative contact height, permits aerial strike and lands with finite cost", () => {
  let s = close(1.2); s = stepSparring(s, [{ ...idle(), jump: true }, idle()]);
  assert.ok(s.fighters[0].y > 0); assert.equal(s.fighters[0].stamina, 900);
  const groundHead = 1.65; assert.ok(sparringPose(s.fighters[0], s.tick).head.y > groundHead);
  s = stepSparring(s, [{ ...idle(), action: "cross" }, idle()]); assert.equal(s.fighters[0].action, "cross");
  s = run(s, 50).s; assert.equal(s.fighters[0].y, 0); assert.equal(s.fighters[0].vy, 0);
});

test("ring walls and root separation hold under sustained opposed movement", () => {
  let s = close(.65);
  for (let i = 0; i < 600; i++) {
    s = stepSparring(s, [{ ...idle(), moveX: 1, moveZ: 1 }, { ...idle(), moveX: -1, moveZ: 1 }]);
    for (const f of s.fighters) { assert.ok(Math.abs(f.x) <= 3.15); assert.ok(Math.abs(f.z) <= 3.15); }
    assert.ok(Math.hypot(s.fighters[0].x - s.fighters[1].x, s.fighters[0].z - s.fighters[1].z) >= .78 - 1e-9, `tick ${s.tick}`);
  }
});

test("same input log gives exactly the same state in 30/60/120Hz presentation batches", () => {
  const inputs = Array.from({ length: 600 }, (_, i) => [{ ...idle(), moveX: i < 15 ? 1 : 0, action: i % 45 === 0 ? "jab" as const : null }, { ...idle(), guard: i % 90 < 25 }] as const);
  const replay = (batch: number) => { let s = createSparring(81); for (let n = 0; n < inputs.length; n += batch) for (const pair of inputs.slice(n, n + batch)) s = stepSparring(s, pair); return s; };
  assert.deepEqual(replay(1), replay(2)); assert.deepEqual(replay(1), replay(4));
});

test("coincident roots at a ring corner separate without pushing either outside", () => {
  const initial = close(); for (const f of initial.fighters) { f.x = 3.15; f.z = 3.15; }
  const s = stepSparring(initial, [idle(), idle()]);
  assert.ok(Math.hypot(s.fighters[0].x - s.fighters[1].x, s.fighters[0].z - s.fighters[1].z) >= .78 - 1e-10);
  for (const f of s.fighters) { assert.ok(Math.abs(f.x) <= 3.15); assert.ok(Math.abs(f.z) <= 3.15); }
});

test("same-tick clean contacts trade, and knockout damage records actual lost health", () => {
  const initial = close(); initial.fighters[0].health = 20; initial.fighters[1].health = 20;
  const { s, events } = run(initial, 20, i => [{ ...idle(), action: i === 0 ? "jab" : null }, { ...idle(), action: i === 0 ? "jab" : null }]);
  assert.equal(s.finished, true); assert.equal(s.winner, "draw");
  assert.deepEqual(events.filter(e => e.type === "hit").map(e => e.damage), [20, 20]);
  assert.equal(events.filter(e => e.type === "knockout").length, 2);
});

test("scripted tactical bots close distance, use multiple techniques and finish without resource violations", () => {
  for (const seed of [1, 17, 812]) {
    let s = createSparring(seed); const attacks = new Set<string>(); let hits = 0;
    while (!s.finished) {
      s = stepSparring(s, [sparringBotInput(s, 0, "balanced"), sparringBotInput(s, 1, "pressure")]);
      for (const e of s.events) { if (e.type === "attack" && e.attack) attacks.add(e.attack); if (e.type === "hit") hits++; }
      for (const f of s.fighters) { assert.ok(Number.isFinite(f.x + f.z + f.y)); assert.ok(f.stamina >= 0 && f.stamina <= 1000); assert.ok(f.health >= 0 && f.health <= 1000); }
    }
    assert.ok(hits >= 5, `seed ${seed}: ${hits} hits`); assert.ok(attacks.size >= 3); assert.ok(s.roundTick <= s.durationTicks); // counts pause the round clock
  }
});

// sparring-5 volumes: head/torso capsules, plus forearms/gloves while the defender holds a raised guard
// (sparring-2..4 used head/chest spheres; the surface-stop property is unchanged).
const guardRaised = (f: SparringState["fighters"][0]) => f.action === "guard" && f.stamina >= 15;
const depth = (s: SparringState, side: 0 | 1, guard = true) => {
  const pose = sparringPose(s.fighters[side], s.tick);
  if (!pose.striking) return 0;
  const target = s.fighters[side === 0 ? 1 : 0], limb = pose[pose.striking], body = sparringCapsules(sparringPose(target, s.tick)), r = pose.striking === "rightFoot" ? .12 : SPARRING_CAPSULE_RADII.glove;
  return Math.max(...[...SPARRING_HURT_PARTS, ...(guard && guardRaised(target) ? SPARRING_GUARD_PARTS : [])].map(part => body[part].r + r - pointSegDistance(limb, body[part].a, body[part].b)));
};

test("sparring-2: a landed or blocked strike stops at the struck surface instead of passing through the body", () => {
  for (const guard of [false, true]) for (const attack of SPARRING_BOXING_ATTACKS) {
    let s = close(.7), worst = 0, contact = false;
    for (let i = 0; i < 60 && !s.finished; i++) {
      s = stepSparring(s, [{ ...idle(), action: i === 0 ? attack : null }, { ...idle(), guard }]);
      contact ||= s.events.some(e => e.type === "hit" || e.type === "block");
      worst = Math.max(worst, depth(s, 0));
    }
    assert.ok(contact, `${attack}/${guard}`); assert.ok(worst <= .0025, `${attack}/${guard}: limb ${(worst * 100).toFixed(1)}cm inside a hurt volume`);
  }
});

test("sparring-2: an opponent stepping into a retracting glove shortens the limb, never overlaps or takes damage", () => {
  let s = close(.9), worst = 0;
  for (let i = 0; i < 40; i++) {
    // The defender walks forward into the jabber's recovery; only one contact may count.
    s = stepSparring(s, [{ ...idle(), action: i === 0 ? "jab" : null }, { ...idle(), moveX: i > 8 ? -1 : 0 }]);
    worst = Math.max(worst, depth(s, 0));
  }
  assert.ok(worst <= .0025, `${(worst * 100).toFixed(1)}cm`);
  assert.ok(1000 - s.fighters[1].health <= SPARRING_ATTACKS.jab.damage);
});

test("sparring-2: backpedalling is slower than advancing, and a non-attacking runner is caught and stopped", () => {
  const speedAfter = (moveX: number) => { let s = createSparring(5); for (let i = 0; i < 40; i++) s = stepSparring(s, [{ ...idle(), moveX }, idle()]); return Math.abs(s.fighters[0].vx); };
  // KOR faces +x at spawn; -x is backwards.
  assert.ok(speedAfter(1) > speedAfter(-1) * 1.45, `${speedAfter(1)} vs ${speedAfter(-1)}`);
  for (const seed of [3, 9, 27]) {
    let s = createSparring(seed, { durationSeconds: 90 }); let hits = 0;
    while (!s.finished) {
      const me = s.fighters[0], other = s.fighters[1], d = Math.max(.01, Math.hypot(other.x - me.x, other.z - me.z));
      const dx = (other.x - me.x) / d, dz = (other.z - me.z) / d;
      let mx = -dx - dz * .9 - me.x * .35, mz = -dz + dx * .9 - me.z * .35; const l = Math.max(1, Math.hypot(mx, mz)); mx /= l; mz /= l;
      s = stepSparring(s, [{ ...idle(), moveX: mx, moveZ: mz }, sparringBotInput(s, 1, "pressure")]);
      hits += s.events.filter(e => e.type === "hit" && e.actor === 1).length;
    }
    assert.ok(hits >= 5, `seed ${seed}: runner escaped with ${hits} hits taken`); assert.equal(s.winner, 1);
  }
});

test("sparring-2: single-technique jab spam does not beat the paced scripted bots", () => {
  for (const style of ["balanced", "counter"] as const) for (const seed of [2, 11]) {
    let s = createSparring(seed, { durationSeconds: 90 });
    while (!s.finished) {
      const me = s.fighters[0], other = s.fighters[1], d = Math.max(.01, Math.hypot(other.x - me.x, other.z - me.z));
      const spam: SparringInput = s.tick < me.actionUntil ? idle() : d > .95 ? { ...idle(), moveX: (other.x - me.x) / d, moveZ: (other.z - me.z) / d } : { ...idle(), action: "jab" };
      s = stepSparring(s, [spam, sparringBotInput(s, 1, style)]);
    }
    assert.equal(s.winner, 1, `${style}/${seed}`);
  }
});

test("sparring-3: boxing corners never kick, keep 0.78 m root spacing and move at boxing speeds", () => {
  const speedAfter = (moveX: number, moveZ = 0) => { let s = createSparring(5); for (let i = 0; i < 40; i++) s = stepSparring(s, [{ ...idle(), moveX, moveZ }, idle()]); return Math.hypot(s.fighters[0].vx, s.fighters[0].vz); };
  assert.ok(Math.abs(speedAfter(1) - 1.35) < 1e-9); assert.ok(Math.abs(speedAfter(-1) - .72) < 1e-9); const lateral = speedAfter(0, 1); assert.ok(lateral > .85 && lateral <= 1.0 + 1e-9, `${lateral}`); // facing keeps tracking the opponent, so a side step drifts partly backward
  for (const [a, b] of [["balanced", "pressure"], ["counter", "balanced"], ["pressure", "counter"]] as const) for (const seed of [4, 19]) {
    let s = createSparring(seed, { durationSeconds: 90 }); let minimum = Infinity; const thrown = new Set<string>();
    while (!s.finished) {
      s = stepSparring(s, [sparringBotInput(s, 0, a), sparringBotInput(s, 1, b)]);
      minimum = Math.min(minimum, Math.hypot(s.fighters[0].x - s.fighters[1].x, s.fighters[0].z - s.fighters[1].z));
      for (const e of s.events) if (e.type === "attack" && e.attack) thrown.add(e.attack);
    }
    assert.ok(!thrown.has("roundhouse"), `${a}/${b}/${seed}`); assert.ok(thrown.size >= 3); assert.ok(minimum >= .78 - 1e-9, `${minimum}`);
  }
});

test("sparring-3: boxing ruleset rejects kicks without spending stamina or starting an attack", () => {
  const s = stepSparring(close(), [{ ...idle(), action: "roundhouse" }, idle()]);
  assert.ok(s.events.some(e => e.type === "rejected" && e.reason === "ruleset" && e.attack === "roundhouse"));
  assert.equal(s.fighters[0].stamina, 1000); assert.notEqual(s.fighters[0].action, "roundhouse");
  assert.deepEqual([...SPARRING_BOXING_ATTACKS].sort(), (Object.keys(SPARRING_ATTACKS) as SparringAttack[]).filter(a => a !== "roundhouse").sort());
});

const bots = (s: SparringState) => [sparringBotInput(s, 0, "pressure"), sparringBotInput(s, 1, "balanced")] as const;
function untilEvent(state: SparringState, type: string, limit = 20000) {
  let s = state; const seen: SparringState["events"] = [];
  for (let i = 0; i < limit && !s.finished; i++) { s = stepSparring(s, bots(s)); seen.push(...s.events); if (s.events.some(e => e.type === type)) break; }
  return { s, seen };
}

test("sparring-4: a concussive knockdown starts a count; the fighter rises, the bout resumes after eight", () => {
  const initial = close(); initial.fighters[1].daze = 10_000; initial.fighters[1].health = 900;
  let s = stepSparring(initial, [idle(), idle()]);
  assert.equal(s.phase, "count"); assert.ok(s.events.some(e => e.type === "knockdown" && e.actor === 0));
  const c = s.count!; assert.equal(c.fighter, 1); assert.ok(c.standAt !== null);
  const counts: number[] = []; let rose = false;
  while (s.phase === "count") {
    s = stepSparring(s, [idle(), idle()]);
    for (const e of s.events) { if (e.type === "count") counts.push(Number(e.reason)); if (e.type === "getup") rose = true; }
    // After stepping clear (0.75 s), the standing fighter never walks over the lying body segment.
    const [bx, bz] = lyingBodyPoint(s.fighters[1], s.fighters[0].x, s.fighters[0].z);
    if (s.fighters[1].action === "knockdown" && s.tick > c.startAt + 15) assert.ok(Math.hypot(s.fighters[0].x - bx, s.fighters[0].z - bz) >= .6, `tick ${s.tick}`);
  }
  assert.ok(rose); assert.deepEqual(counts, counts.map((_, i) => i + 1)); assert.ok(counts.length >= 8 && counts.length < 10);
  assert.equal(s.phase, "fight"); assert.equal(s.fighters[1].knockdowns, 1); assert.equal(s.fighters[1].roundKnockdowns, 1);
  // The standing fighter waited in a neutral corner, away from the downed fighter.
  assert.ok(Math.hypot(s.fighters[0].x - s.fighters[1].x, s.fighters[0].z - s.fighters[1].z) > 2);
});

test("sparring-4: exhausted health drops a fighter who cannot beat the ten count (KO), and a third knockdown is a TKO", () => {
  const ko = close(); ko.fighters[0].health = 0;
  let s = stepSparring(ko, [idle(), idle()]);
  assert.equal(s.count?.standAt, null);
  while (!s.finished) s = stepSparring(s, [idle(), idle()]);
  assert.equal(s.method, "ko"); assert.equal(s.winner, 1);
  assert.ok(s.tick >= 30 + 9 * SPARRING_COUNT_TICKS, "ten full counts");
  const tko = close(); tko.fighters[1].knockdowns = 2; tko.fighters[1].daze = 10_000;
  s = stepSparring(tko, [idle(), idle()]);
  assert.equal(s.finished, true); assert.equal(s.method, "tko"); assert.equal(s.winner, 0);
});

test("sparring-4: three rounds score 10-point-must cards, rest in corners with bounded recovery, then decide", () => {
  let s = createSparring(7, { durationSeconds: 20, rounds: 3, breakSeconds: 4 });
  const breaks: { tick: number; health: [number, number] }[] = [];
  while (!s.finished) {
    const before = s; s = stepSparring(s, bots(s));
    if (before.phase !== "break" && s.phase === "break") breaks.push({ tick: s.tick, health: [s.fighters[0].health, s.fighters[1].health] });
    if (before.phase === "break" && s.phase === "fight") {
      const last = breaks.at(-1)!;
      for (const id of [0, 1] as const) { assert.ok(s.fighters[id].health <= Math.min(1000, last.health[id] + 150)); }
      // Each round starts from the fighters' own corners.
      assert.ok(Math.hypot(s.fighters[0].x + 2.6, s.fighters[0].z + 2.6) < .2 && Math.hypot(s.fighters[1].x - 2.6, s.fighters[1].z - 2.6) < .2);
    }
  }
  if (s.method === "decision" || s.method === "draw") {
    assert.equal(s.scores.length, 3); assert.equal(breaks.length, 2);
    for (const [a, b] of s.scores) { assert.ok(a <= 10 && b <= 10 && (a === 10 || b === 10 || a === b)); }
  } else assert.ok(["ko", "tko"].includes(s.method!));
});
// Referee (presentation-only official) tests live in combat-referee.test.ts.

/** Deepest trunk/head/thigh capsule overlap between the two standing bodies. */
const bodyOverlap = (s: SparringState) => {
  const [a, b] = s.fighters.map(f => sparringCapsules(sparringPose(f, s.tick)));
  let worst = -Infinity; for (const pa of SPARRING_BODY_PARTS) for (const pb of SPARRING_BODY_PARTS) worst = Math.max(worst, capsuleOverlap(a![pa], b![pb]).depth);
  return worst;
};
/**
 * How far a strike drives the glove into the defender's raised forearms/gloves beyond where that glove already
 * rests (null without a raised guard). At ~0.8 m the engine's resting gloves touch a raised guard before any punch
 * moves (arms never separate roots); that standing contact is reported by contact-audit.ts, not counted here.
 */
const guardOverlap = (s: SparringState, side: 0 | 1, rest = false) => {
  const f = s.fighters[side], pose = sparringPose(rest ? { ...f, strikeStop: 0 } : f, s.tick), target = s.fighters[side === 0 ? 1 : 0];
  if (!pose.striking || pose.striking === "rightFoot" || !guardRaised(target)) return null;
  const glove = pose[pose.striking], body = sparringCapsules(sparringPose(target, s.tick));
  const into = Math.max(...SPARRING_GUARD_PARTS.map(part => body[part].r + SPARRING_CAPSULE_RADII.glove - pointSegDistance(glove, body[part].a, body[part].b)));
  return rest ? into : into - Math.max(0, guardOverlap(s, side, true)!);
};
const STYLE_PAIRS = [["balanced", "pressure"], ["counter", "balanced"], ["pressure", "counter"], ["pressure", "balanced"], ["balanced", "counter"], ["counter", "pressure"]] as const;

test("sparring-5: 200 seeded bot bouts keep bodies apart, a raised guard stops the glove, the lying body stays clear, replay is identical", () => {
  let ticks = 0, worstBody = 0, worstGuard = 0, guardTicks = 0, worstSurface = 0, nearestLying = Infinity, counts = 0;
  const bout = (seed: number) => {
    const [a, b] = STYLE_PAIRS[seed % STYLE_PAIRS.length]!;
    let s = createSparring(seed, { durationSeconds: 15, rounds: 2, breakSeconds: 1 }); const events: SparringState["events"] = [];
    while (!s.finished) {
      s = stepSparring(s, [sparringBotInput(s, 0, a), sparringBotInput(s, 1, b)]); events.push(...s.events); ticks++;
      if (s.phase === "count" && s.count) {
        counts++; const down = s.fighters[s.count.fighter], up = s.fighters[s.count.fighter === 0 ? 1 : 0], [x, z] = lyingBodyPoint(down, up.x, up.z);
        nearestLying = Math.min(nearestLying, Math.hypot(up.x - x, up.z - z));
      } else if (!s.finished) worstBody = Math.max(worstBody, bodyOverlap(s));
      for (const side of [0, 1] as const) {
        worstSurface = Math.max(worstSurface, depth(s, side, false));
        const g = guardOverlap(s, side); if (g !== null) { guardTicks++; worstGuard = Math.max(worstGuard, g); }
      }
    }
    return JSON.stringify([s, events]);
  };
  for (let seed = 1; seed <= 200; seed++) { const tape = bout(seed); if (seed % 25 === 0) assert.equal(bout(seed), tape, `seed ${seed} replay`); }
  assert.ok(worstBody <= .002, `trunk/head/thigh capsules overlap ${(worstBody * 100).toFixed(2)} cm`);
  assert.ok(guardTicks > 1000 && worstGuard <= .005, `glove ${(worstGuard * 100).toFixed(2)} cm inside a raised guard (${guardTicks} ticks)`);
  assert.ok(worstSurface <= .0025, `glove ${(worstSurface * 100).toFixed(2)} cm inside head/torso`);
  assert.ok(counts > 100 && nearestLying >= .53 - 1e-6, `standing footprint ${nearestLying.toFixed(3)} m from the lying body (${counts} count ticks)`);
  assert.ok(ticks > 300_000);
});

test("sparring-5: a raised guard is solid and blocks on the forearms/gloves; idle hands are not a shield", () => {
  for (const attack of SPARRING_BOXING_ATTACKS) {
    let s = close(.84), blocked = 0, worst = -Infinity, head = -Infinity;
    for (let i = 0; i < 45 && !s.finished; i++) {
      s = stepSparring(s, [{ ...idle(), action: i === 0 ? attack : null }, { ...idle(), guard: true }]);
      blocked += s.events.filter(e => e.type === "block").length;
      const g = guardOverlap(s, 0); if (g !== null) worst = Math.max(worst, g);
      const p = sparringPose(s.fighters[0], s.tick), h = sparringCapsules(sparringPose(s.fighters[1], s.tick)).head;
      if (p.striking === "leftHand" || p.striking === "rightHand") head = Math.max(head, h.r + SPARRING_CAPSULE_RADII.glove - pointSegDistance(p[p.striking], h.a, h.b));
    }
    assert.equal(blocked, 1, attack); assert.ok(worst <= .005, `${attack}: ${worst}`); assert.ok(head < 0, `${attack}: the blocked glove reached the face (${head})`);
    const open = run(close(.84), 45, i => [{ ...idle(), action: i === 0 ? attack : null }, idle()]);
    assert.equal(open.events.filter(e => e.type === "hit").length, 1, `${attack} into idle hands`);
  }
});

test("sparring-5: pressing square-on cannot push the lead legs through each other", () => {
  let s = close(1.4), nearest = Infinity;
  for (let i = 0; i < 180; i++) {
    s = stepSparring(s, [{ ...idle(), moveX: 1 }, { ...idle(), moveX: -1 }]);
    assert.ok(bodyOverlap(s) <= .002, `tick ${s.tick}`);
    nearest = Math.min(nearest, Math.hypot(s.fighters[0].x - s.fighters[1].x, s.fighters[0].z - s.fighters[1].z));
  }
  // Lead thighs (fitted r 0.15, 0.25 m ahead of each root) meet at ~0.80 m, just beyond the 0.78 m root floor.
  assert.ok(nearest > .79 && nearest < .82, `${nearest}`);
  assert.ok(Math.abs(s.fighters[0].z) < 1e-9 && Math.abs(s.fighters[1].z) < 1e-9, "square-on contact pushes along the root line");
});

test("sparring-5: a standing fighter put on top of the lying body is moved clear of it, inside the ropes", () => {
  const initial = close(); initial.fighters[1].daze = 10_000; initial.fighters[1].health = 900;
  let s = stepSparring(initial, [idle(), idle()]);
  assert.equal(s.phase, "count");
  const down = s.fighters[1], up = s.fighters[0], ux = Math.sin(down.facing), uz = Math.cos(down.facing);
  up.x = down.x - ux * 1.2; up.z = down.z - uz * 1.2; // on the chest of the lying body
  s = stepSparring(s, [idle(), idle()]);
  const [x, z] = lyingBodyPoint(s.fighters[1], s.fighters[0].x, s.fighters[0].z);
  assert.ok(Math.hypot(s.fighters[0].x - x, s.fighters[0].z - z) >= .53 - 1e-6);
  for (const f of s.fighters) { assert.ok(Math.abs(f.x) <= 3.15 && Math.abs(f.z) <= 3.15); }
});
