// Dev aid: capture Gece Ligi preview frames with headless Chromium.
// usage: node scripts/night-shots.mjs <outDir> <url> <ms,ms,...> [camera] [phase] [width] [height]
import { chromium } from '@playwright/test';
const [out, url, list, camera = 'Yayın', phase = 'Raunt', width = '1280', height = '900'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Duraklat' }).click().catch(() => {});
const chat = page.getByRole('button', { name: 'Chat panelini kapat' });
if (await chat.isVisible().catch(() => false)) await chat.click();
if (process.env.LATE) await page.getByLabel('Yorgun raunt').check();
await page.getByRole('button', { name: phase, exact: true }).click();
await page.getByRole('button', { name: camera, exact: true }).click();
const stage = page.getByTestId('night-lab-stage');
for (const ms of list.split(',').map(Number)) {
  if (phase === 'Raunt') await page.evaluate(v => { const r = document.querySelector('input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, String(v)); r.dispatchEvent(new Event('input', { bubbles: true })); }, ms);
  await page.waitForTimeout(250);
  await stage.screenshot({ path: `${out}/${process.env.PREFIX ?? 'f'}-${String(ms).padStart(5, '0')}.png` });
}
await browser.close();
