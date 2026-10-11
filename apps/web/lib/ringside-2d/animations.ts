/**
 * Ringside 2D animation state machine. Presentation only: it reads the committed frames and events of a replay and
 * never feeds anything back into the fight, admission or settlement.
 *
 * Classic fighting-game style: every fighter is a flat sprite from a fixed side camera and the pose SNAPS between key
 * frames (no limb tweening). Which key frame is shown is a pure function of the engine state (`action`, `phase`,
 * `actionAt`) and the committed events at the display tick, so the same replay always draws the same poses.
 *
 * Timing contract (engine, 50 ms ticks): a strike starts at `actionAt`, the contact check runs on tick
 * `actionAt + wind` (that tick carries the hit / block / dodge / miss event), the limb stays out for `active` ticks and
 * the action ends at `actionAt + end`. The impact key frame of a strike is therefore shown for ticks
 * [wind, wind + active) of its age, which starts exactly on the contact tick. A fighter's own impact frame is never
 * covered by a hit reaction.
 *
 * THE FRAME LIST (which sprite is shown for which action) IS DATA ON THIS PAGE: FRAME, REF, STRIKE_SEQ, LOOPS, SINGLES
 * and TIMING. Retune here; nothing else needs to change.
 */
import { V5_STRIKES, isV5Strike, type FighterId, type V5Event, type V5Frame, type V5Strike } from '@sollish/protocol';

export const TICK_MS = 50;
export type Replay = { frames: readonly V5Frame[]; events: readonly V5Event[] };

/** Fighter frame numbers (1-based; sheet 1 is 1..16 in reading order, sheet 2 is 17..32, sheet 3 is 33..48: see ALT). */
export const FRAME = {
  guard: 1, guardLow: 2, stepFwd: 3, stepBack: 4, jab: 5, cross: 6, leadHookMid: 7, leadHookHit: 8, rearHookHit: 9,
  uppercutLoad: 10, uppercutHit: 11, bodyHook: 12, slip: 13, duck: 14, block: 15, clinch: 16,
  teepChamber: 17, teep: 18, lowKick: 19, roundChamber: 20, bodyKick: 21, headKick: 22, knee: 23,
  hitHead: 24, hitBody: 25, hitLeg: 26, stagger: 27, falling: 28, lying: 29, rising: 30, victory: 31, exhausted: 32,
} as const;
export const FIGHTER_FRAME_COUNT = 48;
/** Source cells that are unusable in a character's sheet: the frame shown instead (the build script omits them, see OMIT there). */
export const FRAME_ALIAS: Readonly<Partial<Record<'kor' | 'ayaz' | 'referee', Readonly<Record<number, number>>>>> = { kor: { [FRAME.clinch]: FRAME.block } };

/** Referee frame numbers (sheet of 4x3, reading order). */
export const REF = {
  watch: 1, walk: 2, separate: 3, countUp: 4, countDown: 5, waveOff: 6, pointCorner: 7, raiseWinner: 8,
  watchB: 9, watchC: 10, watchD: 11, watchE: 12,
} as const;
export const REF_FRAME_COUNT = 12;

/**
 * Per strike: key frames spread evenly over the wind-up ticks, the impact frame (shown on the contact tick and for
 * `active` ticks) and the recovery: [frame, share of the recovery span] pairs, in order.
 */
