import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

const screenshots = path.resolve(process.cwd(), '../../.tooling/web-screenshots');
test('Crash local cashout updates only demo credits and cannot start a real bet', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(crypto, 'getRandomValues', { value: (array: Uint32Array) => { array.fill(3_221_225_472); return array; } }); });
  await page.goto('/game/crash');
  await expect(page.getByRole('heading', { name: 'Crash', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Demoyu başlat', exact: true }).click();
  await expect(page.locator('#amount-error')).toContainText('1–500');
  await page.getByLabel('Demo miktarı').fill('10');
  await page.getByRole('button', { name: 'Demoyu başlat', exact: true }).click();
  const exit = page.getByRole('button', { name: /Çıkış yap/ });
  await expect(exit).toBeEnabled({ timeout: 5000 });
  await exit.click();
  await expect(page.getByText('Demodan çıkış yaptın')).toBeVisible();
  await expect(page.locator('.history-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Zincir üstü', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Canlı bahis kapalı' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Canlı Crash henüz açık değil.' })).toBeVisible();
});
test('Coinflip performs local gameplay and preserves precise result labels', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(crypto, 'getRandomValues', { value: (array: Uint32Array) => { array.fill(0); return array; } }); });
  await page.goto('/game/coinflip');
  await page.getByLabel('Demo miktarı').fill('10');
  await page.getByRole('button', { name: 'Yazı', exact: true }).click();
  await page.getByRole('button', { name: 'Demoda çevir' }).click();
  await expect(page.getByText('Doğru tahmin.')).toBeVisible();
  await expect(page.locator('.coin-result')).toContainText('19,6 DEMO brüt dönüş');
  await expect(page.locator('.history-table tbody tr')).toHaveCount(1);
});
test('wallet dialog is real discovery, has keyboard dismissal and no fabricated account', async ({ page }) => {
  await page.goto('/game/crash');
  await page.getByRole('button', { name: 'Cüzdan bağla' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Bu tarayıcıda cüzdan bulunamadı')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
test('Wallet Standard fixture is discovered, connected and explicitly disconnected', async ({ page }) => {
  await page.addInitScript(() => {
    const account = { address: '11111111111111111111111111111111', publicKey: new Uint8Array(32), chains: ['solana:devnet'], features: [] };
    const wallet = { version: '1.0.0', name: 'Test cüzdanı (fixture)', icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E', chains: ['solana:devnet'], accounts: [], features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
    } };
    window.addEventListener('wallet-standard:app-ready', event => { (event as CustomEvent<{ register: (wallet: unknown) => void }>).detail.register(wallet); });
  });
  await page.goto('/game/crash');
  await page.getByRole('button', { name: 'Cüzdan bağla' }).click();
  await page.getByRole('button', { name: /Test cüzdanı \(fixture\)/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('.wallet-button').click();
  await expect(page.getByRole('dialog')).toContainText('Test cüzdanı (fixture)');
  await page.getByRole('button', { name: 'Bağlantıyı kes' }).click();
  await expect(page.getByRole('button', { name: 'Cüzdan bağla' })).toBeVisible();
});
test('mobile chat is a keyboard-dismissable dialog and never invents messages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  await page.goto('/game/crash');
  await page.getByRole('button', { name: 'Chat’i aç' }).click();
  const dialog = page.getByRole('dialog', { name: 'Topluluk sohbeti' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.chat-message')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Mesajı gönder' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
test('immediate crash is a loss and a double click never creates duplicate records', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(crypto, 'getRandomValues', { value: (array: Uint32Array) => { array.fill(0); return array; } }); });
  await page.goto('/game/crash');
  await page.getByLabel('Demo miktarı').fill('10');
  await page.getByRole('button', { name: 'Demoyu başlat', exact: true }).dblclick();
  await expect(page.getByText('Tur sona erdi', { exact: true })).toBeVisible();
  await expect(page.locator('.history-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.demo-balance')).toContainText('990');
});
for (const width of [320, 390, 768, 1440]) {
  test(`responsive ${width}px: no horizontal overflow and all routes render`, async ({ page }) => {
    await mkdir(screenshots, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    for (const [route, title] of [['/game/crash', 'Crash'], ['/game/coinflip', 'Coinflip'], ['/rewards', 'Ödüller'], ['/stake', 'Stake']]) {
      await page.goto(route!);
      await expect(page.getByRole('heading', { name: title!, exact: true, level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width <= 768 && route!.startsWith('/game/')) {
        for (const button of await page.locator('.mode-switch button, .amount-quick button, .chat-toggle').all()) {
          const bounds = await button.boundingBox();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.width).toBeGreaterThanOrEqual(44);
        }
        const quick = page.locator('.amount-quick');
        const parent = await quick.boundingBox();
        for (const button of await quick.getByRole('button').all()) {
          const bounds = await button.boundingBox();
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(parent!.x + parent!.width + 1);
        }
      }
      await page.screenshot({ path: path.join(screenshots, `${route!.replaceAll('/', '-')}-${width}.png`), fullPage: true });
    }
  });
}
test('mobile manual cashout remains fixed in the viewport with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { Object.defineProperty(crypto, 'getRandomValues', { value: (array: Uint32Array) => { array.fill(3_221_225_472); return array; } }); });
  await page.goto('/game/crash');
  await page.getByLabel('Demo miktarı').fill('10');
  await page.getByRole('button', { name: 'Demoyu başlat', exact: true }).click();
  const exit = page.getByRole('button', { name: /Çıkış yap/ });
  await expect(exit).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const bounds = await exit.boundingBox();
  expect(bounds!.y).toBeGreaterThan(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(750);
  await expect(page.getByRole('button', { name: 'Chat’i aç' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cüzdan bağla' })).toBeDisabled();
  await page.screenshot({ path: path.join(screenshots, 'crash-mobile-active.png'), fullPage: false });
  await exit.click();
});
for (const width of [390, 1440]) {
  test(`WCAG 2.2 AA automated checks at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/game/crash', '/game/coinflip', '/rewards', '/stake']) {
      await page.goto(route);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.violations, `${route}: ${JSON.stringify(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })))}`).toEqual([]);
    }
  });
}
test('keyboard focus, wallet focus trap, and 200% layout zoom remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/game/crash');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Oyun alanına geç' })).toBeFocused();
  expect(await page.getByRole('link', { name: 'Oyun alanına geç' }).evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.getByRole('button', { name: 'Cüzdan bağla' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.querySelector('dialog.wallet-dialog')?.contains(document.activeElement))).toBe(true); }
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
  await page.keyboard.press('Escape');
  // 1440px physical viewport at 200% browser zoom has 720 CSS pixels.
  // Emulate that reflow/DPR; OS browser chrome and a physical mobile keyboard remain manual checks.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 500, deviceScaleFactor: 2, mobile: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Demoyu başlat', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'crash-layout-zoom-200.png'), fullPage: true });
});
