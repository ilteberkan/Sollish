import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CEZERI_RTP, cezeriSeedFromEntropy, playCezeriRound, type CezeriMode } from '@sollish/protocol';
import { formatAmount } from '../../lib/slot-kit/bet';
import { cezeriBreakdown } from '../../lib/round-breakdown/cezeri';
import { allLines } from '../../lib/round-breakdown/types';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times (engine cezeri-gears-1). */
const engine = (fill: number, betCents = 1000, mode: CezeriMode = 'standard') => playCezeriRound(cezeriSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), betCents, mode);
/* Seeds found with the engine (tests/cezeri-timeline.test.ts checks the same facts). */
const LOSS = 1_107_666_780;     // standard at 10 DEMO: no win
const CHAIN2 = 4_072_214_393;   // base: 2 respins, hub 1 -> 3, 2,30x
const HUB10 = 3_175_850_668;    // base: hub reaches x11 (callout), 0,50x
const BUYUK = 3_690_074_171;    // base: 5 respins, 12,77x -> Büyük
const MEGA = 1_792_267_404;     // base: 4 respins, 25,34x -> Büyük, Mega
const LONG10 = 1_846_062_645;   // base: 10 respins (the full chain), 21,23x
const FREE_LOW = 2_288_122_716; // standard: Fil Saati, 9,38x: total screen only
const BUY_MEGA = 1_865_544_835; // buy at 1 DEMO: 14 free spins, 4 falcon visits, 39,81x -> Mega
const ANTE_LOSS = 147_934_750;  // ante at 10 DEMO: no win
const START = 100_000;

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
async function enter(page: Page) {
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(page.getByRole('button', { name: 'Çevir', exact: true })).first()).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('cezeri-splash').count()) {
    await play.click();
    await expect(page.getByTestId('cezeri-splash')).toHaveCount(0);
  }
}
async function openCezeri(page: Page) {
  await page.goto('/game/cezeri');
  await expect(page.getByRole('heading', { name: 'Cezeri: Zamanın Çarkları', exact: true, level: 1 })).toBeVisible();
  await enter(page);
}
const spin = (page: Page) => page.getByRole('button', { name: 'Çevir', exact: true });
const tapIfShown = (locator: Locator, timeout = 15_000) => locator.click({ force: true, timeout }).catch(() => {});
const demoText = (cents: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const celebration = (page: Page) => page.getByTestId('cezeri-celebration');
const balance = (page: Page) => page.getByTestId('cezeri-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');
const speedButton = (page: Page) => page.getByRole('button', { name: /^Dönüş hızı:/ });
async function setQuick(page: Page) { await speedButton(page).click(); await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Hızlı'); }
async function setTurbo(page: Page) { await speedButton(page).click(); await speedButton(page).click(); await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo'); }
async function chooseBet(page: Page, demo: number) {
  await page.getByRole('button', { name: /seviye menüsünü aç/ }).click();
  await page.getByRole('dialog', { name: 'Bahis seç' }).getByRole('button', { name: `${demo} DEMO`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bahis seç' })).toBeHidden();
}
/** Records celebration levels, meter readings, hub values, chain pips, callouts, banners and falcon plates as they appear. */
async function recordPresentation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __levels: string[]; __meter: number[]; __hub: number[]; __chain: number; __callouts: string[]; __banners: string[]; __pinned: number; __reservoir: number };
    w.__levels = []; w.__meter = []; w.__hub = []; w.__chain = 0; w.__callouts = []; w.__banners = []; w.__pinned = 0; w.__reservoir = 0;
    let calloutKey = '', bannerText = '';
    const read = () => {
      const level = document.querySelector('[data-testid="cezeri-celebration"]')?.getAttribute('data-level');
      if (level && w.__levels.at(-1) !== level) w.__levels.push(level);
      const meter = document.querySelector('[data-testid="cezeri-meter-total"]');
      if (meter?.textContent) w.__meter.push(Number(meter.textContent.replace(/[^0-9,]/g, '').replace(',', '.')));
      const hub = document.querySelector('[data-testid="cezeri-hub"] strong')?.textContent;
      if (hub) { const v = Number(hub.replace(/\D/g, '')); if (w.__hub.at(-1) !== v) w.__hub.push(v); }
      w.__chain = Math.max(w.__chain, document.querySelectorAll('[data-testid="cezeri-chain"] i[data-on]').length);
      const callout = document.querySelector('[data-testid="cezeri-callout"]');
      const key = callout?.getAttribute('data-key');
      if (callout && key && key !== calloutKey) { calloutKey = key; w.__callouts.push(`${callout.getAttribute('data-tier')}:${callout.textContent}`); }
      const banner = document.querySelector('[data-testid="cezeri-banner"]')?.textContent ?? '';
      if (banner && banner !== bannerText) { bannerText = banner; w.__banners.push(banner); }
      w.__pinned = Math.max(w.__pinned, document.querySelectorAll('[data-kind="pinned"]').length);
      w.__reservoir = Math.max(w.__reservoir, Number(document.querySelector('[data-testid="cezeri-reservoir"]')?.getAttribute('data-level') ?? 0));
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['data-level', 'data-key', 'data-on', 'data-kind'] });
  });
}
const recorded = <T,>(page: Page, key: string) => page.evaluate(k => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;
const axe = (page: Page) => new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = (result: Awaited<ReturnType<typeof axe>>) => JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));

