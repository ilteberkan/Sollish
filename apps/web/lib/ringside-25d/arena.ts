/**
 * Static arena art, drawn once into offscreen canvases (crowd tiers, LED boards, light sprites, the backdrop plate)
 * and then only blitted by the broadcast, so the per-frame cost stays small on a phone. Presentation only.
 */
export const hash = (n: number) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
export type Canvas = HTMLCanvasElement;
const make = (w: number, h: number): Canvas => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** Team colours of the arena lighting (KOR orange, AYAZ cyan). */
export const KOR = '#ff6a3d', AYAZ = '#4cc9f0';

export type CrowdSpec = { w: number; h: number; rows: number; seed: number; tone: number; head: number };
/**
 * A transparent panorama of crowd silhouettes around the whole stand (x = angle). Rows rise toward the top; each row is
 * a little lighter, heads and shoulders are dark blobs, some arms are raised, a few phones glow, and the far sides carry
 * the team colours as a rim light (orange toward the KOR corner at 135 deg, cyan toward AYAZ at 315 deg).
 */
export function crowdTier(spec: CrowdSpec): Canvas {
  const c = make(spec.w, spec.h), g = c.getContext('2d')!;
  let k = spec.seed;
  const rowH = spec.h / (spec.rows + 1.4);
  for (let row = 0; row < spec.rows; row++) {
    const y = spec.h - rowH * (row + .6), r = spec.head * (1 - row * .02);
    for (let x = (row % 2) * r; x < spec.w; x += r * 2.3 * (.86 + hash(k++) * .4)) {
      const tone = spec.tone + Math.floor(hash(k++) * 12) + row * 1.1, jy = (hash(k++) - .5) * r * .5;
      g.fillStyle = `rgb(${tone},${tone + 2},${tone + 6})`;
      g.beginPath(); g.arc(x, y + jy, r, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(x, y + jy + r * 2, r * 1.9, r * 1.5, 0, Math.PI, 0); g.fill();
      if (hash(k++) < .045) { g.strokeStyle = g.fillStyle; g.lineWidth = r * .55; g.lineCap = 'round'; g.beginPath(); g.moveTo(x + r * .9, y + jy + r * 1.6); g.lineTo(x + r * 1.5, y + jy - r * 1.4); g.stroke(); }
      if (hash(k++) < .02) { g.fillStyle = 'rgba(255,233,184,.8)'; g.fillRect(x - r * .3, y + jy + r * .9, r * .6, r * .8); }
    }
  }
  // Rim light from the team colours at the sides (source-atop: only where silhouettes already are).
  g.globalCompositeOperation = 'source-atop';
  for (const [centre, rgb] of [[135 / 360, '255,106,61'], [315 / 360, '76,201,240']] as const) for (const off of [-1, 0, 1]) {
    const cx = (centre + off) * spec.w, grad = g.createLinearGradient(cx - spec.w * .16, 0, cx + spec.w * .16, 0);
    grad.addColorStop(0, `rgba(${rgb},0)`); grad.addColorStop(.5, `rgba(${rgb},.34)`); grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad; g.fillRect(cx - spec.w * .16, 0, spec.w * .32, spec.h);
  }
  const top = g.createLinearGradient(0, 0, 0, spec.h); top.addColorStop(0, 'rgba(0,0,0,.65)'); top.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = top; g.fillRect(0, 0, spec.w, spec.h);
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** Procedural fallback backdrop when the painted plate is missing: dark hall with stand tiers and spot haze. */
export function fallbackPlate(): Canvas {
  const c = make(1600, 686), g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 686); bg.addColorStop(0, '#040507'); bg.addColorStop(.5, '#0a0c10'); bg.addColorStop(.7, '#111419'); bg.addColorStop(1, '#07080a');
  g.fillStyle = bg; g.fillRect(0, 0, 1600, 686);
  for (const [x, rgb] of [[220, '255,106,61'], [1380, '76,201,240']] as const) { const r = g.createRadialGradient(x, 470, 0, x, 470, 420); r.addColorStop(0, `rgba(${rgb},.24)`); r.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = r; g.fillRect(0, 0, 1600, 686); }
  for (let i = 0; i < 14; i++) { const x = 160 + i * 100, r = g.createRadialGradient(x, 30, 0, x, 30, 8); r.addColorStop(0, 'rgba(255,240,210,.9)'); r.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = r; g.fillRect(x - 8, 22, 16, 16); }
  return c;
}

/** The painted backdrop, loaded once; darkened and softened (downscaled) so fighters stay readable in front. */
export function loadPlate(src: string, onReady: (plate: Canvas) => void, onFail: () => void): () => void {
  if (typeof Image === 'undefined') { onFail(); return () => {}; }
  const img = new Image(); let dead = false;
  img.decoding = 'async';
  img.onload = () => {
    if (dead) return;
    try {
      const w = 1600, h = Math.round(w * img.naturalHeight / img.naturalWidth), c = make(w, h), g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
      g.fillStyle = 'rgba(2,3,5,.42)'; g.fillRect(0, 0, w, h);
      const v = g.createLinearGradient(0, h * .55, 0, h); v.addColorStop(0, 'rgba(3,4,6,0)'); v.addColorStop(1, 'rgba(3,4,6,.5)'); g.fillStyle = v; g.fillRect(0, 0, w, h);
      onReady(c);
    } catch { onFail(); }
  };
  img.onerror = () => { if (!dead) onFail(); };
  img.src = src;
  return () => { dead = true; img.onload = null; img.onerror = null; };
}

/** LED board tile for 5 m x 0.85 m of board: three words in dot-matrix lettering, tiled horizontally. */
export const LED_TILE_M = 5;
export function ledStrip(): Canvas {
  const w = 1536, h = 262, c = make(w, h), g = c.getContext('2d')!;
  g.fillStyle = '#07090c'; g.fillRect(0, 0, w, h);
  const items: [string, string][] = [['KOR', KOR], ['SOLLISH', '#f1ece2'], ['AYAZ', AYAZ]];
  g.font = '900 150px ui-sans-serif, system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  items.forEach(([t, col], i) => { const x = (i + .5) * w / items.length; g.fillStyle = col; g.fillText(t, x, h / 2 + 6); g.fillStyle = col + '66'; g.fillRect(x - 110, h - 22, 220, 8); g.fillRect(x - 110, 14, 220, 8); });
  g.fillStyle = 'rgba(0,0,0,.6)';
  for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h);
  for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
  return c;
}

/** Soft round light sprite (white core, coloured halo) for lamp glows and haze. */
export function glow(rgb: string, size = 128, core = .9): Canvas {
  const c = make(size, size), g = c.getContext('2d')!, r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, `rgba(255,255,255,${core})`); r.addColorStop(.18, `rgba(${rgb},${core * .55})`); r.addColorStop(.55, `rgba(${rgb},${core * .12})`); r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r; g.fillRect(0, 0, size, size);
  return c;
}
