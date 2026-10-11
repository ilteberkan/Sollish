import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoLedger, grossPayout, crashAt } from '../lib/demo';

test('demo admission enforces bounded integer stake and one pending reservation', () => {
  const ledger = new DemoLedger();
  for (const amount of [0, 99, 100.5, 50_001, NaN, Infinity]) assert.equal(ledger.reserve(amount, () => 'invalid'), null);
  assert.equal(ledger.balance, 100_000); assert.equal(ledger.reserve(50_000, () => 'one'), 'one'); assert.equal(ledger.reserve(100, () => 'two'), null); assert.equal(ledger.balance, 50_000);
});
test('entropy failure occurs before debiting, and reuse cannot create a new reservation', () => {
  const ledger = new DemoLedger(); assert.throws(() => ledger.reserve(1000, () => { throw new Error('Entropy unavailable'); })); assert.equal(ledger.balance, 100_000);
  ledger.reserve(1000, () => 'one'); assert.equal(ledger.settle({ id: 'one', stake: 1000, payout: 0 }), true); assert.throws(() => ledger.reserve(1000, () => 'one')); assert.equal(ledger.balance, 99_000);
  assert.equal(ledger.reserve(1000, () => 'two'), 'two');
});
test('forged settlement cannot consume the pending reservation or inflate credits', () => {
  const ledger = new DemoLedger(); ledger.reserve(1000, () => 'one');
  assert.equal(ledger.settle({ id: 'unknown', stake: 1000, payout: 1960 }), false);
  for (const record of [{ id: 'one', stake: 1001, payout: 1960 }, ...[-1, 0.5, NaN, Infinity, 50_001, Number.MAX_SAFE_INTEGER].map(payout => ({ id: 'one', stake: 1000, payout }))]) assert.throws(() => ledger.settle(record), RangeError);
  assert.equal(ledger.balance, 99_000); assert.equal(ledger.settle({ id: 'one', stake: 1000, payout: 1960 }), true); assert.equal(ledger.balance, 100_960);
  assert.equal(ledger.settle({ id: 'one', stake: 1000, payout: 1960 }), false); assert.equal(ledger.balance, 100_960);
});
test('old completion cannot settle a newer round; local cancellation restores exactly its stake', () => {
  const ledger = new DemoLedger(); ledger.reserve(1000, () => 'one'); ledger.settle({ id: 'one', stake: 1000, payout: 1000 }); ledger.reserve(2000, () => 'two');
  assert.equal(ledger.settle({ id: 'one', stake: 1000, payout: 1960 }), false); assert.equal(ledger.balance, 98_000);
  ledger.settle({ id: 'two', stake: 2000, payout: 2000 }); assert.equal(ledger.balance, 100_000);
});
test('payout uses exact intermediate integers and rejects overflow; invalid clock/point is rejected', () => {
  assert.equal(grossPayout(Number.MAX_SAFE_INTEGER, 1), Number.MAX_SAFE_INTEGER); assert.equal(grossPayout(101, 1.96), 197); assert.throws(() => grossPayout(Number.MAX_SAFE_INTEGER, 1.01), RangeError);
  for (const [time, point] of [[NaN, 2], [Infinity, 2], [1, NaN], [1, 0.99], [1, 50.01]]) assert.throws(() => crashAt(time!, point!), RangeError);
});
test('per-reservation multiplier cap: default 50, up to 5000 when reserved, invalid caps rejected', () => {
  let ledger = new DemoLedger(); ledger.reserve(1000, () => 'a', 5000);
  assert.throws(() => ledger.settle({ id: 'a', stake: 1000, payout: 5_000_001 }), RangeError);
  assert.equal(ledger.settle({ id: 'a', stake: 1000, payout: 5_000_000 }), true); assert.equal(ledger.balance, 100_000 - 1000 + 5_000_000);
  ledger = new DemoLedger(); ledger.reserve(1000, () => 'b');
  assert.throws(() => ledger.settle({ id: 'b', stake: 1000, payout: 50_001 }), RangeError); assert.equal(ledger.settle({ id: 'b', stake: 1000, payout: 50_000 }), true);
  ledger = new DemoLedger(); ledger.reserve(1000, () => 'c', 100); assert.throws(() => ledger.settle({ id: 'c', stake: 1000, payout: 100_001 }), RangeError);
  ledger = new DemoLedger();
  for (const cap of [0, -1, 0.5, 5001, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.equal(ledger.reserve(1000, () => 'x', cap), null, String(cap));
  assert.equal(ledger.balance, 100_000); assert.equal(ledger.reserve(1000, () => 'x', 5000), 'x');
});
