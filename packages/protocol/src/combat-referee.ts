/**
 * Presentation-only official for the non-monetary sparring engine. The referee reads public
 * positions, poses and who is down; fighters never read him and he can never change contact,
 * damage, scoring or the result. Deterministic and tick-based (no Math.random, no wall clock).
 *
 * sparring-5 steering (sparring-4 lives in experiments/combat-sparring-audit/referee-sparring4.ts):
 * he works from one side of the fighters' axis and changes side only after 30 blocked ticks, walking
 * around the outside (arc radius ≥ 1.9 m), never between them; he keeps a smooth clearance from their
 * pose segments (1.25 m comfort) and from a lying body (0.9 m comfort) instead of being pushed out in
 * one tick; acceleration ≤ 4 m/s², speed ≤ 1.4 m/s, turn rate ≤ 3 rad/s with a 0.05 rad dead zone.
 * The broadcast camera looks from +z, so his spots lie behind the fighters where they do not hide him.
 */
import type { SPARRING_HZ, SparringPose, SparringSide, SparringState } from "./combat-sparring";

export type SparringReferee = {
  x: number; z: number; facing: number;
  /** m/s: this tick's displacement × 60. Acceleration-limited, so the renderer may extrapolate sub-tick. */
  vx: number; vz: number;
  /** rad/s: this tick's facing change × 60, likewise for sub-tick facing. */
  turn: number;
  /** Side of the fighter axis a→b he works from (+1 left, -1 right); during a count, side of the lying body. */
  side: 1 | -1;
  /** Consecutive ticks the current side has had no usable spot (camera side, ropes). */
  blocked: number;
  /** Walking around the fighters or a lying body: +1/-1 = increasing/decreasing bearing atan2(x, z); 0 straight. */
  orbit: 1 | -1 | 0;
  /** Phase he last planned for; a change re-picks his side from where he stands, so he never cuts across. */
  mode: "fight" | "count" | "break";
  /** Odometer (m) in his own frame: forward, back, left, right. The renderer derives the gait phase from it. */
  travelF: number; travelB: number; travelL: number; travelR: number;
};
/** One fighter as the official sees it. pose() is lazily evaluated (it is not needed every tick). */
export type RefereeFighterView = {
  x: number; z: number; vx: number; vz: number; facing: number;
  /** On the canvas (knockdown) or rising (getup). */
  down: boolean;
  /** Ground segment [x0, z0, x1, z1] of a lying body (see lyingBodyPoint), null while standing. */
  lying: readonly [number, number, number, number] | null;
  /** 0..1: how close he is to a knockdown (concussion share of the threshold, or low health). */
  risk: number;
  /** Where the engine is walking him (his corner between rounds, a neutral corner during a count), else null. */
  goal: readonly [number, number] | null;
  pose: () => SparringPose;
};
export type RefereeWorld = {
  tick: number; phase: SparringState["phase"];
  /** The fighter being counted, only while phase === "count". */
  countFighter: SparringSide | null;
  fighters: readonly [RefereeFighterView, RefereeFighterView];
};

const HZ: typeof SPARRING_HZ = 60;
const VMAX = 1.4, SIDE_MAX = 1.0, BACK_MAX = .9, ACCEL = 4, BRAKE = 3, TURN_MAX = 3, TURN_ACCEL = 30, TURN_GAIN = 6, DEAD_ZONE = .05;
const SLOT = 2.0, SLOT_MIN = 1.5, ARC = 1.9, BOX = 2.75, HARD_BOX = 2.9, FLIP_TICKS = 30, ENGAGED = 2.6, NEUTRAL = 1.9;
const STAND_COMFORT = 1.25, STAND_HARD = .6, LIE_COMFORT = .9, LIE_HARD = .6, CORRIDOR = 1.0, PREDICT = .4, RISKY = .2;
// A spot must lie at least this far behind (-z) the fighters' midpoint direction: the broadcast camera sits in +z.
const CAMERA_Z = -.1, DEG5 = Math.PI / 36;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (n: number) => { const t = clamp(n, 0, 1); return t * t * (3 - 2 * t); };
const inBox = (x: number, z: number) => Math.abs(x) <= BOX && Math.abs(z) <= BOX;
type Point = { x: number; z: number };
type Clearance = { d: number; nx: number; nz: number };