export type StrikeSeq = { wind: readonly number[]; hit: number; recover: readonly (readonly [number, number])[] };
const F = FRAME;
export const STRIKE_SEQ: Readonly<Record<V5Strike, StrikeSeq>> = {
  jab: { wind: [F.guard], hit: F.jab, recover: [[F.jab, .3], [F.guard, .7]] },
  cross: { wind: [F.guard], hit: F.cross, recover: [[F.cross, .3], [F.guard, .7]] },
  leadHook: { wind: [F.leadHookMid], hit: F.leadHookHit, recover: [[F.leadHookMid, .4], [F.guard, .6]] },
  rearHook: { wind: [F.guard], hit: F.rearHookHit, recover: [[F.rearHookHit, .3], [F.guard, .7]] },
  uppercut: { wind: [F.uppercutLoad], hit: F.uppercutHit, recover: [[F.uppercutHit, .3], [F.guard, .7]] },
  bodyHook: { wind: [F.guardLow, F.duck], hit: F.bodyHook, recover: [[F.bodyHook, .3], [F.guard, .7]] },
  teep: { wind: [F.teepChamber], hit: F.teep, recover: [[F.teep, .3], [F.teepChamber, .3], [F.guard, .4]] },
  lowKick: { wind: [F.roundChamber], hit: F.lowKick, recover: [[F.lowKick, .3], [F.roundChamber, .3], [F.guard, .4]] },
  bodyKick: { wind: [F.roundChamber], hit: F.bodyKick, recover: [[F.bodyKick, .3], [F.roundChamber, .3], [F.guard, .4]] },
  headKick: { wind: [F.guard, F.roundChamber], hit: F.headKick, recover: [[F.headKick, .3], [F.roundChamber, .3], [F.guard, .4]] },
  knee: { wind: [F.guard], hit: F.knee, recover: [[F.knee, .5], [F.guard, .5]] },
};

/**
 * Sheet 3 (frames 33..48), different for each fighter:
 * KOR: 33-38 forward walk cycle in guard, 39 jab extended, 40 and 42 cross extended, 41 guard, 43 jab half-retracted, 44 and 45 knee raised,
 *      46 high guard recovering, 47-48 bounce on toes. No back shuffle: retreat plays the walk cycle in reverse.
 * AYAZ: 33-38 forward walk cycle, 39-40 back shuffle, 41 jab chamber, 42 jab extended, 43 cross chamber, 44 hook chamber, 45 kick recovering
 *      (leg coming down), 46 hit recovery, 47-48 bounce.
 */
export const ALT = {
  kor: { walk: [33, 34, 35, 36, 37, 38], back: [38, 37, 36, 35, 34, 33], recover: 46, bounce: [47, 48], retract: 43, kneeUp: 44, kneeDown: 45 },
  ayaz: { walk: [33, 34, 35, 36, 37, 38], back: [39, 40], recover: 46, bounce: [47, 48], jabChamber: 41, crossChamber: 43, hookChamber: 44, kickDown: 45 },
} as const;
/** Per fighter overrides of STRIKE_SEQ (the sheet 3 key frames); anything not listed uses STRIKE_SEQ. */
const kneeUp = ALT.kor.kneeUp, kneeDown = ALT.kor.kneeDown, retract = ALT.kor.retract, kickDown = ALT.ayaz.kickDown;
export const STRIKE_SEQ_BY: Readonly<Record<'kor' | 'ayaz', Partial<Record<V5Strike, StrikeSeq>>>> = {
  kor: {
    jab: { wind: [F.guard], hit: F.jab, recover: [[F.jab, .25], [retract, .35], [F.guard, .4]] },
    cross: { wind: [F.guard], hit: F.cross, recover: [[F.cross, .25], [retract, .35], [F.guard, .4]] },
    teep: { wind: [F.teepChamber], hit: F.teep, recover: [[F.teep, .3], [kneeUp, .3], [F.guard, .4]] },
    lowKick: { wind: [F.roundChamber], hit: F.lowKick, recover: [[F.lowKick, .3], [kneeUp, .3], [F.guard, .4]] },
    bodyKick: { wind: [F.roundChamber], hit: F.bodyKick, recover: [[F.bodyKick, .3], [kneeUp, .3], [F.guard, .4]] },
    headKick: { wind: [F.guard, F.roundChamber], hit: F.headKick, recover: [[F.headKick, .3], [kneeUp, .3], [F.guard, .4]] },
    knee: { wind: [F.guard, kneeUp], hit: F.knee, recover: [[F.knee, .3], [kneeDown, .3], [F.guard, .4]] },
  },
  ayaz: {
    jab: { wind: [ALT.ayaz.jabChamber], hit: F.jab, recover: [[F.jab, .3], [F.guard, .7]] },
    cross: { wind: [ALT.ayaz.crossChamber], hit: F.cross, recover: [[F.cross, .3], [F.guard, .7]] },
    rearHook: { wind: [ALT.ayaz.hookChamber], hit: F.rearHookHit, recover: [[F.rearHookHit, .3], [F.guard, .7]] },
    teep: { wind: [F.teepChamber], hit: F.teep, recover: [[F.teep, .3], [kickDown, .3], [F.guard, .4]] },
    lowKick: { wind: [F.roundChamber], hit: F.lowKick, recover: [[F.lowKick, .3], [kickDown, .3], [F.guard, .4]] },
    bodyKick: { wind: [F.roundChamber], hit: F.bodyKick, recover: [[F.bodyKick, .3], [kickDown, .3], [F.guard, .4]] },
    headKick: { wind: [F.guard, F.roundChamber], hit: F.headKick, recover: [[F.headKick, .3], [kickDown, .3], [F.guard, .4]] },
    knee: { wind: [F.guard], hit: F.knee, recover: [[F.knee, .5], [F.guard, .5]] },
  },
};
export const seqOf = (who: FighterId, technique: V5Strike): StrikeSeq => STRIKE_SEQ_BY[who][technique] ?? STRIKE_SEQ[technique];
/** Idle: the breathing guard with a bounce on the toes (frames from sheet 3), `every` ticks per step. */
export const IDLE = { every: 4, cycle: (who: FighterId) => [F.guard, ALT[who].bounce[0], ALT[who].bounce[1], ALT[who].bounce[0], F.guard, F.guardLow] as readonly number[] };

