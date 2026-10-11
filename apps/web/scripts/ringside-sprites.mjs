// Builds the Ringside cutout sprites from the approved Higgsfield part sheets.
//   bash scripts/use-node.sh node apps/web/scripts/ringside-sprites.mjs            (from the repo root)
//   ANALYZE=1 ... prints the connected components found in each sheet and exits.
//   SPRITE_SRC=<dir> overrides the source directory (default: .tooling/higgsfield-20261010).
//
// Source art (see PROVENANCE.md in the source directory): kor-parts.png, ayaz-parts.png, referee-parts.png (2048x2048,
// strict right-facing profile, separate parts on flat green rgb(17,244,27)), ring-canvas.png (top-down canvas with orange
// and cyan corner wedges) and ring-apron.png (skirt strip).
//
// Per sheet: chroma-key the green (soft edge, key decontamination, despill) -> label connected components -> assign each
// to a named part by layout (the PART_RULES table below) -> crop, downscale, write trimmed WebP with alpha plus parts.json:
// { size: [w, h], anchors: { prox: [x, y], dist: [x, y] } } in part pixels. The anchors are the two joints the part is
// drawn between at runtime (the part is rotated and scaled so prox lands on the parent joint and dist on the child joint).
// They are derived from the silhouette by ANCHOR_RULES and can be overridden by hand in ANCHOR_OVERRIDES.
//
// Mapping notes: AYAZ's sheet has no thigh, so the KOR thigh is colour-matched to AYAZ's skin (per-channel gain from the
// two shins). AYAZ's shin and boot are one piece, and the referee's shoe is joined to one trouser leg; for those the
// "boot" part is absent and the merged part carries its own foot (the runtime draws it as part of the shin).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const SRC = process.env.SPRITE_SRC ?? join(repo, '.tooling/higgsfield-20261010');
const OUT = join(here, '../public/sprites/ringside');
const SCALE = 0.5; // sheet pixels -> sprite pixels (about 700 px per metre for a fighter: sharp at 2x devicePixelRatio and when zoomed in)
const KEY = [17, 244, 27];

// ---- chroma key -------------------------------------------------------------------------------------
async function load(file) {
  const { data, info } = await sharp(join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: data, w: info.width, h: info.height };
}
/** Alpha from how green a pixel is (g - max(r,b): 217 for the key, near or below 0 for art); decontaminate and despill edges. */
function keyOut({ px, w, h }) {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, r = px[o], g = px[o + 1], b = px[o + 2], m = g - Math.max(r, b);
    const a = Math.min(1, Math.max(0, (135 - m) / (135 - 55)));
    if (a >= 1 && m < 12) { px[o + 3] = 255; continue; }
    if (a <= 0) { px[o + 3] = 0; px[o] = px[o + 1] = px[o + 2] = 0; continue; }
    // Remove the key colour that bled into the edge pixel, then cap green at the larger of red and blue.
    const k = 1 - a, c = [r, g, b].map((v, j) => Math.min(255, Math.max(0, (v - k * KEY[j]) / a)));
    c[1] = Math.min(c[1], Math.max(c[0], c[2]));
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round(a * 255);
  }
}
function components({ px, w, h }, minArea) {
  const label = new Int32Array(w * h), comps = []; let next = 0;
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (label[s] || px[s * 4 + 3] < 128) continue;
    const id = ++next; let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
    stack[sp++] = s; label[s] = id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w; area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx; if (!label[q] && px[q * 4 + 3] >= 128) { label[q] = id; stack[sp++] = q; }
      }
    }
    comps.push({ id, area, x0, y0, x1, y1, cx: sx / area, cy: sy / area });
  }
  return { label, comps: comps.filter(c => c.area >= minArea) };
}

