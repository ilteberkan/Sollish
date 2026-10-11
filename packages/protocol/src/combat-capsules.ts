/**
 * sparring-5 body model for the non-monetary Combat Club engine: capsules built from the authoritative
 * sparringPose points. Pure, deterministic geometry (fixed branch order, fixed iteration counts, no
 * randomness or clock). Radii are fitted from the rendered fightkit-v1 rig at scale 1.05 (90th-percentile
 * skin distance, weight > 0.5; apps/web/components/boxing-contact-capsules.json) and rounded; the plan's
 * pre-fit estimates were torso .17, head .12, upper arm .06, forearm .055, glove .095, thigh .08.
 * A capsule body is a simplified contact volume, not a triangle mesh or a physics simulation.
 */
import type { SparringPose, SparringVec3 } from "./combat-sparring";

export type SparringCapsulePart = "torso" | "head" | "upperArmL" | "upperArmR" | "forearmL" | "forearmR" | "gloveL" | "gloveR" | "thighL" | "thighR";
/** Segment a→b swept by radius r (a sphere when a equals b). */
export type SparringCapsule = { part: SparringCapsulePart; a: SparringVec3; b: SparringVec3; r: number };
export type SparringCapsules = Readonly<Record<SparringCapsulePart, SparringCapsule>>;

export const SPARRING_CAPSULE_RADII = Object.freeze({ torso: .19, head: .135, upperArm: .12, forearm: .08, glove: .12, thigh: .15 });
export const SPARRING_CAPSULE_PARTS: readonly SparringCapsulePart[] = Object.freeze(["torso", "head", "upperArmL", "upperArmR", "forearmL", "forearmR", "gloveL", "gloveR", "thighL", "thighR"]);
/** Root separation uses the trunk, head and thighs; arms never push a fighter's root. */
export const SPARRING_BODY_PARTS: readonly SparringCapsulePart[] = Object.freeze(["torso", "head", "thighL", "thighR"]);
/** Damage volumes. */
export const SPARRING_HURT_PARTS: readonly SparringCapsulePart[] = Object.freeze(["head", "torso"]);
/** Guard volumes: solid to strikes while the defender holds a block (see combat-sparring.ts guardUp). */
export const SPARRING_GUARD_PARTS: readonly SparringCapsulePart[] = Object.freeze(["forearmL", "forearmR", "gloveL", "gloveR"]);

export function sparringCapsules(pose: SparringPose): SparringCapsules {
  const R = SPARRING_CAPSULE_RADII, c = (part: SparringCapsulePart, a: SparringVec3, b: SparringVec3, r: number): SparringCapsule => ({ part, a, b, r });
  return {
    torso: c("torso", pose.pelvis, pose.chest, R.torso), head: c("head", pose.head, pose.head, R.head),
    upperArmL: c("upperArmL", pose.leftShoulder, pose.leftElbow, R.upperArm), upperArmR: c("upperArmR", pose.rightShoulder, pose.rightElbow, R.upperArm),
    forearmL: c("forearmL", pose.leftElbow, pose.leftHand, R.forearm), forearmR: c("forearmR", pose.rightElbow, pose.rightHand, R.forearm),
    gloveL: c("gloveL", pose.leftHand, pose.leftHand, R.glove), gloveR: c("gloveR", pose.rightHand, pose.rightHand, R.glove),
    thighL: c("thighL", pose.leftHip, toward(pose.leftHip, pose.leftKnee, THIGH_SPAN), R.thigh), thighR: c("thighR", pose.rightHip, toward(pose.rightHip, pose.rightKnee, THIGH_SPAN), R.thigh),
  };
}
/** The rendered thigh keeps its 0.15 m radius over the first 75 % of hip→knee and tapers to ~0.09 m at the knee;
 * a capsule ending at 75 % reaches as far forward as the real knee without inflating it (fit: thigh_l/r quarters). */
const THIGH_SPAN = .75;
const toward = (a: SparringVec3, b: SparringVec3, t: number): SparringVec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

