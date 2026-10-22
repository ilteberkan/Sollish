import { createRequire } from 'node:module';
const require = createRequire('/home/user/Sollish/apps/web/package.json');
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const loc = process.env.LOC ?? 'tr';
for (const game of process.argv[2].split(',')) for (const w of [360, 375, 390, 412, 430]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
  await ctx.addCookies([{ name: 'sollish_locale', value: loc, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3000/game/${game}`, { waitUntil: 'networkidle', timeout: 180000 });
  const r = await page.evaluate(() => {
    const h1 = document.querySelector('.game-heading h1'); const rg = document.createRange(); const sub = h1.querySelector('.title-sub'); rg.selectNodeContents(sub && getComputedStyle(sub).position === 'absolute' ? h1.querySelector('.title-main') : h1);
    const vis = [...rg.getClientRects()].filter(r => r.width > 1); const right = Math.max(...vis.map(r => r.right));
    const ms = document.querySelector('.mode-switch').getBoundingClientRect();
    return { text: h1.textContent, fs: getComputedStyle(h1).fontSize, textRight: Math.round(right), h1Right: Math.round(h1.getBoundingClientRect().right), switchLeft: Math.round(ms.left), ellipsis: h1.scrollWidth > h1.clientWidth };
  });
  console.log(game, w, JSON.stringify(r), r.textRight > r.switchLeft - 4 || r.ellipsis ? 'TIGHT' : 'ok');
  await ctx.close();
}
await browser.close();
