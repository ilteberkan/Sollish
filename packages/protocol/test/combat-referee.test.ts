import assert from "node:assert/strict";
import test from "node:test";
import { createSparring, sparringBotInput, sparringPose, stepSparring, SPARRING_HZ, SPARRING_NEUTRAL_INPUT, type SparringFighter, type SparringState } from "../src/combat-sparring";
import { createSparringReferee, stepSparringReferee, type RefereeWorld } from "../src/combat-referee";

// sparring-5 official: presentation-only steering. The full 30-bout audit lives in
// experiments/combat-sparring-audit/referee-audit.ts; these are the fast unit guarantees.
const idle = () => ({ ...SPARRING_NEUTRAL_INPUT });
const SHORT = { durationSeconds: 30, rounds: 2, breakSeconds: 3 } as const;
const PAIRS = [["pressure", "balanced"], ["counter", "pressure"], ["balanced", "counter"]] as const;
const bots = (pair: readonly [string, string]) => (s: SparringState) => [sparringBotInput(s, 0, pair[0] as "balanced"), sparringBotInput(s, 1, pair[1] as "balanced")] as const;
const down = (f: SparringFighter) => f.action === "knockdown" || f.action === "getup";
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const toSegment = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
/** Ground-plane clearance from the official's root to a fighter: pose segments standing, the lying segment when down. */
function clearance(s: SparringState, f: SparringFighter) {
  const r = s.referee;
  if (down(f)) { const ux = Math.sin(f.facing), uz = Math.cos(f.facing); return toSegment(r.x, r.z, f.x - ux * 1.85, f.z - uz * 1.85, f.x + ux * .15, f.z + uz * .15); }
  const p = sparringPose(f, s.tick);
  return Math.min(...(["head", "leftHand", "rightHand", "leftKnee", "rightKnee"] as const).map(end => toSegment(r.x, r.z, p.pelvis.x, p.pelvis.z, p[end].x, p[end].z)));
}
const sideOf = (s: SparringState, x: number, z: number) => { const [a, b] = s.fighters; return Math.sign((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)); };
/** Moving from p to the current position crossed the segment between the fighters. */
function crossed(previous: SparringState, s: SparringState) {
  const [a, b] = s.fighters, r = s.referee, p = previous.referee;
  const t = ((r.x - a.x) * (b.x - a.x) + (r.z - a.z) * (b.z - a.z)) / Math.max(1e-9, (b.x - a.x) ** 2 + (b.z - a.z) ** 2);
  return sideOf(previous, p.x, p.z) * sideOf(s, r.x, r.z) < 0 && t >= 0 && t <= 1;
}

// Frozen sparring-4 official (experiments/combat-sparring-audit/referee-sparring4.ts), used as the "old referee".
type OldReferee = { x: number; z: number; facing: number; vx: number; vz: number };
function oldReferee(previous: OldReferee, s: SparringState): OldReferee {
  const r = { ...previous }, [a, b] = s.fighters, x0 = r.x, z0 = r.z, clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  let tx: number, tz: number, fx: number, fz: number;
  if (s.phase === "count" && s.count) {
    const dn = s.fighters[s.count.fighter], up = s.fighters[s.count.fighter === 0 ? 1 : 0], dx = up.x - dn.x, dz = up.z - dn.z, d = Math.max(.01, Math.hypot(dx, dz));
    tx = dn.x + dx / d; tz = dn.z + dz / d; fx = dn.x; fz = dn.z;
  } else if (s.phase === "break") { tx = 0; tz = 0; fx = 0; fz = 1; }
  else {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, ax = b.x - a.x, az = b.z - a.z, d = Math.max(.01, Math.hypot(ax, az));
    let px = -az / d, pz = ax / d; if (pz > 0 || (Math.abs(pz) < .2 && (r.x - mx) * px < 0)) { px = -px; pz = -pz; }
    tx = mx + px * 1.7; tz = mz + pz * 1.7; fx = mx; fz = mz;
  }
  tx = clamp(tx, -2.95, 2.95); tz = clamp(tz, -2.95, 2.95);
  const dx = tx - r.x, dz = tz - r.z, dd = Math.hypot(dx, dz), step = Math.min(dd, 1.7 / SPARRING_HZ);
  if (dd > 1e-6) { r.x += dx / dd * step; r.z += dz / dd * step; }
  for (const f of s.fighters) { const ex = r.x - f.x, ez = r.z - f.z, e = Math.hypot(ex, ez); if (e < .9) { const k = e > 1e-6 ? .9 / e : 0; r.x = f.x + (k ? ex * k : .9); r.z = f.z + (k ? ez * k : 0); } }
  r.x = clamp(r.x, -3, 3); r.z = clamp(r.z, -3, 3); r.facing = Math.atan2(fx - r.x, fz - r.z); r.vx = (r.x - x0) * SPARRING_HZ; r.vz = (r.z - z0) * SPARRING_HZ;
  return r;
}