export const createSparringReferee = (): SparringReferee => ({ x: 0, z: -1.6, facing: 0, vx: 0, vz: 0, turn: 0, side: -1, blocked: 0, orbit: 0, mode: "fight", travelF: 0, travelB: 0, travelL: 0, travelR: 0 });

/** Ground-plane clearance from p to segment a→b, with the outward normal. */
function toSegment(p: Point, ax: number, az: number, bx: number, bz: number): Clearance {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 1e-12 ? clamp(((p.x - ax) * dx + (p.z - az) * dz) / l, 0, 1) : 0;
  const ex = p.x - ax - dx * t, ez = p.z - az - dz * t, d = Math.hypot(ex, ez);
  return d > 1e-9 ? { d, nx: ex / d, nz: ez / d } : { d, nx: -dz / Math.max(1e-9, Math.sqrt(l)) || 0, nz: dx / Math.max(1e-9, Math.sqrt(l)) || -1 };
}
/** Clearance to a fighter shifted by `ahead` seconds of his velocity: pose segments standing, the lying segment when down. */
function clearance(f: RefereeFighterView, p: Point, ahead: number): Clearance {
  const ox = f.vx * ahead, oz = f.vz * ahead;
  if (f.lying) return toSegment(p, f.lying[0] + ox, f.lying[1] + oz, f.lying[2] + ox, f.lying[3] + oz);
  const pose = f.pose(), from = pose.pelvis;
  let best: Clearance = { d: Infinity, nx: 0, nz: -1 };
  for (const end of [pose.head, pose.leftHand, pose.rightHand, pose.leftKnee, pose.rightKnee]) {
    const c = toSegment(p, from.x + ox, from.z + oz, end.x + ox, end.z + oz); if (c.d < best.d) best = c;
  }
  return best;
}
/** Which side of the axis a→b the point is on; on the line, the side away from the broadcast camera. */
function sideOf(p: Point, a: Point, b: Point): 1 | -1 {
  const ux = b.x - a.x, uz = b.z - a.z, c = ux * (p.z - (a.z + b.z) / 2) - uz * (p.x - (a.x + b.x) / 2);
  return Math.abs(c) > 1e-6 ? (c > 0 ? 1 : -1) : ux >= 0 ? -1 : 1; // perpendicular (-uz, ux)·s has z = s·ux
}
/**
 * Best spot on one side of the fighters: up to ±45° from the perpendicular, 1.5–2 m from their midpoint,
 * inside the ropes, behind the midpoint as seen from the camera, and not hidden by a nearer fighter.
 * strict=false drops the camera rule (both sides blocked, e.g. the fighters on the far ropes).
 */
