import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_GAMES, cascadeSeedFromEntropy, deriveSeedHex, playCascade2Round, playStormRound, slotBytesToHex, slotServerSeedHash, stormSeedFromEntropy } from '@sollish/protocol';
import { RgsClient, RgsError, createLocalSource, fetchReplay, lastShownRound, markRoundShown, parseReceipt, selectRoundSource, slotEnginesOf, verifyServerRound, type KeyValueStore } from '../lib/rgs-client';
import { ALL_SLOT_ENGINES } from '../lib/slot-engines/all';
import { CASCADE_ENGINE } from '../lib/slot-engines/cascade';
import { TARHUN_ENGINE } from '../lib/slot-engines/tarhun';

const API = 'https://rgs.example.test';
const LOCAL = createLocalSource(ALL_SLOT_ENGINES);
function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
}
type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };

/** Minimal in-memory RGS with the real engines and the real seed derivation (the workerd suite tests the real server). */
function fakeServer(options: { engines?: Record<string, string>; enabled?: boolean; tamper?: 'payout' | 'grid' | 'none'; failFirstRoundAfterCommit?: boolean } = {}) {
  const calls: Call[] = [];
  const serverSeed = slotBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const token = 'ab'.repeat(48);
  let balance = 100_000, nonce = 0, failed = false, sessions = 0;
  const rounds = new Map<string, { idem: string; receipt: Record<string, unknown> }>();
  const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET', headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, method, headers, body: init?.body as string | undefined });
    const path = url.slice(API.length);
    if (path === '/v1/slots/health') return options.enabled === false ? json({ code: 'SERVICE_UNAVAILABLE', enabled: false }, 503) : json({ enabled: true, signature: 'worker', games: Object.entries(options.engines ?? { cascade: 'candy-cascade-2', tarhun: 'storm-throne-1' }).map(([id, engineId]) => ({ id, engineId })) });
    if (path === '/v1/slots/session' && method === 'POST') { sessions++; return json({ v: 1, token, balanceCents: balance, serverSeedHash: await slotServerSeedHash(serverSeed), nonce, expiresAt: 0, signature: 'worker' }, 201); }
    if (headers.Authorization !== `Bearer ${token}`) return json({ code: 'AUTH_INVALID' }, 401);
    if (path === '/v1/slots/session') return json({ v: 1, balanceCents: balance, serverSeedHash: await slotServerSeedHash(serverSeed), nonce, revealed: [] });
    const match = /^\/v1\/slots\/(cascade|tarhun)\/rounds$/.exec(path);
    if (match && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { betCents: number; mode: string; clientSeed: string; idempotencyKey: string };
      const prior = [...rounds.values()].find(r => r.idem === body.idempotencyKey);
      if (prior) return json(prior.receipt, 200, { 'Idempotent-Replayed': 'true' });
      const game = SLOT_GAMES[match[1]!]!, cost = game.cost(body.betCents, body.mode);
      if (cost > balance) return json({ code: 'INSUFFICIENT_BALANCE' }, 409);
      const seedHex = await deriveSeedHex(serverSeed, body.clientSeed, nonce);
      const round = game.play(seedHex, body.betCents, body.mode) as unknown as Record<string, unknown>;
      balance = balance - cost + (round.payoutCents as number);
      const roundId = slotBytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const shown = options.tamper === 'grid' ? { ...round, spins: [] } : round;
      const receipt = { v: 1, roundId, game: game.id, engineId: game.engineId, mode: body.mode, betCents: body.betCents, costCents: cost, payoutCents: (round.payoutCents as number) + (options.tamper === 'payout' ? 100 : 0), totalHundredths: round.totalHundredths, balanceCents: balance, at: 1_760_000_000_000 + nonce,
        fair: { version: 'sollish-slot-fair-1', serverSeedHash: await slotServerSeedHash(serverSeed), clientSeed: body.clientSeed, nonce, seedHex }, signature: { alg: 'HMAC-SHA256', key: 'worker', value: 'c'.repeat(64) }, round: shown };
      nonce++;
      rounds.set(roundId, { idem: body.idempotencyKey, receipt });
      if (options.failFirstRoundAfterCommit && !failed) { failed = true; throw new TypeError('connection reset after commit'); }
      return json(receipt);
    }
    const last = /^\/v1\/slots\/(cascade|tarhun)\/rounds\/last$/.exec(path);
    if (last) { const latest = [...rounds.values()].filter(r => r.receipt.game === last[1]).at(-1); return json({ v: 1, last: latest?.receipt ?? null, balanceCents: balance, serverSeedHash: '', nonce }); }
    if (path === '/v1/slots/balance/reset') { balance = 100_000; return json({ v: 1, balanceCents: balance }); }
    return json({ code: 'NOT_FOUND' }, 404);
  };
  return { fetcher, calls, token, serverSeed, get balance() { return balance; }, get sessions() { return sessions; } };
}

