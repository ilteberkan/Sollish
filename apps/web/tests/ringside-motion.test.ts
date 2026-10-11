// Gates for the code-authored 2.5D motion (apps/web/lib/ringside-25d/motion.ts), measured on real
// Contact 5 replays at 60 Hz: glove-to-target gap on every recorded hit, planted-foot slide, bone
// lengths, finite joints and per-frame joint jumps. Presentation only; no result depends on these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateContactCombatV5, V5_STRIKES, isV5Kick, type V5Strike } from '@sollish/protocol';
import { ringFrame, len, sub, DIMS, TICK_MS, _test, type RingReplay, type Body } from '../lib/ringside-25d/motion';

const seed = (s: string) => createHash('sha256').update(`motion:${s}`).digest('hex');
const replays: RingReplay[] = Array.from({ length: Number(process.env.MOTION_SEEDS ?? 6) }, (_, i) => simulateContactCombatV5(seed(String(i))));
const at = (r: RingReplay, ms: number) => ringFrame(r, { timeMs: ms, phase: 'fighting', clockMs: ms, winner: null }, false);
const JOINTS = ['pelvis', 'chest', 'neck', 'head', 'lS', 'lE', 'lG', 'rS', 'rE', 'rG', 'lH', 'lK', 'lA', 'lT', 'rH', 'rK', 'rA', 'rT'] as const;
export const metrics = { gaps: [] as number[], slide: [] as number[], jump: [] as { d: number; what: string }[] };

export const kickMetrics = { head: [] as number[], body: [] as number[], leg: [] as number[], kicks: 0 };
const seg = (p: Body['j']['head'], a: Body['j']['head'], b: Body['j']['head']) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / (len(ab) ** 2 || 1))); return len(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t })); };
/** Distance error (m) between a limb's contact point and the surface of the part the log says it hit. */
export function contactError(f: ReturnType<typeof at>, actor: 'kor' | 'ayaz', target: 'kor' | 'ayaz', part: string): number | null {
  const a = f[actor], b = f[target], pt = a.strike?.point;
  if (!pt) return null;
  if (part === 'head') return Math.abs(len(sub(pt, b.j.head)) - (b.dims.headR + (a.strike!.kick ? .045 : a.dims.glove)));
  if (part === 'leg') return Math.abs(seg(pt, b.j.lH, b.j.lK) - (.085 * b.dims.limb + .045));
  return null;
}

test('every recorded clean hit puts the glove on the target surface (gap <= 3 cm); kicks land on their target (gap <= 4 cm)', () => {
  for (const r of replays) for (const e of r.events) {
    if (e.type !== 'hit') continue;
    const f = at(r, e.tick * TICK_MS), a = f[e.actor], b = f[e.target];
    assert.ok(a.strike, `strike at ${e.tick}`);
    const spec = V5_STRIKES[e.technique as V5Strike];
    if (isV5Kick(e.technique)) {
      kickMetrics.kicks++;
      const miss = len(sub(a.strike.point, a.strike.aim!));
      // The aim itself sits on the target surface: its distance to the part is the part's radius plus the limb's.
      if (e.bodyPart === 'head') { kickMetrics.head.push(miss); assert.ok(Math.abs(len(sub(a.strike.aim!, b.j.head)) - (b.dims.headR + .045)) < .05, 'head aim'); }
      else if (e.bodyPart === 'leg') { kickMetrics.leg.push(miss); assert.ok(seg(a.strike.aim!, b.j.lH, b.j.lK) < .2, 'leg aim'); }
      else { kickMetrics.body.push(miss); assert.ok(seg(a.strike.aim!, b.j.pelvis, b.j.neck) < .3, 'body aim'); }
      continue;
    }
    const g = a.strike?.hand === 'l' ? a.j.lG : a.j.rG;
    if (spec.target === 'head') metrics.gaps.push(Math.abs(len(sub(g, b.j.head)) - (b.dims.headR + a.dims.glove)));
  }
  metrics.gaps.sort((x, y) => x - y);
  const p95 = metrics.gaps[Math.floor(metrics.gaps.length * .95)]!, max = metrics.gaps.at(-1)!;
  const q = (xs: number[]) => { xs.sort((x, y) => x - y); return xs.length ? { n: xs.length, p95cm: +(xs[Math.floor(xs.length * .95)]! * 100).toFixed(2), maxCm: +(xs.at(-1)! * 100).toFixed(2) } : null; };
  console.log(JSON.stringify({ headHits: metrics.gaps.length, gapP95cm: +(p95 * 100).toFixed(2), gapMaxCm: +(max * 100).toFixed(2), kicksLanded: kickMetrics.kicks, kickHead: q(kickMetrics.head), kickBody: q(kickMetrics.body), kickLeg: q(kickMetrics.leg) }));
  assert.ok(p95 <= .03, `p95 ${p95}`);
});

