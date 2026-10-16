import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ASENA_RTP, asenaSeedFromEntropy, playAsenaRound, type AsenaMode } from '@sollish/protocol';
import { ASENA_SYMBOL_LABELS } from '../../components/asena/symbols';
import { asenaFinalBoard, asenaHistoryDetail, buildAsenaTimeline } from '../../lib/asena-timeline';
import { formatAmount } from '../../lib/slot-kit/bet';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times (engine asena-stars-1). */
const engine = (fill: number, betCents = 1000, mode: AsenaMode = 'standard') => playAsenaRound(asenaSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), betCents, mode);
/* Seeds found with the engine (tests/asena-timeline.test.ts checks the same facts). */
const LOSS = 3_310_400_750;        // standard and ante at 10 DEMO: no win
const CONST_WALK = 3_884_005_518;  // base: a constellation, a wolf walk, below 1x
const KURT = 734_929_546;          // base: Kurt Başı x10 ignites (multiplier callout), below 10x
const BUYUK = 3_279_853_108;       // base 10,14x -> Büyük
const MEGA = 3_843_476_550;        // base 32,00x -> Büyük, Mega
const FREE_LOW = 2_145_424_075;   // standard: Ergenekon, 8,56x: total screen only
const BUY_X3 = 2_058_875_646;      // buy at 10 DEMO: the map reaches x2 and x3, 89,56x -> Süper
const BUY_CAP = 4_054_600_391;     // buy at 1 DEMO, capped at 5000x -> Azami
const START = 100_000;
const CALLOUT_TAGS = ['Takımyıldız', 'Parlak takımyıldız', 'Gök çarpanı', 'Tengri çarpanı', 'Efsane gök', 'Kün Ana'];

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
async function enter(page: Page) {
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(page.getByRole('button', { name: 'Çevir', exact: true })).first()).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('asena-splash').count()) {
    await play.click();
    await expect(page.getByTestId('asena-splash')).toHaveCount(0);
  }
}
async function openAsena(page: Page) {
  await page.goto('/game/asena');
  await expect(page.getByRole('heading', { name: 'Asena: Yıldız Kurdu', exact: true, level: 1 })).toBeVisible();
  await enter(page);
}
const spin = (page: Page) => page.getByRole('button', { name: 'Çevir', exact: true });
const tapIfShown = (locator: Locator, timeout = 15_000) => locator.click({ force: true, timeout }).catch(() => {});
const demoText = (cents: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const celebration = (page: Page) => page.getByTestId('asena-celebration');
const balance = (page: Page) => page.getByTestId('asena-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');
const speedButton = (page: Page) => page.getByRole('button', { name: /^Dönüş hızı:/ });
const board = (page: Page) => page.getByRole('group', { name: /yıldız alanı, 6 sütun, 6 satır/ });
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
/** Records celebration levels, meter readings, callouts, banners, Ergenekon bursts, beats and the screens' text. */
async function recordPresentation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __levels: string[]; __meter: number[]; __callouts: string[]; __banners: string[]; __bursts: string[]; __beats: Record<string, number>; __toasts: string[]; __celebration: { amount: string; label: string } | null; __intro: string; __total: { text: string; amount: string } | null; __maxMap: number };
    w.__levels = []; w.__meter = []; w.__callouts = []; w.__banners = []; w.__bursts = []; w.__beats = {}; w.__toasts = []; w.__celebration = null; w.__intro = ''; w.__total = null; w.__maxMap = 0;
    let calloutKey = '', bannerKey = '', burstSeen: Element | null = null, beat = '';
    const read = () => {
      const level = document.querySelector('[data-testid="asena-celebration"]')?.getAttribute('data-level');
      if (level && w.__levels.at(-1) !== level) w.__levels.push(level);
      const meter = document.querySelector('[data-testid="asena-meter-total"]');
      if (meter?.textContent) w.__meter.push(Number(meter.textContent.replace(/[^0-9,]/g, '').replace(',', '.')));
      const callout = document.querySelector('[data-testid="asena-callout"]');
      const key = callout?.getAttribute('data-key');
      if (callout && key && key !== calloutKey) { calloutKey = key; w.__callouts.push(`${callout.getAttribute('data-tier')}:${callout.textContent}`); }
      const banner = document.querySelector('[data-testid="asena-banner"]');
      const bk = banner?.getAttribute('data-key');
      if (banner && bk && bk !== bannerKey) { bannerKey = bk; w.__banners.push(banner.textContent ?? ''); }
      const burst = document.querySelector('[data-testid="asena-ergenekon"]');
      if (burst && burst !== burstSeen) { burstSeen = burst; w.__bursts.push(burst.getAttribute('data-multiplier') ?? ''); }
      const b = document.querySelector('[data-beat]')?.getAttribute('data-beat') ?? '';
      if (b && b !== beat) { beat = b; w.__beats[b] = (w.__beats[b] ?? 0) + 1; }
      const toast = document.querySelector('[data-testid="asena-toast"]')?.textContent ?? '';
      if (toast && w.__toasts.at(-1) !== toast) w.__toasts.push(toast);
      const celebrationEl = document.querySelector('[data-testid="asena-celebration"]');
      if (celebrationEl) w.__celebration = { amount: celebrationEl.querySelector('[data-testid="asena-celebration-amount"]')?.textContent ?? '', label: celebrationEl.getAttribute('aria-label') ?? '' };
      const intro = document.querySelector('[data-testid="asena-intro"]')?.textContent;
      if (intro) w.__intro = intro;
      const totalEl = document.querySelector('[data-testid="asena-feature-total"]');
      if (totalEl) w.__total = { text: totalEl.textContent ?? '', amount: totalEl.querySelector('[data-testid="asena-feature-amount"]')?.textContent ?? '' };
      const global = document.querySelector('[data-testid="asena-global"] strong')?.textContent;
      if (global) w.__maxMap = Math.max(w.__maxMap, Number(global.replace('×', '')));
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['data-level', 'data-key', 'data-beat', 'aria-label', 'data-text', 'data-multiplier'] });
  });
}
const recorded = <T,>(page: Page, key: string) => page.evaluate(k => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;
const axe = (page: Page) => new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = (result: Awaited<ReturnType<typeof axe>>) => JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
/** Engine final board as the accessible cells read it ("Asena, sütun 1, satır 1"), sorted. */
const boardLabels = (fill: number, bet = 1000, mode: AsenaMode = 'standard') => asenaFinalBoard(engine(fill, bet, mode))
  .flatMap((column, col) => column.map((cell, row) => `${ASENA_SYMBOL_LABELS[cell.symbol]}, sütun ${col + 1}, satır ${row + 1}`)).sort();
const shownLabels = async (page: Page) => (await board(page).locator('[data-sym]:not([data-leaving])').evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? ''))).sort();
/** Callouts the timeline must show: one per constellation whose template × global multiplier is ≥ 10. */
const expectedCallouts = (fill: number, bet = 1000, mode: AsenaMode = 'standard') => buildAsenaTimeline(engine(fill, bet, mode)).events
  .flatMap(e => (e.type === 'howl' && e.callout ? [`${e.callout.tier}:${CALLOUT_TAGS[e.callout.tier]}×${e.callout.value}`] : []));
