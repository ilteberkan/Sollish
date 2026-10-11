// Smoke and input tests for the 2.5D broadcast scene (lib/ringside-25d/scene.ts) without a browser: a strict fake
// Canvas 2D context rejects what a real one rejects (non-finite gradient arguments, negative radii, empty source rectangles)
// and counts non-finite geometry; a fake DOM delivers pointer, wheel and touch events. The numbers it prints are
// JS-side costs only; the real frame time on a phone is the orchestrator's browser run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulateContactCombatV5 } from '@sollish/protocol';
import { mountBroadcast, type BroadcastProps } from '../lib/ringside-25d/scene';

type Listener = (e: unknown) => void;
const stats = { calls: 0, bad: 0, gradients: 0, images: 0, spriteDraws: 0 };
const finite = (...a: unknown[]) => a.every(v => typeof v !== 'number' || Number.isFinite(v));

class FakeGradient { addColorStop(offset: number, color: string) { assert.ok(offset >= 0 && offset <= 1, `stop offset ${offset}`); assert.ok(typeof color === 'string' && color.length > 0, 'stop colour'); } }
function fakeContext(canvas: FakeCanvas) {
  const store: Record<string, unknown> = {};
  const geometry = new Set(['moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'fillRect', 'strokeRect', 'fillText', 'translate', 'scale', 'rotate', 'transform', 'setTransform', 'drawImage', 'clearRect']);
  return new Proxy(store, {
    get(_t, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop === 'createLinearGradient') return (...a: number[]) => { stats.gradients++; assert.ok(finite(...a), `linear gradient ${a}`); return new FakeGradient(); };
      if (prop === 'createRadialGradient') return (...a: number[]) => { stats.gradients++; assert.ok(finite(...a), `radial gradient ${a}`); assert.ok(a[2]! >= 0 && a[5]! >= 0, `radial gradient radius ${a}`); return new FakeGradient(); };
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop === 'ellipse') return (...a: number[]) => { stats.calls++; if (!finite(...a)) stats.bad++; assert.ok(a[2]! >= 0 && a[3]! >= 0 || !finite(...a), `ellipse radii ${a}`); };
      if (prop === 'arc') return (...a: number[]) => { stats.calls++; if (!finite(...a)) stats.bad++; assert.ok(a[2]! >= 0 || !finite(...a), `arc radius ${a}`); };
      if (prop === 'drawImage') return (img: { width: number; height: number }, ...a: number[]) => {
        stats.calls++; stats.images++; assert.ok(img && img.width > 0 && img.height > 0, 'drawImage source has size');
        if ((img as { isSprite?: boolean }).isSprite) stats.spriteDraws++;
        if (!finite(...a)) stats.bad++;
        if (a.length === 8) assert.ok(a[2]! > 0 && a[3]! > 0, `drawImage source rect ${a}`);
      };
      if (geometry.has(prop)) return (...a: number[]) => { stats.calls++; if (!finite(...a)) stats.bad++; };
      if (typeof prop === 'string' && /^(beginPath|closePath|fill|stroke|save|restore|clip|setLineDash|resetTransform)$/.test(prop)) return () => { stats.calls++; };
      return store[prop];
    },
    set(_t, prop: string, value) { store[prop] = value; return true; },
  });
}
class FakeCanvas {
  width = 300; height = 150; style: Record<string, string> = {}; dataset: Record<string, string> = {}; listeners = new Map<string, Listener[]>();
  ctx: unknown = null;
  getContext() { return this.ctx ??= fakeContext(this); }
  setAttribute() {}
  addEventListener(t: string, f: Listener) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  removeEventListener(t: string, f: Listener) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter(x => x !== f)); }
  setPointerCapture() {} releasePointerCapture() {} remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; }
  fire(t: string, e: Record<string, unknown>) { const ev = { preventDefault() { (ev as { prevented?: boolean }).prevented = true; }, ...e }; for (const f of this.listeners.get(t) ?? []) f(ev); return ev as { prevented?: boolean }; }
}
class FakeHost extends FakeCanvas { children: FakeCanvas[] = []; appendChild(c: FakeCanvas) { this.children.push(c); } ringRender?: (now: number) => void; ringSeek?: (ms: number | null) => void; ringCamera?: () => { manual: boolean; az: number; el: number; zoom: number }; ringLod?: () => number; ringPreview?: (s: string | null) => void; }
// Sprites: a fake Image that reports the real part sizes from parts.json, and a fake fetch that serves it from disk.
const spriteRoot = new URL('../public/sprites/ringside/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('parts.json', spriteRoot), 'utf8')) as { characters: Record<string, { parts: Record<string, { file: string; size: [number, number] }> }> };
let spritesAvailable = true;
class FakeImage {
  width = 0; height = 0; naturalWidth = 0; naturalHeight = 0; decoding = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null; isSprite = true; private _src = '';
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => {
      const m = v.match(/ringside\/(kor|ayaz|referee)\/(\w+)\.webp$/), size = m ? manifest.characters[m[1]!]?.parts[m[2]!]?.size : /ring-canvas/.test(v) ? [768, 768] : /ring-apron/.test(v) ? [1344, 560] : null;
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
  fetch: async () => ({ json: async () => manifest }),
});

const replay = simulateContactCombatV5(createHash('sha256').update('scene:1').digest('hex'));
function mount(over: Partial<BroadcastProps> = {}) {
  const host = new FakeHost(), state: BroadcastProps = { phase: 'fighting', winner: null, fightId: 1, startedAt: null, durationMs: 45000, reducedMotion: false, camera: 'broadcast', replay, playbackPositionMs: 0, ...over };
  const manual: boolean[] = [], selected: string[] = [];
  state.onManualView = m => manual.push(m); state.onSelectFighter = f => selected.push(f);
  let errored = false; state.onError = () => { errored = true; };
  const props = { current: state };
  const stop = mountBroadcast(host as unknown as HTMLElement, () => props.current);
  const canvas = host.children[0]!;
  return { host, canvas, props, manual, selected, stop, errored: () => errored };
}

test('renders every phase and camera for a whole round without throwing or emitting non-finite geometry', () => {
  stats.bad = 0;
  for (const camera of ['broadcast', 'ringside', 'overhead'] as const) for (const reducedMotion of [false, true]) {
    const m = mount({ camera, reducedMotion });
    let now = 1000;
    for (const phase of ['idle', 'finished'] as const) { m.props.current = { ...m.props.current, phase, playbackPositionMs: undefined }; m.host.ringRender!(now += 16); }
    m.props.current = { ...m.props.current, phase: 'fighting' };
    for (let ms = 0; ms <= 45000; ms += 250) { m.props.current = { ...m.props.current, playbackPositionMs: ms }; m.host.ringRender!(now += 16); }
    assert.ok(!m.errored(), `${camera} reduced=${reducedMotion} errored`);
    m.stop();
  }
  assert.equal(stats.bad, 0, 'non-finite geometry arguments');
});

test('frame cost and draw-call budget (JS side, fake context)', () => {
  stats.calls = 0; stats.gradients = 0; stats.images = 0;
  const m = mount({ camera: 'broadcast' });
  let now = 1000; const frames = 240, t0 = performance.now();
  for (let i = 0; i < frames; i++) { m.props.current = { ...m.props.current, playbackPositionMs: 3000 + i * 50 }; m.host.ringRender!(now += 16.7); }
  const ms = (performance.now() - t0) / frames;
  console.log(JSON.stringify({ frames, jsMsPerFrame: +ms.toFixed(2), canvasCallsPerFrame: Math.round(stats.calls / frames), gradientsPerFrame: Math.round(stats.gradients / frames), imagesPerFrame: Math.round(stats.images / frames), lod: m.host.ringLod!() }));
  assert.ok(ms < 12, `JS cost ${ms} ms per frame`);
  assert.ok(stats.calls / frames < 4000, 'canvas calls per frame');
  m.stop();
});

test('viewer camera: mouse drag orbits and reports control, wheel zooms, reset key gives control back, a tap still selects', () => {
  const m = mount({ phase: 'idle', playbackPositionMs: undefined, replay: undefined, selection: { labels: { kor: '1,8x', ayaz: '2,1x' }, selected: null } });
  m.host.ringRender!(1000);
  const down = (x: number, y: number, extra = {}) => m.canvas.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra });
  const move = (x: number, y: number, extra = {}) => m.canvas.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, ...extra });
  const up = (x: number, y: number, extra = {}) => m.canvas.fire('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, ...extra });
  // A tap (no movement) on a fighter selects him; find a point on the page that hits one.
  let hit: [number, number] | null = null;
  for (let y = 40; y < 560 && !hit; y += 12) for (let x = 40; x < 860 && !hit; x += 12) { down(x, y); up(x, y); if (m.selected.length) hit = [x, y]; }
  assert.ok(hit, 'a tap on a fighter selects him'); assert.ok(m.selected.includes('kor') || m.selected.includes('ayaz'));
  assert.deepEqual(m.manual, [], 'taps do not take camera control');
  const picked = m.selected.length;
  // A 5 px wobble is still a tap; a 40 px drag is an orbit and must not select.
  down(hit![0], hit![1]); move(hit![0] + 3, hit![1] + 2); up(hit![0] + 3, hit![1] + 2);
  assert.equal(m.selected.length, picked + 1, 'a 3 px wobble is still a tap');
  down(300, 300); move(320, 300); move(340, 305); move(360, 310); up(360, 310);
  assert.equal(m.selected.length, picked + 1, 'a drag does not select');
  assert.deepEqual(m.manual, [true], 'a drag reports manual control once');
  const cam = m.host.ringCamera!(); assert.ok(cam.manual);
  // Dragging right moves the camera to the viewer's left (azimuth grows); dragging down raises it.
  const az0 = cam.az, el0 = cam.el;
  down(300, 300); move(330, 300); move(400, 330); up(400, 330);
  const cam2 = m.host.ringCamera!(); assert.ok(cam2.az > az0, 'drag right increases the azimuth'); assert.ok(cam2.el > el0, 'drag down raises the camera');
  // Limits: a huge drag up cannot put the camera under the floor.
  for (let i = 0; i < 40; i++) { down(300, 500); move(300, 440); move(300, 300); up(300, 300); }
  assert.ok(m.host.ringCamera!().el >= 2.5 * Math.PI / 180 - 1e-9, 'elevation floor');
  for (let i = 0; i < 40; i++) { down(300, 100); move(300, 160); move(300, 500); up(300, 500); }
  assert.ok(m.host.ringCamera!().el <= 68 * Math.PI / 180 + 1e-9, 'elevation ceiling');
  // Wheel zoom: prevented from scrolling the page, clamped.
  const w = m.canvas.fire('wheel', { deltaY: -400, deltaMode: 0 });
  assert.ok(w.prevented, 'wheel is captured'); for (let i = 0; i < 30; i++) m.canvas.fire('wheel', { deltaY: -400, deltaMode: 0 });
  assert.ok(m.host.ringCamera!().zoom >= .45 - 1e-9, 'zoom-in limit');
  for (let i = 0; i < 60; i++) m.canvas.fire('wheel', { deltaY: 400, deltaMode: 0 });
  assert.ok(m.host.ringCamera!().zoom <= 2.4 + 1e-9, 'zoom-out limit');
  for (let i = 0; i < 20; i++) m.host.ringRender!(1100 + i * 16);
  // Resetting: the key change hands control back and reports it.
  m.props.current = { ...m.props.current, resetViewKey: 1 }; m.host.ringRender!(2000);
  assert.deepEqual(m.manual.at(-1), false); assert.equal(m.host.ringCamera!().manual, false);
  assert.ok(!m.errored());
  m.stop();
});

