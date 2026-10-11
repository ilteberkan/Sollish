// Builds the Ringside 2D frame sprites from green-screen sheets.
//   bash scripts/use-node.sh node apps/web/scripts/ringside-frames.mjs            (from the repo root)
//   ANALYZE=1 ... prints the detected grid and per-cell bounds of every sheet and writes nothing.
//   FRAME_SRC=<dir> overrides the source directory (default: .tooling/higgsfield-sprites).
//   FRAME_OUT=<dir> overrides the output directory (default: apps/web/public/sprites/ringside2d).
//   GUARD_PX=<n> sets the guard pose height in output pixels (default 400; lowered automatically to fit the byte budget).
//
// Sources: kor-1.png, kor-2.png, ayaz-1.png, ayaz-2.png (4x4 grids of poses, reading order) and referee.png (4 columns x
// 3 rows) on lime green (about rgb(15-25,235-250,25-35)); every figure faces RIGHT. Layout contract: see
// lib/ringside-2d/animations.ts (FRAME for the fighter cells, REF for the referee cells).
//
// Per sheet: measure the key colour from the borders -> alpha from how green a pixel is (g - max(r, b)) with a soft edge ->
// remove the key colour that bled into edge pixels and cap green at the larger of red and blue (despill) -> find the grid
// (projection profiles: the emptiest column/row inside a window around every equal-division line; equal division when no
// clean gap exists) -> per cell keep the largest figure plus parts that belong to it (gloves, a kicking foot) and drop
// stray neighbours -> trim -> feet anchor (centroid of the lowest opaque rows) -> one scale per character from the guard pose
// -> collision data (body span, head span, strike tip) -> WebP with alpha. Output: <out>/<character>/<n>.webp (n = 1..32 for fighters: sheet 1 = 1..16, sheet 2 = 17..32;
// 1..12 for the referee) and <out>/frames.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const SRC = process.env.FRAME_SRC ?? join(repo, '.tooling/higgsfield-sprites');
const OUT = process.env.FRAME_OUT ?? join(here, '../public/sprites/ringside2d');
const BUDGET = 1.8 * 1024 * 1024;
const ANALYZE = !!process.env.ANALYZE;

/** Body height (mm) the guard pose is scaled to (matches the engine's DIMS: KOR shorter, AYAZ taller). */
const SHEETS = {
  kor: { files: ['kor-1.png', 'kor-2.png', 'kor-3.png'], cols: 4, rows: 4, heightMm: 1750 },
  ayaz: { files: ['ayaz-1.png', 'ayaz-2.png', 'ayaz-3.png'], cols: 4, rows: 4, heightMm: 1860 },
  referee: { files: ['referee.png'], cols: 4, rows: 3, heightMm: 1790 },
};
/** Cells that are not usable in the source art (the renderer aliases them, see FRAME_ALIAS in animations.ts). */
const OMIT = { kor: [16] };
/** Fighter frames where the whole silhouette is the body (falling back, lying on the canvas). */
const FULL_BOX = [28, 29];
/** Sheets with thin near-white cell border lines (wiped before the grid search) and the cell whose figure height is matched to sheet 1's guard. */
const WIPE_LINES = ['ayaz-3.png'];
const SCALE_REF_CELL = { 3: 1 };
const STAGE_SRC = 'stage.png', STAGE_WIDTH = 2400, STAGE_BUDGET = 350 * 1024;
/** Kick and knee frames: the torso is measured higher, above the kicking leg. */
const KICK_CELLS = [17, 18, 19, 20, 21, 22, 23];

