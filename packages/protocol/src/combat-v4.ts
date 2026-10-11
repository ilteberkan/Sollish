/** Ringside Contact 4: boxing tempo, combinations, defence and knockdown counts.
 * New engine id and namespace. Contact 3 (combat-v3.ts) is frozen byte for byte and keeps
 * settling its own accepted tickets. Positions are integer mm; one tick is 50 ms.
 * Controllers see only observable fight state. No wager, balance, identity, exposure,
 * house result or future seed enters a decision. The connectome readout picks the tactical
 * intent; combinations, range and defence are explicit, documented rules, not learning.
 */
import type { FighterId } from './combat';
import { contactGuardPose, separateBodies, type ContactInitial, type ContactPose, type Point3 } from './combat-v3';
import { createPolicyState, evaluateCombatPolicy, CONNECTOME_POLICY_INFO } from './connectome-policy';

export const COMBAT_V4_VERSION = 'ringside-contact-4-f8cd1d1f' as const;
export const COMBAT_V4_DURATION_MS = 45_000;
export const V4_TICK_MS = 50;
const LAST_TICK = COMBAT_V4_DURATION_MS / V4_TICK_MS;

/** wind = ticks before the contact check, active = ticks the hand stays out, end = total ticks. */
export const V4_STRIKES = Object.freeze({
  jab: { wind: 2, active: 2, end: 7, reach: 1160, target: 'head', kind: 'straight', hand: 'lead', damage: 20, stun: 14, cost: 35, drain: 0 },
  cross: { wind: 3, active: 2, end: 9, reach: 1090, target: 'head', kind: 'straight', hand: 'rear', damage: 38, stun: 30, cost: 60, drain: 0 },
  leadHook: { wind: 3, active: 2, end: 9, reach: 890, target: 'head', kind: 'hook', hand: 'lead', damage: 40, stun: 34, cost: 65, drain: 0 },
  rearHook: { wind: 4, active: 2, end: 11, reach: 910, target: 'head', kind: 'hook', hand: 'rear', damage: 46, stun: 40, cost: 75, drain: 0 },
  uppercut: { wind: 4, active: 2, end: 11, reach: 770, target: 'head', kind: 'upper', hand: 'rear', damage: 48, stun: 44, cost: 75, drain: 0 },
  bodyHook: { wind: 3, active: 2, end: 9, reach: 890, target: 'body', kind: 'hook', hand: 'lead', damage: 32, stun: 0, cost: 60, drain: 90 },
} as const);
export type V4Strike = keyof typeof V4_STRIKES;
export type V4Action = 'guard' | 'advance' | 'retreat' | 'circle' | 'slip' | 'roll' | 'clinch' | 'stagger' | 'down' | 'rise' | 'neutral' | V4Strike;
export type V4Fighter = { id: FighterId; x: number; z: number; yawMilliRad: number; health: number; stamina: number; stun: number; action: V4Action; actionAt: number; until: number; phase: 'idle' | 'windup' | 'active' | 'recovery'; combo: number; hits: number; knockdowns: number; pose: ContactPose };
export type V4Referee = { x: number; z: number; yawMilliRad: number; mode: 'watch' | 'break' | 'count' | 'stop'; count: number };
export type V4Frame = { tick: number; kor: V4Fighter; ayaz: V4Fighter; referee: V4Referee };
export type V4Event = { tick: number; type: 'strike' | 'hit' | 'block' | 'dodge' | 'miss' | 'knockdown' | 'count' | 'rise' | 'clinch' | 'break' | 'finish'; actor: FighterId; target: FighterId; technique: V4Action; damage: number; bodyPart?: 'head' | 'body' | 'guard'; counter?: boolean; combo?: number; count?: number };
export type V4Replay = { version: typeof COMBAT_V4_VERSION; policy: string; seed: string; frames: V4Frame[]; events: V4Event[]; winner: FighterId | 'draw'; firstHit: FighterId | 'simultaneous' | 'none'; knockdown: 'yes' | 'no'; finish: 'stoppage' | 'decision'; points: { kor: number; ayaz: number } };

