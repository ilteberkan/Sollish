import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve('apps/web/package.json'));
const { chromium } = require('@playwright/test');
const base = 'https://sollish-web-devnet.sollish-web.workers.dev';
const out = 'ops/evidence/ringside-research-20261003';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { at: new Date().toISOString(), scope: 'Hosted read-only research UI on desktop Apple M2 / Chromium ANGLE Metal. Mobile viewports are emulation, not physical phones. No wagers or wallet requests.', url: base + '/lab/ringside', assets: [], views: [] };
for (const name of ['manifest.json','physics-trace.json']) {
  const expected = await readFile('apps/web/public/research/ringside/' + name);
  const response = await fetch(base + '/research/ringside/' + name);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(sha(bytes), sha(expected));
  result.assets.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
}
const manifest = JSON.parse(await readFile('apps/web/public/research/ringside/manifest.json', 'utf8'));
for (const item of manifest.cases) for (const run of item.runs) {
  const response = await fetch(base + run.path); assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, run.bytes); assert.equal(sha(bytes), run.sha256);
  result.assets.push({ path: run.path, bytes: bytes.length, sha256: sha(bytes) });
}
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=metal']});
try {
  for (const width of [1440,390]) {
    const page = await browser.newPage({viewport:{width,height:900}, reducedMotion:'reduce'});
    const errors = [], live = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('websocket', ws => { if (/arena\//.test(ws.url())) live.push(ws.url().split('?')[0]); });
    const response = await page.goto(result.url); assert.equal(response.status(),200);
    await page.locator('canvas[data-renderer="webgl"]').waitFor({timeout:60000});
    await page.getByRole('slider',{name:'Kayıtta zaman'}).fill('7500');
    const stage = page.locator('canvas[data-renderer="webgl"]');
    await stage.screenshot({path:`${out}/hosted-learning-${width}.png`});
    await page.getByRole('button',{name:'Oynat',exact:true}).click();
    await page.waitForTimeout(1100);
    await page.getByRole('button',{name:'Duraklat',exact:true}).click();
    const advanced = Number(await page.getByRole('slider',{name:'Kayıtta zaman'}).inputValue()) > 7500;
    assert.equal(advanced,true);
    await page.getByTestId('research-before').click();
    await page.locator('canvas[data-renderer="webgl"]').waitFor({timeout:60000});
    assert.equal(await page.getByRole('slider',{name:'Kayıtta zaman'}).inputValue(),'0');
    await page.getByRole('button',{name:'02 Beden ve mocap'}).click();
    await page.locator('canvas[data-renderer="webgl-physics"]').waitFor({timeout:60000});
    await page.getByRole('button',{name:'Oynat',exact:true}).click();
    await page.waitForTimeout(1400);
    await page.getByRole('button',{name:'Duraklat',exact:true}).click();
    const physics = page.locator('canvas[data-renderer="webgl-physics"]');
    const paused = await physics.screenshot({path:`${out}/hosted-physics-${width}.png`});
    await page.waitForTimeout(300);
    const samePixels = sha(paused) === sha(await physics.screenshot());
    assert.equal(samePixels,true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow,false);
    const buildId = await page.evaluate(() => { const scripts=[...document.scripts].map(s=>s.textContent??'').join(''); return scripts.match(/"b":"([^"]+)"/)?.[1]??null; });
    await page.getByRole('link',{name:'Tüm oyunlar',exact:true}).first().click();
    await page.waitForURL('**/games');
    const canvasCount = await page.locator('canvas').count();
    assert.equal(canvasCount,0); assert.deepEqual(errors,[]); assert.deepEqual(live,[]);
    result.views.push({width,learningAdvanced:advanced,physicsPauseStable:samePixels,overflow,canvasAfterNavigation:canvasCount,liveArenaSockets:live.length,errors,htmlBuildId:buildId});
    await page.close();
  }
} finally { await browser.close(); }
result.finishedAt = new Date().toISOString();
await writeFile(`${out}/hosted.json`, JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({assets:result.assets.length,views:result.views,finishedAt:result.finishedAt}));
