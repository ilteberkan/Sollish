import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { EBRU_RTP, ebruSeedFromEntropy, playEbruRound, type EbruMode } from '@sollish/protocol';
import { EBRU_SYMBOL_LABELS, ebruCellLabel } from '../../components/ebru/symbols';
import { buildEbruTimeline, ebruCalloutTier, ebruFinalBoard } from '../../lib/ebru-timeline';
import { formatAmount } from '../../lib/slot-kit/bet';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times (engine ebru-ink-1). */
const engine = (fill: number, betCents = 1000, mode: EbruMode = 'standard') => playEbruRound(ebruSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), betCents, mode);
/* Seeds found with the engine (tests/ebru-timeline.test.ts checks the same facts). */
const LOSS = 2_654_435_761;      // standard and ante at 10 DEMO: no win, one comb pass
const COMB_WIN = 1_788_458_060;  // base: 3 comb passes, every one builds a cluster, 2,44x
const BUYUK = 2_353_484_640;     // base 11,20x -> Büyük
const MEGA = 2_825_556_777;      // base 29,60x -> Büyük, Mega
const FREE_LOW = 1_514_186_459;  // standard: Lale Ebrusu, 8,37x: total screen only
const BUY_STAIN = 2_950_288_811; // buy at 10 DEMO: stained clusters up to x26 (callouts), 90,97x -> Süper
const BUY_CAP = 3_373_783_151;   // buy at 1 DEMO, capped at 10000x -> Azami
const START = 100_000;
const CALLOUT_TAGS = ['Leke çarpanı', 'Güçlü leke', 'Parlak leke', 'Lale çarpanı', 'Efsane leke', 'Altın varak'];

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
async function enter(page: Page) {
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(page.getByRole('button', { name: 'Çevir', exact: true })).first()).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('ebru-splash').count()) {
    await play.click();
    await expect(page.getByTestId('ebru-splash')).toHaveCount(0);
  }
}
async function openEbru(page: Page) {
  await page.goto('/game/ebru');
  await expect(page.getByRole('heading', { name: 'Ebru: Mürekkep Bahçesi', exact: true, level: 1 })).toBeVisible();
  await enter(page);
}
const spin = (page: Page) => page.getByRole('button', { name: 'Çevir', exact: true });
const tapIfShown = (locator: Locator, timeout = 15_000) => locator.click({ force: true, timeout }).catch(() => {});
const demoText = (cents: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const celebration = (page: Page) => page.getByTestId('ebru-celebration');
const balance = (page: Page) => page.getByTestId('ebru-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');
const speedButton = (page: Page) => page.getByRole('button', { name: /^Dönüş hızı:/ });
async function setQuick(page: Page) { await speedButton(page).click(); await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Hızlı'); }
async function setTurbo(page: Page) { await speedButton(page).click(); await speedButton(page).click(); await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo'); }
async function chooseBet(page: Page, demo: number) {
  await page.getByRole('button', { name: /seviye menüsünü aç/ }).click();
  await page.getByRole('dialog', { name: 'Bahis seç' }).getByRole('button', { name: `${demo} DEMO`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bahis seç' })).toBeHidden();
}
async function buy(page: Page) {
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  await page.getByRole('dialog', { name: 'Bonus satın al' }).getByRole('button', { name: 'Satın al', exact: true }).click();
}
/** Records celebration levels, meter readings, callouts, banners, comb sweeps and the most stain badges seen. */
async function recordPresentation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __levels: string[]; __meter: number[]; __callouts: string[]; __banners: string[]; __combs: number; __maxStains: number; __toasts: string[]; __celebration: { amount: string; label: string } | null; __intro: string; __total: { text: string; amount: string } | null };
    w.__levels = []; w.__meter = []; w.__callouts = []; w.__banners = []; w.__combs = 0; w.__maxStains = 0; w.__toasts = []; w.__celebration = null; w.__intro = ''; w.__total = null;
    let calloutKey = '', bannerText = '', combing = false;
    const read = () => {
      const level = document.querySelector('[data-testid="ebru-celebration"]')?.getAttribute('data-level');
      if (level && w.__levels.at(-1) !== level) w.__levels.push(level);
      const meter = document.querySelector('[data-testid="ebru-meter-total"]');
      if (meter?.textContent) w.__meter.push(Number(meter.textContent.replace(/[^0-9,]/g, '').replace(',', '.')));
      const callout = document.querySelector('[data-testid="ebru-callout"]');
      const key = callout?.getAttribute('data-key');
      if (callout && key && key !== calloutKey) { calloutKey = key; w.__callouts.push(`${callout.getAttribute('data-tier')}:${callout.textContent}`); }
      const banner = document.querySelector('[data-testid="ebru-banner"]')?.textContent ?? '';
      if (banner && banner !== bannerText) { bannerText = banner; w.__banners.push(banner); }
      const toast = document.querySelector('[data-testid="ebru-toast"]')?.textContent ?? '';
      if (toast && w.__toasts.at(-1) !== toast) w.__toasts.push(toast);
      const celebrationEl = document.querySelector('[data-testid="ebru-celebration"]');
      if (celebrationEl) w.__celebration = { amount: celebrationEl.querySelector('[data-testid="ebru-celebration-amount"]')?.textContent ?? '', label: celebrationEl.getAttribute('aria-label') ?? '' };
      const intro = document.querySelector('[data-testid="ebru-intro"]')?.textContent;
      if (intro) w.__intro = intro;
      const totalEl = document.querySelector('[data-testid="ebru-feature-total"]');
      if (totalEl) w.__total = { text: totalEl.textContent ?? '', amount: totalEl.querySelector('[data-testid="ebru-feature-amount"]')?.textContent ?? '' };
      const nowCombing = !!document.querySelector('[data-board][data-combing]');
      if (nowCombing && !combing) w.__combs++;
      combing = nowCombing;
      const stains = Array.from(document.querySelectorAll('[role="gridcell"]')).filter(c => /leke ×/.test(c.textContent ?? '')).length;
      if (stains > w.__maxStains) w.__maxStains = stains;
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['data-level', 'data-key', 'data-combing', 'aria-label', 'data-text'] });
  });
}
const recorded = <T,>(page: Page, key: string) => page.evaluate(k => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;
const axe = (page: Page) => new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = (result: Awaited<ReturnType<typeof axe>>) => JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
/** Engine final board in row-major reading order, as the accessible grid lists it (stains included). */
const gridLabels = (fill: number, bet = 1000, mode: EbruMode = 'standard') => {
  const { grid, stains } = ebruFinalBoard(engine(fill, bet, mode));
  return Array.from({ length: 7 }, (_, row) => grid.map((column, col) => ({ cell: column[row]!, stain: stains?.[col]?.[row] ?? 0 }))).flat()
    .map(({ cell, stain }) => ebruCellLabel({ symbol: cell.symbol, stain: stain || undefined }));
};
/** Callouts the timeline must show: one per stained cluster step whose best factor is ≥ 10. */
const expectedCallouts = (fill: number, bet = 1000, mode: EbruMode = 'standard') => buildEbruTimeline(engine(fill, bet, mode)).events
  .flatMap(e => (e.type === 'stain-hit' && e.best >= 10 ? [`${ebruCalloutTier(e.best)}:${CALLOUT_TAGS[ebruCalloutTier(e.best)]}×${e.best}`] : []));

async function expectCelebration(page: Page, fill: number, expected: { levels: string[]; title: RegExp }, opts: { bet?: number; mode?: EbruMode; tapWithSpace?: boolean } = {}) {
  const bet = opts.bet ?? 1000, mode = opts.mode ?? 'standard';
  const round = engine(fill, bet, mode);
  await recordPresentation(page);
  await stub(page, fill);
  await openEbru(page);
  await setTurbo(page);
  if (bet !== 1000) await chooseBet(page, bet / 100);
  if (mode === 'buy') await buy(page); else await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents));
  if (round.freeSpinsTriggered) await tapIfShown(page.getByRole('dialog', { name: 'Lale Ebrusu Başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(celebration(page)).toBeVisible({ timeout: 200_000 });
  await expect(spin(page)).toBeDisabled();
  if (opts.tapWithSpace) { await page.locator('h1').click(); await page.keyboard.press('Space'); }
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(celebration(page)).toHaveCount(0);
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents + round.payoutCents));
  // What the screens showed (recorded as they appeared): the final count equals the engine payout.
  const shown = await recorded<{ amount: string; label: string } | null>(page, '__celebration');
  expect(shown?.amount).toBe(demoText(round.payoutCents));
  expect(shown?.label).toMatch(expected.title);
  if (round.freeSpinsTriggered) expect((await recorded<{ amount: string } | null>(page, '__total'))?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<string[]>(page, '__levels')).toEqual(expected.levels);
  return round;
}

