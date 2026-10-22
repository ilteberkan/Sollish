import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { STORM_RTP, playStormRound, stormSeedFromEntropy, type StormMode } from '@sollish/protocol';
import { STORM_SYMBOL_LABELS } from '../../components/storm/symbols';
import { formatAmount } from '../../lib/slot-kit/bet';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times (engine storm-throne-1). */
const engine = (fill: number, betCents = 1000, mode: StormMode = 'standard') => playStormRound(stormSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), betCents, mode);
/* Seeds found with the engine (see the report; tests/storm-timeline.test.ts checks the same facts). */
const LOSS = 0;                   // standard and ante at 10 DEMO: no win
const TUMBLES = 2_951_033_815;    // base, 4 tumbles, no orbs, 3,04x
const ORB25 = 61_151_303;         // base, orbs x25 applied, 8,00x
const ORB100 = 3_892_496_642;     // base, orbs x100 applied, 1.024,00x (Efsane)
const TIER_BUYUK = 2_426_448_758; // base, x10 orbs, 12,80x -> Büyük
const TIER_MEGA = 3_916_550_943;  // base, x25 orbs, 36,00x -> Büyük, Mega
const TIER_SUPER = 1_863_343_164; // base, x12 orbs, 77,76x -> Büyük, Mega, Süper
const BUY_RETRIGGER = 2_911_921_316; // buy at 10 DEMO: 20 free spins (+5 retrigger), total x12, 40,04x -> Mega
const FREE_LOW = 1_618_517_822;   // standard: free spins, no orbs applied, 3,00x: total screen only
const BUY_CAP = 1_918_632_665;    // buy at 1 DEMO, capped at 5000x -> Azami
const START = 100_000;

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
async function enter(page: Page) {
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(page.getByRole('button', { name: 'Çevir', exact: true }))).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId('tarhun-splash').count()) {
    await play.click();
    await expect(page.getByTestId('tarhun-splash')).toHaveCount(0);
  }
}
async function openTarhun(page: Page) {
  await page.goto('/game/tarhun');
  await expect(page.getByRole('heading', { name: 'Tarhun: Fırtına Tahtı', exact: true, level: 1 })).toBeVisible();
  await enter(page);
}
const spin = (page: Page) => page.getByRole('button', { name: 'Çevir', exact: true });
const tapIfShown = (locator: Locator, timeout = 15_000) => locator.click({ force: true, timeout }).catch(() => {});
const demoText = (cents: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const celebration = (page: Page) => page.getByTestId('tarhun-celebration');
const balance = (page: Page) => page.getByTestId('tarhun-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');
const speedButton = (page: Page) => page.getByRole('button', { name: /^Dönüş hızı:/ });
async function setQuick(page: Page) { await speedButton(page).click(); await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Hızlı'); }
async function setTurbo(page: Page) { await speedButton(page).click(); await speedButton(page).click(); await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo'); }
async function chooseBet(page: Page, demo: number) {
  await page.getByRole('button', { name: /seviye menüsünü aç/ }).click();
  await page.getByRole('dialog', { name: 'Bahis seç' }).getByRole('button', { name: `${demo} DEMO`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bahis seç' })).toBeHidden();
}
/** Records celebration levels, meter readings, callouts, multiplier meter texts and banners as they appear. */
async function recordPresentation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __levels: string[]; __meter: number[]; __callouts: string[]; __mult: string[]; __banners: string[] };
    w.__levels = []; w.__meter = []; w.__callouts = []; w.__mult = []; w.__banners = [];
    let calloutKey = '', bannerText = '';
    const read = () => {
      const level = document.querySelector('[data-testid="tarhun-celebration"]')?.getAttribute('data-level');
      if (level && w.__levels.at(-1) !== level) w.__levels.push(level);
      const meter = document.querySelector('[data-testid="tarhun-meter-total"]');
      if (meter?.textContent) w.__meter.push(Number(meter.textContent.replace(/[^0-9,]/g, '').replace(',', '.')));
      const callout = document.querySelector('[data-testid="tarhun-callout"]');
      const key = callout?.getAttribute('data-key');
      if (callout && key && key !== calloutKey) { calloutKey = key; w.__callouts.push(`${callout.getAttribute('data-tier')}:${callout.textContent}`); }
      const multEl = document.querySelector('[data-testid="tarhun-multiplier"]');
      const mult = multEl ? `${multEl.querySelector('small')?.textContent ?? ''}|${multEl.querySelector('strong')?.textContent ?? ''}` : '';
      if (mult && w.__mult.at(-1) !== mult) w.__mult.push(mult);
      const banner = document.querySelector('[data-testid="tarhun-banner"]')?.textContent ?? '';
      if (banner && banner !== bannerText) { bannerText = banner; w.__banners.push(banner); }
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['data-level', 'data-key'] });
  });
}
const recorded = <T,>(page: Page, key: string) => page.evaluate(k => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;
const axe = (page: Page) => new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = (result: Awaited<ReturnType<typeof axe>>) => JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
/** Engine final grid in row-major reading order, as the accessible grid lists it. */
const gridLabels = (fill: number, bet = 1000, mode: StormMode = 'standard') => {
  const round = engine(fill, bet, mode);
  const last = round.spins.at(-1)!.steps.at(-1)!.grid;
  return Array.from({ length: 5 }, (_, row) => last.map(column => column[row]!)).flat()
    .map(cell => (cell.symbol === 'orb' ? `${STORM_SYMBOL_LABELS.orb} ×${cell.multiplier}` : STORM_SYMBOL_LABELS[cell.symbol]));
};

async function expectCelebration(page: Page, fill: number, expected: { levels: string[]; title: RegExp }, opts: { bet?: number; mode?: StormMode; tapWithSpace?: boolean } = {}) {
  const bet = opts.bet ?? 1000, mode = opts.mode ?? 'standard';
  const round = engine(fill, bet, mode);
  await recordPresentation(page);
  await stub(page, fill);
  await openTarhun(page);
  if (round.freeSpinsTriggered) await setQuick(page); else await setTurbo(page);
  if (bet !== 1000) await chooseBet(page, bet / 100);
  if (mode === 'buy') {
    await page.getByRole('button', { name: /Bonus satın al/ }).click();
    await page.getByRole('dialog', { name: 'Bonus satın al' }).getByRole('button', { name: 'Satın al', exact: true }).click();
  } else await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents));
  if (round.freeSpinsTriggered) {
    await tapIfShown(page.getByRole('dialog', { name: 'Fırtına Başlıyor' }).getByRole('button', { name: 'Başla' }), 20_000);
    const total = page.getByRole('dialog', { name: /Fırtına Dindi/ });
    await expect(total).toBeVisible({ timeout: 200_000 });
    await expect(total.getByTestId('tarhun-feature-amount')).toHaveText(demoText(round.payoutCents), { timeout: 5000 });
  }
  await expect(celebration(page)).toBeVisible({ timeout: 60_000 });
  await expect(spin(page)).toBeDisabled();
  if (opts.tapWithSpace) { await page.locator('h1').click(); await page.keyboard.press('Space'); }
  else await expect(celebration(page).getByRole('button', { name: 'Devam' })).toBeVisible({ timeout: 20_000 });
  await expect(celebration(page).getByTestId('tarhun-celebration-amount')).toHaveText(demoText(round.payoutCents));
  await expect(celebration(page)).toHaveAccessibleName(expected.title);
  await celebration(page).click({ position: { x: 12, y: 12 }, timeout: 2000 }).catch(() => {});
  await expect(celebration(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents + round.payoutCents));
  expect(await recorded<string[]>(page, '__levels')).toEqual(expected.levels);
  return round;
}

