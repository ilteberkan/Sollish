import { chromium } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:6550';
const target = new URL(origin);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('LOCAL_PREVIEW_ONLY');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requested = new Map();
  const pending = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('.js') && new URL(response.url()).origin === target.origin) {
      pending.push(response.body().then(body => requested.set(response.url(), { path: new URL(response.url()).pathname, decodedBytes: body.length, gzipBytes: gzipSync(body).length })).catch(() => {}));
    }
  });
  await page.goto(`${origin}/game/crash`, { waitUntil: 'networkidle' });
  await Promise.all(pending);
  const initialSources = await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => script.src));
  const allInitial = [...requested.values()];
  const routeInitial = initialSources.map(url => requested.get(url)).filter(Boolean);
  const initialUrls = new Set(requested.keys());
  await page.getByRole('button', { name: 'Cüzdan bağla' }).click();
  await page.getByText('Bu tarayıcıda cüzdan bulunamadı').waitFor();
  await page.waitForLoadState('networkidle');
  await Promise.all(pending);
  const walletAdditional = [...requested.entries()].filter(([url]) => !initialUrls.has(url)).map(([, item]) => item);
  const sum = items => items.reduce((total, item) => total + item.gzipBytes, 0);
  const report = {
    measuredAt: new Date().toISOString(), source: `${origin}/game/crash`, runtime: 'local production preview',
    method: 'Response bodies recompressed with Node gzip defaults; not CDN transfer size, not Core Web Vitals. Initial set includes any automatic route prefetch. No wallet extension installed.',
    initialDocumentScripts: { files: routeInitial, gzipBytes: sum(routeInitial) },
    allInitialNetworkJavaScript: { files: allInitial, gzipBytes: sum(allInitial) },
    walletConnectAdditional: { files: walletAdditional, gzipBytes: sum(walletAdditional) },
    targetGzipBytes: 200 * 1024,
  };
  const out = path.resolve(process.cwd(), '../../.tooling/web-js-measurement.json');
  await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: out, initialDocumentGzip: report.initialDocumentScripts.gzipBytes, initialNetworkGzip: report.allInitialNetworkJavaScript.gzipBytes, walletAdditionalGzip: report.walletConnectAdditional.gzipBytes }));
} finally { await browser.close(); }