// ---- chroma key -------------------------------------------------------------------------------------
async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: data, w: info.width, h: info.height };
}
/** The key colour: median of four patches inset from the corners (clear of any border lines). */
function measureKey({ px, w, h }) {
  const ch = [[], [], []];
  for (const [x0, y0] of [[30, 30], [w - 54, 30], [30, h - 54], [w - 54, h - 54]]) for (let y = y0; y < y0 + 24; y++) for (let x = x0; x < x0 + 24; x++) { const o = (y * w + x) * 4; for (let c = 0; c < 3; c++) ch[c].push(px[o + c]); }
  return ch.map(a => { a.sort((p, q) => p - q); return a[a.length >> 1]; });
}
/** Alpha from greenness m = g - max(r, b): the key gives about 215, art stays near or below 0. Soft edge between 25% and 62% of the key. */
function keyOut(sheet, KEY) {
  const { px, w, h } = sheet, mKey = KEY[1] - Math.max(KEY[0], KEY[2]), hi = mKey * .62, lo = mKey * .25;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, r = px[o], g = px[o + 1], b = px[o + 2], m = g - Math.max(r, b);
    const a = Math.min(1, Math.max(0, (hi - m) / (hi - lo)));
    if (a >= 1) { if (m > 6) px[o + 1] = Math.max(Math.max(r, b), g - Math.round((m - 6) * .8)); px[o + 3] = 255; continue; }
    if (a <= 0) { px[o + 3] = 0; px[o] = px[o + 1] = px[o + 2] = 0; continue; }
    // Remove the key colour that bled into the edge pixel, then cap green at the larger of red and blue.
    const k = 1 - a, c = [r, g, b].map((v, j) => Math.min(255, Math.max(0, (v - k * KEY[j]) / a)));
    c[1] = Math.min(c[1], Math.max(c[0], c[2]));
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round(a * 255);
  }
}
/** Removes the thin border lines drawn on the cell boundaries (and the image edge): everything within 11 px of a boundary (figures keep a wider margin). */
function wipeLines({ px, w, h }, cols, rows) {
  const near = (v, size, n) => { const step = size / n; for (let k = 0; k <= n; k++) if (Math.abs(v - k * step) <= 11) return true; return false; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!(near(x, w, cols) || near(y, h, rows))) continue;
    const o = (y * w + x) * 4;
    px[o + 3] = 0; px[o] = px[o + 1] = px[o + 2] = 0;
  }
}
/** Pulls the last green out of the opaque pixels that touch transparency (a 2 px rim). */
function despillRim({ px, w, h }) {
  const idx = (x, y) => (y * w + x) * 4 + 3;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const o = (y * w + x) * 4;
    if (px[o + 3] === 0) continue;
    if (px[idx(x - 2, y)] < 40 || px[idx(x + 2, y)] < 40 || px[idx(x, y - 2)] < 40 || px[idx(x, y + 2)] < 40) {
      const cap = Math.max(px[o], px[o + 2]);
      if (px[o + 1] > cap) px[o + 1] = cap;
    }
  }
}

// ---- grid detection ---------------------------------------------------------------------------------
/** Boundaries (n + 1 positions) along one axis from a profile of foreground counts. */
function boundaries(profile, n, size) {
  const step = size / n, cuts = [0], win = Math.round(step * .14), clean = [];
  for (let k = 1; k < n; k++) {
    const mid = Math.round(k * step), a = Math.max(1, mid - win), b = Math.min(size - 1, mid + win);
    // longest run of empty lines in the window, else the emptiest line
    let bestRun = 0, runStart = -1, bestMid = -1;
    for (let i = a; i <= b + 1; i++) {
      const empty = i <= b && profile[i] <= 1;
      if (empty && runStart < 0) runStart = i;
      if (!empty && runStart >= 0) { if (i - runStart > bestRun) { bestRun = i - runStart; bestMid = Math.round((runStart + i - 1) / 2); } runStart = -1; }
    }
    if (bestRun >= 3) { cuts.push(bestMid); clean.push(true); }
    else { cuts.push(mid); clean.push(false); }
  }
  cuts.push(size);
  return { cuts, clean };
}
function equalGrid({ w, h }, cols, rows) {
  const cut = (size, n) => Array.from({ length: n + 1 }, (_, k) => Math.round(k * size / n));
  return { xs: cut(w, cols), ys: cut(h, rows), cleanX: [], cleanY: [] };
}
function detectGrid({ px, w, h }, cols, rows) {
  const colP = new Int32Array(w), rowP = new Int32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) { colP[x]++; rowP[y]++; }
  const cx = boundaries(colP, cols, w), cy = boundaries(rowP, rows, h);
  return { xs: cx.cuts, ys: cy.cuts, cleanX: cx.clean, cleanY: cy.clean };
}

