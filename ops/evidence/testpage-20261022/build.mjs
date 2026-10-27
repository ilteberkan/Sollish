// Sollish standalone test page (version 7): lobby + Göreme + Damla + 5 slots, 9 languages, TR/EN voice.
// One self-contained HTML file. Reads the current repo tree only (never writes into it, except that
// apps/web/scripts/build-audio-worker.mjs regenerates its own outputs, which it does idempotently).
// Run from the repo root:  bash scripts/use-node.sh node <this file>
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(process.cwd(), 'apps/web/package.json')) ? process.cwd() : '/home/user/Sollish';
const web = join(root, 'apps/web');
const pub = join(web, 'public');
const outDir = join(here, 'out');
const srcDir = join(here, 'src');
const LIMIT = 15 * 1024 * 1024;
mkdirSync(outDir, { recursive: true });
mkdirSync(srcDir, { recursive: true });

// 1. Audio worker (also regenerates voice-version.generated.ts when voice files changed).
const w = spawnSync(process.execPath, [join(web, 'scripts/build-audio-worker.mjs')], { cwd: web, stdio: 'inherit' });
if (w.status !== 0) throw new Error('build-audio-worker failed');
const workerCode = readFileSync(join(pub, 'workers/slot-audio-render.js'), 'utf8');

const req = createRequire(join(web, 'package.json'));
const { build } = req('esbuild');

// 2. Entry (absolute imports, written into the scratchpad).
const imp = p => JSON.stringify(join(web, p));
const GAMES = [
  ['goreme', 'components/goreme/goreme-game', 'GoremeGame', 'goreme'],
  ['damla', 'components/damla/damla-game', 'DamlaGame', 'damla'],
  ['tarhun', 'components/storm/tarhun-game', 'TarhunGame', 'tarhun'],
  ['ebru', 'components/ebru/ebru-game', 'EbruGame', 'ebru'],
  ['cezeri', 'components/cezeri/cezeri-game', 'CezeriGame', 'cezeri'],
  ['asena', 'components/asena/asena-game', 'AsenaGame', 'asena'],
  ['cascade', 'components/cascade/cascade-game', 'CascadeGame', 'cascade'],
];
const entry = `
import './globals-link.css';
import { StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, useLocale, useT } from ${imp('lib/i18n/client.tsx')};
import { loadNamespaces, NAMESPACES } from ${imp('lib/i18n/catalog.ts')};
import { isLocale, LOCALES, LOCALE_NATIVE_NAMES, LOCALE_STORAGE_KEY } from ${imp('lib/i18n/config.ts')};
import { Providers } from ${imp('components/providers.tsx')};
import { Lobby } from ${imp('components/lobby/lobby.tsx')};
import lobbyStyles from ${imp('components/lobby/lobby.module.css')};
${GAMES.map(([, p, n]) => `import { ${n} } from ${imp(p + '.tsx')};`).join('\n')}

const TABS = [['lobby', null], ${GAMES.map(([id, , n]) => `['${id}', ${n}]`).join(', ')}];
const SHORT = { goreme: 'Göreme', damla: 'Damla', tarhun: 'Tarhun', ebru: 'Ebru', cezeri: 'Cezeri', asena: 'Asena', cascade: 'Candy Cascade' };
function tabFor(href) {
  const path = String(href || '').split(/[?#]/)[0];
  if (path === '/' || path === '/games') return 'lobby';
  const m = /^\\/game\\/([a-z]+)/.exec(path);
  return m && TABS.some(t => t[0] === m[1]) ? m[1] : null;
}
function readTab() { const h = (location.hash || '').slice(1); return TABS.some(t => t[0] === h) ? h : 'lobby'; }

function App() {
  const { locale, selected, setLocale } = useLocale();
  const tc = useT('common');
  const [tab, setTab] = useState(readTab);
  useEffect(() => {
    window.__sollishNav = href => {
      const next = tabFor(href);
      if (!next) { console.info('[testpage] not in this page:', href); return; }
      setTab(next);
      try { history.replaceState(null, '', '#' + next); } catch {}
      window.scrollTo(0, 0);
    };
  }, []);
  const Active = TABS.find(t => t[0] === tab)[1];
  return <>
    <header className="tp-bar">
      <div className="tp-row tp-langs" role="group" aria-label="Language">
        {LOCALES.map(l => <button key={l} type="button" data-locale={l} aria-pressed={selected === l} title={LOCALE_NATIVE_NAMES[l]} onClick={() => void setLocale(l)}>{l.toUpperCase()}</button>)}
        <span className="tp-tag">DEMO</span>
      </div>
      <nav className="tp-row tp-tabs" aria-label="Games">
        {TABS.map(([id]) => <button key={id} type="button" data-tab={id} aria-current={tab === id ? 'page' : undefined} onClick={() => window.__sollishNav(id === 'lobby' ? '/games' : '/game/' + id)}>{id === 'lobby' ? tc('shell.nav.lobby') : SHORT[id]}</button>)}
      </nav>
    </header>
    <div className="workspace chat-collapsed">
      <main id="main-content" className="main-content" data-locale={locale} key={tab}>
        {Active ? <Active /> : <div className={lobbyStyles.page}><Suspense fallback={null}><Lobby /></Suspense></div>}
      </main>
    </div>
  </>;
}

async function start() {
  let initial = 'tr';
  try { const s = localStorage.getItem(LOCALE_STORAGE_KEY); if (isLocale(s)) initial = s; } catch {}
  const messages = await loadNamespaces(initial, NAMESPACES);
  createRoot(document.getElementById('app')).render(<StrictMode><I18nProvider locale={initial} messages={messages}><Providers><App /></Providers></I18nProvider></StrictMode>);
}
start();
`;
writeFileSync(join(srcDir, 'entry.tsx'), entry);
writeFileSync(join(srcDir, 'globals-link.css'), `@import ${JSON.stringify(join(web, 'app/globals.css'))};\n@import ${JSON.stringify(join(web, 'app/shell.css'))};\n`);

