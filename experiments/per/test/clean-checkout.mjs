import assert from 'node:assert/strict';
import { access, cp, mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

// A source-only disposable tree proves the ordinary test suite cannot depend
// on the real ignored target/ELF or .tooling keys. Original files are untouched.
const source = fileURLToPath(new URL('../', import.meta.url));
const clean = await mkdtemp(join(tmpdir(), 'sollish-per-clean-'));
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {cwd: clean, stdio: 'inherit'});
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Clean-checkout command failed: ${code}`)));
});
try {
  for (const file of await readdir(source)) {
    if (file.endsWith('.mjs') || ['package.json', 'package-lock.json'].includes(file)) await cp(join(source, file), join(clean, file));
  }
  await cp(join(source, 'test'), join(clean, 'test'), {recursive: true});
  for (const file of ['validate-idl.mjs', 'Cargo.lock', 'src/lib.rs', 'artifacts/per_probe.idl.json', 'artifacts/own-probe-build.json']) {
    const target = join(clean, 'program', file);
    await mkdir(join(target, '..'), {recursive: true});
    await cp(join(source, 'program', file), target);
  }
  // Dependencies only; no source/build/key directories are linked.
  await symlink(join(source, 'node_modules'), join(clean, 'node_modules'), 'dir');
  await assert.rejects(access(join(clean, 'program/target')), {code: 'ENOENT'});
  await assert.rejects(access(join(clean, '.tooling')), {code: 'ENOENT'});
  const tests = (await readdir(join(clean, 'test'))).filter(file => file.endsWith('.test.mjs')).sort().map(file => join(clean, 'test', file));
  await run(['--test', ...tests]);
  const client = pathToFileURL(join(clean, 'probe-client.mjs')).href;
  await run(['--input-type=module', '--eval', `import assert from 'node:assert/strict'; import { loadArtifacts } from ${JSON.stringify(client)}; await assert.rejects(loadArtifacts(), {code:'ENOENT'}); console.log('Production loadArtifacts still rejects absent actual ELF.');`]);
  console.log('PASS: pure Node tests ran in source-only tree without target, real ELF, or private keys.');
} finally {
  await rm(clean, {recursive: true, force: true});
}
