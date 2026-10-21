/**
 * Damla: Pamukkale terrace art, drawn in code (canvas 2D, no images). Original design: white travertine shelves step
 * down in a widening cascade under a twilight sky; every shelf carries a row of shallow turquoise rimstone basins and
 * hangs travertine curtains from its lip. The single water drop hops basin to basin (the timeline decides where; this file
 * only paints). Presentation only: nothing here reads or changes a result.
 */

export interface TerraceLayout {
  width: number; height: number; rows: number;
  /** Centre line x, top padding, horizontal basin pitch and vertical terrace pitch (CSS px). */
  cx: number; top: number; dx: number; dy: number;
  /** Centre y of the bottom pool row (the DOM pools sit there). */
  poolY: number; poolH: number;
}

/** Board geometry for a canvas of `width` × `height` CSS px and `rows` terraces, with the pool row `poolH` px high at the bottom. */
export function terraceLayout(width: number, height: number, rows: number, poolH: number): TerraceLayout {
  const side = Math.max(6, width * 0.025);
  const dx = (width - side * 2) / (rows + 1);
  const top = Math.max(58, height * 0.1);
  const poolY = height - poolH / 2;
  const dy = (poolY - top) / (rows + 0.15);
  return { width, height, rows, cx: width / 2, top, dx, dy, poolY, poolH };
}
/** CSS px position of a lattice point (x = basin − row/2, y = row; y = rows is the pool row). */
export function latticeToPx(l: TerraceLayout, x: number, y: number): [number, number] {
  const py = y >= l.rows ? l.top + l.rows * l.dy + (l.poolY - (l.top + l.rows * l.dy)) * Math.min(1, y - l.rows + 1) : l.top + y * l.dy;
  return [l.cx + x * l.dx, py];
}

export interface Palette {
  skyTop: string; skyMid: string; skyLow: string; glow: string;
  stoneHi: string; stone: string; stoneMid: string; stoneLo: string; stoneShadow: string; curtain: string;
  waterHi: string; water: string; waterDeep: string; rim: string;
}
export const TWILIGHT: Palette = {
  skyTop: '#071a28', skyMid: '#12394b', skyLow: '#2c5e6c', glow: 'rgba(255, 214, 160, 0.22)',
  stoneHi: '#fffdf8', stone: '#f1ece2', stoneMid: '#dcd3c3', stoneLo: '#b9ad98', stoneShadow: 'rgba(32, 46, 52, 0.42)', curtain: 'rgba(255, 252, 244, 0.75)',
  waterHi: '#c9fbf6', water: '#41d3d6', waterDeep: '#128ea6', rim: '#fbf7ee',
};
export const GOLD: Palette = {
  skyTop: '#2a1a05', skyMid: '#5a3a0c', skyLow: '#8a6018', glow: 'rgba(255, 226, 140, 0.5)',
  stoneHi: '#fff7d6', stone: '#ffe39a', stoneMid: '#f0c45a', stoneLo: '#c8902a', stoneShadow: 'rgba(80, 46, 4, 0.45)', curtain: 'rgba(255, 244, 200, 0.85)',
  waterHi: '#fff6c4', water: '#ffd34d', waterDeep: '#e09a18', rim: '#fff4cc',
};

/** Small deterministic hash noise (for curtains and texture), so the art is stable between frames and reloads. */
function noise(i: number, j = 0): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
}

/** Basin size on a terrace. */
export function basinSize(l: TerraceLayout): { rx: number; ry: number } {
  const rx = l.dx * 0.4;
  return { rx, ry: Math.max(2.2, Math.min(l.dy * 0.24, rx * 0.46)) };
}

