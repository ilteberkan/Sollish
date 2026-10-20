/**
 * Ringside 2.5D broadcast scene: Canvas 2D drawing of the code-authored skeletons in ./motion.ts from a broadcast
 * camera (./camera.ts) in an arena built from cached layers (./arena.ts). Presentation only: it reads a committed
 * replay and the round phase. Camera, frame rate, reduced motion, sound and hidden tabs never touch a result or payout.
 *
 * Viewer camera (documented here because the rules matter for phones):
 * - Mouse or pen: press and drag (after 6 px) orbits around the fight; the wheel zooms; double-click gives control back.
 * - Touch: the canvas has `touch-action: pan-y`, so vertical swipes scroll the page. A one-finger drag orbits only
 *   once it has moved 10 px and is mostly horizontal (then vertical movement also tilts the camera); two fingers
 *   pinch to zoom and drag to orbit. A tap (under 6 px of movement) still selects a fighter.
 */
import { contactGuardPose, isV5Kick, simulateContactCombatV5, type FighterId, type V5Fighter, type SparringEvent } from '@sollish/protocol';
import { ringFrame, fightAxis, hitStopTime, clamp, TICK_MS, type Body, type RingFrame, type RingReplay, type V3 } from './motion';
import { CameraRig, PRESETS, type CamPreset } from './camera';
import { crowdTier, fallbackPlate, glow, hash, ledStrip, loadPlate, LED_TILE_M, type Canvas } from './arena';
import { loadSprites, drawPart, drawCap, boneLength, partMatrix, apply, type SpriteSet, type CharacterId, type Matrix } from './sprites';
import { loadRingsideAudio, type RingsideAudio } from '../ringside-audio';
import { DEFAULT_BROADCAST_LABELS, type BroadcastLabels } from '../ringside-labels';

export type { BroadcastLabels };

export type BroadcastProps = {
  phase: 'idle' | 'fighting' | 'finished';
  winner: 'kor' | 'ayaz' | null;
  fightId: number;
  startedAt: number | null;
  durationMs: number;
  reducedMotion: boolean;
  camera: 'broadcast' | 'ringside' | 'overhead';
  replay?: RingReplay;
  /** Explicit visual seek for offline previews; never a simulation input. */
  playbackPositionMs?: number;
  sound?: boolean;
  onSelectFighter?: (fighter: 'kor' | 'ayaz') => void;
  /** While bets are open: a pulsing floor ring and a price chip on each fighter; the chosen one is filled. */
  selection?: { labels: Partial<Record<'kor' | 'ayaz', string>>; selected: 'kor' | 'ayaz' | null };
  /** Changing this value eases the camera back to the automatic framing. */
  resetViewKey?: number;
  /** Called with true when the viewer takes control of the camera and false when control is given back. */
  onManualView?: (manual: boolean) => void;
  /** Translated canvas text (presentation only). Omitted: the English defaults. */
  labels?: BroadcastLabels;
  onReady?: () => void;
  onError?: () => void;
};

const POST = 3.65, APRON = 4.25, DROP = 1.2, ROPES = [.42, .74, 1.06, 1.36], POST_TOP = 1.48, BOARD = 5.05, NEAR = .25;
const CORNERS = [
  { x: -POST, z: POST, color: '#ff5a1f', team: 'kor' as const },
  { x: POST, z: -POST, color: '#4cc9f0', team: 'ayaz' as const },
  { x: -POST, z: -POST, color: '#cfc9bd', team: null },
  { x: POST, z: POST, color: '#cfc9bd', team: null },
];
const ROPE_COLORS = ['#e9e4da', '#ff6a3d', '#e9e4da', '#4cc9f0'];
const TEAM = { kor: { color: '#ff5a1f', rgb: '255,120,70', name: 'KOR' }, ayaz: { color: '#4cc9f0', rgb: '110,210,245', name: 'AYAZ' } } as const;
type Look = { skin: string; skinDark: string; glove: string; gloveDark: string; cuff: string; trunks: string; trunksDark: string; belt: string; boot: string; bootDark: string; sock: string; hair: string; rim: string; shirt?: string; shirtDark?: string; trousers?: string };
const LOOKS: Record<FighterId | 'ref', Look> = {
  kor: { skin: '#a56a47', skinDark: '#5b3622', glove: '#ff5a1f', gloveDark: '#a3360d', cuff: '#f1ece2', trunks: '#1b1d23', trunksDark: '#08090b', belt: '#ff5a1f', boot: '#1a1c21', bootDark: '#060709', sock: '#e9e4da', hair: '#17100b', rim: 'rgba(255,110,60,.95)' },
  ayaz: { skin: '#e2b18c', skinDark: '#93664a', glove: '#4cc9f0', gloveDark: '#1f7895', cuff: '#f1ece2', trunks: '#143247', trunksDark: '#06141d', belt: '#4cc9f0', boot: '#ebe6dc', bootDark: '#9f998d', sock: '#ebe6dc', hair: '#33221a', rim: 'rgba(90,205,245,.95)' },
  ref: { skin: '#b98564', skinDark: '#7d573f', glove: '#b98564', gloveDark: '#7d573f', cuff: '#e9e4da', trunks: '#23272e', trunksDark: '#121418', belt: '#0a0b0d', boot: '#0b0c0e', bootDark: '#000', sock: '#23272e', hair: '#bdb6aa', rim: 'rgba(233,228,218,.4)', shirt: '#eee9df', shirtDark: '#a49e92', trousers: '#262a31' },
};
const fighterAt = (id: FighterId, x: number, yaw: number): V5Fighter => ({ id, x, z: 0, yawMilliRad: yaw, health: 1000, stamina: 1000, stun: 0, action: 'guard', actionAt: 0, until: 0, phase: 'idle', combo: 0, hits: 0, knockdowns: 0, pose: contactGuardPose({ x, z: 0, yawMilliRad: yaw }) });
/** Before a seed is revealed: the engine's documented start marks, no seed or result implied. */
const WARMUP: RingReplay = { frames: [{ tick: 0, kor: fighterAt('kor', -1300, 1571), ayaz: fighterAt('ayaz', 1300, -1571), referee: { x: 0, z: -1600, yawMilliRad: 0, mode: 'watch', count: 0 } }], events: [] };

// ---- colour helpers (cached; shading is the hottest string work in a frame) ---------------------------
const colorCache = new Map<string, [number, number, number]>();
const parse = (c: string): [number, number, number] => {
  let v = colorCache.get(c);
  if (v) return v;
  if (c.startsWith('#')) { const n = parseInt(c.length === 4 ? c.slice(1).replace(/./g, m => m + m) : c.slice(1), 16); v = [n >> 16, (n >> 8) & 255, n & 255]; }
  else { const m = c.match(/[\d.]+/g) ?? ['0', '0', '0']; v = [Number(m[0]), Number(m[1]), Number(m[2])]; }
  colorCache.set(c, v); return v;
};
const shadeCache = new Map<string, string>();
/** Lighten (k > 0) or darken (k < 0) a colour. */
const shade = (c: string, k: number) => {
  const key = c + k; let s = shadeCache.get(key);
  if (s) return s;
  const [r, g, b] = parse(c), f = (x: number) => Math.round(clamp(k > 0 ? x + (255 - x) * k : x * (1 + k), 0, 255));
  s = `rgb(${f(r)},${f(g)},${f(b)})`; shadeCache.set(key, s); return s;
};

type Axis = { rx: number; rz: number };
type Cam = { cu: number; ch: number; cw: number; cos: number; sin: number; F: number; W: number; H: number };
type P3 = { u: number; y: number; w: number };
type S2 = { x: number; y: number; z: number };
type Mood = { beam: string; beamA: number; pool: number; crowd: number; led: [string, string] };
type ViewState = { rig: CameraRig; raw: Axis | null; key: string };
type Seg = { z: number; draw: () => void };

