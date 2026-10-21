import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ASENA_SLOT, CASCADE_SLOT, DAMLA_SLOT, EBRU_SLOT, GOREME_SLOT, TARHUN_SLOT } from '@sollish/protocol';
import { SLOT_LIMITS, SlotError, admitBet, bearerToken, handleSlots, mintToken, parseExactObject, parseRoundBody, signText, signingSecret, timingSafeEqualHex, tokenValid } from '../src/slots';
import { monitorFlushMs, monitorRollupMs, monitorShardCount, monitorTarget, parseDeltas, rtpAlert, rtpDeviation } from '../src/slot-stats';
import { isReplayRecord } from '../src/slot-records';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof SlotError ? e.code : 'OTHER'; } return 'OK'; };
const KEY = 'unit-test-slot-signing-key-0123456789abcdef';

test('bodies: exact keys only, no prototype tricks, strict types; result fields are unknown fields', () => {
  const ok = { betCents: 100, mode: 'standard', clientSeed: 'abc_DEF-1', idempotencyKey: 'k'.repeat(16) };
  assert.deepEqual(parseRoundBody(JSON.stringify(ok)), ok);
  for (const extra of [{ payoutCents: 1 }, { costCents: 100 }, { seedHex: 'a'.repeat(32) }, { balanceCents: 1 }, { round: {} }]) assert.equal(code(() => parseRoundBody(JSON.stringify({ ...ok, ...extra }))), 'INVALID_MESSAGE');
  assert.equal(code(() => parseRoundBody('{"betCents":100,"mode":"standard","clientSeed":"a","idempotencyKey":"kkkkkkkkkkkkkkkk","__proto__":{}}')), 'INVALID_MESSAGE');
  for (const text of ['', 'null', '[]', '"x"', '{', JSON.stringify({ ...ok, idempotencyKey: undefined })]) assert.equal(code(() => parseRoundBody(text)), 'INVALID_MESSAGE');
  for (const betCents of [0, -100, 100.5, '100', 2 ** 60, null]) assert.equal(code(() => parseRoundBody(JSON.stringify({ ...ok, betCents }))), 'INVALID_BET');
  for (const mode of ['', 'Buy', 'x'.repeat(17), 3]) assert.equal(code(() => parseRoundBody(JSON.stringify({ ...ok, mode }))), 'INVALID_MODE');
  for (const clientSeed of ['', 'a b', 'ü', 'x'.repeat(65)]) assert.equal(code(() => parseRoundBody(JSON.stringify({ ...ok, clientSeed }))), 'INVALID_MESSAGE');
  for (const idempotencyKey of ['short', 'k'.repeat(65), 'k'.repeat(15) + '!']) assert.equal(code(() => parseRoundBody(JSON.stringify({ ...ok, idempotencyKey }))), 'INVALID_MESSAGE');
  assert.deepEqual(parseExactObject('', []), {}); assert.deepEqual(parseExactObject('{}', []), {}); assert.equal(code(() => parseExactObject('{"a":1}', [])), 'INVALID_MESSAGE');
});

test('bet admission: levels, modes and integer cost come from the game definition, exposure is capped', () => {
  assert.equal(admitBet(CASCADE_SLOT, 1000, 'standard'), 1000); assert.equal(admitBet(CASCADE_SLOT, 1000, 'ante'), 1250); assert.equal(admitBet(TARHUN_SLOT, 50_000, 'buy'), 5_000_000);
  assert.equal(admitBet(EBRU_SLOT, 50_000, 'standard'), 50_000, 'Ebru max bet x 10000 fits the exposure cap'); assert.equal(admitBet(EBRU_SLOT, 50_000, 'buy'), 5_000_000);
  assert.equal(admitBet(ASENA_SLOT, 50_000, 'standard'), 50_000, 'Asena max bet x 5000 fits the exposure cap'); assert.equal(admitBet(ASENA_SLOT, 50_000, 'buy'), 4_000_000);
  assert.equal(admitBet(DAMLA_SLOT, 50_000, 'high-16'), 50_000, 'Damla max bet x 1000 fits the exposure cap'); assert.equal(code(() => admitBet(DAMLA_SLOT, 1000, 'standard')), 'INVALID_MODE');
  assert.equal(admitBet(GOREME_SLOT, 50_000, 'standard'), 50_000, 'Göreme max bet x 10000 fits the exposure cap'); assert.equal(admitBet(GOREME_SLOT, 50_000, 'buy'), 5_000_000); assert.equal(admitBet(GOREME_SLOT, 1000, 'ante'), 1250);
  assert.equal(code(() => admitBet(CASCADE_SLOT, 101, 'standard')), 'INVALID_BET');
  assert.equal(code(() => admitBet(CASCADE_SLOT, 100, 'turbo')), 'INVALID_MODE');
  const greedy = { ...CASCADE_SLOT, maxMultiplier: 1_000_000 };
  assert.equal(code(() => admitBet(greedy, 50_000, 'standard')), 'INVALID_BET');
  assert.equal(SLOT_LIMITS.maxExposureCents, 50_000 * 10_000);
});

