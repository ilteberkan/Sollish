import { defineConfig, devices } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
export default defineConfig({
  testDir: './tests/browser',
  outputDir: '../../.tooling/web-browser-results',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === 'true' ? undefined : { command: 'pnpm dev', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60000 },
  reporter: 'list',
});
