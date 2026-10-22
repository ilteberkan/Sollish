import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/* Info strip under each game and the "Similar games" row (registry-driven; Turkish names: playwright.config.ts). */
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

const SLOTS: Array<[string, string, string, string]> = [
  ['goreme', 'Göreme: Şafak Balonları', 'RTP %96,30', 'En yüksek kazanç ×10.000'],
  ['tarhun', 'Tarhun: Fırtına Tahtı', 'RTP %96,50', 'En yüksek kazanç ×5.000'],
  ['ebru', 'Ebru: Mürekkep Bahçesi', 'RTP %95,70', 'En yüksek kazanç ×10.000'],
  ['cezeri', 'Cezeri: Zamanın Çarkları', 'RTP %95,50', 'En yüksek kazanç ×10.000'],
  ['asena', 'Asena: Yıldız Kurdu', 'RTP %95,20', 'En yüksek kazanç ×5.000'],
  ['cascade', 'Candy Cascade', 'RTP %95,70', 'En yüksek kazanç'],
];

for (const [id, name, rtp, maxWin] of SLOTS) {
  test(`${id}: strip shows Original, RTP, max win, provably fair link, DEMO; similar row lists other games`, async ({ page }) => {
    await page.goto(`/game/${id}`);
    const strip = page.getByRole('region', { name: 'Oyun hakkında' });
    await expect(strip).toContainText('Sollish Orijinal');
    await expect(strip).toContainText(rtp);
    await expect(strip).toContainText(maxWin);
    await expect(strip).toContainText('sertifikalı değildir');
    await expect(strip.getByRole('link', { name: 'Kanıtlanabilir adil' })).toHaveAttribute('href', '/verify');
    const similar = page.getByRole('region', { name: 'Benzer oyunlar' });
    await expect(similar.getByRole('listitem')).toHaveCount(6);
    await expect(similar.getByRole('link', { name })).toHaveCount(0);
    // Other slots come first.
    await expect(similar.getByRole('listitem').first().getByRole('link').first()).toHaveAttribute('href', /^\/game\/(goreme|tarhun|ebru|cezeri|asena|cascade)$/);
  });
}

test('damla: instant strip shows the lowest exact mode RTP, the ×1.000 cap, provably fair link; instant games come first', async ({ page }) => {
  await page.goto('/game/damla');
  const strip = page.getByRole('region', { name: 'Oyun hakkında' });
  await expect(strip).toContainText('Sollish Orijinal');
  await expect(strip).toContainText('RTP %98,45');
  await expect(strip).toContainText('En yüksek kazanç ×1.000');
  await expect(strip).toContainText('sertifikalı değildir');
  await expect(strip.getByRole('link', { name: 'Kanıtlanabilir adil' })).toHaveAttribute('href', '/verify');
  const similar = page.getByRole('region', { name: 'Benzer oyunlar' });
  await expect(similar.getByRole('listitem')).toHaveCount(6);
  await expect(similar.getByRole('link', { name: 'Damla: Pamukkale' })).toHaveCount(0);
  await expect(similar.getByRole('listitem').nth(0).getByRole('link').first()).toHaveAttribute('href', '/game/crash');
  await expect(similar.getByRole('listitem').nth(1).getByRole('link').first()).toHaveAttribute('href', '/game/coinflip');
});

for (const id of ['crash', 'coinflip']) {
  test(`${id}: practice strip says not provably fair (no verify link) and the similar row opens a game`, async ({ page }) => {
    await page.goto(`/game/${id}`);
    const strip = page.getByRole('region', { name: 'Oyun hakkında' });
    await expect(strip).toContainText('RTP %98,00');
    await expect(strip).toContainText('Kasa avantajı %2,00');
    await expect(strip).toContainText('kanıtlanabilir adil değil');
    await expect(strip.getByRole('link')).toHaveCount(0);
    const similar = page.getByRole('region', { name: 'Benzer oyunlar' });
    const first = similar.getByRole('link').first();
    await expect(first).toHaveAttribute('href', id === 'crash' ? '/game/coinflip' : '/game/crash');
    await first.click();
    await expect(page).toHaveURL(id === 'crash' ? /\/game\/coinflip$/ : /\/game\/crash$/);
  });
}

for (const width of [320, 390, 430]) {
  test(`strip and similar row: no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // The strip and the similar row never stick out. (Tarhun's own game table is 6 px wider than a 320 px screen —
    // pre-existing, outside this change — so the page-level check runs on Crash and Coinflip.)
    for (const path of ['/game/tarhun', '/game/crash', '/game/coinflip']) {
      await page.goto(path);
      await expect(page.getByTestId('game-info-strip')).toBeVisible();
      const right = await page.evaluate(() => Math.max(...[document.querySelector('[data-testid="game-info-strip"]')!, document.querySelector('#row-similar-list')!.parentElement!].map(el => el.getBoundingClientRect().right)));
      expect(right, path).toBeLessThanOrEqual(width);
      if (path !== '/game/tarhun') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
  });
}

test.describe('English browser', () => {
  test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });
  test('strip in English and axe-clean', async ({ page }) => {
    await page.goto('/game/crash');
    const strip = page.getByRole('region', { name: 'About this game' });
    await expect(strip).toContainText('Sollish Original');
    await expect(strip).toContainText('RTP 98.00%');
    await expect(strip).toContainText('House edge 2.00%');
    await expect(page.getByRole('region', { name: 'Similar games' })).toBeVisible();
    const result = await new AxeBuilder({ page }).include('[data-testid="game-info-strip"]').include('#row-similar-list').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(v => v.id)).toEqual([]);
  });
});