test('labelled 6x5 board and deck; info pages navigable, bet-scaled and axe-clean', async ({ page }) => {
  await openTarhun(page);
  const grid = page.getByRole('grid', { name: /Tarhun ızgarası/ });
  await expect(grid.getByRole('row')).toHaveCount(5);
  for (const row of await grid.getByRole('row').all()) await expect(row.getByRole('gridcell')).toHaveCount(6);
  await expect(page.locator('[data-cells] > div[data-sym]')).toHaveCount(30);
  await expect(page.locator('[data-cells] > div[data-sym] use')).toHaveCount(30); // cheap <use> cells
  await expect(balance(page)).toContainText('1.000,00');
  await expect(page.getByTestId('tarhun-cost')).toContainText('10,00 DEMO');
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);

  await page.getByRole('button', { name: 'Oyun bilgisi' }).click();
  const info = page.getByRole('dialog', { name: /Oyun bilgisi/ });
  await expect(info.getByRole('tab')).toHaveText(['Nasıl oynanır', 'Ödeme tablosu', 'Özellikler', 'RTP', 'Bahis ve kazanç sınırları', 'Tuşlar', 'Arıza hükmü']);
  await info.getByRole('button', { name: 'Sonraki sayfa' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('Altın Boğa Ritonu');
  await expect(info.getByRole('tabpanel')).toContainText('576,00'); // 12+ h1 at 10 DEMO = 57,60x
  await expect(info.getByRole('tabpanel')).toContainText('1.000,00'); // 6+ scatters 100x
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await info.getByRole('tab', { name: 'Özellikler' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('Toplam çarpan');
  await expect(info.getByRole('tabpanel')).toContainText('×500');
  await info.getByRole('tab', { name: 'RTP' }).click();
  for (const mode of ['standard', 'ante', 'buy'] as const) await expect(info.getByRole('tabpanel')).toContainText(`%${(STORM_RTP[mode].rtp * 100).toFixed(1).replace('.', ',')}`);
  await expect(info.getByRole('tabpanel')).toContainText('20 milyon tur simülasyonu');
  await expect(info.getByRole('tabpanel')).toContainText('sertifikasızdır');
  await expect(info.getByRole('tabpanel')).toContainText('değersizdir');
  await info.getByRole('tab', { name: 'Bahis ve kazanç sınırları' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('50.000,00 DEMO');
  await info.getByRole('tab', { name: 'Tuşlar' }).focus();
  await page.keyboard.press('End');
  await expect(info.getByRole('tab', { name: 'Arıza hükmü' })).toHaveAttribute('aria-selected', 'true');
  await expect(info.getByRole('tabpanel')).toContainText('Arıza, etkilenen bütün oyunları ve ödemeleri geçersiz kılar');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
});

test('spin lock: one debit, button and Space locked for the whole round, payout and final grid = engine', async ({ page }) => {
  const round = engine(TUMBLES);
  expect(round.payoutCents).toBeGreaterThan(0);
  await recordPresentation(page);
  await stub(page, TUMBLES);
  await openTarhun(page);
  await page.locator('h1').click();
  await page.keyboard.press('Space'); // Space starts the round
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  const button = page.getByTestId('tarhun-spin');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('data-locked', 'true');
  await expect(page.getByRole('button', { name: 'Atla' })).toHaveCount(0);
  for (let i = 0; i < 4; i++) {
    await button.click({ force: true });
    await button.dispatchEvent('click');
    await page.locator('h1').click();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await expect(balance(page)).toContainText(formatAmount(START - 1000));
    await expect(rows(page)).toHaveCount(0);
  }
  await expect(rows(page)).toHaveCount(1, { timeout: 25_000 });
  await expect(button).toBeEnabled();
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('4 düşme · 3,04×');
  await expect(rows(page).first()).toContainText(`${round.seedHex.slice(0, 4)}…${round.seedHex.slice(-4)}`);
  await expect(page.getByTestId('tarhun-meter')).toContainText('Toplam kazanç');
  await expect(page.getByTestId('tarhun-meter-total')).toContainText(demoText(round.payoutCents));
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  expect(await recorded<string[]>(page, '__levels')).toEqual([]); // below 10x: no takeover
  expect(await page.getByRole('gridcell').allTextContents()).toEqual(gridLabels(TUMBLES));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(1);
});

test('orbs: the god strikes, the ×25 callout shows and the win is multiplied to the engine payout', async ({ page }) => {
  const round = engine(ORB25);
  expect(round.spins[0]!.appliedMultiplier).toBe(25);
  await recordPresentation(page);
  await stub(page, ORB25);
  await openTarhun(page);
  await spin(page).click();
  await expect(page.locator('[data-cells] [data-charge]').first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId('tarhun-callout')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('tarhun-callout')).toContainText('×25');
  await expect(page.getByTestId('tarhun-callout')).toContainText('Gürleyen çarpan');
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  expect(await recorded<string[]>(page, '__callouts')).toEqual(['2:Gürleyen çarpan×25']);
  const mult = await recorded<string[]>(page, '__mult');
  expect(mult.at(-1)).toMatch(/^Çarpan\|(.*= )?×25$/);
  await expect(rows(page).first()).toContainText('×25 · 8,00×');
});

test('×100 orb callout escalates (Efsane tag) and the round ends on Efsane Kazanç = engine payout', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(ORB100);
  expect(round.spins[0]!.appliedMultiplier).toBe(100);
  await expectCelebration(page, ORB100, { levels: ['1', '2', '3', '4'], title: /^Efsane Kazanç/ });
  expect(await recorded<string[]>(page, '__callouts')).toEqual(['4:Efsane çarpan×100']);
});

test('celebration Büyük (10x) via Space: tap finishes the count-up on the engine payout', async ({ page }) => {
  const round = await expectCelebration(page, TIER_BUYUK, { levels: ['1'], title: /^Büyük Kazanç/ }, { tapWithSpace: true });
  expect(round.totalHundredths).toBeGreaterThanOrEqual(1000);
});
test('celebration escalates Büyük → Mega (25x)', async ({ page }) => {
  await expectCelebration(page, TIER_MEGA, { levels: ['1', '2'], title: /^Mega Kazanç/ });
});
test('celebration escalates Büyük → Mega → Süper (50x)', async ({ page }) => {
  await expectCelebration(page, TIER_SUPER, { levels: ['1', '2', '3'], title: /^Süper Kazanç/ });
});

test('bonus buy (quick): dialog, cost bet × 100, intro, total multiplier grows, +5 retrigger, total screen, Mega, balance', async ({ page }) => {
  test.setTimeout(240_000);
  const round = engine(BUY_RETRIGGER, 1000, 'buy');
  expect(round.costCents).toBe(100_000);
  expect(round.spins.some(s => s.kind === 'free' && s.freeSpinsAwarded === 5)).toBe(true);
  const finalTotal = round.spins.at(-1)!.totalMultiplierAfter;
  await recordPresentation(page);
  await stub(page, BUY_RETRIGGER);
  await openTarhun(page);
  await setQuick(page);
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bonus satın al' });
  await expect(dialog).toContainText('1.000,00 DEMO');
  await expect(dialog).toContainText(`Satın alma RTP %${(STORM_RTP.buy.rtp * 100).toFixed(1).replace('.', ',')}`);
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await dialog.getByRole('button', { name: 'Satın al', exact: true }).click();
  await expect(balance(page)).toContainText(formatAmount(START - 100_000));
  const intro = page.getByRole('dialog', { name: 'Fırtına Başlıyor' });
  await expect(intro).toBeVisible({ timeout: 20_000 });
  await expect(intro).toContainText('15');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await tapIfShown(intro.getByRole('button', { name: 'Başla' }), 5000);
  await expect(page.getByLabel(/Bedava dönüş \d+, kalan dönüş \d+/)).toBeVisible();
  await expect(page.getByTestId('tarhun-multiplier')).toContainText('Toplam çarpan');
  await expect(spin(page)).toBeDisabled();
  const total = page.getByRole('dialog', { name: /Fırtına Dindi/ });
  await expect(total).toBeVisible({ timeout: 200_000 });
  await expect(total).toContainText(`${round.spins.length - 1} dönüş`);
  await expect(total).toContainText(`×${finalTotal}`);
  await expect(total.getByTestId('tarhun-feature-amount')).toHaveText(demoText(round.payoutCents));
  await expect(page.getByTestId('tarhun-multiplier')).toContainText(`×${finalTotal}`);
  // The persistent total multiplier never went down, and ended on the engine total.
  const mults = (await recorded<string[]>(page, '__mult')).filter(m => /^Toplam çarpan\|×\d+$/.test(m)).map(m => Number(m.split('×')[1]));
  for (let i = 1; i < mults.length; i++) expect(mults[i]!, `total multiplier ${i}`).toBeGreaterThanOrEqual(mults[i - 1]!);
  expect(mults.at(-1)).toBe(finalTotal);
  expect(await recorded<string[]>(page, '__banners')).toContain('+5 bedava dönüş');
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  await tapIfShown(total.getByRole('button', { name: 'Kutlamaya geç' }), 3000);
  await expect(celebration(page)).toBeVisible({ timeout: 10_000 });
  await celebration(page).click({ position: { x: 12, y: 12 } });
  await expect(celebration(page).getByTestId('tarhun-celebration-amount')).toHaveText(demoText(round.payoutCents));
  await expect(celebration(page)).toHaveAccessibleName(/^Mega Kazanç/);
  await celebration(page).click({ position: { x: 12, y: 12 } }).catch(() => {});
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 100_000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Bonus satın alma');
  await expect(rows(page).first()).toContainText(`toplam ×${finalTotal}`);
  expect(await recorded<string[]>(page, '__levels')).toEqual(['1', '2']);
});

test('free-spin round below 10x still ends on "Fırtına Dindi — Toplam" with no celebration', async ({ page }) => {
  test.setTimeout(180_000);
  const round = engine(FREE_LOW);
  expect(round.freeSpinsTriggered && round.totalHundredths < 1000).toBe(true);
  await recordPresentation(page);
  await stub(page, FREE_LOW);
  await openTarhun(page);
  await setQuick(page);
  await spin(page).click();
  await tapIfShown(page.getByRole('dialog', { name: 'Fırtına Başlıyor' }).getByRole('button', { name: 'Başla' }), 20_000);
  const total = page.getByRole('dialog', { name: /Fırtına Dindi/ });
  await expect(total).toBeVisible({ timeout: 150_000 });
  await expect(total.getByTestId('tarhun-feature-amount')).toHaveText(demoText(round.payoutCents));
  await tapIfShown(total.getByRole('button', { name: 'Devam' }), 3000);
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  expect(await recorded<string[]>(page, '__levels')).toEqual([]);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('capped buy at 1 DEMO climbs every tier and ends on Azami Kazanç = 5000x bet', async ({ page }) => {
  test.setTimeout(240_000);
  const round = engine(BUY_CAP, 100, 'buy');
  expect(round.capped).toBe(true);
  expect(round.payoutCents).toBe(500_000);
  await expectCelebration(page, BUY_CAP, { levels: ['1', '2', '3', '4', '5'], title: /^Azami Kazanç/ }, { bet: 100, mode: 'buy' });
  await expect(rows(page).first()).toContainText('Azami kazanç');
});

test('Şans ×2 debits bet × 1,25, blocks the buy and settles the ante engine round', async ({ page }) => {
  const round = engine(LOSS, 1000, 'ante');
  expect(round.costCents).toBe(1250);
  await stub(page, LOSS);
  await openTarhun(page);
  const ante = page.getByRole('switch', { name: 'Şans ×2' });
  await ante.click();
  await expect(ante).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('tarhun-cost')).toContainText('12,50 DEMO');
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

test('autoplay: simple panel (Gelişmiş closed), required loss limit, stops before exceeding it', async ({ page }) => {
  test.setTimeout(90_000);
  await stub(page, LOSS);
  await openTarhun(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await expect(panel.getByRole('button', { name: /Başlat · 10 tur/ })).toBeDisabled();
  const advanced = panel.locator('details');
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect(advanced.locator('summary')).toContainText('Gelişmiş');
  await expect(panel.getByRole('switch', { name: 'Her kazançta dur' })).toBeHidden();
  const result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('25');
  await panel.getByRole('button', { name: /Başlat · 10 tur/ }).click();
  await expect(page.getByRole('button', { name: /Otomatik oyunu durdur/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bonus satın al/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('tarhun-toast')).toContainText('Sonraki dönüş kayıp limitini aşardı', { timeout: 40_000 });
  await expect(rows(page)).toHaveCount(2);
  await expect(balance(page)).toContainText(formatAmount(START - 2000));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(2);
});

test('navigating away mid-round settles once with the full engine payout (no refund)', async ({ page }) => {
  const round = engine(TIER_MEGA);
  await stub(page, TIER_MEGA);
  await page.goto('/game/crash');
  await page.getByRole('link', { name: 'Tarhun', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Tarhun: Fırtına Tahtı', exact: true, level: 1 })).toBeVisible();
  await enter(page);
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await page.waitForTimeout(700);
  await page.goBack();
  await expect(page).toHaveURL(/\/game\/crash$/);
  await page.getByRole('link', { name: 'Tarhun', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Tarhun: Fırtına Tahtı', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId('tarhun-splash')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('36,00×');
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(1);
});

test('reduced motion plays every step (orbs included) and settles with the engine payout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const round = engine(ORB25);
  await stub(page, ORB25);
  await openTarhun(page);
  await spin(page).click();
  await expect(page.locator('[data-board][data-focus]')).toBeAttached({ timeout: 8000 });
  await expect(page.getByTestId('tarhun-callout')).toBeVisible({ timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('entropy failure never reserves credits; history replay never touches the balance; refill logs a line', async ({ page }) => {
  const round = engine(TUMBLES);
  await stub(page, TUMBLES);
  await openTarhun(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  const after = formatAmount(START - 1000 + round.payoutCents);
  await expect(balance(page)).toContainText(after);
  await page.getByRole('button', { name: /Tekrar oynat: tur/ }).click();
  await expect(page.getByTestId('tarhun-replay')).toContainText('Tekrar — bakiye değişmez');
  await expect(spin(page)).toBeDisabled();
  await expect(page.getByTestId('tarhun-replay')).toHaveCount(0, { timeout: 20_000 });
  await expect(balance(page)).toContainText(after);
  await expect(rows(page)).toHaveCount(1);
  await page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: () => { throw new DOMException('no entropy', 'OperationError'); } }));
  await spin(page).click();
  await expect(page.locator('[role="alert"]', { hasText: 'Güvenli yerel rastgelelik kullanılamıyor' })).toBeVisible();
  await expect(balance(page)).toContainText(after);
  await page.getByRole('button', { name: 'Bakiyeyi yenile' }).first().click();
  await expect(balance(page)).toContainText('1.000,00');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Bakiye yenilendi');
});

test('settings persist across reload; sound toggle runs without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await openTarhun(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Ses', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ayarlar' });
  await settings.getByRole('switch', { name: 'Giriş ekranlarını atla' }).click();
  await settings.getByRole('slider', { name: 'Müzik' }).fill('0.3');
  await page.keyboard.press('Escape');
  await page.reload();
  await enter(page);
  await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(settings.getByRole('switch', { name: 'Giriş ekranlarını atla' })).toHaveAttribute('aria-checked', 'true');
  await expect(settings.getByRole('slider', { name: 'Müzik' })).toHaveValue('0.3');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('phone 390x844: no horizontal overflow, full-width board, 44px deck targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, ORB25);
  await openTarhun(page);
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
  await page.waitForTimeout(1500);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(spin(page)).toBeDisabled();
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  const result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
});

/* Phone fit (22 Oct 2026): the first screen holds the whole table (board, win bar, deck, spin button) with no page
   scroll; phone CSS sizes the table to 100svh below its own top (slot-kit/use-viewport-top). */
test('phone 390x844 first screen: the whole table and the spin button fit without scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTarhun(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const spinBox = (await spin(page).boundingBox())!;
  expect(spinBox.y, 'spin button top').toBeGreaterThanOrEqual(0);
  expect(spinBox.y + spinBox.height, 'spin button bottom').toBeLessThanOrEqual(844);
  const tableBox = (await page.locator('.game-table').boundingBox())!;
  expect(tableBox.y + tableBox.height, 'table bottom').toBeLessThanOrEqual(844);
  const buyBox = (await page.getByRole('button', { name: /Bonus satın al/ }).boundingBox())!;
  expect(buyBox.y + buyBox.height, 'buy button bottom').toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