test('tokens: 96 hex, HMAC tag checked in constant-time form, forgeries and dev/worker key separation', async () => {
  const env = { SLOT_SIGNING_KEY: KEY };
  const token = await mintToken(env);
  assert.match(token, /^[0-9a-f]{96}$/); assert.equal(await tokenValid(env, token), true);
  const flipped = token.slice(0, 95) + (token.at(-1) === '0' ? '1' : '0');
  assert.equal(await tokenValid(env, flipped), false);
  assert.equal(await tokenValid(env, token.toUpperCase()), false); assert.equal(await tokenValid({}, token), false);
  assert.equal(await tokenValid(env, token.slice(0, 64) + '0'.repeat(32)), false);
  assert.equal(timingSafeEqualHex('ab', 'ab'), true); assert.equal(timingSafeEqualHex('ab', 'ac'), false); assert.equal(timingSafeEqualHex('ab', 'abc'), false);
  const req = (h?: string) => new Request('https://x.invalid', h === undefined ? {} : { headers: { Authorization: h } });
  assert.equal(bearerToken(req()), null); assert.equal(bearerToken(req(`Bearer ${token}`)), token); assert.equal(bearerToken(req(`bearer ${token}`)), ''); assert.equal(bearerToken(req(`Bearer  ${token}`)), ''); assert.equal(bearerToken(req(`Bearer ${token},${token}`)), '');
  assert.equal(signingSecret({ SLOT_SIGNING_KEY: 'short' }).kind, 'dev'); assert.equal(signingSecret(env).kind, 'worker');
  const sig = await signText(env, 'hello');
  assert.deepEqual(sig, { alg: 'HMAC-SHA256', key: 'worker', value: createHmac('sha256', KEY).update('hello').digest('hex') });
  assert.equal((await signText({}, 'hello')).key, 'dev');
});

test('observed RTP: z-score arithmetic, 4 sigma threshold and minimum rounds', () => {
  const expected = { rtp: 0.96, stdDev: 2 };
  assert.equal(rtpDeviation({ rounds: 0, costCents: 0, payoutCents: 0, costSquares: 0 }, expected), null);
  const d = rtpDeviation({ rounds: 100, costCents: 10_000, payoutCents: 9_600, costSquares: 100 * 100 * 100 }, expected)!;
  assert.equal(d.z, 0); assert.equal(d.observedRtp, 0.96);
  // 100 rounds of 100 cents: sigma of the total = 2 * sqrt(100 * 100^2) = 2000 cents; 4 sigma = 8000 above 9600.
  const totals = (payout: number) => ({ rounds: 2000, costCents: 200_000, payoutCents: payout, costSquares: 2000 * 100 * 100 });
  const sd = 2 * Math.sqrt(2000 * 100 * 100) * CASCADE_SLOT.rtp.buy!.stdDev / 2;
  const mean = CASCADE_SLOT.rtp.buy!.rtp * 200_000;
  assert.equal(rtpAlert('global', 'cascade', 'buy', totals(Math.round(mean + 3.9 * sd)), 1000), null);
  const alert = rtpAlert('global', 'cascade', 'buy', totals(Math.round(mean + 4.1 * sd)), 1000)!;
  assert.equal(alert.event, 'slot_rtp_deviation'); assert.ok((alert.z as number) > 4);
  assert.ok(rtpAlert('global', 'cascade', 'buy', totals(Math.round(mean - 4.1 * sd)), 1000));
  assert.equal(rtpAlert('global', 'cascade', 'buy', totals(Math.round(mean + 9 * sd)), 5000), null, 'below minimum rounds');
  assert.equal(rtpAlert('global', 'nope', 'buy', totals(0), 10), null);
  const keys = Object.keys(alert).sort();
  assert.deepEqual(keys, ['costCents', 'event', 'expectedRtp', 'game', 'mode', 'observedRtp', 'payoutCents', 'rounds', 'scope', 'sigma', 'z']);
  assert.equal(parseDeltas({ deltas: [{ game: 'cascade', mode: 'buy', rounds: 1, cost: 1, payout: 1, costSq: 1, maxPayout: 1 }] })?.length, 1);
  assert.equal(parseDeltas({ deltas: [{ game: 'cascade', mode: 'x', rounds: 1, cost: 1, payout: 1, costSq: 1, maxPayout: 1 }] }), null);
  assert.equal(parseDeltas({ deltas: [{ game: 'cascade', mode: 'buy', rounds: -1, cost: 1, payout: 1, costSq: 1, maxPayout: 1 }] }), null);
});