/** Published, symmetric-in-value fighter traits: a shorter puncher and a longer, quicker boxer. */
export const V4_FIGHTERS = Object.freeze({
  kor: { reach: -45, power: 1.06, chin: 1.1, guard: .98 },
  ayaz: { reach: 55, power: .96, chin: .98, guard: 1.02 },
});
const BLOCK_BASE = { straight: .36, hook: .26, upper: .18 } as const;
const BODY_RADIUS = 300, BOUND = 3100, NEUTRAL = 3100;
const isStrike = (a: V4Action): a is V4Strike => Object.hasOwn(V4_STRIKES, a);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (x: number, y: number, z: number): Point3 => ({ x: Math.round(x), y: Math.round(y), z: Math.round(z) });
function rng(seed: string, stream: number) {
  let a = (parseInt(seed.slice(stream * 16, stream * 16 + 8), 16) ^ parseInt(seed.slice(stream * 16 + 8, stream * 16 + 16), 16)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return (t ^ t >>> 14) >>> 0; };
}
type Agent = V4Fighter & { rng: () => number; memory: Float64Array; queue: V4Strike[]; counter: boolean; counterUntil: number; lastStrike: number; high: number; low: number; points: number; resolved: boolean; pending: V4Strike[]; corner: { x: number; z: number } | null };
const view = (a: Agent): V4Fighter => ({ id: a.id, x: a.x, z: a.z, yawMilliRad: a.yawMilliRad, health: a.health, stamina: a.stamina, stun: a.stun, action: a.action, actionAt: a.actionAt, until: a.until, phase: a.phase, combo: a.combo, hits: a.hits, knockdowns: a.knockdowns, pose: structuredClone(a.pose) });

/** Approximate effector pose for overhead views and audits; contact is resolved by range rules. */
function pose(a: Agent, b: Agent, tick: number): ContactPose {
  const p = contactGuardPose(a);
  if (a.action === 'down') { const d = contactGuardPose(a); return { ...d, head: point(a.x, 260, a.z), chest: point(a.x, 220, a.z), leftHand: point(a.x - 200, 80, a.z), rightHand: point(a.x + 200, 80, a.z), leftElbow: point(a.x - 220, 160, a.z), rightElbow: point(a.x + 220, 160, a.z) }; }
  if (!isStrike(a.action)) return p;
  const s = V4_STRIKES[a.action], age = tick - a.actionAt, hand = s.hand === 'lead' ? 'leftHand' : 'rightHand';
  const out = age < s.wind ? age / s.wind * .2 : age < s.wind + s.active ? 1 : Math.max(0, 1 - (age - s.wind - s.active) / Math.max(1, s.end - s.wind - s.active));
  const target = point(b.x, s.target === 'head' ? 1620 : 1150, b.z), from = p[hand];
  p[hand] = point(from.x + (target.x - from.x) * out * .8, from.y + (target.y - from.y) * out * .8, from.z + (target.z - from.z) * out * .8);
  return p;
}