/**
 * Walking is a cycle driven by DISTANCE TRAVELLED (the engine path length of the fighter), not by a clock: one key frame per
 * `phaseMm` of travel, forward / back / lateral lists by the direction of the motion relative to the opponent. Standing nearly
 * still (under `minSpeed` mm/s) falls back to the breathing guard. Retune the lists when the 6-phase walk frames arrive.
 */
export const WALK = {
  phaseMm: 190,
  minSpeed: 25,
  forward: (who: FighterId) => ALT[who].walk as readonly number[],
  back: (who: FighterId) => ALT[who].back as readonly number[],
  lateral: (who: FighterId) => ALT[who].walk as readonly number[],
};
/** Looping actions: idle breathing alternates every `every` ticks; the walking actions list the frames of their cycles. */
export const LOOPS = {
  guard: { frames: [F.guard, F.guardLow], every: 12 },
  neutral: { frames: [F.guardLow, F.guard], every: 12 },
  advance: { frames: [F.guard], every: 3 },
  retreat: { frames: [F.guard], every: 3 },
  circle: { frames: [F.guard], every: 3 },
} as const;
/** Smoothness: a displayed frame stays at least this long (ms) unless the new one is a priority (impact, hit, block, fall, finish). */
export const MIN_HOLD_MS = 70;
export const PRIORITY = new Set(['impact', 'hit', 'block', 'down', 'rise', 'winner', 'final']);
/** Held actions. `down` and `rise` are sequences (see TIMING.fallTicks). */
export const SINGLES = { slip: F.slip, roll: F.duck, clinch: F.clinch, stagger: F.stagger } as const;
export const DOWN = { falling: F.falling, lying: F.lying, rising: F.rising } as const;
/** Hit reaction by the body part that took the blow; a block shows the high-block frame. */
export const HIT_FRAME = { head: F.hitHead, body: F.hitBody, leg: F.hitLeg, guard: F.block } as const;
export const END_FRAME = { win: F.victory, lose: F.exhausted, tired: F.exhausted } as const;
/** After a hit reaction a fighter shows his recovery frame (sheet 3) for this many ticks before going back to his action. */
export const HIT_RECOVER_TICKS = 3;

export const TIMING = {
  /** Ticks of the falling frame after a knockdown before the fighter lies. */
  fallTicks: 6,
  /** Ticks the block frame stays after a blocked blow. */
  blockTicks: 4,
  /** Hit reaction: base ticks, +1 from 20 damage, +2 from 36 damage. */
  hitBase: 3,
  /** Stamina (of 1000) under which an idle fighter shows the exhausted frame. */
  tiredStamina: 100,
  /** Referee: ticks of the chopping arm per engine count and of pointing to the neutral corner after a knockdown. */
  refChop: 3,
  refPoint: 14,
  /** Referee idle: ticks per watch variant. */
  refWatch: 24,
} as const;