async function expectCelebration(page: Page, fill: number, expected: { levels: string[]; title: RegExp }, opts: { bet?: number; mode?: CezeriMode; tapWithSpace?: boolean } = {}) {
  const bet = opts.bet ?? 1000, mode = opts.mode ?? 'standard';
  const round = engine(fill, bet, mode);
  await recordPresentation(page);
  await stub(page, fill);
  await openCezeri(page);
  if (opts.tapWithSpace) { /* normal speed: the hold after the tap is long enough to read the amount */ }
  else if (round.freeSpinsTriggered) await setQuick(page); else await setTurbo(page);
  if (bet !== 1000) await chooseBet(page, bet / 100);
  if (mode === 'buy') {
    await page.getByRole('button', { name: /Bonus satın al/ }).click();
    await page.getByRole('dialog', { name: 'Bonus satın al' }).getByRole('button', { name: 'Satın al', exact: true }).click();
  } else await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents));
  if (round.freeSpinsTriggered) {
    await tapIfShown(page.getByRole('dialog', { name: 'Fil Saati Başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
    const total = page.getByRole('dialog', { name: /Fil Saati.{0,3}Toplam/ });
    await expect(total).toBeVisible({ timeout: 240_000 });
    await expect(total.getByTestId('cezeri-feature-amount')).toHaveText(demoText(round.payoutCents), { timeout: 5000 });
  }
  await expect(celebration(page)).toBeVisible({ timeout: 90_000 });
  await expect(spin(page)).toBeDisabled();
  if (opts.tapWithSpace) { await page.locator('h1').click(); await page.keyboard.press('Space'); }
  else await expect(celebration(page).getByRole('button', { name: 'Devam' })).toBeVisible({ timeout: 20_000 });
  await expect(celebration(page).getByTestId('cezeri-celebration-amount')).toHaveText(demoText(round.payoutCents));
  await expect(celebration(page)).toHaveAccessibleName(expected.title);
  await celebration(page).click({ position: { x: 12, y: 12 }, timeout: 2000 }).catch(() => {});
  await expect(celebration(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents + round.payoutCents));
  expect(await recorded<string[]>(page, '__levels')).toEqual(expected.levels);
  return round;
}

test('labelled 4-ring board and deck; info pages navigable, bet-scaled and axe-clean', async ({ page }) => {
  test.setTimeout(60_000); // first page load compiles the route in dev and runs axe three times
  await openCezeri(page);
  const grid = page.getByRole('grid', { name: /Cezeri çarkları/ });
  await expect(grid.getByRole('row')).toHaveCount(4);
  for (const row of await grid.getByRole('row').all()) await expect(row.getByRole('gridcell')).toHaveCount(12);
  await expect(balance(page)).toContainText('1.000,00');
  await expect(page.getByTestId('cezeri-cost')).toContainText('10,00 DEMO');
  await expect(page.getByTestId('cezeri-hub')).toContainText('×1');
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);

  await page.getByRole('button', { name: 'Oyun bilgisi' }).click();
  const info = page.getByRole('dialog', { name: /Oyun bilgisi/ });
  await expect(info.getByRole('tab')).toHaveText(['Nasıl oynanır', 'Ödeme tablosu', 'Özellikler', 'RTP', 'Bahis ve kazanç sınırları', 'Tuşlar', 'Arıza hükmü']);
  await info.getByRole('button', { name: 'Sonraki sayfa' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('Fil Saati');
  await expect(info.getByRole('tabpanel')).toContainText('11,40'); // 4 h1 at 10 DEMO = 1,14x
  await expect(info.getByRole('tabpanel')).toContainText('500,00'); // 5+ vessels 50x
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await info.getByRole('tab', { name: 'Özellikler' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('Dişli Kilidi');
  await expect(info.getByRole('tabpanel')).toContainText('otomat şahin');
  await info.getByRole('tab', { name: 'RTP' }).click();
  for (const mode of ['standard', 'ante', 'buy'] as const) await expect(info.getByRole('tabpanel')).toContainText(`%${(CEZERI_RTP[mode].rtp * 100).toFixed(1).replace('.', ',')}`);
  await expect(info.getByRole('tabpanel')).toContainText('20 milyon tur simülasyonu');
  await expect(info.getByRole('tabpanel')).toContainText('sertifikasızdır');
  await info.getByRole('tab', { name: 'Bahis ve kazanç sınırları' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('100.000,00 DEMO'); // 10 DEMO x 10000
  await info.getByRole('tab', { name: 'Tuşlar' }).focus();
  await page.keyboard.press('End');
  await expect(info.getByRole('tab', { name: 'Arıza hükmü' })).toHaveAttribute('aria-selected', 'true');
  await expect(info.getByRole('tabpanel')).toContainText('Arıza, etkilenen bütün oyunları ve ödemeleri geçersiz kılar');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
});

test('spin lock: one debit, button and Space locked through the whole chain; hub ticks +1; payout and history = engine', async ({ page }) => {
  const round = engine(CHAIN2);
  expect(round.spins[0]!.respins).toBe(2);
  await recordPresentation(page);
  await stub(page, CHAIN2);
  await openCezeri(page);
  await page.locator('h1').click();
  await page.keyboard.press('Space');
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  const button = page.getByTestId('cezeri-spin');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('data-locked', 'true');
  await expect(page.getByRole('button', { name: 'Atla' })).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await button.click({ force: true });
    await button.dispatchEvent('click');
    await page.locator('h1').click();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    await expect(balance(page)).toContainText(formatAmount(START - 1000));
    await expect(rows(page)).toHaveCount(0);
  }
  await expect(page.locator('[data-kind="held"]').first()).toBeAttached({ timeout: 15_000 }); // Dişli Kilidi clamps
  await expect(rows(page)).toHaveCount(1, { timeout: 40_000 });
  await expect(button).toBeEnabled();
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('2 yeniden dönüş · göbek ×3 · 2,30×');
  await expect(rows(page).first()).toContainText(`${round.seedHex.slice(0, 4)}…${round.seedHex.slice(-4)}`);
  await expect(page.getByTestId('cezeri-meter')).toContainText('Toplam kazanç');
  await expect(page.getByTestId('cezeri-meter-total')).toContainText(demoText(round.payoutCents));
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  expect(await recorded<number[]>(page, '__hub')).toEqual([1, 2, 3]);
  expect(await recorded<number>(page, '__chain')).toBe(2);
  expect(await recorded<string[]>(page, '__levels')).toEqual([]);
  await expect(page.locator('[data-kind="held"]')).toHaveCount(0); // clamps released at the chain end
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(1);
});

test('hub ×10 and above is announced with its own big callout', async ({ page }) => {
  const round = engine(HUB10);
  await recordPresentation(page);
  await stub(page, HUB10);
  await openCezeri(page);
  await setQuick(page);
  await spin(page).click();
  await expect(page.getByTestId('cezeri-callout')).toBeVisible({ timeout: 30_000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 40_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  const callouts = await recorded<string[]>(page, '__callouts');
  expect(callouts.length).toBe(1);
  expect(callouts[0]).toMatch(/^1:Güçlü göbek×1\d$/);
});

test('long chain: all ten respins play (pips 10/10), the hub climbs to its engine value', async ({ page }) => {
  test.setTimeout(120_000);
  const round = engine(LONG10);
  const spin0 = round.spins[0]!;
  expect(spin0.respins).toBe(10);
  await recordPresentation(page);
  await stub(page, LONG10);
  await openCezeri(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(celebration(page)).toBeVisible({ timeout: 60_000 });
  await celebration(page).click({ position: { x: 12, y: 12 } });
  await celebration(page).click({ position: { x: 12, y: 12 } }).catch(() => {});
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  expect(await recorded<number>(page, '__chain')).toBe(10);
  const hubs = await recorded<number[]>(page, '__hub');
  expect(hubs.slice(-11)).toEqual(Array.from({ length: 11 }, (_, i) => spin0.hubStart + i));
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('celebration Büyük (10x) via Space: tap finishes the count-up on the engine payout', async ({ page }) => {
  test.setTimeout(90_000);
  const round = await expectCelebration(page, BUYUK, { levels: ['1'], title: /^Büyük Kazanç/ }, { tapWithSpace: true });
  expect(round.totalHundredths).toBeGreaterThanOrEqual(1000);
});
test('celebration escalates Büyük → Mega (25x)', async ({ page }) => {
  test.setTimeout(90_000);
  await expectCelebration(page, MEGA, { levels: ['1', '2'], title: /^Mega Kazanç/ });
});

test('bonus buy (quick): dialog ×100, intro, persistent hub, reservoir fills, falcon pins wilds, total screen, Mega, balance', async ({ page }) => {
  test.setTimeout(300_000);
  const round = engine(BUY_MEGA, 100, 'buy');
  expect(round.costCents).toBe(10_000);
  const falconWilds = round.spins.at(-1)!.wilds.length;
  expect(falconWilds).toBeGreaterThan(0);
  await recordPresentation(page);
  await stub(page, BUY_MEGA);
  await openCezeri(page);
  await setQuick(page);
  await chooseBet(page, 1);
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bonus satın al' });
  await expect(dialog).toContainText('100,00 DEMO');
  await expect(dialog).toContainText(`Satın alma RTP %${(CEZERI_RTP.buy.rtp * 100).toFixed(1).replace('.', ',')}`);
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await dialog.getByRole('button', { name: 'Satın al', exact: true }).click();
  await expect(balance(page)).toContainText(formatAmount(START - 10_000));
  const intro = page.getByRole('dialog', { name: 'Fil Saati Başlıyor' });
  await expect(intro).toBeVisible({ timeout: 40_000 });
  await expect(intro).toContainText('10');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await tapIfShown(intro.getByRole('button', { name: 'Başla' }), 5000);
  await expect(page.getByLabel(/Bedava dönüş \d+, kalan dönüş \d+/)).toBeVisible();
  await expect(page.getByTestId('cezeri-hub')).toContainText('korunur');
  await expect(spin(page)).toBeDisabled();
  const total = page.getByRole('dialog', { name: /Fil Saati.{0,3}Toplam/ });
  await expect(total).toBeVisible({ timeout: 280_000 });
  await expect(total).toContainText(`${round.spins.length - 1} dönüş`);
  await expect(total).toContainText(`×${Math.max(...round.spins.map(s => s.hubEnd))}`);
  await expect(total.getByTestId('cezeri-feature-amount')).toHaveText(demoText(round.payoutCents));
  // the persistent hub never went down inside the feature (only free-spin readings: after the intro)
  expect(await recorded<number>(page, '__reservoir')).toBe(3);
  expect(await recorded<number>(page, '__pinned')).toBe(falconWilds);
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  await tapIfShown(total.getByRole('button', { name: 'Kutlamaya geç' }), 3000);
  await expect(celebration(page)).toBeVisible({ timeout: 10_000 });
  await celebration(page).click({ position: { x: 12, y: 12 } });
  await expect(celebration(page).getByTestId('cezeri-celebration-amount')).toHaveText(demoText(round.payoutCents));
  await expect(celebration(page)).toHaveAccessibleName(/^Mega Kazanç/);
  await celebration(page).click({ position: { x: 12, y: 12 } }).catch(() => {});
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 10_000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Bonus satın alma');
  await expect(rows(page).first()).toContainText(`Fil Saati ×${round.spins.length - 1}`);
  expect(await recorded<string[]>(page, '__levels')).toEqual(['1', '2']);
  await expect(page.locator('[data-kind="pinned"]')).toHaveCount(0); // falcon wilds leave with the feature
});

test('free-spin round below 10x still ends on "Fil Saati — Toplam" with no celebration', async ({ page }) => {
  test.setTimeout(240_000);
  const round = engine(FREE_LOW);
  expect(round.freeSpinsTriggered && round.totalHundredths < 1000).toBe(true);
  await recordPresentation(page);
  await stub(page, FREE_LOW);
  await openCezeri(page);
  await setTurbo(page);
  await spin(page).click();
  await tapIfShown(page.getByRole('dialog', { name: 'Fil Saati Başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  const total = page.getByRole('dialog', { name: /Fil Saati.{0,3}Toplam/ });
  await expect(total).toBeVisible({ timeout: 200_000 });
  await expect(total.getByTestId('cezeri-feature-amount')).toHaveText(demoText(round.payoutCents));
  await tapIfShown(total.getByRole('button', { name: 'Devam' }), 3000);
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  expect(await recorded<string[]>(page, '__levels')).toEqual([]);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('Şans ×2 debits bet × 1,25, blocks the buy and settles the ante engine round', async ({ page }) => {
  const round = engine(ANTE_LOSS, 1000, 'ante');
  expect(round.costCents).toBe(1250);
  await stub(page, ANTE_LOSS);
  await openCezeri(page);
  const ante = page.getByRole('switch', { name: 'Şans ×2' });
  await ante.click();
  await expect(ante).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('cezeri-cost')).toContainText('12,50 DEMO');
  const buy = page.getByRole('button', { name: /Bonus satın al/ });
  await expect(buy).toHaveAttribute('aria-disabled', 'true');
  await expect(buy).toContainText('Şans ×2 açıkken satın alınamaz');
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1250));
  await expect(rows(page)).toHaveCount(1, { timeout: 25_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1250 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Şans ×2');
  await expect(rows(page).first()).toContainText('12,50');
});

test('autoplay: simple panel (Gelişmiş closed), required loss limit, stops before exceeding it', async ({ page }) => {
  test.setTimeout(90_000);
  expect(engine(LOSS).payoutCents).toBe(0);
  await stub(page, LOSS);
  await openCezeri(page);
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
  await expect(page.getByTestId('cezeri-toast')).toContainText('Sonraki dönüş kayıp limitini aşardı', { timeout: 50_000 });
  await expect(rows(page)).toHaveCount(2);
  await expect(balance(page)).toContainText(formatAmount(START - 2000));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(2);
});

test('autoplay stop button ends autoplay after the running round (no extra debit)', async ({ page }) => {
  test.setTimeout(90_000);
  await stub(page, LOSS);
  await openCezeri(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('500');
  await panel.getByRole('button', { name: /Başlat · 10 tur/ }).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await page.getByRole('button', { name: /Otomatik oyunu durdur/ }).click();
  await expect(page.getByTestId('cezeri-toast')).toContainText('Otomatik oyun durdu');
  const settled = await rows(page).count();
  await expect(spin(page)).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const after = await rows(page).count();
  expect(after).toBeLessThanOrEqual(settled + 1);
  await expect(balance(page)).toContainText(formatAmount(START - after * 1000));
});

test('navigating away mid-round settles once with the full engine payout (no refund)', async ({ page }) => {
  const round = engine(MEGA);
  await stub(page, MEGA);
  await page.goto('/game/crash');
  await page.getByRole('link', { name: 'Cezeri', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Cezeri: Zamanın Çarkları', exact: true, level: 1 })).toBeVisible();
  await enter(page);
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await page.waitForTimeout(900);
  await page.goBack();
  await expect(page).toHaveURL(/\/game\/crash$/);
  await page.getByRole('link', { name: 'Cezeri', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Cezeri: Zamanın Çarkları', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId('cezeri-splash')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(`${demoText(round.totalHundredths)}×`);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(1);
});

test('reduced motion plays every step (clamps included) and settles with the engine payout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const round = engine(CHAIN2);
  await stub(page, CHAIN2);
  await openCezeri(page);
  await spin(page).click();
  await expect(page.locator('[data-kind="held"]').first()).toBeAttached({ timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('entropy failure never reserves credits; history replay never touches the balance; refill logs a line', async ({ page }) => {
  const round = engine(CHAIN2);
  await stub(page, CHAIN2);
  await openCezeri(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  const after = formatAmount(START - 1000 + round.payoutCents);
  await expect(balance(page)).toContainText(after);
  await page.getByRole('button', { name: /Tekrar oynat: tur/ }).click();
  await expect(page.getByTestId('cezeri-replay')).toContainText('Tekrar — bakiye değişmez');
  await expect(spin(page)).toBeDisabled();
  await expect(page.getByTestId('cezeri-replay')).toHaveCount(0, { timeout: 30_000 });
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
  await page.goto('/game/cezeri');
  await expect(page.getByRole('heading', { name: 'Cezeri: Zamanın Çarkları', exact: true, level: 1 })).toBeVisible();
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

test('settings persist across reload; separate music, effects and ambience; sound toggle runs without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await openCezeri(page);
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

test('phone 390x844: no horizontal overflow, fitted board, 44px deck targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, CHAIN2);
  await openCezeri(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const box = await page.getByRole('grid', { name: /Cezeri çarkları/ }).boundingBox();
  // phone fit (22 Oct 2026): the board scales to the height the deck leaves, so it is no longer full width; it must
  // stay inside the first screen
  expect(box!.width).toBeGreaterThan(235);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
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
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  const result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
});

/* Phone fit (22 Oct 2026): the first screen holds the whole table (board, win bar, deck, spin button) with no page
   scroll; phone CSS sizes the table to 100svh below its own top (slot-kit/use-viewport-top). */
test('phone 390x844 first screen: the whole table and the spin button fit without scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCezeri(page);
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

test('round breakdown ("Tur ayrıntısı"): lists the wins and its total equals the shown win and the engine payout; also from history', async ({ page }) => {
  test.setTimeout(120_000); // a dev-server round can be slow on a busy machine
  const round = engine(CHAIN2);
  expect(round.payoutCents).toBeGreaterThan(0);
  await stub(page, CHAIN2);
  await openCezeri(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId('cezeri-meter-total')).toContainText(demoText(round.payoutCents));
  const shown = (await page.getByTestId('cezeri-meter-total').textContent())!.replace(/\s*DEMO\s*$/, '').trim();
  await page.getByTestId('round-breakdown-open').click();
  const dialog = page.getByRole('dialog', { name: 'Tur ayrıntısı' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('round-breakdown-line')).toHaveCount(allLines(cezeriBreakdown(round)).length);
  await expect(dialog.getByTestId('round-breakdown-total')).toHaveText(shown);
  await expect(dialog.getByTestId('round-breakdown-total')).toHaveText(demoText(round.payoutCents));
  await expect(dialog.getByTestId('round-breakdown-check')).toContainText('✓');
  if (process.env.BREAKDOWN_SHOTS) await page.screenshot({ path: `${process.env.BREAKDOWN_SHOTS}/cezeri.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await rows(page).first().getByTestId('history-breakdown').click();
  await expect(dialog.getByTestId('round-breakdown-total')).toHaveText(demoText(round.payoutCents));
});