// ---- layout -> part names ----------------------------------------------------------------------------
// Sheets are laid out the same way: head top-left, torso and shorts below it on the left, upper arm and forearm on the right,
// legs and boot along the bottom. Centroids are relative to the sheet (0..1).
const PART_RULES = {
  fighter: (cs, W, H) => {
    const rel = c => ({ ...c, fx: c.cx / W, fy: c.cy / H, bw: c.x1 - c.x0 + 1, bh: c.y1 - c.y0 + 1 }), r = cs.map(rel), out = {};
    const take = (name, pick) => { const c = r.filter(c => !Object.values(out).includes(c)).filter(pick).sort((a, b) => b.area - a.area)[0]; if (c) out[name] = c; };
    take('head', c => c.fy < .25 && c.fx < .5);
    take('forearm', c => c.fx > .55 && c.fy > .3 && c.fy < .6 && c.bw > c.bh);
    take('boot', c => c.fy > .7 && c.bw > c.bh * .9 && c.y1 > H * .85 && c.bw < W * .25);
    take('torso', c => c.fx < .4 && c.fy > .2 && c.fy < .7); // torso and shorts touch in the sheets: one component, split below
    take('upperArm', c => c.fx > .38 && c.fx < .6 && c.fy < .55 && c.bh > c.bw);
    const legs = r.filter(c => !Object.values(out).includes(c) && c.fy > .55).sort((a, b) => a.cx - b.cx);
    if (legs.length >= 2) { out.thigh = legs[0]; out.shin = legs[1]; } else if (legs.length === 1) out.shin = legs[0];
    return out;
  },
  referee: (cs, W, H) => {
    const r = cs.map(c => ({ ...c, fx: c.cx / W, fy: c.cy / H, bw: c.x1 - c.x0 + 1, bh: c.y1 - c.y0 + 1 })), out = {};
    const take = (name, pick) => { const c = r.filter(c => !Object.values(out).includes(c)).filter(pick).sort((a, b) => b.area - a.area)[0]; if (c) out[name] = c; };
    take('head', c => c.fy < .25 && c.fx < .5);
    take('torso', c => c.fx < .45 && c.fy > .25);
    take('upperArm', c => c.fx > .5 && c.fy < .4 && c.fx < .7);
    take('forearm', c => c.fx > .7 && c.fy < .5);
    const legs = r.filter(c => !Object.values(out).includes(c) && c.fy > .45).sort((a, b) => a.cx - b.cx);
    if (legs[0]) out.thigh = legs[0]; if (legs[1]) out.shin = legs[1]; // the second leg carries the shoe
    return out;
  },
};

// ---- anchors -------------------------------------------------------------------------------------------
// A region is a band of the bounding box along an axis (fractions, from the min side); the anchor is the centroid of the
// part's pixels inside it. `at: [fx, fy]` pins a point as fractions of the bounding box instead.
const band = (axis, from, to) => ({ axis, from, to });
const ANCHOR_RULES = {
  head: { prox: band('y', .8, 1), dist: { at: [null, .6], x: band('y', .2, .7) } },
  torso: { prox: band('y', .94, 1), dist: band('y', 0, .06) },
  shorts: { prox: band('y', 0, .06), dist: band('y', .94, 1) },
  upperArm: { prox: { at: [null, .13], x: band('y', .05, .25) }, dist: band('y', .95, 1) },
  forearm: { prox: band('x', 0, .05), dist: band('x', .66, 1) },
  thigh: { prox: band('y', 0, .05), dist: band('y', .95, 1) },
  shin: { prox: band('y', 0, .05), dist: band('y', .95, 1) },
  boot: { prox: { at: [null, .6], x: band('y', 0, .15) }, dist: { at: [null, .8], x: band('x', .96, 1) } },
};
// Hand-tuned overrides per character and part, as fractions of the part's (trimmed) size. Anything not listed is derived.
const ANCHOR_OVERRIDES = {
  referee: {
    torso: { prox: [.5, .8], dist: [.55, .03] }, // shirt, belt and hips are one piece: the hip joint sits at the belt line
    forearm: { prox: [.35, .02], dist: [.5, .88] }, // forearm and hand hang down
    shin: { prox: [.5, .02], dist: [.45, .86] }, // trouser leg with the shoe attached
    thigh: { prox: [.5, .02], dist: [.5, .98] },
  },
  ayaz: {
    shin: { prox: [.5, .02], dist: [.4, .72] }, // calf and boot are one piece: the ankle is inside the boot
  },
};