test('local source is the unchanged in-browser engine call (same entropy -> same round)', () => {
  const words = new Uint32Array([1, 2, 3, 4]);
  const local = createLocalSource(ALL_SLOT_ENGINES, w => w.set(words));
  assert.deepEqual(local.resolve('cascade', 1000, 'ante'), playCascade2Round(cascadeSeedFromEntropy(words), 1000, 'ante'));
  assert.deepEqual(local.resolve('tarhun', 500, 'buy'), playStormRound(stormSeedFromEntropy(words), 500, 'buy'));
  assert.equal(local.kind, 'local'); assert.equal(local.label, 'Yerel demo');
  assert.throws(() => createLocalSource(ALL_SLOT_ENGINES, () => { throw new Error('no entropy'); }).resolve('cascade', 100, 'standard'));
});

test('selection: local unless the API is configured AND health answers with the same engine', async () => {
  assert.equal((await selectRoundSource('cascade', { engines: ALL_SLOT_ENGINES, local: LOCAL })).kind, 'local');
  assert.equal((await selectRoundSource('cascade', { engines: ALL_SLOT_ENGINES, local: LOCAL, apiUrl: 'ftp://x' })).kind, 'local');
  assert.equal((await selectRoundSource('cascade', { engines: ALL_SLOT_ENGINES, local: LOCAL, apiUrl: 'http://evil.example' })).kind, 'local', 'plain http only for localhost');
  const down = await selectRoundSource('cascade', { engines: ALL_SLOT_ENGINES, local: LOCAL, apiUrl: API, fetch: async () => { throw new TypeError('offline'); } });
  assert.deepEqual([down.kind, down.kind === 'local' && down.reason], ['local', 'unreachable']);
  const off = await selectRoundSource('cascade', { engines: ALL_SLOT_ENGINES, local: LOCAL, apiUrl: API, fetch: fakeServer({ enabled: false }).fetcher });
  assert.deepEqual([off.kind, off.kind === 'local' && off.reason], ['local', 'disabled']);
  const skew = await selectRoundSource('cascade', { engines: ALL_SLOT_ENGINES, local: LOCAL, apiUrl: API, fetch: fakeServer({ engines: { cascade: 'candy-cascade-9' } }).fetcher });
  assert.deepEqual([skew.kind, skew.kind === 'local' && skew.reason], ['local', 'engine-mismatch']);
  const server = fakeServer(), store = memoryStore();
  const on = await selectRoundSource('tarhun', { engines: ALL_SLOT_ENGINES, local: LOCAL, apiUrl: API, fetch: server.fetcher, storage: store });
  assert.equal(on.kind, 'remote'); assert.equal(on.kind === 'remote' && on.balanceCents, 100_000); assert.equal(on.kind === 'remote' && on.source.label, 'Sunucu doğrulamalı');
  assert.ok([...store.data.values()].some(v => v.includes(server.token)), 'token kept in (session) storage');
});