export function simulateContactCombatV4(seed: string, initial: ContactInitial = { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } }): V4Replay {
  if (CONNECTOME_POLICY_INFO.modelSha256 !== 'f8cd1d1feb8cf62f39eb2f1b11ebf95728deb8990f83594230d15709d2d9db9e') throw new Error('Frozen policy changed; create a new arena version');
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new TypeError('Expected a 32-byte lowercase seed');
  for (const key of ['health', 'stamina'] as const) for (const side of ['kor', 'ayaz'] as const) if (!Number.isInteger(initial[key][side]) || initial[key][side] < 1 || initial[key][side] > 1000) throw new TypeError('Invalid initial fighter state');
  const create = (id: FighterId, index: number): Agent => {
    const base = { id, x: index ? 1300 : -1300, z: 0, yawMilliRad: index ? -1571 : 1571 };
    return { ...base, health: initial.health[id], stamina: initial.stamina[id], stun: 0, action: 'guard', actionAt: 0, until: 6 + index * 3, phase: 'idle', combo: 0, hits: 0, knockdowns: 0, pose: contactGuardPose(base), rng: rng(seed, index), memory: createPolicyState(), queue: [], counter: false, counterUntil: -1, lastStrike: 0, high: -99, low: -99, points: 0, resolved: true, pending: [], corner: null };
  };
  const agents = [create('kor', 0), create('ayaz', 1)] as [Agent, Agent];
  const judge = rng(seed, 2), ref = { x: 0, z: -1600, yawMilliRad: 0, mode: 'watch' as V4Referee['mode'], count: 0 };
  const frames: V4Frame[] = [], events: V4Event[] = [];
  type Knock = { down: Agent; standing: Agent; at: number; count: number; stop: boolean };
  // Assigned inside resolve(); the cast keeps control-flow narrowing from assuming null.
  let stopped = false, winner: V4Replay['winner'] = 'draw', knock = null as Knock | null, clinchUntil = -1;
  const emit = (tick: number, type: V4Event['type'], a: Agent, b: Agent, technique: V4Action, damage = 0, extra: Partial<V4Event> = {}) => events.push({ tick, type, actor: a.id, target: b.id, technique, damage, ...extra });
  const set = (a: Agent, action: V4Action, tick: number, span: number) => { a.action = action; a.actionAt = tick; a.until = tick + span; a.phase = isStrike(action) ? 'windup' : 'idle'; a.combo = isStrike(action) ? a.combo : 0; };
  const startStrike = (a: Agent, b: Agent, s: V4Strike, tick: number, combo: number, counter: boolean) => {
    const spec = V4_STRIKES[s];
    a.combo = combo; set(a, s, tick, combo > 0 ? spec.end - 2 : spec.end); a.combo = combo; a.counter = counter;
    a.stamina = Math.max(0, a.stamina - spec.cost); a.lastStrike = tick; a.resolved = false;
    emit(tick, 'strike', a, b, s, 0, { combo, ...(counter ? { counter: true } : {}) });
  };
  const reachOf = (a: Agent, s: V4Strike) => V4_STRIKES[s].reach + V4_FIGHTERS[a.id].reach;
  const pickCombo = (a: Agent, family: 'jab' | 'cross' | 'hook' | 'body' | 'power', d: number): V4Strike[] => {
    const r = a.rng() % 100;
    if (family === 'jab') return d > 1020 ? (r < 40 ? ['jab'] : r < 65 ? ['jab', 'jab'] : ['jab', 'cross']) : (r < 35 ? ['jab', 'cross'] : r < 65 ? ['jab', 'cross', 'leadHook'] : r < 85 ? ['jab', 'bodyHook'] : ['jab', 'jab', 'cross']);
    if (family === 'cross') return r < 25 ? ['cross'] : r < 50 ? ['jab', 'cross'] : r < 80 ? ['cross', 'leadHook'] : ['cross', 'leadHook', 'cross'];
    if (family === 'hook') return d > 900 ? (r < 50 ? ['jab', 'rearHook'] : ['leadHook', 'rearHook']) : (r < 25 ? ['leadHook', 'rearHook'] : r < 55 ? ['bodyHook', 'leadHook'] : r < 75 ? ['uppercut', 'leadHook'] : r < 85 ? ['leadHook'] : ['jab', 'bodyHook']);
    if (family === 'body') return r < 40 ? ['bodyHook'] : r < 70 ? ['jab', 'bodyHook'] : ['bodyHook', 'uppercut'];
    return r < 50 ? ['cross', 'leadHook', 'rearHook'] : ['leadHook', 'uppercut', 'leadHook'];
  };
  const engage = (a: Agent, b: Agent, combo: V4Strike[], tick: number, counter = false) => {
    const fit = combo.filter((s, i) => a.stamina >= combo.slice(0, i + 1).reduce((n, k) => n + V4_STRIKES[k].cost, 0));
    if (!fit.length) { set(a, 'guard', tick, 6); return; }
    const d = dist(a, b);
    if (d > reachOf(a, fit[0]!) + 120 && !counter) { a.pending = fit; set(a, 'advance', tick, clamp(Math.ceil((d - reachOf(a, fit[0]!) + 80) / 65), 2, 10)); return; }
    a.queue = fit.slice(1); a.pending = []; startStrike(a, b, fit[0]!, tick, 0, counter);
  };
  const observe = (a: Agent, b: Agent, tick: number) => {
    const d = dist(a, b), bearing = Math.atan2(b.x - a.x, b.z - a.z), delta = Math.atan2(Math.sin(bearing - a.yawMilliRad / 1000), Math.cos(bearing - a.yawMilliRad / 1000)), visible = Math.abs(delta) <= Math.PI / 3;
    return [clamp(d / 2000 - 1, -1, 1), a.stamina / 500 - 1, a.health / 500 - 1, visible && isStrike(b.action) && b.phase === 'windup' ? 1 : -1, visible && b.phase === 'recovery' ? 1 : -1, Math.abs(a.x) > 2600 || Math.abs(a.z) > 2600 ? 1 : -1, clamp(delta / (Math.PI / 3), -1, 1), tick - a.high < 30 ? 1 : -1, tick - a.low < 30 ? 1 : -1, clamp((tick - a.lastStrike) / 40 - 1, -1, 1)];
  };
  const decide = (a: Agent, b: Agent, tick: number) => {
    const intent = evaluateCombatPolicy(observe(a, b, tick), a.memory).action;
    const d = dist(a, b), r = a.rng() % 100;
    if (a.pending.length) { const combo = a.pending; a.pending = []; if (d <= reachOf(a, combo[0]!) + 160) { engage(a, b, combo, tick); return; } }
    if (a.stun > 70) { if (d < 820 && r < 35) { clinch(a, b, tick); return; } set(a, r < 60 ? 'guard' : 'retreat', tick, 6 + r % 4); return; }
    if (a.stamina < 140) { if (d < 800 && r < 40) { clinch(a, b, tick); return; } set(a, r < 50 ? 'retreat' : 'guard', tick, 7 + r % 4); return; }
    if (tick < a.counterUntil) { a.counterUntil = -1; engage(a, b, r < 50 ? ['cross'] : r < 80 ? ['leadHook', 'rearHook'] : ['uppercut', 'leadHook'], tick, true); return; }
    if (b.stun > 70 && d < 1350) { engage(a, b, pickCombo(a, 'power', d), tick); return; }
    const wall = Math.abs(a.x) > 2650 || Math.abs(a.z) > 2650;
    if (tick - a.lastStrike > 34) { engage(a, b, pickCombo(a, d > 950 ? 'jab' : 'hook', d), tick); return; }
    if (intent === 'jab') { engage(a, b, pickCombo(a, 'jab', d), tick); return; }
    if (intent === 'cross') { engage(a, b, pickCombo(a, 'cross', d), tick); return; }
    if (intent === 'hook') { engage(a, b, pickCombo(a, 'hook', d), tick); return; }
    if (intent === 'kick') { engage(a, b, pickCombo(a, 'body', d), tick); return; }
    if (intent === 'slip') {
      if (isStrike(b.action) && b.phase === 'windup') { const k = V4_STRIKES[b.action].kind; set(a, k === 'straight' ? 'slip' : k === 'hook' ? 'roll' : 'guard', tick, 6); return; }
      set(a, d < 1100 ? (r < 60 ? 'slip' : 'roll') : 'circle', tick, d < 1100 ? 5 + r % 3 : 9); return;
    }
    if (wall) { set(a, 'circle', tick, 10 + r % 4); return; }
    if (intent === 'guard') { set(a, d > 1400 ? 'advance' : 'guard', tick, 5 + r % 4); return; }
    if (intent === 'advance') { set(a, d > 1050 ? 'advance' : d < 880 ? 'retreat' : 'circle', tick, 6 + r % 5); return; }
    set(a, 'circle', tick, 8 + r % 5);
  };
  const clinch = (a: Agent, b: Agent, tick: number) => {
    const span = 18 + judge() % 10;
    for (const x of [a, b]) { x.queue = []; x.pending = []; set(x, 'clinch', tick, span); }
    clinchUntil = tick + span; emit(tick, 'clinch', a, b, 'clinch');
  };
  const resolve = (a: Agent, b: Agent, tick: number) => {
    const spec = V4_STRIKES[a.action as V4Strike], s = a.action as V4Strike, d = dist(a, b);
    a.resolved = true;
    const extra = { combo: a.combo, ...(a.counter ? { counter: true } : {}) };
    if (d > reachOf(a, s) || ['down', 'rise', 'neutral', 'clinch'].includes(b.action)) { emit(tick, 'miss', a, b, s, 0, extra); a.queue = a.queue.slice(0, 1); return; }
    // A strike that already connected this tick is committed; only an unresolved one can be beaten to the punch.
    const busy = isStrike(b.action) && b.phase !== 'recovery' && !b.resolved, stunned = b.stun > 70;
    const staminaF = .55 + .45 * b.stamina / 1000, roll = judge() % 1000 / 1000;
    let outcome: 'hit' | 'block' | 'dodge' = 'hit', mult = 1;
    if (spec.target === 'head') {
      const early = tick - b.actionAt <= 4 && roll < .72;
      if (b.action === 'slip' && spec.kind === 'straight' && early) outcome = 'dodge';
      else if (b.action === 'roll' && spec.kind === 'hook' && early) outcome = 'dodge';
      else if (b.action === 'roll' && spec.kind === 'upper') mult = 1.35;
      else if (b.action === 'guard') outcome = spec.kind === 'upper' && roll < .5 ? 'hit' : 'block';
      else {
        const block = busy ? .08 : BLOCK_BASE[spec.kind] * V4_FIGHTERS[b.id].guard * staminaF * (stunned ? .45 : 1);
        const slip = (b.action === 'circle' || b.action === 'retreat') && spec.kind === 'straight' ? .12 : .04;
        outcome = roll < block ? 'block' : roll < block + slip ? 'dodge' : 'hit';
      }
    } else {
      const block = busy ? .05 : (b.action === 'guard' ? .3 : .22) * V4_FIGHTERS[b.id].guard * staminaF;
      outcome = roll < block ? 'block' : 'hit';
    }
    if (outcome === 'dodge') { b.counterUntil = tick + 8; a.queue = []; emit(tick, 'dodge', a, b, s, 0, extra); return; }
    const base = spec.damage * V4_FIGHTERS[a.id].power * (.6 + .4 * a.stamina / 1000);
    if (outcome === 'block') {
      const dmg = Math.floor(base / 6);
      b.health = Math.max(0, b.health - dmg); b.stamina = Math.max(0, b.stamina - 15); b.stun += 2; a.points += dmg;
      emit(tick, 'block', a, b, s, dmg, { ...extra, bodyPart: 'guard' }); return;
    }
    const dmg = Math.round(base * mult * (.85 + judge() % 300 / 1000) * (a.counter ? 1.3 : 1) * (busy ? 1.15 : 1));
    b.health = Math.max(0, b.health - dmg); a.hits++; a.points += dmg;
    if (spec.target === 'head') { b.stun += Math.round(spec.stun * dmg / spec.damage / V4_FIGHTERS[b.id].chin); b.high = tick; }
    else { b.stamina = Math.max(0, b.stamina - spec.drain); b.low = tick; }
    emit(tick, 'hit', a, b, s, dmg, { ...extra, bodyPart: spec.target });
    if (busy || b.stun > 55) { b.queue = []; b.pending = []; if (isStrike(b.action) && b.resolved) b.until = Math.min(b.until, tick + 3); else set(b, 'stagger', tick, b.stun > 55 ? 7 : 4); }
    const threshold = (40 + b.health / 14) * V4_FIGHTERS[b.id].chin;
    if (b.health <= 0 || (spec.target === 'head' && b.stun >= threshold)) {
      b.knockdowns++; a.points += 120;
      for (const x of [a, b]) { x.queue = []; x.pending = []; }
      // The finishing punch completes (at most 4 ticks), then the standing fighter walks to a neutral corner.
      set(b, 'down', tick, 999); if (isStrike(a.action)) a.until = Math.min(a.until, tick + 4); else set(a, 'neutral', tick, 999);
      const corners = [{ x: -NEUTRAL, z: -NEUTRAL }, { x: NEUTRAL, z: NEUTRAL }];
      a.corner = dist(corners[0]!, b) > dist(corners[1]!, b) ? corners[0]! : corners[1]!;
      const stop = b.health <= 0 || b.knockdowns >= 3;
      knock = { down: b, standing: a, at: tick, count: stop ? 0 : clamp(3 + b.rng() % 4 + Math.floor((1000 - b.health) / 300), 3, 9), stop };
      emit(tick, 'knockdown', a, b, s, 0);
    }
  };

  for (let tick = 0; tick <= LAST_TICK; tick++) {
    if (!stopped) {
      for (const a of agents) { a.stun = Math.max(0, a.stun - 1); a.stamina = Math.min(1000, a.stamina + (isStrike(a.action) ? 1 : a.action === 'clinch' ? 6 : 4)); }
      // Knockdown count: the clock keeps running, the standing fighter waits in a neutral corner.
      if (knock) {
        const k = knock, since = tick - k.at;
        if (k.standing.action !== 'neutral' && tick >= k.standing.until && !stopped) set(k.standing, 'neutral', tick, 999);
        if (k.stop && since === 30) { stopped = true; winner = k.standing.id; ref.mode = 'stop'; set(k.standing, 'guard', tick, 999); emit(tick, 'finish', k.standing, k.down, 'down'); }
        else if (!k.stop && since > 0 && since % 20 === 0 && since / 20 <= k.count) { ref.count = since / 20; emit(tick, 'count', k.standing, k.down, 'down', 0, { count: ref.count }); }
        if (!k.stop && since === k.count * 20 + 4) { set(k.down, 'rise', tick, 16); k.down.stun = 20; emit(tick, 'rise', k.down, k.standing, 'rise'); }
        if (!k.stop && since === k.count * 20 + 20) { set(k.down, 'guard', tick, 8); set(k.standing, 'advance', tick, 8); k.standing.corner = null; knock = null; ref.mode = 'watch'; ref.count = 0; }
      }
      if (clinchUntil === tick) { emit(tick, 'break', agents[0], agents[1], 'clinch'); for (const a of agents) set(a, 'retreat', tick, 6); }
      if (!stopped && !knock) for (let i = 0; i < 2; i++) {
        const a = agents[i]!, b = agents[1 - i]!;
        if (a.action === 'clinch' && tick < a.until) continue;
        if (isStrike(a.action) && tick >= a.until && a.queue.length && dist(a, b) <= reachOf(a, a.queue[0]!) + 140) { const next = a.queue.shift()!; if (a.stamina >= V4_STRIKES[next].cost) { startStrike(a, b, next, tick, a.combo + 1, a.counter); continue; } a.queue = []; }
        if (tick >= a.until) { a.counter = false; decide(a, b, tick); }
      }
      // Movement.
      for (let i = 0; i < 2; i++) {
        const a = agents[i]!, b = agents[1 - i]!, d = dist(a, b) || 1, dx = (b.x - a.x) / d, dz = (b.z - a.z) / d, side = a.actionAt % 2 ? 1 : -1;
        const move = (f: number, l: number) => { a.x += Math.round(dx * f - dz * l); a.z += Math.round(dz * f + dx * l); };
        if (isStrike(a.action)) { const s = V4_STRIKES[a.action], age = tick - a.actionAt; a.phase = age < s.wind ? 'windup' : age < s.wind + s.active ? 'active' : 'recovery'; if (age <= s.wind && d > (s.kind === 'straight' ? 940 : 800)) move(s.kind === 'straight' ? 45 : 28, 0); }
        else if (a.action === 'advance') { if (d > 900) move(Math.min(65, d - 880), 0); }
        else if (a.action === 'retreat') move(-45, 0);
        else if (a.action === 'circle') move(d < 1000 ? -15 : d > 1300 ? 15 : 0, 30 * side);
        else if (a.action === 'slip' || a.action === 'roll') move(-8, 12 * side);
        else if (a.action === 'stagger') move(-22, 10 * side);
        else if (a.action === 'guard') { if (d < 760) move(-15, 0); }
        else if (a.action === 'clinch') { if (d > 640) move(Math.min(30, (d - 620) / 2), 0); }
        else if (a.action === 'neutral' && a.corner) { const cd = dist(a, a.corner); if (cd > 350) { a.x += Math.round((a.corner.x - a.x) / cd * Math.min(55, cd - 350)); a.z += Math.round((a.corner.z - a.z) / cd * Math.min(55, cd - 350)); } }
      }
      for (let pass = 0; pass < 3; pass++) { separateBodies(agents[0], agents[1], BODY_RADIUS * 2); for (const a of agents) { a.x = clamp(a.x, -BOUND, BOUND); a.z = clamp(a.z, -BOUND, BOUND); } }
      for (let i = 0; i < 2; i++) { const a = agents[i]!, b = agents[1 - i]!; if (a.action !== 'down' && a.action !== 'neutral') a.yawMilliRad = Math.round(Math.atan2(b.x - a.x, b.z - a.z) * 1000); else if (a.action === 'neutral' && a.corner && dist(a, a.corner) > 360) a.yawMilliRad = Math.round(Math.atan2(a.corner.x - a.x, a.corner.z - a.z) * 1000); }
      // Contact: each strike is checked once, on its first active tick.
      for (let i = 0; i < 2; i++) { const a = agents[i]!, b = agents[1 - i]!; if (isStrike(a.action) && !a.resolved && tick - a.actionAt === V4_STRIKES[a.action].wind && !knock) resolve(a, b, tick); }
      // Referee: orbit beside the pair, break clinches, count over a downed fighter.
      const [k0, a0] = agents, mid = { x: (k0.x + a0.x) / 2, z: (k0.z + a0.z) / 2 };
      let goal: { x: number; z: number };
      if (knock) { ref.mode = knock.stop ? 'stop' : 'count'; const v = dist(ref, knock.down) || 1; goal = { x: knock.down.x + (ref.x - knock.down.x) / v * 950, z: knock.down.z + (ref.z - knock.down.z) / v * 950 }; }
      else {
        const ax = a0.x - k0.x, az = a0.z - k0.z, n = Math.hypot(ax, az) || 1, px = -az / n, pz = ax / n, sgn = (ref.x - mid.x) * px + (ref.z - mid.z) * pz >= 0 ? 1 : -1;
        const span = k0.action === 'clinch' ? 520 : 1550; ref.mode = k0.action === 'clinch' ? 'break' : 'watch';
        goal = { x: clamp(mid.x + px * span * sgn, -BOUND, BOUND), z: clamp(mid.z + pz * span * sgn, -BOUND, BOUND) };
      }
      const rd = dist(ref, goal);
      if (rd > 1) { const step = Math.min(42, rd); ref.x = Math.round(ref.x + (goal.x - ref.x) / rd * step); ref.z = Math.round(ref.z + (goal.z - ref.z) / rd * step); }
      for (let pass = 0; pass < 3; pass++) for (const a of agents) { const d = dist(ref, a), min = ref.mode === 'break' ? 420 : 680; if (d < min) { const ux = d ? (ref.x - a.x) / d : 0, uz = d ? (ref.z - a.z) / d : -1; ref.x = Math.round(a.x + ux * (min + 2)); ref.z = Math.round(a.z + uz * (min + 2)); } }
      ref.x = clamp(ref.x, -BOUND, BOUND); ref.z = clamp(ref.z, -BOUND, BOUND);
      const look = knock ? knock.down : mid; ref.yawMilliRad = Math.round(Math.atan2(look.x - ref.x, look.z - ref.z) * 1000);
      agents[0].pose = pose(agents[0], agents[1], tick); agents[1].pose = pose(agents[1], agents[0], tick);
    }
    frames.push({ tick, kor: view(agents[0]), ayaz: view(agents[1]), referee: { ...ref } });
  }
  const points = { kor: agents[0].points, ayaz: agents[1].points };
  if (!stopped) winner = points.kor === points.ayaz ? 'draw' : points.kor > points.ayaz ? 'kor' : 'ayaz';
  const first = events.find(e => e.type === 'hit');
  return { version: COMBAT_V4_VERSION, policy: CONNECTOME_POLICY_INFO.version, seed, frames, events, winner, firstHit: !first ? 'none' : events.some(e => e.type === 'hit' && e.tick === first.tick && e.actor !== first.actor) ? 'simultaneous' : first.actor, knockdown: events.some(e => e.type === 'knockdown') ? 'yes' : 'no', finish: stopped ? 'stoppage' : 'decision', points };
}

export function contactFrameAtV4(replay: Pick<V4Replay, 'frames'>, elapsedMs: number) { return replay.frames[Math.floor(clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, COMBAT_V4_DURATION_MS) / V4_TICK_MS)]; }
