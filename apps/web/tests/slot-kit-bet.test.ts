import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  betLevelStatus, betLevels, canStep, clampBetToLimits, createBetLadder, formatAmount, formatDemo, formatFactor, formatSignedDemo, maxAffordableBet, modeCostCents,
  parseDemoAmountCents, snapToLadder, stepBet,
} from '../lib/slot-kit/bet';

const ladder = createBetLadder([500, 10, 20, 100, 50, 200, 100, 1000]);

test('ladder is sorted, de-duplicated and validated', () => {
  assert.deepEqual([...ladder], [10, 20, 50, 100, 200, 500, 1000]);
  for (const bad of [[], [0], [-1], [1.5], [Number.NaN], [10, Infinity]]) assert.throws(() => createBetLadder(bad), RangeError, JSON.stringify(bad));
});

test('stepBet moves one level and clamps at both ends', () => {
  assert.equal(stepBet(ladder, 50, 1), 100);
  assert.equal(stepBet(ladder, 50, -1), 20);
  assert.equal(stepBet(ladder, 1000, 1), 1000);
  assert.equal(stepBet(ladder, 10, -1), 10);
  assert.equal(stepBet(ladder, 75, 1), 100, 'off-ladder value snaps down first');
  assert.equal(stepBet(ladder, 75, -1), 20);
});

test('stepBet up respects balance and limit, down is always allowed', () => {
  assert.equal(stepBet(ladder, 100, 1, { balanceCents: 200 }), 200);
  assert.equal(stepBet(ladder, 200, 1, { balanceCents: 499 }), 200);
  assert.equal(stepBet(ladder, 200, 1, { balanceCents: 500 }), 500);
  assert.equal(stepBet(ladder, 200, 1, { balanceCents: 10_000, maxBetCents: 200 }), 200);
  assert.equal(stepBet(ladder, 1000, -1, { balanceCents: 0 }), 500);
  assert.equal(canStep(ladder, 10, -1), false);
  assert.equal(canStep(ladder, 20, -1), true);
  assert.equal(canStep(ladder, 1000, 1), false);
  assert.equal(canStep(ladder, 200, 1, { balanceCents: 499 }), false);
  assert.equal(canStep(ladder, 200, 1, { balanceCents: 500 }), true);
});

test('level status: balance equality is affordable, limit wins over balance', () => {
  assert.deepEqual({ ...betLevelStatus(100, { balanceCents: 100 }) }, { betCents: 100, costCents: 100, enabled: true, reason: null });
  assert.deepEqual({ ...betLevelStatus(100, { balanceCents: 99 }) }, { betCents: 100, costCents: 100, enabled: false, reason: 'balance' });
  assert.equal(betLevelStatus(100, { balanceCents: 10_000, maxBetCents: 99 }).reason, 'limit');
  assert.equal(betLevelStatus(100, { balanceCents: 10_000, maxBetCents: 100 }).enabled, true);
  assert.equal(betLevelStatus(100, { balanceCents: 1, maxBetCents: 50 }).reason, 'limit');
  assert.deepEqual(betLevels(ladder, { balanceCents: 100 }).map(l => l.enabled), [true, true, true, true, false, false, false]);
});

test('maxAffordableBet returns the top enabled level or null', () => {
  assert.equal(maxAffordableBet(ladder, { balanceCents: 10_000 }), 1000);
  assert.equal(maxAffordableBet(ladder, { balanceCents: 10_000, maxBetCents: 300 }), 200);
  assert.equal(maxAffordableBet(ladder, { balanceCents: 130 }), 100);
  assert.equal(maxAffordableBet(ladder, { balanceCents: 9 }), null);
  assert.equal(maxAffordableBet(ladder, { balanceCents: 130, cost: { num: 5, den: 4 } }), 100);
  assert.equal(maxAffordableBet(ladder, { balanceCents: 124, cost: { num: 5, den: 4 } }), 50);
});

test('mode cost uses integer ceil and rejects bad factors', () => {
  assert.equal(modeCostCents(100), 100);
  assert.equal(modeCostCents(100, { num: 5, den: 4 }), 125);
  assert.equal(modeCostCents(10, { num: 5, den: 4 }), 13);
  assert.equal(modeCostCents(100, { num: 100, den: 1 }), 10_000);
  assert.equal(modeCostCents(0, { num: 5, den: 4 }), 0);
  for (const mode of [{ num: 0, den: 1 }, { num: 1, den: 0 }, { num: -1, den: 1 }, { num: 1.5, den: 1 }]) assert.throws(() => modeCostCents(100, mode), RangeError);
  assert.throws(() => modeCostCents(-1), RangeError);
  assert.throws(() => modeCostCents(Number.MAX_SAFE_INTEGER, { num: 2, den: 1 }), RangeError);
});

test('snap and clamp keep remembered bets valid', () => {
  assert.equal(snapToLadder(ladder, 5), 10);
  assert.equal(snapToLadder(ladder, 49), 20);
  assert.equal(snapToLadder(ladder, 5000), 1000);
  assert.equal(clampBetToLimits(ladder, 1000, { balanceCents: 130 }), 100);
  assert.equal(clampBetToLimits(ladder, 1000, { balanceCents: 5 }), 10);
  assert.equal(clampBetToLimits(ladder, 200, { balanceCents: 10_000, maxBetCents: 50 }), 50);
});

test('format uses Turkish decimal comma, dot grouping and a true minus', () => {
  assert.equal(formatAmount(0), '0,00');
  assert.equal(formatAmount(5), '0,05');
  assert.equal(formatAmount(1234), '12,34');
  assert.equal(formatAmount(123_456), '1.234,56');
  assert.equal(formatAmount(100_000_000), '1.000.000,00');
  assert.equal(formatAmount(-250), '−2,50');
  assert.equal(formatAmount(10_000, { trimZeros: true }), '100');
  assert.equal(formatAmount(10_050, { trimZeros: true }), '100,50');
  assert.equal(formatDemo(1000), '10,00 DEMO');
  assert.equal(formatSignedDemo(1240), '+12,40 DEMO');
  assert.equal(formatSignedDemo(-300), '−3,00 DEMO');
  assert.equal(formatSignedDemo(0), '0,00 DEMO');
  for (const bad of [Number.NaN, Infinity, 1.5]) { assert.equal(formatAmount(bad), '—'); assert.equal(formatSignedDemo(bad), '—'); }
  assert.equal(formatFactor(5, 4), '×1,25');
  assert.equal(formatFactor(1, 1), '×1');
  assert.equal(formatFactor(3, 2), '×1,5');
  assert.equal(formatFactor(100, 1), '×100');
});

test('player amount input accepts comma or dot with up to two decimals only', () => {
  assert.equal(parseDemoAmountCents('25'), 2500);
  assert.equal(parseDemoAmountCents(' 12,5 '), 1250);
  assert.equal(parseDemoAmountCents('12.50'), 1250);
  assert.equal(parseDemoAmountCents('0,01'), 1);
  assert.equal(parseDemoAmountCents('0.05'), 5);
  for (const bad of ['', ' ', '0', '0,00', '-5', '+5', '1e3', '1,234', '1.234,50', '12,', ',5', 'abc', '1 000', '1,2,3', '9999999999', 'Infinity', '٣']) {
    assert.equal(parseDemoAmountCents(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseDemoAmountCents(undefined as unknown as string), null);
});