function fightSpot(r: Point, a: Point, b: Point, side: 1 | -1, strict: boolean): Point | null {
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, d = Math.max(.01, Math.hypot(b.x - a.x, b.z - a.z)), ux = (b.x - a.x) / d, uz = (b.z - a.z) / d;
  const base = Math.atan2(-uz * side, ux * side), here = Math.atan2(r.x - mx, r.z - mz), cx = mx + .25, cz = mz + 3.4;
  let best: Point | null = null, bestCost = Infinity;
  const near = [a, b].map(f => ({ depth: cz - f.z, bearing: Math.atan2(f.x - cx, cz - f.z), half: Math.atan(.32 / Math.max(.3, cz - f.z)) }));
  for (let k = -9; k <= 9; k++) {
    const alpha = base + k * DEG5, dx = Math.sin(alpha), dz = Math.cos(alpha);
    if (strict && dz > CAMERA_Z) continue;
    const reach = (m: number, v: number) => v > 1e-9 ? (BOX - m) / v : v < -1e-9 ? (-BOX - m) / v : Infinity;
    const radius = Math.min(SLOT, reach(mx, dx), reach(mz, dz));
    if (radius < SLOT_MIN) continue;
    const x = mx + dx * radius, z = mz + dz * radius, depth = cz - z;
    // Broadcast proxy: angular gap to each fighter nearer the camera (half-widths 0.32 m and 0.25 m).
    let hidden = 0;
    const bearing = Math.atan2(x - cx, depth), own = Math.atan(.25 / depth);
    for (const f of near) if (f.depth < depth && f.depth >= .3) hidden += Math.max(0, .08 - (Math.abs(angle(bearing - f.bearing)) - f.half - own));
    // Off the ropes where possible (pinned there, he cannot step out of a walking fighter's way); when no spot
    // satisfies the camera rule, the least camera-side one.
    const cost = Math.abs(k) / 9 + hidden * 12 + Math.abs(angle(alpha - here)) / Math.PI * .6 + (SLOT - radius) * .5 + Math.max(0, .5 - BOX + Math.max(Math.abs(x), Math.abs(z))) * 2 + Math.max(0, dz - CAMERA_Z) * 3;
    if (cost < bestCost) { bestCost = cost; best = { x, z }; }
  }
  return best;
}
/** Downed fighter's mid-body point, axis and the spot beside it on one side (null outside the ropes). */
function countSpot(f: RefereeFighterView, side: 1 | -1): { spot: Point | null; body: Point; head: Point; nz: number } {
  const ux = Math.sin(f.facing), uz = Math.cos(f.facing), body = { x: f.x - ux * 1.05, z: f.z - uz * 1.05 }, nx = -uz * side, nz = ux * side;
  let spot: Point | null = null;
  for (const offset of [1.1, .95]) if (!spot && inBox(body.x + nx * offset, body.z + nz * offset)) spot = { x: body.x + nx * offset, z: body.z + nz * offset };
  return { spot, body, head: { x: f.x - ux * 1.45, z: f.z - uz * 1.45 }, nz };
}
/** Ground-plane distance between segments p0→p1 and q0→q1 (0 when they cross). */
function segmentGap(p0: Point, p1: Point, q0: Point, q1: Point): number {
  const side = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  if (side(q0, q1, p0) * side(q0, q1, p1) < 0 && side(p0, p1, q0) * side(p0, p1, q1) < 0) return 0;
  return Math.min(toSegment(p0, q0.x, q0.z, q1.x, q1.z).d, toSegment(p1, q0.x, q0.z, q1.x, q1.z).d, toSegment(q0, p0.x, p0.z, p1.x, p1.z).d, toSegment(q1, p0.x, p0.z, p1.x, p1.z).d);
}
/**
 * Detour around an obstacle segment (centre c, half-length h along u) when the straight line to the target
 * passes within `clear` of it: a carrot ~34° ahead on a circle of radius ≥ 1.9 m, so he walks round the
 * outside. The direction is kept until the line is clear (force: until he reaches his side); it prefers the
 * shorter arc unless that passes the camera side (+z) or leaves the ropes.
 */
