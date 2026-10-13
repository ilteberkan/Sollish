import { test, expect, type Page } from '@playwright/test';

// Opt-in override for machines whose installed Chromium build differs from the Playwright pin.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

/* Remote (RGS) mode end to end. Needs a LOCAL realtime worker with SLOTS_ENABLED=true whose ALLOWED_ORIGINS holds the
   web origin, and a web server started with NEXT_PUBLIC_API_URL set to the same URL as PLAYWRIGHT_RGS_API. Skipped
   otherwise. DEMO credits only; nothing is deployed. */
const API = process.env.PLAYWRIGHT_RGS_API;
test.skip(!API, 'PLAYWRIGHT_RGS_API is not set (local RGS + NEXT_PUBLIC_API_URL required)');
test.describe.configure({ mode: 'serial' });

type Json = Record<string, unknown> & { balanceCents: number; rounds: { costCents: number; payoutCents: number; roundId: string }[] };
/** Reads the server's own view with this tab's token (the page keeps it in sessionStorage, never in a URL). */
async function server(page: Page, path: string, method: 'GET' | 'POST' = 'GET'): Promise<Json> {
  return page.evaluate(async ({ api, path, method }) => {
    const saved = JSON.parse(sessionStorage.getItem('sollish:rgs:v1') ?? '{}') as { token?: string };
    const response = await fetch(api + path, { method, headers: { Authorization: `Bearer ${saved.token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : undefined });
    return response.json();
  }, { api: API!, path, method }) as Promise<Json>;
}
async function enter(page: Page, splash: string) {
  await expect(page.getByTestId('round-source')).toHaveText('Sunucu doğrulamalı', { timeout: 20_000 });
  const play = page.getByRole('button', { name: 'Oyna', exact: true });
  await expect(play.or(page.getByRole('button', { name: 'Çevir', exact: true }))).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId(splash).count()) { await play.click(); await expect(page.getByTestId(splash)).toHaveCount(0); }
}
const cents = (text: string | null) => Math.round(Number((text ?? '').replace(/[^0-9,]/g, '').replace(',', '.')) * 100);
const turbo = async (page: Page) => { for (let i = 0; i < 3 && !(await page.getByRole('button', { name: /^Dönüş hızı: Turbo/ }).count()); i++) await page.getByRole('button', { name: /^Dönüş hızı:/ }).click(); };

test('Candy Cascade: server badge and balance, no local settlement, share link, replay, reveal + verify', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/game/cascade');
  await enter(page, 'cascade-splash');
  await turbo(page);
  const before = await server(page, '/v1/slots/session');
  expect(before.balanceCents).toBe(100_000);
  await expect(page.getByTestId('cascade-balance')).toContainText('1.000,00');
  await page.getByRole('button', { name: 'Çevir', exact: true }).click();
  await expect(page.getByTestId('share-round').first()).toBeVisible({ timeout: 90_000 });
  const history = await server(page, '/v1/slots/history'), state = await server(page, '/v1/slots/session');
  expect(history.rounds).toHaveLength(1);
  expect(state.balanceCents).toBe(100_000 - history.rounds[0]!.costCents + history.rounds[0]!.payoutCents);
  await expect.poll(async () => cents(await page.getByTestId('cascade-balance').textContent())).toBe(state.balanceCents);
  expect(await page.evaluate(() => location.href)).not.toContain('token');

  await page.getByTestId('share-round').first().click();
  const toast = page.getByTestId('cascade-toast');
  await expect(toast).toContainText('/replay/');
  const link = /https?:\/\/[^\s]+\/replay\/[0-9a-f]{32}/.exec((await toast.textContent()) ?? '')![0];
  expect(link).toContain(history.rounds[0]!.roundId);

  await page.goto(link);
  await expect(page.getByTestId('replay-verified')).toContainText('henüz açıklanmadı', { timeout: 20_000 });
  await expect(page.getByRole('img', { name: /^Izgara/ })).toBeVisible();

  await page.goto('/verify');
  await page.getByRole('button', { name: 'Oturum geçmişini yükle' }).click();
  await expect(page.locator('tr[data-status="pending"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Tohumu açıkla' }).click();
  await expect(page.locator('tr[data-status="match"]')).toHaveCount(1, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Forma aktar' }).first().click();
  await expect(page.getByTestId('verify-result')).toContainText('Eşleşti');

  await page.goto(link);
  await expect(page.getByTestId('replay-verified')).toContainText('Tohumla doğrulandı', { timeout: 20_000 });
});

test('Tarhun: a reload mid-round re-presents the same server round, no second debit', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/game/tarhun');
  await enter(page, 'tarhun-splash');
  await turbo(page);
  const start = await server(page, '/v1/slots/session');
  await page.getByRole('button', { name: 'Çevir', exact: true }).click();
  await expect.poll(async () => (await server(page, '/v1/slots/history')).rounds.filter(r => (r as unknown as { game: string }).game === 'tarhun').length, { timeout: 20_000 }).toBe(1);
  await page.reload();
  await enter(page, 'tarhun-splash');
  // The recovered round plays to its end and then appears in this page's history (the page lost its memory on reload).
  await expect(page.getByTestId('share-round').first()).toBeVisible({ timeout: 90_000 });
  const history = await server(page, '/v1/slots/history');
  const tarhun = history.rounds.filter(r => (r as unknown as { game: string }).game === 'tarhun');
  expect(tarhun).toHaveLength(1);
  const state = await server(page, '/v1/slots/session');
  expect(state.balanceCents).toBe(start.balanceCents - tarhun[0]!.costCents + tarhun[0]!.payoutCents);
  await expect.poll(async () => cents(await page.getByTestId('tarhun-balance').textContent())).toBe(state.balanceCents);
  // A second reload after the round was shown does not present it again.
  await page.reload();
  await enter(page, 'tarhun-splash');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('share-round')).toHaveCount(0);
  expect((await server(page, '/v1/slots/history')).rounds.length).toBe(history.rounds.length);
});
