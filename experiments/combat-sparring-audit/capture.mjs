// Motion capture of the real production preview (OpenNext/workerd). Presentation evidence
// only: frames, a short video, renderer identity and an active-combat frame counter window.
// Usage: node experiments/combat-sparring-audit/capture.mjs <outDir> [baseUrl] [width] [height] [camera]
import { chromium } from '../../apps/web/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [outDir, base = 'http://localhost:3001', w = '1280', h = '720', cameraName = 'Yayın', query = '', seconds = '24'] = process.argv.slice(2);
if (!outDir) throw new Error('outDir required');
const out = resolve(outDir); await mkdir(out, { recursive: true });
const width = Number(w), height = Number(h);
const browser = await chromium.launch(process.env.SOFTWARE ? {} : { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width, height } } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + '/lab/ringside/play' + query);
const canvas = page.locator('canvas[data-renderer="webgl-sparring"]');
await canvas.waitFor({ timeout: 30_000 });
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'none';
});
// Spectator-only UI since sparring-3; older builds had a separate watch-mode toggle.
const watch = page.getByRole('button', { name: 'Dövüşü izle', exact: true });
if (await watch.count()) await watch.click();
{ const cam = page.getByRole('button', { name: cameraName, exact: true }); if (await cam.count()) await cam.click(); }
await page.getByRole('button', { name: 'Dövüşü başlat ↗', exact: true }).click();
const stage = page.getByTestId('sparring-stage');
const samples = [];
const t0 = Date.now();
let shot = 0;
// Active-combat window only: stop sampling once the bout finishes so KO idle never counts.
while (Date.now() - t0 < Number(seconds) * 1000) {
  const row = await page.evaluate(() => {
    const c = document.querySelector('canvas[data-renderer="webgl-sparring"]'), s = document.querySelector('[data-testid="sparring-stage"]');
    return { now: performance.now(), frames: Number(c?.dataset.frames ?? 0), tick: Number(s?.dataset.tick ?? 0), health: Number(s?.dataset.health ?? 0), enemy: Number(s?.dataset.enemyHealth ?? 0), finished: !!document.body.innerText.match(/(ANTRENMAN|DÖVÜŞ) TAMAMLANDI/) };
  });
  samples.push(row);
  if (row.finished) break;
  if (!process.env.NOSHOT && samples.length % 4 === 0 && shot < 40) await page.screenshot({ path: resolve(out, `frame-${String(shot++).padStart(2, '0')}.jpg`), quality: 80 });
  await page.waitForTimeout(250);
}
const probe = await page.evaluate(() => {
  const d = window.__sollishProbe; if (!d) return null;
  const q = (xs, p) => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); return +v[Math.min(v.length - 1, Math.floor(p * v.length))].toFixed(4); };
  const summary = xs => ({ p50: q(xs, .5), p99: q(xs, .99), max: q(xs, 1) });
  return { frames: d.frames, dtMs: summary(d.dt.map(x => x * 1000)), ticksPerFrame: summary(d.ticks), rootJumpM: summary(d.rootJump), boneSpeedRadS: summary(d.boneSpeed), camJumpM: summary(d.camJump),
    boneSpikesOver40: d.boneSpeed.filter(x => x > 40).length, spikes: d.spikes, rootJumpsOver5cm: d.rootJump.filter(x => x > .05).length, camJumpsOver25cm: d.camJump.filter(x => x > .25).length };
});
const active = samples.filter(s => !s.finished);
const first = active[1] ?? active[0], last = active.at(-1);
const fps = last && first && last.now > first.now ? (last.frames - first.frames) / ((last.now - first.now) / 1000) : null;
const ticksPerSecond = last && first && last.now > first.now ? (last.tick - first.tick) / ((last.now - first.now) / 1000) : null;
await context.close(); await browser.close();
const report = { at: new Date().toISOString(), base, viewport: { width, height }, camera: cameraName, renderer, activeWindowS: last && first ? (last.now - first.now) / 1000 : 0, renderedFps: fps, simTicksPerSecond: ticksPerSecond, finalHealth: last ? [last.health, last.enemy] : null, finished: samples.some(s => s.finished), probe, errors, note: 'Headless Chromium on this Mac; screenshot calls stall rendering, so FPS is a lower bound, not a device benchmark.' };
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