// 3. next/* mocks. Links and router pushes switch tabs (window.__sollishNav).
const MOCKS = {
  'next/navigation': `
    import { useMemo } from 'react';
    const nav = href => { if (window.__sollishNav) window.__sollishNav(String(href)); };
    const router = { push: nav, replace: nav, back() {}, forward() {}, refresh() {}, prefetch() {} };
    export function useRouter() { return router; }
    export function usePathname() { return '/'; }
    export function useSearchParams() { return useMemo(() => new URLSearchParams(), []); }
    export function useParams() { return {}; }
    export function redirect(href) { nav(href); }
    export function notFound() { throw new Error('notFound'); }`,
  'next/link': `
    import { forwardRef, createElement } from 'react';
    const Link = forwardRef(function Link({ href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, onClick, ...rest }, ref) {
      const target = typeof href === 'string' ? href : (href && href.pathname) || '/';
      return createElement('a', { ...rest, ref, href: '#' + target, onClick: event => {
        if (onClick) onClick(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (window.__sollishNav) window.__sollishNav(target);
      } });
    });
    export default Link;`,
  'next/image': `
    import { createElement } from 'react';
    export default function Image({ src, fill, priority, quality, placeholder, blurDataURL, loader, unoptimized, ...rest }) {
      return createElement('img', { ...rest, src: typeof src === 'string' ? src : src && src.src });
    }`,
  'next/dynamic': `
    import { lazy, Suspense, createElement } from 'react';
    export default function dynamic(loader, options) {
      const Lazy = lazy(() => Promise.resolve(loader()).then(m => ({ default: m && m.default ? m.default : m })));
      return props => createElement(Suspense, { fallback: options && options.loading ? createElement(options.loading) : null }, createElement(Lazy, props));
    }`,
};
const unknownNext = new Set();
const nextPlugin = {
  name: 'next-mocks',
  setup(b) {
    b.onResolve({ filter: /^next(\/|$)/ }, args => ({ path: args.path, namespace: 'next-mock' }));
    b.onLoad({ filter: /.*/, namespace: 'next-mock' }, args => {
      if (!MOCKS[args.path]) unknownNext.add(args.path);
      return { contents: MOCKS[args.path] ?? 'export default {};', loader: 'jsx', resolveDir: web };
    });
    // Lobby poster URLs: served from the embedded asset table (an <img> cannot use the fetch override).
    b.onLoad({ filter: /lib[\\/]lobby[\\/]posters\.ts$/ }, args => {
      const src = readFileSync(args.path, 'utf8');
      const from = 'src: `/images/lobby/${key}.webp?v=${version}`';
      if (!src.includes(from)) throw new Error('posters.ts changed: poster URL template not found');
      return { contents: src.replace(from, 'src: (globalThis.__sollishAsset ? globalThis.__sollishAsset(`/images/lobby/${key}.webp`) : `/images/lobby/${key}.webp?v=${version}`)'), loader: 'ts' };
    });
  },
};

