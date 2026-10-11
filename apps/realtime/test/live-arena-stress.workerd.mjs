/** Bounded LOCAL stress experiment. 256 sockets/64 demo bettors, never cloud traffic or funds.
 * A fixture subclass exposes aggregate read-only SQL counters; result/admission logic is unchanged.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLiveServerFrame } from '@sollish/protocol';
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url))), folder = resolve(root, '.tooling/live-arena-stress');
const port = 18885, base = `http://127.0.0.1:${port}`, origin = 'http://localhost:3000';
const socketCount = 256, bettorCount = 64, lateCount = 32;
await mkdir(folder, { recursive: true }); await rm(resolve(folder, 'state'), { recursive: true, force: true });
await writeFile(resolve(folder, 'entry.ts'), `import {LiveArena} from ${JSON.stringify(resolve(root, 'apps/realtime/src/live-arena.ts'))};
export class StressArena extends LiveArena {async fetch(r){
 if(new URL(r.url).pathname==='/__stats')return Response.json({sessions:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n, SUM(balance) AS balance FROM arena_sessions').one(),tickets:this.ctx.storage.sql.exec("SELECT COUNT(*) AS n,SUM(amount) AS stakes,SUM(payout) AS payouts,SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) AS settled FROM arena_tickets").one()});
 return super.fetch(r);}}
export default {fetch(r,e){if(new URL(r.url).pathname==='/ready')return new Response('ready');return e.ARENA.get(e.ARENA.idFromName('stress')).fetch(r);}};`);
await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify({ name: 'sollish-arena-local-stress', main: resolve(folder, 'entry.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], vars: { ALLOWED_ORIGINS: origin, LIVE_ARENA_ENABLED: 'true' }, durable_objects: { bindings: [{ name: 'ARENA', class_name: 'StressArena' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['StressArena'] }] }));
const child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', resolve(folder, 'state'), '--show-interactive-dev-session=false'], { cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', protocolFailure = false, closedSockets = 0, report; const clients = [];
for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { logs = (logs + b).slice(-12000); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await wait(10); } throw new Error('LOCAL_STRESS_TIMEOUT'); }
const send = (client, body) => client.ws.send(JSON.stringify({ v: 1, ...body }));
function connect() { return new Promise((resolve, reject) => {
 const ws = new WebSocket(`ws://127.0.0.1:${port}/arena`, { headers: { Origin: origin } });
 const client = { ws, round: null, version: 0, balance: null, ticket: null, sentAt: null, ackAt: null, errors: [], ready: false }; clients.push(client);
 const timer = setTimeout(() => reject(new Error('STRESS_SESSION_TIMEOUT')), 25000);
 ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('STRESS_SOCKET_ERROR')); });
 ws.addEventListener('close', () => { closedSockets++; });
 ws.addEventListener('message', e => {
  const frame = parseLiveServerFrame(String(e.data)); if (!frame) { protocolFailure = true; return; }
  if (frame.type === 'arena.snapshot') {
   if (frame.version < client.version) protocolFailure = true;
   client.version = frame.version; client.round = frame.round;
   if (!client.ready) { client.ready = true; send(client, { type: 'session' }); }
  }
  if (frame.type === 'arena.session') { client.balance = frame.balanceCents; clearTimeout(timer); resolve(client); }
  if (frame.type === 'arena.ticket') { client.ticket = frame.ticket; if (client.sentAt !== null && client.ackAt === null) client.ackAt = performance.now(); }
  if (frame.type === 'arena.error') client.errors.push(frame.code);
 });
 }); }
async function capacityProbe() { return new Promise((resolve, reject) => {
 const req = request(`${base}/arena`, { headers: { Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'bG9jYWwtdGVzdC1vbmx5IQ==', 'Sec-WebSocket-Version': '13' } });
 req.setTimeout(10000, () => req.destroy(new Error('CAPACITY_PROBE_TIMEOUT'))); req.on('error', reject); req.on('response', res => { res.resume(); resolve(res.statusCode); }); req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); }); req.end();
 }); }
const percentile = (sorted, quantile) => sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
try {
 await until(async () => { try { return (await fetch(`${base}/ready`)).ok; } catch { return false; } });
 const joinStart = performance.now();
 for (let count = 0; count < socketCount; count += 16) await Promise.all(Array.from({ length: 16 }, connect));
 const joinMs = performance.now() - joinStart;
 assert.equal(clients.length, socketCount); assert.ok(clients.every(c => c.balance === 100000));
 assert.equal(await capacityProbe(), 503);
 const previousRound = clients[0].round.roundId;
 await until(() => clients.every(c => c.round?.phase === 'open' && c.round.roundId !== previousRound && c.round.roundId === clients[0].round.roundId), 40000);
 const round = clients[0].round, startedAt = performance.now();
 for (const [index, client] of clients.slice(0, bettorCount).entries()) {
  client.sentAt = performance.now(); client.clientId = randomUUID(); client.side = index % 2 ? 'ayaz' : 'kor';
  const bet = { type: 'bet', clientId: client.clientId, roundId: round.roundId, side: client.side, amountCents: 1000 };
  send(client, bet); send(client, bet); // Same-key concurrent retries may acknowledge, never debit twice.
 }
 await until(() => clients.slice(0, bettorCount).every(c => c.ackAt !== null || c.errors.length > 0), 12000);
 const uniqueAccepted = clients.slice(0, bettorCount).filter(c => c.ticket?.clientId === c.clientId).length;
 const latencies = clients.slice(0, bettorCount).filter(c => c.ackAt !== null).map(c => c.ackAt - c.sentAt).sort((a, b) => a - b);
 const acceptedInWindow = clients.slice(0, bettorCount).filter(c => c.ackAt !== null && c.ackAt - startedAt < 5000).length;
 await until(() => clients.every(c => c.round.phase === 'fighting'));
 const winner = clients[0].round.winner; assert.ok(clients.every(c => c.round.winner === winner));
 for (const client of clients.slice(bettorCount, bettorCount + lateCount)) send(client, { type: 'bet', clientId: randomUUID(), roundId: round.roundId, side: 'kor', amountCents: 1000 });
 await until(() => clients.slice(bettorCount, bettorCount + lateCount).every(c => c.errors.includes('ROUND_CLOSED')));
 await until(() => clients.slice(0, bettorCount).filter(c => c.ticket).every(c => c.ticket.status === 'settled'));
 const stats = await (await fetch(`${base}/__stats`)).json();
 const expectedPayout = clients.slice(0, bettorCount).filter(c => c.ticket && c.side === winner).length * 1960;
 const noOverspend = clients.slice(0, bettorCount).every(c => c.balance === 100000 - (c.ticket ? 1000 : 0) + (c.ticket && c.side === winner ? 1960 : 0));
 const noLateDebit = clients.slice(bettorCount).every(c => c.balance === 100000);
 const aggregateExact = stats.sessions.n === 256 && stats.tickets.n === uniqueAccepted && stats.tickets.pending === 0 && stats.tickets.settled === uniqueAccepted && stats.tickets.stakes === uniqueAccepted * 1000 && stats.tickets.payouts === expectedPayout && stats.sessions.balance === 256 * 100000 - uniqueAccepted * 1000 + expectedPayout;
 report = { at: new Date().toISOString(), status: uniqueAccepted === bettorCount && acceptedInWindow === bettorCount && noOverspend && noLateDebit && aggregateExact && !protocolFailure && closedSockets === 0 ? 'PASS_BOUNDED_LOCAL_TARGET' : 'TARGET_NOT_MET', runtime: { node: process.version, platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3), wrangler: '4.145.0', engine: 'local workerd SQLite' }, sockets: { connected: clients.length, capacity: 256, nextConnectionStatus: 503, unexpectedlyClosed: closedSockets, admissionMs: Math.round(joinMs) }, round: { id: round.roundId, betWindowMs: 5000, sameWinnerForAll: true }, bets: { independentPlayers: bettorCount, requestFramesIncludingRetries: bettorCount * 2, uniqueAccepted, acknowledgedWithinFiveSeconds: acceptedInWindow, lateAttempts: lateCount, lateRejected: lateCount }, acknowledgementLatencyMs: { p50: Math.round(percentile(latencies, .50)), p95: Math.round(percentile(latencies, .95)), max: Math.round(latencies.at(-1) ?? 0) }, ledger: { aggregateExact, noOverspend, noLateDebit, tickets: stats.tickets.n, settled: stats.tickets.settled, totalStakeCents: stats.tickets.stakes, totalGrossPayoutCents: stats.tickets.payouts, finalAggregateBalanceCents: stats.sessions.balance }, allServerFramesValid: !protocolFailure, scope: 'One localhost machine and one Durable Object. Native workerd, real CSPRNG and SQLite; read-only aggregate fixture only. 256 authenticated anonymous-demo sessions, not wallets; resettable credits. No cloud load, paid services, financial transactions, global geography, sustained soak, reconnect storm or thousands-of-users claim.' };
 await mkdir(resolve(root, 'apps/realtime/evidence'), { recursive: true }); await writeFile(resolve(root, 'apps/realtime/evidence/local-live-arena-stress.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
 assert.equal(report.status, 'PASS_BOUNDED_LOCAL_TARGET');
} catch (error) { console.error('LOCAL_ARENA_STRESS_FAILED', error.message); if (!report) console.error(logs.slice(-4000)); process.exitCode = 1; }
finally { for (const c of clients) { try { c.ws.close(); } catch {} } child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), wait(5000)]); }
