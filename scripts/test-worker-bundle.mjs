import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('portable worker starts through deployment symlink, fails closed without secrets and shuts down cleanly', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sollish-bundle-'));
  const release = join(directory, 'release');
  await mkdir(release);
  await symlink(fileURLToPath(new URL('../apps/worker/dist/main.mjs', import.meta.url)), join(release, 'main.mjs'));
  await symlink(release, join(directory, 'current'));
  const child = spawn(process.execPath, [join(directory, 'current', 'main.mjs')], {
    env: { NODE_ENV: 'production', WORKER_PORT: '8791' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  try {
    let response;
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) throw new Error(`Worker exited early: ${output}`);
      try { response = await fetch('http://127.0.0.1:8791/health', { signal: AbortSignal.timeout(200) }); break; } catch { await delay(100); }
    }
    assert.ok(response, 'worker did not start'); assert.equal(response.status, 503);
    const status = await response.json();
    assert.equal(status.ready, false); assert.equal(status.configured, false); assert.equal(status.lastSuccess, null);
    assert.equal(status.keeper, 'disabled-no-deployment-or-fee-key');
    assert.equal((await fetch('http://127.0.0.1:8791/admin')).status, 404);
  } finally {
    child.kill('SIGTERM');
    const result = await Promise.race([exited, delay(5000).then(() => null)]);
    if (!result) child.kill('SIGKILL');
    await rm(directory, { recursive: true });
    assert.ok(result, 'worker did not gracefully exit');
    assert.equal(result[0], 0);
  }
});