test('bones keep their length and joints stay finite at 60 Hz; no joint jumps between frames', () => {
  const bones: [typeof JOINTS[number], typeof JOINTS[number], keyof typeof DIMS.kor][] = [['lS', 'lE', 'upper'], ['lE', 'lG', 'fore'], ['rS', 'rE', 'upper'], ['rE', 'rG', 'fore'], ['lH', 'lK', 'thigh'], ['lK', 'lA', 'shin'], ['rH', 'rK', 'thigh'], ['rK', 'rA', 'shin']];
  for (const r of replays.slice(0, 3)) {
    let prev: Record<string, Body> | null = null;
    const end = (r.frames.length - 1) * TICK_MS;
    for (let ms = 0; ms <= end; ms += 1000 / 60) {
      const f = at(r, ms);
      for (const id of ['kor', 'ayaz', 'ref'] as const) {
        const b = f[id];
        for (const k of JOINTS) assert.ok(Number.isFinite(b.j[k].x + b.j[k].y + b.j[k].z), `${id}.${k} at ${ms}`);
        for (const [a, c, d] of bones) assert.ok(Math.abs(len(sub(b.j[a], b.j[c])) - b.dims[d]) < 2e-3, `${id} ${a}-${c} ${len(sub(b.j[a], b.j[c]))} vs ${b.dims[d]}`);
        if (prev) for (const k of JOINTS) metrics.jump.push({ d: len(sub(b.j[k], prev[id]!.j[k])), what: `${id}.${k}@${Math.round(ms)}:${b.action}` });
      }
      prev = { kor: f.kor, ayaz: f.ayaz, ref: f.ref };
    }
  }
  metrics.jump.sort((x, y) => x.d - y.d);
  const isArm = (j: { what: string }) => /\.(l|r)(G|E)@/.test(j.what), isKickLeg = (j: { what: string }) => /\.(l|r)(K|A|T)@/.test(j.what);
  const arm = metrics.jump.filter(isArm), kickLeg = metrics.jump.filter(isKickLeg), body = metrics.jump.filter(j => !isArm(j) && !isKickLeg(j));
  const p99 = metrics.jump[Math.floor(metrics.jump.length * .99)]!, armMax = arm.at(-1)!, bodyMax = body.at(-1)!, kickMax = kickLeg.at(-1)!;
  console.log(JSON.stringify({ frames: metrics.jump.length, jointStepP99cm: +(p99.d * 100).toFixed(2), armStepMaxCm: +(armMax.d * 100).toFixed(2), armWorst: armMax.what, bodyStepMaxCm: +(bodyMax.d * 100).toFixed(2), bodyWorst: bodyMax.what, kickLegStepMaxCm: +(kickMax.d * 100).toFixed(2), kickLegWorst: kickMax.what }));
  // A hook reaches 15-20 m/s at the glove and a hooked head snaps at up to ~9 m/s; 40 cm per 60 Hz frame
  // (24 m/s) for a glove or elbow, or 18 cm (11 m/s) for the head, trunk and legs, is a pop, not a punch.
  // A roundhouse shin/foot reaches 12-20 m/s and a leg cut short by a blow retracts just as fast, so the lower leg
  // (knee, ankle, toe) gets 36 cm (21.6 m/s); a knee flipping to the other side of the leg moves 50 cm or more.
  assert.ok(armMax.d < .4, `arm jump ${armMax.d} ${armMax.what}`);
  assert.ok(bodyMax.d < .18, `body jump ${bodyMax.d} ${bodyMax.what}`);
  assert.ok(kickMax.d < .36, `kicking leg jump ${kickMax.d} ${kickMax.what}`);
});

test('planted feet do not slide (<= 2 cm per step) and steps are planned for fighters and referee', () => {
  for (const r of replays.slice(0, 3)) {
    const ix = _test.index(r);
    for (const who of ['kor', 'ayaz', 'ref'] as const) for (const foot of ['l', 'r'] as const) {
      const steps = ix.feet[who][foot];
      assert.ok(steps.length > 10, `${who} ${foot} steps ${steps.length}`);
      for (let k = 1; k < steps.length; k++) if (steps[k]!.t1 > steps[k]!.t0) metrics.slide.push(len(sub(steps[k]!.from, steps[k - 1]!.to)));
    }
  }
  const max = Math.max(...metrics.slide);
  console.log(JSON.stringify({ steps: metrics.slide.length, slideMaxCm: +(max * 100).toFixed(2) }));
  assert.ok(max <= .02, `slide ${max}`);
});
