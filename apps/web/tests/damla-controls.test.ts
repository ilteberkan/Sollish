import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAMLA_BET_LEVELS_CENTS, DAMLA_EXACT_RTP, DAMLA_MODES, DAMLA_PAYTABLES, damlaSeedFromEntropy, playDamlaRound, type DamlaMode } from '@sollish/protocol';
import { DemoLedger } from '../lib/demo';
import { createAutoplay } from '../lib/slot-kit/autoplay';
import {
  DAMLA_BET_LADDER, DAMLA_DEFAULT_BET_CENTS, DAMLA_DEFAULT_RISK, DAMLA_DEFAULT_ROWS, DAMLA_MAX_BET_CENTS, DAMLA_MIN_BET_CENTS, DAMLA_MIN_EXACT_RTP, DAMLA_RAIN_COUNTS,
  damlaAffordable, damlaAutoplayAfterRound, damlaAutoplayBeforeDrop, damlaCap, damlaCost, damlaDropLocked, damlaLedgerLimits, damlaMode, damlaModeFacts, damlaModeLocked,
  damlaMultiplierText, damlaPayout, damlaPercent, damlaRoundId, damlaSettleReady, damlaShownBalance, parseDamlaMode,
} from '../lib/damla-controls';

const seedOf = (v: number) => damlaSeedFromEntropy(new Uint32Array([v, v, v, v]));
const idle = { inFlight: 0, autoplay: false, replaying: false, pending: false };

test('bet ladder, default mode and cost follow the engine', () => {
  assert.deepEqual([...DAMLA_BET_LADDER], [...DAMLA_BET_LEVELS_CENTS]);
  assert.equal(DAMLA_MIN_BET_CENTS, 100); assert.equal(DAMLA_MAX_BET_CENTS, 50_000);
  assert.ok(DAMLA_BET_LADDER.includes(DAMLA_DEFAULT_BET_CENTS));
  assert.equal(damlaMode(DAMLA_DEFAULT_RISK, DAMLA_DEFAULT_ROWS), 'medium-12');
  for (const bet of DAMLA_BET_LADDER) assert.equal(damlaCost(bet), bet);
  assert.deepEqual(DAMLA_RAIN_COUNTS, [5, 10]);
  for (const mode of DAMLA_MODES) { const p = parseDamlaMode(mode)!; assert.equal(damlaMode(p.risk, p.rows), mode); }
  for (const bad of ['standard', 'medium-11', 'MEDIUM-12', '', '__proto__']) assert.equal(parseDamlaMode(bad), null);
});

test('payout and ledger limits: integer floor, the cap fits the DEMO ledger, every pool of every mode settles', () => {
  for (const mode of DAMLA_MODES) {
    const limits = damlaLedgerLimits(mode);
    assert.equal(limits.maxMultiplier, Math.ceil(damlaCap(mode) / 100));
    DAMLA_PAYTABLES[mode].forEach((h, slot) => assert.equal(damlaPayout(1500, mode, slot), Math.floor(1500 * h / 100)));
  }
  assert.equal(damlaLedgerLimits('high-16').maxMultiplier, 1000);
  // A capped high-16 drop at the max bet is admitted and settled by the DEMO ledger (500 DEMO x 1000).
  const ledger = new DemoLedger();
  let n = 0;
  const id = ledger.reserve(50_000, () => `id-${n++}`, damlaLedgerLimits('high-16'))!;
  assert.ok(id);
  assert.equal(ledger.settle({ id, stake: 50_000, payout: damlaPayout(50_000, 'high-16', 16) }), true);
  assert.equal(ledger.balance, 100_000 - 50_000 + 50_000_000);
});

test('engine rounds agree with the payout helper for many seeds and modes', () => {
  for (let v = 1; v < 400; v++) {
    const mode = DAMLA_MODES[v % DAMLA_MODES.length]!;
    const round = playDamlaRound(seedOf(v * 2_654_435_761 >>> 0), 300, mode);
    assert.equal(round.payoutCents, damlaPayout(300, mode, round.slot));
    assert.equal(round.costCents, damlaCost(300));
  }
});

test('mode, terraces, bet and Drop are locked while any drop is in flight, a request is pending, autobet or a replay runs', () => {
  assert.equal(damlaModeLocked(idle), false); assert.equal(damlaDropLocked(idle), false);
  for (const patch of [{ inFlight: 1 }, { inFlight: 10 }, { autoplay: true }, { replaying: true }, { pending: true }, { gated: true }, { booting: true }]) {
    assert.equal(damlaModeLocked({ ...idle, ...patch }), true, JSON.stringify(patch));
    assert.equal(damlaDropLocked({ ...idle, ...patch }), true, JSON.stringify(patch));
  }
});

