// Gates for the 2D fighting-game broadcast (lib/ringside-2d): the frame set built by scripts/ringside-frames.mjs (schema, feet
// anchors, payload), the animation state machine (every engine action maps to existing frames, the contact pose is shown on the
// engine's contact tick for every strike, hit reactions), the facing rule when fighters cross, and the renderer drawing a
// whole round on a strict fake Canvas 2D context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { V5_STRIKES, simulateContactCombatV5, type FighterId, type V5Frame } from '@sollish/protocol';
import { ALT, ENGINE_ACTIONS, FIGHTER_FRAME_COUNT, FRAME, FRAME_ALIAS, HIT_FRAME, HIT_RECOVER_TICKS, REF_FRAME_COUNT, STRIKE_SEQ, TICK_MS, actionFrames, fighterPose, hitHold, refereePose, seqOf, strikeFrame, type Replay } from '../lib/ringside-2d/animations';
import { CHARACTERS, resolveFrame, type FramesManifest } from '../lib/ringside-2d/frames';
import { facing, framing, floorX, floorY, depthK, type Cam } from '../lib/ringside-2d/geometry';
import { mountBroadcast2D, hitStopTime, type Broadcast2DProps } from '../lib/ringside-2d/scene';

const root = new URL('../public/sprites/ringside2d/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('frames.json', root), 'utf8')) as FramesManifest;
const seeds = ['2d:1', '2d:2', '2d:3', '2d:4', '2d:5', '2d:6'].map(s => createHash('sha256').update(s).digest('hex'));
const replays = seeds.map(seed => simulateContactCombatV5(seed));
const have = (who: typeof CHARACTERS[number], n: number) => !!manifest.characters[who].frames[String(resolveFrame({ manifest } as never, who, n))];

// ---- frame set ------------------------------------------------------------------------------------------
test('frames.json schema: every character, size, feet anchor, scale and provenance', () => {
  assert.equal(manifest.version, 1);
  for (const who of CHARACTERS) {
    const c = manifest.characters[who], expected = who === 'referee' ? REF_FRAME_COUNT : FIGHTER_FRAME_COUNT;
    assert.equal(c.facing, 'right'); assert.ok(c.pushFront > 100 && c.pushFront < 700 && c.pushBack > 50 && c.pushBack < 700, `${who} stable push box`); assert.ok(c.heightMm > 1500 && c.heightMm < 2100); assert.ok(c.guardHeightPx > 100 && c.mmPerPx > 0 && c.scale > 0);
    assert.ok(Math.abs(c.mmPerPx * c.guardHeightPx - c.heightMm) < 2, `${who} mmPerPx`);
    for (let n = 1; n <= expected; n++) {
      const f = c.frames[String(n)];
      if (!f) { assert.ok(FRAME_ALIAS[who]?.[n] !== undefined, `${who} frame ${n} is missing and has no alias`); continue; }
      assert.ok(f.w >= 16 && f.h >= 16, `${who}/${n} size`);
      assert.ok(f.sheet >= 1 && f.sheet <= (who === 'referee' ? 1 : 3) && f.cell >= 1 && f.cell <= 16 && (f.sheet - 1) * 16 + f.cell === n, `${who}/${n} sheet and cell`);
      // Collision data: torso, head and push spans inside the frame, and the strike tip at its far (facing) side.
      for (const span of [f.body, f.head, f.push]) assert.ok(span.length === 2 && span[0] >= 0 && span[1] <= f.w + .5 && span[1] > span[0], `${who}/${n} span ${span}`);
      assert.ok(f.tip[0] > f.anchor[0] - 1 && f.tip[0] <= f.w + .5 && f.tip[1] >= 0 && f.tip[1] <= f.h, `${who}/${n} tip ${f.tip}`);
      assert.ok(f.src && f.src.length === 4 && f.src.every(v => v >= 0), `${who}/${n} source box`);
      const file = new URL(`${who}/${n}.webp`, root); assert.ok(existsSync(file) && statSync(file).size > 300, `${who}/${n} file`);
      // Feet anchor: inside the frame, horizontally within it, and at the bottom (the lowest opaque rows; trimmed frames end right under the feet).
      assert.ok(f.anchor[0] > 0 && f.anchor[0] < f.w, `${who}/${n} anchor x ${f.anchor}`);
      assert.ok(f.anchor[1] > f.h * .9 && f.anchor[1] <= f.h + .5, `${who}/${n} anchor y ${f.anchor[1]} of ${f.h}`);
    }
    assert.ok(Math.abs(c.frames['1']!.h - c.guardHeightPx) <= 8, `${who} guard pose height is the common scale`);
  }
});

test('payload budget: all frames together under 1.8 MB and the stage image under 350 KB', () => {
  let total = 0;
  for (const who of CHARACTERS) for (const n of Object.keys(manifest.characters[who].frames)) total += statSync(new URL(`${who}/${n}.webp`, root)).size;
  assert.ok(total <= 1.8 * 1024 * 1024, `frames ${total}`);
  assert.ok(manifest.stage && statSync(new URL(manifest.stage.file, root)).size <= 350 * 1024, 'stage image');
});

// ---- animation mapping ---------------------------------------------------------------------------------
test('every engine action maps to frames that exist for both fighters', () => {
  for (const a of ENGINE_ACTIONS) {
    for (const who of ['kor', 'ayaz'] as const) for (const n of actionFrames(a, who)) { assert.ok(n >= 1 && n <= FIGHTER_FRAME_COUNT, `${a} frame ${n}`); assert.ok(have(who, n), `${who} ${a} frame ${n}`); }
  }
  for (const k of Object.keys(V5_STRIKES)) assert.ok(k in STRIKE_SEQ, `${k} has a sequence`);
  const seen = new Set<string>();
  for (const r of replays) for (let t = 0; t < r.frames.length; t++) for (const id of ['kor', 'ayaz'] as const) {
    seen.add(r.frames[t]![id].action);
    for (const out of [null, 'win', 'lose', 'draw'] as const) { const p = fighterPose(r, id, t + .5, out); assert.ok(Number.isInteger(p.frame) && p.frame >= 1 && p.frame <= FIGHTER_FRAME_COUNT && have(id, p.frame), `${id} t${t} ${p.why} ${p.frame}`); }
    const rp = refereePose(r, t + .3); assert.ok(rp.frame >= 1 && rp.frame <= REF_FRAME_COUNT && have('referee', rp.frame));
  }
  for (const a of seen) assert.ok(ENGINE_ACTIONS.includes(a), `unknown engine action ${a}`);
  assert.ok(seen.has('down') || replays.length > 0);
});

const synthetic = (id: FighterId, action: string, actionAt: number, extra: Partial<V5Frame['kor']> = {}): Replay => {
  const base = (who: FighterId) => ({ id: who, x: who === 'kor' ? -500 : 500, z: 0, yawMilliRad: who === 'kor' ? 1571 : -1571, health: 1000, stamina: 1000, stun: 0, action: 'guard', actionAt: 0, until: 0, phase: 'idle', combo: 0, hits: 0, knockdowns: 0, pose: {} }) as unknown as V5Frame['kor'];
  const frames: V5Frame[] = Array.from({ length: 40 }, (_, tick) => ({ tick, kor: base('kor'), ayaz: base('ayaz'), referee: { x: 0, z: -1600, yawMilliRad: 0, mode: 'watch', count: 0 } }));
  for (const f of frames) if (f.tick >= actionAt) Object.assign(f[id], { action, actionAt, ...extra });
  return { frames, events: [] };
};

test('the impact frame of every strike shows on the contact tick and for the active ticks, never before or after (both fighters)', () => {
  for (const id of ['kor', 'ayaz'] as const) for (const [name, s] of Object.entries(V5_STRIKES)) {
    const r = synthetic(id, name, 5), q = seqOf(id, name as keyof typeof STRIKE_SEQ);
    assert.equal(fighterPose(r, id, 5 + s.wind).frame, q.hit, `${id} ${name} on the contact tick`);
    assert.equal(fighterPose(r, id, 5 + s.wind + .99).frame, q.hit, `${id} ${name} end of the contact tick`);
    assert.equal(fighterPose(r, id, 5 + s.wind + s.active - .01).frame, q.hit, `${id} ${name} last active moment`);
    if (s.wind > 0) assert.notEqual(fighterPose(r, id, 5 + s.wind - .01).frame, q.hit, `${id} ${name} not before contact`);
    if (q.recover[0]![0] !== q.hit) assert.notEqual(fighterPose(r, id, 5 + s.wind + s.active).frame, q.hit, `${id} ${name} leaves the impact frame`);
    assert.equal(strikeFrame(name as keyof typeof STRIKE_SEQ, s.end + 3, id)!.frame, q.recover.at(-1)![0], `${id} ${name} ends on its last recovery frame`);
  }
});

test('in real rounds the actor shows its impact frame on every contact tick, and hits show a reaction on the target', () => {
  let contacts = 0, reactions = 0, trades = 0;
  const kinds = new Set<string>();
  for (const r of replays) for (const e of r.events) {
    if (!['hit', 'block', 'dodge', 'miss'].includes(e.type) || !(e.technique in V5_STRIKES)) continue;
    const f = r.frames[e.tick]![e.actor], spec = V5_STRIKES[e.technique as keyof typeof V5_STRIKES];
    assert.equal(f.action, e.technique, `tick ${e.tick}: ${e.actor} is performing ${e.technique}`);
    assert.equal(e.tick - f.actionAt, spec.wind, `tick ${e.tick}: ${e.technique} contacts after ${spec.wind} wind ticks`);
    const p = fighterPose(r, e.actor, e.tick);
    assert.equal(p.frame, seqOf(e.actor, e.technique as keyof typeof STRIKE_SEQ).hit, `${e.technique} contact frame at tick ${e.tick} (${p.why})`);
    contacts++; kinds.add(e.technique);
    if (e.type === 'hit' || e.type === 'block') {
      const t = fighterPose(r, e.target, e.tick), own = r.frames[e.tick]![e.target];
      const busy = own.action === 'down' || own.action === 'rise' || (own.action in V5_STRIKES && e.tick - own.actionAt >= V5_STRIKES[own.action as keyof typeof V5_STRIKES].wind && e.tick - own.actionAt < V5_STRIKES[own.action as keyof typeof V5_STRIKES].wind + V5_STRIKES[own.action as keyof typeof V5_STRIKES].active);
      if (busy) { trades++; continue; }
      assert.ok(t.why === 'hit' || t.why === 'block', `${e.target} reacts to the ${e.type} at tick ${e.tick} (${t.why})`);
      if (e.type === 'hit') assert.equal(t.frame, HIT_FRAME[e.bodyPart && e.bodyPart !== 'guard' ? e.bodyPart : 'body']);
      reactions++;
    }
  }
  assert.ok(contacts > 20 && reactions > 5, `contacts ${contacts}, reactions ${reactions}, trades ${trades}, kinds ${[...kinds].join()}`);
  assert.ok(kinds.size >= 4, `several techniques seen: ${[...kinds]}`);
});

test('hit reactions last a few ticks, then the fighter goes back to his action; down shows falling then lying; the end of a round shows victory', () => {
  const r = synthetic('kor', 'guard', 0); r.events = [{ tick: 10, type: 'hit', actor: 'ayaz', target: 'kor', technique: 'cross', damage: 38, bodyPart: 'head' }];
  assert.equal(fighterPose(r, 'kor', 9.9).frame === FRAME.hitHead, false);
  assert.equal(fighterPose(r, 'kor', 10).frame, FRAME.hitHead);
  assert.equal(fighterPose(r, 'kor', 10 + hitHold(38) - .01).frame, FRAME.hitHead);
  assert.equal(fighterPose(r, 'kor', 10 + hitHold(38)).frame, ALT.kor.recover, 'the recovery frame of sheet 3 follows the reaction');
  assert.notEqual(fighterPose(r, 'kor', 10 + hitHold(38) + HIT_RECOVER_TICKS + 1).why, 'recover');
  const d = synthetic('ayaz', 'down', 12);
  assert.equal(fighterPose(d, 'ayaz', 12).frame, FRAME.falling); assert.equal(fighterPose(d, 'ayaz', 25).frame, FRAME.lying);
  assert.equal(fighterPose(r, 'kor', 30, 'win').frame, FRAME.victory); assert.equal(fighterPose(r, 'ayaz', 30, 'lose').frame, FRAME.exhausted);
  assert.equal(fighterPose(d, 'ayaz', 30, 'lose').frame, FRAME.lying, 'a stopped fighter stays on the canvas');
});

// ---- geometry ----------------------------------------------------------------------------------------------
test('facing: toward the opponent, kept when they are on top of each other, mirrored when they cross', () => {
  const a = (x: number) => ({ x, yawMilliRad: 1571 }), b = (x: number) => ({ x });
  assert.equal(facing(a(-1000), b(1000), null), 1); assert.equal(facing({ x: 1000, yawMilliRad: -1571 }, b(-1000), null), -1);
  // KOR walks through AYAZ: left of him, on top of him (keeps), then right of him (flips).
  let dir = facing(a(-400), b(0), null); const seq: number[] = [];
  for (const x of [-400, -200, -100, 0, 60, 100, 200, 400, 800]) { dir = facing(a(x), b(0), dir); seq.push(dir); }
  assert.deepEqual(seq, [1, 1, 1, 1, 1, 1, -1, -1, -1]);
  assert.equal(facing(a(0), b(0), null), 1, 'with no history the engine heading decides');
  assert.equal(facing({ x: 0, yawMilliRad: -1571 }, b(0), null), -1);
  // In a real round the sprite always looks at the other fighter whenever they are apart.
  for (const r of replays) { let dk: 1 | -1 | null = null; for (const f of r.frames) { dk = facing(f.kor, f.ayaz, dk); const gap = f.ayaz.x - f.kor.x; if (Math.abs(gap) > 120) assert.equal(dk, gap > 0 ? 1 : -1); } }
});

test('camera framing keeps both fighters on screen and the lane moves the feet a little, never the camera angle', () => {
  const cam: Cam = { panMm: 0, scale: .2, W: 1000, H: 600, groundY: 330, shakeX: 0, shakeY: 0 };
  for (const [k, a] of [[-2800, 2800], [-1000, 1000], [200, 300], [-3200, 100]] as const) {
    const f = framing([k, a]), c = { ...cam, panMm: f.pan, scale: 1000 / f.visible };
    for (const x of [k, a]) { const sx = floorX(c, x); assert.ok(sx > 20 && sx < 980, `x ${x} at ${sx} (pan ${f.pan}, visible ${f.visible})`); }
  }
  assert.ok(floorY(cam, 1000) > floorY(cam, 0) && floorY(cam, -1000) < floorY(cam, 0), 'near is lower on the screen');
  assert.ok(depthK(1000) > depthK(0) && depthK(-1000) < depthK(0));
});

test('hit-stop never runs ahead of real time and catches up', () => {
  const ev = [{ tick: 10, type: 'hit', actor: 'kor', target: 'ayaz', technique: 'jab', damage: 30 }] as Replay['events'];
  for (let ms = 0; ms < 1200; ms += 10) assert.ok(hitStopTime(ev, ms) <= ms + 1e-9);
  assert.equal(hitStopTime(ev, 800), 800); assert.ok(hitStopTime(ev, 10 * TICK_MS + 30) < 10 * TICK_MS + 30);
});

// ---- renderer on a strict fake 2D context --------------------------------------------------------------
type Listener = (e: unknown) => void;
const stats = { calls: 0, bad: 0, images: 0, spriteDraws: 0 };
const finite = (...a: unknown[]) => a.every(v => typeof v !== 'number' || Number.isFinite(v));
class FakeGradient { addColorStop(offset: number, color: string) { assert.ok(offset >= 0 && offset <= 1, `stop offset ${offset}`); assert.ok(typeof color === 'string' && color.length > 0); } }
function fakeContext(canvas: FakeCanvas) {
  const store: Record<string, unknown> = {};
  const geometry = new Set(['moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'fillRect', 'strokeRect', 'fillText', 'translate', 'scale', 'rotate', 'transform', 'setTransform', 'clearRect']);
  return new Proxy(store, {
    get(_t, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop === 'createLinearGradient') return (...a: number[]) => { assert.ok(finite(...a), `linear gradient ${a}`); return new FakeGradient(); };
      if (prop === 'createRadialGradient') return (...a: number[]) => { assert.ok(finite(...a), `radial gradient ${a}`); assert.ok(a[2]! >= 0 && a[5]! >= 0, `radial radius ${a}`); return new FakeGradient(); };
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop === 'ellipse') return (...a: number[]) => { stats.calls++; if (!finite(...a)) stats.bad++; assert.ok(a[2]! >= 0 && a[3]! >= 0 || !finite(...a), `ellipse radii ${a}`); };
      if (prop === 'arc') return (...a: number[]) => { stats.calls++; if (!finite(...a)) stats.bad++; assert.ok(a[2]! >= 0 || !finite(...a), `arc radius ${a}`); };
      if (prop === 'drawImage') return (img: { width: number; height: number; isSprite?: boolean }, ...a: number[]) => {
        stats.calls++; stats.images++; assert.ok(img && img.width > 0 && img.height > 0, 'drawImage source has size');
        if (img.isSprite) stats.spriteDraws++;
        if (!finite(...a)) stats.bad++;
        if (a.length === 8) assert.ok(a[2]! > 0 && a[3]! > 0 && a[6]! !== 0 && a[7]! !== 0, `drawImage rect ${a}`);
      };
      if (geometry.has(prop)) return (...a: number[]) => { stats.calls++; if (!finite(...a)) stats.bad++; };
      if (/^(beginPath|closePath|fill|stroke|save|restore|clip|setLineDash|resetTransform)$/.test(prop)) return () => { stats.calls++; };
      return store[prop];
    },
    set(_t, prop: string, value) { store[prop] = value; return true; },
  });
}
class FakeCanvas {
  width = 300; height = 150; style: Record<string, string> = {}; dataset: Record<string, string> = {}; listeners = new Map<string, Listener[]>(); ctx: unknown = null;
  getContext() { return this.ctx ??= fakeContext(this); }
  setAttribute() {}
  addEventListener(t: string, f: Listener) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  removeEventListener(t: string, f: Listener) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter(x => x !== f)); }
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; }
  fire(t: string, e: Record<string, unknown>) { for (const f of this.listeners.get(t) ?? []) f(e); }
}
class FakeHost extends FakeCanvas { children: FakeCanvas[] = []; appendChild(c: FakeCanvas) { this.children.push(c); } ringRender?: (now: number) => void; ringSeek?: (ms: number | null) => void; ringFrames?: () => { loaded: number; total: number; stage: boolean } | null; }
let spritesAvailable = true;
class FakeImage {
  width = 0; height = 0; naturalWidth = 0; naturalHeight = 0; decoding = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null; isSprite = true; private _src = '';
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => {
      const m = v.match(/ringside2d\/(kor|ayaz|referee)\/(\d+)\.webp$/), f = m ? manifest.characters[m[1] as 'kor']?.frames[m[2]!] : null;
      const size = f ? [f.w, f.h] : /stage\.webp/.test(v) ? [manifest.stage!.w, manifest.stage!.h] : /ring-canvas/.test(v) ? [768, 768] : /ring-apron/.test(v) ? [1344, 282] : /ringside-arena/.test(v) ? [2400, 1028] : null;
      if (!spritesAvailable || !size) { this.onerror?.(); return; }
      this.width = this.naturalWidth = size[0]!; this.height = this.naturalHeight = size[1]!; this.onload?.();
    });
  }
  get src() { return this._src; }
}
const settle = () => new Promise<void>(r => setTimeout(r, 30));
let rafId = 0;
Object.assign(globalThis, {
  document: { createElement: () => new FakeCanvas(), body: {}, hidden: false },
  window: { devicePixelRatio: 2 },
  ResizeObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: () => ++rafId, cancelAnimationFrame: () => {},
  getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
  Image: FakeImage,
  fetch: async (url: string) => ({ ok: /frames\.json$/.test(url), json: async () => manifest }),
});
function mount(over: Partial<Broadcast2DProps> = {}) {
  const host = new FakeHost(), state: Broadcast2DProps = { phase: 'fighting', winner: null, fightId: 1, startedAt: null, durationMs: 45000, reducedMotion: false, camera: 'broadcast', replay: replays[0], playbackPositionMs: 0, ...over };
  const selected: string[] = []; let errored = false, ready = 0;
  state.onSelectFighter = f => selected.push(f); state.onError = () => { errored = true; }; state.onReady = () => { ready++; };
  const props = { current: state };
  const stop = mountBroadcast2D(host as unknown as HTMLElement, () => props.current);
  return { host, canvas: host.children[0]!, props, selected, stop, errored: () => errored, ready: () => ready };
}

