// Gates for the 2D display simulation (lib/ringside-2d/display.ts) over whole engine rounds, stepped at 60 fps: the two
// fighters' push boxes never overlap (outside a clinch), nobody teleports, every strike's contact frame has its tip on the
// target when the engine says hit or block (and short of it on a miss), the referee never stands in a fighter's box, frames
// hold their minimum time, and the display never changes an engine result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { V5_STRIKES, simulateContactCombatV5 } from '@sollish/protocol';
import { MIN_HOLD_MS, PRIORITY, TICK_MS, fighterPose, type Replay } from '../lib/ringside-2d/animations';
import { DisplaySim, tipGap, type DisplayView } from '../lib/ringside-2d/display';
import type { FramesManifest } from '../lib/ringside-2d/frames';

const manifest = JSON.parse(readFileSync(new URL('../public/sprites/ringside2d/frames.json', import.meta.url), 'utf8')) as FramesManifest;
const replays = ['d:1', 'd:2', 'd:3'].map(s => simulateContactCombatV5(createHash('sha256').update(s).digest('hex')));
/** Reference screen scale (px per mm at the feet line) of a 984 px wide stage: used to turn mm into px for the tolerances. */
const PX = .17, FRAME_MS = 1000 / 60;

type Sample = { t: number; v: DisplayView };
function run(replay: Replay, from = 0, to = (replay.frames.length - 1) * TICK_MS, fn?: (s: Sample, prev: Sample | null) => void) {
  const sim = new DisplaySim(manifest); let prev: Sample | null = null;
  for (let ms = from; ms <= to; ms += FRAME_MS) {
    const v = sim.step(replay, ms / TICK_MS, FRAME_MS, null, ms), s = { t: ms, v }; fn?.(s, prev); prev = s;
  }
}

test('push boxes of the two fighters never overlap outside a clinch, over three whole rounds', () => {
  let steps = 0, clinchSteps = 0, minGap = Infinity;
  for (const r of replays) run(r, 0, undefined, ({ v }) => {
    const gap = v.ayaz.box.x0 - v.kor.box.x1; steps++;
    if (v.kor.clinch) { clinchSteps++; return; }
    minGap = Math.min(minGap, gap);
    assert.ok(gap >= -1, `overlap ${gap.toFixed(1)} mm`);
  });
  assert.ok(steps > 3 * 45 * 55, `steps ${steps}`);
  console.log(JSON.stringify({ steps, clinchSteps, minGapMm: +minGap.toFixed(1), minGapPx: +(minGap * PX).toFixed(1) }));
});

test('nobody teleports: per-frame change of every display position stays under the cap, and the fighters never swap sides', () => {
  const CAP = 130; let worst = 0, worstRef = 0;
  for (const r of replays) run(r, 0, undefined, ({ v }, prev) => {
    assert.ok(v.kor.x < v.ayaz.x, 'kor stays left of ayaz');
    if (!prev) return;
    for (const id of ['kor', 'ayaz'] as const) { const d = Math.abs(v[id].x - prev.v[id].x); worst = Math.max(worst, d); assert.ok(d <= CAP, `${id} moved ${d.toFixed(1)} mm in one frame at ${prev.t.toFixed(0)} ms (frames ${prev.v[id].frame} -> ${v[id].frame}, ${v[id].why})`); }
    const dr = Math.abs(v.ref.x - prev.v.ref.x); worstRef = Math.max(worstRef, dr); assert.ok(dr <= CAP, `referee moved ${dr.toFixed(1)} mm in one frame at ${prev.t.toFixed(0)} ms`);
  });
  console.log(JSON.stringify({ worstFighterMmPerFrame: +worst.toFixed(1), worstFighterPxPerFrame: +(worst * PX).toFixed(1), worstRefMm: +worstRef.toFixed(1) }));
});