test('remote play: token only in Authorization, strict 4-field body, server balance, engine-checked round', async () => {
  const server = fakeServer(), store = memoryStore();
  const client = new RgsClient({ baseUrl: API, engines: ALL_SLOT_ENGINES, fetch: server.fetcher, storage: store });
  await client.ensureSession();
  const play = await client.play('cascade', 1000, 'standard');
  const call = server.calls.find(c => c.url.endsWith('/v1/slots/cascade/rounds'))!;
  assert.equal(call.headers.Authorization, `Bearer ${server.token}`);
  for (const c of server.calls) assert.ok(!c.url.includes(server.token) && !c.url.includes('?'), 'no token or query in any URL');
  assert.deepEqual(Object.keys(JSON.parse(call.body!)).sort(), ['betCents', 'clientSeed', 'idempotencyKey', 'mode']);
  assert.equal(play.receipt.balanceCents, server.balance); assert.equal(play.replayed, false);
  assert.deepEqual(play.round, playCascade2Round(play.receipt.fair.seedHex, 1000, 'standard'));
  // A new client in the same tab reuses the stored session instead of opening a second one.
  const again = new RgsClient({ baseUrl: API, engines: ALL_SLOT_ENGINES, fetch: server.fetcher, storage: store });
  assert.equal(again.hasSession, true); await again.ensureSession(); assert.equal(server.sessions, 1);
  assert.equal(new RgsClient({ baseUrl: 'https://other.example', fetch: server.fetcher, storage: store }).hasSession, false, 'token is bound to its API origin');
});

test('a lost response is retried with the SAME idempotency key: one debit, the committed round comes back', async () => {
  const server = fakeServer({ failFirstRoundAfterCommit: true });
  const client = new RgsClient({ baseUrl: API, engines: ALL_SLOT_ENGINES, fetch: server.fetcher, storage: memoryStore(), sleep: async () => undefined });
  await client.ensureSession();
  const play = await client.play('tarhun', 1000, 'standard');
  const posts = server.calls.filter(c => c.url.endsWith('/rounds'));
  assert.equal(posts.length, 2); assert.equal(JSON.parse(posts[0]!.body!).idempotencyKey, JSON.parse(posts[1]!.body!).idempotencyKey);
  assert.equal(play.replayed, true); assert.equal(server.balance, 100_000 - 1000 + play.receipt.payoutCents);
});

test('a server round that differs from the engine (payout or steps) is refused and not presented', async () => {
  for (const tamper of ['payout', 'grid'] as const) {
    const client = new RgsClient({ baseUrl: API, engines: ALL_SLOT_ENGINES, fetch: fakeServer({ tamper }).fetcher, storage: memoryStore(), sleep: async () => undefined });
    await client.ensureSession();
    await assert.rejects(client.play('cascade', 1000, 'standard'), (e: unknown) => e instanceof RgsError && e.code === 'ROUND_MISMATCH');
  }
  assert.throws(() => parseReceipt({ v: 1 }), RgsError);
  assert.throws(() => verifyServerRound('cascade', { engineId: 'storm-throne-1', seedHex: '0'.repeat(32), betCents: 100, mode: 'standard', costCents: 100, payoutCents: 0, totalHundredths: 0 }, {}, ALL_SLOT_ENGINES), RgsError);
});

test('errors: insufficient balance is final, 401 drops the token, recovery returns the last server round', async () => {
  const server = fakeServer(), store = memoryStore();
  const client = new RgsClient({ baseUrl: API, engines: ALL_SLOT_ENGINES, fetch: server.fetcher, storage: store, sleep: async () => undefined });
  await client.ensureSession();
  await assert.rejects(client.play('cascade', 50_000, 'buy'), (e: unknown) => e instanceof RgsError && e.code === 'INSUFFICIENT_BALANCE');
  assert.equal(server.calls.filter(c => c.url.endsWith('/rounds')).length, 1, 'not retried');
  const played = await client.play('cascade', 100, 'standard');
  const recovered = await client.last('cascade');
  assert.equal(recovered.last?.receipt.roundId, played.receipt.roundId); assert.deepEqual(recovered.last?.round, played.round); assert.equal(recovered.balanceCents, server.balance);
  assert.equal((await client.last('tarhun')).last, null);
  assert.equal(await client.resetBalance(), 100_000);
  const stale = new RgsClient({ baseUrl: API, engines: ALL_SLOT_ENGINES, fetch: async () => new Response(JSON.stringify({ code: 'AUTH_INVALID' }), { status: 401 }), storage: store });
  assert.equal(stale.hasSession, true);
  await assert.rejects(stale.state(), (e: unknown) => e instanceof RgsError && e.code === 'AUTH_INVALID');
  assert.equal(stale.hasSession, false); assert.equal(store.data.size, 0);
  markRoundShown('cascade', 'abc', store); assert.equal(lastShownRound('cascade', store), 'abc'); assert.equal(lastShownRound('tarhun', store), null);
});

