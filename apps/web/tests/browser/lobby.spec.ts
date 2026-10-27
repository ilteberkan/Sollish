import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/* Casino lobby and app shell (Turkish names: playwright.config.ts forces tr). */
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

const originals = (page: Page) => page.getByRole('region', { name: 'Sadece Sollish\'te' });
const squares = (page: Page) => page.getByRole('navigation', { name: 'Kategoriye göre göz at' });
const search = (page: Page) => page.getByRole('combobox', { name: 'Oyun ara' });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('/ is the lobby without a redirect; /games serves the same lobby; a tile opens its game', async ({ page }) => {
  const response = await page.goto('/');
  expect(response!.status()).toBe(200);
  expect(response!.request().redirectedFrom()).toBeNull();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sollish kumarhane lobisi' })).toBeAttached();
  await expect(page.getByRole('region', { name: 'Vitrin' })).toBeVisible();
  await expect(originals(page).getByRole('listitem')).toHaveCount(7);
  // Tiles show provider, RTP, max win and volatility from the engine evidence.
  const asena = originals(page).getByRole('link', { name: 'Asena: Yıldız Kurdu' });
  await expect(asena).toHaveAccessibleDescription(/RTP %95,20.*En çok ×5\.000.*Oynaklık: Çok yüksek/);
  await expect(originals(page).getByRole('link', { name: 'Göreme: Şafak Balonları' })).toHaveAccessibleDescription(/RTP %96,30.*En çok ×10\.000.*Oynaklık: Çok yüksek/);
  await page.goto('/games');
  await expect(originals(page)).toBeVisible();
  await page.goto('/');
  await originals(page).getByRole('link', { name: 'Cezeri: Zamanın Çarkları' }).click();
  await expect(page).toHaveURL(/\/game\/cezeri$/);
});

test('category chips filter in place, keep the URL and the Back button', async ({ page }) => {
  await page.goto('/');
  const chips = page.getByRole('group', { name: 'Oyunları filtrele' });
  await expect(chips).toHaveCount(0); // the home view has category squares instead (888)
  await squares(page).getByRole('link', { name: 'Slotlar' }).click();
  await expect(page).toHaveURL(/\?c=slots$/);
  await expect(chips.getByRole('button', { name: 'Slotlar' })).toHaveAttribute('aria-pressed', 'true');
  const results = page.locator('#lobby-results');
  await expect(results.getByRole('heading', { level: 2 })).toContainText('Slotlar');
  await expect(results.getByRole('listitem')).toHaveCount(6);
  await chips.getByRole('button', { name: 'Anında oyunlar' }).click();
  await expect(results.getByRole('listitem')).toHaveCount(3);
  await expect(results.getByRole('link', { name: 'Damla: Pamukkale' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\?c=slots$/);
  await expect(results.getByRole('listitem')).toHaveCount(6);
  // Sidebar category links switch the same filter (desktop).
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Canlı', exact: true }).click();
  await expect(page).toHaveURL(/\?c=live$/);
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Lobi', exact: true }).click();
  await expect(originals(page)).toBeVisible();
});

test('888 category squares open each category grid; they are real ?c= links', async ({ page }) => {
  await page.goto('/');
  const tiles = squares(page);
  await expect(tiles.getByRole('link')).toHaveCount(6);
  const expected: Array<[string, string, number]> = [['Canlı', 'live', 1], ['Slotlar', 'slots', 6], ['Yeni oyunlar', 'new', 6], ['Kanıtlanabilir adil', 'fair', 8], ['Sollish Özel', 'exclusive', 7], ['Anında oyunlar', 'instant', 3]];
  await expect(tiles.getByRole('link')).toHaveText(expected.map(([name]) => name.toLocaleUpperCase('tr')), { useInnerText: true });
  const results = page.locator('#lobby-results');
  for (const [name, category, count] of expected) {
    const link = tiles.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', `/?c=${category}`);
    // Rounded square art with the caption under it.
    const art = (await link.locator('span').first().boundingBox())!;
    expect(Math.abs(art.width - art.height)).toBeLessThan(2);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`\\?c=${category}$`));
    await expect(results.getByRole('listitem')).toHaveCount(count);
    await expect(results.getByRole('group', { name: 'Oyunları filtrele' }).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    await results.getByRole('button', { name: 'Lobiye dön' }).click();
  }
  // Without JS the link still lands on the filtered grid (server reads ?c=).
  await page.goto('/?c=exclusive');
  await expect(results.getByRole('listitem')).toHaveCount(7);
});

test('every row "View all" opens that category grid and brings it into view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const rows: Array<[string, string, number]> = [["Sadece Sollish'te", 'exclusive', 7], ['Öne çıkan oyunlar', 'slots', 6], ['Canlı casino', 'live', 1], ['Anında oyunlar', 'instant', 3]];
  const results = page.locator('#lobby-results');
  for (const [title, category, count] of rows) {
    await page.goto('/');
    const button = page.getByRole('button', { name: `Tümünü gör: ${title}` });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page).toHaveURL(new RegExp(`\\?c=${category}$`));
    await expect(results.getByRole('listitem')).toHaveCount(count);
    await expect(results.getByRole('heading', { level: 2 })).toBeInViewport();
  }
});

