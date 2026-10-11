// Gates for the broadcast camera rig (lib/ringside-25d/camera.ts): critically damped follow (no overshoot, no jitter, no
// sudden flip), manual orbit limits (never below the floor, never inside a fighter), and the ease back to automatic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateContactCombatV5 } from '@sollish/protocol';
import { fightAxis } from '../lib/ringside-25d/motion';
import { CameraRig, damp, LIMITS, PRESETS, type RigInput } from '../lib/ringside-25d/camera';

const F = 1200 / 2 / Math.tan(PRESETS.broadcast.vfov * Math.PI / 360);
const base = (over: Partial<RigInput> = {}): RigInput => ({ dt: 1 / 60, preset: 'broadcast', mid: { x: 0, z: 0 }, spread: 1.4, pairAngle: 0, F, W: 1800, H: 1200, energy: 0, wide: 0, bodies: [{ x: -.7, z: 0 }, { x: .7, z: 0 }], reduced: false, clock: 0, ...over });
const settle = (rig: CameraRig, input: Partial<RigInput>, seconds: number) => { let out = rig.update(base(input)); for (let i = 0; i < seconds * 60; i++) out = rig.update(base({ ...input })); return out; };

test('critically damped spring: reaches the goal without overshoot and with continuous velocity', () => {
  const s = { v: 0, vel: 0 }; let prev = 0, maxStep = 0;
  for (let i = 0; i < 600; i++) { damp(s, 1, .5, 1 / 60); assert.ok(s.v <= 1 + 1e-9, `overshoot ${s.v}`); assert.ok(s.v >= prev - 1e-12, 'monotonic'); maxStep = Math.max(maxStep, s.v - prev); prev = s.v; }
  assert.ok(Math.abs(s.v - 1) < 1e-4); assert.ok(maxStep < .05, `step ${maxStep}`);
});

test('automatic camera: follows the midpoint smoothly (no jitter), tracks spread, dolly in on exchanges, wider on knockdowns', () => {
  const rig = new CameraRig();
  let out = settle(rig, {}, 4); const calm = out.dh, calmEl = out.el;
  // 1.5 cm of sensor noise on the follow point at 60 Hz must not move the camera more than a millimetre a frame.
  let prev = out, worst = 0, seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - .5; };
  for (let i = 0; i < 600; i++) { out = rig.update(base({ mid: { x: rnd() * .03, z: rnd() * .03 } })); worst = Math.max(worst, Math.abs(out.cu - prev.cu), Math.abs(out.cw - prev.cw), Math.abs(out.ch - prev.ch)); prev = out; }
  assert.ok(worst < .004, `jitter ${worst}`);
  // A 1 m step of the midpoint is followed over ~1 s without overshoot.
  const rig2 = new CameraRig(); settle(rig2, {}, 3); let o2 = rig2.update(base()); const x0 = rig2.position(o2).x; let maxX = -Infinity;
  for (let i = 0; i < 300; i++) { o2 = rig2.update(base({ mid: { x: 1, z: 0 } })); maxX = Math.max(maxX, Math.abs(rig2.position(o2).x - x0)); }
  assert.ok(maxX <= 1.01 && Math.abs(Math.abs(rig2.position(o2).x - x0) - 1) < .05, `follow ${maxX}`);
  const hot = settle(new CameraRig(), { energy: 1 }, 5), wide = settle(new CameraRig(), { wide: 1 }, 5);
  assert.ok(hot.dh < calm, 'dolly in on exchanges'); assert.ok(wide.dh > calm, 'wider on clinches and knockdowns'); assert.ok(hot.dh > calm * .9 && wide.dh < calm * 1.15, 'gentle: under 10-15%');
  assert.ok(Math.abs(calmEl - Math.atan2(PRESETS.broadcast.camH - PRESETS.broadcast.look, PRESETS.broadcast.minDh)) < .02);
  // Fighters far apart need a wider shot.
  assert.ok(settle(new CameraRig(), { spread: 5.5, bodies: [{ x: -2.75, z: 0 }, { x: 2.75, z: 0 }] }, 5).dh > calm);
});

test('no sudden flip: a half-turn of the fight line is followed at a limited angular speed', () => {
  const rig = new CameraRig(); let out = settle(rig, { pairAngle: 0 }, 3), prev = out.az, worst = 0;
  for (let i = 0; i < 600; i++) { out = rig.update(base({ pairAngle: Math.PI * .98 })); worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(out.az - prev), Math.cos(out.az - prev)))); prev = out.az; }
  assert.ok(worst < 2.6 / 60, `angular step ${worst} rad per frame`);
});

