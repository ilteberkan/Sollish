// Dev aid: render a Gece Ligi poster frame from the offline preview.
// usage: node scripts/night-poster.mjs <out.png> <url> <ms> <camera> [late]
import { chromium } from '@playwright/test';
const [out, url, ms, camera, late] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '[data-testid=night-lab-stage]{width:640px!important;height:400px!important;border:0!important}[data-testid=night-lab-stage]>div:not([data-boxing-scene]){display:none!important}' });
await page.getByRole('button', { name: 'Duraklat' }).click().catch(() => {});
if (late) await page.getByLabel('Yorgun raunt').check();
await page.getByRole('button', { name: camera, exact: true }).click();
await page.evaluate(v => { const r = document.querySelector('input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, String(v)); r.dispatchEvent(new Event('input', { bubbles: true })); }, Number(ms));
await page.evaluate(() => { const h = document.querySelector('[data-boxing-scene]'); if (h?.nightFlags) h.nightFlags.noCallouts = true; });
await page.waitForTimeout(1200);
await page.getByTestId('night-lab-stage').screenshot({ path: out });
await browser.close();