export const hitHold = (damage: number) => TIMING.hitBase + (damage >= 36 ? 2 : damage >= 20 ? 1 : 0);
export const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));

// ---- event index (cached per events array) ----------------------------------------------------------
type Index = { strikes: Record<FighterId, V5Event[]>; hits: Record<FighterId, V5Event[]>; blocks: Record<FighterId, V5Event[]>; knockdowns: V5Event[]; counts: V5Event[]; contacts: Map<string, V5Event> };
const cache = new WeakMap<readonly V5Event[], Index>();
function indexOf(events: readonly V5Event[]): Index {
  let ix = cache.get(events);
  if (ix) return ix;
  ix = { strikes: { kor: [], ayaz: [] }, hits: { kor: [], ayaz: [] }, blocks: { kor: [], ayaz: [] }, knockdowns: [], counts: [], contacts: new Map() };
  for (const e of events) {
    if (e.type === 'strike') ix.strikes[e.actor].push(e);
    if (e.type === 'hit') ix.hits[e.target].push(e);
    else if (e.type === 'block') ix.blocks[e.target].push(e);
    else if (e.type === 'knockdown') ix.knockdowns.push(e);
    else if (e.type === 'count') ix.counts.push(e);
    if (e.type === 'hit' || e.type === 'block' || e.type === 'dodge' || e.type === 'miss') ix.contacts.set(`${e.actor}:${e.tick}`, e);
  }
  cache.set(events, ix); return ix;
}
/** The newest event of `list` at or before `tick`. */
const latest = (list: readonly V5Event[], tick: number): V5Event | null => { let out: V5Event | null = null; for (const e of list) { if (e.tick > tick) break; out = e; } return out; };

// ---- path length (gait) ------------------------------------------------------------------------------
type Path = { cum: Float64Array; radial: Float64Array; lateral: Float64Array };
const paths = new WeakMap<object, Record<FighterId, Path>>();
function pathsOf(replay: Replay): Record<FighterId, Path> {
  let p = paths.get(replay.frames);
  if (p) return p;
  const n = replay.frames.length, mk = (id: FighterId): Path => {
    const cum = new Float64Array(n), radial = new Float64Array(n), lateral = new Float64Array(n), other: FighterId = id === 'kor' ? 'ayaz' : 'kor';
    for (let i = 1; i < n; i++) {
      const a = replay.frames[i - 1]![id], b = replay.frames[i]![id], o = replay.frames[i]![other], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      const ux = o.x - b.x, uz = o.z - b.z, ul = Math.hypot(ux, uz) || 1;
      cum[i] = cum[i - 1]! + d; radial[i] = (dx * ux + dz * uz) / ul; lateral[i] = Math.abs(dx * uz - dz * ux) / ul;
    }
    return { cum, radial, lateral };
  };
  p = { kor: mk('kor'), ayaz: mk('ayaz') }; paths.set(replay.frames, p); return p;
}
/** Engine path length (mm) travelled by `id` up to display tick `t`, his speed (mm/s over about 100 ms) and whether he is mostly closing, backing off or moving sideways. */
export function gaitAt(replay: Replay, id: FighterId, t: number) {
  const P = pathsOf(replay)[id], last = replay.frames.length - 1, i = Math.min(last, Math.max(0, Math.floor(t))), j = Math.min(last, i + 1), k = Math.max(0, i - 1);
  const cum = P.cum[i]! + (P.cum[j]! - P.cum[i]!) * clamp(t - i);
  const span = Math.max(1, j - k), speed = (P.cum[j]! - P.cum[k]!) / span * (1000 / TICK_MS);
  let rad = 0, lat = 0; for (let q = Math.max(1, k + 1); q <= j; q++) { rad += P.radial[q]!; lat += P.lateral[q]!; }
  return { cum, speed, mode: Math.abs(rad) < lat * .8 ? 'lateral' as const : rad > 0 ? 'forward' as const : 'back' as const };
}
/** The 'strike' events of `actor` (each starts a strike at its tick), in order. */
export const strikesOf = (replay: Replay, actor: FighterId): readonly V5Event[] => indexOf(replay.events).strikes[actor];
/** The contact event (hit, block, dodge or miss) of the strike `actor` started whose contact check ran on `tick`. */
export function contactOf(replay: Replay, actor: FighterId, tick: number): V5Event | null { return indexOf(replay.events).contacts.get(`${actor}:${tick}`) ?? null; }

