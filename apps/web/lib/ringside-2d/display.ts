/**
 * Ringside 2D display simulation: turns the committed engine frames into what is DRAWN, like a fighting game's presentation
 * layer. Presentation only: it reads a replay, never writes to it, and never feeds anything back into the fight, admission
 * or settlement. Engine results (hits, knockdowns, winners, payouts) are untouched; only where a sprite stands and which
 * key frame it shows are decided here.
 *
 * - Positions: the two fighters are placed on the ring's long axis at the engine's centre-to-centre distance plus
 *   `spacingMm` (the sprites are bigger than the engine's body circles) around the engine midpoint, so they never swap sides
 *   and never walk through each other. Positions follow the engine through a critically damped filter with a speed cap.
 * - Push boxes: each frame carries a push box (torso, half way to the lead boot). The two boxes never overlap
 *   (`gapMm` between them), except in a clinch, where `clinchOverlap` of them may overlap.
 * - Contact: while a strike is out, the attacker lunges (eased with the strike's age, exactly complete on the contact tick)
 *   so the strike tip reaches the target's head or body box (as it was just before the blow) when the engine says hit or block,
 *   and stops short on a miss or a dodge. A hit pushes the defender back a few mm with easing.
 * - Referee: stands between the fighters while there is room and otherwise beside them; he changes sides by walking upstage.
 * - Frames: a key frame is held at least `MIN_HOLD_MS` unless the new one is a priority (impact, hit, block, fall, finish).
 * - Transforms (lean, squash, lift): idle breathing, a walk bob, anticipation and overshoot on strikes, a squash on a hit and a
 *   squash through every turn. No cross-fades: frames snap.
 */
import { V5_STRIKES, isV5Strike, type FighterId, type V5Event } from '@sollish/protocol';
import { MIN_HOLD_MS, PRIORITY, REF, TICK_MS, WALK, clamp, contactOf, fighterPose, impactAge, refereePose, strikesOf, type Outcome, type Replay } from './animations';
import { metaOf, type CharKey, type FramesManifest } from './frames';
import { POST, facing, refereeFacing, type Facing } from './geometry';

export const DISPLAY = {
  spacingMm: 420, gapMm: 16, clinchOverlap: .5,
  /** Follow: rate (1/s) of the damped filter and the speed cap (mm per ms). */
  followRate: 22, laneRate: 9, maxSpeed: 5,
  /** Lunge: how far (mm) an attacker may close in or back off to meet the contact distance, the slew limit (mm/ms), how many ticks before the strike he starts closing in, how many ticks (at least) he takes to relax afterwards, and the stop-short gap of a miss. */
  lungeMax: 600, lungeBack: 450, lungeSlew: 5, lungeLead: 4, lungeRelax: 6, reachMm: -8, blockMm: -4, missMm: 70,
  /** Hit push: base + per damage, cap (mm). */
  pushBase: 22, pushPerDamage: 1.5, pushMax: 100,
  /** Ring limit for a fighter's display x (mm). */
  ringLimit: POST - 350,
  /** Referee. */
  refClearPx: 40, refCountClearPx: 8, refSpeed: 3, refPush: 4.6, refLane: -2400, refBehind: -3100, refRate: 8, refStride: 170, refSize: .87, envShrink: .3,
} as const;

export type Box = { x0: number; x1: number };
export type FighterView = { /** exact sprite box (mm) of the drawn frame and its envelope (expands at once, shrinks slowly) */ sbox: Box; senv: Box; id: FighterId; /** what the sprite covers on screen (guard gloves in front, a lying body in full): the referee keeps clear of it */ vbox: Box; x: number; /** damped engine position without lunge and push */ bx: number; z: number; dir: Facing; frame: number; why: string; lean: number; sx: number; sy: number; /** mm */ lift: number; /** push box in world mm */ box: Box; clinch: boolean };
/** `behind`: he is crossing upstage to change sides (the only time his box may overlap a fighter's on screen). */
export type RefView = { sbox: Box; x: number; z: number; dir: Facing; frame: number; why: string; zone: -1 | 0 | 1; behind: boolean; box: Box };
export type DisplayView = { kor: FighterView; ayaz: FighterView; ref: RefView };