// Extra joints inside a part, as fractions of its size: where the arms hang from. The torso art has its deltoid well behind the
// neck stub, so the runtime hangs both arms from this point instead of the skeleton's shoulder joint.
const EXTRA_JOINTS = { kor: { torso: { shoulder: [.3, .27] } }, ayaz: { torso: { shoulder: [.33, .27] } }, referee: { torso: { shoulder: [.27, .18] } } };
function centroid(part, region) {
  const { px, w, h } = part; let sx = 0, sy = 0, n = 0;
  const axis = region.axis, from = region.from, to = region.to;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] < 128) continue;
    const t = axis === 'y' ? y / (h - 1) : x / (w - 1);
    if (t < from || t > to) continue;
    sx += x; sy += y; n++;
  }
  return n ? [sx / n, sy / n] : [w / 2, h / 2];
}
function anchor(part, spec) {
  if (spec.at) { const [fx, fy] = spec.at, c = spec.x ? centroid(part, spec.x) : [part.w / 2, part.h / 2]; return [fx === null ? c[0] : fx * (part.w - 1), fy === null ? c[1] : fy * (part.h - 1)]; }
  return centroid(part, spec);
}

// Torso and shorts are one component in both fighter sheets. Cut at the top of the waistband (a fraction of the component
// height); the torso keeps a few more rows and the shorts a few rows above the cut so the seam is always covered.
const SPLIT = { kor: .5, ayaz: .5, overlap: .035 };
function rows(part, f0, f1) {
  const y0 = Math.floor(part.h * f0), y1 = Math.min(part.h, Math.ceil(part.h * f1)), h = y1 - y0;
  return { px: Buffer.from(part.px.subarray(y0 * part.w * 4, y1 * part.w * 4)), w: part.w, h };
}
const trimAlpha = part => { let x0 = part.w, x1 = -1, y0 = part.h, y1 = -1; for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) if (part.px[(y * part.w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } const w = x1 - x0 + 1, h = y1 - y0 + 1, px = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) part.px.copy(px, y * w * 4, ((y0 + y) * part.w + x0) * 4, ((y0 + y) * part.w + x1 + 1) * 4); return { px, w, h }; };

// KOR's torso art has the whole near arm baked in, hanging at the side with a flat cut: it would stay behind the animated arm as
// a stump. Erased by polygon (fractions of the torso part's bounding box, measured on the trimmed part).
const ERASE = { kor: { torso: [[0, .40], [.43, .44], [.52, .54], [.545, .65], [.50, .76], [.44, .83], [.30, .87], [0, .87]] } };
function erase(part, poly) {
  const inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) if (inside(x / (part.w - 1), y / (part.h - 1))) { const o = (y * part.w + x) * 4; part.px[o] = part.px[o + 1] = part.px[o + 2] = part.px[o + 3] = 0; }
  return trimAlpha(part);
}

// ---- crop + write ----------------------------------------------------------------------------------------
function crop(sheet, labels, comp, pad = 3) {
  const x0 = Math.max(0, comp.x0 - pad), y0 = Math.max(0, comp.y0 - pad), x1 = Math.min(sheet.w - 1, comp.x1 + pad), y1 = Math.min(sheet.h - 1, comp.y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y, si = (sy * sheet.w + sx) * 4, id = labels[sy * sheet.w + sx];
    // Keep this component and soft edge pixels next to it; drop other components' pixels.
    let keep = id === comp.id;
    if (!keep && id === 0 && sheet.px[si + 3] > 0) for (let dy = -3; dy <= 3 && !keep; dy++) for (let dx = -3; dx <= 3; dx++) { const qx = sx + dx, qy = sy + dy; if (qx >= 0 && qy >= 0 && qx < sheet.w && qy < sheet.h && labels[qy * sheet.w + qx] === comp.id) { keep = true; break; } }
    if (!keep) continue;
    const o = (y * w + x) * 4; px[o] = sheet.px[si]; px[o + 1] = sheet.px[si + 1]; px[o + 2] = sheet.px[si + 2]; px[o + 3] = sheet.px[si + 3];
  }
  return { px, w, h };
}
const meanSkin = (part, y0 = 0, y1 = 1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = Math.floor(part.h * y0); y < Math.floor(part.h * y1); y++) for (let x = 0; x < part.w; x++) { const o = (y * part.w + x) * 4; if (part.px[o + 3] > 250) { r += part.px[o]; g += part.px[o + 1]; b += part.px[o + 2]; n++; } } return [r / n, g / n, b / n]; };

