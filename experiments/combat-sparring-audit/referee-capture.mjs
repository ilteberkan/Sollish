// Usage: node experiments/combat-sparring-audit/referee-capture.mjs ops/evidence/ringside-referee-20261004 http://127.0.0.1:3000 1280 720 after-desktop-1280x720 (run through scripts/dev/with-lock.mjs browser).
// Real-scene referee capture (headless Chromium, Metal/ANGLE GPU WebGL): one bout with scripted corners through
// round 1, the break and a round-2 knockdown count. Usage: node capture-referee.mjs <outDir> <baseUrl> <w> <h> <label>
import { chromium } from '/Users/macmini/Desktop/Sollish/apps/web/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [outDir, base, w, h, label] = process.argv.slice(2);
const out = resolve(outDir, label); await mkdir(out, { recursive: true });
const width = Number(w), height = Number(h);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width, height } } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 300))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
// Two corner changes each advance the seed by one (reset), so seed=0 plays bout seed 2 (knockdown early in round 2).
await page.goto(base + '/lab/ringside/play?seed=0&probe=1', { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.locator('canvas[data-renderer="webgl-sparring"]').waitFor({ timeout: 120_000 });
const gl = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const i = g?.getExtension('WEBGL_debug_renderer_info'); return i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
await page.getByLabel('KOR köşe stili').selectOption('balanced'); await page.getByLabel('AYAZ köşe stili').selectOption('pressure');
const start = page.getByRole('button', { name: /Dövüşü başlat/ });
await start.waitFor({ timeout: 120_000 }); for (let i = 0; i < 120 && await start.isDisabled(); i++) await page.waitForTimeout(500);
await start.click();
const t0 = Date.now(), shots = []; let lastShotTick = -1e9, countSeen = 0, countEndedAt = 0, maxTick = 0;
while (Date.now() - t0 < 110_000) {
  const row = await page.evaluate(() => ({ tick: Number(document.querySelector('[data-testid="sparring-stage"]')?.dataset.tick ?? 0), count: /YERDE/.test(document.body.innerText), done: /TAMAMLANDI/.test(document.body.innerText) }));
  maxTick = Math.max(maxTick, row.tick);
  const every = row.count ? 50 : 600;
  if (row.tick - lastShotTick >= every && shots.length < 30) { const file = `t${String(row.tick).padStart(5, '0')}${row.count ? '-count' : ''}.jpg`; await page.screenshot({ path: resolve(out, file), quality: 70 }); shots.push(file); lastShotTick = row.tick; }
  if (row.count) countSeen++; else if (countSeen && !countEndedAt) countEndedAt = Date.now();
  if (row.done || (countEndedAt && Date.now() - countEndedAt > 3000)) break;
  await page.waitForTimeout(200);
}
const probe = await page.evaluate(() => {
  const rows = window.__sollishRefereeProbe; if (!rows) return null;
  let rootMax = 0, planted = 0, slide = 0, frames = 0; const steps = [], run = [0, 0];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i]; if (b[0] - a[0] <= 0 || b[0] - a[0] > 3) { run[0] = run[1] = 0; continue; } frames++;
    rootMax = Math.max(rootMax, Math.hypot(b[1] - a[1], b[2] - a[2]));
    for (const k of [0, 1]) { const o = 4 + k * 3; if (a[o + 1] < .03 && b[o + 1] < .03) { const d = Math.hypot(b[o] - a[o], b[o + 2] - a[o + 2]); planted++; slide += d; run[k] += d; } else if (run[k] > 0) { steps.push(run[k]); run[k] = 0; } }
  }
  steps.sort((x, y) => x - y);
  return { frames, rootStepMaxM: +rootMax.toFixed(4), plantedFrames: planted, footSlideMeanPerPlantedFrameM: +(slide / Math.max(1, planted)).toFixed(5), steps: steps.length, footSlidePerStepP95M: +(steps[Math.floor(steps.length * .95)] ?? 0).toFixed(4), footSlidePerStepMaxM: +(steps.at(-1) ?? 0).toFixed(4) };
});
const fighters = await page.evaluate(() => { const d = window.__sollishProbe; if (!d) return null; const q = (xs, p) => xs.length ? +[...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(4) : null; return { frames: d.frames, dtMsP50: q(d.dt.map(x => x * 1000), .5), dtMsP99: q(d.dt.map(x => x * 1000), .99) }; });
await context.close(); await browser.close();
const report = { label, base, viewport: { width, height }, gl, maxTick, countSeen: countSeen > 0, shots, refereeProbe: probe, fighterProbe: fighters, errors, scope: 'local runtime, headless Chromium on this Mac (GPU WebGL via ANGLE/Metal); screenshots stall rendering, so frame pacing is not a device benchmark' };
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, shots: shots.length }));
