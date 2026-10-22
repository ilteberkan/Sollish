// node auto.mjs <outDir> <games> <sizes>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/home/user/Sollish/apps/web/package.json');
const { chromium } = require('@playwright/test');
const [out, gamesArg, sizesArg = '360x740,390x844'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const game of gamesArg.split(',')) for (const size of sizesArg.split(',')) {
  const [w, h] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([{ name: 'sollish_locale', value: 'tr', domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await page.addInitScript(v => { Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: a => { a.fill(v); return a; } }); }, 2364027904);
  await page.goto(`http://localhost:3000/game/${game}`, { waitUntil: 'networkidle', timeout: 180000 });
  const play = page.getByRole('button', { name: /^(Oyna|Play)$/ });
  await play.first().waitFor({ timeout: 30000 }).catch(() => {});
  if (await play.count()) await play.first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('500');
  await panel.getByRole('button', { name: /Başlat/ }).first().click();
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const ribbon = document.querySelector('[class*="__autoRibbon"]');
    const hud = document.querySelector('[class*="__hud"]') ?? document.querySelector('[class*="__stageTop"]');
    return { ribbon: r(ribbon), hud: r(hud), hudKids: hud ? [...hud.children].map(r) : [] };
  });
  console.log(game, size, JSON.stringify(m));
  await page.screenshot({ path: `${out}/${game}-${size}-auto.png` });
  await ctx.close();
}
await browser.close();
