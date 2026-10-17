// Per-route client bundle estimate (esbuild metafile). It bundles each route's page module the way a browser would
// receive its route-specific code: React, react-dom and next/* are external (shared framework chunks), CSS modules are
// empty, images/fonts are external. Output: minified bytes per route and how many bytes come from OTHER games' code
// (another game's components, engine or audio). This is an estimate for comparison; the authoritative number is the
// production build (`build:cloudflare`), see docs/architecture/scale.md.
//
// Code splitting is on, so `import()` creates a chunk like it does in the real build. The pages load their game with
// next/dynamic (an `import()`), so a route's load is the entry chunk plus every chunk reached by static OR dynamic import,
// except the ON_DEMAND modules below, which are not loaded on a normal visit. `minifiedBytes`/`gzipBytes`/
// `foreignGameBytes` count the route load; `lazyMinifiedBytes` is the on-demand code (not part of any normal visit).
//
// Usage (repo root): bash scripts/use-node.sh node apps/web/scripts/route-bundle-report.mjs [--out file.json] [--overlay dir]
//   --overlay dir   source files under dir (paths relative to apps/web) replace the tree's files: measure an older revision
//                   without checking it out (git show <rev>:apps/web/<path> > dir/<path>).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '../..');
const routes = {
  '/': 'app/page.tsx',
  '/games': 'app/games/page.tsx',
  '/game/cascade': 'app/game/cascade/page.tsx',
  '/game/tarhun': 'app/game/tarhun/page.tsx',
  '/game/ebru': 'app/game/ebru/page.tsx',
  '/game/cezeri': 'app/game/cezeri/page.tsx',
  '/game/asena': 'app/game/asena/page.tsx',
  '/live/ringside': 'app/live/ringside/page.tsx',
  '/verify': 'app/verify/page.tsx',
};
// Which source files belong to which game (anything else is shared platform code).
const GAME_OF = [
  ['cascade', [/components\/cascade\//, /lib\/cascade-/, /lib\/slot-engines\/cascade/, /protocol\/src\/cascade(-2)?\.ts$/, /slot-audio\/(cascade|lab-panel)/, /slot-audio\/(sfx|synth|scores)\/cascade/]],
  ['tarhun', [/components\/storm\//, /lib\/storm-/, /lib\/slot-engines\/tarhun/, /protocol\/src\/storm-throne\.ts$/, /slot-audio\/(storm|use-storm)/, /slot-audio\/(sfx|synth|scores)\/(storm|anatolian)/]],
  ['ebru', [/components\/ebru\//, /lib\/ebru-/, /lib\/slot-engines\/ebru/, /protocol\/src\/ebru\.ts$/, /slot-audio\/(ebru|use-ebru)/, /slot-audio\/(sfx|synth|scores)\/ebru/]],
  ['cezeri', [/components\/cezeri\//, /lib\/cezeri-/, /lib\/slot-engines\/cezeri/, /protocol\/src\/cezeri\.ts$/, /slot-audio\/(cezeri|use-cezeri)/, /slot-audio\/(sfx|synth|scores)\/cezeri/]],
  ['asena', [/components\/asena\//, /lib\/asena-/, /lib\/slot-engines\/asena/, /protocol\/src\/asena\.ts$/, /slot-audio\/(asena|use-asena)/, /slot-audio\/(sfx|synth|scores)\/asena/]],
  ['ringside', [/ringside/, /protocol\/src\/(combat|contact|neuro|connectome|corner-plan|fight-style|live-round|pari-mutuel)/]],
];
// Loaded only on a failure path, never on a normal visit: the main-thread audio renderer (the worker path is the normal one).
// (and the per-locale message catalogues: one locale loads per visit, the same before and after any change here)
const ON_DEMAND = [/lib\/slot-audio\/render\.ts$/, /^messages\//];
const gameOf = file => GAME_OF.find(([, patterns]) => patterns.some(p => p.test(file)))?.[0] ?? null;

const overlayFlag = process.argv.indexOf('--overlay');
const overlay = overlayFlag > 0 ? resolve(process.cwd(), process.argv[overlayFlag + 1]) : null;
const overlayPlugin = { name: 'overlay', setup(b) {
  if (!overlay) return;
  b.onLoad({ filter: /\.(ts|tsx)$/ }, a => {
    const rel = relative(web, a.path);
    const file = resolve(overlay, rel);
    if (rel.startsWith('..') || !existsSync(file)) return null;
    return { contents: readFileSync(file, 'utf8'), loader: a.path.endsWith('x') ? 'tsx' : 'ts', resolveDir: dirname(a.path) };
  });
} };

const ext = { name: 'externals', setup(b) {
  b.onResolve({ filter: /^(react|react-dom|next)(\/.*)?$|^react\/jsx-runtime$/ }, a => ({ path: a.path, external: true }));
  b.onResolve({ filter: /\.(css)$/ }, a => ({ path: a.path, namespace: 'css-stub' }));
  b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'export default new Proxy({}, { get: (_, k) => String(k) });', loader: 'js' }));
  b.onResolve({ filter: /\.(png|jpe?g|webp|svg|woff2?|mp3|ogg)$/ }, a => ({ path: a.path, external: true }));
  b.onResolve({ filter: /^@\// }, a => ({ path: resolveTs(resolve(web, a.path.slice(2))) }));
} };
import { existsSync, statSync } from 'node:fs';
function resolveTs(p) {
  for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`]) if (existsSync(c) && statSync(c).isFile()) return c;
  return p;
}

const out = { tool: 'esbuild metafile (minified, code-split, framework external)', overlay: overlay ? relative(process.cwd(), overlay) : null, ignoreSideEffects: process.argv.includes('--ignore-side-effects'), generatedAt: new Date().toISOString(), routes: {} };
for (const [route, file] of Object.entries(routes)) {
  if (!existsSync(resolve(web, file))) continue;
  const result = await build({
    entryPoints: [resolve(web, file)], bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', metafile: true, logLevel: 'silent', plugins: [overlayPlugin, ext], outdir: '/tmp/unused', splitting: true, absWorkingDir: web,
    define: { 'process.env.NODE_ENV': '"production"' },
    // --ignore-side-effects reproduces the tree before packages/protocol declared "sideEffects": false (esbuild then
    // ignores every package's sideEffects field and /* @__PURE__ */ annotations).
    ignoreAnnotations: process.argv.includes('--ignore-side-effects'),
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
  });
  const outputs = result.metafile.outputs;
  const entryName = Object.keys(outputs).find(k => outputs[k].entryPoint === file);
  // route load = entry chunk + every chunk reached by import / import() except the ON_DEMAND failure-path modules
  const initial = new Set();
  const walk = name => { if (initial.has(name)) return; initial.add(name); for (const i of outputs[name].imports) if (outputs[i.path] && !(i.kind === 'dynamic-import' && ON_DEMAND.some(p => p.test(outputs[i.path].entryPoint ?? '')))) walk(i.path); };
  walk(entryName);
  const files = new Map(result.outputFiles.map(f => [relative(process.cwd(), f.path), f]));
  const fileOf = name => [...files.entries()].find(([k]) => k.endsWith(name.split('/').pop()))?.[1];
  const own = route.startsWith('/game/') ? route.slice(6) : route === '/live/ringside' ? 'ringside' : null;
  const byGame = {}, foreignInputs = {};
  let foreign = 0, minified = 0, gz = 0, lazy = 0, lazyForeign = 0;
  for (const [name, info] of Object.entries(outputs)) {
    const f = fileOf(name);
    if (!f || !name.endsWith('.js')) continue;
    if (!initial.has(name) && /messages\//.test(info.entryPoint ?? '')) continue; // locale catalogues, not code
    if (!initial.has(name)) { lazy += f.contents.length; }
    else { minified += f.contents.length; gz += gzipSync(f.contents).length; }
    for (const [input, i] of Object.entries(info.inputs)) {
      const g = gameOf(relative(repo, resolve(web, input))) ?? 'shared';
      if (!initial.has(name)) { if (g !== 'shared' && g !== own) lazyForeign += i.bytesInOutput; continue; }
      byGame[g] = (byGame[g] ?? 0) + i.bytesInOutput;
      if (g !== 'shared' && g !== own) { foreign += i.bytesInOutput; foreignInputs[input] = (foreignInputs[input] ?? 0) + i.bytesInOutput; }
    }
  }
  out.routes[route] = { minifiedBytes: minified, gzipBytes: gz, foreignGameBytes: foreign, lazyMinifiedBytes: lazy, lazyForeignGameBytes: lazyForeign, foreignInputs: Object.fromEntries(Object.entries(foreignInputs).sort((a, b) => b[1] - a[1]).slice(0, 12)), bytesByOwner: Object.fromEntries(Object.entries(byGame).sort((a, b) => b[1] - a[1])) };
}
const flag = process.argv.indexOf('--out');
if (flag > 0) writeFileSync(resolve(process.cwd(), process.argv[flag + 1]), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
