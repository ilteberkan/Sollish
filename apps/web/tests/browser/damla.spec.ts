import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash, createHmac } from 'node:crypto';
import { damlaSeedFromEntropy, playDamlaRound, type DamlaMode } from '@sollish/protocol';
import { damlaBreakdown } from '../../lib/round-breakdown/damla';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times (engine damla-terraces-1). */
const engine = (fill: number, mode: DamlaMode = 'medium-12', bet = 100) => playDamlaRound(damlaSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), bet, mode);
/* Fills found with the engine (tests/damla-*.test.ts use the same engine). */
const LOSS = 2_654_435_761;      // medium-12: pool 7 of 13, x0.3
const CAP_HIGH16 = 3_381_399_901; // high-16: 16 right spills -> edge pool, x1000 (signature)

const tr = (cents: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
async function openDamla(page: Page) {
  await page.goto('/game/damla');
  await expect(page.getByRole('heading', { name: 'Damla: Pamukkale', exact: true, level: 1 })).toBeVisible();
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(drop(page)).first()).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('damla-splash').count()) { await play.click(); await expect(page.getByTestId('damla-splash')).toHaveCount(0); }
}
const drop = (page: Page) => page.getByTestId('damla-drop');
const balance = (page: Page) => page.getByTestId('damla-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');
const risk = (page: Page, name: string) => page.getByTestId('damla-risk').getByRole('radio', { name, exact: true });
const terraces = (page: Page, n: number) => page.getByTestId('damla-rows').getByRole('radio', { name: `${n} teras`, exact: true });
async function turbo(page: Page) {
  const speed = page.getByRole('button', { name: /^Damla hızı:/ });
  await speed.click(); await speed.click();
  await expect(speed).toHaveAccessibleName('Damla hızı: Turbo');
}
const axe = (page: Page) => new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();

