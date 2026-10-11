import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOPLAY_SPIN_OPTIONS, AUTOPLAY_STOP_REASONS, autoplayNetLossCents, cancelAutoplay, createAutoplay, nextDecision, recordRound, validateAutoplayConfig,
  type AutoplayConfig, type AutoplayState,
} from '../lib/slot-kit/autoplay';

const base: AutoplayConfig = { spins: 10, lossLimitCents: 1000, stopOnAnyWin: false, stopOnFeature: false };
const make = (patch: Partial<AutoplayConfig> = {}, balance = 10_000): AutoplayState => createAutoplay({ ...base, ...patch }, balance);
const lose = (s: AutoplayState, cost = 100, balanceAfter = 9_900): AutoplayState => recordRound(s, { costCents: cost, payoutCents: 0, featureTriggered: false, balanceAfterCents: balanceAfter });
const stopReason = (d: ReturnType<typeof nextDecision>) => (d.continue ? null : d.reason);

test('config validation rejects missing, zero, negative and non-integer limits', () => {
  assert.deepEqual(validateAutoplayConfig(base), []);
  const bad: Array<[string, unknown]> = [
    ['no loss limit', { ...base, lossLimitCents: undefined }],
    ['zero loss limit', { ...base, lossLimitCents: 0 }],
    ['negative loss limit', { ...base, lossLimitCents: -5 }],
    ['fractional loss limit', { ...base, lossLimitCents: 10.5 }],
    ['NaN loss limit', { ...base, lossLimitCents: Number.NaN }],
    ['Infinity loss limit', { ...base, lossLimitCents: Infinity }],
    ['string loss limit', { ...base, lossLimitCents: '1000' }],
    ['unsafe loss limit', { ...base, lossLimitCents: 2 ** 60 }],
    ['spins not offered', { ...base, spins: 7 }],
    ['spins as string', { ...base, spins: '10' }],
    ['zero single win', { ...base, singleWinLimitCents: 0 }],
    ['negative balance increase', { ...base, balanceIncreaseCents: -1 }],
    ['fractional single win', { ...base, singleWinLimitCents: 1.5 }],
    ['null single win', { ...base, singleWinLimitCents: null }],
    ['missing stopOnAnyWin', { spins: 10, lossLimitCents: 10, stopOnFeature: false }],
    ['non-boolean stopOnFeature', { ...base, stopOnFeature: 1 }],
    ['null config', null],
  ];
  for (const [label, config] of bad) {
    assert.notEqual(validateAutoplayConfig(config).length, 0, label);
    assert.throws(() => createAutoplay(config as AutoplayConfig, 1000), RangeError, label);
  }
  for (const spins of AUTOPLAY_SPIN_OPTIONS) assert.deepEqual(validateAutoplayConfig({ ...base, spins }), [], String(spins));
  assert.deepEqual([...AUTOPLAY_SPIN_OPTIONS], [10, 25, 50, 100, 250, 500, 1000]);
});

test('createAutoplay rejects bad start balances and copies/freeze the config', () => {
  for (const balance of [-1, 1.5, Number.NaN, Infinity]) assert.throws(() => createAutoplay(base, balance), RangeError);
  const config = { ...base };
  const state = createAutoplay(config, 500);
  config.lossLimitCents = 1;
  assert.equal(state.config.lossLimitCents, 1000);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.config));
  assert.equal(state.spinsRemaining, 10);
  assert.equal(state.spinsDone, 0);
});

test('a fresh run continues; spin count runs out exactly after the configured rounds', () => {
  let s = make({ lossLimitCents: 100_000 });
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(nextDecision(s, { balanceCents: 10_000, nextCostCents: 100 }), { continue: true }, `spin ${i}`);
    s = recordRound(s, { costCents: 100, payoutCents: 100, featureTriggered: false, balanceAfterCents: 10_000 });
  }
  assert.equal(s.spinsRemaining, 0);
  assert.equal(s.spinsDone, 10);
  assert.deepEqual(nextDecision(s, { balanceCents: 10_000, nextCostCents: 100 }), { continue: false, reason: 'Tur sayısı tamamlandı', code: 'completed' });
});