// ---- one cell -> trimmed figure ---------------------------------------------------------------------
/** Largest figure plus the pieces that belong to it; returns the cropped RGBA, bounds in the sheet and the feet anchor. */
function extractCell(sheet, x0, y0, x1, y1) {
  const cw = x1 - x0, ch = y1 - y0, N = cw * ch, label = new Int32Array(N), area = [0], bbox = [null];
  const alphaAt = (x, y) => sheet.px[((y0 + y) * sheet.w + x0 + x) * 4 + 3];
  const stack = new Int32Array(N);
  let n = 0;
  for (let s = 0; s < N; s++) {
    if (label[s] || alphaAt(s % cw, (s / cw) | 0) <= 24) continue;
    n++; let sp = 0, count = 0, bx0 = cw, by0 = ch, bx1 = 0, by1 = 0; stack[sp++] = s; label[s] = n;
    while (sp) {
      const p = stack[--sp], px = p % cw, py = (p / cw) | 0; count++;
      if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= cw || qy >= ch) continue;
        const q = qy * cw + qx; if (label[q] || alphaAt(qx, qy) <= 24) continue;
        label[q] = n; stack[sp++] = q;
      }
    }
    area.push(count); bbox.push([bx0, by0, bx1, by1]);
  }
  if (n === 0) return null;
  let main = 1; for (let i = 2; i <= n; i++) if (area[i] > area[main]) main = i;
  const mb = bbox[main], mw = mb[2] - mb[0], mh = mb[3] - mb[1], ex = [mb[0] - mw * .25, mb[1] - mh * .12, mb[2] + mw * .25, mb[3] + mh * .12];
  const keep = new Uint8Array(n + 1); keep[main] = 1;
  for (let i = 1; i <= n; i++) { if (i === main) continue; const b = bbox[i], cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; if (area[i] >= area[main] * .004 && cx >= ex[0] && cx <= ex[2] && cy >= ex[1] && cy <= ex[3]) keep[i] = 1; }
  let tx0 = cw, ty0 = ch, tx1 = 0, ty1 = 0;
  for (let i = 1; i <= n; i++) if (keep[i]) { const b = bbox[i]; tx0 = Math.min(tx0, b[0]); ty0 = Math.min(ty0, b[1]); tx1 = Math.max(tx1, b[2]); ty1 = Math.max(ty1, b[3]); }
  const pad = 3; tx0 = Math.max(0, tx0 - pad); ty0 = Math.max(0, ty0 - pad); tx1 = Math.min(cw - 1, tx1 + pad); ty1 = Math.min(ch - 1, ty1 + pad);
  const w = tx1 - tx0 + 1, h = ty1 - ty0 + 1, out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y + ty0) * cw + x + tx0, l = label[s], o = (y * w + x) * 4, so = (((y0 + y + ty0) * sheet.w) + x0 + x + tx0) * 4;
    // Soft-edge pixels carry no label (alpha <= 24): keep them only next to a kept figure.
    const near = l ? keep[l] : (() => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const qx = x + tx0 + dx, qy = y + ty0 + dy; if (qx < 0 || qy < 0 || qx >= cw || qy >= ch) continue; const ql = label[qy * cw + qx]; if (ql && keep[ql]) return 1; } return 0; })();
    if (!near) continue;
    out[o] = sheet.px[so]; out[o + 1] = sheet.px[so + 1]; out[o + 2] = sheet.px[so + 2]; out[o + 3] = sheet.px[so + 3];
  }
  // Feet anchor: bottom of the lowest opaque rows, horizontally the centroid of the opaque pixels in the lowest band.
  let low = h - 1; while (low > 0) { let any = false; for (let x = 0; x < w && !any; x++) any = out[(low * w + x) * 4 + 3] >= 128; if (any) break; low--; }
  const band = Math.max(3, Math.round(h * .03));
  let sx = 0, sc = 0; for (let y = Math.max(0, low - band); y <= low; y++) for (let x = 0; x < w; x++) if (out[(y * w + x) * 4 + 3] >= 128) { sx += x; sc++; }
  return { rgba: out, w, h, anchor: [sc ? sx / sc : w / 2, low + 1], src: [x0 + tx0, y0 + ty0, w, h] };
}


/**
 * Collision data for a trimmed cell (all in cell px, figure facing right): `body` is the solid torso column span in the band
 * 34%..52% of the figure height (the hurtbox of a body blow; a lying figure uses its whole width), `head` is the extent of the top
 * 16% (the hurtbox of a head blow), `push` is the pushbox: the torso plus 15% of the way to the lead boot (a short punch can still reach a torso; a lying figure: the head-side 62%, so the opponent may stand by his feet), and `tip` is the farthest opaque point on the facing side (glove, foot or knee on a strike frame).
 */
