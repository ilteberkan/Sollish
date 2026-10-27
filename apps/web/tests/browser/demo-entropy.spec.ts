import { test, expect } from '@playwright/test';

if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

for (const game of [
  { route: '/game/crash', title: 'Crash', start: 'Demoyu başlat', finishedBalance: '990' },
  { route: '/game/coinflip', title: 'Coinflip', start: 'Demoda çevir', finishedBalance: '1.009,6' },
]) for (const source of ['getRandomValues', 'randomUUID'] as const) {
  test(`${game.title} ${source} failure keeps the reservation empty and permits a later round`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto(game.route);
    await page.getByLabel('Bahis tutarı', { exact: true }).fill('10');
    await page.evaluate(source => {
      const originalUUID = crypto.randomUUID.bind(crypto);
      Object.defineProperty(window, '__restoreDemoUUID', { configurable: true, value: () => {
        Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: originalUUID });
      } });
      Object.defineProperty(crypto, source, {
        configurable: true,
        value: () => { throw new DOMException('Injected unavailable entropy', 'OperationError'); },
      });
    }, source);
    await page.getByRole('button', { name: game.start, exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Demo başlatılmadı' })).toBeVisible();
    await expect(page.locator('.demo-balance')).toContainText('1.000');
    await expect(page.locator('.history-table tbody tr')).toHaveCount(0);
    await expect(page.getByRole('button', { name: game.start, exact: true })).toBeEnabled();
    await expect(page.getByLabel('Bahis tutarı', { exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Cüzdan bağla', exact: true })).toBeEnabled();

    // Retry in the same mounted component/provider. A reload or unmount refund
    // must not mask a pending reservation leaked by the failed start handler.
    await page.evaluate(() => {
      (window as unknown as { __restoreDemoUUID: () => void }).__restoreDemoUUID();
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        value: (array: Uint32Array) => { array.fill(0); return array; },
      });
    });

    await expect(page.getByLabel('Bahis tutarı', { exact: true })).toHaveValue('10');
    expect(await page.evaluate(() => typeof (window as unknown as { __restoreDemoUUID?: () => void }).__restoreDemoUUID)).toBe('function');
    await page.getByRole('button', { name: game.start, exact: true }).click();
    await page.clock.fastForward(5_000);
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.demo-balance')).toContainText(game.finishedBalance);
    await expect(page.getByRole('button', { name: game.start, exact: true })).toBeEnabled();
    await page.clock.fastForward(10_000);
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