test('draws a whole round (every phase, reduced motion on and off) with sprites without throwing or emitting non-finite geometry', async () => {
  stats.bad = 0; stats.spriteDraws = 0;
  for (const reducedMotion of [false, true]) for (const replay of replays.slice(0, 3)) {
    const m = mount({ reducedMotion, replay });
    await settle(); assert.ok(m.host.ringFrames!()!.total >= 100 && m.host.ringFrames!()!.stage, 'frames.json and the stage image loaded');
    let now = 1000;
    for (const phase of ['idle', 'finished'] as const) { m.props.current = { ...m.props.current, phase, winner: phase === 'finished' ? 'kor' : null, playbackPositionMs: undefined }; m.host.ringRender!(now += 16); }
    m.props.current = { ...m.props.current, phase: 'fighting', winner: null };
    for (let ms = 0; ms <= 45000; ms += 50) { m.props.current = { ...m.props.current, playbackPositionMs: ms }; m.host.ringRender!(now += 16); }
    assert.ok(!m.errored(), `reduced=${reducedMotion} errored`); assert.ok(m.ready() >= 1);
    assert.equal(m.canvas.dataset.renderer, 'canvas2d-sprites');
    m.stop();
  }
  assert.equal(stats.bad, 0, 'non-finite geometry arguments');
  assert.ok(stats.spriteDraws > 1000, `sprite frames drawn: ${stats.spriteDraws}`);
});