test('loss limit counts net loss (spent minus won) and stops before a spin that could exceed it', () => {
  let s = make({ lossLimitCents: 1000 });
  for (let i = 0; i < 9; i += 1) s = lose(s);
  assert.equal(autoplayNetLossCents(s), 900);
  // 900 + 100 == 1000 does not exceed: allowed.
  assert.deepEqual(nextDecision(s, { balanceCents: 9_100, nextCostCents: 100 }), { continue: true });
  // 900 + 101 > 1000: stopped before the spin.
  const exceed = nextDecision(s, { balanceCents: 9_100, nextCostCents: 101 });
  assert.equal(exceed.continue, false);
  assert.equal(!exceed.continue && exceed.code, 'loss-would-exceed');
  s = lose(s);
  assert.equal(autoplayNetLossCents(s), 1000);
  const reached = nextDecision(s, { balanceCents: 9_000, nextCostCents: 1 });
  assert.deepEqual(reached, { continue: false, reason: 'Kayıp limitine ulaşıldı', code: 'loss-limit' });
});

test('wins offset the net loss so autoplay may continue past gross spend', () => {
  let s = make({ lossLimitCents: 300, spins: 100 });
  for (let i = 0; i < 20; i += 1) {
    s = recordRound(s, { costCents: 100, payoutCents: 90, featureTriggered: false, balanceAfterCents: 10_000 - 10 * (i + 1) });
  }
  assert.equal(s.spentCents, 2000);
  assert.equal(autoplayNetLossCents(s), 200);
  assert.deepEqual(nextDecision(s, { balanceCents: 9_800, nextCostCents: 100 }), { continue: true });
  assert.equal(stopReason(nextDecision(s, { balanceCents: 9_800, nextCostCents: 101 })), AUTOPLAY_STOP_REASONS['loss-would-exceed']);
});

test('being ahead gives negative net loss and extra headroom', () => {
  let s = make({ lossLimitCents: 500 });
  s = recordRound(s, { costCents: 100, payoutCents: 1000, featureTriggered: false, balanceAfterCents: 10_900 });
  assert.equal(autoplayNetLossCents(s), -900);
  assert.deepEqual(nextDecision(s, { balanceCents: 10_900, nextCostCents: 1400 }), { continue: true });
  assert.equal(nextDecision(s, { balanceCents: 10_900, nextCostCents: 1401 }).continue, false);
});

test('stops when balance is below the next cost, but allows balance equal to cost', () => {
  const s = make({ lossLimitCents: 1_000_000 }, 10_000);
  assert.deepEqual(nextDecision(s, { balanceCents: 100, nextCostCents: 100 }), { continue: true });
  assert.deepEqual(nextDecision(s, { balanceCents: 99, nextCostCents: 100 }), { continue: false, reason: 'Bakiye yetersiz', code: 'insufficient-balance' });
  assert.equal(nextDecision(s, { balanceCents: 0, nextCostCents: 1 }).continue, false);
});

test('stopOnAnyWin stops after a paying round only when enabled', () => {
  const on = recordRound(make({ stopOnAnyWin: true }), { costCents: 100, payoutCents: 1, featureTriggered: false, balanceAfterCents: 9_901 });
  assert.deepEqual(nextDecision(on, { balanceCents: 9_901, nextCostCents: 100 }), { continue: false, reason: 'Kazanç geldi', code: 'any-win' });
  const off = recordRound(make({ stopOnAnyWin: false }), { costCents: 100, payoutCents: 5000, featureTriggered: false, balanceAfterCents: 14_900 });
  assert.deepEqual(nextDecision(off, { balanceCents: 14_900, nextCostCents: 100 }), { continue: true });
  const noWin = recordRound(make({ stopOnAnyWin: true }), { costCents: 100, payoutCents: 0, featureTriggered: false, balanceAfterCents: 9_900 });
  assert.deepEqual(nextDecision(noWin, { balanceCents: 9_900, nextCostCents: 100 }), { continue: true });
});