const result = await build({
  entryPoints: [join(srcDir, 'entry.tsx')],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false,
  jsx: 'automatic', write: false, outdir: outDir, legalComments: 'none', logLevel: 'warning',
  nodePaths: [join(web, 'node_modules')],
  loader: { '.module.css': 'local-css', '.css': 'css', '.json': 'json', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: 'var process={env:{NODE_ENV:"production"}};' },
  plugins: [nextPlugin],
});
let js = '', css = '';
for (const f of result.outputFiles) { if (f.path.endsWith('.js')) js = f.text; else if (f.path.endsWith('.css')) css = f.text; }
if (unknownNext.size) console.warn('unmocked next/* imports:', [...unknownNext]);

// 4. Assets: voice lines (every game, tr+en) and lobby posters, base64.
const files = {};
const sizes = {};
function addDir(dir, urlBase, exts) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) addDir(p, `${urlBase}/${e.name}`, exts);
    else if (exts.some(x => e.name.endsWith(x))) {
      const b = readFileSync(p);
      files[`${urlBase}/${e.name}`] = b.toString('base64');
      const group = urlBase.split('/').slice(0, 4).join('/');
      sizes[group] = (sizes[group] ?? 0) + b.length;
    }
  }
}
addDir(join(pub, 'audio/voice'), '/audio/voice', ['.mp3']);
addDir(join(pub, 'images/lobby'), '/images/lobby', ['.webp']);
// Fonts as data URIs (design system 27 Oct 2026): IBM Plex Sans 400–700 and Playfair Display italic 600/700 for the UI
// (latin + latin-ext subsets, one family each, split by unicode-range), Barlow for game art lettering.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const face = (family, file, wgt, style, range) => `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${readFileSync(join(pub, `fonts/${file}`)).toString('base64')}) format('woff2');font-weight:${wgt};font-style:${style};font-display:swap${range ? `;unicode-range:${range}` : ''}}`;
const fontFace = [
  ...[400, 500, 600, 700].flatMap(w => [face('IBM Plex Sans', `ibm-plex-sans-latin-${w}-normal.woff2`, w, 'normal', LATIN), face('IBM Plex Sans', `ibm-plex-sans-latin-ext-${w}-normal.woff2`, w, 'normal', LATIN_EXT)]),
  ...[600, 700].flatMap(w => [face('Playfair Display', `playfair-display-latin-${w}-italic.woff2`, w, 'italic', LATIN), face('Playfair Display', `playfair-display-latin-ext-${w}-italic.woff2`, w, 'italic', LATIN_EXT)]),
  ...[['Regular', 400], ['Medium', 500], ['SemiBold', 600]].map(([n, w]) => face('Barlow', `Barlow-${n}.woff2`, w, 'normal')),
].join('');