test('888 promo hero: accent headline word, lime pill CTA, arrows and dots rotate our featured games', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Vitrin' });
  const heading = hero.getByRole('heading', { level: 2, name: 'Göreme Şafak Balonları' });
  await expect(heading).toBeVisible();
  await expect(heading.locator('em.accent')).toHaveText('Göreme');
  expect(await heading.locator('em.accent').evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic');
  const cta = hero.getByRole('link', { name: /^Demoyu oyna ?: Göreme: Şafak Balonları$/ });
  await expect(cta).toHaveAttribute('href', '/game/goreme');
  expect(await cta.evaluate(el => getComputedStyle(el).borderRadius)).toBe('999px');
  await expect(hero.getByRole('button', { name: /göster$/ })).toHaveCount(5);
  await hero.getByRole('button', { name: 'Sonraki öne çıkan oyun' }).click();
  await expect(hero.getByRole('button', { name: 'Asena: Yıldız Kurdu göster' })).toHaveAttribute('aria-current', 'true');
  await expect(hero.getByRole('heading', { level: 2, name: 'Asena Yıldız Kurdu' })).toBeInViewport();
});

test('bet365 "Only at Sollish" row: EXCLUSIVE badge, lime info button opens a popover with RTP, max win and volatility', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const row = originals(page);
  await expect(row.getByRole('heading', { level: 2 })).toHaveText("Sadece Sollish'te");
  expect(await row.getByRole('heading', { level: 2 }).locator('span').first().evaluate(el => getComputedStyle(el).textTransform)).toBe('uppercase');
  await expect(row.getByRole('button', { name: "Tümünü gör: Sadece Sollish'te" })).toBeVisible();
  await expect(row.getByText('ÖZEL', { exact: true })).toHaveCount(7);
  const tile = row.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Cezeri: Zamanın Çarkları' }) });
  const box = (await tile.getByRole('link').boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
  const info = row.getByRole('button', { name: 'Cezeri: Zamanın Çarkları: oyun bilgisi' });
  await info.click();
  const pop = page.getByRole('dialog', { name: 'Cezeri: Zamanın Çarkları' });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('RTP %95,50');
  await expect(pop).toContainText('En çok ×10.000');
  await expect(pop).toContainText('Yüksek');
  await expect(pop.getByRole('link', { name: 'Oyna' })).toHaveAttribute('href', '/game/cezeri');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(info).toBeFocused();
});

test('888 Live Casino grid: tabs, 16:9 card with bet range, host, results chip and title strip; no invented numbers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const live = page.getByRole('region', { name: 'Canlı casino' });
  await live.scrollIntoViewIfNeeded();
  const tabs = live.getByRole('tablist', { name: 'Canlı masa türleri' });
  await expect(tabs.getByRole('tab')).toHaveText(['Öne çıkan', 'Sollish Özel', 'Yeni', 'Havuz bahsi']);
  await expect(tabs.getByRole('tab', { name: 'Öne çıkan' })).toHaveAttribute('aria-selected', 'true');
  const card = live.getByTestId('live-table-ringside');
  await expect(card).toHaveAttribute('href', '/live/ringside');
  await expect(card.getByTestId('live-bet-range')).toContainText('1–500 DEMO');
  await expect(card.getByTestId('live-host')).toContainText('Jev');
  await expect(card.getByTestId('live-host')).toContainText('Ortak maç');
  await expect(card.getByTestId('live-results')).toHaveText('Sonuçlar arenada');
  await expect(card.getByTestId('live-status')).toHaveText('Canlı');
  await expect(card.getByTestId('live-host')).not.toHaveText(/\d/);
  const art = (await card.locator('span').first().boundingBox())!;
  expect(art.width / art.height).toBeCloseTo(16 / 9, 1);
  await tabs.getByRole('tab', { name: 'Yeni' }).click();
  await expect(live.getByText('Bu sekmede henüz canlı masa yok.')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Havuz bahsi' }).click();
  await expect(live.getByTestId('live-table-ringside')).toBeVisible();
});

