/**
 * Cutout ("paper doll") sprites for the Ringside broadcast. The parts are built by apps/web/scripts/ringside-sprites.mjs
 * from the approved part sheets: strict right-facing profile art, one image per body part, each with two joint anchors
 * (proximal, distal) in part pixels. At draw time a part is rotated and scaled so its anchors land on the two projected
 * joints of the 3D skeleton; facing left mirrors the sprite (never on disk). Presentation only.
 */
export type PartDef = { file: string; size: [number, number]; anchors: { prox: [number, number]; dist: [number, number] }; width: { prox: number; dist: number }; color: [number, number, number]; /** Extra joints inside the part in part pixels (torso: `shoulder`). */ extra?: Record<string, [number, number]>; bytes?: number };
export type CharacterId = 'kor' | 'ayaz' | 'referee';
export type Manifest = { version: number; characters: Record<CharacterId, { parts: Record<string, PartDef> }>; canvas: { file: string }; apron: { file: string; cropTop: number } };
/** `mips[l]` is the part downscaled by 2^l (level 0 is the image itself): a part drawn small is taken from the level that is at most 2x too big, so edges never shimmer. */
export type Sprite = { def: PartDef; img: HTMLImageElement; far: HTMLCanvasElement; mips: CanvasImageSource[]; farMips: CanvasImageSource[] };
export type SpriteSet = { parts: Record<CharacterId, Record<string, Sprite>>; canvas: HTMLImageElement | null; apron: HTMLImageElement | null };
export type Pt = { x: number; y: number };
export type Matrix = [number, number, number, number, number, number];

/** The parts every character sheet must provide (the boot is merged into the shin for AYAZ and the referee). */
export const REQUIRED_PARTS: Record<CharacterId, readonly string[]> = {
  kor: ['head', 'torso', 'shorts', 'upperArm', 'forearm', 'thigh', 'shin', 'boot'],
  ayaz: ['head', 'torso', 'shorts', 'upperArm', 'forearm', 'thigh', 'shin'],
  referee: ['head', 'torso', 'upperArm', 'forearm', 'thigh', 'shin'],
};

/**
 * Affine transform that puts a part's proximal anchor on `a` and its distal anchor on `b`, scaled `along` the bone (screen
 * length / sprite length, so foreshortening squashes it) and `across` it (thickness from depth), optionally mirrored.
 * Returns the matrix for ctx.transform (image pixel -> screen).
 */