function collision(rgba, w, h, anchorY, full, kick) {
  const op = (x, y) => rgba[(y * w + x) * 4 + 3] >= 128;
  let top = 0; while (top < h - 1) { let any = false; for (let x = 0; x < w && !any; x++) any = op(x, top); if (any) break; top++; }
  const fh = Math.max(1, anchorY - top), span = (y0, y1, solid) => {
    y0 = Math.max(0, Math.round(y0)); y1 = Math.min(h - 1, Math.round(y1));
    const rows = Math.max(1, y1 - y0 + 1), cols = [];
    for (let x = 0; x < w; x++) { let c = 0; for (let y = y0; y <= y1; y++) if (op(x, y)) c++; cols.push(c >= Math.max(1, rows * solid)); }
    // largest run of solid columns, bridging gaps up to 3 px
    let best = [0, w], bestLen = 0, start = -1, gap = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && cols[x]) { if (start < 0) start = x; gap = 0; last = x; }
      else if (start >= 0 && (x === w || ++gap > 3)) { const len = last - start + 1; if (len > bestLen) { bestLen = len; best = [start, last + 1]; } start = -1; gap = 0; }
    }
    return best;
  };
  let last = 0;
  const body = full ? span(0, h - 1, .05) : (kick ? span(top + fh * .2, top + fh * .38, .5) : span(top + fh * .34, top + fh * .52, .5)), head = span(top, top + fh * .16, .2);
  const feet = full ? body : span(top + fh * .82, top + fh * .995, .15), push = full ? [body[0], body[0] + .62 * (body[1] - body[0])] : [body[0], Math.max(body[1], body[1] + .15 * (feet[1] - body[1]))];
  let tx = 0; for (let y = 0; y < h; y++) for (let x = w - 1; x > tx; x--) if (op(x, y)) { tx = x; break; }
  let sy = 0, sc = 0; for (let y = 0; y < h; y++) for (let x = Math.max(0, tx - 4); x <= tx; x++) if (op(x, y)) { sy += y; sc++; break; }
  return { body, head, push, tip: [tx + 1, sc ? sy / sc : h / 2] };
}

async function encode(cell, scale, quality) {
  const w = Math.max(1, Math.round(cell.w * scale)), h = Math.max(1, Math.round(cell.h * scale));
  const buf = await sharp(cell.rgba, { raw: { width: cell.w, height: cell.h, channels: 4 } }).resize(w, h, { kernel: 'lanczos3' }).webp({ quality, alphaQuality: 92, effort: 6, smartSubsample: true }).toBuffer();
  const kx = w / cell.w, ky = h / cell.h, r1 = v => +v.toFixed(1), c = cell.collision;
  return { buf, w, h, anchor: [cell.anchor[0] * kx, cell.anchor[1] * ky], body: c.body.map(v => r1(v * kx)), head: c.head.map(v => r1(v * kx)), push: c.push.map(v => r1(v * kx)), tip: [r1(c.tip[0] * kx), r1(c.tip[1] * ky)] };
}