/** A count or a stoppage is on: the referee may come closer to the downed fighter. */
const refCounting = (replay: Replay, t: number) => { const m = replay.frames[Math.min(replay.frames.length - 1, Math.max(0, Math.floor(t)))]!.referee.mode; return m === 'count' || m === 'stop'; };
const other = (id: FighterId): FighterId => id === 'kor' ? 'ayaz' : 'kor';
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const approach = (cur: number, target: number, step: number) => cur + clamp(target - cur, -step, step);
const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);

/** Frames whose push box is their own (the whole body lies on the canvas); every other pose uses the character's stable push box. */
const OWN_BOX = new Set([28, 29]);
const extents = (manifest: FramesManifest | null, who: CharKey, frame: number) => {
  if (!manifest) return { front: 330, back: 250 };
  const ch = manifest.characters[who], m = OWN_BOX.has(frame) && who !== 'referee' ? metaOf(manifest, who, frame) : null;
  return m ? { front: (m.push[1] - m.anchor[0]) * ch.mmPerPx, back: (m.anchor[0] - m.push[0]) * ch.mmPerPx } : { front: ch.pushFront, back: ch.pushBack };
};
/** World extent of a fighter's push box at `x` facing `dir`. */
export function boxOf(manifest: FramesManifest | null, who: CharKey, frame: number, x: number, dir: Facing): Box {
  const { front, back } = extents(manifest, who, frame);
  return dir === 1 ? { x0: x - back, x1: x + front } : { x0: x - front, x1: x + back };
}
/** The space a fighter's drawn body takes: his guard gloves in front (the reach of his first frame), the back of his stance, or the whole lying body. */
export function visualBox(manifest: FramesManifest | null, who: CharKey, frame: number, x: number, dir: Facing): Box {
  const ch = manifest?.characters[who], own = manifest && OWN_BOX.has(frame) ? metaOf(manifest, who, frame) : null;
  let front = 520, back = 320;
  if (ch) {
    const g = ch.frames['1']!;
    if (own) { front = (own.body[1] - own.anchor[0]) * ch.mmPerPx; back = (own.anchor[0] - own.body[0]) * ch.mmPerPx; }
    else { front = Math.max(ch.pushFront, (g.tip[0] - g.anchor[0]) * ch.mmPerPx); back = ch.pushBack + 120; }
  }
  return dir === 1 ? { x0: x - back, x1: x + front } : { x0: x - front, x1: x + back };
}
/** What a drawn frame covers along the ring (mm in front of / behind the feet anchor), scaled by `k` (the referee is drawn smaller). */
export function spriteExtent(manifest: FramesManifest | null, who: CharKey, frame: number, k = 1) {
  const m = manifest ? metaOf(manifest, who, frame) : null; if (!m) return { front: 600 * k, back: 350 * k };
  const mm = manifest!.characters[who].mmPerPx * k; return { front: (m.w - m.anchor[0]) * mm, back: m.anchor[0] * mm };
}
const spanOf = (x: number, dir: Facing, front: number, back: number): Box => dir === 1 ? { x0: x - back, x1: x + front } : { x0: x - front, x1: x + back };
/** Front extent (mm toward the opponent) of a fighter's push box. */
export const frontOf = (manifest: FramesManifest | null, who: CharKey, frame: number) => extents(manifest, who, frame).front;

/**
 * Gap (mm) between the strike tip of `actor` (frame `aFrame` at `ax` facing `adir`) and the near edge of the target's hurtbox
 * for the strike's region (head box for head blows, torso box otherwise). Negative = the tip is inside the box.
 */
