import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page, game: 'Crash' | 'Coinflip', entropy: number) {
  await page.addInitScript(entropy => { Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(entropy); return array; } }); }, entropy);
  await page.clock.install();
  await page.goto(game === 'Crash' ? '/game/coinflip' : '/game/crash');
  await page.getByRole('link', { name: game, exact: true }).first().click();
  await expect(page).toHaveURL(game === 'Crash' ? /\/game\/crash$/ : /\/game\/coinflip$/);
  await expect(page.getByRole('heading', { name: game, exact: true, level: 1 })).toBeVisible();
  await page.getByLabel('Demo miktarı', { exact: true }).fill('10');
  await page.getByRole('button', { name: game === 'Crash' ? 'Demoyu başlat' : 'Demoda çevir', exact: true }).click();
  await expect(page.locator('.demo-balance')).toContainText('990');
}
async function backAndReturn(page: Page, game: 'Crash' | 'Coinflip') {
  await page.goBack(); await expect(page).toHaveURL(game === 'Crash' ? /\/game\/coinflip$/ : /\/game\/crash$/);
  await page.getByRole('link', { name: game, exact: true }).first().click();
  await expect(page).toHaveURL(game === 'Crash' ? /\/game\/crash$/ : /\/game\/coinflip$/);
  await expect(page.getByRole('heading', { name: game, exact: true, level: 1 })).toBeVisible();
}
for (const game of ['Crash', 'Coinflip'] as const) {
  test(`${game}: early browser Back cancels local practice once and releases its reservation`, async ({ page }) => {
    await prepare(page, game, 0); await backAndReturn(page, game);
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1); await expect(page.locator('.history-table')).toContainText('Demo iptal edildi');
    await expect(page.locator('.demo-balance')).toContainText('1.000'); await page.clock.fastForward(10_000);
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1); await expect(page.locator('.demo-balance')).toContainText('1.000');
  });
  test(`${game}: suspended animation/timer after deadline cannot turn a loss into a navigation refund`, async ({ page }) => {
    await prepare(page, game, game === 'Coinflip' ? 0xffffffff : 0);
    // Move the authoritative monotonic clock while leaving scheduled work suspended,
    // modelling a background page that has not rendered or run its result callback.
    await page.evaluate(() => {
      const original = performance.now.bind(performance), due = original() + 5000;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => due });
      Object.assign(window, { __restoreSoloClock: () => Object.defineProperty(performance, 'now', { configurable: true, value: original }) });
    });
    await backAndReturn(page, game);
    await page.evaluate(() => (window as unknown as { __restoreSoloClock: () => void }).__restoreSoloClock());
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1); await expect(page.locator('.history-table')).not.toContainText('Demo iptal edildi');
    await expect(page.locator('.demo-balance')).toContainText('990'); await page.clock.fastForward(10_000);
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1); await expect(page.locator('.demo-balance')).toContainText('990');
    await expect(page.getByRole('button', { name: 'Cüzdan bağla', exact: true })).toBeEnabled();
  });
}
test('Coinflip: background completion credits the originally selected winning side once', async ({ page }) => {
  await prepare(page, 'Coinflip', 0);
  await page.evaluate(() => { const due = performance.now() + 2000; Object.defineProperty(performance, 'now', { configurable: true, value: () => due }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.coin-result')).toContainText('19,6 DEMO brüt dönüş'); await expect(page.locator('.demo-balance')).toContainText('1.009,6');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
  await backAndReturn(page, 'Coinflip'); await page.clock.fastForward(10_000);
  await expect(page.locator('.history-table tbody tr')).toHaveCount(1); await expect(page.locator('.demo-balance')).toContainText('1.009,6');
});
