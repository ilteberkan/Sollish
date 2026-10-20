import { expect, test, type Page } from '@playwright/test';

/* Language switching: header picker and the shared slot-kit settings dialog. Starts from an English browser with no
   explicit choice (overrides the Turkish default of playwright.config.ts). */
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });
test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });

const switcher = (page: Page) => page.getByTestId('locale-switcher');

async function recordLocaleEvents(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __localeEvents: string[] };
    w.__localeEvents = [];
    window.addEventListener('sollish:locale', event => w.__localeEvents.push((event as CustomEvent<{ locale: string }>).detail.locale));
  });
}
const localeEvents = (page: Page) => page.evaluate(() => (window as unknown as { __localeEvents: string[] }).__localeEvents);

test.describe('German browser', () => {
  test.use({ locale: 'de-DE' });
  test('Accept-Language picks the server-rendered locale with no explicit choice', async ({ page }) => {
    const response = await page.goto('/games');
    expect(await response!.text()).toContain('<html lang="de"');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('link', { name: 'Prämien', exact: true })).toBeVisible();
  });
});

test('header switcher: en → 中文 → Türkçe updates text, <html lang>, cookie and the sollish:locale event without a reload', async ({ page, context }) => {
  await page.goto('/games');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Instant games' })).toBeVisible();
  await expect(switcher(page)).toHaveAccessibleName('Language');
  await recordLocaleEvents(page);
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });

  await switcher(page).selectOption('zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('button', { name: '连接钱包' })).toBeVisible();
  await expect(switcher(page)).toHaveAccessibleName('语言');
  // Server-rendered lobby text follows after router.refresh().
  await expect(page.getByRole('heading', { name: '即时游戏' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  expect(await localeEvents(page)).toEqual(['zh']);
  expect((await context.cookies()).find(c => c.name === 'sollish_locale')?.value).toBe('zh');
  expect(await page.evaluate(() => localStorage.getItem('sollish_locale'))).toBe('zh');

  // The choice survives a reload and is server-rendered (no flash of English).
  const html = await (await page.reload())!.text();
  expect(html).toContain('<html lang="zh-Hans"');
  expect(html).toContain('连接钱包');

  await recordLocaleEvents(page);
  await switcher(page).selectOption('tr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('button', { name: 'Cüzdan bağla' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Anında oyunlar' })).toBeVisible();
  expect(await localeEvents(page)).toEqual(['tr']);
});

test('slot settings dialog: language chips switch the shared slot-kit labels in place', async ({ page }) => {
  await page.goto('/game/tarhun');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // Splash and its "Oyna" button are per-game (Tarhun follow-up); accept either language.
  const play = page.getByRole('button', { name: /^(Oyna|Play)$/ });
  await expect(play.or(page.getByRole('button', { name: /^(Çevir|Spin)$/ }))).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId('tarhun-splash').count()) { await play.click(); await expect(page.getByTestId('tarhun-splash')).toHaveCount(0); }
  // The settings opener is per-game (still Turkish until the Tarhun follow-up); the dialog body is the shared kit.
  await page.getByRole('button', { name: /^(Ayarlar|Settings)$/ }).click();
  // The dialog is named in the active language (slotKit settings title), so it follows the switch.
  const dialog = page.getByRole('dialog', { name: /^(Ayarlar|Settings|设置)$/ });
  await expect(dialog.getByRole('switch', { name: 'Mute sound' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Spin speed' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Quick' })).toBeAttached();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Session info' })).toBeAttached();

  await recordLocaleEvents(page);
  await dialog.getByRole('radio', { name: '中文' }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('switch', { name: '静音' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: '旋转速度' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '快速' })).toBeAttached();
  await expect(dialog.getByRole('button', { name: '关闭' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '中文' })).toBeChecked();
  expect(await localeEvents(page)).toEqual(['zh']);

  await dialog.getByRole('radio', { name: 'English' }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(dialog.getByRole('switch', { name: 'Mute sound' })).toBeVisible();
  expect(await localeEvents(page)).toEqual(['zh', 'en']);
});
