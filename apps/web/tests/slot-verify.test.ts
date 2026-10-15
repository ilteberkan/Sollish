import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeedHex, playAsenaRound, playCascade2Round, playEbruRound, playStormRound, slotServerSeedHash } from '@sollish/protocol';
import { replayFrames, verifyForm, verifyHistoryRow, verifyReplay } from '../lib/slot-verify';
import type { RemoteHistoryRow, RemoteReplay } from '../lib/rgs-client';

// Same fixed vector as packages/protocol/test/slot-fair.test.ts (computed with Python hmac).
const SEED = '86c7b1c952955a4e71fe5373d64bf143c4b120d33f65ecd3f833fe74c5a1e172', HASH = 'b0cfa9735dd69f67daa193dd89402817200e236a4a4439374bd31af8b2bd581e', CLIENT = 'a1B2-c3_D4', SEED_HEX = 'a1e999637032a2402e98fa320d1fd33c';

test('verify form: a revealed seed recomputes seedHex, engine round and payout; claims are compared', async () => {
  const truth = playCascade2Round(SEED_HEX, 2000, 'ante');
  const ok = await verifyForm({ game: 'cascade', serverSeed: ` ${SEED.toUpperCase()} `, serverSeedHash: HASH, clientSeed: CLIENT, nonce: '42', betCents: '2000', mode: 'ante', expectedSeedHex: SEED_HEX, expectedPayoutCents: String(truth.payoutCents) });
  assert.equal(ok.status, 'match'); assert.equal(ok.result?.seedHex, SEED_HEX); assert.deepEqual(ok.result?.round, truth);
  const wrongPay = await verifyForm({ game: 'cascade', serverSeed: SEED, clientSeed: CLIENT, nonce: 42, betCents: 2000, mode: 'ante', expectedPayoutCents: truth.payoutCents + 1 });
  assert.equal(wrongPay.status, 'mismatch'); assert.match(wrongPay.message, /kazanç/);
  const wrongHash = await verifyForm({ game: 'cascade', serverSeed: SEED, serverSeedHash: '0'.repeat(64), clientSeed: CLIENT, nonce: 42, betCents: 2000, mode: 'ante' });
  assert.equal(wrongHash.status, 'mismatch'); assert.match(wrongHash.message, /tohum özeti/);
  const otherNonce = await verifyForm({ game: 'cascade', serverSeed: SEED, clientSeed: CLIENT, nonce: 41, betCents: 2000, mode: 'ante', expectedSeedHex: SEED_HEX });
  assert.equal(otherNonce.status, 'mismatch');
});

test('verify form: malformed input is reported, never thrown', async () => {
  const base = { game: 'cascade', serverSeed: SEED, clientSeed: CLIENT, nonce: 0, betCents: 1000, mode: 'standard' };
  for (const bad of [{ game: 'nope' }, { serverSeed: 'xyz' }, { serverSeedHash: 'short' }, { clientSeed: 'has space' }, { nonce: '-1' }, { nonce: '1.5' }, { betCents: 1234 }, { mode: 'turbo' }, { expectedSeedHex: 'zz' }, { expectedPayoutCents: 'abc' }]) {
    const out = await verifyForm({ ...base, ...bad });
    assert.equal(out.status, 'invalid', JSON.stringify(bad)); assert.ok(out.message.length > 5);
  }
});