export type Outcome = 'win' | 'lose' | 'draw' | null;
export type Pose = { frame: number; why: string };

/** The sequence frame of a strike at `age` ticks (float) since it started; null once its span is over. */
export function strikeFrame(technique: V5Strike, age: number, who: FighterId = 'kor'): { frame: number; part: 'wind' | 'impact' | 'recover' } | null {
  const s = V5_STRIKES[technique], q = seqOf(who, technique);
  if (age < 0) return null;
  if (age < s.wind) return { frame: q.wind[Math.min(q.wind.length - 1, Math.floor(age / s.wind * q.wind.length))]!, part: 'wind' };
  if (age < s.wind + s.active) return { frame: q.hit, part: 'impact' };
  const span = Math.max(1, s.end - s.wind - s.active), t = clamp((age - s.wind - s.active) / span, 0, .999999);
  let acc = 0;
  for (const [frame, share] of q.recover) { acc += share; if (t < acc - 1e-9) return { frame, part: 'recover' }; }
  return { frame: q.recover.at(-1)![0], part: 'recover' };
}

/** Every frame number an engine action can show (used by the tests: all of them must exist on disk). */
export function actionFrames(action: string, who: FighterId = 'kor'): number[] {
  if (isV5Strike(action)) { const q = seqOf(who, action); return [...new Set([...q.wind, q.hit, ...q.recover.map(r => r[0])])]; }
  if (action === 'advance' || action === 'retreat' || action === 'circle') return [...new Set([F.guard, ...WALK.forward(who), ...WALK.back(who), ...WALK.lateral(who)])];
  if (action === 'guard' || action === 'neutral') return [...new Set([...IDLE.cycle(who), F.guardLow, END_FRAME.tired, ALT[who].recover])];
  if (action in LOOPS) return [...LOOPS[action as keyof typeof LOOPS].frames];
  if (action in SINGLES) return [SINGLES[action as keyof typeof SINGLES]];
  if (action === 'down') return [DOWN.falling, DOWN.lying];
  if (action === 'rise') return [DOWN.rising];
  return [];
}
/** Engine actions of Contact 5 (non-strike actions, then every strike). */
export const ENGINE_ACTIONS: readonly string[] = ['guard', 'advance', 'retreat', 'circle', 'slip', 'roll', 'clinch', 'stagger', 'down', 'rise', 'neutral', ...Object.keys(V5_STRIKES)];