const payload = JSON.stringify({ worker: workerCode, files }).replace(/</g, '\\u003c');
const runtime = `
(function(){
  var data = JSON.parse(document.getElementById('sollish-assets').textContent);
  var MIME = { mp3: 'audio/mpeg', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
  var hits = window.__sollishFetchHits = [];
  var blobs = {};
  function pathOf(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var m = /^(?:[a-z]+:\\/\\/[^/]*)?(\\/(?:audio|images)\\/[^?#]*)/i.exec(url);
    return m ? m[1] : null;
  }
  function bytes(path) {
    var b64 = data.files[path]; if (!b64) return null;
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function mime(path) { return MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream'; }
  window.__sollishAsset = function (path) {
    if (blobs[path]) return blobs[path];
    var b = bytes(path); if (!b) return path;
    return (blobs[path] = URL.createObjectURL(new Blob([b], { type: mime(path) })));
  };
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var path = pathOf(input);
    if (path) {
      var b = bytes(path);
      hits.push({ path: path, ok: !!b, at: Date.now() });
      if (b) return Promise.resolve(new Response(b, { status: 200, headers: { 'Content-Type': mime(path) } }));
      return Promise.resolve(new Response('', { status: 404 }));
    }
    return realFetch(input, init);
  };
  var workerUrl = URL.createObjectURL(new Blob([data.worker], { type: 'text/javascript' }));
  var RealWorker = window.Worker;
  if (RealWorker) {
    var W = function (url, options) {
      var u = String(url);
      return new RealWorker(u.indexOf('slot-audio-render') >= 0 ? workerUrl : url, options);
    };
    W.prototype = RealWorker.prototype;
    window.Worker = W;
  }
})();`;

const pageCss = `
:root{--font-barlow-face:'Barlow';--font-plex-face:'IBM Plex Sans';--font-plex-ext-face:'IBM Plex Sans';--font-playfair-face:'Playfair Display';--font-playfair-ext-face:'Playfair Display'}
body{background:#000;margin:0;overflow-x:hidden}
.tp-bar{position:sticky;top:0;z-index:60;background:#0c131a;border-bottom:1px solid #2a3b4a;padding:8px 16px 0}
.tp-row{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.tp-row::-webkit-scrollbar{display:none}
.tp-langs{padding-bottom:8px;align-items:center}
.tp-langs button{flex:0 0 auto;min-width:40px;height:32px;border-radius:6px;background:#17212c;color:#aebfcb;font-size:13px;font-weight:600;border:1px solid #2a3b4a}
.tp-langs button[aria-pressed=true]{background:#e9b35d;color:#10171f;border-color:#e9b35d}
.tp-tag{margin-left:auto;flex:0 0 auto;font-size:12px;color:#91c9b0;border:1px solid #2f5546;border-radius:4px;padding:2px 6px}
.tp-tabs button{flex:0 0 auto;padding:10px 12px;background:none;color:#aebfcb;font-size:15px;font-weight:600;border-bottom:2px solid transparent;white-space:nowrap}
.tp-tabs button[aria-current=page]{color:#f1f5f8;border-bottom-color:#e9b35d}
.workspace{display:block}
@media(max-width:500px){.tp-bar{padding:6px 12px 0}.tp-langs{gap:4px}.tp-langs button{min-width:0;flex:1 1 0;padding:0;height:30px;font-size:12px}.tp-tag{display:none}.tp-tabs button{padding:9px 10px;font-size:14px}}
`;
const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#10171F">
<title>Sollish Test Oyunları</title>
<style>${fontFace}</style>
<style>${css}</style>
<style>${pageCss}</style>
</head><body>
<div id="app"></div>
<script type="application/json" id="sollish-assets">${payload}</script>
<script>${runtime}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
const outFile = join(outDir, 'sollish-test.html');
writeFileSync(outFile, html);

const mb = n => (n / 1048576).toFixed(2) + ' MB';
console.log(`js ${mb(js.length)}, css ${mb(css.length)}, worker ${mb(workerCode.length)}`);
for (const [k, v] of Object.entries(sizes).sort()) console.log(`  ${k}: ${mb(v)} raw`);
const total = statSync(outFile).size;
console.log(`${outFile}: ${mb(total)} (${total} bytes)`);
if (total > LIMIT) { console.error(`OVER LIMIT ${mb(LIMIT)}`); process.exit(3); }