test('replay records: exact public shape; balance, time, token or session fields are refused', () => {
  const record = { v: 1, roundId: 'a'.repeat(32), game: 'cascade', engineId: 'candy-cascade-2', mode: 'standard', betCents: 100, costCents: 100, payoutCents: 0, totalHundredths: 0,
    fair: { version: 'sollish-slot-fair-1', seedHex: 'b'.repeat(32), serverSeedHash: 'c'.repeat(64), nonce: 0, serverSeed: null, clientSeed: null }, signature: { alg: 'HMAC-SHA256', key: 'worker', value: 'd'.repeat(64) } };
  assert.equal(isReplayRecord(record), true);
  for (const extra of [{ balanceCents: 1 }, { at: 1 }, { token: 'x' }, { session: 'x' }]) assert.equal(isReplayRecord({ ...record, ...extra }), false);
  assert.equal(isReplayRecord({ ...record, fair: { ...record.fair, ip: '1.1.1.1' } }), false);
  assert.equal(isReplayRecord({ ...record, engineId: 'storm-throne-1' }), false);
  assert.equal(isReplayRecord({ ...record, fair: { ...record.fair, serverSeed: 'short' } }), false);
});

test('router without bindings: health reports the flag, default off is 503, origin and query are refused first', async () => {
  const base = { ALLOWED_ORIGINS: 'http://localhost:3000' };
  const call = (path: string, init: RequestInit = {}, env: Record<string, unknown> = base) => handleSlots(new Request(`https://rt.invalid${path}`, init), env as never, new URL(`https://rt.invalid${path}`));
  const off = await call('/v1/slots/health');
  assert.equal(off.status, 503); assert.equal((await off.json() as { enabled: boolean }).enabled, false);
  assert.equal((await call('/v1/slots/session', { method: 'POST', headers: { Origin: 'http://localhost:3000' } })).status, 503);
  const on = { ...base, SLOTS_ENABLED: 'true' };
  const health = await call('/v1/slots/health', { headers: { Origin: 'http://localhost:3000' } }, on);
  assert.equal(health.status, 200); assert.equal(health.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  const body = await health.json() as { signature: string; games: { id: string }[] };
  assert.equal(body.signature, 'dev'); assert.deepEqual(body.games.map(g => g.id), ['cascade', 'tarhun', 'ebru', 'cezeri', 'asena', 'damla', 'goreme']);
  assert.equal((await call('/v1/slots/session', { method: 'POST', headers: { Origin: 'https://evil.invalid' } }, on)).status, 403);
  assert.equal((await call('/v1/slots/session', { method: 'POST' }, on)).status, 403, 'no Origin header is refused');
  assert.equal((await call('/v1/slots/cascade/rounds?token=abc', { method: 'POST', headers: { Origin: 'http://localhost:3000' } }, on)).status, 400);
  const pre = await call('/v1/slots/cascade/rounds', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } }, on);
  assert.equal(pre.status, 204); assert.match(pre.headers.get('Access-Control-Allow-Headers') ?? '', /Authorization/);
  assert.equal((await call('/v1/slots/cascade/rounds', { method: 'OPTIONS', headers: { Origin: 'https://evil.invalid' } }, on)).status, 403);
});

test('monitor sharding: stable uniform shard per session, 0 = direct to global, bounded settings', () => {
  assert.equal(monitorShardCount({}), 64); assert.equal(monitorShardCount({ SLOT_MONITOR_SHARDS: '0' }), 0); assert.equal(monitorShardCount({ SLOT_MONITOR_SHARDS: '5000' }), 64); assert.equal(monitorShardCount({ SLOT_MONITOR_SHARDS: 'x' }), 64);
  assert.equal(monitorFlushMs({}), 30_000); assert.equal(monitorFlushMs({ SLOT_MONITOR_FLUSH_MS: '10' }), 30_000); assert.equal(monitorFlushMs({ SLOT_MONITOR_FLUSH_MS: '1000' }), 1000);
  assert.equal(monitorRollupMs({}), 5_000);
  assert.deepEqual(monitorTarget('a'.repeat(64), 0), { name: 'global', path: '/add' });
  assert.deepEqual(monitorTarget('not-hex', 64), { name: 'global', path: '/add' });
  const hash = '0000002a' + 'f'.repeat(56);
  assert.deepEqual(monitorTarget(hash, 64), { name: 'shard:42', path: '/shard/add' });
  assert.deepEqual(monitorTarget(hash, 64), monitorTarget(hash, 64));
  // Uniformity over random SHA-256 hashes: every shard used, none above 2x the mean.
  const counts = new Array(64).fill(0);
  for (let i = 0; i < 64_000; i++) counts[Number(monitorTarget(createHmac('sha256', 'k').update(String(i)).digest('hex'), 64).name.slice(6))]++;
  assert.ok(Math.min(...counts) > 500 && Math.max(...counts) < 2000, JSON.stringify(counts));
});
