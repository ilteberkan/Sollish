/** Full production router in local workerd, with no Auth credentials or remote deployment. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLiveServerFrame } from '@sollish/protocol';
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url))), folder = resolve(root, '.tooling/live-arena-router-test');
const port = 18884, base = `http://127.0.0.1:${port}`, origin = 'http://localhost:3000';
await mkdir(folder, { recursive: true }); await rm(resolve(folder, 'state'), { recursive: true, force: true });
let child, logs = '', checks = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { const result = await fn(); if (result) return result; await wait(30); } throw new Error('LOCAL_ROUTER_TIMEOUT'); }
async function start(enabled) {
 const config = { name: 'sollish-arena-router-local-test', main: resolve(root, 'apps/realtime/src/index.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], vars: { ALLOWED_ORIGINS: origin, FANOUT_BUCKETS: '8', ...(enabled ? { LIVE_ARENA_ENABLED: 'true' } : {}) }, durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'RoomCoordinator' }, { name: 'BUCKETS', class_name: 'FanoutBucket' }, { name: 'ADMISSION', class_name: 'AdmissionGate' }, { name: 'LIVE_ARENA', class_name: 'LiveArena' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['RoomCoordinator', 'FanoutBucket', 'AdmissionGate'] }, { tag: 'v2', new_sqlite_classes: ['LiveArena'] }] };
 await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify(config));
 child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', resolve(folder, 'state'), '--show-interactive-dev-session=false'], { cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
 for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { logs = (logs + b).slice(-30000); });
 await until(async () => { try { return (await fetch(`${base}/health`)).status === 503; } catch { return false; } }, 30000);
}
async function stop() { child?.kill('SIGTERM'); if (child) await Promise.race([new Promise(r => child.once('exit', r)), wait(5000)]); }
function handshake(headers = {}, path = '/v1/arena/ringside') {
 return new Promise((resolve, reject) => {
  const req = request(base + path, { headers: { Origin: origin, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'bG9jYWwtdGVzdC1vbmx5IQ==', 'Sec-WebSocket-Version': '13', ...headers } });
  req.setTimeout(8000, () => req.destroy(new Error('HANDSHAKE_TIMEOUT'))); req.on('error', reject);
  req.on('response', res => { res.resume(); resolve(res.statusCode); }); req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); }); req.end();
 });
}
try {
 await start(false);
 assert.equal(await handshake(), 503); checks++;
 assert.equal((await fetch(`${base}/health`)).status, 503); checks++;
 await stop(); await start(true);
 assert.equal(await handshake({ Origin: 'https://evil.invalid' }), 403); checks++;
 assert.equal(await handshake({ Origin: '' }), 403); checks++;
 assert.equal(await handshake({}, '/v1/arena/ringside?token=never-in-url'), 400); checks++;
 assert.equal((await fetch(`${base}/v1/arena/ringside`, { headers: { Origin: origin } })).status, 400); checks++;
 assert.equal((await fetch(`${base}/v1/chat/history`, { headers: { Origin: origin } })).status, 503); checks++;
 const publicStatus = await (await fetch(`${base}/v1/public/status`)).json();
 assert.equal(publicStatus.chat.available, false); assert.ok(publicStatus.games.every(g => g.available === false)); checks++;
 // Thirty concurrent upgrade admissions on one edge IP, followed by explicit rate rejection.
 const statuses = await Promise.all(Array.from({ length: 31 }, () => handshake({ 'CF-Connecting-IP': '198.18.0.1' })));
 assert.equal(statuses.filter(s => s === 101).length, 30); assert.equal(statuses.filter(s => s === 429).length, 1); checks++;
 assert.equal(await handshake({ 'CF-Connecting-IP': '198.18.0.2' }), 101); checks++;
 const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/arena/ringside`, { headers: { Origin: origin, 'CF-Connecting-IP': '198.18.0.3' } });
 const frames = [];
 ws.addEventListener('message', e => { const frame = parseLiveServerFrame(String(e.data)); assert.ok(frame); frames.push(frame); });
 await until(() => frames.some(f => f.type === 'arena.snapshot'));
 // Spectators can see public state, but cannot occupy a connection indefinitely without a session.
 await until(() => ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED, 12000); checks++;
 const frameCount = frames.length; await wait(4000); assert.equal(frames.length, frameCount); checks++;
 const report = { at: new Date().toISOString(), runtime: 'local-workerd-production-router', checks, scope: 'Default-off flag, origin, query, upgrade, actual IP admission 30/min under concurrent handshake, 10s anonymous close initiation and removal from fanout, unchanged unavailable chat/financial status. Node/workerd full close handshake may complete later. Local headers simulate the Cloudflare edge IP; no hosted bot resistance or global capacity claim.' };
 await mkdir(resolve(root, 'apps/realtime/evidence'), { recursive: true }); await writeFile(resolve(root, 'apps/realtime/evidence/local-live-arena-router.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error('LOCAL_LIVE_ROUTER_FAILED', error.message); console.error(logs.slice(-6000)); process.exitCode = 1; }
finally { await stop(); }
