/**
 * Side-view ring for the 2D broadcast. With the STAGE image (public/sprites/ringside2d/stage.webp: cel-shaded ring, back ropes,
 * far corner posts, crowd and lights) the image is the background layer and only the FRONT ropes, the near posts and the apron are
 * drawn over the fighters, in the image's perspective (see STAGE and LANE in geometry.ts: the image is placed so its feet line and
 * ring floor match the fighters' z = 0 and the lane scale). Without it (not loaded or missing) a procedural stage is drawn from
 * the same geometry: a blurred, darkened plate, the painted canvas squashed into the lane, back ropes and far posts.
 * Presentation only.
 */
import { POST, ROPES_MM, POST_TOP_MM, STAGE, APRON_MM, depthK, floorX, floorY, type Cam } from './geometry';

export type Plate = HTMLCanvasElement;
export type Textures = { canvas: HTMLImageElement | null; apron: HTMLImageElement | null; stage: HTMLImageElement | null };
/** White, red, blue from the top rope (as in the stage image). */
const ROPE_COLORS = ['#ece8e0', '#d8322a', '#2c62dc'];
/** Corner pads: KOR orange far-left, AYAZ cyan far-right (as in the image); the near posts are neutral. */
const FAR = [{ x: -POST, color: '#ff7a1c' }, { x: POST, color: '#26b8e8' }] as const;
const NEAR = [{ x: -POST, color: '#d9d4c8' }, { x: POST, color: '#d9d4c8' }] as const;

/** Loads the ring textures: the 2.5D canvas and apron (optional) and the stage image when the manifest names one. */
export function loadTextures(base: string, onUpdate: (t: Textures) => void): { cancel: () => void; stage: (url: string) => void } {
  const t: Textures = { canvas: null, apron: null, stage: null };
  if (typeof Image === 'undefined') return { cancel: () => {}, stage: () => {} };
  let dead = false; const imgs: HTMLImageElement[] = [];
  const load = (key: keyof Textures, url: string) => {
    const img = new Image(); imgs.push(img); img.decoding = 'async';
    img.onload = () => { if (!dead) { t[key] = img; onUpdate({ ...t }); } };
    img.onerror = () => {};
    img.src = url;
  };
  load('canvas', `${base}ring-canvas.webp`); load('apron', `${base}ring-apron.webp`);
  return { cancel: () => { dead = true; for (const i of imgs) { i.onload = null; i.onerror = null; } }, stage: url => load('stage', url) };
}

/** A strongly blurred and darkened copy of the painted plate (a cheap blur: down to a tiny canvas and back up, twice). */
export function softPlate(plate: Plate): Plate {
  const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  const a = mk(Math.round(plate.width / 14), Math.round(plate.height / 14)), ga = a.getContext('2d'); if (!ga) return plate;
  ga.imageSmoothingQuality = 'high'; ga.drawImage(plate, 0, 0, a.width, a.height);
  const b = mk(Math.round(plate.width / 4), Math.round(plate.height / 4)), gb = b.getContext('2d'); if (!gb) return plate;
  gb.imageSmoothingQuality = 'high'; gb.drawImage(a, 0, 0, b.width, b.height);
  gb.fillStyle = 'rgba(4,5,9,.35)'; gb.fillRect(0, 0, b.width, b.height);
  return b;
}

const Y = (cam: Cam, z: number, h: number) => floorY(cam, z) - h * cam.scale * depthK(z);

