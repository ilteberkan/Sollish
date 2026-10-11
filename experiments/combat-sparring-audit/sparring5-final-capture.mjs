// Final real-scene check of the integrated sparring-5 build (coordinator, 5 Oct 2026). Headless Chromium with GPU
// WebGL (ANGLE/Metal) against a local production runtime; run through scripts/dev/with-lock.mjs browser.
// Usage: node experiments/combat-sparring-audit/sparring5-final-capture.mjs <outDir> <baseUrl> [jev=0|1]
// Scenario A: default corners (neuro-2 learned vs learned), seed 7, ?probe=1, desktop 1280×720, ~30 s of bout.
// Scenario B: same at 390×844 (layout overflow + screenshot). Scenario C (jev=1): KOR on live Jev, ~22 s.
import { chromium } from '/Users/macmini/Desktop/Sollish/apps/web/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [outDir, base, jev = '0'] = process.argv.slice(2);
if (!outDir || !base) throw new Error('usage: <outDir> <baseUrl> [jev=0|1]');
const out = resolve(outDir); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const q = (xs, p) => xs.length ? +[...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(4) : null;

async function open(width, height, query, onRequest) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (onRequest) page.on('request', onRequest);
  await page.goto(base + '/lab/ringside/play' + query);
  await page.locator('canvas[data-renderer="webgl-sparring"]').waitFor({ timeout: 90_000 });
  const start = page.getByRole('button', { name: 'Dövüşü başlat ↗', exact: true });
  await start.waitFor({ timeout: 60_000 });
  const gl = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const i = g?.getExtension('WEBGL_debug_renderer_info'); return i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : 'none'; });
  return { context, page, errors, start, gl };
}
const tick = async page => Number(await page.getByTestId('sparring-stage').getAttribute('data-tick'));

// A: default bout, desktop, probes.
const a = await open(1280, 720, '?probe=1&seed=7');
await a.start.click({ timeout: 60_000 });
const shotsA = [];
for (const [i, ms] of [6000, 10000, 14000].entries()) { await a.page.waitForTimeout(ms); const f = `A-desktop-${i}.jpg`; await a.page.screenshot({ path: resolve(out, f), quality: 72 }); shotsA.push({ file: f, tick: await tick(a.page) }); }
const fighters = await a.page.evaluate(() => {
  const d = window.__sollishProbe; if (!d) return null;
  const pick = k => Array.isArray(d[k]) ? d[k].filter(x => typeof x === 'number') : [];
  return { frames: d.frames, dtMs: pick('dt').map(x => x * 1000), rootJump: pick('rootJump'), boneSpeed: pick('boneSpeed'), camJump: pick('camJump'), penetration: pick('penetration'), rawPenetration: pick('rawPenetration'), rootOffset: pick('rootOffset') };
});
const referee = await a.page.evaluate(() => {
  const rows = window.__sollishRefereeProbe; if (!rows) return null;
  let rootMax = 0, planted = 0, slide = 0, frames = 0; const steps = [], run = [0, 0];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], c = rows[i]; if (c[0] - p[0] <= 0 || c[0] - p[0] > 3) { run[0] = run[1] = 0; continue; } frames++;
    rootMax = Math.max(rootMax, Math.hypot(c[1] - p[1], c[2] - p[2]));
    for (const k of [0, 1]) { const o = 4 + k * 3; if (p[o + 1] < .03 && c[o + 1] < .03) { const s = Math.hypot(c[o] - p[o], c[o + 2] - p[o + 2]); planted++; slide += s; run[k] += s; } else if (run[k] > 0) { steps.push(run[k]); run[k] = 0; } }
  }
  steps.sort((x, y) => x - y);
  return { frames, rootStepMaxM: +rootMax.toFixed(4), footSlideMeanPerPlantedFrameM: +(slide / Math.max(1, planted)).toFixed(5), steps: steps.length, footSlidePerStepP95M: +(steps[Math.floor(steps.length * .95)] ?? 0).toFixed(4), footSlidePerStepMaxM: +(steps.at(-1) ?? 0).toFixed(4) };
});
const meters = await a.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[role="meter"]')].map(m => [m.getAttribute('aria-label'), Number(m.getAttribute('aria-valuenow'))])));
const chipsA = await a.page.evaluate(() => [...document.querySelectorAll('[aria-label$="dövüş stili"]')].map(c => ({ label: c.getAttribute('aria-label'), source: c.getAttribute('data-source'), text: c.textContent })));
const scenarioA = { viewport: '1280x720', query: '?probe=1&seed=7', gl: a.gl, endTick: await tick(a.page), meters, chips: chipsA, shots: shotsA, errors: a.errors,
  fighterProbe: fighters && { frames: fighters.frames, dtMsP50: q(fighters.dtMs, .5), dtMsP99: q(fighters.dtMs, .99), rootJumpMaxM: q(fighters.rootJump, 1), boneSpeedP99RadS: q(fighters.boneSpeed, .99), camJumpMaxM: q(fighters.camJump, 1),
    penetrationMaxM: q(fighters.penetration, 1), penetrationP99M: q(fighters.penetration, .99), framesOver1cm: fighters.penetration.filter(x => x > .01).length, rawPenetrationMaxM: q(fighters.rawPenetration, 1), rawFramesOver1cm: fighters.rawPenetration.filter(x => x > .01).length, rootOffsetMaxM: q(fighters.rootOffset, 1) },
  refereeProbe: referee };
