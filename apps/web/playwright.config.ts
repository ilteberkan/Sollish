import { defineConfig, devices } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
/*
 * Specs query Turkish accessible names, so every test starts with an explicit Turkish choice (cookie) and a Turkish
 * browser. An i18n spec overrides both with test.use() (see tests/browser/i18n.spec.ts).
 */
const localeCookie = { name: 'sollish_locale', value: 'tr', domain: new URL(baseURL).hostname, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const };
export default defineConfig({
  testDir: './tests/browser',
  outputDir: '../../.tooling/web-browser-results',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  use: { baseURL, trace: 'retain-on-failure', locale: 'tr-TR', storageState: { cookies: [localeCookie], origins: [] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === 'true' ? undefined : { command: 'pnpm dev', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60000 },
  reporter: 'list',
});