test('manual camera: orbit and zoom with limits; stays put while following the midpoint; never under the floor or inside a fighter', () => {
  const rig = new CameraRig(); settle(rig, {}, 3);
  assert.equal(rig.manual, false); rig.orbit(.8, .2); assert.equal(rig.manual, true);
  let out = settle(rig, {}, 2); const az1 = out.az; assert.ok(Math.abs(az1 - rig.manualState.az) < .01, 'azimuth follows the viewer');
  // The camera stays where it was put although the fight line turns; the follow point still moves with the fighters.
  const o1 = settle(rig, { pairAngle: 1.2, mid: { x: 1.5, z: 0 } }, 2); assert.ok(Math.abs(o1.az - az1) < .01, 'manual azimuth is not dragged by the fight line');
  const follow = (o: typeof out) => rig.position(o).x + o.dh * Math.sin(o.az);
  assert.ok(Math.abs(follow(o1) - follow(out) - 1.5) < .02, 'the follow point still moves with the fighters');
  // Limits.
  rig.orbit(0, 10); out = settle(rig, {}, 2); assert.ok(out.el <= LIMITS.elMax + 1e-3);
  rig.orbit(0, -20); out = settle(rig, {}, 2); assert.ok(out.el >= LIMITS.elMin - 1e-3);
  for (let i = 0; i < 50; i++) rig.zoom(.7); out = settle(rig, {}, 2); assert.ok(out.dh >= LIMITS.dhMin - 1e-6);
  for (let i = 0; i < 50; i++) rig.zoom(1.5); out = settle(rig, {}, 2); assert.ok(out.dh <= LIMITS.dhMax + 1e-6);
  // Random drags and zooms: the camera is always above the floor and clear of both fighters.
  let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - .5; };
  for (let i = 0; i < 400; i++) {
    rig.orbit(rnd() * .6, rnd() * .3); rig.zoom(Math.exp(rnd() * .5));
    const bodies = [{ x: rnd() * 3, z: rnd() * 3 }, { x: rnd() * 3, z: rnd() * 3 }];
    out = rig.update(base({ bodies, mid: { x: (bodies[0]!.x + bodies[1]!.x) / 2, z: (bodies[0]!.z + bodies[1]!.z) / 2 }, dt: 1 / 30 }));
    const c = rig.position(out); assert.ok(c.y >= LIMITS.floorMin - 1e-9, `camera height ${c.y}`);
  }
  // Bodies placed where the camera wants to stand: the rig backs off until it clears them.
  const rig2 = new CameraRig(); rig2.orbit(0, .01); rig2.zoom(.6); const probe = settle(rig2, {}, 2), cam = rig2.position(probe);
  const out2 = settle(rig2, { bodies: [{ x: cam.x, z: cam.z }, { x: 0, z: 0 }] }, 3), cam2 = rig2.position(out2);
  assert.ok(Math.hypot(cam2.x - cam.x, cam2.z - cam.z) >= LIMITS.clearance - .15, 'clears a fighter standing at the old camera spot');
});

test('reset eases back to the automatic camera without a jump', () => {
  const rig = new CameraRig(); const auto = settle(rig, {}, 4);
  rig.orbit(1.4, .5); rig.zoom(.6); settle(rig, {}, 2);
  assert.equal(rig.reset(), true); assert.equal(rig.reset(), false, 'reset is idempotent');
  let prev = rig.update(base()), worstAz = 0, d0 = Math.abs(prev.az - auto.az), mono = true, last = d0;
  for (let i = 0; i < 60 * 4; i++) { const o = rig.update(base({ clock: i / 60 })); worstAz = Math.max(worstAz, Math.abs(o.az - prev.az)); const d = Math.abs(o.az - auto.az); if (d > last + .01) mono = false; last = d; prev = o; }
  assert.ok(worstAz < 3.2 / 60, `no jump while easing back (${worstAz})`); assert.ok(mono, 'approaches monotonically');
  assert.ok(Math.abs(prev.az - auto.az) < .02 && Math.abs(prev.dh - auto.dh) < .05, 'back on the automatic camera');
});

test('across the fight line: during a full engine round the two fighters stay side by side on screen (no one hides the other)', () => {
  for (const reduced of [false, true]) for (const seed of ['0', '1', '2', '3']) {
    const round = simulateContactCombatV5(createHash('sha256').update(`motion:${seed}`).digest('hex')), rig = new CameraRig(), ratios: number[] = [];
    let raw: { rx: number; rz: number } | null = null;
    for (let t = 0; t < round.frames.length; t++) {
      const fr = round.frames[t]!; raw = fightAxis(fr, raw);
      const k = { x: fr.kor.x / 1000, z: fr.kor.z / 1000 }, a = { x: fr.ayaz.x / 1000, z: fr.ayaz.z / 1000 };
      const out = rig.update(base({ dt: .05, mid: { x: (k.x + a.x) / 2, z: (k.z + a.z) / 2 }, spread: Math.hypot(k.x - a.x, k.z - a.z), pairAngle: Math.atan2(raw.rz, raw.rx), bodies: [k, a], reduced }));
      const u = (p: { x: number; z: number }) => p.x * out.ax.rx + p.z * out.ax.rz, w = (p: { x: number; z: number }) => p.x * out.ax.rz - p.z * out.ax.rx;
      // Horizontal screen separation of the two hips as a share of the best possible one (the camera exactly across the line).
      const sep = Math.abs(u(k) - u(a)) / (w(k) - out.cw), ideal = Math.hypot(k.x - a.x, k.z - a.z) / (w(k) - out.cw);
      ratios.push(sep / ideal);
    }
    ratios.sort((x, y) => x - y);
    assert.ok(ratios[Math.floor(ratios.length * .05)]! >= .6, `seed ${seed} reduced=${reduced}: 5th percentile ${ratios[Math.floor(ratios.length * .05)]}`);
    assert.ok(ratios[0]! >= .4, `seed ${seed}: worst ${ratios[0]}`);
  }
});
