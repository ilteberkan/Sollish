import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DAMLA_EXACT_RTP } from '@sollish/protocol';

/* Sollish Originals game page (components/originals, 27 Oct 2026): bet panel (Manuel/Otomatik, ½ / 2×, Toplam kâr,
   lime action), info bar, game card (real RTP, "Şansımı dene") and the Originals row on Coinflip, Crash and Damla. */
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
const amount = (page: Page) => page.getByLabel('Bahis tutarı', { exact: true });
const pct = (ratio: number) => new Intl.NumberFormat('tr-TR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ratio);

test('Coinflip: tabs, ½ / 2× math, profit readout, info bar and the real RTP chip', async ({ page }) => {
  await page.goto('/game/coinflip');
  await expect(page.getByRole('heading', { name: 'Coinflip', exact: true, level: 1 })).toBeVisible();
  // Manuel is the default tab; Otomatik shows the loss-limit autoplay form.
  await expect(page.getByRole('tab', { name: 'Manuel', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Demoda çevir' })).toBeVisible();
  await page.getByRole('tab', { name: 'Otomatik', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Otomatik', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Demoda çevir' })).toBeHidden();
  await expect(page.getByRole('textbox', { name: /^Kayıp limiti/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Manuel', exact: true }).click();
  // ½ / 2×: integer cents, never below 1 or above 500 DEMO.
  await amount(page).fill('10');
  await page.getByTestId('bet-half').click(); await expect(amount(page)).toHaveValue('5');
  await page.getByTestId('bet-half').click(); await expect(amount(page)).toHaveValue('2,50');
  await page.getByTestId('bet-double').click(); await expect(amount(page)).toHaveValue('5');
  await page.getByTestId('bet-half').click(); await page.getByTestId('bet-half').click(); await page.getByTestId('bet-half').click();
  await expect(amount(page)).toHaveValue('1');
  await amount(page).fill('300'); await page.getByTestId('bet-double').click(); await expect(amount(page)).toHaveValue('500');
  await amount(page).fill('10');
  await expect(page.getByTestId('originals-profit')).toContainText('+9,60 DEMO'); // 10 × 1,96 − 10
  // Info bar: theatre / favourite toggle; practice Coinflip is not provably fair, so there is no /verify link.
  const bar = page.getByRole('toolbar', { name: 'Oyun araçları' });
  await bar.getByRole('button', { name: 'Tiyatro modu' }).click();
  await expect(bar.getByRole('button', { name: 'Tiyatro modu' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-originals-page]')).toHaveAttribute('data-theatre', '');
  await bar.getByRole('button', { name: 'Tiyatro modu' }).click();
  await bar.getByTestId('originals-favorite').click();
  await expect(bar.getByTestId('originals-favorite')).toHaveAttribute('aria-pressed', 'true');
  await bar.getByTestId('originals-favorite').click();
  await expect(bar.getByTestId('originals-fair')).toHaveText('Pratik · kanıtlanabilir adil değil');
  await expect(bar.getByRole('link', { name: 'Kanıtlanabilir adil' })).toHaveCount(0);
  await expect(page.getByTestId('originals-rtp')).toHaveText(`RTP ${pct(0.98)}`);
  // Originals row: every instant original, the open game marked.
  const row = page.getByTestId('originals-row');
  await expect(row.getByRole('link')).toHaveCount(4); // three tiles + "Tümünü gör"
  await expect(row.getByRole('link', { name: 'Coinflip · Şu an oynuyorsun' })).toHaveAttribute('aria-current', 'page');
  await expect(row.getByRole('link', { name: 'Damla: Pamukkale' })).toHaveAttribute('href', '/game/damla');
});

test('Coinflip: "Şansımı dene" plays one normal DEMO round at the current bet', async ({ page }) => {
  await stub(page, 0); // result heads; the random side pick is heads too
  await page.goto('/game/coinflip');
  await amount(page).fill('10');
  await page.getByTestId('originals-try').click();
  await expect(page.locator('.history-table tbody tr')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('.demo-balance')).toContainText('1.009,6');
  await expect(page.getByRole('button', { name: 'Yazı', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Crash: an automatic cash-out target pays exactly the target', async ({ page }) => {
  test.setTimeout(45_000);
  await stub(page, 3_221_225_472); // u = 0,75 → crash point ×3,92
  await page.goto('/game/crash');
  await amount(page).fill('10');
  await page.getByRole('button', { name: '2,00× hedefi' }).click();
  await expect(page.getByRole('textbox', { name: 'Otomatik çıkış', exact: true })).toHaveValue('2');
  await expect(page.getByTestId('originals-profit')).toContainText('+10,00 DEMO');
  await page.getByRole('button', { name: 'Demoyu başlat', exact: true }).click();
  await expect(page.locator('.history-table tbody tr')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.history-table')).toContainText('2,00× çıkış');
  await expect(page.locator('.demo-balance')).toContainText('1.010');
});

test('Crash: autoplay needs a target and a loss limit, and stops before a round that would exceed the limit', async ({ page }) => {
  test.setTimeout(60_000);
  await stub(page, 0); // crash point ×1,00: every round is a loss
  await page.goto('/game/crash');
  await amount(page).fill('10');
  await page.getByRole('tab', { name: 'Otomatik', exact: true }).click();
  await expect(page.getByText('Otomatik oyun için bir çıkış hedefi seç.')).toBeVisible();
  await page.getByRole('button', { name: '1,50× hedefi' }).click();
  const start = page.getByTestId('originals-auto').getByRole('button', { name: /^Başlat/ });
  await expect(start).toBeDisabled();
  await page.getByRole('textbox', { name: /^Kayıp limiti/ }).fill('25');
  await start.click();
  await expect(page.getByText(/Otomatik oyun durdu: Sonraki dönüş kayıp limitini aşardı · 2 tur/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.history-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.demo-balance')).toContainText('980');
});

test('Damla: ½ / 2× walk the bet ladder, RTP chip follows the selected mode, fair link to /verify', async ({ page }) => {
  await page.goto('/game/damla');
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(page.getByTestId('damla-drop')).first()).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('damla-splash').count()) await play.click();
  const value = page.getByRole('button', { name: /seviye menüsünü aç$/ });
  await expect(value).toContainText('1,00');
  await page.getByTestId('bet-double').click(); await expect(value).toContainText('2,00');
  await page.getByTestId('bet-double').click(); await expect(value).toContainText('4,00');
  await page.getByTestId('bet-half').click(); await expect(value).toContainText('2,00');
  await expect(page.getByTestId('originals-rtp')).toHaveText(`RTP ${pct(DAMLA_EXACT_RTP['medium-12'])}`);
  await page.getByTestId('damla-risk').getByRole('radio', { name: 'Yüksek', exact: true }).click();
  await page.getByTestId('damla-rows').getByRole('radio', { name: '16 teras', exact: true }).click();
  await expect(page.getByTestId('originals-rtp')).toHaveText(`RTP ${pct(DAMLA_EXACT_RTP['high-16'])}`);
  await expect(page.getByRole('toolbar', { name: 'Oyun araçları' }).getByRole('link', { name: 'Kanıtlanabilir adil' })).toHaveAttribute('href', '/verify');
  await page.getByRole('toolbar', { name: 'Oyun araçları' }).getByRole('button', { name: 'Ayarlar' }).click();
  await expect(page.getByRole('dialog', { name: 'Ayarlar' })).toBeVisible();
});

for (const route of ['/game/coinflip', '/game/crash', '/game/damla']) {
  test(`${route} phone 390×844: stage first, bet panel under it, no horizontal scroll, axe-clean template`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    if (route.endsWith('damla')) {
      const play = page.getByRole('button', { name: 'Oyna', exact: true });
      await expect(play.or(page.getByTestId('damla-drop')).first()).toBeVisible({ timeout: 30_000 });
      if (await page.getByTestId('damla-splash').count()) await play.click();
    }
    const tabs = (await page.getByRole('tablist', { name: 'Bahis modu' }).boundingBox())!;
    const stage = route.endsWith('damla') ? page.getByRole('group', { name: /traverten teras/ }) : page.getByTestId('originals-stage');
    const stageBox = (await stage.boundingBox())!;
    expect(tabs.y).toBeGreaterThan(stageBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const result = await new AxeBuilder({ page }).include('[data-originals-table]').include('[data-testid="originals-info"]').include('[data-testid="originals-row"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(' ')}`)).toEqual([]);
  });
}
