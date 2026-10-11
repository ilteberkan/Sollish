/**
 * Frame sprites of the 2D broadcast. Built by apps/web/scripts/ringside-frames.mjs from green-screen sheets (or procedural
 * placeholders until the sheets exist) into public/sprites/ringside2d/<character>/<n>.webp plus frames.json:
 * per frame { w, h } (px), the feet anchor [x, y] in frame px (bottom-centre of the lowest opaque rows), and where the frame
 * came from ({ sheet, cell, src }). `guardHeightPx` is the guard pose's height after the common per-character scale
 * (`scale` = output px per source px); `mmPerPx` maps a frame px to engine mm so every pose keeps the character's size.
 * Presentation only.
 */
import type { Facing } from './geometry';
import { FRAME_ALIAS } from './animations';

export type CharKey = 'kor' | 'ayaz' | 'referee';
export const CHARACTERS: readonly CharKey[] = ['kor', 'ayaz', 'referee'];
/** `body` = torso span (hurtbox of a body blow), `head` = head span (hurtbox of a head blow), `push` = pushbox, all as [x0, x1] frame px with the figure facing right; `tip` = the farthest opaque point on the facing side [x, y]. */
export type FrameMeta = { w: number; h: number; anchor: [number, number]; body: [number, number]; head: [number, number]; push: [number, number]; tip: [number, number]; sheet: number; cell: number; src?: [number, number, number, number] };
export type CharacterMeta = { /** stable push box (mm in front of and behind the feet) used by the display simulation */ pushFront: number; pushBack: number; facing: 'right' | 'left'; heightMm: number; guardHeightPx: number; mmPerPx: number; scale: number; placeholder?: boolean; frames: Record<string, FrameMeta> };
export type FramesManifest = { version: 1; characters: Record<CharKey, CharacterMeta>; totalBytes?: number; stage?: { file: string; w: number; h: number; bytes: number } };
export type FrameSet = { manifest: FramesManifest; imgs: Record<CharKey, (CanvasImageSource & { width: number; height: number } | undefined)[]>; loaded: number; total: number };

export function validManifest(m: unknown): m is FramesManifest {
  const x = m as FramesManifest | null;
  if (!x || x.version !== 1 || !x.characters) return false;
  return CHARACTERS.every(c => { const ch = x.characters[c]; return ch && ch.mmPerPx > 0 && ch.frames && Object.keys(ch.frames).length > 0; });
}

/** Loads frames.json and then every frame image; `onReady` fires as soon as the manifest is known (frames not yet loaded are skipped when drawing). */
export function loadFrames(base: string, onReady: (set: FrameSet) => void, onFail: () => void): () => void {
  if (typeof fetch === 'undefined' || typeof Image === 'undefined') { onFail(); return () => {}; }
  let dead = false;
  fetch(`${base}frames.json`).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((m: unknown) => {
    if (dead) return;
    if (!validManifest(m)) throw new Error('frames.json schema');
    const set: FrameSet = { manifest: m, imgs: { kor: [], ayaz: [], referee: [] }, loaded: 0, total: 0 };
    for (const c of CHARACTERS) for (const n of Object.keys(m.characters[c].frames)) {
      set.total++;
      const img = new Image(); img.decoding = 'async';
      const done = () => { img.onload = null; img.onerror = null; set.loaded++; };
      img.onload = () => { set.imgs[c][Number(n)] = img; done(); };
      img.onerror = done;
      img.src = `${base}${c}/${n}.webp`;
    }
    onReady(set);
  }).catch(() => { if (!dead) onFail(); });
  return () => { dead = true; };
}

/** Mip chain: `mips[l]` is the image downscaled by 2^l with progressive halving, so a sprite drawn small is never shimmery. */
const mipCache = new WeakMap<object, CanvasImageSource[]>();
function mipFor(img: CanvasImageSource & { width: number; height: number }, level: number): CanvasImageSource & { width: number; height: number } {
  if (level <= 0 || typeof document === 'undefined') return img;
  let chain = mipCache.get(img); if (!chain) { chain = [img]; mipCache.set(img, chain); }
  for (let l = chain.length; l <= level; l++) {
    const prev = chain[l - 1] as CanvasImageSource & { width: number; height: number }, c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(prev.width / 2)); c.height = Math.max(1, Math.round(prev.height / 2));
    const g = c.getContext('2d'); if (!g) return img;
    g.imageSmoothingQuality = 'high'; g.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, c.width, c.height);
    chain.push(c);
  }
  return chain[level] as CanvasImageSource & { width: number; height: number };
}

/** The frame number to draw for `n`: itself, or the character's alias when its sheet has no usable cell. */
export function resolveFrame(set: FrameSet, who: CharKey, n: number): number {
  const ch = set.manifest.characters[who];
  return ch.frames[String(n)] ? n : FRAME_ALIAS[who]?.[n] ?? 1;
}

/**
 * Draws frame `n` standing on (footX, footY). `pxPerMm` is the screen scale including the depth factor; `dir` is the side
 * the fighter faces on screen. Returns false when the frame image is not available (the caller draws a silhouette).
 */
export function drawFrame(g: CanvasRenderingContext2D, set: FrameSet, who: CharKey, n: number, footX: number, footY: number, pxPerMm: number, dir: Facing, o: { alpha?: number; sx?: number; sy?: number; /** lean in rad, positive toward the side he faces */ lean?: number; /** screen px the whole sprite is lifted */ lift?: number } = {}): boolean {
  const ch = set.manifest.characters[who], num = resolveFrame(set, who, n), meta = ch.frames[String(num)], img0 = set.imgs[who][num];
  if (!meta || !img0) return false;
  const f = pxPerMm * ch.mmPerPx, flip = (ch.facing === 'right') !== (dir === 1);
  const level = f < .6 ? Math.min(4, Math.floor(Math.log2(.6 / Math.max(f, 1e-4)) + 1)) : 0, img = mipFor(img0, level);
  g.save();
  if (o.alpha !== undefined && o.alpha < 1) g.globalAlpha *= o.alpha;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.translate(footX, footY - (o.lift ?? 0)); if (o.lean) g.rotate(o.lean * dir); g.scale((flip ? -1 : 1) * (o.sx ?? 1), o.sy ?? 1);
  g.drawImage(img, 0, 0, img.width, img.height, -meta.anchor[0] * f, -meta.anchor[1] * f, meta.w * f, meta.h * f);
  g.restore();
  return true;
}
/** Frame height in screen px (for the selection chips and flashes). */
export const frameHeightPx = (set: FrameSet, who: CharKey, pxPerMm: number) => set.manifest.characters[who].guardHeightPx * set.manifest.characters[who].mmPerPx * pxPerMm;

/** Frame metadata for `who`'s frame `n` (aliases resolved), or null when the set is not loaded. */
export function metaOf(manifest: FramesManifest, who: CharKey, n: number): FrameMeta | null {
  const ch = manifest.characters[who];
  return ch.frames[String(n)] ?? ch.frames[String(FRAME_ALIAS[who]?.[n] ?? 1)] ?? null;
}