test('touch rules: vertical swipes scroll the page, horizontal swipes orbit, two fingers pinch, taps select', () => {
  const m = mount({ phase: 'idle', playbackPositionMs: undefined, replay: undefined, selection: { labels: {}, selected: null } });
  m.host.ringRender!(1000);
  const ev = (type: string, id: number, x: number, y: number) => m.canvas.fire(type, { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y });
  assert.match(m.canvas.style.cssText ?? '', /touch-action:pan-y/);
  // Vertical swipe: ignored (the browser scrolls and cancels the pointer).
  ev('pointerdown', 1, 200, 300); ev('pointermove', 1, 202, 330); ev('pointermove', 1, 203, 380); ev('pointercancel', 1, 203, 380);
  assert.deepEqual(m.manual, [], 'a vertical swipe does not orbit');
  // Horizontal swipe.
  ev('pointerdown', 1, 200, 300); ev('pointermove', 1, 215, 302); ev('pointermove', 1, 260, 310); ev('pointerup', 1, 260, 310);
  assert.deepEqual(m.manual, [true], 'a horizontal swipe orbits');
  // Pinch: fingers moving apart zoom in (the camera comes closer).
  const z0 = m.host.ringCamera!().zoom;
  ev('pointerdown', 1, 200, 300); ev('pointerdown', 2, 300, 300); ev('pointermove', 2, 340, 300); ev('pointermove', 2, 400, 300); ev('pointerup', 2, 400, 300); ev('pointerup', 1, 200, 300);
  assert.ok(m.host.ringCamera!().zoom < z0, 'pinch out zooms in');
  assert.ok(!m.errored());
  m.stop();
});