export function tipGap(manifest: FramesManifest, actor: FighterId, aFrame: number, ax: number, target: FighterId, tFrame: number, tx: number, region: 'head' | 'body' | 'leg'): number {
  const ma = metaOf(manifest, actor, aFrame)!, mt = metaOf(manifest, target, tFrame)!, ka = manifest.characters[actor].mmPerPx, kt = manifest.characters[target].mmPerPx;
  const adir: Facing = tx >= ax ? 1 : -1, tip = ax + adir * (ma.tip[0] - ma.anchor[0]) * ka, box = region === 'head' ? mt.head : mt.body, edge = tx - adir * (box[1] - mt.anchor[0]) * kt;
  return (edge - tip) * adir;
}

type Held = { frame: number; ms: number; why: string };
type FState = { envF: number; envB: number; boxFrame: number; moveDir: 1 | -1; x: number; z: number; lunge: number; held: Held | null; dir: Facing | null; turn: number; lastFrame: number; lastX: number; dist: number; speed: number; walking: boolean };
type RState = { lastX: number; dist: number; speed: number; walking: boolean; goal: -1 | 0 | 1; x: number; z: number; zone: -1 | 0 | 1; held: Held | null; dir: Facing | null; init: boolean; crossing: boolean };

export class DisplaySim {
  private base: Record<FighterId, FState> = { kor: this.blank(), ayaz: this.blank() };
  private ref: RState = { x: 0, z: -1600, zone: 0, held: null, dir: null, init: false, crossing: false, goal: 0, lastX: 0, dist: 0, speed: 0, walking: false };
  private init = false; private lastTick = 0; private goals = new Map<string, number>(); private goalsFor: object | null = null;
  constructor(private manifest: FramesManifest | null = null) {}
  setManifest(m: FramesManifest | null) { this.manifest = m; }
  private blank(): FState { return { x: 0, z: 0, lunge: 0, held: null, dir: null, turn: -1, lastFrame: 1, lastX: 0, dist: 0, speed: 0, walking: false, moveDir: 1, boxFrame: 1, envF: 0, envB: 0 }; }
  reset() { this.init = false; this.goals.clear(); this.goalsFor = null; }

  /** Contact distance (mm between the two anchors) at which the attacker's tip just meets the target for event `e`. */
  private goal(replay: Replay, actor: FighterId, e: V5Event): number | null {
    const m = this.manifest; if (!m) return null;
    if (this.goalsFor !== replay.events) { this.goals.clear(); this.goalsFor = replay.events; }
    const key = `${actor}:${e.tick}`, hit = this.goals.get(key); if (hit !== undefined) return hit;
    // The hurtbox is the target's frame just BEFORE the contact tick (his reaction frame shows his head snapped back; the blow lands where it was).
    const t = e.target, af = fighterPose(replay, actor, e.tick).frame, tf = fighterPose(replay, t, Math.max(0, e.tick - .001)).frame, ma = metaOf(m, actor, af), mt = metaOf(m, t, tf);
    if (!ma || !mt) return null;
    const region = isV5Strike(e.technique) ? V5_STRIKES[e.technique].target : 'body', box = region === 'head' ? mt.head : mt.body;
    const tipLen = (ma.tip[0] - ma.anchor[0]) * m.characters[actor].mmPerPx, front = (box[1] - mt.anchor[0]) * m.characters[t].mmPerPx;
    const g = tipLen + front + (e.type === 'hit' ? DISPLAY.reachMm : e.type === 'block' ? DISPLAY.blockMm : DISPLAY.missMm);
    this.goals.set(key, g); return g;
  }