function detour(r: SparringReferee, target: Point, c: Point, ux: number, uz: number, h: number, clear: number, force = false, ends: readonly (Point & { risk: number })[] = []): Point {
  if (!force && segmentGap(r, target, { x: c.x - ux * h, z: c.z - uz * h }, { x: c.x + ux * h, z: c.z + uz * h }) >= clear) { r.orbit = 0; return target; }
  const radius = Math.max(ARC, h + clear + .1), here = Math.atan2(r.x - c.x, r.z - c.z), there = Math.atan2(target.x - c.x, target.z - c.z);
  if (r.orbit === 0) {
    const delta = angle(there - here), cost = (dir: 1 | -1) => {
      const arc = dir * delta >= 0 ? Math.abs(delta) : 2 * Math.PI - Math.abs(delta), mid = here + dir * arc / 2;
      // Passing behind a hurt fighter crosses the place his body would land.
      const behind = ends.reduce((t, e) => { const off = ((dir * (Math.atan2(e.x - c.x, e.z - c.z) - here)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return t + (off <= arc ? (e.risk > RISKY ? 6 : e.risk * 3) : 0); }, 0);
      return arc + 2.5 * Math.max(0, Math.cos(mid)) + (inBox(c.x + Math.sin(mid) * radius, c.z + Math.cos(mid) * radius) ? 0 : 3) + behind;
    };
    r.orbit = cost(1) <= cost(-1) ? 1 : -1;
  }
  const bearing = here + r.orbit * .6;
  return { x: clamp(c.x + Math.sin(bearing) * radius, -BOX, BOX), z: clamp(c.z + Math.cos(bearing) * radius, -BOX, BOX) };
}

export function stepSparringReferee(previous: Readonly<SparringReferee>, world: RefereeWorld): SparringReferee {
  const r: SparringReferee = { ...previous }, [a, b] = world.fighters;
  const mode = world.phase === "count" && world.countFighter !== null ? "count" : world.phase === "break" ? "break" : "fight";
  const downed = mode === "count" ? world.fighters[world.countFighter!] : null, standing = mode === "count" ? world.fighters[world.countFighter === 0 ? 1 : 0] : null;
  if (mode !== r.mode) {
    r.mode = mode; r.blocked = 0; r.orbit = 0;
    if (mode === "fight") r.side = sideOf(r, a, b);
    // Between rounds the fighters walk to (-2.6,-2.6) and (2.6,2.6): wait in a neutral corner (+1: (-1.9, 1.9)),
    // the one he reaches without crossing their paths, far side preferred, so the bell never finds him between them.
    else if (mode === "break") {
      const score = (side: 1 | -1) => Math.min(1.5, ...world.fighters.map(f => f.goal ? segmentGap(r, { x: -NEUTRAL * side, z: NEUTRAL * side }, f, { x: f.goal[0], z: f.goal[1] }) : 9)) + (side === -1 ? .4 : 0);
      r.side = score(1) > score(-1) ? 1 : -1;
    }
    else if (downed && standing) {
      // Beside the lying body: not on the side of the neutral corner the other fighter is walking to (he would pass
      // there), away from the camera, the side he already stands on, away from where the other fighter is now.
      const score = (side: 1 | -1) => {
        const { spot, body, nz } = countSpot(downed, side), ux = Math.sin(downed.facing), uz = Math.cos(downed.facing), nx = -uz * side;
        const awayX = standing.x - body.x, awayZ = standing.z - body.z, away = Math.max(.01, Math.hypot(awayX, awayZ));
        const mine = Math.sign(ux * (r.z - body.z) - uz * (r.x - body.x)) === side ? 2 : 0; // n = (-uz, ux)·side
        const route = standing.goal && nx * (standing.goal[0] - body.x) + nz * (standing.goal[1] - body.z) > 0 ? 2.5 : 0;
        return -2 * nz + mine - (nx * awayX + nz * awayZ) / away - route - (spot ? 0 : 10);
      };
      r.side = score(1) >= score(-1) ? 1 : -1;
    }
  }
  // 1. Where to stand and what to watch.
  let target: Point, watch: Point;
  if (downed) {
    let plan = countSpot(downed, r.side);
    if (plan.spot) r.blocked = 0; else if (++r.blocked >= FLIP_TICKS && countSpot(downed, r.side === 1 ? -1 : 1).spot) { r.side = r.side === 1 ? -1 : 1; r.blocked = 0; r.orbit = 0; plan = countSpot(downed, r.side); }
    const inward = Math.max(.01, Math.hypot(plan.body.x, plan.body.z));
    target = plan.spot ?? { x: clamp(plan.body.x * (1 - 1.1 / inward), -BOX, BOX), z: clamp(plan.body.z * (1 - 1.1 / inward), -BOX, BOX) }; watch = plan.head;
    const ux = Math.sin(downed.facing), uz = Math.cos(downed.facing);
    // Round the lying body the way the other fighter is not (he starts in front of the downed fighter's feet).
    target = detour(r, target, { x: downed.x - ux * .85, z: downed.z - uz * .85 }, ux, uz, 1.0, LIE_COMFORT - .05, false, standing ? [{ x: standing.x, z: standing.z, risk: 1 }] : []);
  } else if (mode === "break") {
    target = { x: -NEUTRAL * r.side, z: NEUTRAL * r.side }; watch = { x: 0, z: 0 }; r.orbit = 0; r.blocked = 0;
  } else {
    // The fighters turned past him (he did not walk between them): adopt the side he now stands on. A fighter
    // getting hurt while he walks round behind him: turn back rather than cross where the body would land.
    if ((r.orbit === 0 || a.risk > RISKY || b.risk > RISKY) && sideOf(r, a, b) !== r.side) { r.side = sideOf(r, a, b); r.blocked = 0; r.orbit = 0; }
    const mine = fightSpot(r, a, b, r.side, true), mineSide = r.side, other = r.side === 1 ? -1 : 1;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, d = Math.max(.01, Math.hypot(b.x - a.x, b.z - a.z));
    // Change side only once they are engaged (around two fighters far apart there is no short way round) and one
    // end is safe to pass: walking round behind a fighter crosses the place his body would land.
    if (mine) r.blocked = 0; else if (++r.blocked >= FLIP_TICKS && d < ENGAGED && Math.min(a.risk, b.risk) <= RISKY && fightSpot(r, a, b, other, true)) { r.side = other; r.blocked = 0; r.orbit = 0; }
    target = (r.side === mineSide ? mine : fightSpot(r, a, b, r.side, true)) ?? fightSpot(r, a, b, r.side, false) ?? { x: clamp(mx - (b.z - a.z) / d * r.side * SLOT_MIN, -BOX, BOX), z: clamp(mz + (b.x - a.x) / d * r.side * SLOT_MIN, -BOX, BOX) };
    watch = { x: mx, z: mz };
    // After a side change he keeps walking round until he is on his new side (crossing beyond a fighter's back).
    target = detour(r, target, { x: mx, z: mz }, (b.x - a.x) / d, (b.z - a.z) / d, d / 2, CORRIDOR - .1, sideOf(r, a, b) !== r.side, [a, b]);
  }
  // 2. Desired velocity: arrive (or keep orbiting), then smooth avoidance; nothing here teleports.
  const speed = Math.hypot(r.vx, r.vz), dx = target.x - r.x, dz = target.z - r.z, dist = Math.hypot(dx, dz);
  let gx = 0, gz = 0, urgent = 0;
  // Follow a drifting spot continuously (speed ∝ distance) rather than in stop-and-go bursts; brake to arrive.
  if (dist > .06 || r.orbit !== 0) {
    const v = r.orbit !== 0 ? VMAX : Math.min(VMAX, Math.sqrt(2 * BRAKE * Math.max(0, dist - .03)), 1.6 * dist);
    gx = dx / dist * v; gz = dz / dist * v;
  }
  const avoid = (c: Clearance, comfort: number, hard: number) => {
    if (c.d >= comfort) return;
    const k = clamp((comfort - c.d) / (comfort - hard), 0, 1), inward = gx * c.nx + gz * c.nz;
    if (inward < 0) { gx -= c.nx * inward; gz -= c.nz * inward; }
    gx += c.nx * VMAX * k * k; gz += c.nz * VMAX * k * k; urgent = Math.max(urgent, k);
  };
  // Fighters walking to a corner (between rounds, during a count) move straight and up to 2.4 m/s: look further ahead.
  const horizons = mode === "fight" ? [0, PREDICT] : [0, .4, .8, 1.2, 1.6];
  const nearest = (p: Point) => Math.min(...world.fighters.flatMap(f => horizons.map(h => clearance(f, p, h).d)));
  for (const f of world.fighters) {
    let c = clearance(f, r, 0);
    for (const h of horizons) { const ahead = clearance(f, r, h); if (ahead.d < c.d) c = ahead; }
    avoid(c, f.down ? LIE_COMFORT : STAND_COMFORT, f.down ? LIE_HARD : STAND_HARD);
    if (f.down) continue;
    // Never wait where the engine is walking him (his corner between rounds, a neutral corner during a count).
    if (f.goal) {
      avoid(toSegment(r, f.goal[0], f.goal[1], f.goal[0], f.goal[1]), 1.3, .6);
      // Standing in the lane he still has to walk: no push (that pinned the official to the ropes), but the step
      // sampler below takes over and picks the side with room.
      urgent = Math.max(urgent, clamp((1 - toSegment(r, f.x, f.z, f.goal[0], f.goal[1]).d) / .4, 0, 1));
    }
    // A knockdown lays the body 1.85 m behind the root at once: keep out from behind a hurt fighter always,
    // and from behind a fresh one except while walking round the pair to change side.
    if (mode === "fight" && (f.risk > RISKY || r.orbit === 0)) {
      const ux = Math.sin(f.facing), uz = Math.cos(f.facing), hurt = f.risk > RISKY;
      avoid(toSegment(r, f.x + ux * .15, f.z + uz * .15, f.x - ux * 1.85, f.z - uz * 1.85), hurt ? 1.0 : .85, hurt ? .7 : .6);
    }
    // Step out of the path of a fighter walking at him (closest approach within 1.2 s, 1.3 m).
    const wx = f.vx - r.vx, wz = f.vz - r.vz, w2 = wx * wx + wz * wz, ex = r.x - f.x, ez = r.z - f.z, t = w2 > .09 ? (ex * wx + ez * wz) / w2 : 0;
    if (t > 0 && t < 1.2) {
      const mx = ex - wx * t, mz = ez - wz * t, miss = Math.hypot(mx, mz);
      if (miss < 1.3) {
        const k = (1 - miss / 1.3) * (1 - t / 1.2), w = Math.sqrt(w2);
        let sx = miss > 1e-6 ? mx / miss : -wz / w, sz = miss > 1e-6 ? mz / miss : wx / w;
        if (!inBox(r.x + sx * .8, r.z + sz * .8) && t > .6) { sx = -sx; sz = -sz; } // ropes behind him: cross ahead instead
        gx += sx * VMAX * k; gz += sz * VMAX * k; urgent = Math.max(urgent, k);
      }
    }
  }
  if (mode === "fight") avoid(toSegment(r, a.x, a.z, b.x, b.z), CORRIDOR, .6);
  // Between rounds and during a count the fighters walk straight to a corner. When one is close, take the step
  // (of 16 directions) with the most room over the next 1.6 s instead of summing pushes, which can pin him against
  // the ropes in a walking fighter's way.
  if (mode !== "fight" && urgent > .25) {
    const room = (p: Point) => Math.min(1, ...world.fighters.flatMap(f => [
      ...(f.down ? [clearance(f, p, 0).d / LIE_COMFORT] : horizons.map(h => clearance(f, p, h).d / STAND_COMFORT)),
      ...(f.goal ? [Math.hypot(p.x - f.goal[0], p.z - f.goal[1]) / 1.3, toSegment(p, f.x, f.z, f.goal[0], f.goal[1]).d] : [])]));
    const tx = dist > 1e-6 ? dx / dist : 0, tz = dist > 1e-6 ? dz / dist : 0, sp = Math.max(1e-6, speed);
    let best = -Infinity, ex = 0, ez = 0;
    for (let i = 0; i < 16; i++) {
      const cx = Math.sin(i * Math.PI / 8), cz = Math.cos(i * Math.PI / 8);
      if (!inBox(r.x + cx * .5, r.z + cz * .5)) continue; // a short step toward the ropes is still a way out
      const score = Math.min(room({ x: r.x + cx * .5, z: r.z + cz * .5 }), room({ x: clamp(r.x + cx, -BOX, BOX), z: clamp(r.z + cz, -BOX, BOX) })) + (urgent < .5 ? .1 * (cx * tx + cz * tz) : 0) + .1 * (cx * r.vx + cz * r.vz) / sp;
      if (score > best) { best = score; ex = cx; ez = cz; }
    }
    const v = VMAX * Math.min(1, urgent * 1.6); gx = ex * v; gz = ez * v;
  }
  let pinned = false;
  for (const axis of ["x", "z"] as const) {
    const p = r[axis], edge = BOX - .1;
    if (Math.abs(p) <= edge) continue;
    if ((axis === "x" ? gx : gz) * p > 0) { if (axis === "x") gx = 0; else gz = 0; pinned = true; }
    if (axis === "x") gx -= Math.sign(p) * (Math.abs(p) - edge) * 4; else gz -= Math.sign(p) * (Math.abs(p) - edge) * 4;
  }
  // Pinned against the ropes while something comes at him: slide along them toward the most room.
  if (pinned && urgent > .3) {
    let best = -1, ex = 0, ez = 0;
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const p = { x: r.x + sx * .4, z: r.z + sz * .4 };
      if (!inBox(p.x, p.z)) continue;
      const room = nearest(p); if (room > best) { best = room; ex = sx; ez = sz; }
    }
    gx += ex * VMAX * urgent; gz += ez * VMAX * urgent;
  }
  // Calm travel: side-steps ≤ 1.0 m/s and back-steps ≤ 0.9 m/s in his own frame; escapes may use full speed.
  if (urgent < .5) {
    const fx = Math.sin(r.facing), fz = Math.cos(r.facing), forward = gx * fx + gz * fz, left = gx * fz - gz * fx;
    const f2 = Math.max(forward, -BACK_MAX), l2 = clamp(left, -SIDE_MAX, SIDE_MAX);
    gx = fx * f2 + fz * l2; gz = fz * f2 - fx * l2;
  }
  const g = Math.hypot(gx, gz); if (g > VMAX) { gx *= VMAX / g; gz *= VMAX / g; }
  // Brake before the ropes so the hard clamp below never has to stop him in one tick (bounded deceleration).
  const brake = (p: number, v: number) => v * p > 0 ? Math.sign(v) * Math.min(Math.abs(v), Math.sqrt(2 * 3.5 * Math.max(0, HARD_BOX - .05 - Math.abs(p)))) : v;
  gx = brake(r.x, gx); gz = brake(r.z, gz);
  // 3. Integrate with bounded acceleration; the hard rope clamp is a safety net the audit expects never to use.
  let ax = gx - r.vx, az = gz - r.vz; const dv = Math.hypot(ax, az), limit = ACCEL / HZ;
  if (dv > limit) { ax *= limit / dv; az *= limit / dv; }
  const vx = r.vx + ax, vz = r.vz + az, x0 = r.x, z0 = r.z;
  r.x = clamp(r.x + vx / HZ, -HARD_BOX, HARD_BOX); r.z = clamp(r.z + vz / HZ, -HARD_BOX, HARD_BOX);
  r.vx = (r.x - x0) * HZ; r.vz = (r.z - z0) * HZ;
  // 4. Facing: watch the action; when walking fast he leans into the walk (≤ 69°), never turning his back.
  let want = Math.atan2(watch.x - r.x, watch.z - r.z);
  const moving = Math.hypot(r.vx, r.vz);
  if (moving > .6) { const diff = angle(Math.atan2(r.vx, r.vz) - want); want += clamp(diff, -1.2, 1.2) * smooth((moving - .6) / .6) * smooth((2.1 - Math.abs(diff)) / .5); }
  const err = angle(want - r.facing), aim = Math.abs(err) <= DEAD_ZONE ? 0 : clamp(TURN_GAIN * (err - Math.sign(err) * DEAD_ZONE), -TURN_MAX, TURN_MAX);
  const turn = clamp(r.turn + clamp(aim - r.turn, -TURN_ACCEL / HZ, TURN_ACCEL / HZ), -TURN_MAX, TURN_MAX), f0 = r.facing;
  r.facing = angle(r.facing + turn / HZ); r.turn = angle(r.facing - f0) * HZ;
  // 5. Odometer in his own frame (renderer gait phase).
  const fx = Math.sin(r.facing), fz = Math.cos(r.facing), forward = (r.vx * fx + r.vz * fz) / HZ, left = (r.vx * fz - r.vz * fx) / HZ;
  r.travelF += Math.max(0, forward); r.travelB += Math.max(0, -forward); r.travelL += Math.max(0, left); r.travelR += Math.max(0, -left);
  return r;
}
