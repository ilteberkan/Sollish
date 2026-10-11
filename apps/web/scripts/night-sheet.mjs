// Dev aid: tile PNG frames into one contact sheet. usage: node scripts/night-sheet.mjs <out.png> <cols> <files...>
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [out, cols, ...files] = process.argv.slice(2);
const cells = files.map(f => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${basename(f)}</figcaption></figure>`).join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
await page.setContent(`<style>body{margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;right:6px;top:4px;color:#fff;font:14px sans-serif;background:#000a;padding:2px 5px}</style>${cells}`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