test('public replay: validated record, round recomputed locally, tampering refused', async () => {
  const seedHex = '0123456789abcdef0123456789abcdef', round = playStormRound(seedHex, 1000, 'buy');
  const replay = { v: 1, roundId: 'd'.repeat(32), game: 'tarhun', engineId: 'storm-throne-1', mode: 'buy', betCents: 1000, costCents: 100_000, payoutCents: round.payoutCents, totalHundredths: round.totalHundredths,
    fair: { version: 'sollish-slot-fair-1', seedHex, serverSeedHash: 'e'.repeat(64), nonce: 3, serverSeed: null, clientSeed: null }, signature: { alg: 'HMAC-SHA256', key: 'worker', value: 'f'.repeat(64) } };
  const serve = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });
  const ok = await fetchReplay(API, 'd'.repeat(32), ALL_SLOT_ENGINES, serve({ replay, round }));
  assert.deepEqual(ok.round, round); assert.equal(ok.replay.fair.serverSeed, null);
  await assert.rejects(fetchReplay(API, 'd'.repeat(32), ALL_SLOT_ENGINES, serve({ replay: { ...replay, payoutCents: replay.payoutCents + 1 }, round })), RgsError);
  await assert.rejects(fetchReplay(API, 'd'.repeat(32), ALL_SLOT_ENGINES, serve({ replay: { ...replay, roundId: 'a'.repeat(32) }, round })), RgsError);
  await assert.rejects(fetchReplay(API, 'not-an-id', ALL_SLOT_ENGINES, serve({})), (e: unknown) => e instanceof RgsError && e.code === 'NOT_FOUND');
  await assert.rejects(fetchReplay(API, 'd'.repeat(32), ALL_SLOT_ENGINES, serve({ code: 'NOT_FOUND' }, 404)), (e: unknown) => e instanceof RgsError && e.code === 'NOT_FOUND');
});

test('a game that was handed only its own engine plays and verifies only that game (no other engine is reachable)', async () => {
  const own = slotEnginesOf(TARHUN_ENGINE), words = new Uint32Array([5, 6, 7, 8]);
  const local = createLocalSource(own, w => w.set(words));
  assert.deepEqual(local.resolve('tarhun', 500, 'ante'), playStormRound(stormSeedFromEntropy(words), 500, 'ante'));
  assert.throws(() => local.resolve('cascade', 500, 'ante'), (e: unknown) => e instanceof RgsError && e.code === 'ENGINE_MISSING');
  assert.throws(() => createLocalSource({}).resolve('tarhun', 500, 'ante'), (e: unknown) => e instanceof RgsError && e.code === 'ENGINE_MISSING');
  const server = fakeServer(), client = new RgsClient({ baseUrl: API, engines: slotEnginesOf(CASCADE_ENGINE), fetch: server.fetcher, storage: memoryStore(), sleep: async () => undefined });
  await client.ensureSession();
  const played = await client.play('cascade', 1000, 'standard');
  assert.deepEqual(played.round, playCascade2Round(played.receipt.fair.seedHex, 1000, 'standard'));
  const posts = server.calls.length;
  await assert.rejects(client.play('tarhun', 1000, 'standard'), (e: unknown) => e instanceof RgsError && e.code === 'ENGINE_MISSING');
  assert.equal(server.calls.length, posts, 'refused before any request, so the server never debits a round this page cannot verify');
  await assert.rejects(fetchReplay(API, 'd'.repeat(32), own, async () => new Response('{}', { status: 404 })), RgsError);
  assert.deepEqual(Object.keys(ALL_SLOT_ENGINES).sort(), ['asena', 'cascade', 'cezeri', 'ebru', 'tarhun']);
});