/** Width of the silhouette across the part's axis at an anchor (px): march both ways until the alpha drops. */
function widthAt(part, p, other) {
  // Measured 6% of the bone inside the anchor: the anchors sit on the very end of the silhouette.
  const ux = other[0] - p[0], uy = other[1] - p[1], l = Math.hypot(ux, uy) || 1, vx = -uy / l, vy = ux / l;
  p = [p[0] + ux * .06, p[1] + uy * .06];
  const alpha = (x, y) => { const ix = Math.round(x), iy = Math.round(y); return ix < 0 || iy < 0 || ix >= part.w || iy >= part.h ? 0 : part.px[(iy * part.w + ix) * 4 + 3]; };
  let a = 0, b = 0; while (a < 600 && alpha(p[0] + vx * (a + 1), p[1] + vy * (a + 1)) > 128) a++; while (b < 600 && alpha(p[0] - vx * (b + 1), p[1] - vy * (b + 1)) > 128) b++;
  return a + b + 1;
}
async function trimmedScaled(part) {
  const img = sharp(part.px, { raw: { width: part.w, height: part.h, channels: 4 } });
  const w = Math.max(8, Math.round(part.w * SCALE)), h = Math.max(8, Math.round(part.h * SCALE));
  const { data, info } = await img.resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  return { px: data, w: info.width, h: info.height };
}
async function writePart(dir, name, part) {
  const file = join(dir, `${name}.webp`);
  await sharp(part.px, { raw: { width: part.w, height: part.h, channels: 4 } }).webp({ quality: 84, alphaQuality: 92, effort: 5 }).toFile(file);
  return statSync(file).size;
}

const CHARACTERS = [{ id: 'kor', sheet: 'kor-parts.png', kind: 'fighter' }, { id: 'ayaz', sheet: 'ayaz-parts.png', kind: 'fighter' }, { id: 'referee', sheet: 'referee-parts.png', kind: 'referee' }];
const sheets = {};
for (const ch of CHARACTERS) {
  const sheet = await load(ch.sheet); keyOut(sheet);
  const { label, comps } = components(sheet, 6000); sheets[ch.id] = { sheet, label, comps };
  if (process.env.ANALYZE) { console.log(ch.id, comps.map(c => `[${c.x0},${c.y0} ${c.x1 - c.x0 + 1}x${c.y1 - c.y0 + 1} a${c.area}]`).join(' ')); }
}
if (process.env.ANALYZE) process.exit(0);

