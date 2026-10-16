// Per-route client bundle estimate (esbuild metafile). It bundles each route's page module the way a browser would
// receive its route-specific code: React, react-dom and next/* are external (shared framework chunks), CSS modules are
// empty, images/fonts are external. Output: minified bytes per route and how many bytes come from OTHER games' code
// (another game's components, engine or audio). This is an estimate for comparison; the authoritative number is the
// production build (`build:cloudflare`), see docs/architecture/scale.md.
//
// Usage (repo root): bash scripts/use-node.sh node apps/web/scripts/route-bundle-report.mjs [--out file.json]
import { build } from 'esbuild';
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
  ['cascade', [/components\/cascade\//, /lib\/cascade-/, /protocol\/src\/cascade(-2)?\.ts$/, /slot-audio\/(cascade|lab-panel)/, /slot-audio\/(sfx|synth|scores)\/cascade/]],
  ['tarhun', [/components\/storm\//, /lib\/storm-/, /protocol\/src\/storm-throne\.ts$/, /slot-audio\/(storm|use-storm)/, /slot-audio\/(sfx|synth|scores)\/(storm|anatolian)/]],
  ['ebru', [/components\/ebru\//, /lib\/ebru-/, /protocol\/src\/ebru\.ts$/, /slot-audio\/(ebru|use-ebru)/, /slot-audio\/(sfx|synth|scores)\/ebru/]],
  ['cezeri', [/components\/cezeri\//, /lib\/cezeri-/, /protocol\/src\/cezeri\.ts$/, /slot-audio\/(cezeri|use-cezeri)/, /slot-audio\/(sfx|synth|scores)\/cezeri/]],
  ['asena', [/components\/asena\//, /lib\/asena-/, /protocol\/src\/asena\.ts$/, /slot-audio\/(asena|use-asena)/, /slot-audio\/(sfx|synth|scores)\/asena/]],
  ['ringside', [/ringside/, /protocol\/src\/(combat|contact|neuro|connectome|corner-plan|fight-style|live-round|pari-mutuel)/]],
];
const gameOf = file => GAME_OF.find(([, patterns]) => patterns.some(p => p.test(file)))?.[0] ?? null;

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

const out = { tool: 'esbuild metafile (minified, framework external)', ignoreSideEffects: process.argv.includes('--ignore-side-effects'), generatedAt: new Date().toISOString(), routes: {} };
for (const [route, file] of Object.entries(routes)) {
  if (!existsSync(resolve(web, file))) continue;
  const result = await build({
    entryPoints: [resolve(web, file)], bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', metafile: true, logLevel: 'silent', plugins: [ext], outdir: '/tmp/unused',
    define: { 'process.env.NODE_ENV': '"production"' },
    // --ignore-side-effects reproduces the tree before packages/protocol declared "sideEffects": false (esbuild then
    // ignores every package's sideEffects field and /* @__PURE__ */ annotations).
    ignoreAnnotations: process.argv.includes('--ignore-side-effects'),
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
  });
  const js = result.outputFiles.find(f => f.path.endsWith('.js'));
  const meta = Object.values(result.metafile.outputs).find(o => o.entryPoint);
  const own = route.startsWith('/game/') ? route.slice(6) : route === '/live/ringside' ? 'ringside' : null;
  const byGame = {};
  let foreign = 0;
  for (const [input, info] of Object.entries(meta.inputs)) {
    const rel = relative(repo, resolve(web, input));
    const g = gameOf(rel) ?? 'shared';
    byGame[g] = (byGame[g] ?? 0) + info.bytesInOutput;
    if (g !== 'shared' && g !== own) foreign += info.bytesInOutput;
  }
  out.routes[route] = { minifiedBytes: js.contents.length, gzipBytes: gzipSync(js.contents).length, foreignGameBytes: foreign, bytesByOwner: Object.fromEntries(Object.entries(byGame).sort((a, b) => b[1] - a[1])) };
}
const flag = process.argv.indexOf('--out');
if (flag > 0) writeFileSync(resolve(process.cwd(), process.argv[flag + 1]), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
