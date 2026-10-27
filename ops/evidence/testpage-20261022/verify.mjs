// Playwright check of out/sollish-test.html via file://. Run: bash scripts/use-node.sh node <this file>
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire('/home/user/sollish/apps/web/package.json');
const { chromium } = req('@playwright/test');
const url = 'file://' + join(here, 'out/sollish-test.html');
const shot = name => join(here, name);
const log = (...a) => console.log('[verify]', ...a);
const errors = [];
const results = {};

const browser = await chromium.launch({ executablePath: undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
async function newPage(viewport, init) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`${viewport.width}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${viewport.width} pageerror: ${e.message}`));
  page.on('requestfailed', r => { if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) errors.push(`${viewport.width} requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
  if (init) await page.addInitScript(init.fn, init.arg);
  await page.goto(url);
  await page.waitForSelector('[data-tab="lobby"]', { timeout: 30000 });
  return page;
}
const tab = async (page, id) => { await page.click(`[data-tab="${id}"]`); await page.waitForTimeout(400); };
async function enterGame(page, splash) {
  const play = page.getByRole('button', { name: /^(Oyna|Play)$/ });
  await play.or(page.locator('[data-testid$="-spin"],[data-testid$="-drop"]')).first().waitFor({ timeout: 30000 });
  if (splash && await page.getByTestId(splash).count()) { await play.first().click(); await page.getByTestId(splash).waitFor({ state: 'detached', timeout: 15000 }); }
}

// --- Desktop: tabs, language, lobby tile, spin, drop ---
const page = await newPage({ width: 1440, height: 900 });
results.initialLang = await page.evaluate(() => document.documentElement.lang);
const tabs = await page.$$eval('[data-tab]', els => els.map(e => e.textContent));
results.tabs = tabs;
await page.click('[data-locale="en"]');
await page.waitForFunction(() => document.documentElement.lang === 'en');
await page.waitForTimeout(300);
const enText = await page.textContent('main');
const enTab = await page.textContent('[data-tab="lobby"]');
await page.screenshot({ path: shot('d1440-lobby-en.png') });
await page.click('[data-locale="tr"]');
await page.waitForFunction(() => document.documentElement.lang === 'tr');
await page.waitForTimeout(300);
const trText = await page.textContent('main');
results.langSwitch = { enTab, trTab: await page.textContent('[data-tab="lobby"]'), mainChanged: enText !== trText, enSample: enText.slice(0, 80), trSample: trText.slice(0, 80) };
await page.screenshot({ path: shot('d1440-lobby-tr.png') });

// lobby tile -> tab switch
const tile = page.locator('main a[href="#/game/goreme"]').first();
results.lobbyTileCount = await page.locator('main a[href^="#/game/"]').count();
await tile.click();
await page.waitForTimeout(500);
results.tileSwitch = await page.getAttribute('[data-tab="goreme"]', 'aria-current');

for (const id of ['goreme', 'damla', 'tarhun', 'ebru', 'cezeri', 'asena', 'cascade']) {
  await tab(page, id);
  const h1 = await page.locator('main h1').first().textContent({ timeout: 20000 }).catch(() => null);
  results['tab_' + id] = h1;
  await page.screenshot({ path: shot(`d1440-${id}.png`) });
}
// Göreme spin
await tab(page, 'goreme');
await enterGame(page, 'goreme-splash');
await page.getByTestId('goreme-spin').click();
await page.locator('.history-table tbody tr').first().waitFor({ timeout: 60000 });
results.goremeSpin = { rows: await page.locator('.history-table tbody tr').count(), balance: await page.getByTestId('goreme-balance').textContent() };
await page.screenshot({ path: shot('d1440-goreme-spun.png') });
// Damla drop
await tab(page, 'damla');
await enterGame(page, 'damla-splash');
await page.getByTestId('damla-drop').click();
await page.locator('.history-table tbody tr').first().waitFor({ timeout: 60000 });
results.damlaDrop = { rows: await page.locator('.history-table tbody tr').count(), balance: await page.getByTestId('damla-balance').textContent() };
await page.screenshot({ path: shot('d1440-damla-dropped.png') });
results.fetchHitsDesktop = await page.evaluate(() => window.__sollishFetchHits);
results.workers = await page.evaluate(() => typeof Worker);

// --- Phone: buy feature at turbo to the total screen (stubbed RNG: buy round with sky x15) ---
const BUY_SKY = 4_139_144_192;
const phone = await newPage({ width: 390, height: 844 }, { fn: value => {
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: array => { array.fill(value); return array; } });
  window.__total = null;
  new MutationObserver(() => { const t = document.querySelector('[data-testid="goreme-feature-total"]'); if (t) window.__total = t.textContent; }).observe(document, { subtree: true, childList: true, characterData: true });
}, arg: BUY_SKY });
await phone.screenshot({ path: shot('p390-lobby.png') });
for (const id of ['goreme', 'damla']) { await tab(phone, id); await phone.screenshot({ path: shot(`p390-${id}.png`) }); }
await tab(phone, 'goreme');
await enterGame(phone, 'goreme-splash');
const speed = phone.getByRole('button', { name: /^Dönüş hızı:/ });
await speed.click(); await speed.click();
results.turbo = await speed.getAttribute('aria-label');
await phone.getByRole('button', { name: /Bonus satın al/ }).click();
const dialog = phone.getByRole('dialog', { name: 'Bonus satın al' });
await dialog.getByRole('button', { name: 'Satın al', exact: true }).click();
const t0 = Date.now();
await phone.getByRole('dialog', { name: 'Şafak Şöleni başlıyor' }).getByRole('button', { name: 'Başla' }).click({ force: true, timeout: 30000 }).catch(() => {});
await phone.waitForFunction(() => window.__total, null, { timeout: 200000 });
results.buyTotal = { text: await phone.evaluate(() => window.__total), seconds: Math.round((Date.now() - t0) / 1000) };
await phone.waitForTimeout(500);
await phone.screenshot({ path: shot('p390-goreme-total.png') });
await phone.getByTestId('goreme-celebration').waitFor({ timeout: 60000 }).catch(() => {});
await phone.screenshot({ path: shot('p390-goreme-celebration.png') });
results.fetchHitsPhone = await phone.evaluate(() => window.__sollishFetchHits);
results.phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
for (const id of ['tarhun', 'ebru', 'cezeri', 'asena', 'cascade']) { await tab(phone, id); results['p_tab_' + id] = await phone.locator('main h1').first().textContent({ timeout: 20000 }).catch(() => null); }
await tab(phone, 'lobby');
await phone.screenshot({ path: shot('p390-lobby-after.png') });

await browser.close();
const summarize = hits => hits && { count: hits.length, ok: hits.filter(h => h.ok).length, sample: [...new Set(hits.map(h => h.path))].slice(0, 6) };
results.fetchHitsDesktop = summarize(results.fetchHitsDesktop);
results.fetchHitsPhone = summarize(results.fetchHitsPhone);
log(JSON.stringify(results, null, 2));
log('console errors:', errors.length ? errors : 'none');