test('labelled 7x7 board and deck; info pages navigable, bet-scaled and axe-clean', async ({ page }) => {
  test.setTimeout(90_000);
  await openEbru(page);
  const grid = page.getByRole('grid', { name: /Ebru ızgarası/ });
  await expect(grid.getByRole('row')).toHaveCount(7);
  for (const row of await grid.getByRole('row').all()) await expect(row.getByRole('gridcell')).toHaveCount(7);
  await expect(page.locator('[data-cells] > div[data-sym]')).toHaveCount(49);
  await expect(page.locator('[data-cells] > div[data-sym] use')).toHaveCount(49); // cheap <use> cells
  await expect(balance(page)).toContainText('1.000,00');
  await expect(page.getByTestId('ebru-cost')).toContainText('10,00 DEMO');
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);

  await page.getByRole('button', { name: 'Oyun bilgisi' }).click();
  const info = page.getByRole('dialog', { name: /Oyun bilgisi/ });
  await expect(info.getByRole('tab')).toHaveText(['Nasıl oynanır', 'Ödeme tablosu', 'Özellikler', 'RTP', 'Bahis ve kazanç sınırları', 'Tuşlar', 'Arıza hükmü']);
  await info.getByRole('button', { name: 'Sonraki sayfa' }).click();
  await expect(info.getByRole('tabpanel')).toContainText(EBRU_SYMBOL_LABELS.c1);
  await expect(info.getByRole('tabpanel')).toContainText('41.600,00'); // 33+ c1 at 10 DEMO = 4160x
  await expect(info.getByRole('tabpanel')).toContainText('1.000,00'); // 5+ combs 100x
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await info.getByRole('tab', { name: 'Özellikler' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('round(A · sin(φ + r · k))');
  await expect(info.getByRole('tabpanel')).toContainText('×256');
  await info.getByRole('tab', { name: 'RTP' }).click();
  for (const mode of ['standard', 'ante', 'buy'] as const) await expect(info.getByRole('tabpanel')).toContainText(`%${(EBRU_RTP[mode].rtp * 100).toFixed(1).replace('.', ',')}`);
  await expect(info.getByRole('tabpanel')).toContainText('20 milyon tur simülasyonu');
  await expect(info.getByRole('tabpanel')).toContainText('sertifikasızdır');
  await info.getByRole('tab', { name: 'Bahis ve kazanç sınırları' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('100.000,00 DEMO'); // 10000x at 10 DEMO
  await info.getByRole('tab', { name: 'Tuşlar' }).focus();
  await page.keyboard.press('End');
  await expect(info.getByRole('tab', { name: 'Arıza hükmü' })).toHaveAttribute('aria-selected', 'true');
  await expect(info.getByRole('tabpanel')).toContainText('Arıza, etkilenen bütün oyunları ve ödemeleri geçersiz kılar');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
});

test('spin lock: one debit, button and Space locked through every comb pass, payout and final grid = engine', async ({ page }) => {
  test.setTimeout(60_000);
  const round = engine(COMB_WIN);
  expect(round.spins[0]!.combWins).toBe(3);
  await recordPresentation(page);
  await stub(page, COMB_WIN);
  await openEbru(page);
  await page.locator('h1').click();
  await page.keyboard.press('Space'); // Space starts the round
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  const button = page.getByTestId('ebru-spin');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('data-locked', 'true');
  await expect(page.getByRole('button', { name: 'Atla' })).toHaveCount(0);
  for (let i = 0; i < 3 && await button.isDisabled(); i++) {
    await button.click({ force: true });
    await button.dispatchEvent('click');
    await page.locator('h1').click();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    // Never a second debit: the balance is the one reservation, or (once the round ended) plus the engine payout.
    expect([formatAmount(START - 1000), formatAmount(START - 1000 + round.payoutCents)]).toContain((await balance(page).textContent())!.replace(/\s*DEMO$/, '').trim());
  }
  await expect(rows(page)).toHaveCount(1, { timeout: 40_000 });
  await expect(button).toBeEnabled();
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('3 küme · 3 tarak kazancı · 2,44×');
  await expect(rows(page).first()).toContainText(`${round.seedHex.slice(0, 4)}…${round.seedHex.slice(-4)}`);
  await expect(page.getByTestId('ebru-meter')).toContainText('Toplam kazanç');
  await expect(page.getByTestId('ebru-meter-total')).toContainText(demoText(round.payoutCents));
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  expect(await recorded<number>(page, '__combs')).toBe(3);
  expect(await recorded<string[]>(page, '__banners')).toContain('Tarak yeni küme kurdu');
  expect(await recorded<string[]>(page, '__levels')).toEqual([]); // below 10x: no takeover
  expect(await page.getByRole('gridcell').allTextContents()).toEqual(gridLabels(COMB_WIN));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(1);
});

test('celebration Büyük (10x) via Space: tap finishes the count-up on the engine payout', async ({ page }) => {
  const round = await expectCelebration(page, BUYUK, { levels: ['1'], title: /^Büyük Kazanç/ }, { tapWithSpace: true });
  expect(round.totalHundredths).toBeGreaterThanOrEqual(1000);
});
test('celebration escalates Büyük → Mega (25x)', async ({ page }) => {
  await expectCelebration(page, MEGA, { levels: ['1', '2'], title: /^Mega Kazanç/ });
});

test('bonus buy: dialog, cost bet × 100, Lale Ebrusu intro, stains build and shift, ≥10 callouts, total screen, Süper, balance', async ({ page }) => {
  test.setTimeout(240_000);
  const round = engine(BUY_STAIN, 1000, 'buy');
  expect(round.costCents).toBe(100_000);
  const callouts = expectedCallouts(BUY_STAIN, 1000, 'buy');
  expect(callouts.length).toBeGreaterThan(0);
  await recordPresentation(page);
  await stub(page, BUY_STAIN);
  await openEbru(page);
  await setQuick(page);
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bonus satın al' });
  await expect(dialog).toContainText('1.000,00 DEMO');
  await expect(dialog).toContainText(`Satın alma RTP %${(EBRU_RTP.buy.rtp * 100).toFixed(1).replace('.', ',')}`);
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await dialog.getByRole('button', { name: 'Satın al', exact: true }).click();
  await expect(balance(page)).toContainText(formatAmount(START - 100_000));
  const intro = page.getByRole('dialog', { name: 'Lale Ebrusu Başlıyor' });
  await tapIfShown(intro.getByRole('button', { name: 'Başla' }), 30_000);
  await expect(page.getByLabel(/Bedava dönüş \d+, kalan dönüş \d+/)).toBeVisible();
  await expect(page.getByTestId('ebru-stains')).toBeVisible();
  await expect(spin(page)).toBeDisabled();
  expect(await recorded<string>(page, '__intro')).toMatch(/LALE EBRUSU.*8\s*bedava/i);
  await expect(celebration(page)).toBeVisible({ timeout: 200_000 });
  const total = await recorded<{ text: string; amount: string } | null>(page, '__total');
  expect(total?.text).toContain(`${round.spins.length - 1} dönüş`);
  expect(total?.text).toContain(`×${Math.max(...round.spins.map(s => s.maxStain))}`);
  expect(total?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<string[]>(page, '__callouts')).toEqual(callouts);
  expect(await recorded<number>(page, '__maxStains')).toBeGreaterThan(5);
  expect(await recorded<number>(page, '__combs')).toBeGreaterThanOrEqual(round.spins.length);
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  // The final board shows the engine's last grid with its stain field.
  expect(await page.getByRole('gridcell').allTextContents()).toEqual(gridLabels(BUY_STAIN, 1000, 'buy'));
  // No tap: the counter climbs through every tier on its own (a tap would jump to the final level).
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  const shown = await recorded<{ amount: string; label: string } | null>(page, '__celebration');
  expect(shown?.amount).toBe(demoText(round.payoutCents));
  expect(shown?.label).toMatch(/^Süper Kazanç/);
  await expect(balance(page)).toContainText(formatAmount(START - 100_000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Bonus satın alma');
  await expect(rows(page).first()).toContainText('Lale Ebrusu ×8');
  expect(await recorded<string[]>(page, '__levels')).toEqual(['1', '2', '3']);
});

test('free-spin round below 10x still ends on "Lale Ebrusu — Toplam" with no celebration', async ({ page }) => {
  test.setTimeout(180_000);
  const round = engine(FREE_LOW);
  expect(round.freeSpinsTriggered && round.totalHundredths < 1000).toBe(true);
  await recordPresentation(page);
  await stub(page, FREE_LOW);
  await openEbru(page);
  await setTurbo(page);
  await spin(page).click();
  await tapIfShown(page.getByRole('dialog', { name: 'Lale Ebrusu Başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(rows(page)).toHaveCount(1, { timeout: 150_000 });
  expect((await recorded<{ amount: string } | null>(page, '__total'))?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<string[]>(page, '__levels')).toEqual([]);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('capped buy at 1 DEMO climbs every tier and ends on Azami Kazanç = 10000x bet', async ({ page }) => {
  test.setTimeout(240_000);
  const round = engine(BUY_CAP, 100, 'buy');
  expect(round.capped).toBe(true);
  expect(round.payoutCents).toBe(1_000_000);
  await expectCelebration(page, BUY_CAP, { levels: ['1', '2', '3', '4', '5'], title: /^Azami Kazanç/ }, { bet: 100, mode: 'buy' });
  await expect(rows(page).first()).toContainText('Azami kazanç');
});

test('Şans ×2 debits bet × 1,25, blocks the buy and settles the ante engine round', async ({ page }) => {
  const round = engine(LOSS, 1000, 'ante');
  expect(round.costCents).toBe(1250);
  await stub(page, LOSS);
  await openEbru(page);
  const ante = page.getByRole('switch', { name: 'Şans ×2' });
  await ante.click();
  await expect(ante).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ebru-cost')).toContainText('12,50 DEMO');
  const buyButton = page.getByRole('button', { name: /Bonus satın al/ });
  await expect(buyButton).toHaveAttribute('aria-disabled', 'true');
  await expect(buyButton).toContainText('Şans ×2 açıkken satın alınamaz');
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1250));
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1250 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Şans ×2');
  await expect(rows(page).first()).toContainText('12,50');
});

test('autoplay: simple panel (Gelişmiş closed), required loss limit, stop button, stops before exceeding it', async ({ page }) => {
  test.setTimeout(90_000);
  await recordPresentation(page);
  await stub(page, LOSS);
  await openEbru(page);
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
  await expect(rows(page)).toHaveCount(2, { timeout: 40_000 });
  await expect(page.getByRole('button', { name: /Otomatik oyunu durdur/ })).toHaveCount(0, { timeout: 20_000 });
  expect((await recorded<string[]>(page, '__toasts')).some(t => t.includes('Sonraki dönüş kayıp limitini aşardı'))).toBe(true);
  await expect(balance(page)).toContainText(formatAmount(START - 2000));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(2);
});

test('autoplay stop button ends the run after the current round', async ({ page }) => {
  test.setTimeout(60_000);
  await stub(page, LOSS);
  await openEbru(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('500');
  await panel.getByRole('button', { name: /Başlat · 10 tur/ }).click();
  const stopButton = page.getByRole('button', { name: /Otomatik oyunu durdur/ });
  await stopButton.waitFor();
  const before = await rows(page).count();
  await stopButton.click();
  await expect(page.getByTestId('ebru-toast')).toContainText('Otomatik oyun durdu', { timeout: 20_000 });
  await expect(spin(page)).toBeEnabled({ timeout: 20_000 });
  // The round in progress when Stop landed still plays out and settles once; no new round starts after it. (A turbo
  // no-win round is ~2 s, so on a slow headless page one more round may finish between reading the count and the click.)
  const done = await rows(page).count();
  expect(done).toBeGreaterThanOrEqual(before);
  expect(done).toBeLessThanOrEqual(before + 2);
  await page.waitForTimeout(2500);
  await expect(rows(page)).toHaveCount(done);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 * done));
});

test('navigating away mid-round settles once with the full engine payout (no refund)', async ({ page }) => {
  const round = engine(MEGA);
  await stub(page, MEGA);
  await page.goto('/game/crash');
  await page.getByRole('link', { name: 'Ebru', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Ebru: Mürekkep Bahçesi', exact: true, level: 1 })).toBeVisible();
  await enter(page);
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await page.waitForTimeout(700);
  await page.goBack();
  await expect(page).toHaveURL(/\/game\/crash$/);
  await page.getByRole('link', { name: 'Ebru', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Ebru: Mürekkep Bahçesi', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId('ebru-splash')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('29,60×');
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(1);
});

test('reduced motion plays every step (comb included) and settles with the engine payout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const round = engine(COMB_WIN);
  await recordPresentation(page);
  await stub(page, COMB_WIN);
  await openEbru(page);
  await spin(page).click();
  await expect(page.locator('[data-board][data-focus]')).toBeAttached({ timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  expect(await recorded<number>(page, '__combs')).toBe(3);
  expect(await page.getByRole('gridcell').allTextContents()).toEqual(gridLabels(COMB_WIN));
});

test('entropy failure never reserves credits; history replay never touches the balance; refill logs a line', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(COMB_WIN);
  await stub(page, COMB_WIN);
  await openEbru(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  const after = formatAmount(START - 1000 + round.payoutCents);
  await expect(balance(page)).toContainText(after);
  await page.getByRole('button', { name: /Tekrar oynat: tur/ }).click();
  await expect(page.getByTestId('ebru-replay')).toContainText('Tekrar — bakiye değişmez');
  await expect(spin(page)).toBeDisabled();
  await expect(page.getByTestId('ebru-replay')).toHaveCount(0, { timeout: 30_000 });
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

test('reality check after 30 minutes (page.clock): session time and net, Devam closes it', async ({ page }) => {
  await page.clock.install();
  await page.goto('/game/ebru');
  await expect(page.getByRole('heading', { name: 'Ebru: Mürekkep Bahçesi', exact: true, level: 1 })).toBeVisible();
  await page.clock.runFor(2000);
  await enter(page);
  await expect(page.getByRole('alertdialog', { name: 'Oturum hatırlatması' })).toHaveCount(0);
  await page.clock.fastForward('30:00');
  await page.clock.runFor(2000);
  const reminder = page.getByRole('alertdialog', { name: 'Oturum hatırlatması' });
  await expect(reminder).toBeVisible();
  await expect(reminder).toContainText('Oturum süresi');
  await page.keyboard.press('Escape'); // not dismissible by Esc: the player picks
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: 'Devam' }).click();
  await expect(reminder).toBeHidden();
  await page.clock.runFor(5000);
  await expect(reminder).toBeHidden();
});

test('settings persist across reload; sound toggle runs without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await openEbru(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Ses', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ayarlar' });
  await settings.getByRole('switch', { name: 'Giriş ekranlarını atla' }).click();
  await settings.getByRole('slider', { name: 'Müzik' }).fill('0.3');
  await settings.getByRole('slider', { name: 'Ortam' }).fill('0.2');
  await page.keyboard.press('Escape');
  await page.reload();
  await enter(page);
  await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(settings.getByRole('switch', { name: 'Giriş ekranlarını atla' })).toHaveAttribute('aria-checked', 'true');
  await expect(settings.getByRole('slider', { name: 'Müzik' })).toHaveValue('0.3');
  await expect(settings.getByRole('slider', { name: 'Ortam' })).toHaveValue('0.2');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('phone 390x844: no horizontal overflow, full-width tray, 44px deck targets', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, COMB_WIN);
  await openEbru(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const box = await page.locator('[data-cells]').boundingBox();
  expect(box!.width).toBeGreaterThan(300);
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
  await setTurbo(page);
  await spin(page).click();
  await page.waitForTimeout(1500);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(spin(page)).toBeDisabled();
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  const result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
});

/* Phone fit (22 Oct 2026): the first screen holds the whole table (board, win bar, deck, spin button) with no page
   scroll; phone CSS sizes the table to 100svh below its own top (slot-kit/use-viewport-top). */
test('phone 390x844 first screen: the whole table and the spin button fit without scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEbru(page);
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