test('history rows: verified once revealed, pending before, mismatch when the record lies', async () => {
  const seedHex = await deriveSeedHex(SEED, 'client1', 7), round = playStormRound(seedHex, 1000, 'buy');
  const row: RemoteHistoryRow = { roundId: 'a'.repeat(32), game: 'tarhun', engineId: 'storm-throne-1', mode: 'buy', betCents: 1000, costCents: 100_000, payoutCents: round.payoutCents, totalHundredths: round.totalHundredths, balanceCents: 0, at: 0,
    fair: { version: 'sollish-slot-fair-1', serverSeedHash: await slotServerSeedHash(SEED), clientSeed: 'client1', nonce: 7, seedHex, serverSeed: SEED } };
  assert.equal((await verifyHistoryRow(row)).status, 'match');
  assert.equal((await verifyHistoryRow({ ...row, fair: { ...row.fair, serverSeed: null } })).status, 'pending');
  assert.equal((await verifyHistoryRow({ ...row, payoutCents: row.payoutCents + 1 })).status, 'mismatch');
  assert.equal((await verifyHistoryRow({ ...row, fair: { ...row.fair, nonce: 8 } })).status, 'mismatch');
  const replay: RemoteReplay = { v: 1, roundId: row.roundId, game: 'tarhun', engineId: row.engineId, mode: 'buy', betCents: 1000, costCents: 100_000, payoutCents: row.payoutCents, totalHundredths: row.totalHundredths,
    fair: { version: 'sollish-slot-fair-1', seedHex, serverSeedHash: row.fair.serverSeedHash, nonce: 7, serverSeed: SEED, clientSeed: 'client1' }, signature: { alg: 'HMAC-SHA256', key: 'worker', value: 'f'.repeat(64) } };
  assert.equal((await verifyReplay(replay)).status, 'match');
  assert.equal((await verifyReplay({ ...replay, fair: { ...replay.fair, serverSeed: null, clientSeed: null } })).status, 'pending');
});

test('replay frames list every step of every spin in play order', () => {
  const round = playStormRound('0123456789abcdef0123456789abcdef', 1000, 'buy');
  const frames = replayFrames(round);
  assert.equal(frames.length, round.spins.reduce((n, s) => n + s.steps.length, 0));
  assert.equal(frames[0]!.kind, 'base'); assert.equal(frames.at(-1)!.last, true); assert.equal(frames.at(-1)!.totalAfterHundredths, round.totalHundredths);
  assert.ok(frames.every(f => f.grid.length === 6 && f.grid.every(c => c.length === 5)));
  assert.deepEqual(replayFrames({} as never), []);
});

test('Ebru replay frames: one per grid shown (deal, bleed, fall, comb), clusters highlighted, stains carried, ends on the total', () => {
  const round = playEbruRound('0123456789abcdef0123456789abcdef', 1000, 'buy');
  const frames = replayFrames(round);
  const grids = round.spins.reduce((n, s) => n + s.steps.filter(st => st.type === 'drop-in' || st.type === 'bleed' || st.type === 'fall' || st.type === 'comb').length, 0);
  assert.equal(frames.length, grids);
  assert.ok(frames.every(f => f.grid.length === 7 && f.grid.every(c => c.length === 7)));
  assert.equal(frames.at(-1)!.last, true); assert.equal(frames.at(-1)!.totalAfterHundredths, round.totalHundredths);
  const paid = round.spins.reduce((n, s) => n + s.steps.reduce((m, st) => m + (st.type === 'clusters' ? st.stepHundredths : 0), 0), 0);
  assert.equal(frames.reduce((n, f) => n + f.stepHundredths, 0), paid, 'every cluster step is shown on the grid it pays on');
  assert.ok(frames.some(f => f.kind === 'free' && f.grid.some(c => c.some(cell => (cell.stain ?? 0) > 0))), 'free-spin frames carry the stain field');
});

test('Asena replay frames: one per tumble step, clusters highlighted, step wins add up to the tumble wins, ends on the total', () => {
  const round = playAsenaRound('0123456789abcdef0123456789abcdef', 1000, 'buy');
  const frames = replayFrames(round);
  assert.equal(frames.length, round.spins.reduce((n, s) => n + s.steps.length, 0));
  assert.ok(frames.every(f => f.grid.length === 6 && f.grid.every(c => c.length === 6)));
  assert.equal(frames.at(-1)!.last, true); assert.equal(frames.at(-1)!.totalAfterHundredths, round.totalHundredths);
  assert.equal(frames.reduce((n, f) => n + f.stepHundredths, 0), round.spins.reduce((n, s) => n + s.tumbleHundredths, 0));
  for (const f of frames) { const ids = new Set(f.grid.flat().map(c => c.id)); assert.ok(f.winIds.every(id => ids.has(id)), 'winners are on the frame grid'); }
  assert.ok(frames.some(f => f.kind === 'free'));
});
