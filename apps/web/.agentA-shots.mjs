// usage: node shell-shots.mjs <prefix> [path...]
import { chromium } from '@playwright/test';
const prefix = process.argv[2]; const paths = process.argv.slice(3); if (!paths.length) paths.push('/');
const out = '/home/user/sollish/ops/evidence/design-shell-20261027';
const sizes = [[1440, 900], [834, 1112], [390, 844]];
const browser = await chromium.launch();
for (const p of paths) for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'tr-TR', deviceScaleFactor: 1, hasTouch: w < 500, isMobile: w < 500 });
  await ctx.addCookies([{ name: 'sollish_locale', value: 'tr', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000' + p, { waitUntil: 'networkidle', timeout: 120000 }).catch(e => console.log('goto', e.message));
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
  const name = `${prefix}-${p === '/' ? 'lobby' : p.replace(/\W+/g, '_').replace(/^_/, '')}-${w}x${h}.png`;
  await page.screenshot({ path: `${out}/${name}` }); console.log(name);
  await ctx.close();
}
await browser.close();
