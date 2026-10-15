/* Cezeri: Zamanın Çarkları — board geometry (pure TS, no DOM).

   The board is a hub plus 4 concentric rings of 12 slices in a square "board space" of 1000 × 1000 units
   (centre 500, 500). Slice s of every ring sits at the clock angle s · 30° (slice 0 at twelve o'clock,
   clockwise), so spoke s is the radial line at that angle and passes through the centre of slice s of rings
   0..3, exactly like the engine (board[ring][slice], spoke s = slice s of rings 0..3).

   Everything the art draws (wedge plates, gear teeth, spoke lines, symbol boxes) and everything the FX canvas
   aims at comes from these functions, so the SVG, the HTML cell layers and the canvas always agree. For pixel
   work call cezeriBoardLayout(sizePx), which scales the same numbers. Rings rotate by stops: one stop is one
   slice (30°). Directions alternate (ring 0 clockwise, ring 1 counter-clockwise, ...) as meshing gears do. The
   settle keyframes (ratchet / escapement ticks with an overshoot) are generated here so the ring layer and the
   counter-rotation of its upright symbols use the exact same curve. */

export const CZ_UNITS = 1000;
export const CZ_C = 500;
export const CZ_SLICES = 12;
export const CZ_RINGS = 4;
export const CZ_SLICE_DEG = 360 / CZ_SLICES;

/** Symbol box / inscribed-circle diameter (the art's aura may spill over the plate edge). */
export const CZ_SYMBOL_FILL = 1.22;
/** Hub disc radius and the boundaries between hub | ring 0 | ring 1 | ring 2 | ring 3 | rim. */
export const CZ_HUB_R = 86;
export const CZ_BOUNDS: readonly number[] = [94, 208, 300, 392, 482];
/** Outer radius of the spoke lamp rim that belongs to the board (outside ring 3). */
export const CZ_RIM_R = 500;
/** Plate inset from a boundary (the tooth channel is 2 × this wide). */
export const CZ_GAP = 5;
/** Tooth pitch per boundary (degrees). Hub ↔ ring 0 uses a coarser pitch. */
export const CZ_TOOTH_PITCH: readonly number[] = [15, 7.5, 7.5, 7.5, 7.5];
export const CZ_TOOTH_DEPTH = 7;

export interface CzPoint { x: number; y: number }
export interface CzBand { ring: number; r0: number; r1: number; inner: number; outer: number; mid: number }

const rad = (deg: number) => (deg * Math.PI) / 180;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Percentage string, rounded so server and client render the same text. */
export const czPct = (n: number) => `${Math.round(n * 10000) / 10000}%`;