test('Lucky-style originals row: colourful tiles with a caption band and ribbons; featured row is round', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const row = page.getByRole('region', { name: 'Anında oyunlar' });
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByRole('link')).toHaveCount(3);
  await expect(row.getByRole('link', { name: 'Damla: Pamukkale' })).toContainText('Yeni');
  await expect(row.getByRole('link', { name: 'Crash' })).toContainText('Orijinal');
  await expect(row.getByRole('link', { name: 'Damla: Pamukkale' })).toHaveAccessibleDescription(/RTP %98,45/);
  const featured = page.getByRole('region', { name: 'Öne çıkan oyunlar' });
  await expect(featured.getByRole('link')).toHaveCount(6);
  const round = featured.getByRole('link', { name: 'Göreme: Şafak Balonları' });
  await expect(round).toHaveAccessibleDescription('En çok ×10.000');
  expect(await round.locator('span').first().evaluate(el => getComputedStyle(el).borderRadius)).toBe('999px');
});

test('top-bar search filters the lobby instantly and suggests games on other pages', async ({ page }) => {
  await page.goto('/');
  await search(page).fill('kurt');
  const results = page.locator('#lobby-results');
  await expect(results.getByRole('status')).toHaveText('“kurt” için 1 oyun');
  await expect(results.getByRole('link', { name: 'Asena: Yıldız Kurdu' })).toBeVisible();
  await search(page).fill('plinko');
  await expect(results.getByRole('link', { name: 'Damla: Pamukkale' })).toBeVisible();
  await expect(results.getByText('Sollish Orijinal').first()).toBeVisible();
  await search(page).fill('kapadokya');
  await expect(results.getByRole('link', { name: 'Göreme: Şafak Balonları' })).toBeVisible();
  await search(page).fill('FIRTINA');
  await expect(results.getByRole('link', { name: 'Tarhun: Fırtına Tahtı' })).toBeVisible();
  await search(page).fill('zzz');
  await expect(results.getByText('“zzz” ile eşleşen oyun yok', { exact: false })).toBeVisible();
  await search(page).press('Escape');
  await expect(search(page)).toHaveValue('');
  await expect(originals(page)).toBeVisible();

  await page.goto('/game/crash');
  await search(page).fill('ebru');
  const option = page.getByRole('option', { name: /Ebru: Mürekkep Bahçesi/ });
  await expect(option).toBeVisible();
  await search(page).press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await search(page).press('Enter');
  await expect(page).toHaveURL(/\/game\/ebru$/);
  await expect(search(page)).toHaveValue('');
});