test('a drop follows its round: payout held back until it lands, mode locked in flight, history row only after landing', async ({ page }) => {
  const round = engine(LOSS);
  await stub(page, LOSS);
  await openDamla(page);
  await expect(page.getByRole('group', { name: '12 traverten teras, 13 havuz, Orta risk' })).toBeVisible();
  await expect(page.getByTestId('damla-pool-0')).toHaveAccessibleName('Havuz 1: ×33');
  await expect(balance(page)).toContainText('1.000,00');
  await drop(page).click();
  // In flight: the cost is taken, the payout is not shown yet, risk/terraces/bet and Drop are locked, no history row.
  await expect(balance(page)).toContainText(tr(100_000 - 100));
  await expect(drop(page)).toBeDisabled();
  await expect(risk(page, 'Yüksek')).toBeDisabled();
  await expect(terraces(page, 16)).toBeDisabled();
  await expect(page.locator('.history-table')).toHaveCount(0);
  await risk(page, 'Yüksek').click({ force: true }).catch(() => {});
  await expect(risk(page, 'Orta')).toHaveAttribute('aria-checked', 'true');
  // Landed: balance = start - cost + payout, the pool of round.slot, one history row with the same pool.
  await expect(balance(page)).toContainText(tr(100_000 - 100 + round.payoutCents), { timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(`Havuz ${round.slot + 1}/13 · ×0,3`);
  await expect(page.getByTestId('damla-strip').locator('li')).toHaveCount(1);
  await expect(drop(page)).toBeEnabled();
  await expect(risk(page, 'Yüksek')).toBeEnabled();
  // Space drops too (spin key).
  await page.locator('h1').click();
  await page.keyboard.press('Space');
  await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
});

test('rain: 10 drops, each its own round, fall together and settle in order', async ({ page }) => {
  const round = engine(LOSS);
  await stub(page, LOSS);
  await openDamla(page);
  await page.getByTestId('damla-rain-10').click();
  await expect(balance(page)).toContainText(tr(100_000 - 1000));
  await expect(page.getByTestId('damla-rain-5')).toBeDisabled();
  await expect(drop(page)).toBeDisabled();
  await expect(page.getByText(/damla düşüyor/)).toBeVisible();
  await expect(balance(page)).toContainText(tr(100_000 - 1000 + 10 * round.payoutCents), { timeout: 20_000 });
  await expect(rows(page)).toHaveCount(10);
  await expect(page.getByTestId('damla-strip').locator('li')).toHaveCount(10);
  await expect(page.getByTestId('damla-win')).toContainText(tr(10 * round.payoutCents));
  await expect(drop(page)).toBeEnabled();
});

test('autobet needs a loss limit and stops before a drop that would exceed it', async ({ page }) => {
  test.setTimeout(60_000);
  await stub(page, LOSS); // every drop costs 1,00 and pays 0,30: net loss 0,70 per drop
  await openDamla(page);
  await turbo(page);
  // Originals bet panel (27 Oct 2026): autobet is the "Otomatik" tab of the panel, not a dialog.
  await page.getByRole('tab', { name: 'Otomatik', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Otomatik bahis' });
  await expect(dialog.getByText('Damla sayısı')).toBeVisible();
  const start = dialog.getByRole('button', { name: /^Başlat/ });
  await expect(start).toBeDisabled();
  // Advanced is collapsed and has no "any win" / "free spins" toggles in an instant game.
  await expect(dialog.locator('details')).not.toHaveAttribute('open', '');
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: /^Kayıp limiti/ }).fill('2,5');
  await start.click();
  await expect(page.getByTestId('damla-toast')).toContainText('Sonraki dönüş kayıp limitini aşardı', { timeout: 30_000 });
  await expect(rows(page)).toHaveCount(3);
  await expect(balance(page)).toContainText(tr(100_000 - 300 + 90));
  await expect(drop(page)).toBeEnabled();
});

test('history replay presents the same drop without touching the balance', async ({ page }) => {
  await stub(page, LOSS);
  await openDamla(page);
  await turbo(page);
  await drop(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  const after = await balance(page).textContent();
  await risk(page, 'Düşük').click();
  await page.getByRole('button', { name: /damlasını tekrar oynat$/ }).click();
  await expect(page.getByTestId('damla-replay')).toBeVisible();
  await expect(risk(page, 'Orta')).toHaveAttribute('aria-checked', 'true'); // the replay shows the recorded mode
  await expect(page.getByTestId('damla-replay')).toHaveCount(0, { timeout: 15_000 });
  await expect(balance(page)).toHaveText(after!);
  await expect(rows(page)).toHaveCount(1);
});

test('signature: the edge pool on high risk overflows gold; payout x1000; info pages list every mode RTP; axe-clean', async ({ page }) => {
  test.setTimeout(60_000);
  const round = engine(CAP_HIGH16, 'high-16');
  expect(round.capped && round.slot === 16).toBe(true);
  await stub(page, CAP_HIGH16);
  await openDamla(page);
  await risk(page, 'Yüksek').click();
  await terraces(page, 16).click();
  await expect(page.getByTestId('damla-pool-16')).toHaveAccessibleName('Havuz 17: ×1000');
  await drop(page).click();
  await expect(page.getByTestId('damla-gold')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('damla-callout')).toContainText('×1000');
  await expect(balance(page)).toContainText(tr(100_000 - 100 + 100_000), { timeout: 15_000 });
  await expect(rows(page).first()).toContainText('azami');
  await page.getByRole('button', { name: 'Oyun bilgisi, ödeme tablosu ve RTP' }).click();
  const info = page.getByRole('dialog', { name: 'Damla: oyun bilgisi' });
  await info.getByRole('tab', { name: 'RTP' }).or(info.getByRole('button', { name: 'RTP', exact: true })).first().click();
  await expect(info.getByTestId('damla-rtp-table').locator('tbody tr')).toHaveCount(15);
  await expect(info.getByTestId('damla-rtp-table')).toContainText('%98,45');
  const result = await axe(page);
  expect(result.violations.map(v => v.id)).toEqual([]);
});

test('/verify recomputes a Damla round from revealed seeds and shows its path and pool', async ({ page }) => {
  const serverSeed = 'ab'.repeat(32), clientSeed = 'damla-test', nonce = 7, bet = 200, mode: DamlaMode = 'high-12';
  const seedHex = createHmac('sha256', Buffer.from(serverSeed, 'hex')).update(`${clientSeed}:${nonce}`).digest('hex').slice(0, 32);
  const round = playDamlaRound(seedHex, bet, mode);
  await page.goto('/verify');
  await page.getByLabel('Oyun', { exact: true }).selectOption('damla');
  await page.getByLabel('Mod', { exact: true }).selectOption(mode);
  await page.getByLabel('Bahis', { exact: true }).selectOption(String(bet));
  await page.getByLabel(/Açıklanan sunucu tohumu/).fill(serverSeed);
  await page.getByLabel(/tohum özeti/).fill(createHash('sha256').update(Buffer.from(serverSeed, 'hex')).digest('hex'));
  await page.getByLabel('Oyuncu tohumu', { exact: true }).fill(clientSeed);
  await page.getByLabel('Nonce', { exact: true }).fill(String(nonce));
  await page.getByRole('button', { name: 'Doğrula', exact: true }).click();
  await expect(page.getByTestId('verify-result')).toContainText('Eşleşti');
  const damla = page.getByTestId('verify-damla');
  await expect(damla).toContainText(`${round.path.join('')} → havuz ${round.slot + 1}/13`);
  await expect(damla.getByTestId('damla-path-figure')).toBeVisible();
  await expect(page.getByLabel('Mod', { exact: true }).locator('option:checked')).toHaveText('Yüksek risk · 12 teras');
});

/* Phone fit (22 Oct 2026): the first screen holds the whole table (board, win bar, deck, spin button) with no page
   scroll; phone CSS sizes the table to 100svh below its own top (slot-kit/use-viewport-top). */
test('phone 390x844 first screen: the whole table and the spin button fit without scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDamla(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const spinBox = (await drop(page).boundingBox())!;
  expect(spinBox.y, 'spin button top').toBeGreaterThanOrEqual(0);
  expect(spinBox.y + spinBox.height, 'spin button bottom').toBeLessThanOrEqual(844);
  const tableBox = (await page.locator('.game-table').boundingBox())!;
  expect(tableBox.y + tableBox.height, 'table bottom').toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('round breakdown ("Tur ayrıntısı"): path, pool, multiplier and bet × multiplier = the shown win; also from history', async ({ page }) => {
  test.setTimeout(120_000); // a dev-server round can be slow on a busy machine
  const WIN = 56_433; // medium-12: pool 4 of 13 (3 right spills), x2.5
  const round = engine(WIN);
  expect(round.multiplierHundredths).toBe(250);
  await stub(page, WIN);
  await openDamla(page);
  await turbo(page);
  await drop(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId('damla-win')).toContainText(tr(round.payoutCents));
  const shown = (await page.getByTestId('damla-win').textContent())!.replace(/\s*DEMO\s*$/, '').trim();
  await page.getByTestId('round-breakdown-open').click();
  const dialog = page.getByRole('dialog', { name: 'Tur ayrıntısı' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('round-breakdown-line')).toHaveCount(1);
  await expect(dialog.getByTestId('round-breakdown-line')).toContainText('havuz 4');
  await expect(dialog.getByTestId('round-breakdown-line')).toContainText('2,50×');
  await expect(dialog).toContainText(`bahis ${tr(round.betCents)} × 2,50×`);
  await expect(dialog.getByTestId('round-breakdown-total')).toHaveText(shown);
  await expect(dialog.getByTestId('round-breakdown-total')).toHaveText(tr(damlaBreakdown(round).payoutCents));
  await expect(dialog.getByTestId('round-breakdown-check')).toContainText('✓');
  if (process.env.BREAKDOWN_SHOTS) await page.screenshot({ path: `${process.env.BREAKDOWN_SHOTS}/damla.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await rows(page).first().getByTestId('history-breakdown').click();
  await expect(dialog.getByTestId('round-breakdown-total')).toHaveText(tr(round.payoutCents));
});