/** Clock angle (degrees, 0 = up, clockwise) of the centre of slice `slice`. */
export const sliceAngle = (slice: number) => (((slice % CZ_SLICES) + CZ_SLICES) % CZ_SLICES) * CZ_SLICE_DEG;
/** Point at clock angle `deg` and radius `r` in board space. */
export function polar(r: number, deg: number, c = CZ_C): CzPoint {
  const a = rad(deg);
  return { x: c + Math.sin(a) * r, y: c - Math.cos(a) * r };
}
/** Ring band: r0/r1 the boundaries, inner/outer the plate edges. */
export function ringBand(ring: number): CzBand {
  const r0 = CZ_BOUNDS[ring]!, r1 = CZ_BOUNDS[ring + 1]!;
  return { ring, r0, r1, inner: r0 + CZ_GAP, outer: r1 - CZ_GAP, mid: (r0 + r1) / 2 };
}
/** Largest upright circle inside the wedge of `ring` (radius ρ at centre radius rc). Symbols are drawn in it. */
export function symbolCircle(ring: number): { rc: number; rho: number } {
  const b = ringBand(ring);
  const half = rad(CZ_SLICE_DEG / 2);
  const s = Math.sin(half);
  // ρ limited by depth (outer - rc, rc - inner) and by the wedge sides (rc · sin 15°)
  let rho = Math.min((b.outer - b.inner) / 2, (b.outer * s) / (1 + s));
  let rc = b.outer - rho;
  if (rc - rho < b.inner) { rc = (b.inner + b.outer) / 2; rho = Math.min((b.outer - b.inner) / 2, rc * s); }
  return { rc, rho };
}
/** Centre of the symbol of (ring, slice) in board space (ring at rest). */
export function sliceCenter(ring: number, slice: number): CzPoint {
  return polar(symbolCircle(ring).rc, sliceAngle(slice));
}
/** Square box (board units) for the upright symbol of a ring cell, a little inside the inscribed circle. */
export function symbolBox(ring: number, slice: number, fill = CZ_SYMBOL_FILL) {
  const { rho } = symbolCircle(ring);
  const c = sliceCenter(ring, slice);
  const size = rho * 2 * fill;
  return { x: c.x - size / 2, y: c.y - size / 2, size, cx: c.x, cy: c.y };
}
/** Annular wedge path for (ring, slice). `inset` shrinks it on every side (board units). */
export function slicePath(ring: number, slice: number, inset = 0, c = CZ_C): string {
  const b = ringBand(ring);
  return wedgePath(b.inner + inset, b.outer - inset, sliceAngle(slice), CZ_SLICE_DEG, inset, c);
}
/** Generic annular wedge centred on clock angle `centerDeg`, `spanDeg` wide; `insetLen` trims the sides by a length. */
export function wedgePath(rIn: number, rOut: number, centerDeg: number, spanDeg: number, insetLen = 0, c = CZ_C): string {
  const aOut = (spanDeg / 2) - (insetLen / rOut) * (180 / Math.PI);
  const aIn = (spanDeg / 2) - (insetLen / Math.max(rIn, 1)) * (180 / Math.PI);
  const p1 = polar(rOut, centerDeg - aOut, c), p2 = polar(rOut, centerDeg + aOut, c);
  const p3 = polar(rIn, centerDeg + aIn, c), p4 = polar(rIn, centerDeg - aIn, c);
  const large = aOut * 2 > 180 ? 1 : 0;
  return `M${r2(p1.x)} ${r2(p1.y)}A${r2(rOut)} ${r2(rOut)} 0 ${large} 1 ${r2(p2.x)} ${r2(p2.y)}L${r2(p3.x)} ${r2(p3.y)}A${r2(rIn)} ${r2(rIn)} 0 ${large} 0 ${r2(p4.x)} ${r2(p4.y)}Z`;
}
/** Full annulus (even-odd ring) path. */
export function annulusPath(rIn: number, rOut: number, c = CZ_C): string {
  const o = (r: number) => `M${c - r} ${c}A${r} ${r} 0 1 0 ${c + r} ${c}A${r} ${r} 0 1 0 ${c - r} ${c}Z`;
  return o(rOut) + o(rIn);
}
/** Spoke line from the hub rim to the board rim (or between two radii). */
export function spokeLine(spoke: number, from = CZ_HUB_R, to = CZ_BOUNDS[CZ_RINGS]!): { a: CzPoint; b: CzPoint; deg: number } {
  const deg = sliceAngle(spoke);
  return { a: polar(from, deg), b: polar(to, deg), deg };
}
/** The slice dividers of a ring (radial lines between slices). */
export function dividerPath(ring: number, c = CZ_C): string {
  const b = ringBand(ring);
  let d = '';
  for (let s = 0; s < CZ_SLICES; s++) {
    const deg = sliceAngle(s) + CZ_SLICE_DEG / 2;
    const p = polar(b.inner - 1, deg, c), q = polar(b.outer + 1, deg, c);
    d += `M${r2(p.x)} ${r2(p.y)}L${r2(q.x)} ${r2(q.y)}`;
  }
  return d;
}
/** Gear teeth on a circle: trapezoid teeth from radius `base` to `tip` (tip may be inside base for inward teeth). */
export function gearTeethPath(base: number, tip: number, pitchDeg: number, phaseDeg = 0, duty = 0.46, c = CZ_C): string {
  const n = Math.round(360 / pitchDeg);
  const half = (pitchDeg * duty) / 2;
  const tipHalf = half * 0.62;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = phaseDeg + i * pitchDeg;
    const p1 = polar(base, a - half, c), p2 = polar(tip, a - tipHalf, c), p3 = polar(tip, a + tipHalf, c), p4 = polar(base, a + half, c);
    d += `M${r2(p1.x)} ${r2(p1.y)}L${r2(p2.x)} ${r2(p2.y)}L${r2(p3.x)} ${r2(p3.y)}L${r2(p4.x)} ${r2(p4.y)}Z`;
  }
  return d;
}
/** Teeth a ring carries: outward teeth on its outer boundary and inward teeth on its inner boundary, offset by half a
 * pitch from the neighbour so the two rows interleave (mesh) when the rings are at rest. */
