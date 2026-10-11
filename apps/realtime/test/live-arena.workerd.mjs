/** Local real workerd/SQLite/WebSocket integration, no cloud deployment, wallets or money.
 * The generated fixture subclass adds ONLY local SQL failure/inspection controls, not a result API.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseLiveServerFrame } from '@sollish/protocol';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const folder = resolve(root, '.tooling/live-arena-integration');
const port = 18883, base = `http://127.0.0.1:${port}`, origin = 'http://localhost:3000';
await mkdir(folder, { recursive: true });
const entry = `import { LiveArena } from ${JSON.stringify(resolve(root, 'apps/realtime/src/live-arena.ts'))};
export class ProbeArena extends LiveArena {
 async fetch(r) {
  const path=new URL(r.url).pathname;
  if(path==='/__inspect') return Response.json({sessions:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM arena_sessions').one().n,tickets:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM arena_tickets').one().n});
  if(path==='/__fail') {this.ctx.storage.sql.exec("CREATE TRIGGER fail_debit BEFORE UPDATE OF balance ON arena_sessions BEGIN SELECT RAISE(ABORT,'synthetic local storage failure'); END");return new Response('ok');}
  if(path==='/__restore') {this.ctx.storage.sql.exec('DROP TRIGGER fail_debit');return new Response('ok');}
  return super.fetch(r);
 }
}
export default {fetch(r,env){if(new URL(r.url).pathname==='/ready')return new Response('ready');return env.ARENA.get(env.ARENA.idFromName('ringside')).fetch(r);}};`;
await writeFile(resolve(folder, 'entry.ts'), entry);
await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify({ name: 'sollish-live-arena-local-test', main: resolve(folder, 'entry.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], vars: { ALLOWED_ORIGINS: origin, LIVE_ARENA_ENABLED: 'true' }, durable_objects: { bindings: [{ name: 'ARENA', class_name: 'ProbeArena' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['ProbeArena'] }] }));
await rm(resolve(folder, 'state'), { recursive: true, force: true });
let logs = '', child, checks = 0; const sockets = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { const result = await fn(); if (result) return result; await wait(20); } throw new Error('LOCAL_ARENA_TEST_TIMEOUT'); }
async function start() {
 child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', resolve(folder, 'state'), '--show-interactive-dev-session=false'], { cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
 child.stdout.on('data', b => { logs = (logs + b).slice(-30000); }); child.stderr.on('data', b => { logs = (logs + b).slice(-30000); });
 await until(async () => { try { return (await fetch(`${base}/ready`)).ok; } catch { return false; } }, 30000);
}
async function stop() { for (const ws of sockets) { try { ws.close(); } catch {} } child?.kill('SIGTERM'); if (child) await Promise.race([new Promise(r => child.once('exit', r)), wait(5000)]); }
function connect(token, query = '') { return new Promise((resolve, reject) => {
 const ws = new WebSocket(`ws://127.0.0.1:${port}/arena${query}`, { headers: { Origin: origin } }); sockets.push(ws);
 const frames = [], timer = setTimeout(() => reject(new Error('LOCAL_CONNECT_TIMEOUT')), 12000);
 ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('LOCAL_CONNECT_FAILED')); });
 ws.addEventListener('message', e => {
  const frame = parseLiveServerFrame(String(e.data));
  if (!frame) { clearTimeout(timer); reject(new Error('INVALID_SERVER_FRAME')); return; }
  frames.push(frame);
  if (frame.type === 'arena.snapshot' && frames.filter(f => f.type === 'arena.snapshot').length === 1) ws.send(JSON.stringify({ v: 1, type: 'session', ...(token ? { token } : {}) }));
  if (frame.type === 'arena.session') { clearTimeout(timer); resolve({ ws, frames, token: token ?? frame.token }); }
 });
 }); }
const send = (c, frame) => c.ws.send(JSON.stringify({ v: 1, ...frame }));
const latest = (c, type) => c.frames.findLast(f => f.type === type);
const receipt = (c, id, state) => c.frames.findLast(f => f.type === 'arena.ticket' && f.ticket.clientId === id && (!state || f.ticket.status === state));
try {
 await start();
 assert.equal((await fetch(`${base}/arena`, { headers: { Origin: 'https://evil.invalid' } })).status, 403); checks++;
 await assert.rejects(connect(undefined, '?token=forbidden')); checks++;
 const a = await connect(), b = await connect(), a2 = await connect(a.token);
 assert.match(a.token, /^[0-9a-f]{64}$/); assert.notEqual(a.token, b.token);
 assert.equal(latest(a, 'arena.session').balanceCents, 100000); assert.equal(latest(b, 'arena.session').balanceCents, 100000);
 const round = latest(a, 'arena.snapshot').round;
 assert.equal(round.closesAtMs - round.openedAtMs, 5000); assert.equal(round.winner, null);
 assert.equal(latest(b, 'arena.snapshot').round.roundId, round.roundId); checks++;
 // Inject a database write failure after ticket insertion: actual transaction must roll back both writes.
 await fetch(`${base}/__fail`);
 const rejectedId = randomUUID(); send(a, { type: 'bet', clientId: rejectedId, roundId: round.roundId, side: 'kor', amountCents: 1000 });
 await until(() => a.frames.some(f => f.code === 'SERVICE_UNAVAILABLE'));
 assert.equal(receipt(a, rejectedId), undefined); assert.equal((await (await fetch(`${base}/__inspect`)).json()).tickets, 0);
 await fetch(`${base}/__restore`); send(a, { type: 'sync' }); await wait(50);
 assert.equal(latest(a, 'arena.session').balanceCents, 100000); checks++;
 const aId = randomUUID(), bId = randomUUID();
 const bet = { type: 'bet', clientId: aId, roundId: round.roundId, side: 'kor', amountCents: 1000 };
 send(a, bet); send(a2, bet); send(b, { ...bet, clientId: bId, side: 'ayaz' });
 await until(() => receipt(a, aId) && receipt(a2, aId) && receipt(b, bId));
 await until(() => latest(a, 'arena.session').balanceCents === 99000 && latest(b, 'arena.session').balanceCents === 99000);
 assert.equal((await (await fetch(`${base}/__inspect`)).json()).tickets, 2); checks++;
 send(a2, { ...bet, amountCents: 2000 }); await until(() => a2.frames.some(f => f.code === 'TICKET_CONFLICT')); checks++;
 // Disconnect all sockets for one player. Reconnect restores the same reservation, not a new grant.
 a.ws.close(); a2.ws.close(); await wait(40); const resumed = await connect(a.token);
 await until(() => receipt(resumed, aId)); assert.equal(latest(resumed, 'arena.session').balanceCents, 99000); checks++;
 await until(() => latest(b, 'arena.snapshot').round.phase === 'fighting');
 await until(() => latest(resumed, 'arena.snapshot').round.phase === 'fighting');
 const fighting = latest(b, 'arena.snapshot'); assert.ok(fighting.serverTimeMs >= round.closesAtMs);
 assert.equal(fighting.round.winner, latest(resumed, 'arena.snapshot').round.winner);
 for (const c of [a, b, a2, resumed]) assert.ok(c.frames.filter(f => f.type === 'arena.snapshot' && ['open', 'closed'].includes(f.round.phase)).every(f => f.round.winner === null)); checks++;
 send(b, { ...bet, clientId: randomUUID() }); await until(() => b.frames.some(f => f.code === 'ROUND_CLOSED')); checks++;
 send(resumed, bet); await until(() => receipt(resumed, aId)); await wait(40); assert.equal(latest(resumed, 'arena.session').balanceCents, 99000); checks++;
 await until(() => receipt(resumed, aId, 'settled') && receipt(b, bId, 'settled'));
 const aPayout = fighting.round.winner === 'kor' ? 1960 : 0, bPayout = 1960 - aPayout;
 assert.equal(receipt(resumed, aId, 'settled').ticket.payoutCents, aPayout); assert.equal(receipt(b, bId, 'settled').ticket.payoutCents, bPayout);
 assert.equal(latest(resumed, 'arena.session').balanceCents, 99000 + aPayout); assert.equal(latest(b, 'arena.session').balanceCents, 99000 + bPayout); checks++;
 for (let i = 0; i < 3; i++) { send(resumed, bet); send(resumed, { type: 'sync' }); }
 await wait(100); assert.equal(latest(resumed, 'arena.session').balanceCents, 99000 + aPayout); checks++;
 // Restart workerd with the same SQLite directory. Neither memory nor an open socket owns credits.
 await stop(); await start(); const restarted = await connect(a.token); await until(() => receipt(restarted, aId, 'settled'));
 assert.equal(latest(restarted, 'arena.session').balanceCents, 99000 + aPayout); assert.equal(receipt(restarted, aId).ticket.payoutCents, aPayout); checks++;
 const report = { at: new Date().toISOString(), runtime: 'local-workerd-sqlite', checks, sharedRoundId: round.roundId, timing: { windowMs: 5000, fightMs: 8800, resultMs: 4000 }, scope: 'Two independent anonymous demo players plus same-token concurrent reconnect. Real workerd alarms/SQLite, actual server CSPRNG, injected SQL failure, restart persistence. Not hosted load, VRF, financial settlement, Sybil resistance or production readiness.' };
 await mkdir(resolve(root, 'apps/realtime/evidence'), { recursive: true }); await writeFile(resolve(root, 'apps/realtime/evidence/local-live-arena.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error('LOCAL_LIVE_ARENA_FAILED', error.message); console.error(logs.slice(-6000)); process.exitCode = 1; }
finally { await stop(); }