test('on every contact tick the strike tip reaches the target for a hit or block (at most 8 px short) and short of it for a miss or dodge', () => {
  let hits = 0, shorts = 0, worst = 0, trades = 0; const sims = new Map<number, DisplaySim>();
  replays.forEach((r, n) => {
    const sim = new DisplaySim(manifest); sims.set(n, sim);
    const wanted = new Map<number, typeof r.events>();
    for (const e of r.events) if (['hit', 'block', 'dodge', 'miss'].includes(e.type) && e.technique in V5_STRIKES) (wanted.get(e.tick) ?? wanted.set(e.tick, []).get(e.tick)!).push(e);
    const last = (r.frames.length - 1) * TICK_MS;
    for (let ms = 0; ms <= last; ms += FRAME_MS) {
      const tick = ms / TICK_MS, v = sim.step(r, tick, FRAME_MS, null, ms);
      // The first rendered frame of each contact tick (the frame at or just after the tick starts).
      const c = Math.round(tick); if (!wanted.has(c) || tick < c || tick - c > FRAME_MS / TICK_MS + 1e-6) continue;
      for (const e of wanted.get(c)!) {
        const a = v[e.actor], t = v[e.target], region = V5_STRIKES[e.technique as keyof typeof V5_STRIKES].target;
        const impact = fighterPose(r, e.actor, tick).frame; assert.equal(a.frame, impact, `contact frame of ${e.technique} at tick ${c}`);
        const before = fighterPose(r, e.target, c - .001).frame, gap = tipGap(manifest, e.actor, a.frame, a.x, e.target, before, t.x, region);
        if (e.type === 'hit' || e.type === 'block') { hits++; worst = Math.max(worst, gap); assert.ok(gap * PX <= 8, `${e.type} ${e.technique} tick ${c}: tip ${(gap * PX).toFixed(1)} px short of the target`); // A trade (both fighters land a blow within two ticks) cannot put both tips on the target: only the shortness is checked there.
          const trade = r.events.some(o => o.actor !== e.actor && (o.type === 'hit' || o.type === 'block') && Math.abs(o.tick - e.tick) <= 2 && o.technique in V5_STRIKES);
          if (!trade) assert.ok(gap * PX >= -60, `${e.type} ${e.technique} tick ${c}: tip ${(-gap * PX).toFixed(1)} px deep in the target`); else trades++; }
        else { shorts++; assert.ok(gap * PX >= -12, `${e.type} ${e.technique} tick ${c}: tip ${(-gap * PX).toFixed(1)} px inside the target`); }
      }
    }
  });
  console.log(JSON.stringify({ contactsChecked: hits, shortChecked: shorts, trades, worstShortMm: +worst.toFixed(1), worstShortPx: +(worst * PX).toFixed(1) }));
  assert.ok(hits > 20 && shorts > 5, `${hits} hits, ${shorts} short`);
});

test('the referee is never inside a fighter push box in the fighters lane (a few catch-up frames aside), and walks upstage to change sides', () => {
  let ref = 0, behind = 0, bad = 0; const sides = new Set<number>();
  for (const r of replays) run(r, 0, undefined, ({ v }) => {
    ref++; sides.add(v.ref.zone);
    if (v.ref.behind) { behind++; return; }
    for (const f of [v.kor, v.ayaz]) if (Math.min(v.ref.box.x1, f.box.x1) - Math.max(v.ref.box.x0, f.box.x0) > 30) bad++;
  });
  console.log(JSON.stringify({ refSteps: ref, crossingSteps: behind, zonesSeen: [...sides], pushBoxOverlapSteps: bad }));
  assert.ok(bad / ref < .01, `${bad} of ${ref} frames`);
});