test('favorites persist in this browser, get their own row and filter', async ({ page }) => {
  await page.goto('/');
  await originals(page).getByRole('button', { name: 'Ebru: Mürekkep Bahçesi: oyun bilgisi' }).click();
  const pop = page.getByRole('dialog', { name: 'Ebru: Mürekkep Bahçesi' });
  await pop.getByRole('button', { name: 'Ebru: Mürekkep Bahçesi oyununu favorilere ekle' }).click();
  await expect(pop.getByRole('button', { name: 'Ebru: Mürekkep Bahçesi oyununu favorilerden çıkar' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('sollish_favorites'))).toBe('["ebru"]');
  await page.reload();
  const favRow = page.getByRole('region', { name: 'Favorilerin' });
  await expect(favRow.getByRole('link', { name: 'Ebru: Mürekkep Bahçesi' })).toBeVisible();
  await favRow.getByRole('button', { name: 'Tümünü gör: Favorilerin' }).click();
  await expect(page).toHaveURL(/\?c=favorites$/);
  const results = page.locator('#lobby-results');
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await results.getByRole('button', { name: /favorilerden çıkar/ }).click();
  await expect(results.getByText('Henüz favori yok', { exact: false })).toBeVisible();
});

test('recently played is recorded by the shell and reserved before hydration', async ({ page }) => {
  await page.goto('/game/coinflip');
  await expect(page.getByRole('heading', { name: 'Coinflip', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Sollish ana sayfa' }).first().click();
  const recent = page.getByRole('region', { name: 'Son oynananlar' });
  await expect(recent.getByRole('link', { name: /Coinflip/ })).toBeVisible();
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.recent)).toBe('1');
  await recent.getByRole('button', { name: 'Listeyi temizle' }).click();
  await expect(recent).toHaveCount(0);
});

test('rows: arrow keys move between games, scroll buttons page the row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const links = originals(page).locator('li > article > a');
  await links.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(links.nth(6)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(links.first()).toBeFocused();
  const forward = originals(page).getByRole('button', { name: "İleri kaydır: Sadece Sollish'te" });
  await expect(originals(page).getByRole('button', { name: "Geri kaydır: Sadece Sollish'te" })).toBeDisabled();
  if (await forward.isEnabled()) {
    await forward.click();
    await expect(originals(page).getByRole('button', { name: "Geri kaydır: Sadece Sollish'te" })).toBeEnabled();
  }
});

test('desktop sidebar collapses to a rail, keeps link names and restores the choice before paint', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Ana gezinme' });
  expect((await nav.boundingBox())!.width).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Menüyü daralt' }).click();
  await expect(page.getByRole('button', { name: 'Menüyü genişlet' })).toHaveAttribute('aria-expanded', 'false');
  expect((await nav.boundingBox())!.width).toBeLessThan(80);
  await expect(nav.getByRole('link', { name: 'Asena', exact: true })).toBeVisible();
  await page.reload();
  expect((await nav.boundingBox())!.width).toBeLessThan(80);
  // Game routes default to the rail; the choice wins there too.
  await page.getByRole('button', { name: 'Menüyü genişlet' }).click();
  await nav.getByRole('link', { name: 'Crash', exact: true }).click();
  await expect(page).toHaveURL(/\/game\/crash$/);
  expect((await nav.boundingBox())!.width).toBeGreaterThan(200);
});

for (const width of [320, 390, 430]) {
  test(`phone ${width}px: bottom tab bar, no horizontal scroll, 44px targets, search and menu`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(await noHorizontalScroll(page)).toBe(true);
    const bar = page.getByRole('navigation', { name: 'Hızlı gezinme' });
    await expect(bar).toBeVisible();
    for (const item of await bar.locator('a, button').all()) {
      const box = (await item.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    for (const button of await page.locator('main button:visible, main a:visible').all()) {
      const box = await button.boundingBox();
      if (!box || box.width === 0) continue;
      expect(Math.min(box.width, box.height), await button.evaluate(el => el.outerHTML.slice(0, 120))).toBeGreaterThanOrEqual(24);
    }
    await bar.getByRole('link', { name: 'Slotlar' }).click();
    await expect(page).toHaveURL(/\?c=slots$/);
    await expect(bar.getByRole('link', { name: 'Slotlar' })).toHaveAttribute('aria-current', 'page');
    await bar.getByRole('button', { name: 'Ara' }).click();
    await expect(search(page)).toBeFocused();
    await search(page).fill('crash');
    await expect(page.locator('#lobby-results').getByRole('link', { name: 'Crash' })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.getByRole('button', { name: 'Aramayı kapat' }).click();
    await bar.getByRole('button', { name: 'Menü' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menü' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Ödüller' }).click();
    await expect(page).toHaveURL(/\/rewards$/);
    await expect(drawer).toHaveCount(0);
    // Game routes leave the bottom of the screen to the game: no tab bar, the menu button opens the drawer.
    await page.goto('/game/crash');
    await expect(bar).toHaveCount(0);
    await page.getByRole('button', { name: 'Menü' }).click();
    await expect(page.getByRole('dialog', { name: 'Menü' }).getByRole('link', { name: 'Asena', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}

test('tablet 834px: icon rail with accessible names, no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Ana gezinme' });
  expect((await nav.boundingBox())!.width).toBeLessThan(80);
  await expect(nav.getByRole('link', { name: 'Ödüller' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Hızlı gezinme' })).toBeHidden();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test.describe('English browser', () => {
  test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });
  test('locale switch on the lobby re-renders rows, chips and tiles without a reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Instant games', level: 2 })).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
    await page.getByTestId('locale-switcher').selectOption('zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
    await expect(page.getByRole('heading', { name: '即时游戏', level: 2 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '按类别浏览' }).getByRole('link', { name: '老虎机' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sollish 独有' }).getByRole('link', { name: 'Asena：星狼' })).toBeVisible();
    await page.getByTestId('locale-switcher').selectOption('de');
    await expect(page.getByRole('heading', { name: 'Sofortspiele', level: 2 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Spiele suchen' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });
});

for (const width of [390, 1440]) {
  test(`lobby WCAG 2.2 AA automated checks at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations, JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.slice(0, 4).map(n => n.target) })))).toEqual([]);
    await originals(page).getByRole('button', { name: 'Cezeri: Zamanın Çarkları: oyun bilgisi' }).click();
    const open = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(open.violations.map(v => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await squares(page).getByRole('link', { name: 'Kanıtlanabilir adil' }).click();
    const filtered = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(filtered.violations.map(v => v.id)).toEqual([]);
  });
}

test('reduced motion: the hero never rotates on its own and has no pause button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Vitrin' });
  await expect(hero.getByRole('button', { name: 'Dönüşü duraklat' })).toBeHidden();
  await expect(hero.getByRole('button', { name: 'Göreme: Şafak Balonları göster' })).toHaveAttribute('aria-current', 'true');
  await page.waitForTimeout(8000);
  await expect(hero.getByRole('button', { name: 'Göreme: Şafak Balonları göster' })).toHaveAttribute('aria-current', 'true');
  await hero.getByRole('button', { name: 'Sonraki öne çıkan oyun' }).click();
  await expect(hero.getByRole('button', { name: 'Asena: Yıldız Kurdu göster' })).toHaveAttribute('aria-current', 'true');
});
