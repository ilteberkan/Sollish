import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash, createHmac } from 'node:crypto';
import { GOREME_RTP, goremeSeedFromEntropy, playGoremeRound, type GoremeMode } from '@sollish/protocol';
import { goremeFinalBoard, goremeHistoryDetail } from '../../lib/goreme-timeline';
import { formatAmount } from '../../lib/slot-kit/bet';
import tr from '../../messages/tr/goreme.json';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/** The stub fills every entropy word with one value, so the seed is that word four times (engine goreme-balloons-1). */
const engine = (fill: number, mode: GoremeMode = 'standard', betCents = 1000) => playGoremeRound(goremeSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), betCents, mode);
/* Fills found with the engine (tests/goreme-timeline.test.ts checks the same facts). */
const LOSS = 2_364_027_904;     // standard and ante: no win
const LIFT = 1_824_259_072;     // base: two or more lifts, 1,60x
const BUYUK = 3_727_255_296;    // base 11,28x -> Büyük
const FREE_LOW = 245_234_176;   // standard: Dawn Festival, 2,28x: total screen only
const BUY_SKY = 4_139_144_192;  // buy: sky x15, 90,16x -> Süper
const START = 100_000;

async function stub(page: Page, fill: number) {
  await page.addInitScript(value => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => { array.fill(value); return array; } });
  }, fill);
}
async function enter(page: Page, play = 'Oyna') {
  const button = page.getByRole('button', { name: play, exact: true });
  await expect(button.or(page.getByTestId('goreme-spin')).first()).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('goreme-splash').count()) {
    await button.click();
    await expect(page.getByTestId('goreme-splash')).toHaveCount(0);
  }
}
async function openGoreme(page: Page) {
  await page.goto('/game/goreme');
  await expect(page.getByRole('heading', { name: 'Göreme: Şafak Balonları', exact: true, level: 1 })).toBeVisible();
  await enter(page);
}
const spin = (page: Page) => page.getByRole('button', { name: 'Çevir', exact: true });
const tapIfShown = (locator: Locator, timeout = 15_000) => locator.click({ force: true, timeout }).catch(() => {});
const demoText = (cents: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const balance = (page: Page) => page.getByTestId('goreme-balance');
const rows = (page: Page) => page.locator('.history-table tbody tr');
const speedButton = (page: Page) => page.getByRole('button', { name: /^Dönüş hızı:/ });
const board = (page: Page) => page.getByRole('group', { name: /^Göreme makara penceresi/ });
async function setTurbo(page: Page) { await speedButton(page).click(); await speedButton(page).click(); await expect(speedButton(page)).toHaveAccessibleName('Dönüş hızı: Turbo'); }
const axe = (page: Page) => new AxeBuilder({ page }).exclude('.desktop-chat').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = (result: Awaited<ReturnType<typeof axe>>) => JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
const symbolName = (symbol: string) => (tr.symbols as Record<string, string>)[symbol]!;
/** Engine final board as the accessible cells read it, sorted. */
const boardLabels = (fill: number, mode: GoremeMode = 'standard') => goremeFinalBoard(engine(fill, mode))
  .flatMap((column, col) => column.map((cell, row) => (cell.symbol === 'balloon' ? `Balon ×${cell.multiplier}, makara ${col + 1}, sıra ${row + 1}` : `${symbolName(cell.symbol)}, makara ${col + 1}, sıra ${row + 1}`))).sort();
const shownLabels = async (page: Page) => (await board(page).locator('[data-sym] [role="img"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? ''))).sort();

/** Records celebration levels, meter readings, beats, callouts, the total screen and the sky band. */
async function recordPresentation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __levels: string[]; __meter: number[]; __beats: Record<string, number>; __callouts: string[]; __toasts: string[]; __total: { text: string; amount: string } | null; __celebration: { amount: string; label: string } | null; __maxSky: number; __intro: string };
    w.__levels = []; w.__meter = []; w.__beats = {}; w.__callouts = []; w.__toasts = []; w.__total = null; w.__celebration = null; w.__maxSky = 1; w.__intro = '';
    let beat = '', calloutKey = '';
    const read = () => {
      const level = document.querySelector('[data-testid="goreme-celebration"]')?.getAttribute('data-level');
      if (level && w.__levels.at(-1) !== level) w.__levels.push(level);
      const celebration = document.querySelector('[data-testid="goreme-celebration"]');
      if (celebration) w.__celebration = { amount: celebration.querySelector('[data-testid="goreme-celebration-amount"]')?.textContent ?? '', label: celebration.getAttribute('aria-label') ?? '' };
      const meter = document.querySelector('[data-testid="goreme-meter-total"]');
      if (meter?.textContent) w.__meter.push(Number(meter.textContent.replace(/[^0-9,]/g, '').replace(',', '.')));
      const b = document.querySelector('[data-beat]')?.getAttribute('data-beat') ?? '';
      if (b && b !== beat) { beat = b; w.__beats[b] = (w.__beats[b] ?? 0) + 1; }
      const callout = document.querySelector('[data-testid="goreme-callout"]');
      const key = callout?.getAttribute('data-key');
      if (callout && key && key !== calloutKey) { calloutKey = key; w.__callouts.push(callout.textContent ?? ''); }
      const toast = document.querySelector('[data-testid="goreme-toast"]')?.textContent ?? '';
      if (toast && w.__toasts.at(-1) !== toast) w.__toasts.push(toast);
      const total = document.querySelector('[data-testid="goreme-feature-total"]');
      if (total) w.__total = { text: total.textContent ?? '', amount: total.querySelector('[data-testid="goreme-feature-amount"]')?.textContent ?? '' };
      const sky = document.querySelector('[data-testid="goreme-sky"] [aria-live]')?.textContent;
      if (sky) w.__maxSky = Math.max(w.__maxSky, Number(sky.replace(/[^0-9]/g, '')) || 1);
      const intro = document.querySelector('[data-testid="goreme-intro"]')?.textContent;
      if (intro) w.__intro = intro;
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['data-level', 'data-key', 'data-beat', 'aria-label', 'data-text'] });
  });
}
const recorded = <T,>(page: Page, key: string) => page.evaluate(k => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;

test('labelled 6x5 reel window, sky band and deck; info pages bet-scaled, RTP per mode and axe-clean', async ({ page }) => {
  test.setTimeout(90_000);
  await openGoreme(page);
  await expect(board(page).locator('[data-sym]')).toHaveCount(30);
  await expect(board(page).getByRole('img', { name: /^Peri Bacası, makara \d, sıra \d$/ }).first()).toBeAttached();
  await expect(page.getByTestId('goreme-sky')).toContainText('GÖK');
  await expect(balance(page)).toContainText('1.000,00');
  await expect(page.getByTestId('goreme-cost')).toContainText('10,00 DEMO');
  let result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await page.getByRole('button', { name: 'Oyun bilgisi' }).click();
  const info = page.getByRole('dialog', { name: /Oyun bilgisi/ });
  await expect(info.getByRole('tab')).toHaveText(['Nasıl oynanır', 'Ödeme tablosu', 'Özellikler', 'RTP', 'Bahis ve kazanç sınırları', 'Tuşlar', 'Arıza hükmü']);
  await info.getByRole('tab', { name: 'Ödeme tablosu' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('Peri Bacası');
  await expect(info.getByRole('tabpanel')).toContainText('22,50'); // h1 on 6 reels: 2,25x per way at 10 DEMO
  await expect(info.getByTestId('goreme-sun-table')).toContainText('1.000,00'); // 6+ suns: 100x
  await info.getByRole('tab', { name: 'Özellikler' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('Yollar nasıl sayılır');
  await expect(info.getByRole('tabpanel')).toContainText('8 ağırlıklı yol');
  await expect(info.getByRole('tabpanel')).toContainText('Gök kuşağı');
  await info.getByRole('tab', { name: 'RTP' }).click();
  for (const mode of ['standard', 'ante', 'buy'] as const) await expect(info.getByTestId('goreme-rtp-table')).toContainText(`%${(GOREME_RTP[mode].rtp * 100).toFixed(1).replace('.', ',')}`);
  await info.getByRole('tab', { name: 'Bahis ve kazanç sınırları' }).click();
  await expect(info.getByRole('tabpanel')).toContainText('100.000,00 DEMO'); // 10 000x at 10 DEMO
  result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
});

test('spin lock: one debit, button and Space locked through every lift, payout and final board = engine', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(LIFT);
  await recordPresentation(page);
  await stub(page, LIFT);
  await openGoreme(page);
  await page.locator('h1').click();
  await page.keyboard.press('Space');
  await expect(balance(page)).toContainText(formatAmount(START - 1000));
  const button = page.getByTestId('goreme-spin');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('data-locked', 'true');
  for (let i = 0; i < 3 && await button.isDisabled(); i++) {
    await button.click({ force: true });
    await button.dispatchEvent('click');
    await page.locator('h1').click();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    expect([formatAmount(START - 1000), formatAmount(START - 1000 + round.payoutCents)]).toContain((await balance(page).textContent())!.replace(/\s*DEMO$/, '').trim());
  }
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(button).toBeEnabled();
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
  await expect(rows(page).first()).toContainText(goremeHistoryDetail(round));
  await expect(page.getByTestId('goreme-meter-total')).toContainText(demoText(round.payoutCents));
  const readings = await recorded<number[]>(page, '__meter');
  for (let i = 1; i < readings.length; i++) expect(readings[i]!, `meter reading ${i}`).toBeGreaterThanOrEqual(readings[i - 1]!);
  const beats = await recorded<Record<string, number>>(page, '__beats');
  expect(beats.lift ?? 0).toBeGreaterThanOrEqual(1);
  expect(beats.respin ?? 0).toBeGreaterThanOrEqual(1);
  expect(await recorded<string[]>(page, '__levels')).toEqual([]);
  await page.waitForTimeout(800);
  expect(await shownLabels(page)).toEqual(boardLabels(LIFT));
});

/** Samples the board every frame: balloon element positions by stable id, FX elements and the sky band. */
async function trackAnimation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __anim: { balloons: Record<string, Array<[number, number, string]>>; fx: Record<string, number>; band: number[]; slotDist: Record<string, number>; bandIds: string[]; dupRun: number; dupMax: number } };
    w.__anim = { balloons: {}, fx: {}, band: [], slotDist: {}, bandIds: [], dupRun: 0, dupMax: 0 };
    const loop = () => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-balloon-id]')) {
        const r = el.getBoundingClientRect(), id = el.dataset.balloonId!, list = (w.__anim.balloons[id] ??= []);
        const last = list.at(-1);
        if (!last || Math.abs(last[0] - r.top) > 0.5 || Math.abs(last[1] - r.left) > 0.5 || last[2] !== el.dataset.phase) list.push([Math.round(r.top), Math.round(r.left), el.dataset.phase ?? '']);
      }
      for (const id of ['goreme-burner', 'goreme-gust', 'goreme-puff', 'goreme-plus', 'goreme-ways-path', 'goreme-sky-plus', 'goreme-banner']) if (document.querySelector(`[data-testid="${id}"]`)) w.__anim.fx[id] = (w.__anim.fx[id] ?? 0) + 1;
      const band = document.querySelector('[data-testid="goreme-sky"] [data-count]');
      const count = Number(band?.getAttribute('data-count') ?? 0);
      if (w.__anim.band.at(-1) !== count) w.__anim.band.push(count);
      // a mooring balloon flies onto its reserved band slot (the flight ends where the band shows it): closest approach per id
      for (const el of document.querySelectorAll<HTMLElement>('[data-balloon-id]:is([data-phase="moor"], [data-phase="parked"])')) {
        const slot = document.querySelector(`[data-moor-id="${el.dataset.balloonId}"] [data-slot]`);
        if (!slot) continue;
        const a = el.querySelector('svg')!.getBoundingClientRect(), b = slot.getBoundingClientRect();
        const d = Math.hypot(a.left + a.width / 2 - (b.left + b.width / 2), a.top + a.height / 2 - (b.top + b.height / 2));
        w.__anim.slotDist[el.dataset.balloonId!] = Math.min(w.__anim.slotDist[el.dataset.balloonId!] ?? Infinity, d);
      }
      const shownIds = [...document.querySelectorAll<HTMLElement>('[data-testid="goreme-sky"] [data-moor-id]:not([data-incoming])')].map(el => el.dataset.moorId!);
      for (const id of shownIds) if (!w.__anim.bandIds.includes(id)) w.__anim.bandIds.push(id);
      // a balloon shown by the band must not also stay on the board layer (no double balloon over the band)
      const dup = shownIds.some(id => document.querySelector(`[data-balloon-id="${id}"]`));
      w.__anim.dupRun = dup ? w.__anim.dupRun + 1 : 0;
      w.__anim.dupMax = Math.max(w.__anim.dupMax, w.__anim.dupRun);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
type Anim = { balloons: Record<string, Array<[number, number, string]>>; fx: Record<string, number>; band: number[]; slotDist: Record<string, number>; bandIds: string[]; dupRun: number; dupMax: number };

test('lift animation: balloons keep their element across rows (same id), burner, wind, smoke, +1 tick and the ways path show; the meter note never covers the board', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(LIFT);
  const liftIds = new Set(round.spins[0]!.steps.flatMap(st => (st.type === 'lift' ? st.moves.map(m => String(m.id)) : [])));
  expect(liftIds.size).toBeGreaterThan(0);
  await trackAnimation(page);
  await stub(page, LIFT);
  await openGoreme(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  const anim = await recorded<Anim>(page, '__anim');
  // every lifted balloon id was one element that moved up by whole rows (a transition, sampled mid-way too)
  for (const id of liftIds) {
    const track = anim.balloons[id] ?? [];
    expect(track.length, `balloon ${id} samples`).toBeGreaterThan(3);
    const tops = track.map(t => t[0]);
    expect(Math.min(...tops), `balloon ${id} rose`).toBeLessThan(tops[0]!);
    expect(track.some(t => t[2] === 'rise'), `balloon ${id} rise phase`).toBe(true);
  }
  for (const id of ['goreme-burner', 'goreme-gust', 'goreme-puff', 'goreme-plus']) expect(anim.fx[id] ?? 0, id).toBeGreaterThan(0);
  if (round.spins[0]!.steps.some(st => st.type === 'ways' && st.wins.length)) expect(anim.fx['goreme-banner'] ?? 0).toBeGreaterThan(0);
  // the win note lives inside the meter, below the reel window
  await expect(page.locator('[data-testid="goreme-banner"]:not([data-testid="goreme-meter"] *)')).toHaveCount(0);
});

test('Şafak Şöleni moorings: a balloon flies into its own sky-band slot, the band count and Gök value step up', async ({ page }) => {
  test.setTimeout(240_000);
  const round = engine(BUY_SKY, 'buy');
  const moored = round.spins.flatMap(s => s.steps.flatMap(st => (st.type === 'sky' ? st.moored.map(m => String(m.id)) : [])));
  expect(moored.length).toBeGreaterThan(1);
  await trackAnimation(page);
  await stub(page, BUY_SKY);
  await openGoreme(page);
  await setTurbo(page);
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  await page.getByRole('dialog', { name: 'Bonus satın al' }).getByRole('button', { name: 'Satın al', exact: true }).click();
  await tapIfShown(page.getByRole('dialog', { name: 'Şafak Şöleni başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(page.getByTestId('goreme-free-counter')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await recorded<Anim>(page, '__anim')).bandIds.length, { timeout: 200_000 }).toBe(moored.length);
  const anim = await recorded<Anim>(page, '__anim');
  // the band shows exactly the moored engine balloons (by id), one count step at a time
  expect([...anim.bandIds].sort()).toEqual([...moored].sort());
  const steps = anim.band.filter(n => n > 0);
  for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
  expect(steps.at(-1)).toBe(moored.length);
  // each moored balloon's board element climbed out of the window (same id) and was parked on its slot
  for (const id of moored) expect((anim.balloons[id] ?? []).some(t => t[2] === 'moor' || t[2] === 'parked'), `balloon ${id} flight`).toBe(true);
  for (const id of moored) expect(anim.slotDist[id] ?? Infinity, `balloon ${id} reached its slot`).toBeLessThan(14);
  expect(anim.dupMax, 'frames with a band balloon still on the board layer').toBeLessThan(8);
  expect(anim.fx['goreme-sky-plus'] ?? 0).toBeGreaterThan(0);
});

test('Şans ×2 debits bet × 1,25, blocks the buy and settles the ante engine round', async ({ page }) => {
  const round = engine(LOSS, 'ante');
  expect(round.costCents).toBe(1250);
  await stub(page, LOSS);
  await openGoreme(page);
  const ante = page.getByRole('switch', { name: 'Şans ×2' });
  await ante.click();
  await expect(ante).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('goreme-cost')).toContainText('12,50 DEMO');
  const buyButton = page.getByRole('button', { name: /Bonus satın al/ });
  await expect(buyButton).toHaveAttribute('aria-disabled', 'true');
  await expect(buyButton).toContainText('Şans ×2 açıkken satın alınamaz');
  await spin(page).click();
  await expect(balance(page)).toContainText(formatAmount(START - 1250));
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(balance(page)).toContainText(formatAmount(START - 1250 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Şans ×2');
  await expect(rows(page).first()).toContainText('12,50');
});

test('bonus buy: dialog shows bet × 100 and its RTP; Dawn Festival with sky band, total screen, Süper, balance', async ({ page }) => {
  test.setTimeout(240_000);
  const round = engine(BUY_SKY, 'buy');
  expect(round.costCents).toBe(100_000);
  await recordPresentation(page);
  await stub(page, BUY_SKY);
  await openGoreme(page);
  await setTurbo(page);
  await page.getByRole('button', { name: /Bonus satın al/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bonus satın al' });
  await expect(dialog).toContainText('1.000,00 DEMO');
  await expect(dialog).toContainText(`Satın alma RTP %${(GOREME_RTP.buy.rtp * 100).toFixed(1).replace('.', ',')}`);
  const result = await axe(page);
  expect(result.violations, violations(result)).toEqual([]);
  await dialog.getByRole('button', { name: 'Satın al', exact: true }).click();
  await expect(balance(page)).toContainText(formatAmount(START - 100_000));
  await tapIfShown(page.getByRole('dialog', { name: 'Şafak Şöleni başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(page.getByTestId('goreme-free-counter')).toBeVisible({ timeout: 30_000 });
  await expect(spin(page)).toBeDisabled();
  expect(await recorded<string>(page, '__intro')).toMatch(/ŞAFAK ŞÖLENİ.*10\s*bedava/i);
  await expect(page.getByTestId('goreme-celebration')).toBeVisible({ timeout: 200_000 });
  const total = await recorded<{ text: string; amount: string } | null>(page, '__total');
  expect(total?.text).toContain(`${round.spins.length - 1} dönüş`);
  expect(total?.text).toContain('×15');
  expect(total?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<number>(page, '__maxSky')).toBe(15);
  expect((await recorded<string[]>(page, '__callouts')).some(c => c.includes('Gök çarpanı') && c.includes('×15'))).toBe(true);
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  const shown = await recorded<{ amount: string; label: string } | null>(page, '__celebration');
  expect(shown?.amount).toBe(demoText(round.payoutCents));
  expect(shown?.label).toMatch(/^Süper Kazanç/);
  expect(await recorded<string[]>(page, '__levels')).toEqual(['1', '2', '3']);
  await expect(balance(page)).toContainText(formatAmount(START - 100_000 + round.payoutCents));
  await expect(rows(page).first()).toContainText('Bonus satın alma');
  await expect(rows(page).first()).toContainText(goremeHistoryDetail(round));
});

test('free-spin round below 10x still ends on "Şafak Şöleni — Toplam" with no celebration', async ({ page }) => {
  test.setTimeout(180_000);
  const round = engine(FREE_LOW);
  expect(round.freeSpinsTriggered && round.totalHundredths < 1000).toBe(true);
  await recordPresentation(page);
  await stub(page, FREE_LOW);
  await openGoreme(page);
  await setTurbo(page);
  await spin(page).click();
  await tapIfShown(page.getByRole('dialog', { name: 'Şafak Şöleni başlıyor' }).getByRole('button', { name: 'Başla' }), 30_000);
  await expect(rows(page)).toHaveCount(1, { timeout: 150_000 });
  expect((await recorded<{ amount: string } | null>(page, '__total'))?.amount).toBe(demoText(round.payoutCents));
  expect(await recorded<string[]>(page, '__levels')).toEqual([]);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('Büyük (10x) celebration: Space finishes the count-up on the engine payout', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(BUYUK);
  await recordPresentation(page);
  await stub(page, BUYUK);
  await openGoreme(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(page.getByTestId('goreme-celebration')).toBeVisible({ timeout: 60_000 });
  await page.locator('h1').click();
  await page.keyboard.press('Space');
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  const shown = await recorded<{ amount: string; label: string } | null>(page, '__celebration');
  expect(shown?.amount).toBe(demoText(round.payoutCents));
  expect(shown?.label).toMatch(/^Büyük Kazanç/);
  await expect(balance(page)).toContainText(formatAmount(START - 1000 + round.payoutCents));
});

test('autoplay: simple panel (Gelişmiş closed), required loss limit, stops before exceeding it', async ({ page }) => {
  test.setTimeout(90_000);
  await recordPresentation(page);
  await stub(page, LOSS);
  await openGoreme(page);
  await setTurbo(page);
  await page.getByRole('button', { name: 'Otomatik', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Otomatik oyun' });
  await expect(panel.getByRole('button', { name: /Başlat · 10 tur/ })).toBeDisabled();
  const advanced = panel.locator('details');
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect(advanced.locator('summary')).toContainText('Gelişmiş');
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

test('history replay plays the same round again and never touches the balance', async ({ page }) => {
  test.setTimeout(90_000);
  const round = engine(LIFT);
  await stub(page, LIFT);
  await openGoreme(page);
  await setTurbo(page);
  await spin(page).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 40_000 });
  const after = formatAmount(START - 1000 + round.payoutCents);
  await expect(balance(page)).toContainText(after);
  await page.getByRole('button', { name: /Tekrar oynat: tur/ }).click();
  await expect(page.getByTestId('goreme-replay')).toContainText('Tekrar — bakiye değişmez');
  await expect(spin(page)).toBeDisabled();
  await expect(page.getByTestId('goreme-replay')).toHaveCount(0, { timeout: 40_000 });
  await expect(balance(page)).toContainText(after);
  await expect(rows(page)).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(await shownLabels(page)).toEqual(boardLabels(LIFT));
});

test('/verify recomputes a Göreme round from revealed seeds', async ({ page }) => {
  const serverSeed = 'cd'.repeat(32), clientSeed = 'goreme-test', nonce = 3, bet = 500, mode: GoremeMode = 'ante';
  const seedHex = createHmac('sha256', Buffer.from(serverSeed, 'hex')).update(`${clientSeed}:${nonce}`).digest('hex').slice(0, 32);
  const round = playGoremeRound(seedHex, bet, mode);
  await page.goto('/verify');
  await page.getByLabel('Oyun', { exact: true }).selectOption('goreme');
  await page.getByLabel('Mod', { exact: true }).selectOption(mode);
  await page.getByLabel('Bahis', { exact: true }).selectOption(String(bet));
  await page.getByLabel(/Açıklanan sunucu tohumu/).fill(serverSeed);
  await page.getByLabel(/tohum özeti/).fill(createHash('sha256').update(Buffer.from(serverSeed, 'hex')).digest('hex'));
  await page.getByLabel('Oyuncu tohumu', { exact: true }).fill(clientSeed);
  await page.getByLabel('Nonce', { exact: true }).fill(String(nonce));
  await page.getByRole('button', { name: 'Doğrula', exact: true }).click();
  await expect(page.getByTestId('verify-result')).toContainText('Eşleşti');
  await expect(page.getByTestId('verify-result')).toContainText('goreme-balloons-1');
  const lifts = round.spins.reduce((n, s) => n + s.lifts, 0);
  await expect(page.getByTestId('verify-goreme')).toContainText(`${lifts} kalkış`);
  await expect(page.getByTestId('verify-goreme')).toContainText(`Gök ×${round.spins.at(-1)!.skyAfter}`);
});

test.describe('English', () => {
  test.use({ locale: 'en-US', storageState: { cookies: [{ name: 'sollish_locale', value: 'en', domain: new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000').hostname, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });
  test('the game reads in English: title, deck, symbols and info', async ({ page }) => {
    await page.goto('/game/goreme');
    await expect(page.getByRole('heading', { name: 'Göreme: Dawn Balloons', exact: true, level: 1 })).toBeVisible();
    await enter(page, 'Play');
    await expect(page.getByRole('button', { name: 'Spin', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: /^Göreme reel window/ }).getByRole('img', { name: /^Fairy Chimney, reel \d, row \d$/ }).first()).toBeAttached();
    await expect(page.getByTestId('goreme-sky')).toContainText('SKY');
    await page.getByRole('button', { name: 'Game info' }).click();
    await expect(page.getByRole('dialog', { name: /Game info/ }).getByRole('tab', { name: 'Paytable' })).toBeVisible();
  });
});

/* Phone fit (22 Oct 2026): the first screen holds the whole table (board, win bar, deck, spin button) with no page
   scroll; phone CSS sizes the table to 100svh below its own top (slot-kit/use-viewport-top). */
test('phone 390x844 first screen: the whole table and the spin button fit without scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGoreme(page);
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