async function main() {
  const chars = {};
  for (const [name, spec] of Object.entries(SHEETS)) {
    const cells = [];
    for (let s = 0; s < spec.files.length; s++) {
      const file = join(SRC, spec.files[s]);
      if (!existsSync(file)) throw new Error(`missing source sheet ${file}`);
      const sheet = await load(file), KEY = measureKey(sheet); keyOut(sheet, KEY); if (WIPE_LINES.includes(spec.files[s])) wipeLines(sheet, spec.cols, spec.rows); despillRim(sheet);
      // Sheets with drawn border lines use equal division (the lines sit on it); the others use the profile search.
      const grid = WIPE_LINES.includes(spec.files[s]) ? equalGrid(sheet, spec.cols, spec.rows) : detectGrid(sheet, spec.cols, spec.rows);
      if (ANALYZE) console.log(name, spec.files[s], `${sheet.w}x${sheet.h}`, 'key', KEY.join(','), 'xs', grid.xs.join(','), grid.cleanX.join('') , 'ys', grid.ys.join(','), grid.cleanY.join(''));
      for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.cols; c++) {
        const cell = r * spec.cols + c + 1, n = s * spec.cols * spec.rows + cell;
        if ((OMIT[name] ?? []).includes(n)) continue;
        const fig = extractCell(sheet, grid.xs[c], grid.ys[r], grid.xs[c + 1], grid.ys[r + 1]);
        if (!fig) throw new Error(`${name} sheet ${s + 1} cell ${cell}: no figure found`);
        if (ANALYZE) console.log(`  ${name} ${n}`.padEnd(12), `${fig.w}x${fig.h}`, 'anchor', fig.anchor.map(v => Math.round(v)).join(','));
        fig.collision = collision(fig.rgba, fig.w, fig.h, fig.anchor[1], name !== 'referee' && FULL_BOX.includes(n), name !== 'referee' && KICK_CELLS.includes(n));
        cells.push({ n, sheet: s + 1, cell, fig });
      }
    }
    chars[name] = { spec, cells };
  }
  if (ANALYZE) return;
  // One scale per character from the guard pose (frame 1): the guard is GUARD_PX tall for everybody, so AYAZ's extra height
  // comes from heightMm (mmPerPx), exactly as the engine sizes the fighters.
  let guardPx = Number(process.env.GUARD_PX ?? 400), quality = 74, result;
  for (let attempt = 0; attempt < 12; attempt++) {
    const manifest = { version: 1, characters: {} }; let total = 0; const files = [];
    for (const [name, { spec, cells }] of Object.entries(chars)) {
      const guard = cells.find(c => c.n === 1).fig, scale = guardPx / (guard.anchor[1] - 3), frames = {};
      // Each later sheet is scaled so its reference figure (a standing pose) is as tall as sheet 1's guard: one size per character.
      const factor = { 1: 1, 2: 1 };
      for (const [sh, cellNo] of Object.entries(SCALE_REF_CELL)) { const ref = cells.find(c => c.sheet === Number(sh) && c.cell === cellNo); if (ref) factor[sh] = (guard.anchor[1] - 3) / (ref.fig.anchor[1] - 3); }
      if (attempt === 0) console.log(name, 'sheet scale factors', JSON.stringify(factor));
      for (const c of cells) {
        const e = await encode(c.fig, scale * (factor[c.sheet] ?? 1), quality);
        frames[String(c.n)] = { w: e.w, h: e.h, anchor: [+e.anchor[0].toFixed(1), +e.anchor[1].toFixed(1)], body: e.body, head: e.head, push: e.push, tip: e.tip, sheet: c.sheet, cell: c.cell, src: c.fig.src };
        files.push([join(name, `${c.n}.webp`), e.buf]); total += e.buf.length;
      }
      // One stable push box per character (the median over the standing frames): a pose change never moves a fighter.
      const med = a => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
      const standing = Object.entries(frames).filter(([n]) => name === 'referee' || !FULL_BOX.includes(Number(n))).map(([, f]) => f), mmPerPx = spec.heightMm / guardPx;
      manifest.characters[name] = { facing: 'right', heightMm: spec.heightMm, guardHeightPx: guardPx, mmPerPx: +mmPerPx.toFixed(4), scale: +scale.toFixed(5), pushFront: Math.round(med(standing.map(f => (f.push[1] - f.anchor[0]) * mmPerPx))), pushBack: Math.round(med(standing.map(f => (f.anchor[0] - f.push[0]) * mmPerPx))), frames };
    }
    result = { manifest, files, total };
    console.log(`guard ${guardPx}px, quality ${quality}: ${(total / 1024).toFixed(0)} KB`);
    if (total <= BUDGET) break;
    if (quality > 58) quality -= 6; else { guardPx = Math.round(guardPx * .9); quality = 66; }
  }
  if (result.total > BUDGET) throw new Error(`over the ${BUDGET} byte budget: ${result.total}`);
  rmSync(OUT, { recursive: true, force: true });
  for (const name of Object.keys(chars)) mkdirSync(join(OUT, name), { recursive: true });
  for (const [rel, buf] of result.files) writeFileSync(join(OUT, rel), buf);
  result.manifest.totalBytes = result.total;
  if (existsSync(join(SRC, STAGE_SRC))) {
    let q = 84, buf;
    for (; q >= 50; q -= 6) { buf = await sharp(join(SRC, STAGE_SRC)).resize({ width: STAGE_WIDTH }).webp({ quality: q, effort: 6 }).toBuffer(); if (buf.length <= STAGE_BUDGET) break; }
    if (buf.length > STAGE_BUDGET) throw new Error(`stage over budget: ${buf.length}`);
    const m = await sharp(buf).metadata();
    writeFileSync(join(OUT, 'stage.webp'), buf);
    result.manifest.stage = { file: 'stage.webp', w: m.width, h: m.height, bytes: buf.length };
    console.log(`stage ${m.width}x${m.height} q${q}: ${(buf.length / 1024).toFixed(0)} KB`);
  }
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify(result.manifest));
  console.log(`wrote ${result.files.length} frames to ${OUT} (${(result.total / 1024).toFixed(0)} KB)`);
}
main().catch(e => { console.error(e); process.exit(1); });
