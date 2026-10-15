/** Local real workerd/SQLite integration of the DEMO slot service (RGS), through the production router (src/index.ts).
 * No cloud deployment, wallet, Supabase, money or real asset. The generated fixture subclass adds ONLY local inspection,
 * an in-flight hold (to make the one-request-at-a-time rule deterministic), SQL failure injection and session ageing;
 * it never produces a result. Signing key below is a local fixture value, never a deployed secret.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { SLOT_GAMES, deriveSeedHex, slotReceiptMessage, slotReplayMessage, slotServerSeedHash, verifySlotRound } from '@sollish/protocol';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const folder = resolve(root, '.tooling/slot-wallet-integration');
const port = 18893, base = `http://127.0.0.1:${port}`, origin = 'http://localhost:3000';
const KEY = 'local-fixture-only-slot-signing-key-0000000000';
await mkdir(folder, { recursive: true });
const src = p => JSON.stringify(resolve(root, 'apps/realtime/src', p));
const entry = `import main from ${src('index.ts')};
import { SlotWallet } from ${src('slot-wallet.ts')};
export * from ${src('index.ts')};
export class ProbeSlotWallet extends SlotWallet {
 async fetch(r) {
  const path = new URL(r.url).pathname, sql = this.ctx.storage.sql;
  if (path === '/__inspect') {
   if (!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='slot_session'").toArray().length) return Response.json({ exists: false, tables: sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'slot_%'").one().n });
   const s = sql.exec('SELECT * FROM slot_session').one(), l = sql.exec('SELECT COALESCE(SUM(credit),0) AS c, COALESCE(SUM(debit),0) AS d, COUNT(*) AS n FROM slot_ledger').one();
   return Response.json({ exists: true, balance: s.balance, tokenHash: s.token_hash, ledgerCredit: l.c, ledgerDebit: l.d, ledgerRows: l.n, rounds: sql.exec('SELECT COUNT(*) AS n FROM slot_rounds').one().n, sessionRounds: s.rounds, nonce: sql.exec('SELECT next_nonce FROM slot_seeds WHERE id=?', s.seed_id).one().next_nonce, columns: sql.exec('SELECT * FROM slot_session').columnNames });
  }
  if (path === '/__hold') { this.entered = false; this.held = new Promise(done => { this.releaseHold = done; }); return new Response('held'); }
  if (path === '/__entered') return Response.json({ entered: this.entered === true });
  if (path === '/__release') { const done = this.releaseHold; this.held = null; done?.(); return new Response('released'); }
  if (path === '/__fail') { sql.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON slot_ledger BEGIN SELECT RAISE(ABORT,'synthetic local storage failure'); END"); return new Response('ok'); }
  if (path === '/__restore') { sql.exec('DROP TRIGGER fail_ledger'); return new Response('ok'); }
  if (path === '/__age') { sql.exec('UPDATE slot_session SET last_seen = last_seen - ?', 8 * 24 * 3600 * 1000); return new Response('ok'); }
  if (path === '/__flood') { const now = Date.now(); for (let i = 0; i < 600; i++) sql.exec("INSERT INTO slot_rounds(round_id, idem, fingerprint, game, engine, mode, bet, cost, payout, total, seed_id, nonce, client_seed, seed_hex, balance_after, at) VALUES(?, ?, 'x', 'cascade', 'candy-cascade-2', 'standard', 100, 100, 0, 0, 999, ?, 'x', ?, 0, ?)", 'e' + i.toString(16).padStart(31, '0'), 'flood-key-' + String(i).padStart(8, '0'), i, '0'.repeat(32), now - 30000 + i); return new Response('ok'); }
  return super.fetch(r);
 }
 async deriveRoundSeed(...args) { if (this.held) { this.entered = true; await this.held; } return super.deriveRoundSeed(...args); }
}
export default { async fetch(r, env, ctx) {
 const url = new URL(r.url);
 if (url.pathname === '/ready') return new Response('ready');
 if (url.pathname.startsWith('/__probe/')) { const [, , hash, op] = url.pathname.split('/'); return env.SLOT_WALLET.get(env.SLOT_WALLET.idFromName('slot:' + hash)).fetch('https://probe/__' + op); }
 if (url.pathname === '/__monitor') return env.SLOT_MONITOR.get(env.SLOT_MONITOR.idFromName('global')).fetch('https://probe/stats');
 if (url.pathname === '/__monitor-add') return env.SLOT_MONITOR.get(env.SLOT_MONITOR.idFromName('global')).fetch('https://probe/add', { method: 'POST', body: await r.text() });
 return main.fetch(r, env, ctx);
} };`;
await writeFile(resolve(folder, 'entry.ts'), entry);
let child, logs = '', checks = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(25); } throw new Error('LOCAL_SLOT_TEST_TIMEOUT'); }
async function start({ enabled, key, fresh }) {
 if (fresh) await rm(resolve(folder, 'state'), { recursive: true, force: true });
 const vars = { ALLOWED_ORIGINS: origin, SLOTS_ENABLED: enabled ? 'true' : 'false', SLOT_RTP_MIN_ROUNDS: '10', ...(key ? { SLOT_SIGNING_KEY: KEY } : {}) };
 await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify({ name: 'sollish-slot-wallet-local-test', main: resolve(folder, 'entry.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], vars,
  durable_objects: { bindings: [{ name: 'ADMISSION', class_name: 'AdmissionGate' }, { name: 'SLOT_WALLET', class_name: 'ProbeSlotWallet' }, { name: 'SLOT_REPLAY', class_name: 'SlotReplay' }, { name: 'SLOT_MONITOR', class_name: 'SlotMonitor' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['AdmissionGate', 'ProbeSlotWallet', 'SlotReplay', 'SlotMonitor'] }] }));
 child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', resolve(folder, 'state'), '--show-interactive-dev-session=false'], { cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
 for (const s of [child.stdout, child.stderr]) s.on('data', b => { logs = (logs + b).slice(-200000); });
 await until(async () => { try { return (await fetch(`${base}/ready`)).ok; } catch { return false; } }, 40000);
}
async function stop() { child?.kill('SIGTERM'); if (child) await Promise.race([new Promise(r => child.once('exit', r)), wait(6000)]); child = null; }

const hex = n => randomBytes(n).toString('hex');
const sha = t => createHash('sha256').update(t).digest('hex');
async function api(method, path, { token, body, raw, headers = {}, noOrigin } = {}) {
 const h = { ...(noOrigin ? {} : { Origin: origin }), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
 const res = await fetch(base + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), ...(raw instanceof ReadableStream ? { duplex: 'half' } : {}) });
 const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
 return { status: res.status, headers: res.headers, text, json };
}
/** Retries 429 with the SAME body (a rate-limited request commits nothing, so this is a correct client retry). */
async function call(method, path, opts = {}) {
 for (let i = 0; ; i++) { const r = await api(method, path, opts); if (r.status !== 429 || i >= 8) return r; await wait(Number(r.headers.get('Retry-After') ?? 1) * 1000 + 50); }
}
const newSession = async ip => { const r = await call('POST', '/v1/slots/session', { body: {}, headers: ip ? { 'CF-Connecting-IP': ip } : {} }); assert.equal(r.status, 201, r.text); return r.json; };
const roundBody = (over = {}) => ({ betCents: 100, mode: 'standard', clientSeed: hex(8), idempotencyKey: hex(16), ...over });
const play = (token, game, body) => call('POST', `/v1/slots/${game}/rounds`, { token, body });
const probe = async (token, op) => { const r = await fetch(`${base}/__probe/${sha(token)}/${op}`); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const ledgerHolds = s => s.ledgerCredit - s.ledgerDebit === s.balance;
const receiptSig = r => createHmac('sha256', KEY).update(slotReceiptMessage({ roundId: r.roundId, game: r.game, engineId: r.engineId, mode: r.mode, betCents: r.betCents, costCents: r.costCents, payoutCents: r.payoutCents, totalHundredths: r.totalHundredths, seedHex: r.fair.seedHex, serverSeedHash: r.fair.serverSeedHash, clientSeed: r.fair.clientSeed, nonce: r.fair.nonce, balanceCents: r.balanceCents, at: r.at })).digest('hex');
const replaySig = p => createHmac('sha256', KEY).update(slotReplayMessage({ roundId: p.roundId, game: p.game, engineId: p.engineId, mode: p.mode, betCents: p.betCents, costCents: p.costCents, payoutCents: p.payoutCents, totalHundredths: p.totalHundredths, seedHex: p.fair.seedHex, serverSeedHash: p.fair.serverSeedHash, nonce: p.fair.nonce, serverSeed: p.fair.serverSeed, clientSeed: p.fair.clientSeed })).digest('hex');
const report = { at: new Date().toISOString(), runtime: 'local-workerd-sqlite-production-router', node: process.version, checks: 0, results: {} };
const secrets = [];

try {
 /* ---------------------------------------------------------------- boot 1: default-off flag */
 await start({ enabled: false, key: true, fresh: true });
 const off = await api('GET', '/v1/slots/health');
 assert.equal(off.status, 503); assert.equal(off.json.enabled, false); checks++;
 assert.equal((await api('POST', '/v1/slots/session', { body: {} })).status, 503); checks++;
 await stop();

 /* ---------------------------------------------------------------- boot 2: no Worker secret -> dev signature */
 await start({ enabled: true, key: false, fresh: true });
 const devHealth = await api('GET', '/v1/slots/health');
 assert.equal(devHealth.status, 200); assert.equal(devHealth.json.signature, 'dev'); checks++;
 const devSession = await newSession('198.18.2.1'); secrets.push(devSession.token);
 assert.equal(devSession.signature, 'dev');
 const devRound = await play(devSession.token, 'cascade', roundBody());
 assert.equal(devRound.status, 200); assert.equal(devRound.json.signature.key, 'dev'); assert.notEqual(devRound.json.signature.value, receiptSig(devRound.json)); checks++;
 await stop();

 /* ---------------------------------------------------------------- boot 3: main suite with SLOT_SIGNING_KEY */
 await start({ enabled: true, key: true, fresh: true });
 const health = await api('GET', '/v1/slots/health');
 assert.equal(health.status, 200); assert.equal(health.json.signature, 'worker'); assert.equal(health.headers.get('Access-Control-Allow-Origin'), origin);
 assert.deepEqual(health.json.games.map(g => [g.id, g.engineId]), [['cascade', 'candy-cascade-2'], ['tarhun', 'storm-throne-1'], ['ebru', 'ebru-ink-1'], ['cezeri', 'cezeri-gears-1']]); checks++;
 // CORS and URL rules come before any session work.
 assert.equal((await api('POST', '/v1/slots/session', { body: {}, headers: { Origin: 'https://evil.invalid' } })).status, 403);
 assert.equal((await api('POST', '/v1/slots/session', { body: {}, noOrigin: true })).status, 403);
 assert.equal((await api('POST', '/v1/slots/session?token=never', { body: {} })).status, 400);
 const pre = await api('OPTIONS', '/v1/slots/cascade/rounds');
 assert.equal(pre.status, 204); assert.equal(pre.headers.get('Access-Control-Allow-Origin'), origin); assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/); checks++;

 const s1 = await newSession(); secrets.push(s1.token);
 assert.match(s1.token, /^[0-9a-f]{96}$/); assert.equal(s1.balanceCents, 100000); assert.match(s1.serverSeedHash, /^[0-9a-f]{64}$/); assert.equal(s1.nonce, 0);
 const inspect1 = await probe(s1.token, 'inspect');
 assert.equal(inspect1.tokenHash, sha(s1.token)); assert.ok(!JSON.stringify(inspect1).includes(s1.token), 'raw token is not stored');
 assert.ok(!inspect1.columns.some(c => /token$/.test(c) && c !== 'token_hash')); checks++;

 // Missing, malformed, forged and unknown-but-well-signed tokens.
 assert.equal((await api('GET', '/v1/slots/session')).json.code, 'AUTH_REQUIRED');
 assert.equal((await api('GET', '/v1/slots/session', { headers: { Authorization: 'Bearer nope' } })).json.code, 'AUTH_INVALID');
 const forged = s1.token.slice(0, 95) + (s1.token.at(-1) === 'a' ? 'b' : 'a');
 assert.equal((await api('GET', '/v1/slots/session', { token: forged })).json.code, 'AUTH_INVALID');
 const random = hex(32), unknown = random + createHmac('sha256', KEY).update(`sollish-slot-token-1\n${random}`).digest('hex').slice(0, 32);
 const unknownRes = await api('POST', '/v1/slots/cascade/rounds', { token: unknown, body: roundBody() });
 assert.equal(unknownRes.status, 401); assert.equal(unknownRes.json.code, 'AUTH_INVALID');
 const unknownInspect = await probe(unknown, 'inspect');
 assert.equal(unknownInspect.exists, false); assert.equal(unknownInspect.tables, 0, 'an unknown token leaves no storage behind'); checks++;

 // A first round: engine output, payout and HMAC receipt.
 const body1 = roundBody({ betCents: 1000 });
 const r1 = await play(s1.token, 'cascade', body1);
 assert.equal(r1.status, 200, r1.text); assert.equal(r1.headers.get('Cache-Control'), 'no-store'); assert.equal(r1.headers.get('Idempotent-Replayed'), null);
 const rc1 = r1.json;
 assert.equal(rc1.fair.nonce, 0); assert.equal(rc1.fair.serverSeedHash, s1.serverSeedHash); assert.equal(rc1.fair.clientSeed, body1.clientSeed);
 assert.deepEqual(rc1.round, SLOT_GAMES.cascade.play(rc1.fair.seedHex, 1000, 'standard'));
 assert.equal(rc1.payoutCents, rc1.round.payoutCents); assert.equal(rc1.balanceCents, 100000 - 1000 + rc1.payoutCents);
 assert.equal(rc1.signature.key, 'worker'); assert.equal(rc1.signature.value, receiptSig(rc1)); checks++;

 // Same key, same body: same bytes, no second debit. Same key, other body (bet, mode, game, seed): 409.
 const dup = await play(s1.token, 'cascade', body1);
 assert.equal(dup.status, 200); assert.equal(dup.headers.get('Idempotent-Replayed'), 'true'); assert.equal(dup.text, r1.text);
 let st = await probe(s1.token, 'inspect');
 assert.equal(st.balance, rc1.balanceCents); assert.equal(st.rounds, 1); assert.equal(st.nonce, 1); checks++;
 for (const variant of [{ ...body1, betCents: 2000 }, { ...body1, mode: 'ante' }, { ...body1, clientSeed: 'other' }]) {
  const c = await play(s1.token, 'cascade', variant); assert.equal(c.status, 409); assert.equal(c.json.code, 'IDEMPOTENCY_CONFLICT');
 }
 assert.equal((await play(s1.token, 'tarhun', body1)).json.code, 'IDEMPOTENCY_CONFLICT');
 st = await probe(s1.token, 'inspect'); assert.equal(st.rounds, 1); assert.equal(st.balance, rc1.balanceCents); checks++;

 // Invalid bet, mode, cost and result fields, unknown game, media type, size.
 assert.equal((await play(s1.token, 'cascade', roundBody({ betCents: 101 }))).json.code, 'INVALID_BET');
 assert.equal((await play(s1.token, 'cascade', roundBody({ betCents: 0 }))).json.code, 'INVALID_BET');
 assert.equal((await play(s1.token, 'cascade', roundBody({ mode: 'turbo' }))).json.code, 'INVALID_MODE');
 for (const extra of [{ costCents: 1 }, { payoutCents: 999999 }, { seedHex: 'a'.repeat(32) }, { nonce: 5 }]) assert.equal((await play(s1.token, 'cascade', { ...roundBody(), ...extra })).json.code, 'INVALID_MESSAGE');
 assert.equal((await play(s1.token, 'roulette', roundBody())).json.code, 'UNKNOWN_GAME');
 assert.equal((await api('POST', '/v1/slots/cascade/rounds', { token: s1.token, raw: JSON.stringify(roundBody()), headers: { 'Content-Type': 'text/plain' } })).status, 415);
 assert.equal((await api('POST', '/v1/slots/cascade/rounds', { token: s1.token, raw: JSON.stringify({ ...roundBody(), pad: 'x'.repeat(3000) }) })).status, 413);
 const chunked = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"pad":"' + 'x'.repeat(1500))); c.enqueue(new TextEncoder().encode('x'.repeat(1500) + '"}')); c.close(); } });
 assert.equal((await api('POST', '/v1/slots/cascade/rounds', { token: s1.token, raw: chunked })).status, 413);
 st = await probe(s1.token, 'inspect'); assert.equal(st.rounds, 1); assert.equal(st.nonce, 1); assert.equal(st.balance, rc1.balanceCents); checks++;

 // Insufficient balance: buy at 500 DEMO costs 50.000 DEMO.
 const broke = await play(s1.token, 'cascade', roundBody({ betCents: 50000, mode: 'buy' }));
 assert.equal(broke.status, 409); assert.equal(broke.json.code, 'INSUFFICIENT_BALANCE');
 st = await probe(s1.token, 'inspect'); assert.equal(st.balance, rc1.balanceCents); assert.equal(st.nonce, 1); checks++;

 // One request at a time: hold round A inside the object, B / retry-of-A / GET are refused (not queued), then A commits once.
 await probe(s1.token, 'hold');
 const bodyA = roundBody({ betCents: 500, mode: 'ante' });
 const pendingA = api('POST', '/v1/slots/cascade/rounds', { token: s1.token, body: bodyA });
 await until(async () => (await probe(s1.token, 'entered')).entered);
 const busyB = await api('POST', '/v1/slots/cascade/rounds', { token: s1.token, body: roundBody() });
 const busyA = await api('POST', '/v1/slots/cascade/rounds', { token: s1.token, body: bodyA });
 const busyGet = await api('GET', '/v1/slots/cascade/rounds/last', { token: s1.token });
 assert.deepEqual([busyB.status, busyB.json.code, busyA.json.code, busyGet.json.code], [409, 'SESSION_BUSY', 'SESSION_BUSY', 'SESSION_BUSY']);
 assert.equal(busyB.headers.get('Retry-After'), '1');
 await probe(s1.token, 'release');
 const doneA = await pendingA;
 assert.equal(doneA.status, 200); assert.equal(doneA.json.fair.nonce, 1); assert.equal(doneA.json.costCents, 625);
 const retryA = await play(s1.token, 'cascade', bodyA);
 assert.equal(retryA.text, doneA.text);
 st = await probe(s1.token, 'inspect'); assert.equal(st.rounds, 2); assert.equal(st.balance, doneA.json.balanceCents); assert.ok(ledgerHolds(st)); checks++;

 // Unheld concurrency: duplicates of one key and a burst of distinct keys; at most one debit per key, ledger conserved.
 await wait(1100);
 const twin = roundBody(), twins = await Promise.all([api('POST', '/v1/slots/cascade/rounds', { token: s1.token, body: twin }), api('POST', '/v1/slots/cascade/rounds', { token: s1.token, body: twin })]);
 assert.ok(twins.every(t => [200, 409].includes(t.status)) && twins.some(t => t.status === 200));
 const twinBodies = new Set(twins.filter(t => t.status === 200).map(t => t.text)); assert.equal(twinBodies.size, 1);
 await wait(1100);
 const before = await probe(s1.token, 'inspect');
 const burst = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/v1/slots/cascade/rounds', { token: s1.token, body: roundBody() })));
 const okBurst = burst.filter(b => b.status === 200);
 assert.ok(burst.every(b => b.status === 200 || (b.status === 409 && b.json.code === 'SESSION_BUSY') || (b.status === 429 && b.json.code === 'RATE_LIMITED')));
 st = await probe(s1.token, 'inspect');
 assert.equal(st.rounds, before.rounds + okBurst.length); assert.ok(ledgerHolds(st));
 assert.equal(new Set(okBurst.map(b => b.json.fair.nonce)).size, okBurst.length); checks++;
 report.results.concurrency = { twins: twins.map(t => t.status), burst: burst.map(b => b.status) };

 // Failed settlement: an injected SQLite failure rolls back debit, round, nonce and ledger; the same key then succeeds once.
 await wait(1100);
 const preFail = await probe(s1.token, 'inspect');
 await probe(s1.token, 'fail');
 const failBody = roundBody({ betCents: 200 });
 const failed = await play(s1.token, 'cascade', failBody);
 assert.equal(failed.status, 503); assert.equal(failed.json.code, 'SERVICE_UNAVAILABLE');
 st = await probe(s1.token, 'inspect');
 assert.deepEqual([st.balance, st.rounds, st.nonce, st.ledgerRows], [preFail.balance, preFail.rounds, preFail.nonce, preFail.ledgerRows]);
 await probe(s1.token, 'restore');
 const recovered = await play(s1.token, 'cascade', failBody);
 assert.equal(recovered.status, 200); assert.equal(recovered.json.fair.nonce, preFail.nonce);
 st = await probe(s1.token, 'inspect'); assert.equal(st.rounds, preFail.rounds + 1); assert.ok(ledgerHolds(st)); checks++;

 // Tarhun through the same registry.
 const t1 = await play(s1.token, 'tarhun', roundBody({ betCents: 500, mode: 'buy' }));
 assert.equal(t1.status, 200, t1.text); assert.deepEqual(t1.json.round, SLOT_GAMES.tarhun.play(t1.json.fair.seedHex, 500, 'buy')); assert.equal(t1.json.costCents, 50000);
 assert.equal(t1.json.signature.value, receiptSig(t1.json));
 report.results.responseBytes = { cascadeStandard: r1.text.length, tarhunBuy: t1.text.length }; checks++;

 // Ebru (ebru-ink-1, 10000x cap) through the same registry; the rotation below verifies it with the shared verifier.
 await wait(1100);
 const e1 = await play(s1.token, 'ebru', roundBody({ betCents: 100, mode: 'standard' }));
 assert.equal(e1.status, 200, e1.text); assert.equal(e1.json.engineId, 'ebru-ink-1');
 // JSON form: the engine's integer comb shifts can be -0 (roundSine), which the wire carries as 0.
 assert.deepEqual(e1.json.round, JSON.parse(JSON.stringify(SLOT_GAMES.ebru.play(e1.json.fair.seedHex, 100, 'standard')))); assert.equal(e1.json.costCents, 100);
 assert.equal(e1.json.signature.value, receiptSig(e1.json));
 report.results.responseBytes.ebruStandard = e1.text.length; checks++;

 // Cezeri (cezeri-gears-1, 10000x cap): same registry, buy mode (the 3-vessel guarantee, free spins with the falcon).
 await wait(1100);
 const z1 = await play(s1.token, 'cezeri', roundBody({ betCents: 100, mode: 'buy' }));
 assert.equal(z1.status, 200, z1.text); assert.equal(z1.json.engineId, 'cezeri-gears-1'); assert.equal(z1.json.costCents, 10000);
 assert.deepEqual(z1.json.round, JSON.parse(JSON.stringify(SLOT_GAMES.cezeri.play(z1.json.fair.seedHex, 100, 'buy'))));
 assert.equal(z1.json.signature.value, receiptSig(z1.json));
 report.results.responseBytes.cezeriBuy = z1.text.length; checks++;

 // Recovery endpoint and history before the reveal.
 const lastCascade = await call('GET', '/v1/slots/cascade/rounds/last', { token: s1.token });
 assert.equal(lastCascade.status, 200); assert.equal(lastCascade.json.last.roundId, recovered.json.roundId); assert.equal(JSON.stringify(lastCascade.json.last), recovered.text);
 const hist = await call('GET', '/v1/slots/history', { token: s1.token });
 assert.equal(hist.status, 200); assert.ok(hist.json.rounds.every(r => r.fair.serverSeed === null)); assert.ok(hist.json.rounds.length >= 5); checks++;

 // Share before reveal: public record without server seed, client seed, balance, time, token or IP.
 const share1 = await call('POST', '/v1/slots/replay', { token: s1.token, body: { roundId: rc1.roundId } });
 assert.equal(share1.status, 200); assert.equal(share1.json.path, `/replay/${rc1.roundId}`); assert.equal(share1.json.revealed, false);
 const pub1 = await call('GET', `/v1/slots/replay/${rc1.roundId}`, { headers: { 'CF-Connecting-IP': '198.18.7.7' } });
 assert.equal(pub1.status, 200);
 assert.deepEqual(Object.keys(pub1.json.replay).sort(), ['betCents', 'costCents', 'engineId', 'fair', 'game', 'mode', 'payoutCents', 'roundId', 'signature', 'totalHundredths', 'v']);
 assert.equal(pub1.json.replay.fair.serverSeed, null); assert.equal(pub1.json.replay.fair.clientSeed, null);
 for (const secret of [s1.token, sha(s1.token), body1.clientSeed, '198.18.7.7', '"balanceCents"', '"at"']) assert.ok(!pub1.text.includes(secret), `replay leaks ${secret.slice(0, 12)}`);
 assert.deepEqual(pub1.json.round, rc1.round); assert.equal(pub1.json.replay.signature.value, replaySig(pub1.json.replay));
 assert.equal((await call('GET', `/v1/slots/replay/${'0'.repeat(32)}`)).status, 404);
 assert.equal((await call('GET', '/v1/slots/replay/not-an-id')).status, 404);
 assert.equal((await call('POST', '/v1/slots/replay', { token: s1.token, body: { roundId: rc1.roundId, extra: 1 } })).status, 400); checks++;

 // Rotation reveals the seed: every round of it recomputes in Node and through the shared verifier.
 const rot = await call('POST', '/v1/slots/seed/rotate', { token: s1.token, body: {} });
 assert.equal(rot.status, 200); const revealed = rot.json.revealed;
 assert.equal(revealed.serverSeedHash, s1.serverSeedHash); assert.equal(createHash('sha256').update(Buffer.from(revealed.serverSeed, 'hex')).digest('hex'), s1.serverSeedHash);
 assert.equal(await slotServerSeedHash(revealed.serverSeed), s1.serverSeedHash);
 assert.notEqual(rot.json.serverSeedHash, s1.serverSeedHash); assert.equal(rot.json.nonce, 0);
 assert.ok(!pub1.text.includes(revealed.serverSeed), 'the unrevealed replay did not carry the seed');
 const histAfter = await call('GET', '/v1/slots/history', { token: s1.token });
 let verified = 0;
 for (const row of histAfter.json.rounds) {
  assert.equal(row.fair.serverSeed, revealed.serverSeed);
  assert.equal(createHmac('sha256', Buffer.from(revealed.serverSeed, 'hex')).update(`${row.fair.clientSeed}:${row.fair.nonce}`).digest('hex').slice(0, 32), row.fair.seedHex);
  const v = await verifySlotRound(SLOT_GAMES[row.game], { serverSeed: revealed.serverSeed, serverSeedHash: row.fair.serverSeedHash, clientSeed: row.fair.clientSeed, nonce: row.fair.nonce, betCents: row.betCents, mode: row.mode }, { engineId: row.engineId, seedHex: row.fair.seedHex, payoutCents: row.payoutCents, totalHundredths: row.totalHundredths, costCents: row.costCents });
  assert.equal(v.ok, true); verified++;
 }
 assert.equal(revealed.nonces, histAfter.json.rounds.length); assert.deepEqual(histAfter.json.rounds.map(r => r.fair.nonce).sort((a, b) => a - b), [...Array(revealed.nonces).keys()]);
 const sessionState = await call('GET', '/v1/slots/session', { token: s1.token });
 assert.equal(sessionState.json.revealed[0].serverSeed, revealed.serverSeed); assert.equal(sessionState.json.serverSeedHash, rot.json.serverSeedHash);
 report.results.verifiedAfterReveal = verified; checks++;

 // The shared record was republished with the revealed seed; its signature still verifies.
 const pub1b = await call('GET', `/v1/slots/replay/${rc1.roundId}`);
 assert.equal(pub1b.json.replay.fair.serverSeed, revealed.serverSeed); assert.equal(pub1b.json.replay.fair.clientSeed, body1.clientSeed); assert.equal(pub1b.json.replay.signature.value, replaySig(pub1b.json.replay));
 assert.equal(await deriveSeedHex(revealed.serverSeed, body1.clientSeed, 0), pub1b.json.replay.fair.seedHex); checks++;

 // A round on the new seed starts at nonce 0; its seed stays secret until the next rotation.
 const r2 = await play(s1.token, 'cascade', roundBody());
 assert.equal(r2.json.fair.nonce, 0); assert.equal(r2.json.fair.serverSeedHash, rot.json.serverSeedHash);
 const share2 = await call('POST', '/v1/slots/replay', { token: s1.token, body: { roundId: r2.json.roundId } });
 assert.equal(share2.json.revealed, false);
 const pub2 = await call('GET', `/v1/slots/replay/${r2.json.roundId}`);
 assert.equal(pub2.json.replay.fair.serverSeed, null);
 const rot2 = await call('POST', '/v1/slots/seed/rotate', { token: s1.token, body: {} });
 assert.ok(!pub2.text.includes(rot2.json.revealed.serverSeed)); assert.equal((await call('GET', `/v1/slots/replay/${r2.json.roundId}`)).json.replay.fair.serverSeed, rot2.json.revealed.serverSeed); checks++;

 // Sessions are isolated: another token cannot share, see or replay the first session's rounds.
 const s2 = await newSession(); secrets.push(s2.token);
 assert.equal((await call('POST', '/v1/slots/replay', { token: s2.token, body: { roundId: rc1.roundId } })).status, 404);
 assert.equal((await call('GET', '/v1/slots/cascade/rounds/last', { token: s2.token })).json.last, null);
 assert.equal((await call('GET', '/v1/slots/history', { token: s2.token })).json.rounds.length, 0); checks++;

 // DEMO balance reset is a ledger entry, not a hidden edit.
 const reset = await call('POST', '/v1/slots/balance/reset', { token: s1.token, body: {} });
 assert.equal(reset.json.balanceCents, 100000);
 st = await probe(s1.token, 'inspect'); assert.equal(st.balance, 100000); assert.ok(ledgerHolds(st)); checks++;

 // Rate limits: 4 rounds per second (durable), 12 requests per second (memory), 600 rounds per minute (durable).
 const sr = await newSession('198.18.3.1'); secrets.push(sr.token);
 const statuses = [], ats = [];
 for (let i = 0; i < 8; i++) { const r = await api('POST', '/v1/slots/cascade/rounds', { token: sr.token, body: roundBody() }); statuses.push(r.status); if (r.status === 200) ats.push(r.json.at); else assert.equal(r.json.code, 'RATE_LIMITED'); }
 assert.ok(statuses.includes(429)); ats.sort((a, b) => a - b);
 for (let i = 0; i + 4 < ats.length; i++) assert.ok(ats[i + 4] - ats[i] >= 1000);
 await wait(1100);
 const reqStatuses = [];
 for (let i = 0; i < 20; i++) reqStatuses.push((await api('GET', '/v1/slots/session', { token: sr.token })).status);
 assert.ok(reqStatuses.includes(429)); assert.ok(reqStatuses.filter(s => s === 200).length >= 12);
 await wait(1100);
 const sf = await newSession('198.18.3.2'); secrets.push(sf.token);
 await probe(sf.token, 'flood');
 const flooded = await api('POST', '/v1/slots/cascade/rounds', { token: sf.token, body: roundBody() });
 assert.equal(flooded.status, 429); assert.ok(Number(flooded.headers.get('Retry-After')) >= 25);
 report.results.rateLimit = { roundBurst: statuses, requestBurst: reqStatuses.filter(s => s === 429).length, minuteRetryAfter: Number(flooded.headers.get('Retry-After')) }; checks++;

 // Session creation admission per client IP: 30 per minute.
 const created = [];
 for (let i = 0; i < 31; i++) created.push((await api('POST', '/v1/slots/session', { body: {}, headers: { 'CF-Connecting-IP': '198.18.4.1' } })).status);
 assert.equal(created.filter(s => s === 201).length, 30); assert.equal(created.at(-1), 429); checks++;

 // Idle expiry wipes the session object.
 const se = await newSession('198.18.5.1');
 await probe(se.token, 'age');
 const expired = await api('GET', '/v1/slots/session', { token: se.token });
 assert.equal(expired.json.code, 'SESSION_EXPIRED'); assert.equal((await probe(se.token, 'inspect')).exists, false);
 assert.equal((await api('GET', '/v1/slots/session', { token: se.token })).json.code, 'AUTH_INVALID'); checks++;

 // Observed-RTP counters reach the global monitor by alarm; a crafted 4-sigma batch logs one line without secrets.
 const monitored = await until(async () => { const m = await (await fetch(`${base}/__monitor`)).json(); const row = m.stats.find(s => s.game === 'cascade' && s.mode === 'standard'); return row && row.rounds >= 5 ? m : null; }, 25000);
 report.results.monitor = monitored.stats.map(s => ({ game: s.game, mode: s.mode, rounds: s.rounds }));
 const exp = SLOT_GAMES.cascade.rtp.buy, n = 2000, cost = 100000, sd = exp.stdDev * Math.sqrt(n * cost * cost);
 const add = await fetch(`${base}/__monitor-add`, { method: 'POST', body: JSON.stringify({ deltas: [{ game: 'cascade', mode: 'buy', rounds: n, cost: n * cost, payout: Math.round(exp.rtp * n * cost + 6 * sd), costSq: n * cost * cost, maxPayout: 1 }] }) });
 assert.equal(add.status, 200);
 await until(() => logs.includes('"event":"slot_rtp_deviation"'), 10000);
 const alertLine = logs.split('\n').find(l => l.includes('slot_rtp_deviation'));
 assert.match(alertLine, /"scope":"global"/); checks++;

 const lastBeforeRestart = await call('GET', '/v1/slots/cascade/rounds/last', { token: s1.token });
 const stateBeforeRestart = await probe(s1.token, 'inspect');
 secrets.push(revealed.serverSeed);
 await stop();

 /* ---------------------------------------------------------------- boot 4: restart on the same SQLite directory */
 await start({ enabled: true, key: true, fresh: false });
 const lastAfter = await call('GET', '/v1/slots/cascade/rounds/last', { token: s1.token });
 assert.equal(lastAfter.status, 200); assert.equal(lastAfter.text, lastBeforeRestart.text);
 const stateAfter = await probe(s1.token, 'inspect');
 assert.deepEqual([stateAfter.balance, stateAfter.rounds, stateAfter.nonce], [stateBeforeRestart.balance, stateBeforeRestart.rounds, stateBeforeRestart.nonce]);
 const dupAfter = await play(s1.token, 'cascade', body1);
 assert.equal(dupAfter.text, r1.text, 'idempotent retry survives restart byte for byte');
 const r3 = await play(s1.token, 'cascade', roundBody());
 assert.equal(r3.json.fair.nonce, stateBeforeRestart.nonce); assert.equal(r3.json.balanceCents, stateBeforeRestart.balance - 100 + r3.json.payoutCents);
 assert.equal((await call('GET', `/v1/slots/replay/${rc1.roundId}`)).json.replay.fair.serverSeed, revealed.serverSeed); checks++;

 // Logs never contain a token, a token hash or a server seed (the fixture's own /__probe/<hash> request lines excluded).
 const productLogs = logs.split('\n').filter(line => !line.includes('/__probe/')).join('\n');
 for (const secret of secrets) { assert.ok(!productLogs.includes(secret)); assert.ok(!productLogs.includes(sha(secret))); }
 checks++;
 report.checks = checks;
 report.scope = 'Real workerd + SQLite Durable Objects through the production router: default-off flag, dev/worker signature, CORS/origin/query, token mint/forgery/unknown-token (no storage), strict body (unknown/result fields, size, chunked, media type), bet/mode/cost/balance, idempotent same bytes and 409 conflict, one-request-at-a-time with a held round, unheld concurrent duplicates and bursts, injected SQLite failure rollback, rotate + reveal + Node/shared verifier recomputation, signed replay without secrets and republish after reveal, session isolation, ledger conservation, 4/s 12 req/s 600/min limits, per-IP session admission, idle expiry wipe, alarm-fed RTP monitor and 4-sigma log line, restart persistence. Not hosted, not load, not certified RNG, DEMO only.';
 await mkdir(resolve(root, 'apps/realtime/evidence'), { recursive: true });
 await writeFile(resolve(root, 'apps/realtime/evidence/local-slot-wallet.json'), JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error('LOCAL_SLOT_WALLET_FAILED', error.stack ?? error.message); console.error(logs.slice(-8000)); process.exitCode = 1; }
finally { await stop(); }