export function ringTeeth(ring: number): { outer: string; inner: string } {
  const r0 = CZ_BOUNDS[ring]!, r1 = CZ_BOUNDS[ring + 1]!;
  const pOut = CZ_TOOTH_PITCH[ring + 1]!, pIn = CZ_TOOTH_PITCH[ring]!;
  const h = CZ_TOOTH_DEPTH;
  return {
    // outward row: phase 0 (at slice dividers ± k·pitch)
    outer: gearTeethPath(r1 - CZ_GAP + 1, r1 + h - 2, pOut, CZ_SLICE_DEG / 2),
    // inward row: half a pitch off the row it meshes with
    inner: gearTeethPath(r0 + CZ_GAP - 1, r0 - h + 2, pIn, CZ_SLICE_DEG / 2 + pIn / 2),
  };
}
/** Clockwise (+1) or counter-clockwise (-1) for a ring. */
export const ringDirection = (ring: number): 1 | -1 => (ring % 2 === 0 ? 1 : -1);

/* ------------------------------------------------------------------ pixel layout */
export interface CzLayout {
  size: number; scale: number; cx: number; cy: number;
  hubR: number; bounds: number[]; rimR: number;
  /** Symbol centre and box size (px) for a cell at rest. */
  cell(ring: number, slice: number): { x: number; y: number; size: number };
  /** Board-space point to px. */
  px(p: CzPoint): CzPoint;
  /** Point at clock angle / board-unit radius, in px. */
  at(rUnits: number, deg: number): CzPoint;
}
/** The same geometry scaled to a square container of `sizePx` (offset ox, oy inside a host). */
export function cezeriBoardLayout(sizePx: number, ox = 0, oy = 0): CzLayout {
  const k = sizePx / CZ_UNITS;
  return {
    size: sizePx, scale: k, cx: ox + CZ_C * k, cy: oy + CZ_C * k,
    hubR: CZ_HUB_R * k, bounds: CZ_BOUNDS.map((b) => b * k), rimR: CZ_RIM_R * k,
    cell(ring, slice) { const b = symbolBox(ring, slice); return { x: ox + b.cx * k, y: oy + b.cy * k, size: b.size * k }; },
    px(p) { return { x: ox + p.x * k, y: oy + p.y * k }; },
    at(r, deg) { const p = polar(r, deg); return { x: ox + p.x * k, y: oy + p.y * k }; },
  };
}
/** CSS percentages (of the board square) for an absolutely positioned cell box. */
export function cellStyle(ring: number, slice: number, fill = CZ_SYMBOL_FILL) {
  const b = symbolBox(ring, slice, fill);
  return { left: czPct((b.x / CZ_UNITS) * 100), top: czPct((b.y / CZ_UNITS) * 100), width: czPct((b.size / CZ_UNITS) * 100), height: czPct((b.size / CZ_UNITS) * 100) };
}