export function drawBackdrop(g: CanvasRenderingContext2D, cam: Cam, plate: Plate, accent: 'kor' | 'ayaz' | null) {
  const { W, H } = cam, yFar = Y(cam, -POST, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H);
  const pw = plate.width, ph = plate.height, sc = Math.max(W * 1.12 / pw, yFar / (ph * .7)), dw = pw * sc, dh = ph * sc, y0 = yFar - ph * .7 * sc - H * .01;
  g.drawImage(plate, W / 2 - dw / 2 - ((cam.panMm * cam.scale * .04) % dw), y0, dw, dh);
  const yf = y0 + ph * .7 * sc, fl = g.createLinearGradient(0, yf, 0, yf + H * .18);
  fl.addColorStop(0, 'rgba(4,5,7,0)'); fl.addColorStop(1, 'rgba(4,5,7,.94)'); g.fillStyle = fl; g.fillRect(0, yf - 2, W, H);
  for (const [side, rgb] of [[0, '255,122,28'], [1, '38,184,232']] as const) {
    const win = accent === (side === 0 ? 'kor' : 'ayaz') ? .24 : accent ? .04 : .12, cx = side === 0 ? 0 : W, r = g.createRadialGradient(cx, H * .55, 0, cx, H * .55, W * .6);
    r.addColorStop(0, `rgba(${rgb},${win})`); r.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = r; g.fillRect(0, 0, W, H);
  }
}

/** The stage image as the background layer: its feet line (STAGE.feetY) sits on the fighters' z = 0 and its width spans STAGE.widthMm at that line. */
export function drawStage(g: CanvasRenderingContext2D, cam: Cam, img: HTMLImageElement, accent: 'kor' | 'ayaz' | null) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const dw = STAGE.widthMm * cam.scale, dh = dw * ih / iw, x0 = cam.W / 2 - STAGE.cx * dw - cam.panMm * cam.scale + cam.shakeX, y0 = cam.groundY + cam.shakeY - STAGE.feetY * dh;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#07080d'; g.fillRect(0, 0, cam.W, cam.H);
  g.drawImage(img, 0, 0, iw, ih, x0, y0, dw, dh);
  // Above the image (a short or wide stage): a dark fade so the top never shows a cut.
  if (y0 > 0) { const gr = g.createLinearGradient(0, y0 - 2, 0, y0 + 40); gr.addColorStop(0, '#07080d'); gr.addColorStop(1, 'rgba(7,8,13,0)'); g.fillStyle = gr; g.fillRect(0, 0, cam.W, y0 + 40); }
  // The round's winner lights his side.
  if (accent) { const rgb = accent === 'kor' ? '255,122,28' : '38,184,232', cx = accent === 'kor' ? 0 : cam.W, r = g.createRadialGradient(cx, cam.H * .5, 0, cx, cam.H * .5, cam.W * .55); r.addColorStop(0, `rgba(${rgb},.16)`); r.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = r; g.fillRect(0, 0, cam.W, cam.H); }
}

const rope = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string, alpha: number) => {
  g.globalAlpha = alpha; g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = w + 1.5; g.beginPath(); g.moveTo(x0, y0 + 1); g.lineTo(x1, y1 + 1); g.stroke();
  g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = Math.max(.6, w * .28); g.beginPath(); g.moveTo(x0, y0 - w * .22); g.lineTo(x1, y1 - w * .22); g.stroke();
  g.globalAlpha = 1;
};
const post = (g: CanvasRenderingContext2D, cam: Cam, x: number, z: number, color: string) => {
  const sx = floorX(cam, x, z), k = depthK(z) * cam.scale, w = 150 * k, yb = Y(cam, z, 0), yt = Y(cam, z, POST_TOP_MM);
  if (sx < -w * 3 || sx > cam.W + w * 3) return;
  const grad = g.createLinearGradient(sx - w / 2, 0, sx + w / 2, 0); grad.addColorStop(0, '#2a2e36'); grad.addColorStop(.5, '#5b616c'); grad.addColorStop(1, '#1b1e24');
  g.fillStyle = grad; g.fillRect(sx - w / 2, yt, w, yb - yt);
  const pw = 300 * k, py0 = Y(cam, z, POST_TOP_MM - 60), py1 = Y(cam, z, 120);
  g.fillStyle = color; g.beginPath(); g.roundRect(sx - pw / 2, py0, pw, py1 - py0, pw * .18); g.fill();
  const shade = g.createLinearGradient(sx - pw / 2, 0, sx + pw / 2, 0); shade.addColorStop(0, 'rgba(0,0,0,.45)'); shade.addColorStop(.3, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.5)');
  g.fillStyle = shade; g.fill();
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(sx - pw * .3, py0 + 4, pw * .1, py1 - py0 - 8);
};