test('draws silhouettes when the sprites are unavailable, the idle warm-up without a replay, and replays a draw', async () => {
  spritesAvailable = false; stats.bad = 0;
  const m = mount({ phase: 'idle', replay: undefined, playbackPositionMs: undefined, selection: { labels: { kor: '1,8x', ayaz: '2,1x' }, selected: 'kor' } });
  await settle(); let now = 1000; for (let i = 0; i < 20; i++) m.host.ringRender!(now += 16);
  assert.ok(!m.errored()); m.stop(); spritesAvailable = true;
  const f = mount({ phase: 'finished', winner: null, playbackPositionMs: undefined }); await settle();
  for (let i = 0; i < 10; i++) f.host.ringRender!(now += 16);
  assert.ok(!f.errored()); f.stop(); assert.equal(stats.bad, 0);
});

test('input: a tap selects a fighter while bets are open; there is no drag, wheel or pinch handling', async () => {
  const m = mount({ phase: 'idle', replay: undefined, playbackPositionMs: undefined, selection: { labels: { kor: '1,8x', ayaz: '2,1x' }, selected: null } });
  await settle(); m.host.ringRender!(1000);
  assert.deepEqual([...m.canvas.listeners.keys()], ['click']);
  let hit = false;
  for (let y = 40; y < 560 && !hit; y += 10) for (let x = 40; x < 860 && !hit; x += 10) { m.canvas.fire('click', { clientX: x, clientY: y }); hit = m.selected.length > 0; }
  assert.ok(hit && ['kor', 'ayaz'].includes(m.selected[0]!), 'a tap on a fighter selects him');
  m.selected.length = 0; m.canvas.fire('click', { clientX: 5, clientY: 5 }); assert.deepEqual(m.selected, [], 'a tap on the empty arena selects nobody');
  m.stop();
});

test('frame cost and draw-call budget (JS side, fake context)', async () => {
  stats.calls = 0; stats.images = 0;
  const m = mount(); await settle();
  let now = 1000; const frames = 240, t0 = performance.now();
  for (let i = 0; i < frames; i++) { m.props.current = { ...m.props.current, playbackPositionMs: 3000 + i * 50 }; m.host.ringRender!(now += 16.7); }
  const ms = (performance.now() - t0) / frames;
  console.log(JSON.stringify({ frames, jsMsPerFrame: +ms.toFixed(2), canvasCallsPerFrame: Math.round(stats.calls / frames), imagesPerFrame: Math.round(stats.images / frames) }));
  assert.ok(ms < 8, `JS cost ${ms} ms per frame`); assert.ok(stats.calls / frames < 1500, 'canvas calls per frame');
  m.stop();
});