test('stopOnFeature stops after a feature round only when enabled', () => {
  const round = { costCents: 100, payoutCents: 0, featureTriggered: true, balanceAfterCents: 9_900 };
  assert.deepEqual(nextDecision(recordRound(make({ stopOnFeature: true }), round), { balanceCents: 9_900, nextCostCents: 100 }), { continue: false, reason: 'Özellik tetiklendi', code: 'feature' });
  assert.deepEqual(nextDecision(recordRound(make({ stopOnFeature: false }), round), { balanceCents: 9_900, nextCostCents: 100 }), { continue: true });
});

test('singleWinLimit triggers at exactly the limit, not below, and only for the last round', () => {
  const cfg = { singleWinLimitCents: 5000 };
  const round = (payout: number) => recordRound(make(cfg), { costCents: 100, payoutCents: payout, featureTriggered: false, balanceAfterCents: 9_900 + payout });
  assert.deepEqual(nextDecision(round(4999), { balanceCents: 14_899, nextCostCents: 100 }), { continue: true });
  assert.deepEqual(nextDecision(round(5000), { balanceCents: 14_900, nextCostCents: 100 }), { continue: false, reason: 'Tek kazanç limitine ulaşıldı', code: 'single-win' });
  assert.equal(nextDecision(round(5001), { balanceCents: 14_901, nextCostCents: 100 }).continue, false);
  // A big win followed by a small round no longer stops.
  const later = recordRound(round(4999), { costCents: 100, payoutCents: 0, featureTriggered: false, balanceAfterCents: 14_799 });
  assert.deepEqual(nextDecision(later, { balanceCents: 14_799, nextCostCents: 100 }), { continue: true });
});

test('balanceIncrease compares current balance with the start balance, equality stops', () => {
  const cfg = { balanceIncreaseCents: 2000 };
  const s = recordRound(make(cfg, 10_000), { costCents: 100, payoutCents: 0, featureTriggered: false, balanceAfterCents: 9_900 });
  assert.deepEqual(nextDecision(s, { balanceCents: 11_999, nextCostCents: 100 }), { continue: true });
  assert.deepEqual(nextDecision(s, { balanceCents: 12_000, nextCostCents: 100 }), { continue: false, reason: 'Bakiye artış hedefine ulaşıldı', code: 'balance-increase' });
  assert.equal(nextDecision(s, { balanceCents: 15_000, nextCostCents: 100 }).continue, false);
  // Before any round there is nothing to compare, so a fresh start never trips it.
  assert.deepEqual(nextDecision(make(cfg, 10_000), { balanceCents: 10_000, nextCostCents: 100 }), { continue: true });
});

test('hidden tab and cancel stop autoplay with their own reasons', () => {
  const s = make();
  assert.deepEqual(nextDecision(s, { balanceCents: 10_000, nextCostCents: 100, tabHidden: true }), { continue: false, reason: 'Sekme gizlendiği için durduruldu', code: 'tab-hidden' });
  assert.deepEqual(nextDecision(s, { balanceCents: 10_000, nextCostCents: 100, tabHidden: false }), { continue: true });
  const cancelled = cancelAutoplay(s);
  assert.equal(s.cancelled, false, 'original state is unchanged');
  assert.deepEqual(nextDecision(cancelled, { balanceCents: 10_000, nextCostCents: 100 }), { continue: false, reason: 'Otomatik oyun durduruldu', code: 'cancelled' });
});