await a.context.close();

// B: phone viewport.
const b = await open(390, 844, '?seed=7');
await b.start.click({ timeout: 60_000 }); await b.page.waitForTimeout(9000);
await b.page.screenshot({ path: resolve(out, 'B-mobile-390.jpg'), quality: 72 });
const scenarioB = { viewport: '390x844', endTick: await tick(b.page), noHorizontalOverflow: await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), errors: b.errors };
await b.context.close();

// C: live Jev corner (real provider calls through the server route; counted here).
let scenarioC = null;
if (jev === '1') {
  const posts = [];
  const c = await open(1280, 720, '?seed=20261051', r => { if (r.url().includes('/api/ringside/style') && r.method() === 'POST') posts.push(r.url()); });
  const select = c.page.getByRole('combobox', { name: 'KOR köşe stili' });
  await select.selectOption('neuro2-jev');
  const startC = c.page.getByRole('button', { name: 'Dövüşü başlat ↗', exact: true }); await startC.click({ timeout: 60_000 });
  await c.page.waitForTimeout(22000);
  await c.page.screenshot({ path: resolve(out, 'C-jev-desktop.jpg'), quality: 72 });
  const chips = await c.page.evaluate(() => [...document.querySelectorAll('[aria-label$="dövüş stili"]')].map(x => ({ label: x.getAttribute('aria-label'), source: x.getAttribute('data-source'), text: x.textContent })));
  const log = await c.page.evaluate(() => document.querySelector('[aria-label="Stil karar kaydı"]')?.textContent?.slice(0, 600) ?? null);
  scenarioC = { viewport: '1280x720', query: '?seed=20261051', korCorner: 'neuro2-jev', endTick: await tick(c.page), routePosts: posts.length, chips, decisionLogText: log, errors: c.errors };
  await c.context.close();
}
await browser.close();
const report = { at: new Date().toISOString(), base, scope: 'local production runtime (OpenNext build served by wrangler dev/workerd), headless Chromium on this Mac with ANGLE/Metal; not hosted, not a device benchmark; screenshots stall rendering', scenarioA, scenarioB, scenarioC };
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ A: { endTick: scenarioA.endTick, meters, chips: chipsA.map(x => x.source + ':' + x.text), fighter: scenarioA.fighterProbe, referee }, B: scenarioB, C: scenarioC && { posts: scenarioC.routePosts, chips: scenarioC.chips.map(x => x.source + ':' + x.text), errors: scenarioC.errors.length } }));
