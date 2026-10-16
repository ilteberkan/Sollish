/** Local load test of the DEMO slot service (RGS) through the production router (src/index.ts) on `wrangler dev` (workerd +
 * SQLite Durable Objects). No cloud, wallet, Supabase, money or real asset. Signing key is a local fixture value.
 *
 * N virtual players, each: POST /v1/slots/session (own fake CF-Connecting-IP so the per-IP session gate does not hide the
 * spin path), then spins in a closed loop at a target rate with ONE request in flight per session and a fresh
 * idempotencyKey per round. 409 SESSION_BUSY / 429 / 5xx / network errors are retried with the SAME key and body (the
 * production client rule), so a retry can never debit twice. After the run every session is checked:
 *   balance(server) == 100000 - sum(cost) + sum(payout) of the receipts this client accepted, receipt nonces 0..n-1,
 *   and a sample of keys re-sent returns the same bytes with Idempotent-Replayed: true.
 * The observed-RTP monitor (session -> shard -> global) is read at the end through a local-only /__monitor route.
 *
 * Usage (repo root): bash scripts/use-node.sh pnpm --filter @sollish/realtime loadtest:slots -- \
 *   --players 200 --seconds 20 --rate 3 [--out ops/evidence/scale-20261016/slot-load-200.json] [--port 18894]
 * Local workerd runs every Durable Object in ONE process, so this measures per-request cost and correctness under
 * concurrency on this machine; it is not a measurement of Cloudflare's distributed capacity.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { SLOT_GAMES } from '@sollish/protocol';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a !== '--').reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : acc), []));
const PLAYERS = Number(args.players ?? 100), SECONDS = Number(args.seconds ?? 15), RATE = Number(args.rate ?? 3), PORT = Number(args.port ?? 18894);
const GAMES = (args.games ?? 'cascade,tarhun,ebru,cezeri,asena').split(',');
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const folder = resolve(root, '.tooling/slot-load');
const stateDir = args.state ? resolve(args.state) : resolve(folder, 'state');
const base = `http://127.0.0.1:${PORT}`, origin = 'http://localhost:3000';
const KEY = 'local-fixture-only-slot-load-signing-key-000000000';

await mkdir(folder, { recursive: true });
await rm(stateDir, { recursive: true, force: true });
const src = p => JSON.stringify(resolve(root, 'apps/realtime/src', p));
await writeFile(resolve(folder, 'entry.ts'), `import main from ${src('index.ts')};
export * from ${src('index.ts')};
export default { async fetch(r, env, ctx) {
 const url = new URL(r.url);
 if (url.pathname === '/ready') return new Response('ready');
 if (url.pathname === '/__monitor') return env.SLOT_MONITOR.get(env.SLOT_MONITOR.idFromName('global')).fetch('https://probe/stats');
 return main.fetch(r, env, ctx);
} };`);
await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify({ name: 'sollish-slot-load-local', main: resolve(folder, 'entry.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'],
  vars: { ALLOWED_ORIGINS: origin, SLOTS_ENABLED: 'true', SLOT_SIGNING_KEY: KEY },
  durable_objects: { bindings: [{ name: 'ADMISSION', class_name: 'AdmissionGate' }, { name: 'SLOT_WALLET', class_name: 'SlotWallet' }, { name: 'SLOT_REPLAY', class_name: 'SlotReplay' }, { name: 'SLOT_MONITOR', class_name: 'SlotMonitor' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['AdmissionGate', 'SlotWallet', 'SlotReplay', 'SlotMonitor'] }] }));

const wait = ms => new Promise(r => setTimeout(r, ms));
let logs = '';
const child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', stateDir, '--log-level', 'warn', '--show-interactive-dev-session=false'],
  { cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (const s of [child.stdout, child.stderr]) s.on('data', b => { logs = (logs + b).slice(-100000); });
const stop = async () => { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), wait(6000)]); };

/** CPU seconds (user+system) of the wrangler child's process tree, split into workerd and the rest (Linux /proc only). */
async function treeCpu() {
  const { readdir, readFile } = await import('node:fs/promises');
  const procs = new Map();
  for (const pid of await readdir('/proc').catch(() => [])) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8'), close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(' ');
      procs.set(Number(pid), { name: stat.slice(stat.indexOf('(') + 1, close), ppid: Number(fields[1]), cpu: (Number(fields[11]) + Number(fields[12])) / 100 });
    } catch { /* exited */ }
  }
  const tree = new Set([child.pid]);
  for (let grew = true; grew;) { grew = false; for (const [pid, p] of procs) if (!tree.has(pid) && tree.has(p.ppid)) { tree.add(pid); grew = true; } }
  let workerd = 0, other = 0;
  for (const pid of tree) { const p = procs.get(pid); if (!p) continue; if (p.name.includes('workerd')) workerd += p.cpu; else other += p.cpu; }
  return { workerd, other };
}
const hex = n => randomBytes(n).toString('hex');
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))] : null;
const summary = list => { const s = [...list].sort((a, b) => a - b); return { n: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.at(-1) ?? null, mean: s.length ? Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)) : null }; };
async function api(method, path, { token, body, ip } = {}) {
  const headers = { Origin: origin, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { 'CF-Connecting-IP': ip } : {}) };
  const t0 = performance.now();
  try {
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, text, ms: performance.now() - t0, retryAfter: Number(res.headers.get('Retry-After') ?? 0), replayed: res.headers.get('Idempotent-Replayed') === 'true' };
  } catch (error) { return { status: 0, text: String(error?.cause?.code ?? error?.message ?? error), ms: performance.now() - t0, retryAfter: 0 }; }
}
const codeOf = r => { try { return JSON.parse(r.text).code ?? String(r.status); } catch { return r.status === 0 ? `NETWORK:${r.text}` : String(r.status); } };

