/**
 * Ringside broadcast camera. Presentation only: it reads fighter positions and never feeds anything back.
 *
 * Automatic mode is a broadcast operator: the follow point, the azimuth, the elevation and the dolly are
 * critically damped springs (no overshoot, continuous velocity), so there is no jitter and no sudden flip;
 * it dollies in a few percent on exchanges and backs off on clinches and knockdowns.
 *
 * Manual mode (the viewer drags or zooms) keeps the same follow point but takes azimuth, elevation and zoom from
 * the viewer. The azimuth is a world angle, so the camera stays where it was put while the fighters move.
 * `reset()` hands control back; the springs then ease to the automatic camera over ~1.5 s.
 *
 * Geometry: the camera looks along +w of a basis turned by `az` (u = right, w = into the screen); it stands
 * `dh` metres behind the follow point and `look + dh * tan(el)` above the floor, pitched down by `el`.
 */
import { clamp } from './motion';

export type CamPreset = 'broadcast' | 'ringside';
export type Preset = { vfov: number; camH: number; look: number; minDh: number; yaw: number; pad: number };
/** Long lens (narrow field of view, camera far back): little perspective distortion, a flat 2.5D look. */
export const PRESETS: Record<CamPreset, Preset> = {
  broadcast: { vfov: 21, camH: 2.45, look: 1.05, minDh: 6.4, yaw: .3, pad: 1.2 },
  ringside: { vfov: 26, camH: 1.5, look: 1.2, minDh: 4.6, yaw: .62, pad: 1 },
};
/** Manual limits: elevation 2.5..68 deg, zoom factor .45..2.4 on the framing distance, distance at least 2.6 m. */
export const LIMITS = { elMin: 2.5 * Math.PI / 180, elMax: 68 * Math.PI / 180, zoomMin: .45, zoomMax: 2.4, dhMin: 2.6, dhMax: 40, floorMin: .35, clearance: .95 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export type Spring = { v: number; vel: number };
/** Critically damped spring toward `goal` (Unity SmoothDamp): `time` is roughly the time to settle. */
export function damp(s: Spring, goal: number, time: number, dt: number, maxSpeed = Infinity): void {
  const t = Math.max(1e-4, time), w = 2 / t, x = w * dt, e = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
  const lim = maxSpeed * t;
  let change = s.v - goal; const orig = goal;
  change = clamp(change, -lim, lim); goal = s.v - change;
  const temp = (s.vel + w * change) * dt;
  s.vel = (s.vel - w * temp) * e;
  let out = goal + (change + temp) * e;
  if ((orig - s.v > 0) === (out > orig)) { out = orig; s.vel = dt > 0 ? (out - orig) / dt : 0; }
  s.v = out;
}
const spring = (v = 0): Spring => ({ v, vel: 0 });

export type RigInput = {
  dt: number; preset: CamPreset;
  /** Follow point on the floor (world m), distance between the two framed bodies (m) and the fight-line world angle. */
  mid: { x: number; z: number }; spread: number; pairAngle: number;
  /** Projection constants of the canvas (focal length in px, canvas size). */
  F: number; W: number; H: number;
  /** 0..1: exchanges in the last moments (dolly in). 0..1: clinch or knockdown (back off). */
  energy: number; wide: number;
  /** Bodies the camera must not sit inside (world XZ). */
  bodies: { x: number; z: number }[];
  reduced: boolean; clock: number;
};
export type RigOut = { cu: number; ch: number; cw: number; cos: number; sin: number; ax: { rx: number; rz: number }; el: number; dh: number; az: number; look: number };

export class CameraRig {
  private x = spring(); private z = spring(); private az = spring(); private el = spring(.2); private dh = spring(6.4); private lookH = spring(1.05); private dyn = spring();
  private init = false; private ease = 0; private autoR = 6.5;
  manual = false; private mAz = 0; private mEl = .2; private mZoom = 1;
  /** Hit impulse: dolly in and shake (decays on its own). */
  kick = 0; shake = 0;

  /** Next update snaps to the automatic framing (new round or phase); manual control, if any, is kept. */
  snap(): void { this.init = false; }

  /** The viewer takes control from wherever the camera is now. Returns true when control changed. */
  take(): boolean {
    if (this.manual) return false;
    this.manual = true; this.mAz = this.az.v; this.mEl = clamp(this.el.v, LIMITS.elMin, LIMITS.elMax); this.mZoom = clamp(this.dh.v / Math.cos(this.el.v) / Math.max(.1, this.autoR), LIMITS.zoomMin, LIMITS.zoomMax);
    return true;
  }
  /** Gives control back: the springs ease to the automatic camera. Returns true when control changed. */
  reset(): boolean { const was = this.manual; this.manual = false; if (was) this.ease = 1.6; return was; }
  /** Drag: yaw in radians (positive moves the camera to the viewer's left, the scene follows the finger), pitch in radians (positive raises the camera). */
  orbit(dAz: number, dEl: number): void { this.take(); this.mAz = wrap(this.mAz + dAz) ; this.mEl = clamp(this.mEl + dEl, LIMITS.elMin, LIMITS.elMax); }
  /** Wheel or pinch: factor > 1 moves the camera away. */
  zoom(factor: number): void { this.take(); this.mZoom = clamp(this.mZoom * factor, LIMITS.zoomMin, LIMITS.zoomMax); }
  get manualState() { return { az: this.mAz, el: this.mEl, zoom: this.mZoom }; }

  update(i: RigInput): RigOut {
    const P = PRESETS[i.preset], dt = clamp(i.dt, 0, .1), calm = i.reduced ? 1.6 : 1, easing = this.ease > 0;
    if (this.ease > 0) this.ease = Math.max(0, this.ease - dt);
    // Framing: the pair across the screen, and the bodies' height.
    // The 3/4 turn closes toward 0 when the fighters are near each other, so the one in front hides less of the other.
    const yaw = P.yaw * clamp((i.spread - .5) / .9, .2, 1);
    const pairU = i.spread * Math.abs(Math.cos(i.pairAngle - (this.manual ? this.mAz : i.pairAngle + yaw)));
    const half = pairU / 2 + P.pad, needW = i.F * half / (i.W * .42), needH = i.F * 2.35 / (i.H * .82);
    const base = Math.max(P.minDh, needW, needH);
    // Zoom scales the orbit radius (camera to follow point), so climbing or dropping keeps the fighters the same size.
    this.autoR = base / Math.cos(Math.atan2(P.camH - P.look, P.minDh));
    const sway = !i.reduced && !this.manual ? Math.sin(i.clock * .17) * .022 : 0;
    let goalAz: number, goalEl: number, goalDh: number;
    const dynGoal = this.manual ? 0 : clamp(i.wide) * .1 - clamp(i.energy) * .07;
    if (this.manual) { goalAz = this.mAz; goalEl = this.mEl; goalDh = this.autoR * this.mZoom * Math.cos(this.mEl); }
    else { goalAz = i.pairAngle + yaw + sway; goalEl = Math.atan2(P.camH - P.look, P.minDh) + clamp(i.wide) * .035 - clamp(i.energy) * .012 + clamp((1.1 - i.spread) / .6) * .11; goalDh = base; }
    goalDh = goalDh * (1 - this.kick) * (1 + this.dyn.v);
    goalDh = clamp(goalDh, LIMITS.dhMin, LIMITS.dhMax);
    // Never inside a fighter: push the camera back until it clears every body (the long lens hides the change).
    const cx = (az: number, dh: number) => ({ x: i.mid.x - dh * Math.sin(az), z: i.mid.z + dh * Math.cos(az) });
    for (let k = 0; k < 4; k++) {
      const c = cx(goalAz, goalDh); let worst = 0;
      for (const b of i.bodies) worst = Math.max(worst, LIMITS.clearance - Math.hypot(b.x - c.x, b.z - c.z));
      if (worst <= 0) break;
      goalDh = Math.min(LIMITS.dhMax, goalDh + worst + .1);
    }
    const goalLook = P.look - clamp(i.wide) * .12;
    if (!this.init) {
      this.init = true; this.x.v = i.mid.x; this.z.v = i.mid.z; this.az.v = goalAz; this.el.v = goalEl; this.dh.v = goalDh; this.lookH.v = goalLook;
    } else {
      damp(this.x, i.mid.x, .3 * calm, dt); damp(this.z, i.mid.z, .3 * calm, dt);
      // The azimuth is unwrapped around the current value so a turn always takes the short way, at a limited angular speed.
      const goalUnwrapped = this.az.v + wrap(goalAz - this.az.v);
      // Automatic azimuth keeps the fight line across the screen: quick enough that circling fighters never line up behind
      // each other, calmer when the pair is so close that the line between them is ill-defined.
      const close = clamp((1.1 - i.spread) / .5), autoT = (.42 + .6 * close) * (i.reduced ? 1.25 : 1);
      damp(this.az, goalUnwrapped, this.manual ? .09 * calm : easing ? .5 * calm : autoT, dt, this.manual ? 12 : easing ? 3 : 2.4);
      damp(this.el, goalEl, (this.manual ? .09 : easing ? .4 : .6) * calm, dt);
      damp(this.dh, goalDh, (this.manual ? .14 : easing ? .5 : .7) * calm, dt);
      damp(this.lookH, goalLook, .6 * calm, dt);
    }
    damp(this.dyn, dynGoal, .9 * calm, dt);
    this.kick *= Math.exp(-dt * 5); this.shake *= Math.exp(-dt * 10);
    // Never below the floor: the camera height is look + dh * tan(el), kept above a minimum.
    const el = clamp(this.el.v, LIMITS.elMin * .6, LIMITS.elMax), dh = clamp(this.dh.v, LIMITS.dhMin, LIMITS.dhMax);
    const ch = Math.max(LIMITS.floorMin, this.lookH.v + dh * Math.tan(el)), azv = this.az.v, rx = Math.cos(azv), rz = Math.sin(azv);
    const u = this.x.v * rx + this.z.v * rz, w = this.x.v * rz - this.z.v * rx, pitch = Math.atan2(ch - this.lookH.v, dh);
    return { cu: u, ch, cw: w - dh, cos: Math.cos(pitch), sin: Math.sin(pitch), ax: { rx, rz }, el: pitch, dh, az: azv, look: this.lookH.v };
  }
  /** World position of the camera for the last update (floor XZ and height), for tests and clearance checks. */
  position(out: RigOut): { x: number; y: number; z: number } {
    const u = out.cu, w = out.cw, { rx, rz } = out.ax;
    // world = u * (rx, rz) + w * (rz, -rx)
    return { x: u * rx + w * rz, y: out.ch, z: u * rz - w * rx };
  }
}