export function partMatrix(def: PartDef, mirror: boolean, a: Pt, b: Pt, along: number, across: number): Matrix {
  const [w] = def.size, sgn = mirror ? -1 : 1, off = mirror ? w : 0;
  const px = def.anchors.prox[0] * sgn + off, py = def.anchors.prox[1], dx = def.anchors.dist[0] * sgn + off - px, dy = def.anchors.dist[1] - py, len = Math.hypot(dx, dy) || 1;
  // Sprite-space bone axis u and its perpendicular v (mirrored coordinates), and the screen-space U, V.
  const ux = dx / len, uy = dy / len, vx = -uy, vy = ux;
  let Ux = b.x - a.x, Uy = b.y - a.y; const L = Math.hypot(Ux, Uy);
  if (L < 1e-4) { Ux = 0; Uy = 1; } else { Ux /= L; Uy /= L; }
  const Vx = -Uy, Vy = Ux;
  // Image of the mirrored-sprite basis vectors (1,0) and (0,1).
  const s1x = Ux * along * ux + Vx * across * vx, s1y = Uy * along * ux + Vy * across * vx;
  const s2x = Ux * along * uy + Vx * across * vy, s2y = Uy * along * uy + Vy * across * vy;
  // screen = a + s1 * (sgn * x + off - px) + s2 * (y - py)
  return [s1x * sgn, s1y * sgn, s2x, s2y, a.x + s1x * (off - px) - s2x * py, a.y + s1y * (off - px) - s2y * py];
}
/** Maps a sprite pixel through a matrix (used by tests and the cap placement). */
export const apply = (m: Matrix, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
/** Length between the anchors in sprite pixels. */
export const boneLength = (def: PartDef) => Math.hypot(def.anchors.dist[0] - def.anchors.prox[0], def.anchors.dist[1] - def.anchors.prox[1]);

/** Draws a part. `far` uses the darkened copy (limbs on the far side of the body). */
export function drawPart(g: CanvasRenderingContext2D, s: Sprite, far: boolean, mirror: boolean, a: Pt, b: Pt, along: number, across: number): void {
  const m = partMatrix(s.def, mirror, a, b, along, across), chain = far ? s.farMips : s.mips, level = Math.min(chain.length - 1, Math.max(0, Math.floor(Math.log2(1 / Math.max(1e-4, Math.max(along, across)) * .98))));
  g.save(); g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  if (level > 0) { const k = 2 ** level; g.scale(k, k); }
  g.drawImage(chain[level]!, 0, 0); g.restore();
}

/** Round joint cap in the limb's own colour: hides the flat cut faces where two parts meet, so a joint never tears. */
export function drawCap(g: CanvasRenderingContext2D, c: Pt, r: number, color: [number, number, number], far: boolean): void {
  if (r < .5) return;
  const k = far ? .6 : 1, [cr, cg, cb] = color.map(v => Math.round(v * k));
  const grad = g.createRadialGradient(c.x - r * .25, c.y - r * .3, r * .1, c.x, c.y, r);
  grad.addColorStop(0, `rgb(${Math.min(255, cr + 8)},${Math.min(255, cg + 7)},${Math.min(255, cb + 6)})`); grad.addColorStop(.8, `rgb(${cr},${cg},${cb})`); grad.addColorStop(1, `rgb(${Math.round(cr * .9)},${Math.round(cg * .9)},${Math.round(cb * .9)})`);
  g.fillStyle = grad; g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.fill();
}

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error(`sprite ${src}`)); i.src = src; });
function mipChain(src: HTMLImageElement | HTMLCanvasElement, w: number, h: number, levels = 3): CanvasImageSource[] {
  const out: CanvasImageSource[] = [src]; let prev: CanvasImageSource = src;
  for (let l = 1; l < levels; l++) {
    const cw = Math.max(1, Math.round(w / 2 ** l)), ch = Math.max(1, Math.round(h / 2 ** l)), c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(prev, 0, 0, cw, ch); out.push(c); prev = c;
  }
  return out;
}
function darkened(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!; g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(5,7,12,.42)'; g.fillRect(0, 0, c.width, c.height);
  return c;
}
/** Loads the manifest and every part once; resolves with the set, or calls `onFail` and the procedural figures stay in use. */
export function loadSprites(base: string, onReady: (s: SpriteSet) => void, onFail: () => void): () => void {
  if (typeof Image === 'undefined' || typeof fetch === 'undefined') { onFail(); return () => {}; }
  let dead = false;
  (async () => {
    const manifest = await (await fetch(base + 'parts.json')).json() as Manifest;
    const set: SpriteSet = { parts: { kor: {}, ayaz: {}, referee: {} }, canvas: null, apron: null };
    const jobs: Promise<void>[] = [];
    for (const id of Object.keys(REQUIRED_PARTS) as CharacterId[]) for (const [name, def] of Object.entries(manifest.characters[id].parts)) jobs.push(loadImage(`${base}${id}/${def.file}`).then(img => { const far = darkened(img), w = img.naturalWidth, h = img.naturalHeight; set.parts[id][name] = { def, img, far, mips: mipChain(img, w, h), farMips: mipChain(far, w, h) }; }));
    jobs.push(loadImage(base + manifest.canvas.file).then(i => { set.canvas = i; }).catch(() => {}), loadImage(base + manifest.apron.file).then(i => { set.apron = i; }).catch(() => {}));
    await Promise.all(jobs);
    for (const id of Object.keys(REQUIRED_PARTS) as CharacterId[]) for (const name of REQUIRED_PARTS[id]) if (!set.parts[id][name]) throw new Error(`missing ${id}/${name}`);
    if (!dead) onReady(set);
  })().catch(() => { if (!dead) onFail(); });
  return () => { dead = true; };
}
