// Serialises heavy local jobs (e.g. Chromium/WebGL runs) between concurrent agents on one machine.
// Usage: node scripts/dev/with-lock.mjs <name> [--wait-min=30] -- <command> [args...]
// Atomic mkdir lock under .tooling/locks; a lock whose owner process is gone is reclaimed.
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2), split = argv.indexOf('--');
if (split < 1 || split === argv.length - 1) { console.error('usage: with-lock.mjs <name> [--wait-min=N] -- <command> [args...]'); process.exit(2); }
const [name, ...flags] = argv.slice(0, split), command = argv.slice(split + 1);
if (!/^[a-z0-9-]{1,40}$/.test(name)) { console.error('invalid lock name'); process.exit(2); }
const waitMin = Number((flags.find(f => f.startsWith('--wait-min=')) ?? '--wait-min=30').split('=')[1]);
const dir = resolve(root, '.tooling/locks', name + '.lock'), info = resolve(dir, 'owner.json');
mkdirSync(resolve(root, '.tooling/locks'), { recursive: true });
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const deadline = Date.now() + waitMin * 60_000;
let announced = false;
for (;;) {
  try { mkdirSync(dir); writeFileSync(info, JSON.stringify({ pid: process.pid, command: command[0], since: new Date().toISOString() })); break; }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let owner = null; try { owner = JSON.parse(readFileSync(info, 'utf8')); } catch { /* being written */ }
    if (owner && !alive(owner.pid)) { rmSync(dir, { recursive: true, force: true }); continue; }
    if (Date.now() > deadline) { console.error(`lock ${name} still held by ${owner ? owner.pid : 'unknown'} after ${waitMin} min`); process.exit(75); }
    if (!announced) { console.error(`waiting for lock ${name} (held by pid ${owner?.pid ?? '?'})…`); announced = true; }
    await new Promise(r => setTimeout(r, 2000));
  }
}
const release = () => { try { const owner = JSON.parse(readFileSync(info, 'utf8')); if (owner.pid === process.pid) rmSync(dir, { recursive: true, force: true }); } catch { if (existsSync(dir)) { /* leave foreign lock */ } } };
const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { child.kill(signal); });
child.on('exit', (code, signal) => { release(); process.exit(code ?? (signal ? 1 : 0)); });
child.on('error', error => { release(); console.error(error.message); process.exit(1); });