test("fighters, events and results are identical whichever official walks the ring", () => {
  for (const pair of PAIRS) {
    const decide = bots(pair);
    let mine = createSparring(11, SHORT), theirs = createSparring(11, SHORT), old: OldReferee = { ...createSparringReferee() };
    while (!mine.finished) {
      mine = stepSparring(mine, decide(mine));
      // The second rollout carries the sparring-4 official's trajectory in state.referee every tick.
      theirs = stepSparring(theirs, decide(theirs)); old = oldReferee(old, theirs); theirs = { ...theirs, referee: { ...theirs.referee, ...old } };
      assert.equal(JSON.stringify({ ...mine, referee: null }), JSON.stringify({ ...theirs, referee: null }), `${pair} tick ${mine.tick}`);
    }
    assert.ok(mine.tick > 2000);
  }
});

test("the official step reads a frozen world and never mutates it or the previous state", () => {
  const s = createSparring(5); s.fighters[1].action = "knockdown";
  const deepFreeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
  const view = (f: SparringFighter) => deepFreeze({ x: f.x, z: f.z, vx: f.vx, vz: f.vz, facing: f.facing, down: down(f), lying: down(f) ? [f.x, f.z, f.x + .1, f.z] as const : null, risk: 0, goal: null, pose: () => deepFreeze(sparringPose(f, s.tick)) });
  const world: RefereeWorld = deepFreeze({ tick: 1, phase: "count", countFighter: 1, fighters: [view(s.fighters[0]), view(s.fighters[1])] as const });
  const previous = deepFreeze(createSparringReferee()), before = JSON.stringify(previous);
  const next = stepSparringReferee(previous, world);
  assert.equal(JSON.stringify(previous), before); assert.notEqual(next, previous);
});

test("full bot bouts: clearance from pose and lying segments, no crossing, bounded motion, replayable", () => {
  for (const [index, pair] of PAIRS.entries()) {
    const decide = bots(pair);
    const run = () => {
      let s = createSparring(40 + index, SHORT), minStanding = Infinity, minLying = Infinity;
      while (!s.finished) {
        const previous = s; s = stepSparring(s, decide(s));
        const r = s.referee, p = previous.referee, vx = (r.x - p.x) * SPARRING_HZ, vz = (r.z - p.z) * SPARRING_HZ;
        for (const f of s.fighters) { const c = clearance(s, f); if (down(f)) minLying = Math.min(minLying, c); else minStanding = Math.min(minStanding, c); }
        if (s.phase === "fight" && previous.phase === "fight") assert.ok(!crossed(previous, s), `${pair} crossed between the fighters at ${s.tick}`);
        assert.ok(Math.abs(wrap(r.facing - p.facing)) <= .05 + 1e-9, `yaw step ${s.tick}`);
        assert.ok(Math.hypot(r.x - p.x, r.z - p.z) <= .025, `position step ${s.tick}`);
        assert.ok(Math.hypot(vx - p.vx, vz - p.vz) <= 4 / SPARRING_HZ + 1e-9, `velocity step ${s.tick}`);
        assert.ok(Math.abs(r.vx - vx) < 1e-9 && Math.abs(r.vz - vz) < 1e-9, "velocity is the actual displacement");
        assert.ok(Math.abs(r.x) <= 2.9 && Math.abs(r.z) <= 2.9);
      }
      return { s, minStanding, minLying };
    };
    const first = run(), second = run();
    assert.ok(first.minStanding >= .55, `${pair} standing clearance ${first.minStanding}`);
    assert.ok(first.minLying >= .6, `${pair} lying clearance ${first.minLying}`);
    assert.equal(JSON.stringify(first.s), JSON.stringify(second.s), "replay must be identical, official included");
  }
});