const constellationCount = (fill: number, bet = 1000, mode: AsenaMode = 'standard') => engine(fill, bet, mode).spins.reduce((n, s) => n + s.steps.reduce((m, st) => m + st.clusters.filter(c => c.constellation).length, 0), 0);

async function expectCelebration(page: Page, fill: number, expected: { levels: string[]; title: RegExp }, opts: { bet?: number; mode?: AsenaMode; tapWithSpace?: boolean } = {}) {
  const bet = opts.bet ?? 1000, mode = opts.mode ?? 'standard';
  const round = engine(fill, bet, mode);
  await recordPresentation(page);
  await stub(page, fill);
  await openAsena(page);
  await setTurbo(page);
  if (bet !== 1000) await chooseBet(page, bet / 100);
  if (mode === 'buy') await buy(page); else await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents));
  if (round.freeSpinsTriggered) await tapIfShown(page.getByRole('dialog', { name: 'Ergenekon Başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(celebration(page)).toBeVisible({ timeout: 420_000 });
  await expect(spin(page)).toBeDisabled();
  if (opts.tapWithSpace) { await page.locator('h1').click(); await page.keyboard.press('Space'); }
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(celebration(page)).toHaveCount(0);
  await expect(balance(page)).toContainText(formatAmount(START - round.costCents + round.payoutCents));
  const shown = await recorded<{ amount: string; label: string } | null>(page, '__celebration');
  expect(shown?.amount).toBe(demoText(round.payoutCents));
  expect(shown?.label).toMatch(expected.title);
  if (round.freeSpinsTriggered) expect((await recorded<{ amount: string } | null>(page, '__total'))?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<string[]>(page, '__levels')).toEqual(expected.levels);
  return round;
}

test('labelled 6x6 star field and deck; info pages navigable, bet-scaled and axe-clean', async ({ page }) => {
  test.setTimeout(90_000);
  await openAsena(page);
  await expect(board(page).locator('[data-sym]:not([data-leaving])')).toHaveCount(36);
  await expect(board(page).locator('[data-sym] use')).toHaveCount(36); // cheap <use> cells
  await expect(board(page).getByRole('img', { name: /^Gök Kurt \(yürüyen joker\), sütun \d, satır \d$/ }).first()).toBeAttached();
  await expect(balance(page)).toContainText('1.000,00');
  await expect(page.getByTestId('asena-cost')).toContainText('10,00 DEMO');
  await expect(page.getByRole('region', { name: /Ergenekon haritası/ }).or(page.getByLabel(/Ergenekon haritası/)).first()).toBeVisible();
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);

  await page.getByRole('button', { name: 'Oyun bilgisi' }).click();
  const info = page.getByRole('dialog', { name: /Oyun bilgisi/ });
  await expect(info.getByRole('tab')).toHaveText(['Nasıl oynanır', 'Ödeme tablosu', 'Özellikler', 'RTP', 'Bahis ve kazanç sınırları', 'Tuşlar', 'Arıza hükmü']);
  await info.getByRole('button', { name: 'Sonraki sayfa' }).click();
  await expect(info.getByRole('tabpanel')).toContainText(ASENA_SYMBOL_LABELS.h1);
  await expect(info.getByRole('tabpanel')).toContainText('288,00'); // 18+ Asena at 10 DEMO = 28,80x
  await expect(info.getByRole('tabpanel')).toContainText('600,00'); // 5+ moons 60x
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await info.getByRole('tab', { name: 'Özellikler' }).click();
  for (const name of ['Kurt Başı', 'Hayat Ağacı', 'Kartal', 'At', 'Yay', 'Hilal']) await expect(info.getByRole('tabpanel')).toContainText(name);
  await expect(info.getByRole('tabpanel')).toContainText('Ergenekon haritasında');
  await expect(info.getByRole('tabpanel')).toContainText('×5');
  await info.getByRole('tab', { name: 'RTP' }).click();
  for (const mode of ['standard', 'ante', 'buy'] as const) await expect(info.getByRole('tabpanel')).toContainText(`%${(ASENA_RTP[mode].rtp * 100).toFixed(1).replace('.', ',')}`);
  await expect(info.getByRole('tabpanel')).toContainText('20 milyon tur simülasyonu');
  await expect(info.getByRole('tabpanel')).toContainText('sertifikasızdır');
  await info.getByRole('tab', { name: 'Bahis ve kazanç sınırları' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('50.000,00 DEMO'); // 5000x at 10 DEMO
  await info.getByRole('tab', { name: 'Tuşlar' }).focus();
  await page.keyboard.press('End');
  await expect(info.getByRole('tab', { name: 'Arıza hükmü' })).toHaveAttribute('aria-selected', 'true');
  await expect(info.getByRole('tabpanel')).toContainText('Arıza, etkilenen bütün oyunları ve ödemeleri geçersiz kılar');
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
});

test('spin lock: one debit, button and Space locked through the constellation and the wolf walk, payout and final board = engine', async ({ page }) => {
  test.setTimeout(60_000);
  const round = engine(CONST_WALK);
  await recordPresentation(page);
  await stub(page, CONST_WALK);
  await openAsena(page);
  await page.locator('h1').click();
  await page.keyboard.press('Space'); // Space starts the round
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  const button = page.getByTestId('asena-spin');
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
  await expect(rows(page).first()).toContainText(asenaHistoryDetail(round));
  await expect(rows(page).first()).toContainText(`${round.seedHex.slice(0, 4)}…${round.seedHex.slice(-4)}`);
  await expect(page.getByTestId('asena-meter')).toContainText('Toplam kazanç');
  await expect(page.getByTestId('asena-meter-total')).toContainText(demoText(round.payoutCents));
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  const beats = await recorded<Record<string, number>>(page, '__beats');
  expect(beats.constellation ?? 0).toBeGreaterThanOrEqual(1);
  expect(beats['wolf-walk'] ?? 0).toBeGreaterThanOrEqual(1);
  expect((await recorded<string[]>(page, '__banners')).filter(b => /×\d+$/.test(b)).length).toBe(constellationCount(CONST_WALK));
  expect(await recorded<string[]>(page, '__levels')).toEqual([]); // below 10x: no takeover
  await page.waitForTimeout(600);
  expect(await shownLabels(page)).toEqual(boardLabels(CONST_WALK));
  await page.waitForTimeout(600);
  await expect(rows(page)).toHaveCount(1);
});

test('Kurt Başı ×10 is called out with its own big text; the howl follows the trace', async ({ page }) => {
  test.setTimeout(60_000);
  const round = engine(KURT);
  const callouts = expectedCallouts(KURT);
  expect(callouts).toContain('1:Parlak takımyıldız×10');
  await recordPresentation(page);
  await stub(page, KURT);
  await openAsena(page);
  await setQuick(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 40_000 });
  expect(await recorded<string[]>(page, '__callouts')).toEqual(callouts);
  expect(await recorded<string[]>(page, '__banners')).toContain('Kurt Başı ×10');
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('celebration Büyük (10x) via Space: tap finishes the count-up on the engine payout', async ({ page }) => {
  const round = await expectCelebration(page, BUYUK, { levels: ['1'], title: /^Büyük Kazanç/ }, { tapWithSpace: true });
  expect(round.totalHundredths).toBeGreaterThanOrEqual(1000);
});
test('celebration escalates Büyük → Mega (25x)', async ({ page }) => {
  test.setTimeout(120_000);
  await expectCelebration(page, MEGA, { levels: ['1', '2'], title: /^Mega Kazanç/ });
});

test('bonus buy: dialog, cost bet × 80, Ergenekon intro, map ×2 → ×3 with the mountain bursts, total screen, Süper, balance', async ({ page }) => {
  test.setTimeout(300_000);
  const round = engine(BUY_X3, 1000, 'buy');
  expect(round.costCents).toBe(80_000);
  const callouts = expectedCallouts(BUY_X3, 1000, 'buy');
  await recordPresentation(page);
  await stub(page, BUY_X3);
  await openAsena(page);
  await setTurbo(page);
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bonus satın al' });
  await expect(dialog).toContainText('800,00 DEMO');
  await expect(dialog).toContainText(`Satın alma RTP %${(ASENA_RTP.buy.rtp * 100).toFixed(1).replace('.', ',')}`);
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await dialog.getByRole('button', { name: 'Satın al', exact: true }).click();
  await expect(balance(page)).toContainText(formatAmount(START - 80_000));
  const intro = page.getByRole('dialog', { name: 'Ergenekon Başlıyor' });
  await tapIfShown(intro.getByRole('button', { name: 'Başla' }), 30_000);
  await expect(page.getByLabel(/Bedava dönüş \d+, kalan dönüş \d+/)).toBeVisible();
  await expect(page.getByTestId('asena-global')).toBeVisible();
  await expect(spin(page)).toBeDisabled();
  expect(await recorded<string>(page, '__intro')).toMatch(/ERGENEKON.*10\s*bedava/i);
  await expect(celebration(page)).toBeVisible({ timeout: 280_000 });
  const total = await recorded<{ text: string; amount: string } | null>(page, '__total');
  expect(total?.text).toContain(`${round.spins.length - 1} dönüş`);
  expect(total?.text).toContain('×3');
  expect(total?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<string[]>(page, '__bursts')).toEqual(['2', '3']);
  expect(await recorded<number>(page, '__maxMap')).toBe(3);
  expect(await recorded<string[]>(page, '__callouts')).toEqual(callouts);
  expect((await recorded<string[]>(page, '__banners')).filter(b => b === 'Harita · +5 bedava dönüş').length).toBe(2);
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  expect(await shownLabels(page)).toEqual(boardLabels(BUY_X3, 1000, 'buy'));
  // No tap: the counter climbs through every tier on its own.
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  const shown = await recorded<{ amount: string; label: string } | null>(page, '__celebration');
  expect(shown?.amount).toBe(demoText(round.payoutCents));
  expect(shown?.label).toMatch(/^Süper Kazanç/);
  await expect(balance(page)).toContainText(formatAmount(START - 80_000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Bonus satın alma');
  await expect(rows(page).first()).toContainText(asenaHistoryDetail(round));
  expect(await recorded<string[]>(page, '__levels')).toEqual(['1', '2', '3']);
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
});

test('free-spin round below 10x still ends on "Ergenekon — Toplam" with no celebration', async ({ page }) => {
  test.setTimeout(180_000);
  const round = engine(FREE_LOW);
  expect(round.freeSpinsTriggered && round.totalHundredths < 1000).toBe(true);
  await recordPresentation(page);
  await stub(page, FREE_LOW);
  await openAsena(page);
  await setTurbo(page);
  await spin(page).click();
  await tapIfShown(page.getByRole('dialog', { name: 'Ergenekon Başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(rows(page)).toHaveCount(1, { timeout: 150_000 });
  expect((await recorded<{ amount: string } | null>(page, '__total'))?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<string[]>(page, '__levels')).toEqual([]);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('capped buy at 1 DEMO climbs every tier and ends on Azami Kazanç = 5000x bet', async ({ page }) => {
  // The 5000x round is a 105-step chain (two free spins under the x5 map): about 5.5 minutes even in turbo.
  test.setTimeout(540_000);
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
  await openAsena(page);
  const ante = page.getByRole('switch', { name: 'Şans ×2' });
  await ante.click();
  await expect(ante).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('asena-cost')).toContainText('12,50 DEMO');
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
  await openAsena(page);
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
  await openAsena(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await panel.getByRole('textbox', { name: /Kayıp limiti/ }).fill('500');
  await panel.getByRole('button', { name: /Başlat · 10 tur/ }).click();
  const stopButton = page.getByRole('button', { name: /Otomatik oyunu durdur/ });
  await stopButton.waitFor();
  const before = await rows(page).count();
  await stopButton.click();
  await expect(page.getByTestId('asena-toast')).toContainText('Otomatik oyun durdu', { timeout: 20_000 });
  await expect(spin(page)).toBeEnabled({ timeout: 20_000 });
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
  await page.getByRole('link', { name: 'Asena', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Asena: Yıldız Kurdu', exact: true, level: 1 })).toBeVisible();
  await enter(page);
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  await page.waitForTimeout(700);
  await page.goBack();
  await expect(page).toHaveURL(/\/game\/crash$/);
  await page.getByRole('link', { name: 'Asena', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Asena: Yıldız Kurdu', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId('asena-splash')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('32,00×');
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await page.waitForTimeout(1200);
  await expect(rows(page)).toHaveCount(1);
});

test('reduced motion plays every step (constellation and wolf walk included) and settles with the engine payout', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const round = engine(CONST_WALK);
  await recordPresentation(page);
  await stub(page, CONST_WALK);
  await openAsena(page);
  await spin(page).click();
  await expect(board(page)).toHaveAttribute('data-focus', '', { timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  const beats = await recorded<Record<string, number>>(page, '__beats');
  expect(beats.constellation ?? 0).toBeGreaterThanOrEqual(1);
  expect(beats['wolf-walk'] ?? 0).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(400);
  expect(await shownLabels(page)).toEqual(boardLabels(CONST_WALK));
});

test('entropy failure never reserves credits; history replay never touches the balance; refill logs a line', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(CONST_WALK);
  await stub(page, CONST_WALK);
  await openAsena(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  const after = formatAmount(START - 1000 + round.payoutCents);
  await expect(balance(page)).toContainText(after);
  await page.getByRole('button', { name: /Tekrar oynat: tur/ }).click();
  await expect(page.getByTestId('asena-replay')).toContainText('Tekrar — bakiye değişmez');
  await expect(spin(page)).toBeDisabled();
  await expect(page.getByTestId('asena-replay')).toHaveCount(0, { timeout: 30_000 });
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
  await page.goto('/game/asena');
  await expect(page.getByRole('heading', { name: 'Asena: Yıldız Kurdu', exact: true, level: 1 })).toBeVisible();
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
  await openAsena(page);
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

test('phone 390x844: no horizontal overflow, full-width board, 44px deck targets, sky map row in Ergenekon', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, FREE_LOW);
  await openAsena(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const box = await board(page).boundingBox();
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
  await tapIfShown(page.getByRole('dialog', { name: 'Ergenekon Başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(page.getByTestId('asena-free-counter')).toBeVisible({ timeout: 30_000 });
  const map = page.getByLabel(/^Ergenekon haritası:/);
  await expect(map).toBeVisible();
  const mapBox = (await map.boundingBox())!, boardBox = (await board(page).boundingBox())!;
  expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(boardBox.y);
  expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(390);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(spin(page)).toBeDisabled();
  await expect(rows(page)).toHaveCount(1, { timeout: 100_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  const result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
});
