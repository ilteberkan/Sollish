import assert from "node:assert/strict";
import test from "node:test";
import { capsuleOverlap, pointSegDistance, segSegClosest, segSegDistance, sparringCapsules, sweepSphereCapsule, SPARRING_CAPSULE_PARTS, SPARRING_CAPSULE_RADII, type SparringCapsule } from "../src/combat-capsules";
import { createSparring, sparringPose, type SparringVec3 } from "../src/combat-sparring";

const v = (x: number, y: number, z: number): SparringVec3 => ({ x, y, z });
// Deterministic test data (LCG); no Math.random.
let state = 12345; const rand = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const rv = () => v(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
const at = (a: SparringVec3, b: SparringVec3, t: number) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const brute = (p1: SparringVec3, q1: SparringVec3, p2: SparringVec3, q2: SparringVec3) => {
  let best = Infinity;
  for (let i = 0; i <= 200; i++) { const a = at(p1, q1, i / 200); best = Math.min(best, pointSegDistance(a, p2, q2)); }
  return best;
};

test("segment distance matches known cases, is symmetric and never exceeds brute force", () => {
  assert.equal(segSegDistance(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0), v(1, 1, 0)), 1); // parallel
  assert.ok(Math.abs(segSegDistance(v(-1, 0, 0), v(1, 0, 0), v(0, -1, .5), v(0, 1, .5)) - .5) < 1e-12); // crossing
  assert.ok(Math.abs(segSegDistance(v(0, 0, 0), v(0, 0, 0), v(2, 0, 0), v(3, 0, 0)) - 2) < 1e-12); // point vs segment
  assert.equal(segSegDistance(v(1, 2, 3), v(1, 2, 3), v(1, 2, 3), v(1, 2, 3)), 0); // degenerate
  for (let i = 0; i < 300; i++) {
    const [p1, q1, p2, q2] = [rv(), rv(), rv(), rv()], d = segSegDistance(p1, q1, p2, q2), k = segSegClosest(p1, q1, p2, q2);
    assert.ok(Math.abs(d - segSegDistance(p2, q2, p1, q1)) < 1e-9, "symmetric");
    assert.ok(d <= brute(p1, q1, p2, q2) + 1e-9 && d >= brute(p1, q1, p2, q2) - .02, `case ${i}`);
    assert.ok(k.s >= 0 && k.s <= 1 && k.t >= 0 && k.t <= 1);
  }
});

test("capsule overlap depth and normal are consistent and deterministic", () => {
  const a: SparringCapsule = { part: "torso", a: v(0, 0, 0), b: v(0, 1, 0), r: .2 }, b: SparringCapsule = { part: "torso", a: v(.3, .5, 0), b: v(.3, 1.5, 0), r: .2 };
  const o = capsuleOverlap(a, b);
  assert.ok(Math.abs(o.depth - .1) < 1e-12); assert.deepEqual(o.normal, v(1, 0, 0));
  assert.deepEqual(capsuleOverlap(a, b), o);
  assert.equal(capsuleOverlap(a, { ...b, a: v(0, .5, 0), b: v(0, .5, 0) }).normal, null); // axes touch: caller picks the push direction
});

test("swept glove sphere finds the first contact against a moving capsule, without tunnelling", () => {
  const still: SparringCapsule = { part: "head", a: v(0, 1.65, 0), b: v(0, 1.65, 0), r: .135 };
  assert.equal(sweepSphereCapsule(v(0, 1.65, .1), v(0, 1.65, 1), still, still, .12), 0); // already touching
  assert.equal(sweepSphereCapsule(v(1, 1.65, 1), v(1, 1.65, 2), still, still, .12), null); // misses
  // A fast glove crossing the head inside one tick (2 m per tick) is still caught at its first touch.
  const t = sweepSphereCapsule(v(-1, 1.65, 0), v(1, 1.65, 0), still, still, .12)!;
  assert.ok(Math.abs(t - (1 - .255) / 2) < 1e-5, `${t}`);
  // A capsule moving into a static glove path: contact time agrees with dense brute force.
  for (let i = 0; i < 40; i++) {
    const p0 = rv(), p1 = rv(), c0: SparringCapsule = { part: "torso", a: rv(), b: rv(), r: .1 + rand() * .1 }, shift = rv(), c1 = { ...c0, a: v(c0.a.x + shift.x * .3, c0.a.y + shift.y * .3, c0.a.z + shift.z * .3), b: v(c0.b.x + shift.x * .3, c0.b.y + shift.y * .3, c0.b.z + shift.z * .3) };
    let expected: number | null = null;
    for (let k = 0; k <= 4000; k++) { const s = k / 4000; if (pointSegDistance(at(p0, p1, s), at(c0.a, c1.a, s), at(c0.b, c1.b, s)) <= .1 + c1.r) { expected = s; break; } }
    const got = sweepSphereCapsule(p0, p1, c0, c1, .1);
    if (expected === null) assert.equal(got, null, `case ${i}`); else assert.ok(got !== null && Math.abs(got - expected) < 1e-3, `case ${i}: ${got} vs ${expected}`);
  }
});

test("sparring capsules are built from the authoritative pose with the fitted radii", () => {
  const s = createSparring(3), caps = sparringCapsules(sparringPose(s.fighters[0], 0)), R = SPARRING_CAPSULE_RADII;
  assert.deepEqual(Object.keys(caps).sort(), [...SPARRING_CAPSULE_PARTS].sort());
  assert.equal(caps.torso.r, R.torso); assert.equal(caps.head.r, R.head); assert.equal(caps.gloveL.r, R.glove); assert.equal(caps.thighR.r, R.thigh);
  assert.ok(caps.head.a.y > caps.torso.b.y && caps.torso.a.y > caps.thighL.b.y, "head above trunk above knees");
  // Lead thigh on the centre line, ending 3/4 of the way to the knee 0.31 m ahead (fighter 0 faces +x).
  assert.ok(Math.abs(caps.thighL.b.x - (s.fighters[0].x + .25)) < 1e-9 && Math.abs(caps.thighL.b.z - s.fighters[0].z) < 1e-9);
});