/* ------------------------------------------------------------------ ring motion (ratchet / escapement) */
export interface CzSpinPlan {
  /** Spin-up + cruise: from 0 to `cruiseDeg` (signed). Content swaps to fillers at `swapAt` ms. */
  upKeyframes: Keyframe[]; upMs: number;
  /** Settle: from `-dir · slices · 30°` to 0 with ratchet ticks and an overshoot. */
  settleKeyframes: Keyframe[]; settleMs: number;
  /** Same curves negated (the upright counter-rotation of the ring's symbols). */
  upCounter: Keyframe[]; settleCounter: Keyframe[];
  /** Wall-clock times (ms after the spin starts) of each escapement tick (for clicks / sparks). */
  ticks: number[];
  total: number;
  /** Slices the ring passes in the whole spin (cruise + settle), for the ratchet sound. */
  distance: number;
}
export interface CzSpinOptions {
  ring: number;
  /** Cruise time before this ring starts to settle (stagger rings with it). */
  cruiseMs?: number;
  /** Slices covered by the settle (≥ ticks + 1). */
  slices?: number;
  /** Slow escapement ticks at the end of the settle. */
  ticks?: number;
  /** Overshoot of the last tick in degrees. */
  overshoot?: number;
  /** Global speed factor (1 normal, 0.6 quick, 0.35 turbo). */
  speed?: number;
}
const rot = (deg: number) => ({ transform: `rotate(${r2(deg)}deg)` });
/** Plans one ring spin. Keyframe angles are absolute rotations of the ring layer (0 = at rest). */
export function cezeriSpinPlan(o: CzSpinOptions): CzSpinPlan {
  const dir = ringDirection(o.ring);
  const sp = o.speed ?? 1;
  const upMs = Math.round((260 + (o.cruiseMs ?? 380)) * sp);
  const cruiseDeg = dir * (90 + 0.95 * (o.cruiseMs ?? 380) * Math.min(1.4, 1 / sp));
  const upKeyframes: Keyframe[] = [
    { offset: 0, ...rot(0), easing: 'cubic-bezier(.55,0,1,.55)' },
    { offset: Math.min(0.6, (260 * sp) / upMs), ...rot(dir * 70), easing: 'linear' },
    { offset: 1, ...rot(cruiseDeg) },
  ];
  const ticks = Math.max(1, o.ticks ?? 3);
  const slices = Math.max(ticks + 1, o.slices ?? 9);
  const free = slices - ticks;
  const freeMs = 260 + free * 34;
  const tickMs = 130;
  const settleMs = Math.round((freeMs + ticks * tickMs + 220) * sp);
  const over = (o.overshoot ?? 5) * dir;
  const start = -dir * slices * CZ_SLICE_DEG;
  const settleKeyframes: Keyframe[] = [];
  const tAt = (ms: number) => Math.min(1, (ms * sp) / settleMs);
  settleKeyframes.push({ offset: 0, ...rot(start), easing: 'cubic-bezier(.1,.55,.4,1)' });
  let t = freeMs;
  let a = start + dir * free * CZ_SLICE_DEG;
  settleKeyframes.push({ offset: tAt(t), ...rot(a), easing: 'linear' });
  const tickTimes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const last = i === ticks - 1;
    // the escapement releases one slice: a fast hop with a small kick past the tooth, then it rests on the pallet
    const hop = tickMs * 0.42;
    const kick = last ? over : dir * 1.6;
    settleKeyframes.push({ offset: tAt(t + tickMs * 0.18), ...rot(a), easing: 'cubic-bezier(.3,0,.2,1)' });
    a += dir * CZ_SLICE_DEG;
    settleKeyframes.push({ offset: tAt(t + tickMs * 0.18 + hop), ...rot(a + kick), easing: 'cubic-bezier(.3,0,.4,1)' });
    tickTimes.push(Math.round((t + tickMs * 0.18 + hop) * sp));
    t += tickMs;
    if (last) {
      settleKeyframes.push({ offset: tAt(t + 70), ...rot(a - over * 0.35), easing: 'cubic-bezier(.3,0,.4,1)' });
      settleKeyframes.push({ offset: 1, ...rot(0) });
    } else settleKeyframes.push({ offset: tAt(t), ...rot(a) });
  }
  // de-duplicate offsets and keep them monotonic
  let prev = -1;
  for (const k of settleKeyframes) { const off = Math.max(prev + 0.0001, Math.min(1, k.offset as number)); k.offset = Math.min(1, off); prev = k.offset; }
  settleKeyframes[settleKeyframes.length - 1]!.offset = 1;
  const neg = (ks: Keyframe[]) => ks.map((k) => ({ ...k, transform: String(k.transform).replace(/rotate\((-?[\d.]+)deg\)/, (_, v: string) => `rotate(${r2(-Number(v))}deg)`) }));
  return {
    upKeyframes, upMs, settleKeyframes, settleMs,
    upCounter: neg(upKeyframes), settleCounter: neg(settleKeyframes),
    ticks: tickTimes.map((x) => upMs + x), total: upMs + settleMs,
    distance: Math.round(Math.abs(cruiseDeg) / CZ_SLICE_DEG + slices),
  };
}