test("during a knockdown count the official stands beside the lying body facing it, clear of both fighters", () => {
  const initial = createSparring(17); initial.fighters[0].x = -.43; initial.fighters[1].x = .43; initial.fighters[1].daze = 10_000; initial.fighters[1].health = 900;
  let s = stepSparring(initial, [idle(), idle()]);
  assert.equal(s.phase, "count");
  let beside = 0;
  while (s.phase === "count") {
    s = stepSparring(s, [idle(), idle()]);
    assert.ok(clearance(s, s.fighters[1]) >= .6 && clearance(s, s.fighters[0]) >= .55, `count tick ${s.tick}`);
    const f = s.fighters[1], ux = Math.sin(f.facing), uz = Math.cos(f.facing), body = clearance(s, f);
    const head = Math.atan2(f.x - ux * 1.45 - s.referee.x, f.z - uz * 1.45 - s.referee.z);
    if (s.count && s.count.n >= 3 && down(f)) { assert.ok(body < 1.4, `beside the body ${body}`); assert.ok(Math.abs(wrap(head - s.referee.facing)) < .5, "facing the downed fighter"); beside++; }
  }
  assert.ok(beside > 30);
});

test("an unusable side flips only after 30 blocked ticks and he walks around the outside, never between", () => {
  const s0 = createSparring(3); s0.fighters[0].x = -.45; s0.fighters[1].x = .45;
  // Camera side (+z) of fighters facing along x: no usable spot on this side.
  s0.referee = { ...s0.referee, x: 0, z: 2.0, side: 1, mode: "fight" };
  let s = s0, flippedAt = -1, minRadius = Infinity, minStanding = Infinity;
  for (let i = 0; i < 480; i++) {
    const previous = s; s = stepSparring(s, [idle(), idle()]);
    if (flippedAt < 0 && s.referee.side === -1) flippedAt = s.tick;
    if (flippedAt < 0) assert.equal(s.referee.side, 1);
    assert.ok(!crossed(previous, s), `crossed at ${s.tick}`);
    minRadius = Math.min(minRadius, Math.hypot(s.referee.x, s.referee.z)); minStanding = Math.min(...s.fighters.map(f => clearance(s, f)), minStanding);
  }
  assert.equal(flippedAt, 30);
  assert.ok(minRadius >= 1.5 && minStanding >= .55, `${minRadius} ${minStanding}`);
  assert.ok(s.referee.z < -1.2 && Math.hypot(s.referee.vx, s.referee.vz) < .2, `settled behind the fighters ${s.referee.x} ${s.referee.z}`);
});

test("gait odometer accumulates the path he actually walked in his own frame", () => {
  let s = createSparring(23, SHORT), path = 0;
  const decide = bots(PAIRS[0]);
  while (!s.finished) { const p = s.referee; s = stepSparring(s, decide(s)); path += Math.hypot(s.referee.x - p.x, s.referee.z - p.z); }
  const r = s.referee, total = r.travelF + r.travelB + r.travelL + r.travelR;
  assert.ok(path > 5 && total >= path - 1e-6 && total <= path * Math.SQRT2 + 1e-6, `${total} vs ${path}`);
});
