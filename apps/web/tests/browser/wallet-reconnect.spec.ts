import { test, expect, type Page } from '@playwright/test';

if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

// Owned Wallet Standard fixture. The two fixture.* storage entries simulate extension
// authorization/call observations; the application stores only its wallet preference.
async function installWallet(page: Page, late = false) {
  await page.addInitScript(({ late }) => {
    const calls = () => JSON.parse(localStorage.getItem('fixture.wallet.calls') ?? '[]') as unknown[];
    const log = (value: unknown) => localStorage.setItem('fixture.wallet.calls', JSON.stringify([...calls(), value]));
    const account = (last = 0) => ({ address: '1'.repeat(last ? 31 : 32) + (last ? '2' : ''), publicKey: Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? last : 0), chains: ['solana:devnet'], features: ['solana:signMessage'] });
    let accounts = localStorage.getItem('fixture.wallet.authorized') ? [account()] : [];
    const listeners = new Set<(change: { accounts: typeof accounts }) => void>();
    let registry: { register: (wallet: unknown) => void } | undefined;
    const wallet = { version: '1.0.0', name: 'Owned reconnect fixture', icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E', chains: ['solana:devnet'], get accounts() { return accounts; }, features: {
      'standard:connect': { version: '1.0.0', connect: async (input?: { silent?: boolean }) => {
        log(input?.silent ? 'silent' : 'prompt');
        if (!input?.silent) { localStorage.setItem('fixture.wallet.authorized', 'yes'); accounts = [account()]; }
        else if (!accounts.length && localStorage.getItem('fixture.wallet.authorized')) accounts = [account()];
        return { accounts };
      } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { log('disconnect'); throw new Error('Owned extension disconnection rejection'); } },
      'standard:events': { version: '1.0.0', on: (_event: string, listener: (change: { accounts: typeof accounts }) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
      'solana:signMessage': { version: '1.0.0', signMessage: async () => { log('SIGN_UNEXPECTED'); throw new Error('No signature authorized by this fixture'); } },
    } };
    window.addEventListener('wallet-standard:app-ready', event => { registry = (event as CustomEvent<typeof registry>).detail; if (!late) registry?.register(wallet); });
    Object.assign(window, {
      __walletFixture: {
        register: () => registry?.register(wallet),
        ready: () => Boolean(registry),
        change: (last: number | null) => { accounts = last === null ? [] : [account(last)]; for (const listener of [...listeners]) listener({ accounts }); },
      },
    });
  }, { late });
}
async function fixtureAction(page: Page, action: 'register' | 'change', last?: number | null) {
  await page.evaluate(({ action, last }) => {
    const fixture = (window as unknown as { __walletFixture: { register: () => void; change: (last: number | null) => void } }).__walletFixture;
    if (action === 'register') fixture.register(); else fixture.change(last ?? null);
  }, { action, last });
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Cüzdan bağla', exact: true }).click();
  await page.getByRole('button', { name: /Owned reconnect fixture/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.wallet-button')).toContainText('11111…11111');
}
async function calls(page: Page): Promise<string[]> { return page.evaluate(() => JSON.parse(localStorage.getItem('fixture.wallet.calls') ?? '[]')); }

test('reload and cache-disabled reload silently restore selection without signing or another prompt', async ({ page, context }) => {
  await installWallet(page); await page.goto('/game/coinflip'); await connect(page);
  await page.reload(); await expect(page.locator('.wallet-button')).toContainText('11111…11111');
  const cdp = await context.newCDPSession(page); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload(); await expect(page.locator('.wallet-button')).toContainText('11111…11111');
  expect((await calls(page)).filter(value => value === 'prompt')).toHaveLength(1);
  expect((await calls(page)).filter(value => value === 'silent').length).toBeGreaterThanOrEqual(2);
  expect(await calls(page)).not.toContain('SIGN_UNEXPECTED');
  expect(await page.evaluate(() => localStorage.getItem('sollish.wallet.preference.v1'))).toBe('Owned reconnect fixture');
});
test('explicit disconnect forgets the wallet even if extension disconnect rejects; reload stays disconnected', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await installWallet(page); await page.goto('/game/coinflip'); await connect(page);
  await page.locator('.wallet-button').click(); await page.getByRole('button', { name: 'Bağlantıyı kes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cüzdan bağla', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sollish.wallet.preference.v1'))).toBeNull();
  await page.reload(); await expect(page.getByRole('button', { name: 'Cüzdan bağla', exact: true })).toBeVisible();
  expect(await calls(page)).toEqual(['prompt', 'disconnect']); expect(errors).toEqual([]);
});
test('previous selection can register after hydration; changed or removed accounts update the global connection', async ({ page }) => {
  await installWallet(page, true);
  await page.addInitScript(() => { localStorage.setItem('fixture.wallet.authorized', 'yes'); localStorage.setItem('sollish.wallet.preference.v1', 'Owned reconnect fixture'); });
  await page.goto('/game/crash');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __walletFixture: { ready: () => boolean } }).__walletFixture.ready())).toBe(true);
  await expect(page.getByRole('button', { name: 'Cüzdan bağla', exact: true })).toBeVisible();
  await fixtureAction(page, 'register'); await expect(page.locator('.wallet-button')).toContainText('11111…11111');
  await fixtureAction(page, 'change', 1); await expect(page.locator('.wallet-button')).toContainText('11111…11112');
  await fixtureAction(page, 'change', null); await expect(page.getByRole('button', { name: 'Cüzdan bağla', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sollish.wallet.preference.v1'))).toBeNull();
  expect(await calls(page)).toEqual(['silent']);
});
test('saved but unauthorized wallet silently returns no accounts and waits for an explicit connect', async ({ page }) => {
  await installWallet(page); await page.addInitScript(() => localStorage.setItem('sollish.wallet.preference.v1', 'Owned reconnect fixture'));
  await page.goto('/game/coinflip'); await expect.poll(() => calls(page)).toContain('silent');
  await expect(page.getByRole('button', { name: 'Cüzdan bağla', exact: true })).toBeVisible(); expect(await calls(page)).not.toContain('prompt');
  await connect(page); expect((await calls(page)).filter(value => value === 'prompt')).toHaveLength(1); expect(await calls(page)).not.toContain('SIGN_UNEXPECTED');
});