test('changing the camera preset gives manual control back', () => {
  const m = mount({ phase: 'idle', playbackPositionMs: undefined, replay: undefined });
  m.host.ringRender!(1000);
  m.canvas.fire('wheel', { deltaY: 100, deltaMode: 0 });
  assert.deepEqual(m.manual, [true]);
  m.props.current = { ...m.props.current, camera: 'ringside' }; m.host.ringRender!(1100);
  assert.deepEqual(m.manual, [true, false]);
  m.stop();
});

test('with the cutout sprites loaded the whole round renders from sprites without throwing or non-finite geometry; a missing sprite sheet falls back to the procedural figures', async () => {
  stats.bad = 0; stats.spriteDraws = 0;
  for (const camera of ['broadcast', 'ringside'] as const) {
    const m = mount({ camera }); await settle();
    let now = 1000; const before = stats.spriteDraws;
    for (let ms = 0; ms <= 45000; ms += 250) { m.props.current = { ...m.props.current, playbackPositionMs: ms }; m.host.ringRender!(now += 16); }
    // Orbit to a few angles (including looking along the fight line and from above): the sprites must hold up.
    for (const [dx, dy] of [[120, 0], [200, 40], [150, 300], [-300, -20]] as const) {
      m.canvas.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 }); m.canvas.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 300 + dx, clientY: 300 + dy }); m.canvas.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 301 + dx, clientY: 300 + dy }); m.canvas.fire('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 301 + dx, clientY: 300 + dy });
      for (let i = 0; i < 60; i++) { m.props.current = { ...m.props.current, playbackPositionMs: 16800 + i * 50 }; m.host.ringRender!(now += 16); }
    }
    assert.ok(stats.spriteDraws - before > 5000, `sprites were drawn (${stats.spriteDraws - before})`);
    assert.ok(!m.errored()); m.stop();
  }
  assert.equal(stats.bad, 0, 'non-finite geometry');
  spritesAvailable = false; const draws = stats.spriteDraws;
  const m = mount(); await settle(); for (let ms = 0; ms <= 20000; ms += 500) { m.props.current = { ...m.props.current, playbackPositionMs: ms }; m.host.ringRender!(5000 + ms); }
  assert.ok(!m.errored(), 'fallback renders'); assert.equal(stats.spriteDraws, draws, 'no sprite draws when the sheet is missing'); m.stop(); spritesAvailable = true;
});