const EPS = 1e-12;
const clamp01 = (n: number) => n < 0 ? 0 : n > 1 ? 1 : n;
const dot = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => ax * bx + ay * by + az * bz;
/** Closest points of segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9); s, t are the segment parameters. */
export function segSegClosest(p1: SparringVec3, q1: SparringVec3, p2: SparringVec3, q2: SparringVec3): { distance: number; s: number; t: number; c1: SparringVec3; c2: SparringVec3 } {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z, d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = dot(d1x, d1y, d1z, d1x, d1y, d1z), e = dot(d2x, d2y, d2z, d2x, d2y, d2z), f = dot(d2x, d2y, d2z, rx, ry, rz);
  let s = 0, t = 0;
  if (a > EPS || e > EPS) {
    if (a <= EPS) t = clamp01(f / e);
    else {
      const c = dot(d1x, d1y, d1z, rx, ry, rz);
      if (e <= EPS) s = clamp01(-c / a);
      else {
        const b = dot(d1x, d1y, d1z, d2x, d2y, d2z), denom = a * e - b * b;
        // Parallel segments (denom 0) take s = 0; any point is closest, the choice only has to be fixed.
        s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
      }
    }
  }
  const c1 = { x: p1.x + d1x * s, y: p1.y + d1y * s, z: p1.z + d1z * s }, c2 = { x: p2.x + d2x * t, y: p2.y + d2y * t, z: p2.z + d2z * t };
  return { distance: Math.hypot(c2.x - c1.x, c2.y - c1.y, c2.z - c1.z), s, t, c1, c2 };
}
export const segSegDistance = (p1: SparringVec3, q1: SparringVec3, p2: SparringVec3, q2: SparringVec3) => segSegClosest(p1, q1, p2, q2).distance;
export const pointSegDistance = (p: SparringVec3, a: SparringVec3, b: SparringVec3) => segSegClosest(p, p, a, b).distance;

/** depth > 0 means the capsules interpenetrate; normal points from a toward b (null when the axes touch). */
export function capsuleOverlap(a: SparringCapsule, b: SparringCapsule): { depth: number; normal: SparringVec3 | null; ca: SparringVec3; cb: SparringVec3 } {
  const k = segSegClosest(a.a, a.b, b.a, b.b), d = k.distance;
  return { depth: a.r + b.r - d, normal: d > 1e-9 ? { x: (k.c2.x - k.c1.x) / d, y: (k.c2.y - k.c1.y) / d, z: (k.c2.z - k.c1.z) / d } : null, ca: k.c1, cb: k.c2 };
}

const lerp = (a: SparringVec3, b: SparringVec3, t: number): SparringVec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const len = (a: SparringVec3, b: SparringVec3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const SWEEP_TOUCH = 1e-6, SWEEP_STEPS = 256;
/**
 * Earliest t in [0, 1] at which a sphere (radius r) moving p0→p1 touches a capsule moving c0→c1 (endpoints
 * interpolated linearly, so translation and limb rotation between ticks are both covered). 0 when already
 * touching, null when no contact. Conservative advancement: the gap shrinks no faster than the sphere speed
 * plus the faster capsule endpoint, so stepping by gap/speed can never pass a first contact (no tunnelling).
 * Fixed iteration cap, so it is deterministic; a graze still unresolved at the cap is at most 0.1 mm deep.
 */
export function sweepSphereCapsule(p0: SparringVec3, p1: SparringVec3, c0: SparringCapsule, c1: SparringCapsule, r: number): number | null {
  const gap = (t: number) => pointSegDistance(lerp(p0, p1, t), lerp(c0.a, c1.a, t), lerp(c0.b, c1.b, t)) - (r + c1.r);
  const speed = len(p0, p1) + Math.max(len(c0.a, c1.a), len(c0.b, c1.b));
  let t = 0;
  for (let i = 0; i < SWEEP_STEPS; i++) {
    const g = gap(t);
    if (g <= SWEEP_TOUCH) return t;
    if (speed < 1e-12) return null;
    t += g / speed;
    if (t > 1) return null;
  }
  return gap(t) <= 1e-4 ? t : null;
}