  /** Advances the display to engine tick `tickF` (float) after `dtMs` of real time and returns what to draw. */
  step(replay: Replay, tickF: number, dtMs: number, outcome: Outcome | Record<FighterId, Outcome> = null, clockMs = 0): DisplayView {
    const outcomeOf = (id: FighterId): Outcome => typeof outcome === 'object' && outcome !== null ? outcome[id] : outcome;
    const anyWin: Outcome = outcomeOf('kor') === 'win' || outcomeOf('ayaz') === 'win' ? 'win' : null;
    const last = replay.frames.length - 1, t = clamp(tickF, 0, Math.max(0, last)), i = Math.min(last, Math.floor(t)), j = Math.min(last, i + 1), fr = clamp(t - i);
    const A = replay.frames[i]!, B = replay.frames[j]!, lerp = (a: number, b: number) => a + (b - a) * fr;
    const snap = !this.init || t < this.lastTick - .25 || t > this.lastTick + 6 || dtMs > 250;
    const dt = snap ? 0 : clamp(dtMs, 0, 100); this.lastTick = t; this.init = true;
    const e = { kor: { x: lerp(A.kor.x, B.kor.x), z: lerp(A.kor.z, B.kor.z) }, ayaz: { x: lerp(A.ayaz.x, B.ayaz.x), z: lerp(A.ayaz.z, B.ayaz.z) }, ref: { x: lerp(A.referee.x, B.referee.x), z: lerp(A.referee.z, B.referee.z) } };

    // Targets: the engine distance (plus spacing) on the long axis around the engine midpoint; lanes pulled toward their mean.
    const dist = Math.hypot(e.ayaz.x - e.kor.x, e.ayaz.z - e.kor.z), midE = (e.kor.x + e.ayaz.x) / 2, sep = dist + DISPLAY.spacingMm, midZ = (e.kor.z + e.ayaz.z) / 2;
    let tk = midE - sep / 2, ta = midE + sep / 2; const lim = DISPLAY.ringLimit;
    if (tk < -lim) { ta += -lim - tk; tk = -lim; } else if (ta > lim) { tk -= ta - lim; ta = lim; }
    const target = { kor: { x: tk, z: midZ + (e.kor.z - midZ) * .6 }, ayaz: { x: ta, z: midZ + (e.ayaz.z - midZ) * .6 } };
    const ids: FighterId[] = ['kor', 'ayaz'];
    for (const id of ids) {
      const b = this.base[id];
      if (snap) { b.x = target[id].x; b.z = target[id].z; b.lunge = 0; b.held = null; b.dir = null; b.turn = -1; }
      else {
        const nx = damp(b.x, target[id].x, DISPLAY.followRate, dt / 1000); b.x = approach(b.x, nx, DISPLAY.maxSpeed * dtMs);
        b.z = damp(b.z, target[id].z, DISPLAY.laneRate, dt / 1000);
      }
    }

    // Offsets: strike lunges (first, so the second attacker of a trade sees the first one's lunge) and hit pushes.
    const pos: Record<FighterId, number> = { kor: this.base.kor.x, ayaz: this.base.ayaz.x };
    const toward = (id: FighterId): Facing => pos[other(id)] >= pos[id] ? 1 : -1;
    // Attackers close in when the target is out of reach; when he is too close for the tip to stop at the target the pair gives ground
    // together, half each.
    const wants: Record<FighterId, number> = { kor: 0, ayaz: 0 }, win: Record<FighterId, { w: number; goal: number; lands: boolean; impact: boolean; pre: boolean } | null> = { kor: null, ayaz: null };
    for (const id of ids) {
      // The strikes whose window (starting a few ticks before the strike, so he closes in smoothly) contains now; the strongest wins.
      for (const st of strikesOf(replay, id)) {
        if (st.tick - DISPLAY.lungeLead > t) break;
        if (!isV5Strike(st.technique)) continue;
        const s = V5_STRIKES[st.technique], age = t - st.tick, relax = Math.max(s.end - s.wind - s.active, DISPLAY.lungeRelax);
        if (age > s.wind + s.active + relax) continue;
        const ev = contactOf(replay, id, st.tick + s.wind), goal = ev ? this.goal(replay, id, ev) : null;
        if (!ev || goal === null) continue;
        const w = age < s.wind ? smooth((age + DISPLAY.lungeLead) / (DISPLAY.lungeLead + s.wind)) : age < s.wind + s.active ? 1 : 1 - smooth((age - s.wind - s.active) / relax);
        if (!win[id] || w > win[id]!.w) win[id] = { w, goal, lands: ev.type === 'hit' || ev.type === 'block', impact: age >= s.wind && age < s.wind + s.active, pre: age < s.wind + s.active };
      }
    }
    // Distance change wanted by each attacker (positive = close in), blended so two simultaneous attackers never double up and
    // nothing jumps when one window ends: Delta = (strongest w) * mean of the wanted changes weighted by w^4 (a blow that is landing
    // right now counts a thousand times more, so its contact distance is exact); in a trade both tips must reach, so the shorter goal counts.
    const sepBase = Math.abs(pos.ayaz - pos.kor);
    let W = 0, sumWE = 0, wmax = 0;
    for (const id of ids) { const d = win[id]; if (!d) continue; const pw = d.w ** 4 * (d.impact && d.lands ? 1000 : 1); W += pw; wmax = Math.max(wmax, d.w); const o = win[other(id)], goal = o && o.lands && d.lands && o.pre && d.pre && o.w > .3 && d.w > .3 ? Math.min(d.goal, o.goal) : d.goal; sumWE += pw * clamp(sepBase - goal, -DISPLAY.lungeBack, DISPLAY.lungeMax); }
    const delta = W > 1e-9 ? wmax * sumWE / W : 0;
    // Closing in is done by the attackers (shared by strength), giving ground is shared half and half.
    for (const id of ids) { const d = win[id]; wants[id] = delta > 0 ? (d && W > 1e-9 ? delta * d.w ** 4 * (d.impact && d.lands ? 1000 : 1) / W : 0) : delta / 2; }
    for (const id of ids) {
      const b = this.base[id];
      b.lunge = snap ? wants[id] : approach(b.lunge, wants[id], DISPLAY.lungeSlew * dtMs);
    }
    for (const id of ids) pos[id] += toward(id) * this.base[id].lunge;
    for (const id of ids) {
      const imp = impactAge(replay, id, t);
      if (!imp || imp.age < 0) continue;
      const ms = imp.age * TICK_MS, amount = imp.event.type === 'hit' ? Math.min(DISPLAY.pushBase + imp.event.damage * DISPLAY.pushPerDamage, DISPLAY.pushMax) : 14;
      const k = ms < 110 ? 1 - (1 - ms / 110) ** 2 : ms < 250 ? 1 - .6 * smooth((ms - 110) / 140) : .4 * (1 - smooth((ms - 250) / 650));
      pos[id] += -toward(id) * amount * k;
    }

    // Frames (held for a minimum time unless a priority change), directions and push boxes.
    const view = {} as Record<FighterId, FighterView>;
    const poseOf = {} as Record<FighterId, { frame: number; why: string }>;
    for (const id of ids) {
      let p = fighterPose(replay, id, t, outcomeOf(id)); const b = this.base[id], h = b.held;
      // Walking is a cycle driven by the DISTANCE the sprite actually travels on screen (so it never skates), forward or backward
      // by the direction of the motion relative to the opponent; it replaces the idle and engine-walk frames only.
      if (b.walking && (p.why === 'guard' || p.why === 'neutral' || p.why === 'walk' || p.why === 'idle' || p.why === 'default')) {
        const list = b.moveDir > 0 ? WALK.forward(id) : WALK.back(id);
        p = { frame: list[Math.floor(b.dist / WALK.phaseMm) % list.length]!, why: 'walk' };
      }
      if (!h || snap) b.held = { frame: p.frame, ms: 0, why: p.why };
      else { h.ms += dtMs; if (p.frame !== h.frame && (PRIORITY.has(p.why) || h.ms >= MIN_HOLD_MS)) { h.frame = p.frame; h.ms = 0; } h.why = p.why; }
      // The push box of a hit reaction is the one of the pose he was in just before the blow (the reaction frame leans away and would keep the attacker's fist out).
      if (b.held!.why !== 'hit' || snap) b.boxFrame = b.held!.frame;
      poseOf[id] = { frame: b.held!.frame, why: b.held!.why };
    }
    // Overlap: no two push boxes overlap (a clinch allows a share of it); equal correction on both sides.
    const clinch = A.kor.action === 'clinch' || A.ayaz.action === 'clinch';
    const fk = frontOf(this.manifest, 'kor', this.base.kor.boxFrame), fa = frontOf(this.manifest, 'ayaz', this.base.ayaz.boxFrame);
    const minSep = clinch ? (fk + fa) * (1 - DISPLAY.clinchOverlap) : fk + fa + DISPLAY.gapMm;
    let xk = Math.min(pos.kor, pos.ayaz), xa = Math.max(pos.kor, pos.ayaz);
    if (xa - xk < minSep) { const d = minSep - (xa - xk); xk -= d / 2; xa += d / 2; }
    if (xk < -lim) { xa += -lim - xk; xk = -lim; } else if (xa > lim) { xk -= xa - lim; xa = lim; }
    const final: Record<FighterId, number> = { kor: xk, ayaz: xa };

    for (const id of ids) {
      const b = this.base[id], f = A[id], who: CharKey = id, p = poseOf[id];
      const dir = facing({ x: final[id], yawMilliRad: 0 }, { x: final[other(id)] }, b.dir);
      if (snap || dtMs <= 0) { b.lastX = final[id]; b.speed = 0; b.walking = false; }
      else {
        const dx = final[id] - b.lastX, v = Math.abs(dx) / dtMs * 1000; b.lastX = final[id];
        b.speed = b.speed + (v - b.speed) * Math.min(1, dtMs / 90);
        if (!b.walking && b.speed > 150) b.walking = true; else if (b.walking && b.speed < 60) b.walking = false;
        if (Math.abs(dx) > .01) b.moveDir = dx * dir > 0 ? 1 : -1;
        if (b.walking) b.dist += Math.abs(dx);
      }
      if (b.dir !== null && dir !== b.dir) b.turn = 0;
      b.dir = dir;
      if (b.turn >= 0) { b.turn += dtMs / 140; if (b.turn >= 1) b.turn = -1; }
      let lean = 0, sx = 1, sy = 1, lift = 0;
      const clockS = clockMs / 1000, idle = p.why === 'guard' || p.why === 'neutral' || p.why === 'idle' || p.why === 'default' || p.why === 'recover';
      if (idle) { const br = Math.sin(clockS * Math.PI * 2 / 1.15 + (id === 'ayaz' ? 1.9 : 0)); sy = 1 + .007 * br; sx = 1 - .004 * br; }
      if (p.why === 'walk') { lift = 14 * Math.abs(Math.sin(Math.PI * b.dist / WALK.phaseMm)); lean = .018; }
      if (isV5Strike(f.action) && p.why !== 'hit' && p.why !== 'block') {
        const s = V5_STRIKES[f.action], a = (t - f.actionAt) * TICK_MS, windMs = s.wind * TICK_MS, actMs = s.active * TICK_MS;
        if (a >= 0 && a < windMs) lean = -.03 * smooth(a / windMs);
        else if (a < windMs + actMs) { lean = .05; sx = 1 + .03 * Math.exp(-(a - windMs) / 70); }
        else lean = .05 * Math.exp(-(a - windMs - actMs) / 160);
      }
      const imp = impactAge(replay, id, t);
      if (imp && imp.age >= 0 && imp.age * TICK_MS < 170 && p.why !== 'down') {
        const kk = 1 - imp.age * TICK_MS / 170, heavy = imp.event.type === 'hit' ? clamp(imp.event.damage / 45, .4, 1) : .3;
        sx *= 1 + .05 * kk * heavy; sy *= 1 - .06 * kk * heavy; lean -= .07 * kk * heavy;
      }
      if (b.turn >= 0) sx *= .6 + .4 * Math.abs(2 * b.turn - 1);
      void who;
      const ext = spriteExtent(this.manifest, id, p.frame);
      if (snap) { b.envF = ext.front; b.envB = ext.back; } else { b.envF = Math.max(ext.front, b.envF - DISPLAY.envShrink * dtMs); b.envB = Math.max(ext.back, b.envB - DISPLAY.envShrink * dtMs); }
      view[id] = { sbox: spanOf(final[id], dir, ext.front, ext.back), senv: spanOf(final[id], dir, b.envF, b.envB), id, vbox: visualBox(this.manifest, id, p.frame, final[id], dir), x: final[id], bx: b.x, z: b.z, dir, frame: p.frame, why: p.why, lean, sx, sy, lift, box: boxOf(this.manifest, id, b.boxFrame, final[id], dir), clinch };
    }
    return { kor: view.kor, ayaz: view.ayaz, ref: this.stepRef(replay, t, dtMs, snap, e.ref, midE, (view.kor.x + view.ayaz.x) / 2, view.kor, view.ayaz, anyWin) };
  }