/* ------------------------------------------------------------------ rotation timing (board, timeline and sound share it) */
/** First rotation of a spin or a Dişli Kilidi respin (the respins wind faster so a 10-respin chain stays watchable). */
export type CzRotateKind = 'first' | 'respin';
export interface CzRingTiming { ring: number; options: CzSpinOptions; plan: CzSpinPlan }
/** Stagger (ms of extra cruise per ring) and settle slices per rotate kind. Pure: the timeline uses the same numbers. */
const ROTATE_SHAPE: Readonly<Record<CzRotateKind, { cruise: number; stagger: number; slices: number; ticks: number }>> = {
  first: { cruise: 380, stagger: 210, slices: 6, ticks: 3 },
  respin: { cruise: 170, stagger: 120, slices: 4, ticks: 2 },
};
/** The four ring plans of one rotation at `speed` (1 normal, 0.6 quick, 0.35 turbo). Ring r stops after ring r - 1. */
export function cezeriRotateTiming(kind: CzRotateKind, speed = 1): CzRingTiming[] {
  const shape = ROTATE_SHAPE[kind];
  return Array.from({ length: CZ_RINGS }, (_, ring) => {
    const options: CzSpinOptions = { ring, cruiseMs: shape.cruise + ring * shape.stagger, slices: shape.slices + ring, ticks: shape.ticks, speed };
    return { ring, options, plan: cezeriSpinPlan(options) };
  });
}

/* ------------------------------------------------------------------ falcon flight (FX and timeline share it) */
export interface CzFalconPlan {
  /** Spline control points (board units; the first and last two are off-board). */
  pts: CzPoint[];
  /** Flight time of each spline segment (ms). */
  segMs: number[];
  total: number;
  /** Target slices in flight order (clockwise by angle). */
  order: number[];
  /** ms after take-off when the gear for order[i] lands on its slice. */
  drops: number[];
  /** ms after take-off when the visit is over. */
  end: number;
}
/** Deterministic flight path and timing of the automaton falcon over `slices` of `ring`. */
export function cezeriFalconPlan(ring: number, slices: readonly number[], speed = 1): CzFalconPlan {
  const k = Math.max(0.55, speed);
  const pad = 260;
  const order = [...slices].sort((x, y) => sliceAngle(x) - sliceAngle(y));
  const over = order.map((s) => { const c = sliceCenter(ring, s); return { x: c.x, y: c.y - 120 }; });
  const pts: CzPoint[] = [{ x: -pad - 200, y: -pad }, { x: -pad, y: -pad * 0.4 }, ...over, { x: 1000 + pad, y: -pad * 0.5 }, { x: 1000 + pad + 200, y: -pad }];
  const segMs: number[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const d = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    segMs.push(Math.round(Math.max(260, d * 1.15) * k));
  }
  const total = segMs.reduce((a, b) => a + b, 0);
  const drops: number[] = [];
  let t = 0;
  order.forEach((_, i) => { t += segMs[i]!; drops.push(t + Math.round(240 * k)); });
  const end = Math.max(total, t + Math.round(400 * k)) + 120;
  return { pts, segMs, total, order, drops, end };
}

/** Bounding box (board units) of the wedge of (ring, slice), padded by `pad`. */
export function wedgeBox(ring: number, slice: number, pad = 0) {
  const b = ringBand(ring);
  const c = sliceAngle(slice);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of [b.inner, b.outer]) {
    for (let i = 0; i <= 8; i++) {
      const p = polar(r, c - CZ_SLICE_DEG / 2 + (i / 8) * CZ_SLICE_DEG);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
/** CSS box (percent of the board) for a wedge-shaped overlay; pair with viewBox `${x} ${y} ${w} ${h}`. */
export function wedgeStyle(ring: number, slice: number, pad = 0) {
  const w = wedgeBox(ring, slice, pad);
  return { box: w, style: { left: czPct((w.x / CZ_UNITS) * 100), top: czPct((w.y / CZ_UNITS) * 100), width: czPct((w.w / CZ_UNITS) * 100), height: czPct((w.h / CZ_UNITS) * 100) } };
}
