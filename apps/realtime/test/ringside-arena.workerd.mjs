/** Real local workerd/SQLite/WebSocket checks. The generated subclass alone owns a test clock,
 * read-only inspection and SQL failure triggers; production has no time/result/admin fixture API.
 * No cloud deployment, wallet, SOL, externally supplied result or fabricated public wager data.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parseRingServer, RINGSIDE_MARKETS, RINGSIDE_OPEN_MS, COMBAT_DURATION_MS, RINGSIDE_RESULT_MS, ringCommitmentInput, combatResults, simulateCombat } from '@sollish/protocol';

// pnpm exec does not forward SIGTERM to wrangler/workerd in every environment: signal the whole process group.
const killTree = c => { try { process.kill(-c.pid, 'SIGTERM'); } catch { c.kill('SIGTERM'); } };
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const folder = resolve(root, '.tooling/ringside-arena-integration');
const port = 18886, base = `http://127.0.0.1:${port}`, origin = 'http://localhost:3000';
// A future fixed clock keeps workerd's real scheduler from racing our explicit alarm invocations.
const firstTime = Date.now() + 86_400_000;
await mkdir(folder, { recursive: true });
const entry = `import { RingsideArena } from ${JSON.stringify(resolve(root, 'apps/realtime/src/ringside-arena.ts'))};
let fixtureNow=${firstTime};Date.now=()=>fixtureNow;
export class ProbeRingside extends RingsideArena {
 constructor(ctx,env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_clock(id INTEGER PRIMARY KEY, at INTEGER NOT NULL)');ctx.storage.sql.exec('INSERT OR IGNORE INTO fixture_clock VALUES(1,?)',fixtureNow);fixtureNow=ctx.storage.sql.exec('SELECT at FROM fixture_clock WHERE id=1').one().at;}
 async fetch(r){const u=new URL(r.url),path=u.pathname;
  if(path==='/__inspect')return Response.json({at:fixtureNow,round:this.ctx.storage.sql.exec('SELECT body FROM ring_round WHERE id=1').toArray().map(x=>JSON.parse(x.body).public)[0]??null,sessions:this.ctx.storage.sql.exec('SELECT * FROM ring_sessions ORDER BY id').toArray(),tickets:this.ctx.storage.sql.exec('SELECT * FROM ring_tickets ORDER BY seq').toArray(),fees:this.ctx.storage.sql.exec('SELECT * FROM ring_fees ORDER BY round,market').toArray()});
  if(path==='/__clock'){const at=Number(u.searchParams.get('at'));if(!Number.isSafeInteger(at)||at<0)return new Response('invalid',{status:400});fixtureNow=at;this.ctx.storage.sql.exec('UPDATE fixture_clock SET at=? WHERE id=1',at);await this.ctx.storage.sync();try{await super.alarm();return new Response('ok');}catch{return new Response('EXPECTED_LOCAL_STORAGE_FAILURE',{status:500});}}
  if(path==='/__fail-debit'){this.ctx.storage.sql.exec("CREATE TRIGGER fixture_fail BEFORE UPDATE OF balance ON ring_sessions BEGIN SELECT RAISE(ABORT,'local debit failure'); END");return new Response('ok');}
  if(path==='/__fail-settlement'){this.ctx.storage.sql.exec("CREATE TRIGGER fixture_fail BEFORE INSERT ON ring_fees WHEN NEW.market='first-hit' BEGIN SELECT RAISE(ABORT,'local settlement failure'); END");return new Response('ok');}
  if(path==='/__restore'){this.ctx.storage.sql.exec('DROP TRIGGER fixture_fail');return new Response('ok');}
  return super.fetch(r);
 }
}
export default {fetch(r,env){if(new URL(r.url).pathname==='/ready')return new Response('ready');return env.ARENA.get(env.ARENA.idFromName('ringside-v2')).fetch(r);}};`;
await writeFile(resolve(folder, 'entry.ts'), entry);
await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify({ name: 'sollish-ringside-local-test', main: resolve(folder, 'entry.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], vars: { ALLOWED_ORIGINS: origin, LIVE_ARENA_ENABLED: 'true' }, durable_objects: { bindings: [{ name: 'ARENA', class_name: 'ProbeRingside' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['ProbeRingside'] }] }));
await rm(resolve(folder, 'state'), { recursive: true, force: true });
let child, logs = '', invalidFrame = null;
const checks = [], sockets = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 12_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (invalidFrame) throw new Error('INVALID_SERVER_FRAME: ' + invalidFrame); const value = await fn(); if (value) return value; await wait(15); } throw new Error('RINGSIDE_TEST_TIMEOUT'); }
async function start() {
 child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', resolve(folder, 'state'), '--show-interactive-dev-session=false'], { detached: true, cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
 for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { logs = (logs + b).slice(-30_000); });
 await until(async () => { try { return (await fetch(`${base}/ready`)).ok; } catch { return false; } }, 30_000);
}
async function stop() {
 for (const c of sockets) { try { c.ws.close(); } catch {} }
 if (!child) return;
 const stopped = new Promise(r => child.once('exit', r)); killTree(child); await Promise.race([stopped, wait(5_000)]); child = null;
}
async function control(path) { const response = await fetch(base + path); assert.ok(response.ok, `${path}: HTTP ${response.status}`); return response; }
const inspect = async () => (await control('/__inspect')).json();
const clock = async at => control(`/__clock?at=${at}`);
const latest = (c, type) => c.frames.findLast(f => f.type === type);
const receipts = (c, id) => c.frames.filter(f => f.type === 'ticket' && f.ticket.id === id);
const send = (c, f) => c.ws.send(JSON.stringify({ v: 2, ...f }));
async function sync(c) { const before = c.frames.length; send(c, { type: 'sync' }); await until(() => c.frames.slice(before).some(f => f.type === 'session')); return latest(c, 'session'); }
async function error(c, f, code) { const before = c.frames.length; send(c, f); await until(() => c.frames.slice(before).some(m => m.type === 'error' && m.code === code)); }
async function bet(c, command) { const before = receipts(c, command.id).length; send(c, command); await until(() => receipts(c, command.id).length > before); return receipts(c, command.id).at(-1).ticket; }
async function connect(token, authenticate = true) {
 const c = { ws: new WebSocket(`ws://127.0.0.1:${port}/arena`, { headers: { Origin: origin } }), frames: [], token };
 sockets.push(c); let connected = false, failure = false;
 c.ws.addEventListener('error', () => { failure = true; });
 c.ws.addEventListener('message', e => {
  const raw = String(e.data), frame = parseRingServer(raw);
  if (!frame) { invalidFrame = raw.slice(0, 1200); return; }
  c.frames.push(frame);
  if (frame.type === 'snapshot' && !connected) { connected = true; if (authenticate) send(c, { type: 'session', ...(token ? { token } : {}) }); }
  if (frame.type === 'session' && frame.token) c.token = frame.token;
 });
 await until(() => { if (failure) throw new Error('RINGSIDE_CONNECT_FAILED'); return authenticate ? latest(c, 'session') : connected; });
 return c;
}
const balances = state => state.sessions.reduce((sum, s) => sum + s.balance, 0);
const escrow = state => state.tickets.filter(t => t.status === 'accepted').reduce((sum, t) => sum + t.amount, 0);
const fees = state => state.fees.reduce((sum, f) => sum + f.fee, 0);
const conserved = (state, granted) => assert.equal(balances(state) + escrow(state) + fees(state), granted, 'balances + unspent escrow + recorded fees conserve grants');
const unchangedMoney = state => ({ sessions: state.sessions, tickets: state.tickets, fees: state.fees });

try {
 await start();
 assert.equal((await fetch(`${base}/arena`, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
 assert.equal((await fetch(`${base}/arena?token=not-allowed`, { headers: { Origin: origin } })).status, 400);
 checks.push('origin and URL credential rejection');
 const a = await connect(), b = await connect(), a2 = await connect(a.token);
 assert.match(a.token, /^[0-9a-f]{64}$/); assert.notEqual(a.token, b.token);
 await until(() => latest(a, 'snapshot').online === 2);
 const opening = latest(a, 'snapshot').round;
 assert.equal(opening.closesAt - opening.openedAt, RINGSIDE_OPEN_MS); assert.equal(opening.seed, null); assert.equal(opening.results, null);
 assert.equal(latest(a2, 'session').balance, 100_000); assert.equal((await inspect()).sessions.length, 2);
 checks.push('private resumable sessions and distinct online count');

 const first = { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'winner', outcome: 'kor', amount: 1_000 };
 await control('/__fail-debit'); await error(a, first, 'SERVICE_UNAVAILABLE');
 let state = await inspect(); assert.equal(state.tickets.length, 0); conserved(state, 200_000); assert.equal(receipts(a, first.id).length, 0);
 await control('/__restore'); assert.equal((await sync(a)).balance, 100_000);
 checks.push('ticket insert and debit failure roll back atomically without an ACK');

 await Promise.all([bet(a, first), bet(a2, first)]);
 state = await inspect(); assert.equal(state.tickets.length, 1); assert.equal(escrow(state), 1_000); conserved(state, 200_000);
 await until(() => latest(a, 'session').balance === 99_000 && latest(a2, 'session').balance === 99_000);
 await error(a2, { ...first, amount: 2_000 }, 'TICKET_CONFLICT');
 await error(a, { ...first, id: randomUUID() }, 'ALREADY_BET');
 checks.push('concurrent same-session UUID deduplication and immutable ticket payload');

 // Different sessions may choose the same client UUID; server-assigned sequence IDs keep payouts unique.
 const second = { ...first, outcome: 'ayaz', amount: 2_000 };
 await bet(b, second);
 for (const m of RINGSIDE_MARKETS.filter(m => m.id !== 'winner')) {
  await bet(a, { type: 'bet', id: randomUUID(), roundId: opening.id, market: m.id, outcome: m.outcomes[0], amount: 300 });
 }
 // Cover every finish outcome, guaranteeing one fee-bearing pool for any real CSPRNG seed.
 await bet(b, { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'finish', outcome: 'decision', amount: 300 });
 state = await inspect(); assert.equal(state.tickets.length, 6); assert.equal(new Set(state.tickets.map(t => t.seq)).size, 6); conserved(state, 200_000);
 await until(() => latest(a, 'snapshot').count === 6);
 assert.equal(latest(a, 'snapshot').pools.length, 4);
 assert.equal(latest(a, 'snapshot').participants, 2);
 checks.push('four separate prop pools and server-unique payout IDs');

 await clock(opening.closesAt - 1);
 await bet(b, { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'first-hit', outcome: 'ayaz', amount: 700 });
 const preClose = await inspect(); conserved(preClose, 200_000);
 await clock(opening.closesAt);
 await until(() => latest(a, 'snapshot').round.phase === 'fighting');
 const fight = latest(a, 'snapshot').round;
 assert.equal(createHash('sha256').update(ringCommitmentInput(fight.id, fight.seed)).digest('hex'), opening.commitment);
 assert.equal(fight.endsAt - fight.startsAt, COMBAT_DURATION_MS);
 assert.equal(fight.nextAt - fight.endsAt, RINGSIDE_RESULT_MS);
 await error(b, { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'knockdown', outcome: 'no', amount: 100 }, 'ROUND_CLOSED');
 assert.deepEqual(unchangedMoney(await inspect()), unchangedMoney(preClose));
 await bet(a, first); conserved(await inspect(), 200_000);
 checks.push('last millisecond acceptance, exact cutoff denial and post-cutoff same-ticket retry');

 const allFrames = [a, a2, b].flatMap(c => c.frames.filter(f => f.type === 'snapshot'));
 for (const frame of allFrames) {
  const raw = JSON.stringify(frame);
  for (const c of [a, b]) { assert.ok(!raw.includes(c.token)); assert.ok(!raw.includes(createHash('sha256').update(c.token).digest('hex'))); }
  assert.ok(!raw.includes(first.id)); assert.ok(!raw.includes('secretSeed')); assert.ok(!raw.includes('balance'));
  if (frame.round.phase === 'open') assert.equal(frame.round.seed, null);
  for (const t of frame.tape) assert.deepEqual(Object.keys(t).sort(), ['acceptedAt', 'alias', 'amount', 'market', 'outcome', 'payout', 'seq', 'status']);
 }
 const aTicketIds = (await sync(a)).tickets.map(t => t.id), bTicketIds = (await sync(b)).tickets.map(t => t.id);
 assert.equal(aTicketIds.length, 4); assert.equal(bTicketIds.length, 3);
 send(a, { type: 'audit', roundId: opening.id }); await until(() => latest(a, 'audit'));
 const pendingAudit = latest(a, 'audit'); assert.equal(pendingAudit.entries.length, 7);
 assert.ok(pendingAudit.entries.every(t => t.status === 'accepted' && t.payout === 0));
 await error(a, { type: 'audit', roundId: '999' }, 'WRONG_ROUND');
 const auditRaw = JSON.stringify(pendingAudit);
 for (const c of [a, b]) { assert.ok(!auditRaw.includes(c.token)); assert.ok(!auditRaw.includes(createHash('sha256').update(c.token).digest('hex'))); }
 assert.ok(!auditRaw.includes(first.id)); assert.ok(!auditRaw.includes('secretSeed')); assert.ok(!auditRaw.includes('balance'));
 assert.deepEqual(unchangedMoney(await inspect()), unchangedMoney(preClose));
 checks.push('public tape contains pseudonyms only; private balances and tickets stay session-scoped');

 // A fee-table failure occurs after at least one entire pool has credited its players.
 await control('/__fail-settlement');
 assert.equal((await fetch(`${base}/__clock?at=${fight.endsAt}`)).status, 500);
 const rolledBack = await inspect(); assert.equal(rolledBack.round.phase, 'fighting');
 assert.deepEqual(unchangedMoney(rolledBack), unchangedMoney(preClose));
 conserved(rolledBack, 200_000); await control('/__restore');
 checks.push('mid-settlement failure rolls back every pool, fee, ticket and session credit');

 await clock(fight.endsAt); await until(() => latest(a, 'snapshot').round.phase === 'result');
 state = await inspect(); const afterPaid = structuredClone(state);
 assert.deepEqual(state.round.results, combatResults(simulateCombat(fight.seed)));
 assert.equal(state.tickets.filter(t => t.status === 'accepted').length, 0); assert.equal(state.fees.length, 4); conserved(state, 200_000);
 for (const m of RINGSIDE_MARKETS) {
  const list = state.tickets.filter(t => t.market === m.id), charged = state.fees.find(f => f.market === m.id);
  assert.equal(list.reduce((sum, t) => sum + t.payout, 0) + charged.fee, list.reduce((sum, t) => sum + t.amount, 0));
  if (m.id === 'knockdown') { assert.equal(charged.status, 'refunded'); assert.equal(charged.fee, 0); for (const t of list) assert.equal(t.payout, t.amount); }
  if (m.id === 'finish') { assert.equal(charged.status, 'paid'); assert.equal(charged.fee, 12); assert.deepEqual(list.map(t => t.payout).sort((a, b) => a - b), [0, 588]); }
  const publicPool = latest(a, 'snapshot').pools.find(p => p.market === m.id);
  assert.equal(publicPool.fee, charged.fee); assert.equal(publicPool.distributed, list.reduce((sum, t) => sum + t.payout, 0));
 }
 const auditBefore = a.frames.length; send(a, { type: 'audit', roundId: opening.id });
 await until(() => a.frames.slice(auditBefore).some(f => f.type === 'audit'));
 assert.ok(latest(a, 'audit').entries.every(t => t.status !== 'accepted'));
 assert.equal(latest(a, 'audit').entries.reduce((sum, t) => sum + t.payout, 0) + fees(state), preClose.tickets.reduce((sum, t) => sum + t.amount, 0));
 await bet(a, first); await clock(fight.endsAt + 1); assert.deepEqual(unchangedMoney(await inspect()), unchangedMoney(afterPaid));
 checks.push('simulation-derived settlement, per-pool conservation and one-sided refunds exactly once');

 await stop(); await start(); const resumed = await connect(a.token);
 const restored = await sync(resumed);
 assert.equal(restored.tickets.length, 4);
 for (const receipt of restored.tickets) { const stored = afterPaid.tickets.find(t => t.session === createHash('sha256').update(a.token).digest('hex') && t.client === receipt.id); assert.ok(stored); assert.equal(receipt.status, stored.status); assert.equal(receipt.payout, stored.payout); }
 await bet(resumed, first); assert.deepEqual(unchangedMoney(await inspect()), unchangedMoney(afterPaid));
 assert.equal(latest(resumed, 'session').balance, afterPaid.sessions.find(s => s.id === createHash('sha256').update(a.token).digest('hex')).balance);
 checks.push('workerd restart persists balances, results and post-settlement duplicate receipts');

 // A fresh round holds another real ticket across session expiry, with no disconnect refund.
 await clock(fight.nextAt); await until(() => latest(resumed, 'snapshot').round.phase === 'open');
 const next = latest(resumed, 'snapshot').round;
 const held = { type: 'bet', id: randomUUID(), roundId: next.id, market: 'winner', outcome: 'kor', amount: 500 };
 await bet(resumed, held); const heldState = await inspect(); conserved(heldState, 200_000);
 const expires = heldState.sessions.find(s => s.id === createHash('sha256').update(a.token).digest('hex')).expires;
 await clock(expires); await until(() => resumed.ws.readyState !== WebSocket.OPEN);
 const expired = await inspect(); assert.equal(expired.round.phase, 'fighting');
 assert.equal(expired.tickets.filter(t => t.status === 'accepted').length, 1); assert.equal(escrow(expired), 500);
 // Old settled session history can be pruned on expiry, so conservation applies to the retained owner.
 const retained = expired.sessions.find(s => s.id === createHash('sha256').update(a.token).digest('hex'));
 assert.ok(retained); assert.equal(retained.balance, heldState.sessions.find(s => s.id === retained.id).balance);
 await clock(expired.round.endsAt); const refunded = await inspect();
 assert.equal(refunded.tickets[0].status, 'refunded'); assert.equal(refunded.tickets[0].payout, 500);
 assert.equal(refunded.sessions[0].balance, retained.balance + 500);
 checks.push('expired sessions cannot keep presence or erase unsettled escrow; owner still receives its refund');

 const c = await connect(); assert.notEqual(c.token, a.token); assert.equal(latest(c, 'snapshot').online, 1);
 // Current result records remain publicly auditable even for an expired owner until the next round.
 send(c, { type: 'audit', roundId: expired.round.id }); await until(() => latest(c, 'audit'));
 assert.equal(latest(c, 'audit').entries.length, 1); assert.equal(latest(c, 'audit').entries[0].status, 'refunded');
 const anon = await connect(undefined, false), anonAt = (await inspect()).at;
 await clock(anonAt + 10_000); await until(() => anon.ws.readyState !== WebSocket.OPEN);
 assert.ok((await inspect()).sessions.every(s => s.expires > expires));
 checks.push('new session cleanup and anonymous handshake expiry are bounded');

 const report = { at: new Date().toISOString(), runtime: 'local-workerd-sqlite', checks: checks.length, passed: checks, timing: { openMs: RINGSIDE_OPEN_MS, fightMs: COMBAT_DURATION_MS, resultMs: RINGSIDE_RESULT_MS }, accounting: { initialGrantCents: 200_000, roundStakeCents: preClose.tickets.reduce((sum, t) => sum + t.amount, 0), finalBalanceCents: balances(afterPaid), platformFeeCents: fees(afterPaid), settledTickets: afterPaid.tickets.length, independentPools: afterPaid.fees.length }, scope: 'Real local workerd, SQLite transactions, WebSockets, actual server CSPRNG, commitment/replay, durable restart and injected SQL failures. Only generated fixture advances its clock through actual production alarm/advance. No cloud load, real assets, VRF, trusted-server fairness proof or production readiness.' };
 await mkdir(resolve(root, 'apps/realtime/evidence'), { recursive: true }); await writeFile(resolve(root, 'apps/realtime/evidence/local-ringside-arena.json'), JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify(report, null, 2));
} catch (e) { console.error('LOCAL_RINGSIDE_ARENA_FAILED', e.stack); console.error(logs.slice(-6000)); process.exitCode = 1; }
finally { await stop(); }
