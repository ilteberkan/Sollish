// First-load JS per route from a Next (Turbopack) production build in apps/web/.next: rootMainFiles + polyfills + the
// layout and page entry chunks from each page_client-reference-manifest.js. Raw and gzip bytes, plus which game engines
// / heavy modules appear in those chunks (marker strings), to prove a player of one game does not download another's.
// Run after `next build` (or build:cloudflare). Usage: node apps/web/scripts/first-load-report.mjs [--out file.json]
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const next = resolve(web, '.next');
const build = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8'));
// Marker strings that only exist in one game's code (engine ids, distinctive identifiers).
const MARKERS = {
  'cascade engine': 'candy-cascade-2', 'tarhun engine': 'storm-throne-1', 'ebru engine': 'ebru-ink-1', 'cezeri engine': 'cezeri-gears-1', 'asena engine': 'asena-stars-1',
  'ringside contact engine': 'ringside-contact-5', 'connectome weights': 'RESERVOIR_INFO',
};
function pages(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p, `${prefix}/${name}`));
    else if (name === 'page_client-reference-manifest.js') out.push({ route: prefix || '/', file: p });
  }
  return out;
}
const size = f => { const b = readFileSync(join(next, f)); return { raw: b.length, gzip: gzipSync(b, { level: 9 }).length, text: b.toString('utf8') }; };
const report = { buildId: existsSync(join(next, 'BUILD_ID')) ? readFileSync(join(next, 'BUILD_ID'), 'utf8').trim() : '(BUILD_ID missing: compile finished, later build step did not)', generatedAt: new Date().toISOString(), method: 'rootMainFiles + entryJSFiles[layout] + entryJSFiles[page] (polyfills excluded: nomodule)', polyfillRaw: build.polyfillFiles.reduce((a, f) => a + readFileSync(join(next, f)).length, 0), routes: {} };
// polyfillFiles are <script nomodule>: modern browsers never download them, so they are reported separately.
const shared = [...build.rootMainFiles];
for (const { route, file } of pages(join(next, 'server/app')).sort((a, b) => a.route.localeCompare(b.route))) {
  if (route.startsWith('/_') || route.includes('/lab')) continue;
  const src = readFileSync(file, 'utf8');
  const manifest = JSON.parse(src.slice(src.indexOf('= {') + 2).replace(/;\s*$/, ''));
  const entries = manifest.entryJSFiles ?? {};
  const pageKey = Object.keys(entries).find(k => k.endsWith(`/app${route === '/' ? '' : route}/page`));
  const layoutKey = Object.keys(entries).find(k => k.endsWith('/app/layout'));
  const files = [...new Set([...shared, ...(entries[layoutKey] ?? []), ...(entries[pageKey] ?? [])])];
  let raw = 0, gzip = 0; const found = {}; let routeOnlyRaw = 0;
  const layoutSet = new Set([...shared, ...(entries[layoutKey] ?? [])]);
  for (const f of files) {
    const s = size(f); raw += s.raw; gzip += s.gzip; if (!layoutSet.has(f)) routeOnlyRaw += s.raw;
    for (const [label, marker] of Object.entries(MARKERS)) if (s.text.includes(marker)) found[label] = true;
  }
  report.routes[route] = { chunks: files.length, firstLoadJsRaw: raw, firstLoadJsGzip: gzip, routeSpecificRaw: routeOnlyRaw, contains: Object.keys(found) };
}
const flag = process.argv.indexOf('--out');
if (flag > 0) writeFileSync(resolve(process.cwd(), process.argv[flag + 1]), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
