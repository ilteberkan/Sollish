import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../apps/worker/dist/', import.meta.url);
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['apps/worker/src/main.ts'],
  outfile: fileURLToPath(new URL('main.mjs', out)),
  bundle: true, platform: 'node', target: 'node24', format: 'esm',
  minify: false, sourcemap: false, legalComments: 'eof',
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __sollishCreateRequire } from 'node:module'; const require = __sollishCreateRequire(import.meta.url);" },
});
const artifact = await readFile(new URL('main.mjs', out));
const report = {
  schemaVersion: 1, builtAt: new Date().toISOString(), node: process.version,
  sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.length,
  scope: 'Portable Node 24 artifact; configuration and on-chain deployment are separate gates.',
};
await writeFile(new URL('build.json', out), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
