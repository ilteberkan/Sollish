/**
 * Ringside 2.5D motion. Presentation only: it reads the committed frames and events of a replay and
 * never feeds anything back into the fight, admission or settlement.
 *
 * Animation provenance: authored in code. No motion capture and no clips. It uses a 3D skeleton in
 * metres with these parts:
 * - two-bone IK for arms and legs;
 * - a footstep planner that keeps feet planted between steps;
 * - a separate glove path per technique: a straight line for the jab and cross, a horizontal arc for
 *   hooks, a vertical scoop for the uppercut and a dipping arc for the body hook;
 * - kicks and the knee (Contact 5): the kicking foot follows a chamber -> snap -> re-chamber path, the support
 *   foot is stepped under the hip before the kick and stays planted while the hips pivot, and the
 *   contact lands on the engine's contact tick;
 * - torso rotation, shoulder roll and weight transfer;
 * - damped hit reactions;
 * - knockdown, count and rise, clinch, and the referee.
 * Knowing a punch's recorded outcome a few ticks early only aims the glove, so a recorded hit visibly
 * lands and a recorded slip visibly misses.
 */
import { V5_STRIKES, isV5Kick, isV5Strike, type FighterId, type V5Event, type V5Frame, type V5Kick, type V5Strike } from '@sollish/protocol';