let total = 0; const manifest = { version: 1, scale: SCALE, source: 'Higgsfield GPT Image 2 part sheets (approved 10 Oct 2026), chroma-keyed by apps/web/scripts/ringside-sprites.mjs', characters: {} };
const parts = {}; // id -> name -> scaled part
for (const ch of CHARACTERS) {
  const { sheet, label, comps } = sheets[ch.id], map = PART_RULES[ch.kind](comps, sheet.w, sheet.h);
  const raw = {}; for (const [name, comp] of Object.entries(map)) raw[name] = crop(sheet, label, comp);
  if (ch.kind === 'fighter') { const body = raw.torso, cut = SPLIT[ch.id]; raw.torso = trimAlpha(rows(body, 0, cut + SPLIT.overlap)); raw.shorts = trimAlpha(rows(body, cut - SPLIT.overlap, 1)); }
  for (const [name, poly] of Object.entries(ERASE[ch.id] ?? {})) raw[name] = erase(raw[name], poly);
  parts[ch.id] = raw;
}
// AYAZ has no thigh: take KOR's and match the skin tone (per-channel gain from the two shins' bare skin).
{
  const korShin = meanSkin(parts.kor.shin, .1, .9), ayazCalf = meanSkin(parts.ayaz.shin, .02, .38), gain = ayazCalf.map((v, i) => v / korShin[i]);
  const t = { w: parts.kor.thigh.w, h: parts.kor.thigh.h, px: Buffer.from(parts.kor.thigh.px) };
  for (let i = 0; i < t.w * t.h; i++) for (let j = 0; j < 3; j++) t.px[i * 4 + j] = Math.min(255, Math.round(t.px[i * 4 + j] * gain[j]));
  parts.ayaz.thigh = t;
}
for (const ch of CHARACTERS) {
  const dir = join(OUT, ch.id); mkdirSync(dir, { recursive: true });
  const entry = { parts: {}, order: [] };
  for (const [name, raw] of Object.entries(parts[ch.id])) {
    const scaled = await trimmedScaled(raw);
    const rules = ANCHOR_RULES[name], over = ANCHOR_OVERRIDES[ch.id]?.[name];
    const prox = over?.prox ? [over.prox[0] * (scaled.w - 1), over.prox[1] * (scaled.h - 1)] : anchor(scaled, rules.prox);
    const dist = over?.dist ? [over.dist[0] * (scaled.w - 1), over.dist[1] * (scaled.h - 1)] : anchor(scaled, rules.dist);
    const bytes = await writePart(dir, name, scaled); total += bytes;
    const skin = meanSkin(scaled, 0, 1).map(Math.round), extra = {};
    for (const [k, f] of Object.entries(EXTRA_JOINTS[ch.id]?.[name] ?? {})) extra[k] = [+(f[0] * (scaled.w - 1)).toFixed(1), +(f[1] * (scaled.h - 1)).toFixed(1)];
    entry.parts[name] = { file: `${name}.webp`, size: [scaled.w, scaled.h], anchors: { prox: prox.map(v => +v.toFixed(1)), dist: dist.map(v => +v.toFixed(1)) }, width: { prox: widthAt(scaled, prox, dist), dist: widthAt(scaled, dist, prox) }, color: skin, ...(Object.keys(extra).length ? { extra } : {}), bytes };
  }
  manifest.characters[ch.id] = entry;
  console.log(ch.id, Object.keys(entry.parts).join(','));
}
manifest.totalBytes = total;

// ---- ring canvas and apron ----------------------------------------------------------------------------
const canvasFile = join(OUT, 'ring-canvas.webp'), apronFile = join(OUT, 'ring-apron.webp');
// The canvas sheet is wider than the square ring: use the central square (it holds the double ring and no corner wedge, which
// the scene draws itself so they sit on the real corners). 1240 of 1520 rows are used for the full circle plus margin.
await sharp(join(SRC, 'ring-canvas.png')).extract({ left: Math.round((2688 - 1240) / 2), top: Math.round((1520 - 1240) / 2), width: 1240, height: 1240 }).resize(768).webp({ quality: 74, effort: 5 }).toFile(canvasFile);
{
  // The apron sheet is a dark strip with black above it: crop to the content rows.
  const { data, info } = await sharp(join(SRC, 'ring-apron.png')).raw().toBuffer({ resolveWithObject: true });
  let top = 0; for (let y = 0; y < info.height; y++) { let sum = 0; for (let x = 0; x < info.width; x += 8) { const o = (y * info.width + x) * info.channels; sum += data[o] + data[o + 1] + data[o + 2]; } if (sum / (info.width / 8) > 24) { top = Math.max(0, y - 2); break; } }
  await sharp(join(SRC, 'ring-apron.png')).extract({ left: 0, top, width: info.width, height: info.height - top }).resize(1344).webp({ quality: 78, effort: 5 }).toFile(apronFile);
  manifest.apron = { file: 'ring-apron.webp', cropTop: top };
}
manifest.canvas = { file: 'ring-canvas.webp', note: 'central square crop; the ring circle spans 88% of it' };
for (const f of [canvasFile, apronFile]) if (statSync(f).size > 400 * 1024) throw new Error(`${f} is over 400 KB`);
if (total > 1.5 * 1024 * 1024) throw new Error(`sprite payload ${total} bytes is over 1.5 MB`);
manifest.ringBytes = { canvas: statSync(canvasFile).size, apron: statSync(apronFile).size };
writeFileSync(join(OUT, 'parts.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ characterBytes: total, ...manifest.ringBytes }));
void existsSync;