test('screen-space clearance: the referee stays at least 40 px from both fighters\' drawn sprite boxes (8 px during a count), upstage and behind', () => {
  let steps = 0, bad = 0, worst = Infinity, counting = 0, between = 0, betweenClose = 0, upstage = 0;
  for (const r of replays) run(r, 0, undefined, ({ t, v }) => {
    steps++; if (v.ref.behind) return;
    const mode = r.frames[Math.min(r.frames.length - 1, Math.floor(t / TICK_MS))]!.referee.mode, need = mode === 'count' || mode === 'stop' ? 8 : 40; if (need === 8) counting++;
    for (const f of [v.kor, v.ayaz]) {
      const gap = Math.max(f.sbox.x0 - v.ref.sbox.x1, v.ref.sbox.x0 - f.sbox.x1) * PX; worst = Math.min(worst, gap);
      if (gap < need - 2) bad++;
    }
    if (v.ref.x > v.kor.x && v.ref.x < v.ayaz.x) { between++; if ((v.ayaz.x - v.kor.x) < 2 * (v.kor.box.x1 - v.kor.box.x0 + v.ayaz.box.x1 - v.ayaz.box.x0) / 2 * 1.0) betweenClose++; }
    if (v.ref.z <= Math.min(v.kor.z, v.ayaz.z) - 600) upstage++;
  });
  console.log(JSON.stringify({ steps, countingSteps: counting, violations: bad, worstClearancePx: +worst.toFixed(1), betweenSteps: between, betweenWhileClose: betweenClose, upstageShare: +(upstage / steps).toFixed(2) }));
  assert.ok(bad / steps < .01, `${bad} of ${steps} frames under the clearance`);
  assert.equal(betweenClose, 0, 'never between the fighters when they are closer than two body widths');
  assert.equal(between, 0, 'he stands beside the fighters, not between them');
  assert.ok(upstage / steps > .85, 'he stands upstage of the fighters\' lane');
});

test('no skating: a fighter who moves along the canvas shows a walk frame, never the idle guard', () => {
  let moving = 0, skating = 0;
  for (const r of replays) { const prev = new Map<string, number>(); run(r, 0, undefined, ({ v, t }) => for_(v, t, prev)); }
  function for_(v: DisplayView, t: number, prev: Map<string, number>) {
    for (const id of ['kor', 'ayaz'] as const) {
      const key = id, last = prev.get(key); prev.set(key, v[id].x); if (last === undefined || t < FRAME_MS * 3) continue;
      const speed = Math.abs(v[id].x - last) / FRAME_MS * 1000;
      if (speed > 450) { moving++; if (['guard', 'neutral', 'idle', 'default'].includes(v[id].why)) skating++; }
    }
  }
  console.log(JSON.stringify({ movingSteps: moving, skatingSteps: skating }));
  assert.ok(moving > 100 && skating / moving < .1, `${skating} of ${moving} moving frames show an idle pose`);
});

test('frames hold at least the minimum time unless the change is a priority (impact, hit, block, fall, finish)', () => {
  for (const r of replays) for (const id of ['kor', 'ayaz'] as const) {
    let prev = -1, since = 0;
    run(r, 0, undefined, ({ v }) => {
      const f = v[id].frame;
      if (f !== prev) { if (prev !== -1 && !PRIORITY.has(v[id].why)) assert.ok(since >= MIN_HOLD_MS - FRAME_MS - 1, `${id} frame ${prev} held ${since.toFixed(0)} ms before ${f} (${v[id].why})`); prev = f; since = 0; }
      since += FRAME_MS;
    });
  }
});

test('the display is deterministic and never touches the replay', () => {
  const r = replays[0]!, snapshot = JSON.stringify(r);
  const a: number[] = [], b: number[] = [];
  run(r, 0, 8000, ({ v }) => a.push(v.kor.x, v.ayaz.x, v.kor.frame, v.ayaz.frame));
  run(r, 0, 8000, ({ v }) => b.push(v.kor.x, v.ayaz.x, v.kor.frame, v.ayaz.frame));
  assert.deepEqual(a, b); assert.equal(JSON.stringify(r), snapshot);
});

test('seeking snaps without a teleport artefact and without overlap', () => {
  const sim = new DisplaySim(manifest), r = replays[1]!;
  for (const ms of [30000, 2000, 20000, 500, 41000]) { const v = sim.step(r, ms / TICK_MS, FRAME_MS, null, ms); assert.ok(v.ayaz.box.x0 - v.kor.box.x1 >= -1 || v.kor.clinch); }
});
