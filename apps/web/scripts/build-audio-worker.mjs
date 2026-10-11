// Bundles the slot audio render worker into a plain static script. Turbopack cannot compile the
// `new Worker(new URL(...))` entry in production (it ships the raw .ts file), so the worker is built here
// and served from /workers/. Runs before `next dev` and `next build`.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(web, 'public/workers/slot-audio-render.js');
const result = await build({
  entryPoints: [resolve(web, 'lib/slot-audio/render.worker.ts')],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  write: false, logLevel: 'warning', legalComments: 'none',
});
const code = result.outputFiles[0].contents;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, code);
// The page loads the worker with this hash as a query string so a new build never reuses a stale copy.
const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
const manifest = resolve(web, 'lib/slot-audio/worker-version.generated.ts');
const next = `export const SLOT_AUDIO_WORKER_VERSION = '${hash}';\n`;
let previous = '';
try { previous = readFileSync(manifest, 'utf8'); } catch {}
if (previous !== next) writeFileSync(manifest, next);
console.log(`slot audio worker ${hash} (${code.length} bytes)`);
