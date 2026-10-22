// node fit3.mjs <outDir> <games comma> [base|free|both]   SIZES=390x844,...  DESKTOP=1 -> layout rect dump
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire('/home/user/Sollish/apps/web/package.json');
const { chromium } = require('@playwright/test');
const [out, gamesArg, which = 'both'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sizes = (process.env.SIZES ?? '390x844,360x740,430x932').split(',').map(s => s.split('x').map(Number));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const res = [];
const tags = which === 'both' ? ['base', 'free'] : [which];
for (const game of gamesArg.split(',')) for (const [w, h] of sizes) for (const tag of tags) {
  if (tag === 'free' && game === 'damla') continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
  await ctx.addCookies([{ name: 'sollish_locale', value: 'tr', domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await page.addInitScript(v => { Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: a => { a.fill(v); return a; } }); }, Number(process.env.FILL ?? 2364027904));
  await page.goto(`http://localhost:3000/game/${game}`, { waitUntil: 'networkidle', timeout: 180000 });
  const play = page.getByRole('button', { name: /^(Oyna|Play)$/ });
  await play.first().waitFor({ timeout: 30000 }).catch(() => {});
  if (await play.count()) await play.first().click();
  await page.waitForTimeout(1500);
  if (tag === 'free') {
    await page.getByRole('button', { name: /Bonus satın al/ }).click();
    await page.getByRole('dialog', { name: 'Bonus satın al' }).getByRole('button', { name: 'Satın al', exact: true }).click();
    await page.getByRole('button', { name: 'Başla', exact: true }).click({ timeout: 30000, force: true }).catch(() => {});
    await page.locator('[data-testid$="-free-counter"]').first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(Number(process.env.FREE_WAIT ?? 3000));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
    const q = s => document.querySelector(s);
    const spin = q('[data-testid$="-spin"]') || q('[data-testid="damla-drop"]');
    const h1 = q('.game-heading h1');
    return { scrollY: scrollY, scrollH: document.documentElement.scrollHeight, innerH: innerHeight, table: r(q('.game-table')), spin: r(spin), h1: h1 ? (() => { const rg = document.createRange(); rg.selectNodeContents(h1); const vis = [...rg.getClientRects()].filter(r => r.width > 1); const right = Math.max(...vis.map(r => r.right)); const ms = q('.mode-switch').getBoundingClientRect(); const shown = [...h1.querySelectorAll('span'), h1].length && getComputedStyle(h1.querySelector('.title-sub') ?? h1).position !== 'absolute' ? h1.textContent : (h1.querySelector('.title-main')?.textContent ?? h1.textContent); return { text: h1.textContent, shown, clipped: h1.scrollWidth > h1.clientWidth, overlapsSwitch: Math.min(right, h1.getBoundingClientRect().right) > ms.left - 2 || right > ms.left - 2 }; })() : null, free: !!q('[data-testid$="-free-counter"]') };
  });
  if (process.env.DESKTOP) {
    const rects = await page.evaluate(() => [...document.querySelectorAll('.game-page *')].filter(e => !e.closest('canvas,svg') || e.tagName === 'svg').map(e => { const b = e.getBoundingClientRect(); return `${e.tagName}.${typeof e.className === 'string' ? e.className : ''}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`; }));
    writeFileSync(`${out}/${game}-${w}x${h}-${tag}.rects.txt`, rects.join('\n'));
    m.rectsHash = createHash('sha256').update(rects.join('\n')).digest('hex').slice(0, 16);
  }
  await page.screenshot({ path: `${out}/${game}-${w}x${h}-${tag}.png` });
  const row = { game, size: `${w}x${h}`, tag, ...m, spinInside: m.spin ? m.spin[0] >= 0 && m.spin[1] <= m.innerH : null, tableFits: m.table ? m.table[1] <= m.innerH : null };
  res.push(row); console.log(JSON.stringify(row));
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/results.json`, JSON.stringify(res, null, 1));