test('invalid decision inputs fail closed', () => {
  const s = make();
  for (const input of [
    { balanceCents: -1, nextCostCents: 100 }, { balanceCents: Number.NaN, nextCostCents: 100 }, { balanceCents: 1000, nextCostCents: 0 },
    { balanceCents: 1000, nextCostCents: -5 }, { balanceCents: 1000, nextCostCents: 1.5 }, { balanceCents: 1000.5, nextCostCents: 100 },
  ]) {
    const d = nextDecision(s, input);
    assert.equal(d.continue, false, JSON.stringify(input));
    assert.equal(!d.continue && d.code, 'invalid-input');
  }
});

test('priority: cancel > hidden tab > loss limit > balance > win triggers > completed', () => {
  let s = make({ lossLimitCents: 200, spins: 10, stopOnAnyWin: true });
  s = recordRound(s, { costCents: 300, payoutCents: 50, featureTriggered: false, balanceAfterCents: 0 });
  const input = { balanceCents: 0, nextCostCents: 100 };
  assert.equal(nextDecision(cancelAutoplay(s), { ...input, tabHidden: true }).continue, false);
  assert.equal((nextDecision(cancelAutoplay(s), { ...input, tabHidden: true }) as { code: string }).code, 'cancelled');
  assert.equal((nextDecision(s, { ...input, tabHidden: true }) as { code: string }).code, 'tab-hidden');
  assert.equal((nextDecision(s, input) as { code: string }).code, 'loss-limit');
  const roomy = recordRound(make({ lossLimitCents: 10_000, stopOnAnyWin: true }), { costCents: 100, payoutCents: 10, featureTriggered: false, balanceAfterCents: 0 });
  assert.equal((nextDecision(roomy, { balanceCents: 0, nextCostCents: 100 }) as { code: string }).code, 'insufficient-balance');
});

test('recordRound is immutable, accumulates, and rejects invalid rounds', () => {
  const s = make();
  const next = recordRound(s, { costCents: 150, payoutCents: 40, featureTriggered: true, balanceAfterCents: 9_890 });
  assert.equal(s.spinsDone, 0);
  assert.equal(next.spinsDone, 1);
  assert.equal(next.spinsRemaining, 9);
  assert.equal(next.spentCents, 150);
  assert.equal(next.wonCents, 40);
  assert.deepEqual({ ...next.lastRound }, { payoutCents: 40, featureTriggered: true, balanceAfterCents: 9_890 });
  assert.ok(Object.isFrozen(next));
  for (const bad of [
    { costCents: -1, payoutCents: 0, featureTriggered: false, balanceAfterCents: 0 },
    { costCents: 1.5, payoutCents: 0, featureTriggered: false, balanceAfterCents: 0 },
    { costCents: 1, payoutCents: -1, featureTriggered: false, balanceAfterCents: 0 },
    { costCents: 1, payoutCents: 0, featureTriggered: false, balanceAfterCents: Number.NaN },
    { costCents: 1, payoutCents: 0, featureTriggered: 'yes' as unknown as boolean, balanceAfterCents: 0 },
    { costCents: 2 ** 53, payoutCents: 0, featureTriggered: false, balanceAfterCents: 0 },
  ]) assert.throws(() => recordRound(s, bad), RangeError, JSON.stringify(bad));
  // Remaining never goes negative.
  let done = make({ spins: 10 });
  for (let i = 0; i < 12; i += 1) done = lose(done, 1);
  assert.equal(done.spinsRemaining, 0);
});

test('a full loss-limited run stops at the right spin count', () => {
  const costs = 250;
  let s = make({ spins: 100, lossLimitCents: 1000 }, 100_000);
  let spins = 0;
  for (;;) {
    const d = nextDecision(s, { balanceCents: 100_000 - s.spentCents, nextCostCents: costs });
    if (!d.continue) { assert.equal(d.code, 'loss-limit'); break; }
    s = lose(s, costs);
    spins += 1;
    assert.ok(spins <= 100);
  }
  assert.equal(spins, 4);
  assert.equal(autoplayNetLossCents(s), 1000);
});