function hull(points: { x: number; y: number }[]) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: typeof p = [], hi: typeof p = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Mounts the broadcast on `host` (a positioned element) and returns the cleanup. `props` is read on every frame. */
export function mountBroadcast(host: HTMLElement, props: () => BroadcastProps): () => void {
  let TXT = DEFAULT_BROADCAST_LABELS;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // pan-y: vertical swipes keep scrolling the page; horizontal drags orbit (see the rules in the file header).
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  const bg = document.createElement('canvas'), bctx = bg.getContext('2d', { alpha: false });
  if (!ctx || !bctx) { props().onError?.(); canvas.remove(); return () => {}; }

  // Cached static art. The painted plate loads once; until it does (or if it fails) the procedural backdrop is used.
  let plate: Canvas = fallbackPlate(), plateReal = false;
  const cancelPlate = loadPlate('/images/ringside-arena.jpg', c => { plate = c; plateReal = true; }, () => { plateReal = false; });
  const tierA = crowdTier({ w: 2304, h: 300, rows: 11, seed: 11, tone: 14, head: 10 }), tierB = crowdTier({ w: 2304, h: 300, rows: 12, seed: 97, tone: 12, head: 8 });
  // Cutout sprites (loaded once). Until they are ready, or if they fail to load, the procedural figures and ring are drawn.
  let sprites: SpriteSet | null = null;
  const cancelSprites = loadSprites('/sprites/ringside/', set => { sprites = set; }, () => { sprites = null; });
  const led = ledStrip(), glowWarm = glow('255,226,170'), glowOrange = glow('255,106,61'), glowCyan = glow('76,201,240');

  let raf = 0, disposed = false, ready = false, visible = true, last = -Infinity, lastNow = 0, dpr = 1, seek: number | null = null, preview: RingReplay | null = null;
  const live: ViewState = { rig: new CameraRig(), raw: null, key: '' }, replayView: ViewState = { rig: new CameraRig(), raw: null, key: '' };
  const trails: Record<string, { p: V3; t: number }[]> = {};
  const bodyOrder: string[][] = [[], []];
  const boxes: { id: FighterId; x0: number; y0: number; x1: number; y1: number }[] = [];
  let audio: RingsideAudio | null = null, audioMs = -1, audioKey = '', bellKey = '';
  const audioAbort = new AbortController();
  // Adaptive detail: 0 full, 1 no beams/haze/crowd motion, 2 also no second crowd tier and no sparkles. Driven by measured frame cost.
  let lod = 0, costEma = 0, lodHold = 0;
  let lastPreset: BroadcastProps['camera'] = props().camera, lastReset = props().resetViewKey;
  const notify = (manual: boolean) => { try { props().onManualView?.(manual); } catch { /* UI callback only */ } };

  const resize = () => {
    const r = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, r.width > 900 ? 1.6 : 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr)); last = -Infinity;
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); }); io.observe(host);

  // ---- viewer input: tap selects, drag orbits, wheel and pinch zoom ------------------------------------
  const pts = new Map<number, { x: number; y: number }>();
  let drag: { id: number; kind: string; tx: number; ty: number; engaged: boolean } | null = null, pinch: { d: number; cx: number; cy: number } | null = null;
  const orbitable = () => props().camera !== 'overhead';
  const pick = (event: PointerEvent) => {
    const select = props().onSelectFighter; if (!select) return;
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const hit = boxes.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    if (hit) select(hit.id);
  };
  const orbit = (dx: number, dy: number, touch: boolean) => {
    if (!orbitable()) return;
    const was = live.rig.manual;
    live.rig.orbit(dx * (touch ? .008 : .0055), dy * .0035);
    if (!was) notify(true);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) drag = { id: e.pointerId, kind: e.pointerType, tx: 0, ty: 0, engaged: false };
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      if (drag) { drag.engaged = true; }
    }
  };
  const onMove = (e: PointerEvent) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (orbitable()) {
        const was = live.rig.manual;
        live.rig.zoom(clamp(pinch.d / d, .8, 1.25)); live.rig.orbit((cx - pinch.cx) * .008, (cy - pinch.cy) * .0035);
        if (!was) notify(true);
      }
      pinch = { d, cx, cy };
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    drag.tx += dx; drag.ty += dy;
    if (!drag.engaged) {
      const ax = Math.abs(drag.tx), ay = Math.abs(drag.ty);
      if (drag.kind === 'touch') {
        if (ax >= 10 && ax > ay * 1.15) engage(e, dx, dy);
        else if (ay >= 10 && ay >= ax) { drag = null; return; } // mostly vertical: the browser scrolls the page
      } else if (Math.hypot(drag.tx, drag.ty) >= 6) engage(e, dx, dy);
      return;
    }
    orbit(dx, dy, drag.kind === 'touch');
  };
  const engage = (e: PointerEvent, dx: number, dy: number) => {
    if (!drag) return;
    if (!orbitable()) { drag.engaged = true; return; }
    drag.engaged = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
    orbit(dx, dy, drag.kind === 'touch');
  };
  const onUp = (e: PointerEvent) => {
    const wasDrag = drag && drag.id === e.pointerId ? drag : null;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (wasDrag) { if (!wasDrag.engaged && Math.hypot(wasDrag.tx, wasDrag.ty) < 6) pick(e); drag = null; }
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };
  const onCancel = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (drag?.id === e.pointerId) drag = null; };
  const onWheel = (e: WheelEvent) => {
    if (!orbitable()) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, was = live.rig.manual;
    live.rig.zoom(clamp(Math.exp(e.deltaY * unit * .0013), .7, 1.4));
    if (!was) notify(true);
  };
  const onDouble = () => { if (live.rig.reset()) notify(false); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel); canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDouble);

  // ---- projection: world metres -> camera plane (u along the view axis, w into the screen) ---------
  let C: Cam = { cu: 0, ch: 2.6, cw: -6, cos: 1, sin: 0, F: 600, W: 1, H: 1 };
  let AX: Axis = { rx: 1, rz: 0 };
  let camWorld = { x: 0, y: 2.6, z: -6 };
  const toCam = (p: P3) => { const dy = p.y - C.ch, dw = p.w - C.cw; return { x: p.u - C.cu, y: dy * C.cos + dw * C.sin, z: -dy * C.sin + dw * C.cos }; };
  const screen = (c: { x: number; y: number; z: number }): S2 => ({ x: C.W / 2 + C.F * c.x / c.z, y: C.H / 2 - C.F * c.y / c.z, z: c.z });
  const proj = (p: P3) => screen(toCam(p));
  const world = (x: number, y: number, z: number, ax: Axis = AX): P3 => ({ u: x * ax.rx + z * ax.rz, y, w: x * ax.rz - z * ax.rx });
  const W3 = (p: V3) => world(p.x, p.y, p.z);
  const P = (p: V3) => proj(W3(p));
  const polygon = (pts: P3[]) => {
    const cs = pts.map(toCam), out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]!, b = cs[(i + 1) % cs.length]!, ina = a.z >= NEAR, inb = b.z >= NEAR;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (NEAR - a.z) / (b.z - a.z); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR }); }
    }
    return out.map(screen);
  };
  const path = (g: CanvasRenderingContext2D, pts: { x: number; y: number }[]) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); };
  const segment = (a: P3, b: P3) => { const s = polygon([a, b]); if (s.length < 2) return; ctx.beginPath(); ctx.moveTo(s[0]!.x, s[0]!.y); ctx.lineTo(s[1]!.x, s[1]!.y); ctx.stroke(); };
  const px = (m: number, z: number) => Math.max(.7, m * C.F / Math.max(.3, z));
  const onScreen = (pts: S2[]) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } return x1 > -50 && x0 < C.W + 50 && y1 > -50 && y0 < C.H + 50; };
  /** Draws an image on the parallelogram given by three projected corners (affine: fine for boards a few metres wide). */
  const quadImage = (g: CanvasRenderingContext2D, img: Canvas | HTMLImageElement, sx: number, sw: number, p00: S2, p10: S2, p01: S2) => {
    const sh = (img as HTMLImageElement).naturalHeight || img.height; g.save();
    g.transform((p10.x - p00.x) / sw, (p10.y - p00.y) / sw, (p01.x - p00.x) / sh, (p01.y - p00.y) / sh, p00.x, p00.y);
    g.drawImage(img, sx, 0, sw, sh, 0, 0, sw, sh); g.restore();
  };

  // ---- figures: shaded capsules from a 3D skeleton, sorted per segment with the other bodies -------
  /** Adds a tapered capsule outline to the current path (several can be filled as one shape). */
  const capsulePath = (a: { x: number; y: number }, b: { x: number; y: number }, ra: number, rb: number) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1e-3, nx = -dy / l, ny = dx / l, ang = Math.atan2(dy, dx);
    ctx.moveTo(a.x + nx * ra, a.y + ny * ra); ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
    ctx.arc(b.x, b.y, rb, ang + Math.PI / 2, ang - Math.PI / 2, true);
    ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
    ctx.arc(a.x, a.y, ra, ang - Math.PI / 2, ang + Math.PI / 2, true);
    ctx.closePath();
  };
  /** Tapered limb: key light from above (lit edge, highlight stripe, body, shadow side), a soft outline and an optional team rim. */
  const limb = (a: S2, b: S2, ra: number, rb: number, fill: string, dark: string, rim: string | null, shine = .2) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    ctx.beginPath(); capsulePath(a, b, ra, rb);
    const up = ny < 0 ? 1 : -1, r = Math.max(ra, rb);
    const g = ctx.createLinearGradient(a.x + nx * r * up, a.y + ny * r * up, a.x - nx * r * up, a.y - ny * r * up);
    g.addColorStop(0, shade(fill, -.04)); g.addColorStop(.26, shade(fill, shine)); g.addColorStop(.52, fill); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(4,5,8,.34)'; ctx.lineWidth = Math.max(.8, r * .09); ctx.stroke();
    if (rim) { ctx.save(); ctx.globalAlpha *= .5; ctx.strokeStyle = rim; ctx.lineWidth = Math.max(.8, r * .13); ctx.beginPath(); ctx.moveTo(a.x - nx * ra * up * .88, a.y - ny * ra * up * .88); ctx.lineTo(b.x - nx * rb * up * .88, b.y - ny * rb * up * .88); ctx.stroke(); ctx.restore(); }
  };
  const ball = (c: S2, r: number, fill: string, dark: string, gloss = .3) => {
    const g = ctx.createRadialGradient(c.x - r * .35, c.y - r * .4, r * .12, c.x, c.y, r);
    g.addColorStop(0, shade(fill, .2)); g.addColorStop(.6, fill); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
    if (gloss) { ctx.fillStyle = `rgba(255,255,255,${gloss})`; ctx.beginPath(); ctx.ellipse(c.x - r * .32, c.y - r * .42, r * .3, r * .2, -.5, 0, Math.PI * 2); ctx.fill(); }
  };
  const mixS = (a: S2, c: S2, t: number): S2 => ({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t });
  // ---- cutout figures ---------------------------------------------------------------------------
  type Doll = { init: boolean; flip: boolean; headFlip: boolean; arm: 'l' | 'r'; leg: 'l' | 'r' };
  const doll: Record<string, Doll> = {};
  /** Draws a body from its sprites placed between the projected joint pairs of the skeleton. */
  const addSprites = (b: Body, S: Record<string, S2>, push: (z: number, fn: () => void) => void, set: SpriteSet, zBase: number, _sweat: number) => {
    const cid: CharacterId = b.id === 'ref' ? 'referee' : b.id, sp = set.parts[cid], d = b.dims, j = b.j, isRef = cid === 'referee';
    const st = (doll[b.id] ??= { init: false, flip: false, headFlip: false, arm: 'l', leg: 'l' });
    // Facing in the camera frame: the sprites face right; mirror when the body faces left. Beyond about 60 degrees from profile
    // (toward or away from the camera) the sign is kept (hysteresis), the torso and hips widen and the head narrows.
    const c0 = toCam(W3(j.pelvis)), dirOf = (v: V3) => { const c1 = toCam(W3({ x: j.pelvis.x + v.x, y: j.pelvis.y + v.y, z: j.pelvis.z + v.z })); return { x: c1.x - c0.x, z: c1.z - c0.z }; };
    const fx = dirOf(b.F).x, fh = dirOf({ x: b.face.x, y: 0, z: b.face.z }), fhn = Math.hypot(fh.x, fh.z) || 1;
    if (!st.init) { st.init = true; st.flip = fx < 0; st.headFlip = st.flip; }
    else { if (Math.abs(fx) > .25) st.flip = fx < 0; if (Math.abs(fh.x / fhn) > .3) st.headFlip = fh.x < 0; }
    const mirror = st.flip, frontal = 1 - Math.min(1, Math.abs(fx) / .87);
    // Near and far limbs by camera depth, with hysteresis so the draw order never flickers.
    const zl = S.lS!.z, zr = S.rS!.z; if (st.arm === 'l' && zr < zl - .08) st.arm = 'r'; else if (st.arm === 'r' && zl < zr - .08) st.arm = 'l';
    const za = S.lA!.z, zb = S.rA!.z; if (st.leg === 'l' && zb < za - .06) st.leg = 'r'; else if (st.leg === 'r' && za < zb - .06) st.leg = 'l';
    const farArm: 'l' | 'r' = st.arm === 'l' ? 'r' : 'l', farLeg: 'l' | 'r' = st.leg === 'l' ? 'r' : 'l';
    const sc = (z: number) => C.F / Math.max(.3, z);
    const striker = b.strike ? b.strike.hand : null, strikeKick = !!b.strike?.kick;
    const put = (layer: number, name: string, a: S2, bb: S2, world: number, o: { far?: boolean; widen?: number; bias?: number; mirror?: boolean } = {}): Matrix | null => {
      const s = sp[name]; if (!s) return null;
      const len = boneLength(s.def), across = world / len * sc((a.z + bb.z) / 2) * (o.widen ?? 1), along = Math.max(Math.hypot(bb.x - a.x, bb.y - a.y) / len, across * .22);
      push(zBase - layer * .001 + (o.bias ?? 0), () => drawPart(ctx, s, !!o.far, o.mirror ?? mirror, a, bb, along, across));
      return partMatrix(s.def, o.mirror ?? mirror, a, bb, along, across);
    };
    const cap = (layer: number, name: string, at: S2, partA: string, partB: string, ka: number, kb: number, far: boolean, bias = 0) => {
      const A = sp[partA], B = sp[partB], c = sp[name]; if (!A || !B || !c) return;
      const r = .5 * Math.min(A.def.width.dist * ka, B.def.width.prox * kb) * sc(at.z) * .86;
      push(zBase - layer * .001 + bias, () => drawCap(ctx, at, r, c.def.color, far));
    };
    const kOf = (name: string, world: number) => { const s = sp[name]; return s ? world / boneLength(s.def) : 0; };
    const lift = (v: V3, up: V3, k: number): V3 => ({ x: v.x + up.x * k, y: v.y + up.y * k, z: v.z + up.z * k });
    const tU = b.tU, chestZ = S.chest!.z;
    // Legs (far, then near).
    for (const [n, side] of [[0, farLeg], [1, st.leg]] as const) {
      const far = n === 0, H = S[side + 'H']!, K = S[side + 'K']!, A = S[side + 'A']!, T = S[side + 'T']!, base = 1 + n * 3, kick = strikeKick && striker === side, bias = kick ? -30 : 0;
      put(base, 'thigh', H, K, d.thigh, { far, bias }); put(base + 1, 'shin', K, A, d.shin, { far, bias });
      cap(base + 1.5, 'thigh', K, 'thigh', 'shin', kOf('thigh', d.thigh), kOf('shin', d.shin), far, bias);
      if (sp.boot) put(base + 2, 'boot', A, T, d.foot, { far, bias });
    }
    // Hips and torso, then the head; arms last so a glove is never hidden inside the head.
    const waist: V3 = lift(j.pelvis, tU, isRef ? 0 : .04);
    // The torso's neck stub runs up under the chin (the skeleton's neck joint is lower than the art's neck), so head and body never separate.
    const neckTop = P(lift(j.neck, tU, .075)) as S2;
    const tm = put(7, 'torso', P(waist) as S2, neckTop, (isRef ? d.torso : d.torso - .04) + .075, { widen: 1 + .3 * frontal });
    // Both arms hang from the torso art's own shoulder (the deltoid), so arm and body never part company.
    const sh = sp.torso!.def.extra?.shoulder, shoulderPt: S2 | null = tm && sh ? { ...apply(tm, sh[0], sh[1]), z: S.neck!.z } : null;
    if (sp.shorts) { const up = { x: tU.x * .4, y: 1 - .4 + tU.y * .4, z: tU.z * .4 }, ul = Math.hypot(up.x, up.y, up.z) || 1, u = { x: up.x / ul, y: up.y / ul, z: up.z / ul }; put(8, 'shorts', P(lift(j.pelvis, u, .15)) as S2, P(lift(j.pelvis, u, -.17)) as S2, .32, { widen: 1 + .3 * frontal }); }
    {
      const s = sp.head!, hs = S.head!, ns = S.neck!, ux = hs.x - ns.x, uy = hs.y - ns.y, ul = Math.hypot(ux, uy) || 1, k = 2.35 * d.headR / s.def.size[1], across = k * sc(hs.z), len = boneLength(s.def) * across;
      const a = { x: hs.x - ux / ul * len, y: hs.y - uy / ul * len }, widen = .78 + .22 * Math.min(1, Math.abs(fh.x / fhn) * 1.25);
      push(zBase - 9 * .001, () => drawPart(ctx, s, false, st.headFlip, a, hs, across, across * widen));
    }
    for (const [n, side] of [[0, farArm], [1, st.arm]] as const) {
      const far = n === 0, Sh = shoulderPt ?? S[side + 'S']!, E = S[side + 'E']!, G = S[side + 'G']!, behind = far && S[side + 'S']!.z > chestZ + .3, base = behind ? -2 : 10 + n * 3, hit = striker === side && !strikeKick, bias = hit ? -30 : 0;
      put(base, 'upperArm', Sh, E, d.upper, { far, bias }); put(base + 1, 'forearm', E, G, d.fore, { far: far && !hit, bias });
      cap(base + .5, 'upperArm', E, 'upperArm', 'forearm', kOf('upperArm', d.upper), kOf('forearm', d.fore), far, bias);
    }
  };
  const addBody = (b: Body, segs: Seg[], alpha = 1, sweat = 0, hurt = 0, zBase = 0) => {
    const ref = b.id === 'ref', look = LOOKS[b.id], d = b.dims, j = b.j;
    const S: Record<string, S2> = {};
    for (const k of Object.keys(j) as (keyof typeof j)[]) S[k] = P(j[k]);
    const centre = S.chest!.z, rim = ref ? null : look.rim;
    const L = d.limb, near = (z: number) => z < centre;
    const push = (z: number, fn: () => void) => segs.push({ z, draw: alpha < 1 ? () => { ctx.globalAlpha = alpha; fn(); ctx.globalAlpha = 1; } : fn });
    // Shadow first (always behind everything on this body): body, feet and a soft contact shadow for a kicking foot.
    const shadowC = P({ x: j.pelvis.x, y: 0, z: j.pelvis.z }), downK = b.down ? 1 : 0;
    push(1e6 - centre, () => {
      const rx = px(.5 + .45 * downK, shadowC.z), ry = rx * Math.max(.16, C.sin * .9);
      const sg = ctx.createRadialGradient(shadowC.x, shadowC.y, 0, shadowC.x, shadowC.y, rx); sg.addColorStop(0, 'rgba(0,0,0,.5)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(shadowC.x, shadowC.y); ctx.scale(1, ry / rx); ctx.translate(-shadowC.x, -shadowC.y); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(shadowC.x, shadowC.y, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      for (const k of ['lA', 'rA'] as const) { const f = P({ x: j[k].x, y: 0, z: j[k].z }), lift = clamp(1 - j[k].y / 1.2); ctx.fillStyle = `rgba(0,0,0,${(.34 * lift).toFixed(3)})`; ctx.beginPath(); ctx.ellipse(f.x, f.y, px(.14, f.z), px(.055, f.z), 0, 0, Math.PI * 2); ctx.fill(); }
    });
    const procedural = () => {
    for (const side of ['l', 'r'] as const) {
      const H = S[side + 'H']!, K = S[side + 'K']!, A = S[side + 'A']!, T = S[side + 'T']!, far = !near((H.z + A.z) / 2);
      const skin = far ? shade(look.skin, -.25) : look.skin, dark = far ? shade(look.skinDark, -.25) : look.skinDark;
      const legFill = ref ? (far ? shade(look.trousers!, -.3) : look.trousers!) : skin, legDark = ref ? '#0b0c0f' : dark;
      push((H.z + K.z) / 2, () => {
        limb(H, K, px(.092 * L, H.z), px(.066 * L, K.z), legFill, legDark, rim, ref ? .12 : .22);
        if (!ref) {
          // Quadriceps bulge, then the trunk leg: covers the upper thigh (KOR long, AYAZ short) with a flared hem and a side stripe.
          const q = mixS(H, K, .5); limb(mixS(H, K, .3), q, px(.088 * L, H.z), px(.083 * L, q.z), skin, dark, null, .26);
          const kk = b.id === 'kor' ? .58 : .42, e = mixS(H, K, kk), trunk = far ? look.trunksDark : look.trunks;
          limb(H, e, px(.1 * L, H.z), px(.088 * L, e.z), trunk, look.trunksDark, null, .28);
          const dx = e.x - H.x, dy = e.y - H.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, r = px(.088 * L, e.z), outer = (nx * (H.x - S.pelvis!.x) + ny * (H.y - S.pelvis!.y)) >= 0 ? 1 : -1;
          ctx.strokeStyle = look.belt; ctx.globalAlpha *= .85; ctx.lineWidth = Math.max(1, px(.014, e.z)); ctx.beginPath(); ctx.moveTo(H.x + nx * r * .55 * outer, H.y + ny * r * .55 * outer); ctx.lineTo(e.x + nx * r * .55 * outer, e.y + ny * r * .55 * outer); ctx.stroke();
          ctx.strokeStyle = '#f1ece2'; ctx.lineWidth = Math.max(1.4, px(.026, e.z)); ctx.beginPath(); ctx.moveTo(e.x - nx * r * 1.02, e.y - ny * r * 1.02); ctx.lineTo(e.x + nx * r * 1.02, e.y + ny * r * 1.02); ctx.stroke(); ctx.globalAlpha = alpha;
        }
      });
      push((K.z + A.z) / 2, () => {
        limb(K, A, px(.064 * L, K.z), px(.044 * L, A.z), legFill, legDark, rim, ref ? .12 : .22);
        if (!ref) { const c = mixS(K, A, .36); limb(mixS(K, A, .08), c, px(.07 * L, K.z), px(.064 * L, c.z), skin, dark, null, .26); ball(K, px(.058 * L, K.z), skin, dark, .1); }
      });
      // Boots: KOR short black, AYAZ tall white with a sock line; referee shoes. Laces, toe cap and sole on the fighters.
      const shaft = ref ? .08 : b.id === 'ayaz' ? .42 : .2, top = mixS(A, K, shaft);
      push((A.z + T.z) / 2 - .01, () => {
        const boot = far ? look.bootDark : look.boot;
        limb(top, A, px(.054 * L, top.z), px(.05 * L, A.z), boot, look.bootDark, null, .16);
        limb(A, T, px(.052, A.z), px(.04, T.z), boot, look.bootDark, null, .18);
        if (!ref) {
          ctx.strokeStyle = b.id === 'ayaz' ? 'rgba(20,24,30,.55)' : 'rgba(233,228,218,.8)'; ctx.lineWidth = Math.max(1, px(.012, A.z)); ctx.beginPath(); ctx.moveTo(top.x - px(.05, top.z), top.y); ctx.lineTo(top.x + px(.05, top.z), top.y); ctx.stroke();
          ctx.strokeStyle = b.id === 'ayaz' ? 'rgba(30,34,40,.5)' : 'rgba(233,228,218,.55)'; ctx.lineWidth = Math.max(.8, px(.007, A.z));
          for (let k = 1; k <= 3; k++) { const q = mixS(A, T, k * .2), tx = (T.y - A.y), ty = -(T.x - A.x), tl = Math.hypot(tx, ty) || 1, s = px(.026, q.z); ctx.beginPath(); ctx.moveTo(q.x - tx / tl * s, q.y - ty / tl * s); ctx.lineTo(q.x + tx / tl * s, q.y + ty / tl * s); ctx.stroke(); }
          ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = Math.max(1, px(.012, T.z)); ctx.beginPath(); ctx.moveTo(A.x, A.y + px(.048, A.z)); ctx.lineTo(T.x, T.y + px(.034, T.z)); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(T.x, T.y - px(.012, T.z), px(.026, T.z), px(.016, T.z), 0, 0, Math.PI * 2); ctx.fill();
        }
      });
    }
    // Torso as volume: a spine core, a chest bar between the shoulders and a hip bar, filled as one shape,
    // so it reads as a body from the front, the side and the back. Trunks wrap the hip bar.
    const lS = S.lS!, rS = S.rS!, neck = S.neck!, chest = S.chest!, pel = S.pelvis!;
    const at = (base: V3, up: number, side: number) => P({ x: base.x + b.tU.x * up + b.tL.x * side, y: base.y + b.tU.y * up + b.tL.y * side, z: base.z + b.tU.z * up + b.tL.z * side });
    const cw = d.shoulder * .78, hw = d.hip * 1.05;
    const chestL = at(j.pelvis, d.torso * .74, cw), chestR = at(j.pelvis, d.torso * .74, -cw), waist = at(j.pelvis, d.torso * .32, 0), hipL = at(j.pelvis, .04, hw), hipR = at(j.pelvis, .04, -hw);
    const torsoZ = (chest.z + pel.z) / 2;
    push(torsoZ, () => {
      const body = ref ? look.shirt! : look.skin, bodyDark = ref ? look.shirtDark! : look.skinDark;
      const rc = px(.12 * d.chest, chest.z), rw = px(.115 * d.chest, waist.z), rh = px(.11 * d.chest, pel.z), ry = px(.07 * d.chest, chest.z);
      ctx.beginPath();
      capsulePath(chestL, chestR, rc, rc); capsulePath(waist, mixS(chestL, chestR, .5), rw, rc); capsulePath(hipL, hipR, rh, rh); capsulePath(waist, mixS(hipL, hipR, .5), rw, rh); capsulePath(lS, rS, ry, ry); capsulePath(mixS(lS, rS, .5), neck, ry, px(.06, neck.z));
      const g = ctx.createLinearGradient(neck.x, neck.y - rc, pel.x, pel.y + rh);
      g.addColorStop(0, shade(body, .14)); g.addColorStop(.5, body); g.addColorStop(1, bodyDark);
      ctx.fillStyle = g; ctx.fill('nonzero');
      // Side shading: the half of the chest turned away from the key light is darker; a soft outline separates the body from the crowd.
      const side = ctx.createLinearGradient(chestL.x, chestL.y, chestR.x, chestR.y);
      side.addColorStop(0, 'rgba(0,0,0,0)'); side.addColorStop(.55, 'rgba(0,0,0,.04)'); side.addColorStop(1, 'rgba(0,0,0,.26)');
      ctx.fillStyle = side; ctx.fill('nonzero');
      ctx.strokeStyle = 'rgba(4,5,8,.3)'; ctx.lineWidth = Math.max(.8, rc * .06); ctx.stroke();
      if (rim) { ctx.save(); ctx.globalAlpha *= .4; ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, rc * .1); ctx.stroke(); ctx.restore(); }
      if (!ref) {
        // Front details only when the chest faces the camera: pectoral line, centre line, abs, sweat sheen.
        const front = P({ x: j.chest.x + b.F.x * .1, y: j.chest.y, z: j.chest.z + b.F.z * .1 }), facing = clamp((chest.z - front.z) / .1 + .2);
        if (facing > 0) {
          ctx.globalAlpha = alpha * facing;
          const m = mixS(chestL, chestR, .5), py = rc * .55;
          ctx.strokeStyle = 'rgba(0,0,0,.24)'; ctx.lineWidth = Math.max(1, rc * .07);
          ctx.beginPath(); ctx.moveTo(chestL.x, chestL.y + py * .6); ctx.quadraticCurveTo(m.x, m.y + py * 1.5, chestR.x, chestR.y + py * .6); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(m.x, m.y + py * 1.3); ctx.lineTo(waist.x, waist.y + rw * .6); ctx.stroke();
          ctx.lineWidth = Math.max(.8, rc * .045);
          for (let k = 1; k <= 3; k++) { const q = mixS(m, waist, .25 + k * .22), hw2 = rc * (.34 - k * .03); ctx.beginPath(); ctx.moveTo(q.x - hw2, q.y); ctx.quadraticCurveTo(q.x, q.y + rc * .09, q.x + hw2, q.y); ctx.stroke(); }
          ctx.fillStyle = `rgba(255,240,220,${(.1 + sweat * .26).toFixed(3)})`; ctx.beginPath(); ctx.ellipse(m.x - rc * .3, m.y, rc * .5, rc * .32, -.4, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = alpha;
        }
        // Trapezius lines from the neck to the shoulders.
        ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = Math.max(1, rc * .06); ctx.beginPath(); ctx.moveTo(neck.x, neck.y); ctx.lineTo(lS.x, lS.y - ry * .2); ctx.moveTo(neck.x, neck.y); ctx.lineTo(rS.x, rS.y - ry * .2); ctx.stroke();
        // Trunks: the hip bar in trunk colour with a double waistband (team colour over white).
        ctx.beginPath(); capsulePath(hipL, hipR, rh * 1.1, rh * 1.1); capsulePath(waist, mixS(hipL, hipR, .5), rw * .95, rh * 1.05);
        const tg = ctx.createLinearGradient(waist.x, waist.y, pel.x, pel.y + rh); tg.addColorStop(0, look.trunks); tg.addColorStop(1, look.trunksDark);
        ctx.fillStyle = tg; ctx.fill('nonzero');
        const bl = at(j.pelvis, d.torso * .3, hw * 1.05), br = at(j.pelvis, d.torso * .3, -hw * 1.05);
        ctx.lineCap = 'round'; ctx.strokeStyle = look.belt; ctx.lineWidth = Math.max(1.5, rw * .3); ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(241,236,226,.9)'; ctx.lineWidth = Math.max(1, rw * .09); ctx.beginPath(); ctx.moveTo(bl.x, bl.y + rw * .25); ctx.lineTo(br.x, br.y + rw * .25); ctx.stroke();
      } else {
        // Referee: collar, bow tie and dark trousers.
        const t = mixS(neck, chest, .22), cs = px(.034, t.z);
        ctx.fillStyle = '#f8f5ee'; ctx.beginPath(); ctx.moveTo(t.x - cs * 1.5, t.y - cs); ctx.lineTo(t.x, t.y + cs * 1.6); ctx.lineTo(t.x + cs * 1.5, t.y - cs); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0a0b0d'; ctx.beginPath(); ctx.moveTo(t.x, t.y + cs * .35); ctx.lineTo(t.x - cs * 1.5, t.y - cs * .35); ctx.lineTo(t.x - cs * 1.5, t.y + cs * 1.1); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(t.x, t.y + cs * .35); ctx.lineTo(t.x + cs * 1.5, t.y - cs * .35); ctx.lineTo(t.x + cs * 1.5, t.y + cs * 1.1); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(t.x, t.y + cs * .4, cs * .38, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); capsulePath(hipL, hipR, px(.095, pel.z), px(.095, pel.z)); ctx.fillStyle = look.trousers!; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = Math.max(1, px(.01, pel.z)); ctx.beginPath(); ctx.moveTo(waist.x, waist.y); ctx.lineTo(pel.x, pel.y + rh); ctx.stroke();
      }
    });
    // Head: neck, skull, hair, ear, face toward where the head points (nose, brow, eye, mouthguard).
    const head = S.head!, R = px(d.headR, head.z);
    push((neck.z + head.z) / 2 + .01, () => limb(neck, mixS(neck, head, .55), px(.056 * d.chest, neck.z), px(.05, head.z), look.skin, look.skinDark, null, .12));
    push(head.z - .005, () => {
      const fp = P({ x: j.head.x + b.face.x * d.headR, y: j.head.y + b.face.y * d.headR, z: j.head.z + b.face.z * d.headR });
      const fx = (fp.x - head.x) / R, fy = (fp.y - head.y) / R, toward = clamp(head.z - fp.z > 0 ? 1 : 0);
      // Ear on the side away from the face.
      ctx.fillStyle = look.skinDark; ctx.beginPath(); ctx.ellipse(head.x - fx * R * .42, head.y + R * .05, R * .17, R * .24, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(head.x - R * .35, head.y - R * .45, R * .15, head.x, head.y, R * 1.08);
      g.addColorStop(0, shade(look.skin, .14)); g.addColorStop(.7, look.skin); g.addColorStop(1, look.skinDark);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(head.x, head.y, R * .92, R * 1.04, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(4,5,8,.3)'; ctx.lineWidth = Math.max(.8, R * .06); ctx.stroke();
      // Hair on the back and top, away from the face. KOR: close crop with a fade. AYAZ: short and fuller with a quiff.
      ctx.fillStyle = look.hair; ctx.beginPath(); ctx.ellipse(head.x - fx * R * .18, head.y - R * (b.id === 'ayaz' ? .38 : .32), R * .96, R * (b.id === 'ayaz' ? .84 : .74), 0, Math.PI * 1.04, Math.PI * 1.96); ctx.fill();
      ctx.beginPath(); ctx.ellipse(head.x - fx * R * .5, head.y - R * .05, R * .55, R * .78, 0, 0, Math.PI * 2); ctx.globalAlpha *= .9 * (1 - toward * .4); ctx.fill(); ctx.globalAlpha = alpha;
      if (b.id === 'ayaz') { ctx.beginPath(); ctx.ellipse(head.x + fx * R * .3, head.y - R * .86, R * .55, R * .2, fx * .3, 0, Math.PI * 2); ctx.fill(); }
      if (b.id === 'kor') { ctx.fillStyle = 'rgba(22,14,9,.88)'; ctx.beginPath(); ctx.ellipse(head.x + fx * R * .45, head.y + R * .5, R * .58, R * .38, 0, 0, Math.PI); ctx.fill(); }
      // Face features follow the head direction; they fade when the face turns away from the camera.
      const fa = clamp(Math.hypot(fx, fy) * 1.4) * (toward ? 1 : .35);
      ctx.fillStyle = shade(look.skinDark, -.1); ctx.globalAlpha = alpha * fa;
      ctx.beginPath(); ctx.ellipse(head.x + fx * R * .86, head.y + fy * R * .5 + R * .12, R * .16, R * .2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = look.hair; ctx.lineWidth = Math.max(1, R * .12); ctx.beginPath(); ctx.moveTo(head.x + fx * R * .45 - R * .12, head.y - R * .2 + fy * R * .4); ctx.lineTo(head.x + fx * R * .82 + R * .1, head.y - R * .22 + fy * R * .4); ctx.stroke();
      ctx.fillStyle = '#120d0a'; ctx.beginPath(); ctx.ellipse(head.x + fx * R * .62, head.y - R * .04 + fy * R * .4, R * .075, R * .05, 0, 0, Math.PI * 2); ctx.fill();
      if (!ref) {
        ctx.fillStyle = look.glove; ctx.beginPath(); ctx.ellipse(head.x + fx * R * .74, head.y + R * .42 + fy * R * .3, R * .16, R * .07, 0, 0, Math.PI * 2); ctx.fill();
        // A hard head blow leaves a mark on the brow.
        if (hurt > .02) { ctx.fillStyle = `rgba(150,40,30,${(.45 * hurt).toFixed(3)})`; ctx.beginPath(); ctx.ellipse(head.x + fx * R * .55, head.y - R * .12 + fy * R * .4, R * .2, R * .1, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(head.x - fx * R * .1, head.y + R * .88, R * .5, R * .16, 0, 0, Math.PI * 2); ctx.fill();
      if (rim) { ctx.save(); ctx.globalAlpha *= .4; ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, R * .09); ctx.beginPath(); ctx.ellipse(head.x, head.y, R * .92, R * 1.04, 0, -Math.PI * .85, -Math.PI * .15); ctx.stroke(); ctx.restore(); }
    });
    // Arms and gloves last within the body (gloves slightly toward the camera).
    for (const side of ['l', 'r'] as const) {
      const Sh = S[side + 'S']!, E = S[side + 'E']!, G = S[side + 'G']!, far = !near((Sh.z + G.z) / 2);
      const skin = far ? shade(look.skin, -.22) : look.skin, dark = far ? shade(look.skinDark, -.22) : look.skinDark;
      const sleeve = ref ? (far ? look.shirtDark! : look.shirt!) : skin, sleeveDark = ref ? shade(look.shirtDark!, -.2) : dark;
      push((Sh.z + E.z) / 2 - .01, () => {
        limb(Sh, E, px(.068 * L, Sh.z), px(.052 * L, E.z), sleeve, sleeveDark, rim, ref ? .1 : .22);
        // Deltoid cap and biceps: rounder shoulders and upper arms for the fighters.
        if (!ref) { const m = mixS(Sh, E, .45); limb(mixS(Sh, E, .2), m, px(.074 * L, Sh.z), px(.068 * L, m.z), sleeve, sleeveDark, null, .28); ball(Sh, px(.082 * L * d.chest, Sh.z), sleeve, sleeveDark, .1); }
      });
      push((E.z + G.z) / 2 - .02, () => {
        const cuffAt = mixS(E, G, .62);
        limb(E, cuffAt, px(.052 * L, E.z), px(.044 * L, cuffAt.z), skin, dark, rim, .2);
        if (!ref) {
          // Hand wraps: white tape bands from the wrist toward the glove, then the glove cuff.
          const w1 = mixS(E, G, .56), w2 = mixS(E, G, .74);
          limb(w1, w2, px(.047, w1.z), px(.05, w2.z), far ? shade(look.cuff, -.3) : look.cuff, shade(look.cuff, -.45), null, .1);
          ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = Math.max(.8, px(.006, w1.z));
          const tx = -(G.y - E.y), ty = G.x - E.x, tl = Math.hypot(tx, ty) || 1;
          for (let k = 1; k <= 3; k++) { const q = mixS(w1, w2, k / 4), s = px(.046, q.z); ctx.beginPath(); ctx.moveTo(q.x - tx / tl * s, q.y - ty / tl * s); ctx.lineTo(q.x + tx / tl * s, q.y + ty / tl * s); ctx.stroke(); }
        }
      });
      push(G.z - .04, () => {
        const r = px(d.glove, G.z);
        if (ref) { ball(G, r, look.skin, look.skinDark, 0); return; }
        // Glove: a fist elongated along the forearm with a thumb, a cuff band, a lace strap and a specular highlight.
        const ang = Math.atan2(G.y - E.y, G.x - E.x), glove = far ? shade(look.glove, -.18) : look.glove;
        ctx.save(); ctx.translate(G.x, G.y); ctx.rotate(ang);
        const gg = ctx.createRadialGradient(-r * .1, -r * .45, r * .1, 0, 0, r * 1.25);
        gg.addColorStop(0, shade(glove, .28)); gg.addColorStop(.55, glove); gg.addColorStop(1, look.gloveDark);
        ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(r * .12, 0, r * 1.08, r * .95, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(glove, -.12); ctx.beginPath(); ctx.ellipse(-r * .05, r * .62, r * .5, r * .3, .35, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = Math.max(1, r * .08); ctx.beginPath(); ctx.ellipse(r * .12, 0, r * 1.08, r * .95, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = Math.max(1, r * .07); ctx.beginPath(); ctx.moveTo(-r * .55, -r * .9); ctx.lineTo(-r * .55, r * .9); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${far ? .1 : .34})`; ctx.beginPath(); ctx.ellipse(r * .35, -r * .5, r * .38, r * .17, -.15, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
    }
    };
    const spriteSet = sprites?.parts[b.id === 'ref' ? 'referee' : b.id] ? sprites : null;
    if (spriteSet) addSprites(b, S, push, spriteSet, zBase, sweat); else procedural();
    if (!ref) {
      const headS = S.head!, Rb = px(d.headR, headS.z), lS = S.lS!, rS = S.rS!;
      const top = Math.min(headS.y - Rb, S.lG!.y, S.rG!.y), x0 = Math.min(S.lA!.x, S.rA!.x, lS.x, rS.x) - px(.15, centre), x1 = Math.max(S.lA!.x, S.rA!.x, lS.x, rS.x) + px(.15, centre);
      boxes.push({ id: b.id as FighterId, x0: x0 / dpr, x1: x1 / dpr, y0: top / dpr, y1: Math.max(S.lT!.y, S.rT!.y) / dpr });
    }
  };
  /** A corner stool with a cornerman in team colours (a silhouette), shown between rounds. */
  const addCorner = (corner: typeof CORNERS[number], segs: Seg[], now: number, reduced: boolean) => {
    const dir = { x: Math.sign(corner.x), z: Math.sign(corner.z) }, base = { x: corner.x + dir.x * .3, z: corner.z + dir.z * .3 };
    const at = (dx: number, dy: number, dz: number) => proj(world(base.x + dx, dy, base.z + dz));
    const c0 = at(0, 0, 0); if (c0.z < NEAR) return;
    segs.push({ z: c0.z, draw: () => {
      const s = (m: number) => px(m, c0.z), sway = reduced ? 0 : Math.sin(now / 900 + corner.x) * .015;
      const stoolT = at(0, .62, 0), legL = at(-.2, 0, .2), legR = at(.2, 0, -.2);
      ctx.strokeStyle = '#2b2f37'; ctx.lineWidth = s(.035); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(stoolT.x, stoolT.y); ctx.lineTo(legL.x, legL.y); ctx.moveTo(stoolT.x, stoolT.y); ctx.lineTo(legR.x, legR.y); ctx.stroke();
      ctx.fillStyle = '#e9e4da'; ctx.beginPath(); ctx.ellipse(stoolT.x, stoolT.y, s(.22), s(.07), 0, 0, Math.PI * 2); ctx.fill();
      const man = { x: -dir.x * .5, z: 0 }; // the cornerman stands beside the stool, on the apron
      const foot = at(man.x, 0, man.z), hip = at(man.x + sway, .95, man.z), sh = at(man.x + sway * 2, 1.5, man.z), hd = at(man.x + sway * 2, 1.72, man.z);
      limb(hip, foot, s(.075), s(.055), '#1b1e24', '#0b0c0f', null, .1);
      limb(hip, sh, s(.11), s(.125), corner.color, shade(corner.color, -.55), null, .18);
      ball(hd, s(.11), '#b98564', '#6e4a36', .1);
      ctx.lineCap = 'butt';
    } });
  };

  // ---- arena --------------------------------------------------------------
  const camSide = (cx: number, cz: number, nx: number, nz: number) => (camWorld.x - cx) * nx + (camWorld.z - cz) * nz > 0;
  /** One crowd tier: a cylinder of `steps` slices of a cached panorama, with a gentle bob when the crowd is excited. */
  const drawTier = (g: CanvasRenderingContext2D, img: Canvas, radius: number, y0: number, y1: number, ax: Axis, alpha: number, bob: number, now: number) => {
    const steps = 72, outside = Math.hypot(camWorld.x, camWorld.z) > radius;
    g.save(); g.globalAlpha = alpha; g.imageSmoothingQuality = 'low';
    for (let i = 0; i < steps; i++) {
      const a0 = i / steps * Math.PI * 2, a1 = (i + 1) / steps * Math.PI * 2;
      const p0 = world(Math.cos(a0) * radius, y0, Math.sin(a0) * radius, ax), p1 = world(Math.cos(a1) * radius, y0, Math.sin(a1) * radius, ax);
      if (toCam(p0).z < 1 || toCam(p1).z < 1) continue;
      if (outside && p0.w < 0) continue; // a camera outside the stands never draws the near wall
      const b0 = proj(p0), b1 = proj(p1), t0 = proj({ ...p0, y: y1 }), t1 = proj({ ...p1, y: y1 });
      const x0 = Math.min(b0.x, b1.x), x1 = Math.max(b0.x, b1.x);
      if (x1 < -40 || x0 > C.W + 40 || x1 - x0 < .5) continue;
      const top = Math.min(t0.y, t1.y) + (bob ? Math.sin(now * .0042 + i * 1.7 + radius) * bob : 0), bottom = Math.max(b0.y, b1.y);
      g.drawImage(img, (i / steps) * img.width, 0, img.width / steps, img.height, x0 - .5, top, x1 - x0 + 1, bottom - top);
    }
    g.restore();
  };
  const drawBackdrop = (g: CanvasRenderingContext2D, mood: Mood, now: number, burst: number, reduced: boolean, el: number, az: number, dh: number, preset: CamPreset) => {
    const W = C.W, H = C.H;
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#030304'); sky.addColorStop(1, '#07080a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // Painted plate: a far backdrop that pans slower than the camera turns (parallax), scales slightly with zoom and fades out
    // when the camera climbs. Its floor line sits where the stands meet the arena floor behind the ring.
    const fade = 1 - clamp((el - .55) / .45);
    if (fade > .01) {
      const far = proj({ u: C.cu, y: -DROP, w: C.cw + dh + 8.6 }), yf = clamp(far.y, H * .2, H * .62);
      const zoomK = clamp(Math.log(PRESETS[preset].minDh / dh), -.6, .6), pw = plate.width, ph = plate.height;
      const sc = Math.max(W * 1.3 / pw, yf / (ph * .7)) * (1 + .1 * zoomK), dw = pw * sc, dhh = ph * sc;
      const off = ((((-az * dw / 1.75) % (2 * dw)) + 2 * dw) % (2 * dw)), t = W / 2 - dw / 2 + off, y0 = yf - dhh * .7;
      g.save(); g.globalAlpha = fade * (plateReal ? 1 : .9);
      for (let jx = -4; jx <= 4; jx++) {
        const x = t + jx * dw; if (x + dw < 0 || x > W) continue;
        if ((((jx % 2) + 2) % 2) === 1) { g.save(); g.translate(x + dw, 0); g.scale(-1, 1); g.drawImage(plate, 0, y0, dw, dhh); g.restore(); } else g.drawImage(plate, x, y0, dw, dhh);
      }
      g.restore();
      // Below the plate's floor line the hall floor is dark.
      const fl = g.createLinearGradient(0, yf, 0, yf + H * .12); fl.addColorStop(0, 'rgba(4,5,7,0)'); fl.addColorStop(1, 'rgba(4,5,7,.92)'); g.fillStyle = fl; g.fillRect(0, yf - 2, W, H);
    }
    // Procedural crowd in front of the plate: two tiers with parallax between them, bobbing when the arena is loud.
    const bobAmp = reduced || lod > 0 ? 0 : (.6 + 2.2 * burst) * dpr;
    if (lod < 2) drawTier(g, tierB, 10.4, -.2, 2.3, AX, clamp(mood.crowd * 2 + .4, .5, 1), bobAmp * .7, now);
    drawTier(g, tierA, 8.7, -DROP, 1.1, AX, 1, bobAmp, now);
    if (lod < 2) {
      for (let i = 0; i < 90; i++) {
        const a = hash(i * 3 + 1) * Math.PI * 2, hgt = -.5 + hash(i * 3 + 2) * 1.6;
        const c = toCam(world(Math.cos(a) * 8.5, hgt, Math.sin(a) * 8.5)); if (c.z < 1) continue;
        const q = screen(c), on = hash(i * 7 + Math.floor(now / 380)) > .6, flash = burst > 0 && hash(i * 11 + Math.floor(now / 80)) < burst * .5;
        if (!on && !flash) continue;
        g.fillStyle = flash ? 'rgba(255,255,255,.95)' : 'rgba(255,233,184,.6)';
        g.beginPath(); g.arc(q.x, q.y, (flash ? 2.4 : 1.1) * dpr, 0, Math.PI * 2); g.fill();
      }
    }
    // Arena floor inside the stands.
    const floor: P3[] = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; floor.push(world(Math.cos(a) * 8.45, -DROP, Math.sin(a) * 8.45)); }
    g.fillStyle = 'rgba(6,7,9,.93)'; path(g, polygon(floor)); g.fill();
  };
  /** Lighting truss over the ring (rails and can lights) with the lamp positions used by the beams. */
  const TRUSS_Y = 6.4, TRUSS_R = 4.7;
  const lamps: { x: number; z: number }[] = [];
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const t = -3.4 + i * 2.27; lamps.push({ x: t, z: s * TRUSS_R }, { x: s * TRUSS_R, z: t }); }
  const truss = (i: number): P3 => { const [x, z] = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const)[i]!; return world(x * TRUSS_R, TRUSS_Y, z * TRUSS_R); };

  /** The painted ring canvas on the floor: an n x n mesh of affine triangles (perspective-correct enough for a long lens). */
  const drawFloorTexture = (img: HTMLImageElement, n: number): boolean => {
    const half = POST + .05, grid: S2[][] = [];
    for (let i = 0; i <= n; i++) { const row: S2[] = []; for (let k = 0; k <= n; k++) { const q = proj(world(-half + 2 * half * k / n, 0, half - 2 * half * i / n)); if (q.z < NEAR * 2) return false; row.push(q); } grid.push(row); }
    const tw = img.naturalWidth, th = img.naturalHeight;
    const tri = (p0: S2, p1: S2, p2: S2, u0: number, v0: number, u1: number, v1: number, u2: number, v2: number) => {
      const t0x = u0 * tw, t0y = v0 * th, t1x = u1 * tw, t1y = v1 * th, t2x = u2 * tw, t2y = v2 * th, det = (t1x - t0x) * (t2y - t0y) - (t2x - t0x) * (t1y - t0y);
      if (Math.abs(det) < 1e-6) return;
      const a = ((p1.x - p0.x) * (t2y - t0y) - (p2.x - p0.x) * (t1y - t0y)) / det, c = ((p2.x - p0.x) * (t1x - t0x) - (p1.x - p0.x) * (t2x - t0x)) / det;
      const b = ((p1.y - p0.y) * (t2y - t0y) - (p2.y - p0.y) * (t1y - t0y)) / det, d = ((p2.y - p0.y) * (t1x - t0x) - (p1.y - p0.y) * (t2x - t0x)) / det;
      const e = p0.x - a * t0x - c * t0y, f = p0.y - b * t0x - d * t0y, cx = (p0.x + p1.x + p2.x) / 3, cy = (p0.y + p1.y + p2.y) / 3;
      // Grow the clip slightly so neighbouring triangles overlap and no seam shows.
      const grow = (p: S2) => { const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * .8, y: p.y + dy / l * .8 }; };
      const g0 = grow(p0), g1 = grow(p1), g2 = grow(p2), sx = Math.max(0, Math.floor(Math.min(t0x, t1x, t2x)) - 1), sy = Math.max(0, Math.floor(Math.min(t0y, t1y, t2y)) - 1), sw = Math.min(tw - sx, Math.ceil(Math.max(t0x, t1x, t2x)) - sx + 2), sh = Math.min(th - sy, Math.ceil(Math.max(t0y, t1y, t2y)) - sy + 2);
      ctx.save(); ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath(); ctx.clip(); ctx.transform(a, b, c, d, e, f); ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh); ctx.restore();
    };
    ctx.save(); ctx.imageSmoothingQuality = 'low'; ctx.globalAlpha = .96;
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const p00 = grid[i]![k]!, p01 = grid[i]![k + 1]!, p10 = grid[i + 1]![k]!, p11 = grid[i + 1]![k + 1]!, u0 = k / n, u1 = (k + 1) / n, v0 = i / n, v1 = (i + 1) / n;
      tri(p00, p01, p11, u0, v0, u1, v0, u1, v1); tri(p00, p11, p10, u0, v0, u1, v1, u0, v1);
    }
    ctx.restore();
    return true;
  };
  const drawRing = (mood: Mood, depth: number, pass: 'back' | 'front', now: number, reduced: boolean) => {
    const posts = CORNERS.map(c => ({ ...c, p: world(c.x, 0, c.z) }));
    const sides = [[0, 3], [3, 1], [1, 2], [2, 0]].map(([a, b]) => [posts[a!]!, posts[b!]!] as const);
    if (pass === 'back') {
      // LED boards around the apron: only the faces turned toward the camera, scrolling slowly.
      const scroll = reduced ? 0 : (now / 1000) * .35;
      const faces = [{ a: [-BOARD, -BOARD], b: [BOARD, -BOARD], n: [0, 1] }, { a: [BOARD, -BOARD], b: [BOARD, BOARD], n: [-1, 0] }, { a: [BOARD, BOARD], b: [-BOARD, BOARD], n: [0, -1] }, { a: [-BOARD, BOARD], b: [-BOARD, -BOARD], n: [1, 0] }] as const;
      for (const f of faces) {
        if (!camSide(f.a[0], f.a[1], f.n[0], f.n[1])) continue;
        const bl = proj(world(f.a[0], -DROP, f.a[1])), br = proj(world(f.b[0], -DROP, f.b[1])), tl = proj(world(f.a[0], -DROP + .85, f.a[1])), tr = proj(world(f.b[0], -DROP + .85, f.b[1]));
        if (bl.z < NEAR || br.z < NEAR || !onScreen([bl, br, tl, tr])) continue;
        ctx.save(); ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y); ctx.closePath(); ctx.clip();
        ctx.fillStyle = '#07090c'; ctx.fill();
        const len = 2 * BOARD, seg = LED_TILE_M, n = Math.ceil(len / seg) + 1;
        for (let k = 0; k < n; k++) {
          const s0 = k * seg - ((scroll % seg) + seg) % seg, t0 = s0 / len, t1 = (s0 + seg) / len;
          // Perspective: project the segment corners from world space for accuracy.
          const wp = (t: number, y: number) => proj(world(f.a[0] + (f.b[0] - f.a[0]) * t, y, f.a[1] + (f.b[1] - f.a[1]) * t));
          quadImage(ctx, led, 0, led.width, wp(t0, -DROP + .85), wp(t1, -DROP + .85), wp(t0, -DROP));
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = Math.max(1, px(.02, bl.z)); ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.stroke();
        const glowTop = ctx.createLinearGradient(0, tl.y, 0, tl.y - px(.5, tl.z)); glowTop.addColorStop(0, 'rgba(255,255,255,.07)'); glowTop.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = glowTop;
        ctx.fillRect(Math.min(tl.x, tr.x), tl.y - px(.5, tl.z), Math.abs(tr.x - tl.x), px(.5, tl.z));
      }
      // Apron skirt: dark cloth with pleats, team piping and a lighter band at the canvas edge.
      const ap = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({ x: x! * APRON, z: z! * APRON }));
      for (let i = 0; i < 4; i++) {
        const a = ap[i]!, b = ap[(i + 1) % 4]!, mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        const faceOut = camSide(mid.x, mid.z, Math.sign(mid.x) * (Math.abs(mid.x) > Math.abs(mid.z) ? 1 : 0), Math.sign(mid.z) * (Math.abs(mid.z) >= Math.abs(mid.x) ? 1 : 0));
        const apronImg = sprites?.apron, out = { x: Math.abs(mid.x) > Math.abs(mid.z) ? Math.sign(mid.x) : 0, z: Math.abs(mid.z) >= Math.abs(mid.x) ? Math.sign(mid.z) : 0 };
        if (apronImg) {
          if (!camSide(mid.x, mid.z, out.x, out.z)) continue; // only the faces turned toward the camera hang in view
          // Painted skirt strip, four perspective segments per side.
          const sh = apronImg.naturalHeight, sw = apronImg.naturalWidth / 4, pr = (t: number, y: number) => proj(world(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t));
          if (pr(0, 0).z > NEAR && pr(1, 0).z > NEAR) { for (let k = 0; k < 4; k++) quadImage(ctx, apronImg, k * sw, sw, pr(k / 4, 0), pr((k + 1) / 4, 0), pr(k / 4, -DROP)); void sh; }
          continue;
        }
        ctx.fillStyle = faceOut ? '#0b0d11' : '#12151b'; path(ctx, polygon([world(a.x, 0, a.z), world(b.x, 0, b.z), world(b.x, -DROP, b.z), world(a.x, -DROP, a.z)])); ctx.fill();
        ctx.fillStyle = '#151922'; path(ctx, polygon([world(a.x, -.12, a.z), world(b.x, -.12, b.z), world(b.x, -.7, b.z), world(a.x, -.7, a.z)])); ctx.fill();
        // Pleats.
        ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
        for (let k = 1; k < 18; k++) { const t = k / 18, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; segment(world(x, -.12, z), world(x, -DROP + .05, z)); }
        // Piping: orange on the KOR half and cyan on the AYAZ half of the long way round, white at the top edge.
        for (let k = 0; k < 2; k++) {
          const m = (t: number) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }), p0 = m(k ? .55 : .05), p1 = m(k ? .95 : .45);
          ctx.fillStyle = mood.led[k]!; ctx.globalAlpha = .8;
          path(ctx, polygon([world(p0.x, -.37, p0.z), world(p1.x, -.37, p1.z), world(p1.x, -.43, p1.z), world(p0.x, -.43, p0.z)])); ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = 'rgba(233,228,218,.55)'; ctx.lineWidth = Math.max(1, px(.025, 8)); segment(world(a.x, -.03, a.z), world(b.x, -.03, b.z));
      }
      ctx.fillStyle = '#10131a'; path(ctx, polygon(ap.map(p => world(p.x, 0, p.z)))); ctx.fill();
      // Ring canvas: dark weave with a lighter border, corner colour wedges, and the readable logo.
      const canvasPts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => world(x! * (POST + .05), 0, z! * (POST + .05)));
      ctx.fillStyle = '#1c2029'; path(ctx, polygon(canvasPts)); ctx.fill();
      const texture = sprites?.canvas, textured = !!texture && lod < 2 && drawFloorTexture(texture, lod === 0 ? 6 : 4);
      if (textured) { ctx.fillStyle = 'rgba(8,10,18,.6)'; path(ctx, polygon(canvasPts)); ctx.fill(); } // the painted canvas is pale: pull it down into the arena's light
      if (!textured) { ctx.strokeStyle = 'rgba(233,228,218,.07)'; ctx.lineWidth = 1; for (let m = -7; m <= 7; m++) { const t = m * .5; segment(world(t, 0, -POST), world(t, 0, POST)); segment(world(-POST, 0, t), world(POST, 0, t)); } }
      const wedge = (cx: number, cz: number, col: string, a: number) => { const sx = Math.sign(cx), sz = Math.sign(cz), k = 1.7; ctx.fillStyle = col; ctx.globalAlpha = a; path(ctx, polygon([world(cx, 0, cz), world(cx - sx * k, 0, cz), world(cx, 0, cz - sz * k)])); ctx.fill(); ctx.globalAlpha = 1; };
      wedge(-POST, POST, TEAM.kor.color, .3); wedge(POST, -POST, TEAM.ayaz.color, .3); wedge(-POST, -POST, '#e9e4da', .08); wedge(POST, POST, '#e9e4da', .08);
      const ring = (r: number, col: string, w: number) => { const pts: P3[] = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; pts.push(world(Math.cos(a) * r, 0, Math.sin(a) * r)); } const s = polygon(pts); if (s.length > 2) { path(ctx, s); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); } };
      if (!textured) { ring(2.9, 'rgba(233,228,218,.14)', Math.max(1.5, px(.03, 8))); ring(2.15, 'rgba(233,228,218,.08)', Math.max(1, px(.02, 8))); }
      const center = proj(world(0, 0, 0)), edge = proj(world(3, 0, 0)), r = Math.max(10, Math.abs(edge.x - center.x));
      const pool = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, r * 1.15);
      pool.addColorStop(0, `rgba(255,236,204,${mood.pool})`); pool.addColorStop(.55, `rgba(255,236,204,${mood.pool * .45})`); pool.addColorStop(1, 'rgba(255,236,204,0)');
      ctx.save(); ctx.fillStyle = pool; path(ctx, polygon([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => world(x! * POST, 0, z! * POST)))); ctx.fill();
      const o = proj(world(0, 0, 0)), ex = proj(world(1, 0, 0)), ez = proj(world(0, 0, 1));
      if (o.z > NEAR && ex.z > NEAR && ez.z > NEAR) {
        const a = ex.x - o.x, b = ex.y - o.y, c = ez.x - o.x, d = ez.y - o.y;
        ctx.setTransform(a / 100, b / 100, c / 100, d / 100, o.x, o.y);
        // Keep the floor logo readable from whichever side the camera stands.
        if (a * d - b * c < 0) ctx.scale(-1, 1);
        if (d < 0) ctx.rotate(Math.PI);
        ctx.strokeStyle = 'rgba(233,228,218,.16)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(233,228,218,.2)'; ctx.font = '900 62px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SOLLISH', 0, -6);
        ctx.fillStyle = 'rgba(233,228,218,.12)'; ctx.font = '700 17px ui-sans-serif, system-ui, sans-serif'; ctx.fillText(TXT.floor, 0, 40);
      }
      ctx.restore();
    }
    ctx.lineCap = 'round';
    // Ropes: four, with a soft under-stroke and a highlight; the near side is drawn translucent so it never hides the fight.
    for (const [a, b] of sides) {
      const mid = toCam({ u: (a.p.u + b.p.u) / 2, y: .8, w: (a.p.w + b.p.w) / 2 }).z, front = mid < depth;
      if ((pass === 'front') !== front) continue;
      ROPES.forEach((h, k) => {
        const wd = Math.max(1, (front ? .024 : .036) * C.F / Math.max(1, mid));
        ctx.strokeStyle = front ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.45)'; ctx.lineWidth = wd * 1.5; segment({ ...a.p, y: h - .008 }, { ...b.p, y: h - .008 });
        ctx.strokeStyle = front ? ROPE_COLORS[k]! + '38' : ROPE_COLORS[k]! + 'dd'; ctx.lineWidth = wd; segment({ ...a.p, y: h }, { ...b.p, y: h });
        if (!front) { ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = Math.max(.8, wd * .3); segment({ ...a.p, y: h + .008 }, { ...b.p, y: h + .008 }); }
      });
      if (!front) { ctx.strokeStyle = 'rgba(233,228,218,.5)'; ctx.lineWidth = Math.max(1, .012 * C.F / Math.max(1, mid)); for (const t of [.33, .67]) { const p = { u: a.p.u + (b.p.u - a.p.u) * t, w: a.p.w + (b.p.w - a.p.w) * t }; segment({ u: p.u, y: ROPES[0]!, w: p.w }, { u: p.u, y: ROPES[3]!, w: p.w }); } }
    }
    // Padded corner posts with turnbuckle pads in the corner colours.
    for (const c of posts) {
      const z = toCam({ ...c.p, y: .7 }).z, front = z < depth;
      if ((pass === 'front') !== front || z < NEAR) continue;
      const s = C.F / z, b = proj({ ...c.p, y: 0 }), t = proj({ ...c.p, y: POST_TOP }), pt = proj({ ...c.p, y: POST_TOP - .05 }), pb = proj({ ...c.p, y: .3 });
      if (c.team) { const gl = ctx.createRadialGradient(b.x, (t.y + b.y) / 2, 0, b.x, (t.y + b.y) / 2, .9 * s); gl.addColorStop(0, c.color + '55'); gl.addColorStop(1, c.color + '00'); ctx.fillStyle = gl; ctx.fillRect(b.x - .9 * s, t.y - .5 * s, 1.8 * s, 2 * s); }
      ctx.strokeStyle = '#2a2e36'; ctx.lineWidth = Math.max(1, .08 * s); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.strokeStyle = shade(c.color, -.35); ctx.lineWidth = Math.max(2.5, .2 * s); ctx.beginPath(); ctx.moveTo(pb.x, pb.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      ctx.strokeStyle = c.color; ctx.lineWidth = Math.max(2, .15 * s); ctx.beginPath(); ctx.moveTo(pb.x, pb.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = Math.max(1, .035 * s); ctx.beginPath(); ctx.moveTo(pb.x - .04 * s, pb.y); ctx.lineTo(pt.x - .04 * s, pt.y); ctx.stroke();
      ROPES.forEach(h => { const q = proj({ ...c.p, y: h }); ctx.fillStyle = shade(c.color, -.2); ctx.beginPath(); ctx.ellipse(q.x, q.y, .085 * s, .05 * s, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = '#d9d3c7'; ctx.beginPath(); ctx.arc(t.x, t.y, Math.max(1.5, .08 * s), 0, Math.PI * 2); ctx.fill();
    }
  };
  /** Truss, can lights and the light cones onto the ring. */
  const drawBeams = (mood: Mood, now: number, reduced: boolean) => {
    if (lod > 0) {
      const pts: { x: number; y: number }[] = [];
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) for (const [r, y] of [[3, 5.5], [3.4, 0]] as const) { const c = toCam(world(x * r, y, z * r)); if (c.z > NEAR) pts.push(screen(c)); }
      if (pts.length < 3) return;
      const hl = hull(pts), top = Math.min(...hl.map(p => p.y)), bottom = Math.max(...hl.map(p => p.y)), grad = ctx.createLinearGradient(0, Math.max(top, -C.H), 0, bottom);
      grad.addColorStop(0, mood.beam + (mood.beamA * 1.6).toFixed(3) + ')'); grad.addColorStop(1, mood.beam + (mood.beamA * .25).toFixed(3) + ')');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = grad; path(ctx, hl); ctx.fill(); ctx.restore();
      return;
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // Truss rails.
    const corner = (i: number) => proj(truss(i));
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(70,76,88,.85)'; ctx.lineWidth = Math.max(1.5, px(.08, 12)); ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const a = corner(i), b = corner((i + 1) % 4); if (a.z > NEAR && b.z > NEAR) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
    ctx.globalCompositeOperation = 'lighter';
    const flick = reduced ? 1 : .94 + .06 * Math.sin(now / 430);
    lamps.forEach((l, i) => {
      const lp = proj(world(l.x, TRUSS_Y - .15, l.z)); if (lp.z < NEAR) return;
      const tgt = world(l.x * .22, 0, l.z * .22), foot = proj(tgt), rr = px(1.05, foot.z);
      // Cone: narrow at the lamp, wide on the canvas; a gradient fades it out toward the lamp end.
      const dx = foot.x - lp.x, dy = foot.y - lp.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, w0 = px(.09, lp.z);
      if (!onScreen([lp, foot])) return;
      const g = ctx.createLinearGradient(lp.x, lp.y, foot.x, foot.y), a = mood.beamA * .85 * flick, col = i % 2 ? '255,226,176' : '255,238,208';
      g.addColorStop(0, `rgba(${col},${(a * .25).toFixed(3)})`); g.addColorStop(.7, `rgba(${col},${(a * .55).toFixed(3)})`); g.addColorStop(1, `rgba(${col},${(a * .9).toFixed(3)})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(lp.x + nx * w0, lp.y + ny * w0); ctx.lineTo(foot.x + nx * rr, foot.y + ny * rr * .35); ctx.lineTo(foot.x - nx * rr, foot.y - ny * rr * .35); ctx.lineTo(lp.x - nx * w0, lp.y - ny * w0); ctx.closePath(); ctx.fill();
      const gs = px(.5, lp.z); ctx.globalAlpha = .6 * flick; ctx.drawImage(glowWarm, lp.x - gs, lp.y - gs, gs * 2, gs * 2); ctx.globalAlpha = 1;
    });
    // Team washes on the stands side and a haze bloom over the ring.
    const hz = proj(world(0, 2.4, 0)); if (hz.z > NEAR) { const hs = px(5.5, hz.z); ctx.globalAlpha = clamp(mood.beamA * 1.1); ctx.drawImage(glowWarm, hz.x - hs, hz.y - hs, hs * 2, hs * 2); ctx.globalAlpha = 1; }
    for (const [c, img] of [[CORNERS[0]!, glowOrange], [CORNERS[1]!, glowCyan]] as const) { const q = proj(world(c.x, 1.4, c.z)); if (q.z < NEAR) continue; const s = px(1.8, q.z); ctx.globalAlpha = .3; ctx.drawImage(img, q.x - s, q.y - s, s * 2, s * 2); ctx.globalAlpha = 1; }
    ctx.restore();
  };

  // ---- overhead tactical: engine millimetres --------------------------------------------------
  const tactical = (frames: RingReplay['frames'], events: RingReplay['events'], tick: number, n: RingFrame) => {
    const W = canvas.width, H = canvas.height, s = Math.min(W, H) * .94 / ((POST + .25) * 2), cx = W / 2, cy = H / 2;
    const Q = (x: number, z: number) => ({ x: cx + x / 1000 * s, y: cy + z / 1000 * s });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#15171b'; ctx.fillRect(cx - APRON * s, cy - APRON * s, APRON * 2 * s, APRON * 2 * s);
    ctx.fillStyle = '#1f2329'; ctx.fillRect(cx - POST * s, cy - POST * s, POST * 2 * s, POST * 2 * s);
    ctx.strokeStyle = 'rgba(233,228,218,.06)'; ctx.lineWidth = 1;
    for (let m = -3; m <= 3; m++) { ctx.beginPath(); ctx.moveTo(cx + m * s, cy - POST * s); ctx.lineTo(cx + m * s, cy + POST * s); ctx.moveTo(cx - POST * s, cy + m * s); ctx.lineTo(cx + POST * s, cy + m * s); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(201,195,184,.8)'; ctx.lineWidth = Math.max(2, .04 * s); ctx.strokeRect(cx - POST * s, cy - POST * s, POST * 2 * s, POST * 2 * s);
    for (const c of CORNERS) { ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(cx + c.x * s, cy + c.z * s, .13 * s, 0, Math.PI * 2); ctx.fill(); }
    const i = Math.min(frames.length - 1, Math.floor(tick)), t = tick - i, f0 = frames[i]!, f1 = frames[Math.min(frames.length - 1, i + 1)]!;
    for (const id of ['kor', 'ayaz'] as const) {
      ctx.strokeStyle = `rgba(${TEAM[id].rgb},.35)`; ctx.lineWidth = Math.max(1, .03 * s); ctx.beginPath();
      for (let k = Math.max(0, i - 80); k <= i; k += 2) { const q = Q(frames[k]![id].x, frames[k]![id].z); if (k === Math.max(0, i - 80)) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }
    for (const e of events) {
      if (e.type !== 'hit' && e.type !== 'block') continue;
      const age = (tick - e.tick) * TICK_MS; if (age < 0 || age > 900) continue;
      const tf = frames[e.tick]![e.target], q = Q(tf.x, tf.z), k = age / 900;
      ctx.strokeStyle = e.type === 'block' ? `rgba(233,228,218,${1 - k})` : `rgba(${TEAM[e.actor].rgb},${1 - k})`;
      ctx.lineWidth = Math.max(1.5, .03 * s); ctx.beginPath(); ctx.arc(q.x, q.y, (.2 + k * .5) * s, 0, Math.PI * 2); ctx.stroke();
    }
    const ref = Q(f0.referee.x + (f1.referee.x - f0.referee.x) * t, f0.referee.z + (f1.referee.z - f0.referee.z) * t);
    ctx.fillStyle = '#e9e4da'; ctx.beginPath(); ctx.arc(ref.x, ref.y, .2 * s, 0, Math.PI * 2); ctx.fill();
    boxes.length = 0;
    for (const id of ['kor', 'ayaz'] as const) {
      const a = f0[id], b = f1[id], q = Q(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), yaw = a.yawMilliRad / 1000;
      ctx.fillStyle = id === 'kor' ? '#3a2219' : '#16303a'; ctx.strokeStyle = TEAM[id].color; ctx.lineWidth = Math.max(2, .035 * s);
      ctx.beginPath(); ctx.arc(q.x, q.y, .34 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + Math.sin(yaw) * .46 * s, q.y + Math.cos(yaw) * .46 * s); ctx.stroke();
      for (const g of [n[id].j.lG, n[id].j.rG, n[id].j.lA, n[id].j.rA]) { const gq = Q(g.x * 1000, g.z * 1000); ctx.fillStyle = TEAM[id].color; ctx.beginPath(); ctx.arc(gq.x, gq.y, (g.y > .3 ? .09 : .06) * s, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#e9e4da'; ctx.font = `600 ${Math.round(12 * dpr)}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(TEAM[id].name + (n[id].down ? ` · ${TXT.down}` : ''), q.x, q.y - .52 * s);
      boxes.push({ id, x0: (q.x - .45 * s) / dpr, x1: (q.x + .45 * s) / dpr, y0: (q.y - .6 * s) / dpr, y1: (q.y + .45 * s) / dpr });
    }
  };

  // ---- one view of the fight (live or replay) --------------------------------
  const drawView = (replay: RingReplay, timeMs: number, phase: BroadcastProps['phase'], view: ViewState, preset: CamPreset, now: number, dt: number, reduced: boolean, winner: FighterId | 'draw' | null, clock: number, isReplay: boolean) => {
    const W = canvas.width, H = canvas.height, tick = phase === 'fighting' ? timeMs / TICK_MS : phase === 'finished' ? replay.frames.length - 1 : 0;
    const fi = Math.min(replay.frames.length - 1, Math.max(0, Math.floor(tick)));
    const n = ringFrame(replay, { timeMs, phase, clockMs: clock, winner });
    view.raw = fightAxis(replay.frames[fi]!, view.raw);
    const rig = view.rig, P0 = PRESETS[preset], vfov = P0.vfov * Math.PI / 180, F = H / 2 / Math.tan(vfov / 2);
    const kP = n.kor.j.pelvis, aP = n.ayaz.j.pelvis;
    // Framing: the two fighters; during a count, the fighter on the canvas and the referee over him.
    const downB = n.knockdown ? n[n.knockdown.fighter] : null, f0 = downB ? downB.j.pelvis : kP, f1 = downB ? n.ref.j.pelvis : aP;
    // Exchanges in the last ~0.6 s dolly the camera in a few percent; clinches and knockdowns back it off.
    let recent = 0; for (const e of replay.events) { if (e.tick > tick) break; if ((e.type === 'strike' || e.type === 'hit') && tick - e.tick <= 12) recent += e.type === 'hit' ? 1 : .5; }
    const fr = replay.frames[fi]!, wide = n.knockdown || fr.kor.action === 'clinch' || fr.ayaz.action === 'clinch' ? 1 : 0;
    const out = rig.update({ dt, preset, mid: { x: (f0.x + f1.x) / 2, z: (f0.z + f1.z) / 2 }, spread: Math.hypot(f0.x - f1.x, f0.z - f1.z), pairAngle: Math.atan2(view.raw.rz, view.raw.rx), F, W, H, energy: phase === 'fighting' ? clamp(recent / 3) : 0, wide, bodies: [{ x: kP.x, z: kP.z }, { x: aP.x, z: aP.z }], reduced, clock: now / 1000 });
    AX = out.ax; C = { cu: out.cu, ch: out.ch, cw: out.cw, cos: out.cos, sin: out.sin, F, W, H };
    camWorld = rig.position(out);
    const kU = W3(kP), aU = W3(aP);
    let sx = 0, sy = 0;
    if (!reduced && rig.shake > .01) { sx = (hash(Math.floor(now / 16)) - .5) * rig.shake * 16 * dpr; sy = (hash(Math.floor(now / 16) + 9) - .5) * rig.shake * 11 * dpr; }

    const kd = n.knockdown, finishedWinner = phase === 'finished' && (winner === 'kor' || winner === 'ayaz') ? winner : null;
    const mood: Mood = finishedWinner ? { beam: finishedWinner === 'kor' ? 'rgba(255,120,70,' : 'rgba(90,205,240,', beamA: .045, pool: .24, crowd: .42, led: [TEAM[finishedWinner].color, TEAM[finishedWinner].color] }
      : phase === 'idle' ? { beam: 'rgba(255,241,214,', beamA: .035, pool: .28, crowd: .34, led: ['#ff5a1f', '#4cc9f0'] }
      : kd ? { beam: 'rgba(255,255,255,', beamA: .04, pool: .32, crowd: .42, led: ['#e9e4da', '#e9e4da'] }
      : { beam: 'rgba(255,241,214,', beamA: .024, pool: .26, crowd: .24, led: ['#ff5a1f', '#4cc9f0'] };

    const BW = Math.ceil(W / 2), BH = Math.ceil(H / 2);
    if (bg.width !== BW || bg.height !== BH) { bg.width = BW; bg.height = BH; }
    bctx.setTransform(.5, 0, 0, .5, 0, 0);
    const big = n.impacts.some(i => i.type === 'hit' && i.damage >= 40 && i.ageMs < 400);
    drawBackdrop(bctx, mood, now, reduced ? 0 : kd ? Math.max(0, 1 - kd.ageMs / 2500) : big ? .35 : 0, reduced, out.el, out.az, out.dh, preset);
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    ctx.drawImage(bg, 0, 0, BW, BH, -Math.abs(sx) - 2, -Math.abs(sy) - 2, W + Math.abs(sx) * 2 + 4, H + Math.abs(sy) * 2 + 4);
    const depth = (toCam(kU).z + toCam(aU).z) / 2;
    drawRing(mood, depth, 'back', now, reduced);
    drawBeams(mood, now, reduced);

    if (!isReplay) boxes.length = 0;
    const segs: Seg[] = [];
    // A referee between the camera and a fighter turns see-through so he never hides a punch or a fall.
    const rP = W3(n.ref.j.pelvis), rZ = toCam(rP).z, refBlocking = [kU, aU].some(f => rZ < toCam(f).z - .3 && Math.abs(rP.u - f.u) < .85);
    // Whole bodies are ordered by depth with hysteresis, so a pair of close fighters never swaps order from frame to frame.
    const order = bodyOrder[isReplay ? 1 : 0], zs: Record<string, number> = { ref: rZ, kor: toCam(kU).z, ayaz: toCam(aU).z };
    if (order.length === 0) order.push(...['ref', 'kor', 'ayaz'].sort((x, y) => zs[x]! - zs[y]!));
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < order.length - 1; i++) if (zs[order[i + 1]!]! < zs[order[i]!]! - .15) { const t = order[i]!; order[i] = order[i + 1]!; order[i + 1] = t; }
    const sorted = Object.values(zs).sort((x, y) => x - y), zBody: Record<string, number> = {}; order.forEach((id, k) => { zBody[id] = sorted[k]! + k * .01; });
    addBody(n.ref, segs, refBlocking ? .3 : 1, 0, 0, zBody.ref);
    const hurt = (id: FighterId) => { let h = 0; for (const i of n.impacts) if (i.type === 'hit' && i.target === id && i.part === 'head') h = Math.max(h, clamp(1 - i.ageMs / 1100) * clamp(i.damage / 40)); return h; };
    addBody(n.kor, segs, 1, clamp(1 - n.kor.stamina / 1000), hurt('kor'), zBody.kor);
    addBody(n.ayaz, segs, 1, clamp(1 - n.ayaz.stamina / 1000), hurt('ayaz'), zBody.ayaz);
    if (phase !== 'fighting') for (const c of CORNERS) if (c.team) addCorner(c, segs, now, reduced);
    segs.sort((a, b) => b.z - a.z);
    for (const s of segs) { ctx.globalAlpha = 1; s.draw(); }
    ctx.globalAlpha = 1;

    // Strike trails: the arc of the striking glove or foot over the last ~110 ms (hooks curve, uppercuts rise, kicks sweep).
    for (const b of [n.kor, n.ayaz]) {
      const key = `${isReplay ? 'r' : 'l'}:${b.id}`, trail = (trails[key] ??= []);
      if (b.strike && b.strike.drive > .04) trail.push({ p: b.strike.point, t: now });
      while (trail.length && now - trail[0]!.t > (b.strike?.kick ? 150 : 110)) trail.shift();
      if (trail.length > 1 && !reduced) {
        const rgb = TEAM[b.id as FighterId].rgb, pts = trail.map(q => P(q.p));
        for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, c = pts[i]!, w = i / pts.length; ctx.strokeStyle = `rgba(${rgb},${(.42 * w).toFixed(3)})`; ctx.lineWidth = Math.max(1, px(b.dims.glove * (b.strike?.kick ? 2 : 1.5), c.z) * w); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
      }
    }
    drawRing(mood, depth, 'front', now, reduced);

    // Impacts: flash, shock ring, spikes, sweat spray; one callout per moment.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // One callout per kind of moment and target (the newest), and at most one at a time, so they never pile up.
    const newest = new Map<string, number>();
    for (const im of n.impacts) { const k = `${im.type}:${im.target}`, cur = newest.get(k); if (cur === undefined || im.ageMs < n.impacts[cur]!.ageMs) newest.set(k, n.impacts.indexOf(im)); }
    const shown = new Set([...newest.values()].sort((a, b) => n.impacts[a]!.ageMs - n.impacts[b]!.ageMs).slice(0, 1));
    for (const [idx, im] of n.impacts.entries()) {
      const p = P(im.at); if (p.z < NEAR) continue;
      const s = C.F / p.z, a = im.ageMs / 1100, rgb = im.type === 'block' ? '233,228,218' : TEAM[im.actor].rgb;
      if (im.type === 'hit' || im.type === 'block') {
        if (im.ageMs < 40 && im.type === 'hit' && !isReplay) { const heavy = clamp(im.damage / 45); rig.shake = Math.max(rig.shake, heavy * (im.part === 'head' ? 1 : .6)); if (im.damage >= 40 || im.counter) rig.kick = Math.max(rig.kick, .05 + .04 * heavy); }
        const t = im.ageMs / 1000, rr = (.05 + t * (im.type === 'hit' ? 1.1 : .6)) * s;
        if (im.type === 'hit' && t < .14) { const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, .3 * s); core.addColorStop(0, `rgba(255,252,240,${(1 - t / .14) * .95})`); core.addColorStop(.35, `rgba(${rgb},${(1 - t / .14) * .6})`); core.addColorStop(1, `rgba(${rgb},0)`); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = core; ctx.fillRect(p.x - .3 * s, p.y - .3 * s, .6 * s, .6 * s); ctx.restore(); }
        if (t < .45) { ctx.strokeStyle = `rgba(${rgb},${(1 - t / .45) * .9})`; ctx.lineWidth = Math.max(1.5, (1 - t / .45) * .04 * s); ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke(); }
        if (im.type === 'hit' && t < .2) {
          ctx.strokeStyle = `rgba(255,246,228,${1 - t / .2})`; ctx.lineWidth = Math.max(1, .016 * s);
          for (let i = 0; i < 10; i++) { const ang = hash(im.index * 31 + i) * Math.PI * 2, r0 = rr * 1.1, r1 = rr * (1.7 + hash(im.index + i)); ctx.beginPath(); ctx.moveTo(p.x + Math.cos(ang) * r0, p.y + Math.sin(ang) * r0); ctx.lineTo(p.x + Math.cos(ang) * r1, p.y + Math.sin(ang) * r1); ctx.stroke(); }
        }
        if (im.type === 'hit' && t < .7) {
          const drops = im.part === 'head' ? 12 : 6, att = n[im.actor], dir = { x: att.F.x, z: att.F.z };
          ctx.fillStyle = `rgba(220,235,245,${(1 - t / .7) * .8})`;
          for (let i = 0; i < drops; i++) { const sp = .6 + hash(im.index * 7 + i) * 1.6, lat = (hash(im.index * 13 + i) - .5) * 1.4, vy = .3 + hash(im.index * 17 + i) * 1.4; const q = P({ x: im.at.x + (dir.x * sp + att.L.x * lat) * t, y: im.at.y + vy * t - 4.9 * t * t, z: im.at.z + (dir.z * sp + att.L.z * lat) * t }); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(.8, .011 * s), 0, Math.PI * 2); ctx.fill(); }
        }
      }
      let label = '';
      if (im.type === 'hit') label = im.counter ? TXT.counter : im.combo >= 1 ? TXT.combo(im.combo + 1) : (isV5Kick(im.technique) ? (TXT.kicks as Record<string, string>)[im.technique] : (TXT.parts as Record<string, string>)[im.part ?? 'head']) ?? '';
      else if (im.type === 'block') label = TXT.parts.guard;
      else if (im.type === 'dodge') label = TXT.dodge;
      if (n.impacts.some(o => o.type === 'knockdown' && Math.abs(o.ageMs - im.ageMs) <= TICK_MS) && im.type !== 'knockdown') label = '';
      if (!label || a > .55 || !shown.has(idx)) continue;
      const fade = 1 - a / .55, size = Math.round(19 * dpr * (im.counter || im.combo >= 2 ? 1.25 : 1)), ly = p.y - (.4 + a * .3) * s;
      ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = `rgba(0,0,0,${(.55 * fade).toFixed(3)})`; ctx.fillText(label, p.x + 1.5 * dpr, ly + 1.5 * dpr);
      ctx.fillStyle = im.type === 'hit' ? `rgba(${rgb},${fade})` : `rgba(233,228,218,${fade * .95})`; ctx.fillText(label, p.x, ly);
    }
    return { n, sx, sy, depth };
  };

  // ---- overlays -------------------------------------------------------------
  let uiFont = '';
  const pickOverlay = (sel: NonNullable<BroadcastProps['selection']>, now: number, reduced: boolean) => {
    if (!uiFont) uiFont = getComputedStyle(document.body).fontFamily || 'ui-sans-serif, system-ui, sans-serif';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const b of boxes) {
      const team = TEAM[b.id], on = sel.selected === b.id, cx = (b.x0 + b.x1) / 2 * dpr, foot = b.y1 * dpr, w = Math.max(30 * dpr, (b.x1 - b.x0) * dpr);
      const pulse = reduced ? 0 : (now / 1500 + (b.id === 'ayaz' ? .5 : 0)) % 1;
      ctx.beginPath(); ctx.ellipse(cx, foot, w * .8, w * .24, 0, 0, Math.PI * 2);
      if (on) { ctx.fillStyle = `rgba(${team.rgb},.22)`; ctx.fill(); }
      ctx.lineWidth = (on ? 3.5 : 2) * dpr; ctx.strokeStyle = `rgba(${team.rgb},${on ? 1 : .75})`; ctx.stroke();
      if (!reduced) { ctx.beginPath(); ctx.ellipse(cx, foot, w * (.8 + .55 * pulse), w * (.24 + .16 * pulse), 0, 0, Math.PI * 2); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = `rgba(${team.rgb},${.6 * (1 - pulse)})`; ctx.stroke(); }
      const label = sel.labels[b.id]; if (!label) continue;
      ctx.font = `600 ${Math.round(15 * dpr)}px ${uiFont}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + 26 * dpr, th = 32 * dpr, x = cx - tw / 2, y = Math.max(8 * dpr, b.y0 * dpr - th - 12 * dpr);
      ctx.beginPath(); ctx.roundRect(x, y, tw, th, th / 2);
      ctx.fillStyle = on ? team.color : 'rgba(10,13,18,.84)'; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = team.color; ctx.stroke();
      ctx.fillStyle = on ? '#0a0d12' : '#f3f5f8'; ctx.fillText(label, cx, y + th / 2 + dpr);
    }
  };
  const banner = (text: string, sub: string, color: string, alpha: number, y = .2) => {
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(Math.min(W, H) * .11)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText(text, W / 2 + 3 * dpr, H * y + 3 * dpr);
    ctx.fillStyle = color; ctx.fillText(text, W / 2, H * y);
    if (sub) { ctx.font = `700 ${Math.round(Math.min(W, H) * .032)}px ui-sans-serif, system-ui, sans-serif`; ctx.fillStyle = 'rgba(233,228,218,.85)'; ctx.fillText(sub, W / 2, H * y + Math.min(W, H) * .085); }
    ctx.globalAlpha = 1;
  };
  const replayFrame = (label: string, progress: number) => {
    const W = canvas.width, H = canvas.height, bar = H * .085;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
    ctx.fillStyle = 'rgba(255,90,31,.95)'; ctx.fillRect(18 * dpr, bar + 14 * dpr, 92 * dpr, 24 * dpr);
    ctx.fillStyle = '#0b0d10'; ctx.font = `900 ${Math.round(12 * dpr)}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, 26 * dpr, bar + 26 * dpr);
    ctx.fillStyle = 'rgba(233,228,218,.25)'; ctx.fillRect(0, H - bar - 2 * dpr, W, 2 * dpr);
    ctx.fillStyle = 'rgba(233,228,218,.85)'; ctx.fillRect(0, H - bar - 2 * dpr, W * clamp(progress), 2 * dpr);
  };
  const grade = (flash: number) => {
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vig = ctx.createRadialGradient(W / 2, H * .45, Math.min(W, H) * .35, W / 2, H * .45, Math.max(W, H) * .75);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H); }
  };
  /** Best moment for a highlight: the knockdown blow, else the heaviest clean hit. */
  const moment = (events: RingReplay['events']) => {
    const kd = events.find(e => e.type === 'knockdown');
    if (kd) return kd.tick;
    let best: RingReplay['events'][number] | null = null;
    for (const e of events) if (e.type === 'hit' && (!best || e.damage > best.damage)) best = e;
    return best ? best.tick : null;
  };

  // ---- audio from committed events -------------------------------------------
  const playAudio = (replay: RingReplay, fromMs: number, toMs: number) => {
    if (!audio) return;
    const out: SparringEvent[] = [];
    for (const e of replay.events) {
      const t = e.tick * TICK_MS; if (t <= fromMs || t > toMs) continue;
      const base = { id: e.tick * 7 + (e.actor === 'kor' ? 1 : 2), tick: e.tick, actor: e.actor === 'kor' ? 'a' : 'b', target: e.target === 'kor' ? 'a' : 'b', attack: null, point: null, damage: Math.round(e.damage * 1.3), reason: null } as unknown as SparringEvent;
      const heavy = e.technique === 'cross' || e.technique === 'rearHook' || e.technique === 'uppercut' || isV5Kick(e.technique);
      const type = e.type === 'strike' ? (heavy ? 'attack' : null) : e.type === 'hit' ? (e.counter ? 'counter' : 'hit') : e.type === 'block' ? 'block' : e.type === 'knockdown' ? 'knockdown' : e.type === 'finish' ? 'knockout' : null;
      if (type) { out.push({ ...base, type } as SparringEvent); if (type === 'counter') out.push({ ...base, type: 'hit' } as SparringEvent); }
    }
    if (out.length) audio.events(out, Math.floor(toMs / TICK_MS));
  };

  // ---- main loop ------------------------------------------------------------
  const render = (now: number, force = false) => {
    if (!force) raf = requestAnimationFrame(t => render(t));
    if (disposed || (!force && (!visible || document.hidden))) return;
    const state = props(), reduced = state.reducedMotion; TXT = state.labels ?? DEFAULT_BROADCAST_LABELS;
    if (!force && now - last < (reduced ? 1000 / 30 : 1000 / 60) - 2) return;
    const dt = clamp((now - (lastNow || now)) / 1000, 0, .1); lastNow = now; last = now;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      // The viewer's camera: a new preset or reset key hands control back.
      if (state.camera !== lastPreset) { lastPreset = state.camera; if (live.rig.reset()) notify(false); }
      if (state.resetViewKey !== lastReset) { lastReset = state.resetViewKey; if (live.rig.reset()) notify(false); }
      const real = preview ?? (state.replay?.frames.length ? state.replay : null), replay = real ?? WARMUP, phase = real ? (seek !== null ? 'fighting' : state.phase) : 'idle';
      const key = `${state.fightId}:${phase}`;
      if (key !== live.key) { live.key = key; live.rig.snap(); live.raw = null; }
      const total = Math.max(TICK_MS, (replay.frames.length - 1) * TICK_MS);
      const elapsed = seek !== null ? seek : state.playbackPositionMs !== undefined ? clamp(state.playbackPositionMs, 0, state.durationMs) : state.startedAt !== null && Number.isFinite(state.startedAt) ? Math.max(0, now - state.startedAt) : 0;
      // Partial logs (plans still arriving) never run past their last committed frame.
      const realMs = phase === 'fighting' ? Math.min(elapsed, total) : phase === 'finished' ? total : 0;
      const winner = state.winner ?? (phase === 'finished' ? 'draw' : null);

      // Sound follows real time (never the hit-stop or replay clock).
      if (state.sound && !audio && !audioAbort.signal.aborted && audioKey !== 'loading') { audioKey = 'loading'; loadRingsideAudio(audioAbort.signal).then(a => { if (disposed) { a.dispose(); return; } audio = a; void a.resume().then(() => a.setEnabled(!!props().sound)); }).catch(() => { audioKey = 'failed'; }); }
      if (audio) { audio.setEnabled(!!state.sound); if (state.sound) { const fightKey = `${state.fightId}`; if (phase === 'fighting' && bellKey !== fightKey + ':start') { bellKey = fightKey + ':start'; audio.bell(1); audioMs = realMs; } if (phase === 'finished' && bellKey !== fightKey + ':end') { bellKey = fightKey + ':end'; audio.bell(3); } if (phase === 'fighting') { if (realMs < audioMs) audioMs = realMs; playAudio(replay, audioMs, realMs); audioMs = realMs; } } }

      if (state.camera === 'overhead') { tactical(replay.frames, replay.events, realMs / TICK_MS, ringFrame(replay, { timeMs: realMs, phase, clockMs: now, winner }, false)); finish(state); return; }
      const cam: CamPreset = state.camera === 'ringside' ? 'ringside' : 'broadcast';

      // Replays: the knockdown blow during the count, and the round's best moment after the bell.
      let replayWindow: { at: number; from: number; label: string; progress: number } | null = null;
      if (!reduced && phase === 'fighting') {
        const kd = replay.events.find(e => e.type === 'knockdown' && realMs >= e.tick * TICK_MS + 1300);
        if (kd) {
          // 1.5 s of the fight around the blow at half speed (3 s), then back to the live count.
          const t1 = kd.tick * TICK_MS, rise = replay.events.find(e => e.tick > kd.tick && (e.type === 'rise' || e.type === 'finish')), stop = Math.min(t1 + 1300 + 3000, rise ? rise.tick * TICK_MS - 400 : Infinity), from = t1 - 1000;
          if (realMs < stop) replayWindow = { from, at: from + (realMs - t1 - 1300) * .5, label: TXT.replay, progress: (realMs - t1 - 1300) / (stop - t1 - 1300) };
        }
      }
      if (!reduced && phase === 'finished' && state.startedAt !== null && state.playbackPositionMs === undefined) {
        const since = now - state.startedAt - state.durationMs, best = moment(replay.events);
        if (best !== null && since > 1600 && since < 1600 + 4750) { const t1 = best * TICK_MS, from = t1 - 1200; replayWindow = { from, at: from + (since - 1600) * .4, label: TXT.highlight, progress: (since - 1600) / 4750 }; }
      }
      if (replayWindow) {
        if (replayView.key !== `${state.fightId}:${replayWindow.from}`) { replayView.key = `${state.fightId}:${replayWindow.from}`; replayView.rig.snap(); replayView.raw = null; }
        const at = clamp(replayWindow.at, 0, total);
        drawView(replay, at, 'fighting', replayView, cam === 'ringside' ? 'broadcast' : 'ringside', now, dt * .45, reduced, null, at, true);
        grade(0); replayFrame(replayWindow.label, replayWindow.progress);
        finish(state); adapt(t0); return;
      }
      const display = reduced || phase !== 'fighting' ? realMs : hitStopTime(replay.events, realMs);
      const { n } = drawView(replay, display, phase, live, cam, now, dt, reduced, winner, phase === 'fighting' ? display : now, false);
      const kd = n.knockdown;
      grade(kd && !reduced && kd.ageMs < 200 ? (1 - kd.ageMs / 200) * .3 : 0);
      if (phase === 'idle' && state.selection) pickOverlay(state.selection, now, reduced);
      if (phase === 'fighting' && kd) {
        const countEvt = replay.events.filter(e => e.type === 'count' && e.tick * TICK_MS <= display).at(-1);
        if (kd.ageMs < 1300) banner(TXT.knockdown, TXT.knockdownSub(TEAM[kd.fighter === 'kor' ? 'ayaz' : 'kor'].name), TEAM[kd.fighter === 'kor' ? 'ayaz' : 'kor'].color, clamp(1 - Math.max(0, kd.ageMs - 900) / 400));
        else if (n.refCount > 0 && countEvt) { const age = display - countEvt.tick * TICK_MS; banner(String(n.refCount), TXT.count, '#e9e4da', clamp(1 - age / 900), .3); }
      }
      const fin = replay.events.find(e => e.type === 'finish' && e.tick * TICK_MS <= display);
      if (phase === 'fighting' && fin) banner(TXT.stoppage, TXT.stoppageSub(TEAM[fin.actor].name), TEAM[fin.actor].color, clamp((display - fin.tick * TICK_MS) / 300));
      const rise = replay.events.filter(e => e.type === 'rise' && e.tick * TICK_MS <= display).at(-1);
      const up = rise ? display - rise.tick * TICK_MS - 650 : -1;
      if (phase === 'fighting' && rise && up >= 0 && up < 1300) banner(TXT.rise, TXT.riseSub, '#e9e4da', clamp(1 - up / 1300), .3);
      finish(state); adapt(t0);
    } catch (error) {
      console.error('Ringside broadcast failed', error);
      disposed = true; cancelAnimationFrame(raf); state.onError?.();
    }
  };
  /** Adaptive detail from the measured JS cost of recent frames (a slow phone drops beams and crowd motion first). */
  const adapt = (t0: number) => {
    if (typeof performance === 'undefined') return;
    const cost = performance.now() - t0; costEma = costEma ? costEma * .92 + cost * .08 : cost; lodHold--;
    if (lodHold > 0) return;
    if (costEma > 11 && lod < 2) { lod++; lodHold = 90; } else if (costEma < 5 && lod > 0) { lod--; lodHold = 240; }
  };
  const finish = (state: BroadcastProps) => {
    canvas.style.cursor = drag?.engaged ? 'grabbing' : state.onSelectFighter && state.selection && state.phase === 'idle' ? 'pointer' : state.camera === 'overhead' ? 'default' : 'grab';
    if (!ready) { ready = true; canvas.dataset.renderer = 'canvas2d-25d'; state.onReady?.(); }
  };
  raf = requestAnimationFrame(t => render(t));
  // Development-only inspection hooks: force a frame, pin the fight clock, or preview a local fallback-plan round.
  if (process.env.NODE_ENV !== 'production') { const h = host as HTMLElement & { ringRender?: (now: number) => void; ringSeek?: (ms: number | null) => void; ringPreview?: (seed: string | null) => void; ringLod?: () => number; ringCamera?: () => { manual: boolean; az: number; el: number; zoom: number } }; h.ringCamera = () => ({ manual: live.rig.manual, ...live.rig.manualState }); h.ringRender = now => render(now, true); h.ringSeek = ms => { seek = ms; }; h.ringPreview = seed => { preview = seed ? simulateContactCombatV5(seed) : null; }; h.ringLod = () => lod; }
  return () => {
    disposed = true; audioAbort.abort(); audio?.dispose(); cancelAnimationFrame(raf); cancelPlate(); cancelSprites(); ro.disconnect(); io.disconnect();
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('dblclick', onDouble); canvas.remove();
  };
}
