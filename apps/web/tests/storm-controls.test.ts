import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORM_BET_LEVELS_CENTS, STORM_RTP, playStormRound, stormSeedFromEntropy, type StormMode } from '@sollish/protocol';
import { DemoLedger } from '../lib/demo';
import { createAutoplay } from '../lib/slot-kit/autoplay';
import { modeCostCents } from '../lib/slot-kit/bet';
import {
  STORM_BET_LADDER, STORM_COST_MODES, STORM_DEFAULT_BET_CENTS, STORM_MAX_BET_CENTS, STORM_MIN_BET_CENTS,
  stormAutoplayAfterRound, stormAutoplayBeforeSpin, stormBuyBlockReason, stormCost, stormLedgerLimits, stormRoundId, stormRtp, stormRtpRange, stormRtpText, stormTimelineOptions,
} from '../lib/storm-controls';

const MODES: StormMode[] = ['standard', 'ante', 'buy'];

test('bet ladder and cost per mode follow the engine', () => {
  assert.deepEqual([...STORM_BET_LADDER], [...STORM_BET_LEVELS_CENTS]);
  assert.equal(STORM_MIN_BET_CENTS, 100);
  assert.equal(STORM_MAX_BET_CENTS, 50_000);
  assert.ok(STORM_BET_LADDER.includes(STORM_DEFAULT_BET_CENTS));
  for (const bet of STORM_BET_LADDER) for (const mode of MODES) {
    assert.equal(stormCost(bet, mode), modeCostCents(bet, STORM_COST_MODES[mode]), `${bet} ${mode}`);
    assert.equal(stormCost(bet, mode), playStormRound('0'.repeat(32), bet, mode).costCents);
  }
  assert.equal(stormCost(1000, 'ante'), 1250);
  assert.equal(stormCost(1000, 'buy'), 100_000);
});

test('ledger limits: payout cap = 5000 × bet in every mode, within the ledger ceilings', () => {
  for (const bet of STORM_BET_LADDER) for (const mode of MODES) {
    const { maxMultiplier, maxStakeCents } = stormLedgerLimits(bet, mode);
    const cost = stormCost(bet, mode);
    assert.ok(cost * maxMultiplier >= 5000 * bet, `${bet} ${mode} covers the engine cap`);
    assert.ok(maxMultiplier <= 5000 && cost <= maxStakeCents);
  }
  assert.deepEqual(MODES.map(m => stormLedgerLimits(1000, m).maxMultiplier), [5000, 4000, 50]);
});

test('one reservation and one settlement with the engine payout, including a capped buy at the max bet ceiling', () => {
  const ledger = new DemoLedger();
  let n = 0;
  const id = ledger.reserve(100_000, () => `t${++n}`, stormLedgerLimits(1000, 'buy'));
  assert.ok(id);
  const round = playStormRound(stormSeedFromEntropy(new Uint32Array([85_964_127, 85_964_127, 85_964_127, 85_964_127])), 1000, 'buy');
  assert.equal(ledger.settle({ id: id!, stake: 100_000, payout: round.payoutCents }), true);
  assert.equal(ledger.balance, 100_000 - 100_000 + round.payoutCents);
  assert.equal(ledger.settle({ id: id!, stake: 100_000, payout: round.payoutCents }), false, 'second settlement refused');
  // A capped round at 1 DEMO buy pays exactly 5000 × bet = 50 × cost: admitted by the buy limit.
  const l2 = new DemoLedger();
  const id2 = l2.reserve(10_000, () => 'cap', stormLedgerLimits(100, 'buy'))!;
  assert.equal(l2.settle({ id: id2, stake: 10_000, payout: 500_000 }), true);
  // The ante limit admits the standard cap at 5000 × bet.
  const l3 = new DemoLedger();
  const id3 = l3.reserve(1250, () => 'ante', stormLedgerLimits(1000, 'ante'))!;
  assert.equal(l3.settle({ id: id3, stake: 1250, payout: 5_000_000 }), true);
});

test('buy block reasons in priority order', () => {
  const base = { betCents: 1000, balanceCents: 100_000, ante: false, autoplay: false, busy: false };
  assert.equal(stormBuyBlockReason(base), null);
  assert.equal(stormBuyBlockReason({ ...base, gated: true, autoplay: true }), 'Yalnız DEMO kredisiyle satın alınır');
  assert.equal(stormBuyBlockReason({ ...base, autoplay: true, busy: true }), 'Otomatik oyun sürerken satın alınamaz');
  assert.equal(stormBuyBlockReason({ ...base, busy: true, ante: true }), 'Tur bitmeden satın alınamaz');
  assert.equal(stormBuyBlockReason({ ...base, ante: true }), 'Şans ×2 açıkken satın alınamaz');
  assert.equal(stormBuyBlockReason({ ...base, balanceCents: 99_999 }), 'Bakiye yetersiz (fiyat 1.000,00 DEMO)');
});

test('RTP texts come from STORM_RTP', () => {
  assert.equal(stormRtp(0.965), '%96,5');
  assert.equal(stormRtpRange(0.959, 0.97), '%95,9–97,0');
  assert.equal(stormRtpText('buy'), `${stormRtp(STORM_RTP.buy.rtp)} (GA ${stormRtpRange(STORM_RTP.buy.ciLow, STORM_RTP.buy.ciHigh)})`);
  assert.equal(stormRoundId('0123456789abcdef0123456789abcdef'), '0123…cdef');
  assert.deepEqual(stormTimelineOptions({ spinSpeed: 'turbo', skipScreens: true }, true), { speed: 'turbo', skipScreens: true, reducedMotion: true });
});

test('autoplay: loss limit stops before a spin that would exceed it; ante cost counts; buy is never used', () => {
  let state = createAutoplay({ spins: 10, lossLimitCents: 2500, stopOnAnyWin: false, stopOnFeature: true }, 100_000);
  let balance = 100_000;
  for (let i = 0; i < 2; i++) {
    const d = stormAutoplayBeforeSpin(state, { balanceCents: balance, betCents: 1000, ante: false, tabHidden: false });
    assert.equal(d.continue, true);
    assert.equal(d.costCents, 1000);
    state = stormAutoplayAfterRound(state, { costCents: 1000, payoutCents: 0, featureTriggered: false, balanceBeforeCents: balance });
    balance -= 1000;
  }
  const third = stormAutoplayBeforeSpin(state, { balanceCents: balance, betCents: 1000, ante: false, tabHidden: false });
  assert.equal(third.continue, false);
  const ante = stormAutoplayBeforeSpin(createAutoplay({ spins: 10, lossLimitCents: 1000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { balanceCents: 100_000, betCents: 1000, ante: true, tabHidden: false });
  assert.equal(ante.costCents, 1250);
  assert.equal(ante.continue, false, 'an ante spin (12,50) exceeds a 10 DEMO loss limit');
  const hidden = stormAutoplayBeforeSpin(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { balanceCents: 100_000, betCents: 1000, ante: false, tabHidden: true });
  assert.equal(hidden.continue, false);
  const feature = stormAutoplayAfterRound(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { costCents: 1000, payoutCents: 4000, featureTriggered: true, balanceBeforeCents: 100_000 });
  assert.equal(stormAutoplayBeforeSpin(feature, { balanceCents: 103_000, betCents: 1000, ante: false, tabHidden: false }).continue, false, 'stops after free spins');
});
