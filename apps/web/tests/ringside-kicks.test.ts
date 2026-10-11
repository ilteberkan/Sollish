// Gates for kicks and the knee (Contact 5), measured on synthetic frames so they hold even when a seed contains
// no kick: contact lands on the engine's contact tick at the target height, the support foot stays planted,
// bones keep their length, nothing pops between 60 Hz frames, and the blow reads on the receiver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contactGuardPose, V5_STRIKES, type FighterId, type V5Event, type V5Fighter, type V5Frame, type V5Kick } from '@sollish/protocol';
import { ringFrame, len, sub, DIMS, TICK_MS, type RingReplay } from '../lib/ringside-25d/motion';

const KICKS: V5Kick[] = ['teep', 'lowKick', 'bodyKick', 'headKick', 'knee'];
const K0 = 20, LAST = 80;
const other = (id: FighterId): FighterId => id === 'kor' ? 'ayaz' : 'kor';
const guard = (id: FighterId, x: number, yaw: number, over: Partial<V5Fighter> = {}): V5Fighter => ({ id, x, z: 0, yawMilliRad: yaw, health: 1000, stamina: 1000, stun: 0, action: 'guard', actionAt: 0, until: 999, phase: 'idle', combo: 0, hits: 0, knockdowns: 0, pose: contactGuardPose({ x, z: 0, yawMilliRad: yaw }), ...over });

/** One kick from `actor` at centre distance `dist` (mm); the log says hit / block / miss. */
function scene(actor: FighterId, tech: V5Kick, dist: number, outcome: 'hit' | 'block' | 'miss'): RingReplay {
  const spec = V5_STRIKES[tech], foe = other(actor), half = dist / 2, pos = { kor: { x: -half, yaw: 1571 }, ayaz: { x: half, yaw: -1571 } };
  const frames: V5Frame[] = [];
  for (let t = 0; t <= LAST; t++) {
    const kicking = t >= K0 && t < K0 + spec.end;
    const mk = (id: FighterId) => id === actor && kicking ? guard(id, pos[id].x, pos[id].yaw, { action: tech, actionAt: K0, until: K0 + spec.end, phase: t < K0 + spec.wind ? 'windup' : 'active' }) : guard(id, pos[id].x, pos[id].yaw, { actionAt: id === actor && t >= K0 + spec.end ? K0 + spec.end : 0 });
    frames.push({ tick: t, kor: mk('kor'), ayaz: mk('ayaz'), referee: { x: 0, z: -1600, yawMilliRad: 0, mode: 'watch', count: 0 } });
  }
  const part = spec.target === 'leg' ? 'leg' : spec.target;
  const events: V5Event[] = [{ tick: K0, type: 'strike', actor, target: foe, technique: tech, damage: 0 }];
  events.push(outcome === 'hit' ? { tick: K0 + spec.wind, type: 'hit', actor, target: foe, technique: tech, damage: spec.damage, bodyPart: part }
    : outcome === 'block' ? { tick: K0 + spec.wind, type: 'block', actor, target: foe, technique: tech, damage: 0, bodyPart: 'guard' }
      : { tick: K0 + spec.wind, type: 'miss', actor, target: foe, technique: tech, damage: 0 });
  return { frames, events };
}
const at = (r: RingReplay, ms: number) => ringFrame(r, { timeMs: ms, phase: 'fighting', clockMs: ms, winner: null }, false);
const seg = (p: { x: number; y: number; z: number }, a: typeof p, b: typeof p) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / (len(ab) ** 2 || 1))); return len(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t })); };

