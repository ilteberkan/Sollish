import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CASCADE2_RTP, cascadeSeedFromEntropy, playCascade2Round, type CascadeMode } from '@sollish/protocol';
import { SYMBOL_LABELS } from '../../components/cascade/symbols';
import { formatAmount } from '../../lib/slot-kit/bet';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times. Engine v2 is what the game plays. */
const engine = (fill: number, betCents = 1000, mode: CascadeMode = 'standard') => playCascade2Round(cascadeSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), betCents, mode);
const TUMBLES = 2_563_011_894; // standard: base spin, 4 tumbles, 5,97x
const FREE = 1_621_328_416;    // standard: 10 free spins, crystals applied, 39,96x (big win)
const LOSS = 0;                // standard and ante at 10 DEMO: no win
const START = 100_000;

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
/** Dismisses the loading/splash screen if it shows (once per page load). */
async function enter(page: Page) {
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(page.getByRole('button', { name: 'Çevir', exact: true }))).toBeVisible({ timeout: 15_000 });
  if (await page.getByTestId('cascade-splash').count()) {
    await play.click();
    await expect(page.getByTestId('cascade-splash')).toHaveCount(0);
  }
}
async function openCascade(page: Page) {
  await page.goto('/game/cascade');
  await expect(page.getByRole('heading', { name: 'Candy Cascade', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('[data-phase]')).toBeVisible();
  await enter(page);
}
const spin = (page: Page) => page.getByRole('button', { name: 'Çevir', exact: true });
const balance = (page: Page) => page.getByTestId('cascade-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');
const speedButton = (page: Page) => page.getByRole('button', { name: /^Dönüş hızı:/ });
async function setTurbo(page: Page) {
  await speedButton(page).click();
  await speedButton(page).click();
  await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo');
}
async function chooseBet(page: Page, demo: number) {
  await page.getByRole('button', { name: /seviye menüsünü aç/ }).click();
  await page.getByRole('dialog', { name: 'Bahis seç' }).getByRole('button', { name: `${demo} DEMO`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bahis seç' })).toBeHidden();
}
const axe = (page: Page) => new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = (result: Awaited<ReturnType<typeof axe>>) => JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));

test('page shows a labelled 6x5 board and the deck; info pages are navigable and axe-clean', async ({ page }) => {
  await openCascade(page);
  const grid = page.getByRole('grid', { name: /Candy Cascade ızgarası/ });
  await expect(grid.getByRole('row')).toHaveCount(5);
  for (const row of await grid.getByRole('row').all()) await expect(row.getByRole('gridcell')).toHaveCount(6);
  await expect(page.locator('[data-cells] > div[data-sym]')).toHaveCount(30);
  await expect(balance(page)).toContainText('1.000,00');
  await expect(page.getByTestId('cascade-cost')).toContainText('10,00 DEMO');
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);

  await page.getByRole('button', { name: 'Oyun bilgisi' }).click();
  const info = page.getByRole('dialog', { name: /Oyun bilgisi/ });
  await expect(info).toBeVisible();
  const titles = ['Nasıl oynanır', 'Ödeme tablosu', 'Özellikler', 'RTP', 'Bahis ve kazanç sınırları', 'Tuşlar', 'Arıza hükmü'];
  await expect(info.getByRole('tab')).toHaveText(titles);
  await expect(info.getByRole('tab', { name: 'Nasıl oynanır' })).toHaveAttribute('aria-selected', 'true');
  await info.getByRole('button', { name: 'Sonraki sayfa' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('101,15×');
  await expect(info.getByRole('tabpanel')).toContainText('1.011,50'); // 12+ crowns at 10 DEMO
  await info.getByRole('tab', { name: 'RTP' }).click();
  for (const mode of ['standard', 'ante', 'buy'] as const) await expect(info.getByRole('tabpanel')).toContainText(`%${(CASCADE2_RTP[mode].rtp * 100).toFixed(1).replace('.', ',')}`);
  await expect(info.getByRole('tabpanel')).toContainText('20 milyon tur simülasyonu');
  await expect(info.getByRole('tabpanel')).toContainText('sertifikasızdır');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await info.getByRole('tab', { name: 'RTP' }).focus();
  await page.keyboard.press('End');
  await expect(info.getByRole('tab', { name: 'Arıza hükmü' })).toHaveAttribute('aria-selected', 'true');
  await expect(info.getByRole('tabpanel')).toContainText('Arıza, etkilenen bütün oyunları ve ödemeleri geçersiz kılar');
  await info.getByRole('tab', { name: 'Bahis ve kazanç sınırları' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('50.000,00 DEMO'); // 5000x at 10 DEMO
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
});

test('Space spins: cost reserved, presentation plays, round settles once with the engine payout', async ({ page }) => {
  const round = engine(TUMBLES);
  expect(round.payoutCents).toBeGreaterThan(0);
  await stub(page, TUMBLES);
  await openCascade(page);
  await page.locator('h1').click(); // focus outside controls; Space must start the round
  await page.keyboard.press('Space');
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await expect(page.getByRole('button', { name: 'Atla' })).toBeVisible();
  await expect(page.locator('[data-board][data-focus]')).toBeAttached({ timeout: 5000 }); // a win highlights
  await expect(rows(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  const row = rows(page).first();
  await expect(row).toContainText('4 düşme · 5,97×');
  await expect(row).toContainText('Standart');
  await expect(row).toContainText(`${round.seedHex.slice(0, 4)}…${round.seedHex.slice(-4)}`);
  await expect(spin(page)).toBeEnabled();
  await page.waitForTimeout(1500);
  await expect(rows(page)).toHaveCount(1);
});

test('Atla settles immediately with the same payout and shows the final board', async ({ page }) => {
  const round = engine(TUMBLES);
  await stub(page, TUMBLES);
  await openCascade(page);
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await page.waitForTimeout(450); // a double tap right after the start is not a skip
  await page.getByRole('button', { name: 'Atla' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  const last = round.spins[0]!.steps.at(-1)!.grid;
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
  await enter(page);
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await page.waitForTimeout(700);
  await page.goBack();
  await expect(page).toHaveURL(/\/game\/crash$/);
  await page.getByRole('link', { name: 'Candy Cascade', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Candy Cascade', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId('cascade-splash')).toHaveCount(0); // the loading screen shows once per page load
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Bedava dönüş ×10 · 39,96×');
  await expect(page.locator('.history-table')).not.toContainText('iptal');
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await page.waitForTimeout(1500);
  await expect(rows(page)).toHaveCount(1);
});

test('free spins (turbo): intro card, crystal multiplier, outro summary, big win and the engine total', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(FREE);
  expect(round.freeSpinsTriggered).toBe(true);
  expect(round.spins.some(s => s.multiplierSum > 0 && s.tumbleHundredths > 0)).toBe(true);
  await stub(page, FREE);
  await openCascade(page);
  await setTurbo(page);
  await spin(page).click();
  const intro = page.getByRole('dialog', { name: 'Bedava dönüş' });
  await expect(intro).toBeVisible({ timeout: 10_000 });
  await expect(intro).toContainText('10');
  await intro.getByRole('button', { name: 'Başla' }).click();
  await expect(page.getByLabel(/Bedava dönüş \d+, kalan dönüş \d+/)).toBeVisible();
  await expect(page.locator('[class*="badgeSum"]')).toBeAttached({ timeout: 30_000 });
  const outro = page.getByRole('dialog', { name: 'Bedava dönüş bitti' });
  await expect(outro).toBeVisible({ timeout: 30_000 });
  await expect(outro).toContainText('Toplam kazanç');
  await expect(outro).toContainText(`${round.spins.length - 1} dönüş`);
  await expect(outro).toContainText(new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(round.payoutCents / 100));
  await outro.getByRole('button', { name: 'Devam' }).click();
  await expect(page.getByText('Büyük kazanç', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Geçmek için dokun' }).click(); // tap finishes the count-up
  await expect(page.locator('[class*="bigAmount"]')).toContainText(new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(round.payoutCents / 100));
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
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
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('entropy failure never reserves credits', async ({ page }) => {
  await openCascade(page);
  await page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: () => { throw new DOMException('no entropy', 'OperationError'); } }));
  await spin(page).click();
  await expect(page.locator('[role="alert"]', { hasText: 'Güvenli yerel rastgelelik kullanılamıyor' })).toBeVisible();
  await expect(balance(page)).toContainText('1.000,00');
  await expect(rows(page)).toHaveCount(0);
});

test('Şans ×2 deducts bet × 1,25, blocks the buy, and settles the ante engine round', async ({ page }) => {
  const round = engine(LOSS, 1000, 'ante');
  expect(round.costCents).toBe(1250);
  await stub(page, LOSS);
  await openCascade(page);
  const ante = page.getByRole('switch', { name: 'Şans ×2' });
  await ante.click();
  await expect(ante).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('cascade-cost')).toContainText('12,50 DEMO');
  const buy = page.getByRole('button', { name: /Bonus satın al/ });
  await expect(buy).toHaveAttribute('aria-disabled', 'true');
  await expect(buy).toContainText('Şans ×2 açıkken satın alınamaz');
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1250));
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1250 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Şans ×2');
  await expect(rows(page).first()).toContainText('12,50');
});

test('bonus buy: dialog, cost bet × 100, intro, outro, balance = start − cost + engine payout', async ({ page }) => {
  test.setTimeout(120_000);
  const round = engine(FREE, 500, 'buy');
  expect(round.costCents).toBe(50_000);
  expect(round.freeSpinsTriggered).toBe(true);
  await stub(page, FREE);
  await openCascade(page);
  await setTurbo(page);
  await chooseBet(page, 5);
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bonus satın al' });
  await expect(dialog).toContainText('500,00 DEMO');
  await expect(dialog).toContainText(`Satın alma RTP %${(CASCADE2_RTP.buy.rtp * 100).toFixed(1).replace('.', ',')}`);
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await dialog.getByRole('button', { name: 'Satın al', exact: true }).click();
  await expect(balance(page)).toContainText(formatAmount(START - 50_000));
  const intro = page.getByRole('dialog', { name: 'Bedava dönüş' });
  await expect(intro).toBeVisible({ timeout: 15_000 });
  await intro.getByRole('button', { name: 'Başla' }).click();
  const outro = page.getByRole('dialog', { name: 'Bedava dönüş bitti' });
  await expect(outro).toBeVisible({ timeout: 60_000 });
  await expect(outro).toContainText(`${round.spins.length - 1} dönüş`);
  await expect(outro).toContainText(new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(round.payoutCents / 100));
  await outro.getByRole('button', { name: 'Devam' }).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 50_000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Bonus satın alma');
  await expect(rows(page).first()).toContainText('500,00');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
});

test('autoplay requires a loss limit and stops before a spin that would exceed it', async ({ page }) => {
  test.setTimeout(90_000);
  expect(engine(LOSS).payoutCents).toBe(0);
  await stub(page, LOSS);
  await openCascade(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await expect(panel.getByRole('button', { name: /Başlat · 10 tur/ })).toBeDisabled(); // no loss limit yet
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('25');
  await panel.getByRole('button', { name: /Başlat · 10 tur/ }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: /Otomatik oyunu durdur/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bonus satın al/ })).toHaveAttribute('aria-disabled', 'true');
  // 2 x 10 = 20 <= 25; a third spin would make 30 > 25.
  await expect(page.getByTestId('cascade-toast')).toContainText('Sonraki dönüş kayıp limitini aşardı', { timeout: 30_000 });
  await expect(rows(page)).toHaveCount(2);
  await expect(balance(page)).toContainText(formatAmount(START - 2000));
  await expect(spin(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(rows(page)).toHaveCount(2);
});

test('autoplay stops on the stop button and when the tab is hidden', async ({ page }) => {
  await stub(page, LOSS);
  await openCascade(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('500');
  await panel.getByRole('button', { name: /Başlat · 10 tur/ }).click();
  await expect(page.getByRole('button', { name: /Otomatik oyunu durdur, \d+ tur kaldı/ })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('cascade-toast')).toContainText('Sekme gizlendiği için durduruldu');
  await expect(page.getByRole('button', { name: /Otomatik oyunu durdur/ })).toHaveCount(0);
});

test('settings persist across reload; sound toggle and sliders run without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await openCascade(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Ses', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ayarlar' });
  await settings.getByRole('switch', { name: 'Giriş ekranlarını atla' }).click();
  await settings.getByRole('slider', { name: 'Müzik' }).fill('0.3');
  await settings.getByRole('slider', { name: 'Efektler' }).fill('0.55');
  await expect(settings.getByRole('slider', { name: 'Müzik' })).toHaveValue('0.3');
  await page.keyboard.press('Escape');
  await page.reload();
  await enter(page);
  await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo');
  await expect(page.getByRole('button', { name: 'Ses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(settings.getByRole('switch', { name: 'Giriş ekranlarını atla' })).toHaveAttribute('aria-checked', 'true');
  await expect(settings.getByRole('slider', { name: 'Müzik' })).toHaveValue('0.3');
  await expect(settings.getByRole('slider', { name: 'Efektler' })).toHaveValue('0.55');
  await settings.getByRole('switch', { name: 'Sesi kapat' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ses', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('history replay plays the exact round on the board without touching the balance', async ({ page }) => {
  const round = engine(TUMBLES);
  await stub(page, TUMBLES);
  await openCascade(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  const after = formatAmount(START - 1000 + round.payoutCents);
  await expect(balance(page)).toContainText(after);
  await page.getByRole('button', { name: /Tekrar oynat: tur/ }).click();
  await expect(page.getByTestId('cascade-replay')).toContainText('Tekrar — bakiye değişmez');
  await expect(page.getByRole('button', { name: 'Atla' })).toBeVisible();
  await expect(page.locator('[data-board][data-focus]')).toBeAttached({ timeout: 5000 });
  await expect(page.getByTestId('cascade-replay')).toHaveCount(0, { timeout: 20_000 });
  await expect(spin(page)).toBeVisible();
  await expect(balance(page)).toContainText(after);
  await expect(rows(page)).toHaveCount(1);
  const last = round.spins[0]!.steps.at(-1)!.grid;
  const expected = Array.from({ length: 5 }, (_, row) => last.map(column => column[row]!)).flat().map(cell => SYMBOL_LABELS[cell.symbol]);
  expect(await page.getByRole('gridcell').allTextContents()).toEqual(expected);
});

test('DEMO refill resets the balance and logs a history line', async ({ page }) => {
  await stub(page, LOSS);
  await openCascade(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await page.getByRole('button', { name: 'Bakiyeyi yenile' }).first().click();
  await expect(balance(page)).toContainText('1.000,00');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Bakiye yenilendi');
});

test('reality check pauses autoplay; Çık stops it and leaves for /games', async ({ page }) => {
  test.setTimeout(90_000);
  // Real 30-minute interval with a faked clock, so this also runs against the production build
  // (the shorter dev-only interval hook does not exist there).
  await page.clock.install();
  await stub(page, LOSS);
  await openCascade(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('900');
  await panel.getByRole('button', { name: /Başlat · 10 tur/ }).click();
  const reminder = page.getByRole('alertdialog', { name: 'Oturum hatırlatması' });
  await page.clock.fastForward('31:00');
  await expect(reminder).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500); // an in-flight round may finish; no new one starts
  const settled = await rows(page).count();
  await page.waitForTimeout(2500);
  await expect(rows(page)).toHaveCount(settled);
  await reminder.getByRole('button', { name: 'Çık' }).click();
  await expect(page).toHaveURL(/\/games$/);
});

test('phone 390x844: no horizontal overflow, full-width board, 44px deck targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, TUMBLES);
  await openCascade(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const box = await page.locator('[data-cells]').boundingBox();
  expect(box!.width).toBeGreaterThan(330);
  for (const name of ['Oyun bilgisi', 'Bahsi azalt', 'Çevir', 'Bahsi artır', 'Otomatik', 'Ayarlar', 'Ses']) {
    const target = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(target!.width, name).toBeGreaterThanOrEqual(44);
    expect(target!.height, name).toBeGreaterThanOrEqual(44);
    expect(target!.x + target!.width, name).toBeLessThanOrEqual(390);
  }
  for (const target of [page.getByRole('switch', { name: 'Şans ×2' }), page.getByRole('button', { name: /Bonus satın al/ }), speedButton(page)]) {
    const b = (await target.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
  }
  await spin(page).click();
  await page.waitForTimeout(1200);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Atla' }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(await overflow()).toBeLessThanOrEqual(0);
});