export const TICK_MS = 50;
export type V3 = { x: number; y: number; z: number };
export type RingReplay = { frames: readonly V5Frame[]; events: readonly V5Event[] };
export type Phase = 'idle' | 'fighting' | 'finished';
export type Who = FighterId | 'ref';

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3): V3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: V3, k: number): V3 => v(a.x * k, a.y * k, a.z * k);
const madd = (a: V3, b: V3, k: number): V3 => v(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return v(a.x / l, a.y / l, a.z / l); };
export const lerp = (a: V3, b: V3, t: number): V3 => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const heading = (t: number): V3 => v(Math.sin(t), 0, Math.cos(t));
const flat = (a: V3): V3 => v(a.x, 0, a.z);
const UP = v(0, 1, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const hash = (n: number) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

/** Body proportions (m). `fore` runs from the elbow to the glove centre. */
export type Dims = { thigh: number; shin: number; ankle: number; foot: number; torso: number; neck: number; headR: number; shoulder: number; hip: number; upper: number; fore: number; glove: number; limb: number; chest: number; stanceF: number; stanceS: number };
export const DIMS: Record<Who, Dims> = {
  // KOR: shorter, heavier, high guard. AYAZ: taller and longer, lower lead hand.
  kor: { thigh: .43, shin: .42, ankle: .075, foot: .2, torso: .52, neck: .07, headR: .118, shoulder: .215, hip: .115, upper: .315, fore: .325, glove: .088, limb: 1.14, chest: 1.12, stanceF: .25, stanceS: .13 },
  ayaz: { thigh: .47, shin: .46, ankle: .075, foot: .21, torso: .55, neck: .085, headR: .112, shoulder: .2, hip: .105, upper: .34, fore: .35, glove: .083, limb: 1, chest: 1, stanceF: .27, stanceS: .12 },
  ref: { thigh: .45, shin: .44, ankle: .07, foot: .2, torso: .53, neck: .08, headR: .11, shoulder: .2, hip: .11, upper: .31, fore: .29, glove: .045, limb: .85, chest: 1, stanceF: .02, stanceS: .15 },
};
export type Joints = Record<'pelvis' | 'chest' | 'neck' | 'head' | 'lS' | 'lE' | 'lG' | 'rS' | 'rE' | 'rG' | 'lH' | 'lK' | 'lA' | 'lT' | 'rH' | 'rK' | 'rA' | 'rT', V3>;
export type Body = {
  id: Who; j: Joints; dims: Dims; F: V3; L: V3; face: V3; headUp: V3; tU: V3; tL: V3;
  action: string; down: boolean; health: number; stamina: number; stun: number;
  /** Striking limb: side (l = lead), technique, 0..1 drive weight (for trails) and the contact point on the limb
   * (glove centre, shin axis point, ball of the foot or knee) in metres. */
  strike: { hand: 'l' | 'r'; technique: V5Strike; drive: number; kick: boolean; point: V3; /** Kicks: where the log says the limb should be (same axis as `point`). */ aim?: V3 } | null;
};
export type Impact = { index: number; type: V5Event['type']; actor: FighterId; target: FighterId; part: V5Event['bodyPart'] | null; technique: string; damage: number; counter: boolean; combo: number; count: number; ageMs: number; at: V3 };
export type RingFrame = { tick: number; kor: Body; ayaz: Body; ref: Body; impacts: Impact[]; knockdown: { fighter: FighterId; ageMs: number; count: number } | null; refMode: string; refCount: number };
export type RingOptions = { timeMs: number; phase: Phase; clockMs: number; winner: FighterId | 'draw' | null };

const isStrike = isV5Strike;
const FIGHTERS: readonly FighterId[] = ['kor', 'ayaz'];

// ---- replay index: outcomes, incoming blows and planted footsteps (cached per frames array) ------
type Step = { t0: number; t1: number; from: V3; to: V3 };
type Feet = { l: Step[]; r: Step[]; l0: V3; r0: V3 };
/** One kick or knee from the log: which foot throws it, where the support foot is stepped to, and how far the hips lunge. */
export type KickPlan = { id: FighterId; k0: number; wind: number; end: number; technique: V5Kick; foot: 'l' | 'r'; support: 'l' | 'r'; lunge: number; spot: V3 };
type Index = { n: number; resolution: Map<string, V5Event>; incoming: Record<FighterId, number[]>; yaw: Record<Who, Float64Array>; feet: Record<Who, Feet>; impactAt: Map<number, V3>; kicks: Record<FighterId, KickPlan[]>; kickAt: Map<string, KickPlan> };
const cache = new WeakMap<object, Index>();

type Track = { x: number; z: number; yawMilliRad: number; action?: string };
const trackOf = (f: V5Frame, who: Who): Track => who === 'ref' ? f.referee : f[who];
/** Catmull-Rom through tick samples (m): smooth and passes exactly through every tick. */
function rootAt(frames: readonly V5Frame[], who: Who, tick: number): V3 {
  const last = frames.length - 1, i = Math.min(last, Math.max(0, Math.floor(tick))), t = clamp(tick - i);
  const P = (k: number) => trackOf(frames[Math.min(last, Math.max(0, k))]!, who);
  const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
  const cr = (p0: number, p1: number, p2: number, p3: number) => .5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  return v(cr(a.x, b.x, c.x, d.x) / 1000, 0, cr(a.z, b.z, c.z, d.z) / 1000);
}
/** Facing per tick, turned at most 0.35 rad per tick (7 rad/s) so a body never spins between two ticks.
 * The engine yaw is followed, except while a fighter rests in the neutral corner: then he faces the
 * ring centre. On the canvas the engine keeps the yaw he fell with. */
function yawTrack(frames: readonly V5Frame[], who: Who): Float64Array {
  const out = new Float64Array(frames.length), step = .35;
  for (let k = 0; k < frames.length; k++) {
    const t = trackOf(frames[k]!, who);
    let want = t.yawMilliRad / 1000;
    if (who !== 'ref' && t.action === 'neutral') {
      const p = frames[Math.max(0, k - 1)]![who], moving = Math.hypot(t.x - p.x, t.z - p.z) > 8;
      if (!moving) want = Math.atan2(-t.x, -t.z);
    }
    if (!k) { out[k] = want; continue; }
    const prev = out[k - 1]!, d = wrap(want - prev);
    out[k] = prev + clamp(d, -step, step);
  }
  return out;
}
function yawFrom(track: Float64Array, tick: number): number {
  const last = track.length - 1, i = Math.min(last, Math.max(0, Math.floor(tick))), t = clamp(tick - i);
  const a = track[i]!, b = track[Math.min(last, i + 1)]!;
  return a + wrap(b - a) * t;
}
const speedAt = (frames: readonly V5Frame[], who: Who, tick: number) => len(sub(rootAt(frames, who, tick + .5), rootAt(frames, who, tick - .5))) * 1000 / TICK_MS;

/** Horizontal hip-to-contact reach of each kick and the depth of its target surface (m), used to size the hip lunge. */
const KICK_REACH: Record<V5Kick, { reach: number; depth: number }> = {
  teep: { reach: .90, depth: .17 }, lowKick: { reach: .66, depth: .26 }, bodyKick: { reach: .66, depth: .22 }, headKick: { reach: .50, depth: .22 }, knee: { reach: .46, depth: .16 },
};
/** Ticks before a kick in which the support foot is stepped under the hip. */
const KICK_PRE = 3;
function planKicks(frames: readonly V5Frame[], id: FighterId, yaw: Float64Array): KickPlan[] {
  const out: KickPlan[] = [], other: FighterId = id === 'kor' ? 'ayaz' : 'kor', d = DIMS[id];
  let lastAt = -1;
  for (let k = 0; k < frames.length; k++) {
    const a = frames[k]![id];
    if (!isV5Kick(a.action) || a.actionAt === lastAt) continue;
    lastAt = a.actionAt;
    const spec = V5_STRIKES[a.action], k0 = a.actionAt, tc = Math.min(frames.length - 1, k0 + spec.wind), kr = KICK_REACH[a.action];
    const me = rootAt(frames, id, tc), you = rootAt(frames, other, tc);
    const lunge = clamp(len(flat(sub(you, me))) - kr.depth - kr.reach, 0, .55);
    const foot = spec.limb === 'leadLeg' ? 'l' : 'r', support = foot === 'l' ? 'r' : 'l';
    const yw = yawFrom(yaw, k0), F = heading(yw), L = heading(yw + Math.PI / 2);
    out.push({ id, k0, wind: spec.wind, end: spec.end, technique: a.action, foot, support, lunge, spot: madd(madd(rootAt(frames, id, k0), F, lunge * .9), L, support === 'l' ? d.stanceS : -d.stanceS * .85) });
  }
  return out;
}

/** Where each foot wants to stand: orthodox stance for the fighters, square for the referee. */
function stanceFeet(who: Who, root: V3, yaw: number): { l: V3; r: V3 } {
  const d = DIMS[who], F = heading(yaw), L = heading(yaw + Math.PI / 2);
  if (who === 'ref') return { l: madd(root, L, d.stanceS), r: madd(root, L, -d.stanceS) };
  return { l: madd(madd(root, F, d.stanceF), L, d.stanceS), r: madd(madd(root, F, -d.stanceF * 1.05), L, -d.stanceS * .85) };
}
/** Footstep planner at 100 Hz: one foot in the air at a time; a planted foot never slides. */
function planFeet(frames: readonly V5Frame[], who: Who, yaw: Float64Array, kicks: readonly KickPlan[] = []): Feet {
  const last = frames.length - 1, dt = .2, start = stanceFeet(who, rootAt(frames, who, 0), yawFrom(yaw, 0));
  const out: Feet = { l: [], r: [], l0: start.l, r0: start.r };
  const pos = { l: start.l, r: start.r }, threshold = who === 'ref' ? .11 : .075, scheduled = new Set<KickPlan>();
  let air: { foot: 'l' | 'r'; step: Step } | null = null, landed = -9;
  for (let n = 0; n * dt <= last + 1e-9; n++) {
    const t = n * dt, s = who === 'ref' ? null : frames[Math.min(last, Math.floor(t + 1e-9))]![who].action;
    if (air && t >= air.step.t1 - 1e-9) { pos[air.foot] = air.step.to; landed = t; air = null; }
    if (s === 'down' || s === 'rise') {
      // Feet are posed by the knockdown animation; the planner resumes from the stance spot.
      const want = stanceFeet(who, rootAt(frames, who, t), yawFrom(yaw, t));
      if (air) { out[air.foot].pop(); air = null; }
      pos.l = want.l; pos.r = want.r; out.l.push({ t0: t, t1: t, from: want.l, to: want.l }); out.r.push({ t0: t, t1: t, from: want.r, to: want.r }); continue;
    }
    // Kicks: no foot is in the air from the pre-step until the kick ends; the support foot is stepped under the hip
    // just before the kick (landing on its first tick) and then stays planted while the kick foot is driven by the pose.
    const K = kicks.find(k => t < k.k0 + k.end - 1e-9);
    if (K && t >= K.k0 - KICK_PRE - 1e-9) {
      if (!scheduled.has(K)) {
        scheduled.add(K);
        if (!air && len(flat(sub(K.spot, pos[K.support]))) > .01) { const step = { t0: K.k0 - KICK_PRE, t1: K.k0, from: pos[K.support], to: K.spot }; out[K.support].push(step); air = { foot: K.support, step }; }
      }
      if (t >= K.k0 - 1e-9) landed = t;
      continue;
    }
    if (air || t - landed < .8) continue;
    const want = stanceFeet(who, rootAt(frames, who, t), yawFrom(yaw, t));
    const el = len(flat(sub(want.l, pos.l))), er = len(flat(sub(want.r, pos.r)));
    const foot = el >= er ? 'l' : 'r', err = Math.max(el, er);
    if (err < threshold) continue;
    const dur = clamp(2.6 + err * 6, 2.8, 4.4);
    // A step that would still be in the air when the next kick's pre-step begins is skipped.
    const next = kicks.find(k => k.k0 > t - 1e-9);
    if (next && t + dur > next.k0 - KICK_PRE - 1e-9) continue;
    const ahead = stanceFeet(who, rootAt(frames, who, Math.min(last, t + dur)), yawFrom(yaw, Math.min(last, t + dur)));
    const step = { t0: t, t1: t + dur, from: pos[foot], to: ahead[foot] };
    out[foot].push(step); air = { foot, step };
  }
  return out;
}
function footAt(feet: Feet, foot: 'l' | 'r', tick: number, lift: number): V3 {
  const steps = feet[foot];
  let lo = 0, hi = steps.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (steps[m]!.t0 <= tick) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return feet[foot === 'l' ? 'l0' : 'r0'];
  const s = steps[k]!;
  if (tick >= s.t1 || s.t1 === s.t0) return s.to;
  const u = (tick - s.t0) / (s.t1 - s.t0), p = lerp(s.from, s.to, smooth(u));
  return v(p.x, Math.sin(Math.PI * u) * lift, p.z);
}
function index(r: RingReplay): Index {
  const hit = cache.get(r.frames);
  if (hit && hit.n === r.frames.length) return hit;
  const resolution = new Map<string, V5Event>(), incoming: Record<FighterId, number[]> = { kor: [], ayaz: [] }, open = new Map<FighterId, number>();
  r.events.forEach((e, i) => {
    if (e.type === 'strike') open.set(e.actor, e.tick);
    else if (e.type === 'hit' || e.type === 'block' || e.type === 'dodge' || e.type === 'miss') { const at = open.get(e.actor); if (at !== undefined) { resolution.set(`${e.actor}:${at}`, e); open.delete(e.actor); } }
    if (e.type === 'hit' || e.type === 'block') incoming[e.target].push(i);
  });
  const yaw = { kor: yawTrack(r.frames, 'kor'), ayaz: yawTrack(r.frames, 'ayaz'), ref: yawTrack(r.frames, 'ref') };
  const kicks = { kor: planKicks(r.frames, 'kor', yaw.kor), ayaz: planKicks(r.frames, 'ayaz', yaw.ayaz) }, kickAt = new Map<string, KickPlan>();
  for (const id of FIGHTERS) for (const k of kicks[id]) kickAt.set(`${id}:${k.k0}`, k);
  const value: Index = { n: r.frames.length, resolution, incoming, yaw, feet: { kor: planFeet(r.frames, 'kor', yaw.kor, kicks.kor), ayaz: planFeet(r.frames, 'ayaz', yaw.ayaz, kicks.ayaz), ref: planFeet(r.frames, 'ref', yaw.ref) }, impactAt: new Map(), kicks, kickAt };
  cache.set(r.frames, value);
  return value;
}

// ---- IK ------------------------------------------------------------------------------------------
/** Two-bone IK: the middle joint bends toward `pole`; an unreachable target gives a straight limb. A target nearer than 24% of
 * the limb is pushed out to that distance: a fully folded limb has no stable bend direction and the elbow or knee would flip. */
export function ik2(root: V3, target: V3, a: number, b: number, pole: V3): { mid: V3; end: V3 } {
  const d = sub(target, root), L = len(d), dir = L > 1e-6 ? mul(d, 1 / L) : v(0, -1, 0);
  const Lc = clamp(L, Math.max(Math.abs(a - b) + 1e-3, (a + b) * .24), (a + b) * .9995), end = madd(root, dir, Lc);
  const x = (a * a - b * b + Lc * Lc) / (2 * Lc), h = Math.sqrt(Math.max(0, a * a - x * x));
  let p = sub(pole, mul(dir, dot(pole, dir)));
  if (len(p) < 1e-6) p = Math.abs(dir.y) < .9 ? v(0, 1, 0) : v(1, 0, 0);
  return { mid: madd(madd(root, dir, x), norm(p), h), end };
}

// ---- pose parameters -------------------------------------------------------------------------------
/** Additive body parameters (radians and metres) that every layer contributes to. sh*: shoulder lift, sf*: shoulder protraction. */
type Params = { psi: number; hipPsi: number; lean: number; side: number; crouch: number; pf: number; ps: number; hF: number; hS: number; hY: number; hYaw: number; hPitch: number; guard: number; drop: number; relax: number; clinch: number; gloveBack: number; shL: number; shR: number; sfL: number; sfR: number };
const ZERO: Params = { psi: 0, hipPsi: 0, lean: 0, side: 0, crouch: 0, pf: 0, ps: 0, hF: 0, hS: 0, hY: 0, hYaw: 0, hPitch: 0, guard: 0, drop: 0, relax: 0, clinch: 0, gloveBack: 0, shL: 0, shR: 0, sfL: 0, sfR: 0 };
const addP = (p: Params, d: Partial<Params>, k: number) => { if (!k) return p; const o = { ...p }; for (const key of Object.keys(d) as (keyof Params)[]) o[key] += (d[key] ?? 0) * k; return o; };
const STYLE: Record<FighterId, Partial<Params>> = {
  kor: { psi: -.42, hipPsi: -.28, lean: .17, crouch: .085, hPitch: .2 },
  ayaz: { psi: -.5, hipPsi: -.36, lean: .09, crouch: .05, hPitch: .1 },
};
const BOUNCE_HZ: Record<FighterId, number> = { kor: 1.8, ayaz: 2.25 };

/** Body mechanics per technique at full drive (anticipation is the `load` set). `hand` is the side of the limb (l = lead). */
const MECH: Record<V5Strike, { load: Partial<Params>; drive: Partial<Params>; hand: 'l' | 'r' }> = {
  jab: { hand: 'l', load: { psi: .05, crouch: .012, shR: .015 }, drive: { psi: -.16, lean: .08, pf: .06, hS: -.05, sfL: .1, shL: .025, shR: -.015, hPitch: .05 } },
  cross: { hand: 'r', load: { psi: -.1, crouch: .025, sfL: .02 }, drive: { psi: .84, hipPsi: .55, lean: .12, pf: .07, hS: .05, sfR: .13, shR: .025, sfL: -.05, ps: .015 } },
  leadHook: { hand: 'l', load: { psi: .18, crouch: .03, side: .06, sfR: .03 }, drive: { psi: -.5, hipPsi: -.3, lean: .06, side: -.08, pf: .03, sfL: .07, shL: .04, hS: -.03 } },
  rearHook: { hand: 'r', load: { psi: -.14, crouch: .03, sfL: .03 }, drive: { psi: .72, hipPsi: .45, lean: .08, side: .08, pf: .04, sfR: .08, shR: .04, sfL: -.05, hS: .04 } },
  uppercut: { hand: 'r', load: { crouch: .11, lean: .12, psi: -.1, side: -.06 }, drive: { crouch: -.04, psi: .5, hipPsi: .32, lean: -.02, pf: .03, hPitch: -.12, sfR: .06, shR: .06 } },
  bodyHook: { hand: 'l', load: { crouch: .08, side: .08, psi: .1 }, drive: { crouch: .12, side: .14, psi: -.42, hipPsi: -.25, lean: .16, pf: .03, hS: .05, sfL: .07, shL: -.04 } },
  teep: { hand: 'l', load: { crouch: .012, lean: .02, psi: .05 }, drive: { lean: -.2, psi: .05, hPitch: .08, sfR: -.04 } },
  lowKick: { hand: 'r', load: { psi: -.2, crouch: .04, lean: .03 }, drive: { psi: .9, hipPsi: .8, lean: .12, crouch: .09, side: .06, sfR: .06 } },
  bodyKick: { hand: 'r', load: { psi: -.2, crouch: .03 }, drive: { psi: .95, hipPsi: .9, lean: -.12, side: .15, crouch: -.04, sfR: .05 } },
  headKick: { hand: 'r', load: { psi: -.24, crouch: .05 }, drive: { psi: .85, hipPsi: 1, lean: -.48, side: .26, hPitch: -.08, crouch: -.15 } },
  knee: { hand: 'r', load: { crouch: .07, lean: .1 }, drive: { lean: .22, crouch: .04, hPitch: .25, psi: .3, hipPsi: .4 } },
};
type StrikeT = { technique: V5Strike; age: number; load: number; drive: number; turn: number; u: number; res: V5Event | null; tick: number; kick: KickPlan | null; chamber: number; x: number };
/** Load, a snap that lands exactly on the contact tick, a short hold, then a quick return. */
function strikeTiming(technique: V5Strike, age: number, landed: boolean) {
  const s = V5_STRIKES[technique], W = s.wind, snap = Math.min(W - .2, s.kind === 'straight' ? 1.9 : 2.5), hold = landed ? 1.1 : .55, back = Math.max(2, s.end - W - hold - .4);
  // The body turns over the whole wind-up (hips first); the glove snaps in the last ticks.
  const turn = age < W ? smooth(age / W) : age < W + hold ? 1 : 1 - smooth((age - W - hold) / back);
  const load = age < W ? smooth(age / (W * .45)) * (1 - turn) : 0;
  const drive = age < W - snap ? 0 : age < W ? ((age - (W - snap)) / snap) ** 2 : age < W + hold ? 1 : 1 - smooth((age - W - hold) / back);
  // The glove accelerates all the way into contact (zero speed at the start of the snap, fastest at contact).
  const x = clamp((age - (W - snap)) / snap), u = age < W - snap ? 0 : age < W ? .6 * x ** 1.4 + .4 * smooth(x) : 1;
  return { load, drive, turn, u };
}
/** Where on the shin (fraction of the shin from the ankle) each roundhouse lands: the head kick lands with the instep. */
const KFRAC: Record<V5Kick, number> = { teep: 0, lowKick: .4, bodyKick: .35, headKick: .12, knee: 0 };
/** Kick timing. The foot follows one cubic path from the planted spot through the chamber to the contact point, reaching
 * it exactly on the contact tick (u = 1 at age = wind) with a time law that accelerates all the way in; the return runs the
 * same path backwards, so no joint moves more than ~15 cm per 60 Hz frame. */
function kickTiming(technique: V5Kick, age: number, landed: boolean) {
  const s = V5_STRIKES[technique], W = s.wind, hold = landed ? 1 : .5, back = Math.max(3, s.end - W - hold - .3);
  const turn = age < W ? smooth(age / W) : age < W + hold ? 1 : 1 - smooth((age - W - hold) / back);
  const load = age < W ? smooth(age / (W * .45)) * (1 - turn) : 0;
  const x = clamp(age / W), u = age < W ? .35 * smooth(x) + .65 * x ** 1.6 : 1, ret = age < W + hold ? 0 : clamp((age - W - hold) / back);
  const drive = age < W * .4 ? 0 : age < W ? ((age - W * .4) / (W * .6)) ** 2 : age < W + hold ? 1 : 1 - smooth(ret);
  return { load, drive, turn, u, chamber: smooth(age / (W * .5)), x: ret };
}

// ---- one fighter -----------------------------------------------------------------------------------
type Ctx = { r: RingReplay; ix: Index; tick: number; i: number; clockS: number; o: RingOptions };
type Pass = { root: V3; yaw: number; P: Params; body: Body; strike: StrikeT | null; prevStrike: { st: StrikeT; w: number } | null; headBase: V3; headRest: V3; /** Pelvis and trunk axis without the recoil of blows taken: where a body blow is aimed. */ restPelvis: V3; restTU: V3 };

function layerFor(ctx: Ctx, id: FighterId, a: V5Frame['kor'], age: number): Partial<Params> {
  const span = Math.max(2, a.until - a.actionAt);
  const env = (fin: number, fout: number) => Math.min(smooth(age / fin), smooth((span - age) / fout));
  const dir = a.actionAt % 2 ? 1 : -1;
  switch (a.action) {
    case 'guard': return mulP({ guard: 1, crouch: .03, hPitch: .16, lean: .05 }, smooth(age / 2));
    case 'advance': return mulP({ lean: .06, crouch: -.01 }, smooth(age / 2));
    case 'retreat': return mulP({ lean: -.05, hPitch: .05 }, smooth(age / 2));
    case 'circle': return mulP({ lean: .02 }, smooth(age / 2));
    case 'slip': { const w = env(2, 3.5); return mulP({ hS: .12 * dir, side: .2 * dir, crouch: .06, lean: .1, psi: .12 * dir, shL: .02 * dir, shR: -.02 * dir }, w); }
    case 'roll': { const k = clamp(age / span), w = Math.sin(Math.PI * k); return { crouch: .18 * w, lean: .24 * w, hS: dir * .16 * Math.cos(Math.PI * k) * w, side: dir * .22 * Math.cos(Math.PI * k) * w, guard: .7 * w, hPitch: .1 * w }; }
    case 'stagger': { const w = smooth(age / 1.5) * (1 - smooth((age - span + 2.5) / 2.5)), wob = Math.sin(ctx.clockS * 9 + (id === 'kor' ? 0 : 2)); return mulP({ lean: -.2, hF: -.04, hPitch: -.25, drop: .2, crouch: .09 + .04 * wob, side: .1 * wob, pf: -.04, hYaw: .25 * wob }, w); }
    case 'clinch': { const w = Math.min(smooth(age / 5), smooth((a.until - ctx.tick) / 4)); return mulP({ lean: .42, crouch: .07, pf: .06, hS: .13, hPitch: .3, clinch: 1, psi: .35 }, w); }
    case 'neutral': return mulP({ relax: 1, lean: -.06, psi: .45, hipPsi: .3, hPitch: -.05 }, smooth(age / 4));
    default: return {};
  }
}
const mulP = (d: Partial<Params>, k: number): Partial<Params> => { const o: Partial<Params> = {}; for (const key of Object.keys(d) as (keyof Params)[]) o[key] = (d[key] ?? 0) * k; return o; };

function strikeOf(ctx: Ctx, id: FighterId, a: V5Frame['kor'], ageCap = Infinity): StrikeT | null {
  if (!isStrike(a.action)) return null;
  const res = ctx.ix.resolution.get(`${id}:${a.actionAt}`) ?? null, landed = res?.type === 'hit' || res?.type === 'block';
  const age = Math.min(ctx.tick - a.actionAt, isV5Kick(a.action) ? ageCap : Infinity);
  if (isV5Kick(a.action)) {
    const t = kickTiming(a.action, age, landed);
    return { technique: a.action, age, load: t.load, drive: t.drive, turn: t.turn, u: t.u, res, tick: a.actionAt, kick: ctx.ix.kickAt.get(`${id}:${a.actionAt}`) ?? null, chamber: t.chamber, x: t.x };
  }
  const t = strikeTiming(a.action, age, landed);
  return { technique: a.action, age, load: t.load, drive: t.drive, turn: t.turn, u: t.u, res, tick: a.actionAt, kick: null, chamber: 0, x: 0 };
}

/** Additive reaction to blows taken: a fast snap in the blow's direction, a slower settle.
 * Punches snap the head; low kicks buckle the leg; body kicks and knees fold the trunk; head kicks whip the head
 * and tilt the body; the teep pushes the trunk back. */
function reactions(ctx: Ctx, id: FighterId, F: V3, L: V3, p: Params): { p: Params; push: V3 } {
  let out = p, push = v(0, 0, 0);
  for (const n of ctx.ix.incoming[id]) {
    const e = ctx.r.events[n]!, s = (ctx.tick - e.tick) * TICK_MS / 1000;
    if (s <= 0 || s > 1.2) continue;
    const snap = (s / .1) * Math.exp(1 - s / .1), settle = Math.exp(-s / .35) * Math.sin(s * 11) * .25, g = snap + settle;
    const k = e.type === 'block' ? .45 : clamp(e.damage / 34, .45, 1.35) * (e.counter ? 1.15 : 1);
    const tech = e.technique as V5Strike, spec = V5_STRIKES[tech];
    if (!spec) continue;
    // Direction of the blow in the target's frame: straights drive back, hooks sweep across, uppercuts lift.
    const across = MECH[tech].hand === 'l' ? 1 : -1, kick = isV5Kick(tech); // the attacker's left limb sweeps toward the target's left
    const dirS = spec.kind === 'hook' ? across : 0, dirF = spec.kind === 'upper' ? -.4 : spec.kind === 'hook' ? -.35 : -1;
    const slow = (s / .13) * Math.exp(1 - s / .13) + settle;
    if (e.type === 'block') { out = addP(out, { lean: -.06, hF: -.03, gloveBack: .07, crouch: .01, shL: .02, shR: .02 }, g * k); continue; }
    if (e.bodyPart === 'leg') { out = addP(out, { crouch: .12, ps: -.05 * across, side: -.07 * across, lean: .05, drop: .05, hF: .02 }, slow * k); continue; }
    if (e.bodyPart === 'body') {
      if (tech === 'teep') { out = addP(out, { lean: .2, crouch: .05, hF: .07, drop: .12, pf: -.09, hPitch: .12 }, slow * k); push = add(push, mul(F, -.06 * k * g)); continue; }
      if (kick) { out = addP(out, { lean: .34, crouch: .1, hF: .06, side: -.15 * across, drop: .18, psi: -.14 * across, hPitch: .1 }, slow * k); continue; }
      out = addP(out, { lean: .22, crouch: .07, hF: .04, side: -.12 * across, drop: .12, psi: -.12 * across }, slow * k); continue;
    }
    if (kick) {
      out = addP(out, { hF: -.04, hS: .1 * dirS, hY: .01, hYaw: .95 * dirS, hPitch: -.32, lean: -.05, side: .13 * dirS, drop: .08, shL: .03, shR: -.03 }, g * k);
      push = add(push, mul(L, .03 * k * g * dirS)); continue;
    }
    out = addP(out, { hF: .1 * dirF, hS: .1 * dirS, hY: spec.kind === 'upper' ? .06 : .01, hYaw: .9 * dirS, hPitch: spec.kind === 'upper' ? -.6 : -.32, lean: -.1 + (spec.kind === 'hook' ? .04 : 0), side: .12 * dirS, drop: .06, shL: .02 * dirS, shR: -.02 * dirS }, g * k);
    push = add(push, mul(add(mul(F, dirF), mul(L, dirS)), .03 * k * g));
  }
  return { p: out, push };
}

const pose = (d: Dims, root: V3, yaw: number, P: Params, feet: { l: V3; r: V3 }, kneePole: V3 | null = null, legPoles: { l?: V3; r?: V3 } | null = null, planted: { feet: { l: V3; r: V3 }; foot: 'l' | 'r'; k: number } | null = null) => {
  const F = heading(yaw), L = heading(yaw + Math.PI / 2), legs = d.thigh + d.shin;
  let pelvis = v(root.x, d.thigh + d.shin + d.ankle - .02 - P.crouch, root.z);
  pelvis = madd(madd(pelvis, F, P.pf), L, P.ps);
  const hL = heading(yaw + P.hipPsi + Math.PI / 2), lH0 = madd(pelvis, hL, d.hip), rH0 = madd(pelvis, hL, -d.hip);
  // Lower the pelvis when a wide step would otherwise lock the knee straight and lift the heel.
  let drop = 0;
  // While a kick lifts a foot, that foot's share of the drop fades out with the lift, so the pelvis never pops up.
  for (const [h, f, side] of [[lH0, planted?.feet.l ?? feet.l, 'l'], [rH0, planted?.feet.r ?? feet.r, 'r']] as const) {
    const ankle = v(f.x, f.y + d.ankle, f.z), dh = Math.hypot(h.x - ankle.x, h.z - ankle.z), maxY = ankle.y + Math.sqrt(Math.max(0, (legs * .985) ** 2 - dh * dh));
    drop = Math.max(drop, (h.y - maxY) * (planted && planted.foot === side ? 1 - planted.k : 1));
  }
  // At most 12 cm: beyond that the leg straightens and the foot is pulled along instead.
  pelvis = v(pelvis.x, pelvis.y - Math.min(.12, drop), pelvis.z);
  const lH = madd(pelvis, hL, d.hip), rH = madd(pelvis, hL, -d.hip);
  const tF = heading(yaw + P.psi), tL0 = heading(yaw + P.psi + Math.PI / 2);
  const tU = norm(add(add(UP, mul(F, Math.tan(clamp(P.lean, -1.45, 1.2)))), mul(L, Math.tan(clamp(P.side, -.8, .8)))));
  const tL = norm(sub(tL0, mul(tU, dot(tL0, tU))));
  const chest = madd(pelvis, tU, d.torso * .62), neck = madd(pelvis, tU, d.torso), sc = madd(pelvis, tU, d.torso - .045);
  const lS = madd(madd(madd(sc, tL, d.shoulder), UP, P.shL), tF, P.sfL), rS = madd(madd(madd(sc, tL, -d.shoulder), UP, P.shR), tF, P.sfR);
  const headUp = norm(add(tU, mul(F, -P.hPitch * .6)));
  let head = madd(neck, headUp, d.neck + d.headR * .92);
  head = madd(madd(madd(head, F, P.hF), L, P.hS), UP, P.hY);
  const faceYaw = yaw + P.hYaw, face = norm(add(heading(faceYaw), mul(UP, -P.hPitch * .5)));
  const pole = kneePole ?? add(F, mul(UP, .1));
  const legL = ik2(lH, v(feet.l.x, feet.l.y + d.ankle, feet.l.z), d.thigh, d.shin, legPoles?.l ?? add(pole, mul(L, .25)));
  const legR = ik2(rH, v(feet.r.x, feet.r.y + d.ankle, feet.r.z), d.thigh, d.shin, legPoles?.r ?? add(pole, mul(L, -.3)));
  return { F, L, tF, tL, tU, pelvis, chest, neck, lS, rS, head, headUp, face, lH, rH, lK: legL.mid, lA: legL.end, rK: legR.mid, rA: legR.end };
};
type Skel = ReturnType<typeof pose>;

/** Guard glove positions for this body (hand-authored per fighter). */
function guardGloves(id: Who, s: Skel, P: Params): { l: V3; r: V3 } {
  const { F, L } = s;
  const lo = id === 'ayaz' ? { f: .34, s: .07, y: -.05 } : { f: .27, s: .06, y: .05 };
  let l = madd(madd(madd(s.neck, F, lo.f), L, lo.s), UP, lo.y), r = madd(madd(madd(s.neck, F, .15), L, -.12), UP, .03);
  if (P.guard > 0) { l = lerp(l, madd(madd(madd(s.head, F, .17), L, .08), UP, -.03), clamp(P.guard)); r = lerp(r, madd(madd(madd(s.head, F, .15), L, -.08), UP, -.04), clamp(P.guard)); }
  if (P.relax > 0) { l = lerp(l, madd(madd(madd(s.pelvis, F, .16), L, .2), UP, .12), clamp(P.relax)); r = lerp(r, madd(madd(madd(s.pelvis, F, .12), L, -.2), UP, .12), clamp(P.relax)); }
  l = madd(madd(l, UP, -P.drop), F, -P.gloveBack); r = madd(madd(r, UP, -P.drop), F, -P.gloveBack);
  // Guard gloves stay well in front of their shoulders (a bent arm, never folded back on itself).
  const ahead = (g: V3, sh: V3) => { const f = dot(sub(g, sh), F), min = .26 * (1 - clamp(P.relax)); return f < min ? madd(g, F, min - f) : g; };
  return { l: ahead(l, s.lS), r: ahead(r, s.rS) };
}

/** Glove target and arc control point for a strike, aimed at the opponent's recorded outcome. */
function strikePath(id: FighterId, st: StrikeT, me: Skel, guard: V3, opp: Pass, plan: boolean): { target: V3; control: V3; pole: V3 } {
  const spec = V5_STRIKES[st.technique], hand = MECH[st.technique].hand, sh = hand === 'l' ? me.lS : me.rS;
  const side = hand === 'l' ? me.L : mul(me.L, -1), d = DIMS[id], od = opp.body.dims;
  const o = opp.body.j, part = !st.res ? 'miss' : st.res.type === 'hit' ? (st.res.bodyPart === 'body' ? 'body' : 'head') : st.res.type === 'block' ? 'guard' : st.res.type === 'dodge' ? 'dodge' : 'miss';
  // Direction the glove travels at contact: forward for straights, across for hooks, upward for the uppercut.
  const across = mul(side, -1);
  const travel = spec.kind === 'straight' ? norm(sub(o.head, sh)) : spec.kind === 'hook' ? norm(add(mul(across, .9), mul(me.F, .45))) : norm(add(UP, mul(me.F, .55)));
  const liver = madd(madd(opp.restPelvis, opp.restTU, od.torso * .36), opp.body.L, -.06), chest = madd(opp.restPelvis, opp.restTU, od.torso * .6);
  let target: V3;
  if (part === 'head') target = madd(plan ? opp.headRest : o.head, travel, -(od.headR + d.glove) * .98);
  else if (part === 'body') target = madd(st.technique === 'bodyHook' ? liver : chest, travel, -(.13 * od.chest + d.glove));
  else if (part === 'guard') {
    // A blocked blow stops on the guard just in front of the part it was aimed at. (Chasing whichever glove is nearest made the
    // target jump between the two gloves.)
    const aimed = spec.target === 'body' ? liver : opp.headRest, r = spec.target === 'body' ? .13 * od.chest : od.headR;
    target = madd(aimed, travel, -(r + d.glove) * .98 + .09);
  } else {
    // Missed or slipped: the glove goes where the head stood in stance and carries on past it.
    const aim = spec.target === 'body' ? liver : opp.headBase;
    target = madd(aim, travel, part === 'dodge' ? .05 : .12);
  }
  const mid = lerp(guard, target, .5);
  const control = spec.kind === 'straight' ? madd(mid, UP, .03)
    : spec.kind === 'hook' ? madd(madd(madd(sh, side, .42), me.F, .12), UP, (target.y - sh.y) * .6)
    : st.technique === 'uppercut' ? madd(madd(guard, UP, -.32), me.F, .06)
    : madd(madd(madd(sh, side, .36), me.F, .08), UP, -.32);
  const pole = spec.kind === 'straight' ? add(mul(UP, -1), mul(side, .5)) : spec.kind === 'hook' ? add(mul(side, 1), mul(UP, .55)) : st.technique === 'uppercut' ? add(mul(UP, -1), mul(me.F, -.3)) : add(side, mul(UP, -.2));
  return { target, control, pole };
}
/** Resting elbow direction: out to the side and down, a little back; blended toward clinch and floor poses. */
function armPole(s: Skel, hand: 'l' | 'r', P: Params, downAge = -1): V3 {
  const side = hand === 'l' ? s.L : mul(s.L, -1);
  let p = norm(add(add(side, mul(UP, -.6)), mul(s.F, -.3)));
  if (P.clinch > 0) p = norm(lerp(p, norm(add(side, mul(UP, .2))), clamp(P.clinch)));
  if (downAge > 0) p = norm(lerp(p, norm(add(side, UP)), smooth((downAge - .2) / .5)));
  return p;
}
const bezier = (a: V3, c: V3, b: V3, u: number) => add(add(mul(a, (1 - u) ** 2), mul(c, 2 * (1 - u) * u)), mul(b, u * u));

// ---- kicks and knee ---------------------------------------------------------------------------------
type KickOut = { kw: number; foot: 'l' | 'r'; footPos: V3; poles: { l?: V3; r?: V3 }; flex: boolean; toeDir: V3; travel: V3; need: number; contact: V3 };
/** The point a kick must reach (on the limb's axis, so already offset from the target surface) and the travel direction. */
function kickTarget(st: StrikeT, me: Skel, opp: Pass, foot: 'l' | 'r'): { contact: V3; travel: V3 } {
  const tech = st.technique as V5Kick, spec = V5_STRIKES[tech], od = opp.body.dims, o = opp.body.j, res = st.res;
  const part = !res ? 'miss' : res.type === 'hit' ? (res.bodyPart === 'leg' ? 'leg' : res.bodyPart === 'body' ? 'body' : 'head') : res.type === 'block' ? 'guard' : res.type === 'dodge' ? 'dodge' : 'miss';
  const across = foot === 'l' ? mul(me.L, -1) : me.L, toward = norm(flat(sub(o.pelvis, me.pelvis))), round = tech !== 'teep' && tech !== 'knee';
  const travel = round ? norm(add(mul(across, .9), mul(me.F, .45))) : tech === 'teep' ? norm(add(toward, v(0, .12, 0))) : norm(add(mul(toward, .6), mul(UP, .8)));
  const shin = .045;
  const aim = (p: 'head' | 'body' | 'leg'): { c: V3; r: number } => {
    if (p === 'head') return { c: opp.headRest, r: od.headR }; // the head at rest: recoil after the blow must not drag the kick along
    if (p === 'leg') return { c: lerp(o.lH, o.lK, .42), r: .085 * od.limb };
    return { c: tech === 'teep' ? madd(o.pelvis, opp.body.tU, od.torso * .42) : madd(madd(o.pelvis, opp.body.tU, od.torso * .36), opp.body.L, -.06), r: .13 * od.chest };
  };
  // A blocked kick stops on the forearms about 7 cm in front of the surface it was aimed at.
  const t = aim(part === 'head' || part === 'body' || part === 'leg' ? part : spec.target), base = t.c;
  const c = base;
  return { contact: madd(c, travel, -(t.r + shin) + (part === 'dodge' ? .06 : part === 'miss' ? .16 : part === 'guard' ? .07 : 0)), travel };
}
/** Kicking-foot placement for this frame: chamber, snap, hold, re-chamber, set down. `need` is how much farther the hip must travel. */
function kickFoot(id: FighterId, st: StrikeT, w: number, sk: Skel, feet: { l: V3; r: V3 }, opp: Pass, plan: boolean): KickOut {
  const d = DIMS[id], kp = st.kick!, foot = kp.foot, tech = st.technique as V5Kick, hip = foot === 'l' ? sk.lH : sk.rH, F = sk.F, out = foot === 'l' ? sk.L : mul(sk.L, -1);
  const sc = (d.thigh + d.shin) / .89, legs = d.thigh + d.shin, tg = kickTarget(st, sk, opp, foot);
  // The knee bends upward and a little forward: never parallel to the hip-to-ankle line for any kick (a flipping pole pops the knee).
  // Knee bend, choreographed on the kick's own progress rather than on the leg direction (which sweeps through every angle and makes
  // any direction-based pole flip somewhere): forward while the leg is chambered (the foot is behind or beside the hip), up as it
  // extends (the foot is out in front). Along the path the pole stays across the leg, and it is continuous because the path is.
  const sPole = st.x > 0 ? 1 - smooth(st.x) : st.u, kneePole = add(add(mul(F, 1 - sPole + .15), mul(UP, sPole + (tech === 'teep' || tech === 'knee' ? .5 * (1 - sPole) : 0))), v(0, 0, 0));
  const restPole = norm(add(add(F, mul(UP, .1)), mul(sk.L, foot === 'l' ? .25 : -.3)));
  // Blended in with the chamber and out with the return, so the knee never swings between two bend directions.
  const kw = clamp(w) * st.chamber * (1 - smooth(st.x)), poleFor = (_A: V3) => norm(lerp(restPole, norm(kneePole), kw));
  const flex = tech === 'teep', tdf = norm(add(mul(UP, .85), mul(tg.travel, .5)));
  const S = (A: V3) => { if (flex) return madd(A, tdf, .85 * d.foot); const k = ik2(hip, A, d.thigh, d.shin, poleFor(A)).mid; return tech === 'knee' ? k : lerp(A, k, KFRAC[tech]); };
  const cap = (a: V3, m: number) => { const l = len(a); return l > m ? mul(a, m / l) : a; };
  // Roundhouse: the ankle sits 35% of a shin past the contact point, along the travel direction when the leg is folded
  // (close target) and along the hip-to-contact ray when it is stretched. A short correction polishes the stretched case.
  const hc = sub(tg.contact, hip), ext = clamp((len(hc) - .35) / .4);
  let At = flex ? madd(tg.contact, tdf, -.85 * d.foot) : tech === 'knee' ? madd(madd(tg.contact, UP, -.33 * sc), tg.travel, -.1) : madd(tg.contact, norm(lerp(tg.travel, norm(hc), ext)), KFRAC[tech] * d.shin);
  if (flex) { /* the ball of the foot is the contact: exact by construction */ }
  else if (tech !== 'knee') for (let i = 0; i < 4; i++) At = add(At, mul(cap(sub(tg.contact, S(At)), .08), .7));
  const need = tech === 'knee' ? len(sub(tg.contact, hip)) - (d.thigh + .02) : Math.max(0, len(sub(At, hip)) - legs * .97);
  const P0 = v(feet[foot].x, feet[foot].y + d.ankle, feet[foot].z);
  const Pc = tech === 'teep' ? madd(madd(hip, F, .3 * sc), UP, -.4 * sc)
    : tech === 'lowKick' ? madd(P0, UP, .22)
    : tech === 'bodyKick' ? madd(madd(madd(hip, F, -.12 * sc), out, .14 * sc), UP, -.42 * sc)
    : tech === 'headKick' ? madd(madd(madd(hip, F, -.12 * sc), out, .16 * sc), UP, -.26 * sc)
    : madd(madd(hip, F, -.08 * sc), UP, -.6 * sc);
  const mid = lerp(Pc, At, .5), C2 = tech === 'teep' ? madd(lerp(Pc, At, .55), UP, .03) : tech === 'knee' ? madd(lerp(Pc, At, .6), F, .1) : madd(madd(mid, out, .5 * sc), UP, .08);
  const C1 = tech === 'lowKick' ? madd(madd(P0, F, -.05), UP, .22) : (tech === 'bodyKick' || tech === 'headKick') ? madd(Pc, out, .2 * sc) : Pc;
  const sPath = st.x > 0 ? 1 - smooth(st.x) : st.u, q = 1 - sPath;
  let A = add(add(mul(P0, q ** 3), mul(C1, 3 * q * q * sPath)), add(mul(C2, 3 * q * sPath * sPath), mul(At, sPath ** 3)));
  // The ankle never folds in on the hip: the knee would swing around it.
  const rel = sub(A, hip), rl = len(rel), minR = tech === 'teep' || tech === 'knee' ? .3 : .34;
  if (rl < minR) A = madd(hip, rl > 1e-3 ? mul(rel, 1 / rl) : out, minR);
  const Aw = lerp(P0, A, clamp(w));
  return { kw, foot, footPos: v(Aw.x, Math.max(0, Aw.y - d.ankle), Aw.z), poles: { [foot]: poleFor(Aw) }, flex, toeDir: tdf, travel: tg.travel, need, contact: tg.contact };
}
/** Arms during a kick: the kicking-side arm swings for balance, the other covers the head; a knee reaches for the neck. */
function kickArms(st: StrikeT, w: number, sk: Skel, G: { l: V3; r: V3 }, poles: { l: V3 | null; r: V3 | null }, opp: Pass) {
  const kp = st.kick!, F = sk.F, L = sk.L, dv = clamp(Math.max(st.chamber * .5, st.drive) * (1 - st.x)) * w, tech = st.technique as V5Kick;
  const cover = (side: 1 | -1) => madd(madd(madd(sk.head, F, .17), L, .08 * side), UP, -.03);
  if (tech === 'knee') {
    const o = opp.body.j, on = clamp(st.turn * 1.4) * w;
    G.l = lerp(G.l, madd(madd(o.neck, L, .13), UP, -.02), on); G.r = lerp(G.r, madd(madd(o.neck, L, -.13), UP, -.02), on);
    return;
  }
  const hang = (arm: 'l' | 'r', k: number) => {
    // The arm drops and swings back along the body, the elbow out to the side.
    const sw = arm === 'r' ? -1 : 1, shoulder = arm === 'l' ? sk.lS : sk.rS;
    G[arm] = lerp(G[arm], madd(madd(madd(shoulder, F, -.2), L, .12 * sw), UP, -.4), k);
    poles[arm] = norm(add(mul(L, sw), mul(F, -.3)));
  };
  if (tech === 'teep') { hang('r', dv * .8); G.l = lerp(G.l, cover(1), dv * .5); return; }
  const arm = kp.foot;
  hang(arm, dv * .9);
  const other = arm === 'l' ? 'r' : 'l'; G[other] = lerp(G[other], cover(other === 'l' ? 1 : -1), dv * .7);
}


function solveFighter(ctx: Ctx, id: FighterId, opp: Pass | null): Pass {
  const { r, ix, tick, i, clockS, o } = ctx, f = r.frames[i]![id], d = DIMS[id];
  const root = rootAt(r.frames, id, tick);
  const yaw = yawFrom(ix.yaw[id], tick);
  const age = tick - f.actionAt;
  const F = heading(yaw), L = heading(yaw + Math.PI / 2);
  // Base stance, rhythm, fatigue.
  let P = addP(ZERO, STYLE[id], 1);
  const tired = clamp(1 - f.stamina / 1000), off = id === 'kor' ? 0 : 1.3, hz = BOUNCE_HZ[id] * (1 - .3 * tired);
  const bounce = (1 - Math.cos((clockS + off) * Math.PI * 2 * hz)) / 2;
  P = addP(P, { crouch: .016 * bounce * (1 - .5 * tired), hY: -.006 * bounce, ps: .012 * Math.sin((clockS + off) * Math.PI * hz) }, 1);
  P = addP(P, { drop: .1 * clamp((tired - .45) / .4), lean: .05 * tired }, 1);
  if (f.health < 300) P = addP(P, { hPitch: .15 * (1 - f.health / 300), drop: .05 }, 1);
  const speed = o.phase === 'fighting' ? speedAt(r.frames, id, tick) : 0;
  // Action layers: the current one fades in while the previous one finishes, so nothing pops.
  const prevF = f.actionAt > 0 && i > 0 ? r.frames[Math.max(0, f.actionAt - 1)]![id] : null;
  const fadeSpan = isStrike(f.action) ? 2 : prevF && isStrike(prevF.action) ? 3.5 : 2.5, fade = prevF ? smooth(age / fadeSpan) : 1;
  if (o.phase === 'fighting' && f.action !== 'down' && f.action !== 'rise') {
    P = addP(P, layerFor(ctx, id, f, age), fade);
    if (prevF && fade < 1 && !isStrike(prevF.action)) P = addP(P, layerFor(ctx, id, prevF, tick - prevF.actionAt), 1 - fade);
  }
  const strike = o.phase === 'fighting' ? strikeOf(ctx, id, f) : null;
  const prevStrikeT = o.phase === 'fighting' && prevF && fade < 1 && isStrike(prevF.action) ? strikeOf(ctx, id, prevF, f.actionAt - prevF.actionAt) : null;
  const prevStrike = prevStrikeT ? { st: prevStrikeT, w: 1 - fade } : null;
  const strikes: { st: StrikeT; w: number }[] = [];
  if (strike) strikes.push({ st: strike, w: 1 }); if (prevStrike) strikes.push(prevStrike);
  for (const s of strikes) {
    const m = MECH[s.st.technique], kk = s.st.turn * s.w;
    P = addP(addP(P, m.load, s.st.load * s.w), m.drive, kk);
    if (s.st.kick) P = addP(P, { pf: s.st.kick.lunge * .9 }, kk);
  }
  // Idle warm-up: shadow combinations into empty air in front of the fighter.
  let idle: StrikeT | null = null;
  if (o.phase === 'idle') {
    const seq: V5Strike[] = id === 'kor' ? ['jab', 'cross', 'leadHook'] : ['jab', 'jab', 'cross'], cyc = ((clockS + (id === 'kor' ? 0 : 1.4)) % 3.2) / (TICK_MS / 1000);
    let start = 0;
    for (const s of seq) { const end = V5_STRIKES[s].end - 1; if (cyc >= start && cyc < start + end) { const t = strikeTiming(s, cyc - start, false); idle = { technique: s, age: cyc - start, load: t.load, drive: t.drive, turn: t.turn, u: t.u, res: null, tick: 0, kick: null, chamber: 0, x: 0 }; } start += end; }
    if (idle) { const m = MECH[idle.technique]; P = addP(addP(P, m.load, idle.load), m.drive, idle.turn); }
  }
  if (o.phase === 'finished' && o.winner && o.winner !== 'draw' && f.action !== 'down') P = addP(P, o.winner === id ? { lean: -.2, hPitch: -.3, crouch: -.04 } : { lean: .25, hPitch: .45, drop: .25, relax: .6 }, 1);
  P = addP(P, { lean: .06 * clamp(speed / 1.2) * Math.sign(dot(sub(rootAt(r.frames, id, tick + .5), rootAt(r.frames, id, tick - .5)), F) || 0) }, 1);
  const react = o.phase === 'fighting' && f.action !== 'down' && f.action !== 'rise' ? reactions(ctx, id, F, L, P) : { p: P, push: v(0, 0, 0) };
  const Ppre = P;
  P = react.p;
  const Pafter = P;
  const lift = .055 + .03 * clamp(speed / 1.2);
  let feet = { l: footAt(ix.feet[id], 'l', tick, lift), r: footAt(ix.feet[id], 'r', tick, lift) };
  const rootP = add(root, react.push);

  /** Gloves when not punching: guard, a small lead-hand pump, the clinch wrap, the winner's raised arms. */
  const restGloves = (sk: Skel) => {
    const g = guardGloves(id, sk, P), pump = Math.max(0, Math.sin((clockS + off) * 6.1)) ** 6 * (1 - P.guard) * (o.phase === 'finished' ? 0 : 1);
    let l = madd(g.l, F, .05 * pump), rr = g.r;
    if (P.clinch > 0 && opp) {
      const on = opp.body.j, w = clamp(P.clinch);
      l = lerp(l, madd(madd(madd(on.neck, F, .08), L, .17), UP, -.1), w);
      rr = lerp(rr, madd(madd(madd(on.chest, F, .12), L, -.2), UP, -.05), w);
    }
    if (o.phase === 'finished' && o.winner === id) { const b = Math.sin(clockS * 6) * .04; l = madd(madd(sk.lS, UP, .58 + b), L, .12); rr = madd(madd(sk.rS, UP, .56 - b), L, -.12); }
    return { l, r: rr };
  };
  // A kick drives the kicking foot with leg IK; the other foot stays on the planner's planted spot.
  const kickS = strikes.find(s => s.st.kick) ?? null, kref: { v: KickOut | null } = { v: null };
  let kneePole: V3 | null = null;
  const downPoles: { l: V3 | null; r: V3 | null } = { l: null, r: null };
  const build = (plan: boolean): Skel => {
    const sk = pose(d, rootP, yaw, P, feet, kneePole);
    kref.v = null;
    if (!opp || !kickS || f.action === 'down') return sk;
    const ko = kickFoot(id, kickS.st, kickS.w, sk, feet, opp, plan);
    kref.v = ko;
    return pose(d, rootP, yaw, P, { ...feet, [ko.foot]: ko.footPos }, kneePole, ko.poles, { feet, foot: ko.foot, k: ko.kw });
  };
  // Knockdown, count and rise are posed whole (keyframes), with feet and gloves placed explicitly.
  let skel: Skel, gl: V3, gr: V3;
  const downAge = f.action === 'down' ? age * TICK_MS / 1000 : -1;
  if (o.phase !== 'idle' && (f.action === 'down' || f.action === 'rise')) {
    const out = downPose(ctx, id, f, root, yaw, P, opp && kickS ? sk => { const ko = kickFoot(id, kickS.st, kickS.w, sk, feet, opp, false); return { foot: ko.foot, pos: ko.footPos, w: kickS.w, poles: ko.poles }; } : null);
    skel = out.skel; gl = out.gl; gr = out.gr; feet = out.feet; kneePole = out.kneePole;
    if (opp && kickS) { const G = { l: gl, r: gr }; kickArms(kickS.st, kickS.w, skel, G, downPoles, opp); gl = G.l; gr = G.r; }
  } else {
    skel = build(false);
    ({ l: gl, r: gr } = restGloves(skel));
  }
  const headBase = skel.head;
  const restSk = P === Ppre || downAge >= 0 ? skel : pose(d, root, yaw, Ppre, feet);
  let headRest = restSk.head, restPelvis = restSk.pelvis, restTU = restSk.tU;
  // Strike gloves: Bezier arc from the guard to the target; reach the target with hips and lean, never by stretching.
  let effector: Effector = null;
  if (opp && strikes.length && f.action !== 'down') {
    let G = { l: gl, r: gr }, poles: { l: V3 | null; r: V3 | null } = { l: null, r: null };
    const crowd: { technique: V5Strike; k: number }[] = [];
    for (const pass of ['plan', 'final'] as const) {
      G = { l: gl, r: gr }; poles = { l: null, r: null };
      let extra = 0, kneeAdj = 0;
      for (const { st, w } of strikes) {
        if (st.kick) {
          // Kicks: the hips travel as far as the leg still needs (the support foot was stepped under the hip beforehand).
          if (pass === 'plan' && kickS && kickS.st === st) {
            const need = kickFoot(id, st, w, skel, feet, opp, true).need * st.turn * w;
            if (st.technique === 'knee') kneeAdj = clamp(need, -.14, .25); else extra = Math.max(extra, need);
          }
          continue;
        }
        const hand = MECH[st.technique].hand, guard = hand === 'l' ? gl : gr, sh = hand === 'l' ? skel.lS : skel.rS;
        if (pass === 'plan') {
          // One closed-form adjustment per frame, planned on where the target rests (its own recoil
          // excluded) and weighted by the body turn, so the hips and shoulders never jump. A punch that
          // will miss does not chase all the way; at close range the body turns less and gives room.
          const target = strikePath(id, st, skel, guard, opp, true).target, reach = (d.upper + d.fore) * .985, room = len(sub(target, sh));
          const chase = st.res && (st.res.type === 'hit' || st.res.type === 'block') ? 1 : .55;
          if (room > reach) extra = Math.max(extra, (room - reach) * st.turn * w * chase);
          const close = clamp((.46 - room) / .26);
          if (close > 0) crowd.push({ technique: st.technique, k: close * st.turn * w });
          continue;
        }
        const path = strikePath(id, st, skel, guard, opp, false);
        let p: V3;
        const A = lerp(guard, path.control, .12 * st.load * (V5_STRIKES[st.technique].kind === 'straight' ? -.25 : 1));
        if (st.age < V5_STRIKES[st.technique].wind) p = st.u > 0 ? bezier(A, path.control, path.target, st.u) : A;
        else p = lerp(guard, path.target, st.drive);
        G[hand] = lerp(G[hand], p, w);
        // The elbow turns toward the technique's plane as the punch loads and back as it returns.
        const pw = w * clamp(st.load + st.drive * 1.5);
        poles[hand] = norm(lerp(poles[hand] ?? armPole(skel, hand, P), norm(path.pole), pw));
        if (w === 1) effector = { hand, technique: st.technique, drive: st.drive };
      }
      if (pass === 'final') { if (kickS) kickArms(kickS.st, kickS.w, skel, G, poles, opp); break; }
      for (const c of crowd) P = addP(addP(P, MECH[c.technique].drive, -c.k * .85), { pf: -.14, lean: -.04 }, c.k);
      if (extra > 0) P = addP(P, { pf: Math.min(.3, extra * .8), lean: Math.min(.16, extra * .6) }, 1);
      if (kneeAdj) P = addP(P, { pf: kneeAdj * .9 }, 1);
      if (crowd.length || extra > 0 || kneeAdj) {
        skel = build(false);
        ({ l: gl, r: gr } = restGloves(skel));
      }
    }
    gl = G.l; gr = G.r;
    // The head at rest includes the hip and lean this body added to reach (kicks, punches) but none of the recoil, so the
    // opponent's blow is aimed where the head will be when it arrives.
    if (P !== Pafter && downAge < 0) { const Pr = { ...Ppre }; for (const k of Object.keys(Pr) as (keyof Params)[]) Pr[k] += P[k] - Pafter[k]; const rs = pose(d, root, yaw, Pr, feet); headRest = rs.head; restPelvis = rs.pelvis; restTU = rs.tU; }
    return finish(id, f, skel, gl, gr, poles, effector, P, root, yaw, strike, prevStrike, headBase, headRest, d, downAge, kref.v, kickS, restPelvis, restTU);
  }
  if (idle) {
    const hand = MECH[idle.technique].hand, guard = hand === 'l' ? gl : gr, sh = hand === 'l' ? skel.lS : skel.rS;
    const ghost = madd(madd(sh, F, (d.upper + d.fore) * .95), UP, idle.technique === 'uppercut' ? .05 : .02);
    const p = idle.age < V5_STRIKES[idle.technique].wind ? lerp(guard, ghost, idle.u) : lerp(guard, ghost, idle.drive);
    if (hand === 'l') gl = p; else gr = p;
  }
  return finish(id, f, skel, gl, gr, downPoles, effector, P, root, yaw, strike, prevStrike, headBase, headRest, d, downAge, null, null, restPelvis, restTU);
}

type Effector = { hand: 'l' | 'r'; technique: V5Strike; drive: number } | null;
function finish(id: FighterId, f: V5Frame['kor'], s: Skel, gl: V3, gr: V3, poles: { l: V3 | null; r: V3 | null }, effector: Effector, P: Params, root: V3, yaw: number, strike: StrikeT | null, prevStrike: Pass['prevStrike'], headBase: V3, headRest: V3, d: Dims, downAge: number, kick: KickOut | null, kickS: { st: StrikeT; w: number } | null, restPelvis: V3, restTU: V3): Pass {
  const { F, L } = s;
  const la = ik2(s.lS, gl, d.upper, d.fore, poles.l ?? armPole(s, 'l', P, downAge));
  const ra = ik2(s.rS, gr, d.upper, d.fore, poles.r ?? armPole(s, 'r', P, downAge));
  const toe = (a: V3, ang: number) => { const dir = heading(yaw + ang); return v(a.x + dir.x * d.foot, Math.max(.02, a.y - d.ankle + .02), a.z + dir.z * d.foot); };
  // The support foot pivots with the hips; the kicking foot points along the shin (a teep flexes the foot).
  const pivot = kick && kickS ? clamp(kickS.st.turn) * kickS.w * .9 : 0;
  let lT = toe(s.lA, -.22 + (kickS?.st.kick?.support === 'l' ? pivot : 0)), rT = toe(s.rA, -.8 + (kickS?.st.kick?.support === 'r' ? pivot : 0));
  let strikeOut: Body['strike'] = effector ? { ...effector, kick: false, point: effector.hand === 'l' ? la.end : ra.end } : null;
  if (kick && kickS) {
    const A = kick.foot === 'l' ? s.lA : s.rA, K = kick.foot === 'l' ? s.lK : s.rK, T = kick.flex ? madd(A, kick.toeDir, d.foot) : madd(A, norm(sub(A, K)), d.foot * .92);
    if (kick.foot === 'l') lT = lerp(lT, T, kick.kw); else rT = lerp(rT, T, kick.kw);
    const tech = kickS.st.technique as V5Kick;
    if (kickS.st === strike) strikeOut = { hand: kick.foot, technique: tech, drive: kickS.st.drive, kick: true, aim: kick.contact, point: tech === 'teep' ? lerp(A, T, .85) : tech === 'knee' ? K : lerp(A, K, KFRAC[tech]) };
  }
  const j: Joints = { pelvis: s.pelvis, chest: s.chest, neck: s.neck, head: s.head, lS: s.lS, lE: la.mid, lG: la.end, rS: s.rS, rE: ra.mid, rG: ra.end, lH: s.lH, lK: s.lK, lA: s.lA, lT, rH: s.rH, rK: s.rK, rA: s.rA, rT };
  const body: Body = { id, j, dims: d, F, L, face: s.face, headUp: s.headUp, tU: s.tU, tL: s.tL, action: f.action, down: f.action === 'down', health: f.health, stamina: f.stamina, stun: f.stun, strike: strikeOut };
  return { root, yaw, P, body, strike, prevStrike, headBase, headRest, restPelvis, restTU };
}

/** Knockdown: knees buckle, sit, lie back; near the rise the fighter sits up, kneels and stands. */
function downPose(ctx: Ctx, id: FighterId, f: V5Frame['kor'], root: V3, yaw: number, base: Params, kickPos: ((sk: Skel) => { foot: 'l' | 'r'; pos: V3; w: number; poles: { l?: V3; r?: V3 } } | null) | null = null) {
  const d = DIMS[id], F = heading(yaw), L = heading(yaw + Math.PI / 2);
  const stand = d.thigh + d.shin + d.ankle - .02;
  let t: number, riseK = 0;
  if (f.action === 'down') t = (ctx.tick - f.actionAt) * TICK_MS / 1000;
  else { const before = ctx.r.frames[Math.max(0, f.actionAt - 1)]![id]; t = (f.actionAt - before.actionAt) * TICK_MS / 1000 + 9; riseK = clamp((ctx.tick - f.actionAt) / 16); }
  // Sitting up begins about a second before a rise that is already in the log.
  let sitUp = 0;
  if (f.action === 'down') { for (let k = ctx.i + 1; k < Math.min(ctx.r.frames.length, ctx.i + 24); k++) if (ctx.r.frames[k]![id].action === 'rise') { sitUp = smooth(1 - (k - ctx.tick) / 20); break; } }
  else sitUp = 1;
  // The fall starts from the standing posture it interrupts, so the first frame on the canvas does not pop.
  const keys = [{ t: 0, y: stand - base.crouch, lean: base.lean, pf: base.pf }, { t: .12, y: stand - .1, lean: -.2, pf: -.02 }, { t: .36, y: .58, lean: .12, pf: -.06 }, { t: .65, y: .13, lean: -.35, pf: -.3 }, { t: 1.1, y: .11, lean: -1.32, pf: -.38 }];
  const end = keys[keys.length - 1]!; let y = end.y, lean = end.lean, pf = end.pf;
  for (let k = 1; k < keys.length; k++) { const a = keys[k - 1]!, b = keys[k]!; if (t < b.t) { const u = smooth((t - a.t) / (b.t - a.t)); y = a.y + (b.y - a.y) * u; lean = a.lean + (b.lean - a.lean) * u; pf = a.pf + (b.pf - a.pf) * u; break; } }
  lean += (.3 - lean) * sitUp;
  // Rise: sit -> one knee (0..0.45) -> standing guard (0.45..1).
  if (riseK > 0) {
    const kneel = smooth(riseK / .45), up = smooth((riseK - .45) / .55);
    y = .12 + (.52 - .12) * kneel + (stand - base.crouch - .52) * up; lean = .3 + (.25 - .3) * kneel + (base.lean - .25) * up;
    pf = -.38 + .23 * kneel + .15 * up;
  }
  const P: Params = { ...base, lean, pf, crouch: 0, side: 0, hF: 0, hS: 0, hY: 0, hYaw: 0, hPitch: (f.action === 'down' ? base.hPitch + (-.4 - base.hPitch) * smooth(t / .15) + (.65) * smooth((t - .4) / .4) : .25) * (1 - sitUp * .5), guard: 0, drop: 0, relax: 0, clinch: 0, gloveBack: 0, psi: base.psi * (.3 + .7 * Math.max(smooth((riseK - .35) / .3), f.action === 'down' ? 1 - smooth(t / .4) : 0)), hipPsi: base.hipPsi * (.3 + .7 * Math.max(smooth((riseK - .35) / .3), f.action === 'down' ? 1 - smooth(t / .4) : 0)) };
  // Pelvis height is set directly through `crouch`.
  P.crouch = stand - y;
  const pel = madd(root, F, pf);
  const stanceF = stanceFeet(id, root, yaw);
  const lying = { l: atY(madd(madd(pel, F, .78), L, .16)), r: atY(madd(madd(pel, F, .7), L, -.2)) };
  const kneelF = { l: atY(madd(madd(pel, F, .42), L, .14)), r: atY(madd(madd(pel, F, -.42), L, -.12)) };
  let feet: { l: V3; r: V3 };
  if (riseK > 0) { const kneel = smooth(riseK / .45), up = smooth((riseK - .45) / .55); feet = { l: lerp(lerp(lying.l, kneelF.l, kneel), stanceF.l, up), r: lerp(lerp(lying.r, kneelF.r, kneel), stanceF.r, up) }; }
  else { const k = smooth((t - .25) / .6); const planted = ctx.ix.feet[id]; feet = { l: lerp(footAt(planted, 'l', f.actionAt - .2, 0), lying.l, k), r: lerp(footAt(planted, 'r', f.actionAt - .2, 0), lying.r, k) }; }
  const standK = smooth((riseK - .35) / .3), kneePole = norm(lerp(add(UP, mul(F, .6)), add(F, mul(UP, .1)), standK));
  let skel = pose(d, root, yaw, P, feet, kneePole);
  // A kick cut short by a knockdown: the kicking foot falls from where the kick had it instead of popping to the floor.
  const kp = kickPos?.(skel);
  if (kp && kp.w > 0) { feet = { ...feet, [kp.foot]: lerp(feet[kp.foot], kp.pos, kp.w) }; skel = pose(d, root, yaw, P, feet, kneePole, kp.poles); }
  const flatK = f.action === 'down' ? smooth((t - .5) / .6) * (1 - sitUp) : 0;
  const g = guardGloves(id, skel, P);
  const restL = atY(madd(madd(skel.lS, L, .5), F, -.05), .09), restR = atY(madd(madd(skel.rS, L, -.5), F, -.05), .09);
  const kneeHand = madd(madd(skel.pelvis, F, .45), UP, -.05);
  let gl = lerp(g.l, restL, flatK), gr = lerp(g.r, restR, flatK);
  if (sitUp > 0 && riseK < .45) { gl = lerp(gl, madd(kneeHand, L, .18), sitUp * (1 - smooth(riseK / .45))); gr = lerp(gr, madd(skel.pelvis, L, -.3), sitUp * (1 - smooth(riseK / .45))); }
  return { skel, gl, gr, feet, kneePole };
}
const atY = (p: V3, y = 0): V3 => v(p.x, y, p.z);

// ---- referee ----------------------------------------------------------------------------------------
function solveRef(ctx: Ctx, kor: Pass, ayaz: Pass): Body {
  const { r, ix, tick, i, clockS, o } = ctx, f = r.frames[i]!.referee, d = DIMS.ref;
  const root = rootAt(r.frames, 'ref', tick), yaw = yawFrom(ix.yaw.ref, tick), F = heading(yaw), L = heading(yaw + Math.PI / 2);
  // The current mode fades in; the previous one (break, count, stop) fades out instead of snapping off.
  let start = i; while (start > 0 && r.frames[start - 1]!.referee.mode === f.mode) start--;
  const since = (tick - start) * TICK_MS / 1000, prev = start > 0 ? r.frames[start - 1]!.referee : null;
  const modes: { mode: string; count: number; since: number; w: number }[] = [{ mode: f.mode, count: f.count, since, w: 1 }];
  if (prev && prev.mode !== f.mode && since < .4) { let s0 = start - 1; while (s0 > 0 && r.frames[s0 - 1]!.referee.mode === prev.mode) s0--; modes.push({ mode: prev.mode, count: prev.count, since: (tick - s0) * TICK_MS / 1000, w: 1 - smooth(since / .4) }); }
  const speed = speedAt(r.frames, 'ref', tick);
  // Watching: knees soft, chest toward the fighters, head turned to the middle of the fight.
  const mid = lerp(kor.body.j.pelvis, ayaz.body.j.pelvis, .5), toMid = Math.atan2(mid.x - root.x, mid.z - root.z);
  let P: Params = { ...ZERO, lean: .08, hPitch: .1, crouch: .035, hYaw: clamp(wrap(toMid - yaw), -1, 1) * .85, sfL: .03, sfR: .03 };
  P = addP(P, { crouch: .012, ps: .01 }, Math.sin(clockS * 2.6) * .5 + .5);
  for (const m of modes) {
    if (m.mode === 'count') P = addP(P, { lean: .3, crouch: .1, hPitch: .3, hYaw: -P.hYaw * .5 }, smooth(m.since / .4) * m.w);
    if (m.mode === 'break') P = addP(P, { lean: .14, crouch: .03, sfL: .05, sfR: .05 }, smooth(m.since / .25) * m.w);
    if (m.mode === 'stop') P = addP(P, { lean: -.05, hPitch: -.1 }, smooth(m.since / .25) * m.w);
  }
  const feet = { l: footAt(ix.feet.ref, 'l', tick, .05), r: footAt(ix.feet.ref, 'r', tick, .05) };
  const s = pose(d, root, yaw, P, feet);
  const walk = Math.sin(clockS * 7) * clamp(speed / .8);
  let gl = madd(madd(madd(s.pelvis, F, .16), L, .2), UP, .06 + .05 * walk), gr = madd(madd(madd(s.pelvis, F, .16), L, -.2), UP, .06 - .05 * walk);
  // Count: the right arm rises over a second and chops down on each engine count; the left hand points away.
  let lastCount = -1; for (const e of r.events) { if (e.tick > tick) break; if (e.type === 'count') lastCount = e.tick; }
  const sc = lastCount >= 0 ? (tick - lastCount) * TICK_MS / 1000 : 9, chop = sc < .85 ? smooth(sc / .85) : 1 - smooth((sc - .85) / .15);
  for (const m of [...modes].reverse()) {
    if (m.mode === 'break') { const w = smooth(m.since / .25) * m.w, mp = lerp(kor.body.j.chest, ayaz.body.j.chest, .5); gl = lerp(gl, madd(mp, sub(kor.body.j.chest, mp), .55), w); gr = lerp(gr, madd(mp, sub(ayaz.body.j.chest, mp), .55), w); }
    if (m.mode === 'count') { const w = smooth(m.since / .4) * m.w; gr = lerp(gr, madd(madd(s.rS, F, .36), UP, -.14 + .52 * chop), w); gl = lerp(gl, madd(madd(madd(s.lS, L, .34), F, .3), UP, -.1), w); }
    if (m.mode === 'stop') { const wave = Math.sin(clockS * 9), w = smooth(m.since / .25) * m.w; gl = lerp(gl, madd(madd(madd(s.head, UP, .34), L, .22 * wave), F, .1), w); gr = lerp(gr, madd(madd(madd(s.head, UP, .34), L, -.22 * wave), F, .1), w); }
  }
  if (o.phase === 'finished' && o.winner && o.winner !== 'draw') gr = madd(madd(s.rS, UP, .58), L, -.08);
  const la = ik2(s.lS, gl, d.upper, d.fore, add(mul(UP, -1), mul(F, -.5))), ra = ik2(s.rS, gr, d.upper, d.fore, add(mul(UP, -1), mul(F, -.5)));
  const toe = (a: V3) => v(a.x + F.x * d.foot, .02, a.z + F.z * d.foot);
  const j: Joints = { pelvis: s.pelvis, chest: s.chest, neck: s.neck, head: s.head, lS: s.lS, lE: la.mid, lG: la.end, rS: s.rS, rE: ra.mid, rG: ra.end, lH: s.lH, lK: s.lK, lA: s.lA, lT: toe(s.lA), rH: s.rH, rK: s.rK, rA: s.rA, rT: toe(s.rA) };
  return { id: 'ref', j, dims: d, F, L, face: s.face, headUp: s.headUp, tU: s.tU, tL: s.tL, action: f.mode, down: false, health: 1000, stamina: 1000, stun: 0, strike: null };
}

// ---- frame ------------------------------------------------------------------------------------------
export function ringFrame(r: RingReplay, o: RingOptions, impacts = true): RingFrame {
  const ix = index(r), last = r.frames.length - 1;
  const tick = o.phase === 'fighting' ? clamp(o.timeMs / TICK_MS, 0, last) : o.phase === 'finished' ? last : 0;
  const ctx: Ctx = { r, ix, tick, i: Math.min(last, Math.floor(tick)), clockS: o.clockMs / 1000, o };
  // Pass 0: bodies with guards; pass 1: bodies with their own punches and kicks aimed at pass 0; passes 2 and 3 repeat
  // that against the previous pass, so a target that is itself punching or kicking is hit where it is drawn.
  const k0 = solveFighter(ctx, 'kor', null), a0 = solveFighter(ctx, 'ayaz', null);
  const k1 = solveFighter(ctx, 'kor', a0), a1 = solveFighter(ctx, 'ayaz', k0);
  const k2 = solveFighter(ctx, 'kor', a1), a2 = solveFighter(ctx, 'ayaz', k1);
  const kor = solveFighter(ctx, 'kor', a2), ayaz = solveFighter(ctx, 'ayaz', k2);
  const ref = solveRef(ctx, kor, ayaz), f0 = r.frames[ctx.i]!;
  const downId = FIGHTERS.find(id => f0[id].action === 'down' || f0[id].action === 'rise');
  const knockdown = downId ? (() => { const s = f0[downId], at = s.action === 'down' ? s.actionAt : r.frames[Math.max(0, s.actionAt - 1)]![downId].actionAt; return { fighter: downId, ageMs: (tick - at) * TICK_MS, count: f0.referee.count }; })() : null;
  const list: Impact[] = [];
  if (impacts && o.phase !== 'idle') r.events.forEach((e, n) => {
    if (!['hit', 'block', 'dodge', 'miss', 'knockdown', 'count', 'rise', 'clinch', 'break', 'finish'].includes(e.type)) return;
    const ageMs = (tick - e.tick) * TICK_MS;
    if (ageMs < 0 || ageMs > 1100) return;
    let at = ix.impactAt.get(n);
    if (!at) {
      // Where the glove was on the contact tick (computed once per event).
      const then = ringFrame(r, { ...o, phase: 'fighting', timeMs: e.tick * TICK_MS }, false), b = then[e.actor];
      at = b.strike ? b.strike.point : then[e.target].j.head;
      ix.impactAt.set(n, at);
    }
    list.push({ index: n, type: e.type, actor: e.actor, target: e.target, part: e.bodyPart ?? null, technique: e.technique, damage: e.damage, counter: !!e.counter, combo: e.combo ?? 0, count: e.count ?? 0, ageMs, at });
  });
  return { tick, kor: kor.body, ayaz: ayaz.body, ref, impacts: list, knockdown, refMode: f0.referee.mode, refCount: f0.referee.count };
}

/** Camera axis along the fighters (kor -> ayaz), kept continuous; on the first frame the referee is put upstage. */
export function fightAxis(frame: V5Frame, previous: { rx: number; rz: number } | null): { rx: number; rz: number } {
  const dx = frame.ayaz.x - frame.kor.x, dz = frame.ayaz.z - frame.kor.z, n = Math.hypot(dx, dz);
  if (n < 1) return previous ?? { rx: 1, rz: 0 };
  let a = { rx: dx / n, rz: dz / n };
  if (previous) return a.rx * previous.rx + a.rz * previous.rz < 0 ? { rx: -a.rx, rz: -a.rz } : a;
  const mx = (frame.kor.x + frame.ayaz.x) / 2, mz = (frame.kor.z + frame.ayaz.z) / 2;
  if ((frame.referee.x - mx) * a.rz - (frame.referee.z - mz) * a.rx < 0) a = { rx: -a.rx, rz: -a.rz };
  return a;
}

/** Display time with a brief hit-stop on clean shots; it catches up within ~150 ms. Never ahead of real time. */
export function hitStopTime(events: readonly V5Event[], realMs: number): number {
  let lag = 0;
  for (const e of events) {
    if (e.type !== 'hit') continue;
    const t = e.tick * TICK_MS, since = realMs - t;
    if (since < 0) break;
    if (since > 260) continue;
    const hold = clamp(e.damage / 50, .5, 1.2) * (e.counter ? 70 : 55);
    lag = Math.max(lag, since < hold ? since : hold * (1 - smooth((since - hold) / 150)));
  }
  return realMs - lag;
}
export const _test = { planFeet, footAt, index, hash };
