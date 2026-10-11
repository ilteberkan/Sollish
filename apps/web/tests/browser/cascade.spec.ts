import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cascadeSeedFromEntropy, playCascadeRound } from '@sollish/protocol';
import { SYMBOL_LABELS } from '../../components/cascade/symbols';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times. */
const engine = (fill: number, stakeCents = 1000) => playCascadeRound(cascadeSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), stakeCents);
const tr = (cents: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(cents / 100);
const TUMBLES = 2_563_011_894; // base spin, 4 tumbles, 5,97x
const FREE = 1_621_328_416;    // 10 free spins, crystals applied, 39,96x (big win)

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
async function openCascade(page: Page) {
  await page.goto('/game/cascade');
  await expect(page.getByRole('heading', { name: 'Candy Cascade', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('[data-phase]')).toBeVisible();
}
const spin = (page: Page) => page.getByRole('button', { name: 'Çevir', exact: true });
const balance = (page: Page) => page.locator('.demo-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');

test('page shows a labelled 6x5 board, paytable and passes axe', async ({ page }) => {
  await openCascade(page);
  const grid = page.getByRole('grid', { name: /Candy Cascade ızgarası/ });
  await expect(grid).toBeAttached();
  await expect(grid.getByRole('row')).toHaveCount(5);
  for (const row of await grid.getByRole('row').all()) await expect(row.getByRole('gridcell')).toHaveCount(6);
  const cells = page.getByRole('gridcell');
  await expect(cells).toHaveCount(30);
  for (const label of await cells.allTextContents()) expect(label.trim().length).toBeGreaterThan(2);
  await expect(page.locator('[data-cells] > div[data-sym]')).toHaveCount(30); // 30 visual cells behind it
  await page.getByRole('button', { name: 'Ödeme tablosu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ödeme tablosu' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Simülasyonla ölçülen teorik dönüş ≈ %95,8 (20 milyon tur, %95 GA 95,2–96,4); DEMO değersizdir');
  await expect(dialog).toContainText('101,15×');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The shell's desktop chat log (not part of this game) has its own open scrollable-region finding.
  const result = await new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations, JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))).toEqual([]);
});

test('Space spins: stake reserved, presentation plays, round settles once with the engine payout', async ({ page }) => {
  const round = engine(TUMBLES);
  expect(round.payoutCents).toBeGreaterThan(0);
  await stub(page, TUMBLES);
  await openCascade(page);
  await page.getByLabel('Demo miktarı', { exact: true }).fill('10');
  await page.locator('h1').click(); // focus outside inputs; Space must start the round
  await page.keyboard.press('Space');
  await expect(balance(page)).toContainText('990');
  await expect(page.getByRole('button', { name: 'Atla' })).toBeVisible();
  await expect(page.locator('[data-board][data-focus]')).toBeAttached({ timeout: 5000 }); // a win highlights
  await expect(rows(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(tr(100_000 - 1000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('4 düşme · 5,97×');
  await expect(spin(page)).toBeEnabled();
  await page.waitForTimeout(1500);
  await expect(rows(page)).toHaveCount(1);
});

test('Atla settles immediately with the same payout and shows the final board', async ({ page }) => {
  const round = engine(TUMBLES);
  await stub(page, TUMBLES);
  await openCascade(page);
  await spin(page).click();
  await expect(balance(page)).toContainText('990');
  await page.getByRole('button', { name: 'Atla' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(balance(page)).toContainText(tr(100_000 - 1000 + round.payoutCents));
  await expect(page.getByRole('gridcell')).toHaveCount(30);
  const last = round.spins[0]!.steps.at(-1)!.grid;
  // Row-major reading order of the engine's final grid, exactly as the screen-reader grid lists it.
  const expected = Array.from({ length: 5 }, (_, row) => last.map(column => column[row]!)).flat()
    .map(cell => (cell.symbol === 'crystal' ? `${SYMBOL_LABELS.crystal} ${cell.multiplier}×` : SYMBOL_LABELS[cell.symbol]));
  expect(await page.getByRole('gridcell').allTextContents()).toEqual(expected);
  await page.waitForTimeout(1500);
  await expect(rows(page)).toHaveCount(1);
});

test('navigating away mid-animation settles once with the full payout (no refund)', async ({ page }) => {
  const round = engine(FREE);
  await stub(page, FREE);
  await page.goto('/game/crash');
  await page.getByRole('link', { name: 'Candy Cascade', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Candy Cascade', exact: true, level: 1 })).toBeVisible();
  await spin(page).click();
  await expect(balance(page)).toContainText('990');
  await page.waitForTimeout(700);
  await page.goBack();
  await expect(page).toHaveURL(/\/game\/crash$/);
  await page.getByRole('link', { name: 'Candy Cascade', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Candy Cascade', exact: true, level: 1 })).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Bedava dönüş ×10 · 39,96×');
  await expect(page.locator('.history-table')).not.toContainText('iptal');
  await expect(balance(page)).toContainText(tr(100_000 - 1000 + round.payoutCents));
  await page.waitForTimeout(1500);
  await expect(rows(page)).toHaveCount(1);
});

test('free spins: intro card, crystal multiplier, big win and the engine total (turbo)', async ({ page }) => {
  const round = engine(FREE);
  expect(round.freeSpinsTriggered).toBe(true);
  expect(round.spins.some(s => s.multiplierSum > 0 && s.tumbleHundredths > 0)).toBe(true);
  await stub(page, FREE);
  await openCascade(page);
  await page.getByRole('button', { name: 'Hızlı' }).click();
  await expect(page.getByRole('button', { name: 'Hızlı' })).toHaveAttribute('aria-pressed', 'true');
  await spin(page).click();
  const intro = page.getByRole('dialog', { name: 'Bedava dönüş' });
  await expect(intro).toBeVisible({ timeout: 10_000 });
  await expect(intro).toContainText('10');
  await intro.getByRole('button', { name: 'Başla' }).click();
  await expect(page.getByLabel(/Bedava dönüş \d+, kalan dönüş \d+/)).toBeVisible();
  await expect(page.locator('[class*="badgeSum"]')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByText('Büyük kazanç', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Geçmek için dokun' }).click(); // finish the count-up
  await expect(page.locator('[class*="bigAmount"]')).toContainText(new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(round.payoutCents / 100));
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(balance(page)).toContainText(tr(100_000 - 1000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Bedava dönüş ×10 · 39,96×');
});

test('reduced motion still plays every step and settles with the engine payout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const round = engine(TUMBLES);
  await stub(page, TUMBLES);
  await openCascade(page);
  await spin(page).click();
  await expect(page.locator('[data-board][data-focus]')).toBeAttached({ timeout: 5000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(tr(100_000 - 1000 + round.payoutCents));
});

test('invalid amount and entropy failure never reserve credits', async ({ page }) => {
  await openCascade(page);
  await page.getByLabel('Demo miktarı', { exact: true }).fill('0');
  await spin(page).click();
  await expect(page.locator('#amount-error')).toContainText('1–500 DEMO');
  await page.getByLabel('Demo miktarı', { exact: true }).fill('10');
  await page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: () => { throw new DOMException('no entropy', 'OperationError'); } }));
  await spin(page).click();
  await expect(page.locator('#amount-error')).toContainText('Güvenli yerel rastgelelik kullanılamıyor');
  await expect(balance(page)).toContainText('1.000');
  await expect(rows(page)).toHaveCount(0);
});

test('phone 390x844: no horizontal overflow, board fills the width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, TUMBLES);
  await openCascade(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const box = await page.locator('[data-cells]').boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  await spin(page).click();
  await page.waitForTimeout(1200);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Atla' }).click();
  await expect(rows(page)).toHaveCount(1);
});