/** The static scene: sky, distant cliffs, the stepping travertine shelves with their basins and curtains. */
export function drawTerraces(ctx: CanvasRenderingContext2D, l: TerraceLayout, p: Palette = TWILIGHT) {
  const { width: w, height: h, rows, cx, top, dx, dy } = l;
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, p.skyTop); sky.addColorStop(0.55, p.skyMid); sky.addColorStop(1, p.skyLow);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(cx, top * 0.4, 0, cx, top * 0.4, Math.max(w, h) * 0.7);
  glow.addColorStop(0, p.glow); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  // a few stars and a thin moon (top corners), quiet
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 26; i++) {
    const x = noise(i, 1) * w, y = noise(i, 2) * h * 0.35;
    if (Math.abs(x - cx) < w * 0.18) continue;
    const r = 0.4 + noise(i, 3) * 0.9; ellipse(ctx, x, y, r, r); ctx.fill();
  }
  // distant white cliff band (soft silhouettes left and right)
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * w * 0.08, h);
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, x = cx + side * (w * 0.08 + t * w * 0.5);
      const y = h * (0.42 + t * 0.12) + Math.sin(k * 1.7) * h * 0.012 + noise(k, side + 5) * h * 0.02;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cx + side * w * 0.6, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, h * 0.42, 0, h);
    g.addColorStop(0, 'rgba(230, 236, 236, 0.16)'); g.addColorStop(1, 'rgba(180, 200, 205, 0.05)');
    ctx.fillStyle = g; ctx.fill();
  }
  const { rx, ry } = basinSize(l);
  const lip = Math.max(2, dy * 0.2);
  const face = dy * 0.78;
  // shelves from the bottom up, so higher shelves overlap the faces below them
  for (let i = rows - 1; i >= 0; i--) {
    const y = top + i * dy;
    const half = (i / 2 + 0.5) * dx + rx * 0.35;
    const x0 = cx - half, x1 = cx + half;
    const r = Math.min(dx * 0.45, dy * 0.6);
    // cast shadow on the shelf below
    ctx.fillStyle = p.stoneShadow;
    ctx.beginPath(); ctx.ellipse(cx, y + face + lip * 0.6, half * 0.98, lip * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    // front face (the step) with curtains
    const fg = ctx.createLinearGradient(0, y, 0, y + face);
    fg.addColorStop(0, p.stone); fg.addColorStop(0.55, p.stoneMid); fg.addColorStop(1, p.stoneLo);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.quadraticCurveTo(x1 + r * 0.25, y + face * 0.5, x1 - r * 0.1, y + face);
    // scalloped bottom edge: travertine "curtains" hang between the basins
    const n = i + 2;
    for (let k = n; k >= 0; k--) {
      const xk = x0 + ((x1 - x0) * k) / n;
      const sag = face * (0.9 + noise(i, k) * 0.22);
      ctx.quadraticCurveTo(xk + (x1 - x0) / n / 2, y + sag + face * 0.12, xk, y + face);
    }
    ctx.quadraticCurveTo(x0 - r * 0.25, y + face * 0.5, x0, y);
    ctx.closePath();
    ctx.fill();
    // curtain streaks
    ctx.strokeStyle = p.curtain; ctx.lineCap = 'round';
    const streaks = Math.max(3, Math.round((x1 - x0) / Math.max(3, dx * 0.22)));
    for (let k = 0; k < streaks; k++) {
      const t = (k + 0.5) / streaks, x = x0 + (x1 - x0) * t + (noise(i * 31, k) - 0.5) * dx * 0.12;
      const len = face * (0.35 + noise(k, i * 7) * 0.55);
      ctx.globalAlpha = 0.18 + noise(k, i) * 0.3;
      ctx.lineWidth = Math.max(0.6, dx * (0.03 + noise(i, k * 3) * 0.05));
      ctx.beginPath(); ctx.moveTo(x, y + lip); ctx.lineTo(x + (noise(k, i * 3) - 0.5) * 1.5, y + lip + len); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // the shelf top (lip): a soft, bright band
    const tg = ctx.createLinearGradient(0, y - lip, 0, y + lip);
    tg.addColorStop(0, p.stoneHi); tg.addColorStop(1, p.stone);
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.ellipse(cx, y, half + r * 0.08, lip * 1.15, 0, 0, Math.PI * 2); ctx.fill();
    // basins: rim, water, highlight
    for (let b = 0; b <= i; b++) {
      const bx = cx + (b - i / 2) * dx;
      ellipse(ctx, bx, y + ry * 0.05, rx * 1.08, ry * 1.18); ctx.fillStyle = p.rim; ctx.fill();
      const wg = ctx.createRadialGradient(bx - rx * 0.3, y - ry * 0.4, 0, bx, y, rx);
      wg.addColorStop(0, p.waterHi); wg.addColorStop(0.45, p.water); wg.addColorStop(1, p.waterDeep);
      ellipse(ctx, bx, y + ry * 0.12, rx * 0.88, ry * 0.86); ctx.fillStyle = wg; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(0.6, ry * 0.18);
      ctx.beginPath(); ctx.ellipse(bx - rx * 0.12, y - ry * 0.05, rx * 0.5, ry * 0.32, 0, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
    }
  }
  // the pool basin floor under the DOM pools: a wide travertine ledge
  const ly = l.poolY - l.poolH * 0.62;
  const lg = ctx.createLinearGradient(0, ly, 0, h);
  lg.addColorStop(0, p.stoneHi); lg.addColorStop(0.2, p.stone); lg.addColorStop(1, p.stoneLo);
  ctx.fillStyle = lg;
  const lx0 = cx - (rows / 2 + 0.62) * dx, lx1 = cx + (rows / 2 + 0.62) * dx;
  ctx.beginPath();
  ctx.moveTo(lx0, ly + 4); ctx.quadraticCurveTo(lx0, ly, lx0 + 6, ly); ctx.lineTo(lx1 - 6, ly); ctx.quadraticCurveTo(lx1, ly, lx1, ly + 4); ctx.lineTo(lx1, h); ctx.lineTo(lx0, h); ctx.closePath(); ctx.fill();
}

/* ------------------------------------------------------------------ dynamic layer */
export interface Ripple { x: number; y: number; born: number; life: number; scale: number; gold?: boolean }
export interface Particle { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; gold?: boolean }

/** A teardrop at (x, y) (CSS px), `size` = radius, stretched along its motion and squashed after a splash. */
export function drawDrop(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, opts: { vy: number; squash: number; ghost?: boolean; gold?: boolean }) {
  const stretch = 1 + Math.min(0.5, Math.max(0, opts.vy) * 0.6);
  const sx = (1 + opts.squash * 0.35) / Math.sqrt(stretch), sy = stretch * (1 - opts.squash * 0.3);
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = opts.ghost ? 0.75 : 1;
  // glow
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 3.2);
  halo.addColorStop(0, opts.gold ? 'rgba(255, 220, 120, 0.55)' : 'rgba(170, 250, 255, 0.5)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(-size * 3.2, -size * 3.2, size * 6.4, size * 6.4);
  ctx.scale(sx, sy);
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.7);
  ctx.bezierCurveTo(size * 0.35, -size * 1.0, size, -size * 0.35, size, size * 0.15);
  ctx.arc(0, size * 0.15, size, 0, Math.PI);
  ctx.bezierCurveTo(-size, -size * 0.35, -size * 0.35, -size * 1.0, 0, -size * 1.7);
  ctx.closePath();
  const body = ctx.createRadialGradient(-size * 0.35, -size * 0.2, size * 0.1, 0, size * 0.1, size * 1.4);
  if (opts.gold) { body.addColorStop(0, '#fffbe8'); body.addColorStop(0.5, '#ffd76a'); body.addColorStop(1, '#d48d10'); }
  else { body.addColorStop(0, '#ffffff'); body.addColorStop(0.45, '#b9f6ff'); body.addColorStop(1, '#2fb7d0'); }
  ctx.fillStyle = body; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = Math.max(0.6, size * 0.12); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.ellipse(-size * 0.38, -size * 0.15, size * 0.22, size * 0.36, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawRipple(ctx: CanvasRenderingContext2D, r: Ripple, now: number, ry: number) {
  const t = (now - r.born) / r.life;
  if (t < 0 || t >= 1) return;
  const e = 1 - (1 - t) ** 2;
  ctx.strokeStyle = r.gold ? `rgba(255, 230, 150, ${0.9 * (1 - t)})` : `rgba(235, 255, 255, ${0.85 * (1 - t)})`;
  ctx.lineWidth = Math.max(0.7, ry * 0.3 * (1 - t) + 0.4);
  ellipse(ctx, r.x, r.y, ry * 2 * r.scale * (0.4 + e * 1.4), ry * r.scale * (0.4 + e * 1.3)); ctx.stroke();
  if (t < 0.4) {
    ctx.fillStyle = r.gold ? `rgba(255, 236, 160, ${0.5 * (1 - t / 0.4)})` : `rgba(200, 255, 255, ${0.45 * (1 - t / 0.4)})`;
    ellipse(ctx, r.x, r.y, ry * 1.6 * r.scale, ry * 0.9 * r.scale); ctx.fill();
  }
}

export function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, now: number) {
  const t = (now - p.born) / p.life;
  if (t < 0 || t >= 1) return;
  const s = (now - p.born) / 1000;
  const x = p.x + p.vx * s, y = p.y + p.vy * s + 420 * s * s;
  ctx.fillStyle = p.gold ? `rgba(255, 224, 130, ${1 - t})` : `rgba(215, 252, 255, ${1 - t})`;
  ellipse(ctx, x, y, p.size * (1 - t * 0.4), p.size * (1 - t * 0.4)); ctx.fill();
}