const report = { at: new Date().toISOString(), runtime: 'wrangler dev (local workerd + SQLite DO), production router src/index.ts', machine: { cpus: os.cpus().length, model: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30), node: process.version },
  config: { stateDir: args.state ? 'custom (see --state)' : '.tooling/slot-load/state', players: PLAYERS, seconds: SECONDS, targetRatePerPlayer: RATE, games: GAMES, betCents: 100, mode: 'standard', monitorFlushMs: 30000, monitorRollupMs: 5000, monitorShards: 64, note: 'production defaults' } };
try {
  const end0 = Date.now() + 60000;
  while (Date.now() < end0) { try { if ((await fetch(`${base}/ready`)).ok) break; } catch { /* booting */ } await wait(100); }
  // Warm-up: one session + one round (first-request compile/migration cost is reported separately, not in the run).
  const warm = await api('POST', '/v1/slots/session', { body: {}, ip: '198.51.100.250' });
  const warmToken = JSON.parse(warm.text).token;
  const warmRound = await api('POST', '/v1/slots/cascade/rounds', { token: warmToken, body: { betCents: 100, mode: 'standard', clientSeed: 'warm', idempotencyKey: hex(16) } });
  report.warmup = { sessionMs: Math.round(warm.ms), roundMs: Math.round(warmRound.ms), roundStatus: warmRound.status };

  // Sessions (each player its own documentation-range IP).
  const sessionMs = [], sessionErrors = {};
  const players = [];
  const t0 = performance.now();
  await Promise.all(Array.from({ length: PLAYERS }, async (_, i) => {
    const ip = `198.18.${(i >> 8) & 255}.${i & 255}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await api('POST', '/v1/slots/session', { body: {}, ip });
      sessionMs.push(r.ms);
      if (r.status === 201) { const j = JSON.parse(r.text); players.push({ i, token: j.token, game: GAMES[i % GAMES.length], start: j.balanceCents, receipts: [], keys: [] }); return; }
      sessionErrors[codeOf(r)] = (sessionErrors[codeOf(r)] ?? 0) + 1; await wait(200);
    }
  }));
  report.sessions = { created: players.length, wallMs: Math.round(performance.now() - t0), latencyMs: summary(sessionMs), errors: sessionErrors };

  // Spin phase.
  const roundMs = [], firstTryMs = [], codes = {}, samples = []; let attempts = 0, retries = 0, accepted = 0, gaveUp = 0, firstOk = 0;
  const runUntil = performance.now() + SECONDS * 1000, interval = 1000 / RATE;
  const startedAt = performance.now(), cpuBefore = await treeCpu();
  const timeline = new Map();
  await Promise.all(players.map(async p => {
    await wait(Math.random() * interval); // spread starts
    let next = performance.now();
    while (performance.now() < runUntil) {
      const body = { betCents: 100, mode: 'standard', clientSeed: hex(8), idempotencyKey: hex(16) };
      const begin = performance.now();
      let ok = null;
      for (let attempt = 0; attempt < 6 && !ok; attempt++) {
        attempts++; if (attempt) retries++;
        const r = await api('POST', `/v1/slots/${p.game}/rounds`, { token: p.token, body });
        if (attempt === 0) { firstTryMs.push(r.ms); if (r.status === 200) firstOk++; }
        const c = r.status === 200 ? 'OK' : codeOf(r);
        codes[c] = (codes[c] ?? 0) + 1;
        if (r.status !== 200 && samples.length < 5) samples.push({ status: r.status, body: r.text.slice(0, 300) });
        if (r.status === 200) { ok = r; break; }
        if (r.status === 409 && c === 'INSUFFICIENT_BALANCE') break;
        if (![0, 409, 429, 500, 502, 503].includes(r.status)) break;
        await wait(Math.max(50, (r.retryAfter || 0.25) * 1000 * (r.status === 429 ? 1 : 0.25)));
      }
      if (ok) {
        const receipt = JSON.parse(ok.text);
        p.receipts.push({ cost: receipt.costCents, payout: receipt.payoutCents, nonce: receipt.fair.nonce, balance: receipt.balanceCents });
        p.keys.push({ body, text: ok.text });
        roundMs.push(performance.now() - begin); accepted++;
        const second = Math.floor((performance.now() - startedAt) / 1000); timeline.set(second, (timeline.get(second) ?? 0) + 1);
      } else gaveUp++;
      next += interval;
      const sleep = next - performance.now();
      if (sleep > 0) await wait(sleep); else next = performance.now();
    }
  }));
  const spinWall = (performance.now() - startedAt) / 1000, cpuAfter = await treeCpu();
  const workerdCpu = cpuAfter.workerd - cpuBefore.workerd, wranglerCpu = cpuAfter.other - cpuBefore.other;
  report.spins = {
    acceptedRounds: accepted, wallSeconds: Number(spinWall.toFixed(2)), throughputRoundsPerSecond: Number((accepted / spinWall).toFixed(1)),
    offeredRoundsPerSecond: Number((players.length * RATE).toFixed(1)), attempts, retries, gaveUp,
    firstTryNonOkRate: Number((1 - firstOk / Math.max(1, firstTryMs.length)).toFixed(4)), finalErrorRate: Number((gaveUp / Math.max(1, accepted + gaveUp)).toFixed(4)),
    responses: codes, nonOkSamples: samples, latencyFirstTryMs: summary(firstTryMs), latencyAcceptedIncludingRetriesMs: summary(roundMs),
    cpu: { workerdSeconds: Number(workerdCpu.toFixed(2)), wranglerNodeSeconds: Number(wranglerCpu.toFixed(2)), workerdCoresBusy: Number((workerdCpu / spinWall).toFixed(2)), workerdCpuMsPerAcceptedRound: accepted ? Number((workerdCpu * 1000 / accepted).toFixed(2)) : null, note: 'includes router, token HMAC, DO SQLite commit, engine run, receipt HMAC, monitor flushes and local dev proxy overhead' },
    perSecond: Array.from({ length: Math.ceil(spinWall) }, (_, i) => timeline.get(i) ?? 0),
  };

  // Correctness after load: balances, nonces, idempotent replays.
  let balanceOk = 0, nonceOk = 0, replayOk = 0, replayChecked = 0; const mismatches = [];
  for (const p of players) {
    const s = await api('GET', '/v1/slots/session', { token: p.token });
    const state = JSON.parse(s.text);
    const expected = p.start - p.receipts.reduce((a, r) => a + r.cost, 0) + p.receipts.reduce((a, r) => a + r.payout, 0);
    if (state.balanceCents === expected) balanceOk++; else mismatches.push({ player: p.i, server: state.balanceCents, expected });
    if (p.receipts.every((r, i) => r.nonce === i) && state.nonce === p.receipts.length) nonceOk++; else mismatches.push({ player: p.i, nonces: p.receipts.map(r => r.nonce).slice(0, 5), serverNonce: state.nonce });
    for (const k of p.keys.slice(0, 2)) {
      replayChecked++;
      const again = await api('POST', `/v1/slots/${p.game}/rounds`, { token: p.token, body: k.body });
      if (again.status === 200 && again.replayed && again.text === k.text) replayOk++;
    }
  }
  report.correctness = { sessions: players.length, balanceMatches: balanceOk, nonceSequencesIntact: nonceOk, idempotentReplaysChecked: replayChecked, idempotentReplaysSameBytes: replayOk, mismatches: mismatches.slice(0, 10) };

  // Monitor rollup: global rounds should reach the accepted count (+ warm-up), at least once (can exceed on lost acks).
  const want = accepted + 1;
  let monitor = null; const mEnd = Date.now() + 60000; // flush 30 s + rollup 5 s (production defaults)
  while (Date.now() < mEnd) {
    try { const m = await (await fetch(`${base}/__monitor`)).json(); const total = m.stats.reduce((a, r) => a + r.rounds, 0); monitor = { rounds: total, rows: m.stats.length }; if (total >= want) break; } catch { /* retry */ }
    await wait(500);
  }
  report.monitor = { expectedAtLeast: want, globalRounds: monitor?.rounds ?? null, reached: (monitor?.rounds ?? 0) >= want, path: 'SlotWallet -> shard:<k> (64) -> global' };
  report.pass = report.correctness.balanceMatches === players.length && report.correctness.nonceSequencesIntact === players.length && replayOk === replayChecked && report.monitor.reached && players.length === PLAYERS;
  report.scope = 'Local only: one workerd process on this container runs the Worker and every Durable Object. Measures per-request cost and correctness (idempotency, one-in-flight, ledger conservation, monitor rollup) under concurrency; not hosted, not multi-region, not Cloudflare capacity.';
  if (args.out) { await mkdir(resolve(process.cwd(), args.out, '..'), { recursive: true }); await writeFile(resolve(process.cwd(), args.out), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} catch (error) { console.error('SLOT_LOAD_FAILED', error.stack ?? error.message); console.error(logs.slice(-6000)); process.exitCode = 1; }
finally { await stop(); }
