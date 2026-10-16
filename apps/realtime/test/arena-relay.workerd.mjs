/** Local fan-out test of the Ringside LIVE viewer relays (src/arena-relay.ts) through the production router
 * (src/index.ts) on `wrangler dev` (workerd, real ContactArenaV5 + ArenaRelay Durable Objects, hibernatable WebSockets).
 * No cloud, Jev disabled (deterministic fallback plans), DEMO credits only.
 *
 * V viewers connect to /v5/arena/ringside/watch (spread over LIVE_RELAYS relays), B bettors connect to the root
 * /v5/arena/ringside and place match bets in the opening window; every accepted ticket makes the root broadcast.
 * Measured: delay from the root socket receiving snapshot revision r to each viewer receiving r (same Node clock),
 * how many revisions the 250 ms latest-only coalescing skipped, late-joiner snapshot = root's latest, viewer sockets
 * read-only (a bet frame sent by a viewer creates no ticket; > 20 messages/min closes), ledger unchanged by viewers.
 * Usage (repo root): bash scripts/use-node.sh pnpm --filter @sollish/realtime test:relay -- [--viewers 2000] [--relays 4] [--out file]
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

const argv = process.argv.slice(2).filter(a => a !== '--');
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const VIEWERS = Number(arg('viewers', 2000)), RELAYS = Number(arg('relays', 4)), BETTORS = Number(arg('bettors', 40)), OUT = arg('out', null);
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const folder = resolve(root, '.tooling/arena-relay-integration');
const port = 18895, origin = 'http://localhost:3000';
await mkdir(folder, { recursive: true });
await rm(resolve(folder, 'state'), { recursive: true, force: true });
const src = p => JSON.stringify(resolve(root, 'apps/realtime/src', p));
await writeFile(resolve(folder, 'entry.ts'), `import main from ${src('index.ts')};
export * from ${src('index.ts')};
export default { async fetch(r, env, ctx) {
 const url = new URL(r.url);
 if (url.pathname === '/ready') return new Response('ready');
 if (url.pathname === '/__tickets') return env.CONTACT_ARENA_V5.get(env.CONTACT_ARENA_V5.idFromName('ringside-match-v1')).fetch('https://internal/relay/sync', { method: 'POST' });
 return main.fetch(r, env, ctx);
} };`);
await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify({ name: 'sollish-arena-relay-local', main: resolve(folder, 'entry.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'],
  vars: { ALLOWED_ORIGINS: origin, LIVE_ARENA_ENABLED: 'true', DECISION_AGENT_ENABLED: 'false', LIVE_RELAYS: String(RELAYS), LIVE_RELAY_SOCKETS: String(Math.ceil(VIEWERS / RELAYS) + 400) },
  durable_objects: { bindings: [{ name: 'ADMISSION', class_name: 'AdmissionGate' }, { name: 'CONTACT_ARENA_V5', class_name: 'ContactArenaV5' }, { name: 'ARENA_RELAY', class_name: 'ArenaRelay' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['AdmissionGate', 'ContactArenaV5', 'ArenaRelay'] }] }));

const wait = ms => new Promise(r => setTimeout(r, ms));
let logs = '';
const child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', resolve(folder, 'state'), '--log-level', 'warn', '--show-interactive-dev-session=false'],
  { cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (const s of [child.stdout, child.stderr]) s.on('data', b => { logs = (logs + b).slice(-60000); });
const stop = async () => { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), wait(6000)]); };
async function until(fn, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(20); } throw new Error('RELAY_TEST_TIMEOUT'); }
const pct = (s, p) => s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : null;
const summary = list => { const s = [...list].sort((a, b) => a - b); return { n: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.at(-1) ?? null }; };
const round2 = o => JSON.parse(JSON.stringify(o, (_, v) => typeof v === 'number' ? Number(v.toFixed(1)) : v));

function open(path, ip) {
  const c = { ws: new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Origin: origin, 'CF-Connecting-IP': ip } }), revs: new Map(), last: null, closed: null, frames: [] };
  c.ws.addEventListener('message', e => {
    const t = performance.now(), f = JSON.parse(String(e.data));
    c.frames.push(f.type);
    if (f.type === 'snapshot') { if (!c.revs.has(f.revision)) c.revs.set(f.revision, t); c.last = f; }
    if (f.type === 'ticket') c.ticket = f.ticket;
    if (f.type === 'error') c.error = f.code;
  });
  c.ws.addEventListener('close', e => { c.closed = e.code; });
  c.opened = new Promise((res, rej) => { c.ws.addEventListener('open', res, { once: true }); c.ws.addEventListener('error', rej, { once: true }); });
  return c;
}
const report = { at: new Date().toISOString(), runtime: 'wrangler dev (local workerd), production router, ContactArenaV5 root + ArenaRelay', machine: { cpus: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30) }, config: { viewers: VIEWERS, relays: RELAYS, bettors: BETTORS, minIntervalMs: 250 }, checks: [] };
try {
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/ready`)).ok; } catch { return false; } }, 60000);
  // Watch is refused without the upgrade, with a query, and from a foreign origin.
  assert.equal((await fetch(`http://127.0.0.1:${port}/v5/arena/ringside/watch`, { headers: { Origin: origin } })).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/v5/arena/ringside/watch`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  report.checks.push('watch: no-upgrade 400, foreign origin 403');

  // Viewers first (each its own documentation-range IP for the per-IP admission gate).
  const t0 = performance.now();
  const viewers = [];
  for (let i = 0; i < VIEWERS; i += 200) {
    // 25 viewers per documentation-range IP (the per-IP gate admits 30 connections a minute).
    const batch = Array.from({ length: Math.min(200, VIEWERS - i) }, (_, j) => open('/v5/arena/ringside/watch', `198.18.${(Math.floor((i + j) / 25) >> 8) & 255}.${Math.floor((i + j) / 25) & 255}`));
    await Promise.all(batch.map(c => c.opened)); viewers.push(...batch);
  }
  await until(() => viewers.every(v => v.last), 60000);
  report.connect = { viewers: viewers.length, wallMs: Math.round(performance.now() - t0) };
  report.checks.push(`${viewers.length} viewers connected through ${RELAYS} relays; each received an initial snapshot`);

  // Root clients: each creates a DEMO session (the root broadcasts on every new session, at any phase) and, if the
  // match's betting window is still open, places one bet per market (another broadcast each). Sequential, 60 ms apart.
  const bettors = Array.from({ length: BETTORS }, (_, i) => open('/v5/arena/ringside', `198.19.0.${Math.floor(i / 20) + 1}`));
  await Promise.all(bettors.map(c => c.opened));
  await until(() => bettors.every(b => b.last));
  const revBefore = Math.min(...bettors.map(b => b.last.revision));
  for (const b of bettors) { b.ws.send(JSON.stringify({ v: 2, type: 'session' })); await until(() => b.frames.includes('session')); await wait(60); }
  const round = bettors[0].last.round, ledger = round.bout.id;
  const markets = [['match-winner', ['kor', 'draw', 'ayaz']], ['match-method', ['kor-stop', 'kor-points', 'draw', 'ayaz-points', 'ayaz-stop']], ['match-knockdowns', ['0-1', '2', '3-plus']]];
  let placed = 0, closed = 0;
  if (round.phase === 'open' && round.bout.round === 1) for (const [market, outcomes] of markets) for (const [i, b] of bettors.slice(0, 12).entries()) {
    b.ticket = null; b.error = null;
    b.ws.send(JSON.stringify({ v: 2, type: 'bet', id: randomUUID(), roundId: ledger, market, outcome: outcomes[i % outcomes.length], amount: 100 + i }));
    await until(() => b.ticket || b.error);
    if (b.ticket) placed++; else if (b.error === 'ROUND_CLOSED') closed++; else throw new Error(b.error);
    await wait(60);
  }
  report.rootTraffic = { sessions: bettors.length, ticketsPlaced: placed, refusedClosedWindow: closed, phaseAtStart: round.phase };
  // A viewer trying to bet: read-only, no ticket, no error frame, no ledger change.
  const rogue = viewers[0];
  rogue.ws.send(JSON.stringify({ v: 2, type: 'bet', id: randomUUID(), roundId: ledger, market: 'match-winner', outcome: 'kor', amount: 100 }));
  await wait(1500);
  const rootLatest = Math.max(...bettors.map(b => b.last.revision));
  await until(() => viewers.every(v => v.last.revision >= rootLatest), 30000);
  const sync = await (await fetch(`http://127.0.0.1:${port}/__tickets`, { method: 'POST' })).json();
  assert.equal(sync.count, placed, 'only bettor tickets in the ledger'); assert.ok(!rogue.ticket);
  report.checks.push(`${bettors.length} root sessions, ${placed} root tickets; viewer bet frame created no ticket; every viewer reached root revision ${rootLatest}`);

  // Fan-out delay per revision: earliest root arrival -> each viewer arrival.
  const rootAt = new Map();
  for (const b of bettors) for (const [rev, t] of b.revs) if (rev > revBefore && (!rootAt.has(rev) || t < rootAt.get(rev))) rootAt.set(rev, t);
  const delays = [], perRelaySkipped = [];
  let delivered = 0, skipped = 0;
  // "Caught up" delay: root got revision r at t; the viewer is current once it holds any revision >= r (coalescing may
  // skip r itself, the newer full snapshot supersedes it).
  const caught = [];
  for (const v of viewers) {
    const seen = [...v.revs.entries()].sort((x, y) => x[0] - y[0]);
    for (const [rev, t] of rootAt) {
      const at = v.revs.get(rev); if (at === undefined) skipped++; else { delivered++; delays.push(at - t); }
      const first = seen.filter(([r]) => r >= rev).reduce((m, [, ts]) => Math.min(m, ts), Infinity);
      if (Number.isFinite(first)) caught.push(Math.max(0, first - t));
    }
  }
  report.fanout = { rootRevisions: rootAt.size, viewerDeliveries: delivered, coalescedSkips: skipped, caughtUpDelayMs: round2(summary(caught)), exactRevisionDelayMs: round2(summary(delays)), finalRevisionDelayMs: round2(summary(viewers.map(v => v.revs.get(rootLatest) - rootAt.get(rootLatest)).filter(Number.isFinite))) };

  // Late joiner gets the latest snapshot at once.
  const late = open('/v5/arena/ringside/watch', '198.18.250.250'); await late.opened;
  const lateStart = performance.now(); await until(() => late.last);
  assert.equal(late.last.revision, rootLatest);
  report.lateJoiner = { firstSnapshotMs: Number((performance.now() - lateStart).toFixed(1)), revision: late.last.revision };
  report.checks.push('late joiner received the root\'s latest revision immediately');

  // Spam from a viewer closes only that socket.
  for (let i = 0; i < 25; i++) late.ws.send('{"v":2,"type":"sync"}');
  await until(() => late.closed !== null, 10000);
  assert.equal(late.closed, 1008);
  report.checks.push('viewer > 20 messages/min closed with 1008');

  report.pass = true;
  for (const c of [...viewers, ...bettors]) try { c.ws.close(); } catch { /* closed */ }
} catch (error) { report.pass = false; report.error = String(error.stack ?? error); console.error(logs.slice(-6000)); process.exitCode = 1; }
finally {
  report.scope = 'Local only: one workerd process, one Node client process on this container. Shows the relay tier delivers ordered, read-only, coalesced snapshots to thousands of hibernatable sockets and never touches the ledger; not hosted, not multi-colo, not a Cloudflare capacity number.';
  if (OUT) await writeFile(resolve(process.cwd(), OUT), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await stop();
}