const results: Record<string, { missCm: number; heightCm: number; slideCm: number }> = {};
for (const actor of ['kor', 'ayaz'] as const) for (const tech of KICKS) for (const frac of [.93, .65]) {
  test(`${actor} ${tech} at ${Math.round(frac * 100)}% of its reach: lands on the contact tick at target height, support foot planted, bones intact`, () => {
    const spec = V5_STRIKES[tech], dist = spec.reach * frac, foe = other(actor), r = scene(actor, tech, dist, 'hit'), d = DIMS[actor];
    const support = spec.limb === 'leadLeg' ? 'rA' : 'lA', kickFoot = spec.limb === 'leadLeg' ? 'lA' : 'rA';
    // Contact tick: the limb is within reach of the aim and the aim is on the part the log names.
    const c = at(r, (K0 + spec.wind) * TICK_MS), a = c[actor], b = c[foe];
    assert.ok(a.strike?.kick && a.strike.aim, 'kick effector');
    const miss = len(sub(a.strike.point, a.strike.aim));
    const before = at(r, (K0 + spec.wind - 1) * TICK_MS)[actor].strike!, beforeMiss = len(sub(before.point, before.aim!));
    assert.ok(miss <= .08, `${tech} contact ${miss}`);
    assert.ok(miss <= beforeMiss + 1e-6, `${tech} is closing in on the contact tick (${miss} vs ${beforeMiss})`);
    const want = spec.target === 'head' ? b.j.head.y : spec.target === 'leg' ? (b.j.lH.y + b.j.lK.y) / 2 : b.j.pelvis.y + b.dims.torso * .38;
    const height = Math.abs(a.strike.point.y - want);
    assert.ok(height <= .15, `${tech} contact height off by ${height}`);
    // The aim sits on the surface of the part named by the log.
    if (spec.target === 'head') assert.ok(Math.abs(len(sub(a.strike.aim, b.j.head)) - (b.dims.headR + .045)) < .05);
    else if (spec.target === 'leg') assert.ok(seg(a.strike.aim, b.j.lH, b.j.lK) < .2);
    else assert.ok(seg(a.strike.aim, b.j.pelvis, b.j.neck) < .3);
    // Support foot: planted from the contact-tick-minus-wind pre-step landing to the end of the kick.
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], prev: Record<string, { x: number; y: number; z: number }> | null = null, worstBone = 0, worstArm = 0, worstBody = 0, worstLeg = 0;
    const slideFrom = K0 * TICK_MS, slideTo = (K0 + spec.end) * TICK_MS;
    for (let ms = (K0 - 4) * TICK_MS; ms <= (K0 + spec.end + 6) * TICK_MS; ms += 1000 / 60) {
      const f = at(r, ms), me = f[actor], j = me.j as unknown as Record<string, { x: number; y: number; z: number }>;
      if (ms >= slideFrom && ms <= slideTo) { const s = j[support]!; lo = [Math.min(lo[0]!, s.x), Math.min(lo[1]!, s.z)]; hi = [Math.max(hi[0]!, s.x), Math.max(hi[1]!, s.z)]; }
      for (const [p, q, dim] of [['lH', 'lK', d.thigh], ['lK', 'lA', d.shin], ['rH', 'rK', d.thigh], ['rK', 'rA', d.shin], ['lS', 'lE', d.upper], ['lE', 'lG', d.fore], ['rS', 'rE', d.upper], ['rE', 'rG', d.fore]] as const) worstBone = Math.max(worstBone, Math.abs(len(sub(j[p]!, j[q]!)) - dim));
      for (const k of Object.keys(j)) assert.ok(Number.isFinite(j[k]!.x + j[k]!.y + j[k]!.z), `${k} finite`);
      if (prev) for (const k of Object.keys(j)) { const step = len(sub(j[k]!, prev[k]!)); if (/^[lr][EG]$/.test(k)) worstArm = Math.max(worstArm, step); else if (/^[lr][KAT]$/.test(k)) worstLeg = Math.max(worstLeg, step); else worstBody = Math.max(worstBody, step); }
      prev = { ...j };
    }
    const slide = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!);
    results[`${actor}:${tech}:${frac}`] = { missCm: +(miss * 100).toFixed(1), heightCm: +(height * 100).toFixed(1), slideCm: +(slide * 100).toFixed(2) };
    assert.ok(slide <= .02, `${tech} support foot slid ${slide}`);
    assert.ok(worstBone < 2e-3, `bone length drift ${worstBone}`);
    assert.ok(worstArm < .4 && worstLeg < .36 && worstBody < .18, `jumps arm ${worstArm} leg ${worstLeg} body ${worstBody}`);
    // The kicking foot is back on the floor where it started when the kick ends.
    const startFoot = at(r, (K0 - 1) * TICK_MS)[actor].j[kickFoot === 'lA' ? 'lA' : 'rA'], endFoot = at(r, (K0 + spec.end + 4) * TICK_MS)[actor].j[kickFoot === 'lA' ? 'lA' : 'rA'];
    assert.ok(Math.hypot(endFoot.x - startFoot.x, endFoot.z - startFoot.z) <= .04 && endFoot.y <= startFoot.y + .02, `${tech} set down ${len(sub(endFoot, startFoot))}`);
  });
}

test('every kick reads on the receiver: low kick buckles the leg, body kicks and the knee fold, head kick snaps the head, teep pushes back', () => {
  const dev = (tech: V5Kick, pick: (b: ReturnType<typeof at>['ayaz']) => number) => {
    const spec = V5_STRIKES[tech], dist = spec.reach * .93, hit = scene('kor', tech, dist, 'hit'), none = scene('kor', tech, dist, 'miss');
    let best = 0;
    for (let k = 0; k <= 10; k++) { const ms = (K0 + spec.wind) * TICK_MS + k * 30; best = Math.max(best, Math.abs(pick(at(hit, ms).ayaz) - pick(at(none, ms).ayaz))); }
    return best;
  };
  const headMove = (b: ReturnType<typeof at>['ayaz']) => len(sub(b.j.head, b.j.pelvis)) + b.j.head.x * 0;
  assert.ok(dev('lowKick', b => b.j.pelvis.y) > .04, 'low kick lowers the hips');
  assert.ok(dev('bodyKick', b => b.j.chest.y) > .05, 'body kick folds the trunk');
  assert.ok(dev('knee', b => b.j.chest.y) > .05, 'knee folds the trunk');
  assert.ok(dev('headKick', b => b.j.head.z) + dev('headKick', b => b.j.head.x) > .08, 'head kick snaps the head');
  assert.ok(dev('headKick', headMove) > .02, 'head kick moves the head off the neck line');
  assert.ok(dev('teep', b => b.j.chest.x) > .04 || dev('teep', b => b.j.chest.y) > .03, 'teep pushes the trunk back');
});

test('kick synthetic summary', () => { console.log(JSON.stringify({ cases: Object.keys(results).length, maxMissCm: Math.max(...Object.values(results).map(r => r.missCm)), maxHeightCm: Math.max(...Object.values(results).map(r => r.heightCm)), maxSlideCm: Math.max(...Object.values(results).map(r => r.slideCm)) })); });