  /** The referee's sprite extent (drawn smaller), the widest over his frames, so his box never hops with his frame. */
  private refExtent() {
    const m = this.manifest; if (!m) return { left: 250, right: 250 };
    if (this.refExt && this.refExt.m === m) return this.refExt;
    let left = 0, right = 0; for (const n of Object.keys(m.characters.referee.frames)) { const e = spriteExtent(m, 'referee', Number(n), DISPLAY.refSize); left = Math.max(left, e.back); right = Math.max(right, e.front); }
    return this.refExt = { m, left, right };
  }
  private refExt: { m: FramesManifest; left: number; right: number } | null = null;
  /** Pixels per mm of the picture (set by the scene each frame): the referee keeps a clearance of DISPLAY.refClearPx screen pixels. */
  scale = .17;
  /**
   * Referee: between the fighters while there is room, beside them otherwise. He is never inside a fighter's push box: his x is
   * clamped to his zone (between, left of the pair, right of the pair). To change zone he first walks upstage (`crossing`),
   * crosses behind the fighters and comes back down in the new zone.
   */
  private stepRef(replay: Replay, t: number, dtMs: number, snap: boolean, eng: { x: number; z: number }, midE: number, midD: number, kor: FighterView, ayaz: FighterView, outcome: Outcome): RefView {
    const R = this.ref, rp = refereePose(replay, t, outcome);
    if (!R.held || snap) R.held = { frame: rp.frame, ms: 0, why: rp.why };
    else { R.held.ms += dtMs; if (rp.frame !== R.held.frame && (PRIORITY.has(rp.why) || R.held.ms >= MIN_HOLD_MS)) { R.held.frame = rp.frame; R.held.ms = 0; } R.held.why = rp.why; }
    const { left, right } = this.refExtent(), counting = refCounting(replay, t), clr = clamp((counting ? DISPLAY.refCountClearPx : DISPLAY.refClearPx) / this.scale, 40, 600);
    const ringL = -DISPLAY.ringLimit - 300, ringR = DISPLAY.ringLimit + 300, want = eng.x + (midD - midE), dt = clamp(dtMs, 0, 100) / 1000;
    // Intervals of x the referee may stand on in each zone, keeping `clr` (screen-space 40 px) clear of what the fighters DRAW (the envelope of their sprite boxes).
    const interval = (z: -1 | 0 | 1): [number, number] => z === 0 ? [kor.senv.x1 + clr + left, ayaz.senv.x0 - clr - right] : z < 0 ? [ringL, kor.senv.x0 - clr - right] : [ayaz.senv.x1 + clr + left, ringR];
    // He stands beside the fighters, never between them: on the side with more room at the start, then on that side (no flapping); he
    // changes sides, walking upstage behind them, only when the ring wall leaves him no room.
    const roomL = kor.senv.x0 - ringL, roomR = ringR - ayaz.senv.x1;
    let zone: -1 | 0 | 1 = R.crossing ? R.goal : !R.init || R.zone === 0 ? (roomL > roomR ? -1 : 1) : R.zone;
    if (zone !== 0) { const [lo, hi] = interval(zone), [lo2, hi2] = interval(zone < 0 ? 1 : -1); if (hi - lo < 500 && hi2 - lo2 > hi - lo) zone = zone < 0 ? 1 : -1; }
    if (!R.init || snap) { R.init = true; R.zone = zone; R.crossing = false; const [lo, hi] = interval(zone); R.x = clamp(want, Math.min(lo, hi), Math.max(lo, hi)); R.z = Math.max(-3300, Math.min(eng.z, DISPLAY.refLane, Math.min(kor.z, ayaz.z) - 800)); R.dir = null; }
    const upstage = DISPLAY.refBehind, fit = (z: -1 | 0 | 1, x: number) => { const [lo, hi] = interval(z); return clamp(x, Math.min(lo, hi), Math.max(lo, hi)); };
    if (zone !== R.zone && !R.crossing) { R.crossing = true; R.goal = zone; }
    // He stands upstage of the fighters' lane (drawn behind them), whatever lane the engine puts him in.
    const lane = Math.max(-3300, Math.min(eng.z, DISPLAY.refLane, Math.min(kor.z, ayaz.z) - 800));
    let tx: number, tz = lane;
    if (R.crossing) {
      // Walk behind the fighters first; only once well upstage does he move sideways to the new zone.
      tz = upstage;
      if (R.z < upstage + 300) R.zone = zone;
      tx = R.zone === zone ? fit(zone, want) : fit(R.zone, R.x);
      if (R.zone === zone && Math.abs(fit(zone, R.x) - R.x) < 1) R.crossing = false;
    } else tx = fit(R.zone, want);
    if (!snap) { R.x = approach(R.x, damp(R.x, tx, DISPLAY.refRate, dt), DISPLAY.refSpeed * dtMs); R.z = approach(R.z, damp(R.z, tz, DISPLAY.refRate, dt), DISPLAY.refSpeed * dtMs); }
    else { R.x = tx; R.z = tz; }
    if (!R.crossing) R.x = snap ? fit(R.zone, R.x) : approach(R.x, fit(R.zone, R.x), DISPLAY.refPush * dtMs);
    // Walking by distance travelled (no sliding): the walk frame alternates with the standing one every stride.
    let frame = R.held!.frame;
    if (snap || dtMs <= 0) { R.lastX = R.x; R.speed = 0; R.walking = false; }
    else {
      const dx = R.x - R.lastX, v = Math.abs(dx) / dtMs * 1000; R.lastX = R.x; R.speed = R.speed + (v - R.speed) * Math.min(1, dtMs / 90);
      if (!R.walking && R.speed > 120) R.walking = true; else if (R.walking && R.speed < 50) R.walking = false;
      if (R.walking) R.dist += Math.abs(dx);
    }
    if (R.walking && (R.held!.why === 'watch' || R.held!.why === 'walk')) frame = Math.floor(R.dist / DISPLAY.refStride) % 2 ? REF.walk : REF.watch;
    else if (!R.walking && R.held!.why === 'walk') frame = REF.watch;
    const dir = refereeFacing({ x: R.x }, midD, R.dir); R.dir = dir;
    const rext = spriteExtent(this.manifest, 'referee', frame, DISPLAY.refSize);
    return { sbox: spanOf(R.x, dir, rext.front, rext.back), x: R.x, z: R.z, dir, frame, why: R.held!.why, zone: R.zone, behind: R.crossing, box: spanOf(R.x, dir, right, left) };
  }
}