/** Which key frame fighter `id` shows at display tick `tickF` (float; 50 ms per tick). */
export function fighterPose(replay: Replay, id: FighterId, tickF: number, outcome: Outcome = null): Pose {
  const last = replay.frames.length - 1, t = clamp(tickF, 0, Math.max(0, last)), f = replay.frames[Math.min(last, Math.floor(t))]![id];
  const ix = indexOf(replay.events), age = t - f.actionAt;
  if (outcome === 'win') return { frame: END_FRAME.win, why: 'winner' };
  if (f.action === 'down') return { frame: age < TIMING.fallTicks ? DOWN.falling : DOWN.lying, why: 'down' };
  if (outcome === 'lose' || outcome === 'draw') return { frame: END_FRAME.lose, why: 'final' };
  if (f.action === 'rise') return { frame: DOWN.rising, why: 'rise' };
  const strike = isV5Strike(f.action) ? strikeFrame(f.action, age, id) : null;
  if (strike && strike.part === 'impact') return { frame: strike.frame, why: 'impact' };
  const hit = latest(ix.hits[id], t);
  if (hit && t - hit.tick < hitHold(hit.damage)) return { frame: HIT_FRAME[hit.bodyPart && hit.bodyPart !== 'guard' ? hit.bodyPart : 'body'], why: 'hit' };
  const block = latest(ix.blocks[id], t);
  if (block && t - block.tick < TIMING.blockTicks) return { frame: HIT_FRAME.guard, why: 'block' };
  if (hit && t - hit.tick < hitHold(hit.damage) + HIT_RECOVER_TICKS && !strike && !(f.action in SINGLES)) return { frame: ALT[id].recover, why: 'recover' };
  if (strike) return { frame: strike.frame, why: strike.part };
  const a = f.action;
  if (a in SINGLES) return { frame: SINGLES[a as keyof typeof SINGLES], why: a };
  if (a === 'advance' || a === 'retreat' || a === 'circle') {
    const g = gaitAt(replay, id, t);
    if (g.speed >= WALK.minSpeed) {
      const list = a === 'circle' || g.mode === 'lateral' ? WALK.lateral(id) : g.mode === 'forward' ? WALK.forward(id) : WALK.back(id);
      return { frame: list[Math.floor(g.cum / WALK.phaseMm) % list.length]!, why: 'walk' };
    }
  }
  if (a in LOOPS) {
    const loop = LOOPS[a as keyof typeof LOOPS];
    if ((a === 'guard' || a === 'neutral' || a === 'advance' || a === 'retreat' || a === 'circle') && f.stamina < TIMING.tiredStamina) return { frame: END_FRAME.tired, why: 'tired' };
    if (a === 'advance' || a === 'retreat' || a === 'circle') return { frame: F.guard, why: 'idle' };
    if (a === 'guard' || a === 'neutral') { const cyc = IDLE.cycle(id); return { frame: cyc[(Math.floor(t / IDLE.every) + (id === 'ayaz' ? 3 : 0)) % cyc.length]!, why: a }; }
    return { frame: loop.frames[0]!, why: a };
  }
  return { frame: F.guard, why: 'default' };
}

/** Referee key frame at display tick `tickF`. */
export function refereePose(replay: Replay, tickF: number, outcome: Outcome = null): Pose {
  const last = replay.frames.length - 1, t = clamp(tickF, 0, Math.max(0, last)), i = Math.min(last, Math.floor(t)), f = replay.frames[i]!, next = replay.frames[Math.min(last, i + 1)]!;
  const ix = indexOf(replay.events);
  if (outcome === 'win') return { frame: REF.raiseWinner, why: 'winner' };
  const mode = f.referee.mode;
  if (mode === 'stop') return { frame: REF.waveOff, why: 'stop' };
  if (mode === 'count') {
    const c = latest(ix.counts, t);
    return { frame: c && t - c.tick < TIMING.refChop ? REF.countDown : REF.countUp, why: 'count' };
  }
  if (mode === 'break') return { frame: REF.separate, why: 'break' };
  const kd = latest(ix.knockdowns, t);
  if (kd && t - kd.tick < TIMING.refPoint) return { frame: REF.pointCorner, why: 'neutral corner' };
  const moving = Math.abs(next.referee.x - f.referee.x) + Math.abs(next.referee.z - f.referee.z) > 6;
  if (moving) return { frame: Math.floor(t / 3) % 2 ? REF.walk : REF.watch, why: 'walk' };
  const idle = [REF.watch, REF.watchB, REF.watch, REF.watchC, REF.watch, REF.watchD, REF.watch, REF.watchE];
  return { frame: idle[Math.floor(t / TIMING.refWatch) % idle.length]!, why: 'watch' };
}

/** Frames shown by the referee in any state (for the tests). */
export const REF_FRAMES_USED: readonly number[] = Object.values(REF);

/** Ticks since the contact of the newest hit or block on `id`, or null (drives squash, shove and flashes). */
export function impactAge(replay: Replay, id: FighterId, tickF: number): { age: number; event: V5Event } | null {
  const ix = indexOf(replay.events), hit = latest(ix.hits[id], tickF), block = latest(ix.blocks[id], tickF);
  const e = hit && (!block || hit.tick >= block.tick) ? hit : block;
  return e ? { age: tickF - e.tick, event: e } : null;
}