/** Procedural back pass (only without the stage image): floor, far ropes, far posts, side ropes. */
export function drawRingBack(g: CanvasRenderingContext2D, cam: Cam, tex: Textures) {
  const xl = floorX(cam, -POST, -POST), xr = floorX(cam, POST, -POST), xl2 = floorX(cam, -POST, POST), xr2 = floorX(cam, POST, POST), yf = Y(cam, -POST, 0), yn = Y(cam, POST, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.save(); g.beginPath(); g.moveTo(xl, yf); g.lineTo(xr, yf); g.lineTo(xr2, yn); g.lineTo(xl2, yn); g.closePath(); g.clip();
  const bx = Math.min(xl, xl2), bw = Math.max(xr, xr2) - bx;
  if (tex.canvas) { g.globalAlpha = .9; g.drawImage(tex.canvas, 0, 0, tex.canvas.naturalWidth || tex.canvas.width, tex.canvas.naturalHeight || tex.canvas.height, bx, yf, bw, yn - yf); g.globalAlpha = 1; g.fillStyle = 'rgba(30,26,22,.5)'; } else g.fillStyle = '#4a4540';
  g.fillRect(bx, yf, bw, yn - yf);
  g.restore();
  ROPES_MM.forEach((h, i) => rope(g, xl, Y(cam, -POST, h), xr, Y(cam, -POST, h), Math.max(1.6, 30 * cam.scale * depthK(-POST)), ROPE_COLORS[i]!, .95));
  for (const c of FAR) post(g, cam, c.x, -POST, c.color);
  for (const [xa, xb] of [[xl, xl2], [xr, xr2]] as const) ROPES_MM.forEach((h, i) => rope(g, xa, Y(cam, -POST, h), xb, Y(cam, POST, h), Math.max(1.2, 22 * cam.scale), ROPE_COLORS[i]!, .5));
}

/** Front pass: near ropes (see-through), near posts and the apron skirt below the ring's near edge. */
export function drawRingFront(g: CanvasRenderingContext2D, cam: Cam, tex: Textures) {
  const xl = floorX(cam, -POST, POST), xr = floorX(cam, POST, POST), yn = Y(cam, POST, 0), sk = APRON_MM * cam.scale * depthK(POST);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (yn < cam.H) {
    g.save(); g.beginPath(); g.rect(xl, yn, xr - xl, sk); g.clip();
    if (tex.apron) { const aw = tex.apron.naturalWidth || tex.apron.width, ah = tex.apron.naturalHeight || tex.apron.height; g.drawImage(tex.apron, 0, 0, aw, ah * .34, xl, yn, xr - xl, sk); }
    else { g.fillStyle = '#101319'; g.fillRect(xl, yn, xr - xl, sk); }
    const ag = g.createLinearGradient(0, yn, 0, yn + sk); ag.addColorStop(0, 'rgba(0,0,0,.1)'); ag.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = ag; g.fillRect(xl, yn, xr - xl, sk);
    g.restore();
  }
  ROPES_MM.forEach((h, i) => rope(g, xl, Y(cam, POST, h), xr, Y(cam, POST, h), Math.max(1, 20 * cam.scale * depthK(POST)), ROPE_COLORS[i]!, .3));
  for (const c of NEAR) post(g, cam, c.x, POST, c.color);
}

/** Soft ground shadow under a standing or lying body. */
export function drawShadow(g: CanvasRenderingContext2D, x: number, y: number, rx: number, alpha: number) {
  if (rx < 1) return;
  const ry = rx * .24, sg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  sg.addColorStop(0, `rgba(0,0,0,${alpha})`); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(x, y); g.scale(1, ry / rx); g.fillStyle = sg; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
}