test('shown balance holds back the payouts of drops that have not landed; unseen winnings are never staked', () => {
  // ledger after two admitted drops of 10: 1000 - 10 + 33 - 10 + 3 = 1016
  assert.equal(damlaShownBalance(1016, [{ costCents: 10, payoutCents: 33 }, { costCents: 10, payoutCents: 3 }]), 980);
  assert.equal(damlaShownBalance(1016, []), 1016);
  assert.equal(damlaShownBalance(5, [{ costCents: 1, payoutCents: 50 }]), 0);
  assert.equal(damlaAffordable(1000, 100, 10), true);
  assert.equal(damlaAffordable(999, 100, 10), false);
  assert.equal(damlaAffordable(1000, 0), false);
});

test('rain drops settle strictly in admission order, even when a later drop lands first', () => {
  assert.deepEqual(damlaSettleReady([]), []);
  assert.deepEqual(damlaSettleReady([{ seq: 1, landed: true, settled: false }, { seq: 2, landed: false, settled: false }, { seq: 3, landed: true, settled: false }]), [1]);
  assert.deepEqual(damlaSettleReady([{ seq: 3, landed: true, settled: false }, { seq: 1, landed: true, settled: true }, { seq: 2, landed: true, settled: false }]), [2, 3]);
  assert.deepEqual(damlaSettleReady([{ seq: 1, landed: false, settled: false }, { seq: 2, landed: true, settled: false }]), []);
});

test('autobet: loss limit is mandatory and checked before a drop; stops on single win and balance target', () => {
  let state = createAutoplay({ spins: 10, lossLimitCents: 250, stopOnAnyWin: false, stopOnFeature: false }, 10_000);
  let balance = 10_000;
  const drops: number[] = [];
  // 100-cent drops that each pay 30: net loss 70 per drop -> after 3 drops net loss 210; the 4th would reach 310 > 250.
  for (;;) {
    const decision = damlaAutoplayBeforeDrop(state, { balanceCents: balance, betCents: 100, tabHidden: false });
    if (!decision.continue) { assert.equal(decision.code, 'loss-would-exceed'); break; }
    state = damlaAutoplayAfterRound(state, { costCents: 100, payoutCents: 30, balanceBeforeCents: balance });
    balance = balance - 100 + 30; drops.push(balance);
  }
  assert.equal(drops.length, 3); assert.equal(state.spentCents - state.wonCents, 210);
  const win = damlaAutoplayAfterRound(createAutoplay({ spins: 10, lossLimitCents: 1000, singleWinLimitCents: 500, stopOnAnyWin: false, stopOnFeature: false }, 10_000), { costCents: 100, payoutCents: 600, balanceBeforeCents: 10_000 });
  assert.equal(damlaAutoplayBeforeDrop(win, { balanceCents: 10_500, betCents: 100, tabHidden: false }).code, 'single-win');
  const up = damlaAutoplayAfterRound(createAutoplay({ spins: 10, lossLimitCents: 1000, balanceIncreaseCents: 300, stopOnAnyWin: false, stopOnFeature: false }, 10_000), { costCents: 100, payoutCents: 450, balanceBeforeCents: 10_000 });
  assert.equal(damlaAutoplayBeforeDrop(up, { balanceCents: 10_350, betCents: 100, tabHidden: false }).code, 'balance-increase');
  assert.equal(damlaAutoplayBeforeDrop(up, { balanceCents: 10_350, betCents: 100, tabHidden: true }).code, 'tab-hidden');
  assert.equal(win.lastRound?.featureTriggered, false);
});

test('facts per mode: exact RTP in 98-99 %, house edge >= 1 %, multiplier and percent text', () => {
  for (const mode of DAMLA_MODES) {
    const f = damlaModeFacts(mode as DamlaMode);
    assert.equal(f.exact, DAMLA_EXACT_RTP[mode]);
    assert.ok(f.exact >= 0.98 && f.exact <= 0.99, mode);
    assert.ok(f.houseEdge >= 0.01, mode);
  }
  assert.equal(DAMLA_MIN_EXACT_RTP, Math.min(...Object.values(DAMLA_EXACT_RTP)));
  assert.equal(damlaMultiplierText(100_000, 'en'), '1000');
  assert.equal(damlaMultiplierText(3300, 'en'), '33');
  assert.equal(damlaMultiplierText(250, 'tr'), '2,5');
  assert.equal(damlaMultiplierText(33, 'en'), '0.33');
  assert.equal(damlaPercent(0.984467773, 'en'), '98.45%');
  assert.equal(damlaPercent(0.984467773, 'tr'), '%98,45');
  assert.equal(damlaRoundId('0123456789abcdef0123456789abcdef'), '0123…cdef');
});
