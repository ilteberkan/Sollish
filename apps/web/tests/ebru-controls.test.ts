import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EBRU_BET_LEVELS_CENTS, EBRU_RTP, ebruSeedFromEntropy, playEbruRound, type EbruMode } from '@sollish/protocol';
import { DemoLedger } from '../lib/demo';
import { createAutoplay } from '../lib/slot-kit/autoplay';
import { modeCostCents } from '../lib/slot-kit/bet';
import {
  EBRU_BET_LADDER, EBRU_COST_MODES, EBRU_DEFAULT_BET_CENTS, EBRU_MAX_BET_CENTS, EBRU_MIN_BET_CENTS,
  ebruAutoplayAfterRound, ebruAutoplayBeforeSpin, ebruBuyBlockReason, ebruCost, ebruLedgerLimits, ebruRoundId, ebruRtp, ebruRtpRange, ebruRtpText, ebruTimelineOptions,
} from '../lib/ebru-controls';

const MODES: EbruMode[] = ['standard', 'ante', 'buy'];
const seedOf = (v: number) => ebruSeedFromEntropy(new Uint32Array([v, v, v, v]));

test('bet ladder and cost per mode follow the engine', () => {
  assert.deepEqual([...EBRU_BET_LADDER], [...EBRU_BET_LEVELS_CENTS]);
  assert.equal(EBRU_MIN_BET_CENTS, 100);
  assert.equal(EBRU_MAX_BET_CENTS, 50_000);
  assert.ok(EBRU_BET_LADDER.includes(EBRU_DEFAULT_BET_CENTS));
  for (const bet of EBRU_BET_LADDER) for (const mode of MODES) {
    assert.equal(ebruCost(bet, mode), modeCostCents(bet, EBRU_COST_MODES[mode]), `${bet} ${mode}`);
    assert.equal(ebruCost(bet, mode), playEbruRound('0'.repeat(32), bet, mode).costCents);
  }
  assert.equal(ebruCost(1000, 'ante'), 1250);
  assert.equal(ebruCost(1000, 'buy'), 100_000);
});

test('ledger limits: payout cap = 10000 × bet in every mode, tight and within the ledger ceilings', () => {
  for (const bet of EBRU_BET_LADDER) for (const mode of MODES) {
    const { maxMultiplier, maxStakeCents } = ebruLedgerLimits(bet, mode);
    const cost = ebruCost(bet, mode);
    assert.ok(cost * maxMultiplier >= 10_000 * bet, `${bet} ${mode} covers the engine cap`);
    assert.ok(cost * (maxMultiplier - 1) < 10_000 * bet, `${bet} ${mode} cap is tight`);
    assert.ok(maxMultiplier <= 10_000 && cost <= maxStakeCents);
  }
  assert.deepEqual(MODES.map(m => ebruLedgerLimits(1000, m).maxMultiplier), [10_000, 8000, 100]);
});

test('one reservation and one settlement with the engine payout, including a capped buy (10000 × bet)', () => {
  const round = playEbruRound(seedOf(3_373_783_151), 100, 'buy');
  assert.equal(round.capped, true);
  assert.equal(round.payoutCents, 1_000_000);
  const ledger = new DemoLedger();
  const id = ledger.reserve(10_000, () => 'cap', ebruLedgerLimits(100, 'buy'))!;
  assert.ok(id);
  assert.equal(ledger.settle({ id, stake: 10_000, payout: round.payoutCents }), true);
  assert.equal(ledger.balance, 100_000 - 10_000 + 1_000_000);
  assert.equal(ledger.settle({ id, stake: 10_000, payout: round.payoutCents }), false, 'second settlement refused');
  // The standard limit admits the full cap at the minimum bet: 10000 × 1 DEMO.
  const l2 = new DemoLedger();
  const id2 = l2.reserve(100, () => 'std', ebruLedgerLimits(100, 'standard'))!;
  assert.equal(l2.settle({ id: id2, stake: 100, payout: 1_000_000 }), true);
  assert.throws(() => { const l3 = new DemoLedger(); const id3 = l3.reserve(100, () => 'x', ebruLedgerLimits(100, 'standard'))!; l3.settle({ id: id3, stake: 100, payout: 1_000_001 }); }, RangeError);
});

test('buy block reasons in priority order', () => {
  const base = { betCents: 1000, balanceCents: 100_000, ante: false, autoplay: false, busy: false };
  assert.equal(ebruBuyBlockReason(base), null);
  assert.equal(ebruBuyBlockReason({ ...base, gated: true, autoplay: true }), 'Yalnız DEMO kredisiyle satın alınır');
  assert.equal(ebruBuyBlockReason({ ...base, autoplay: true, busy: true }), 'Otomatik oyun sürerken satın alınamaz');
  assert.equal(ebruBuyBlockReason({ ...base, busy: true, ante: true }), 'Tur bitmeden satın alınamaz');
  assert.equal(ebruBuyBlockReason({ ...base, ante: true }), 'Şans ×2 açıkken satın alınamaz');
  assert.match(ebruBuyBlockReason({ ...base, balanceCents: 99_999 })!, /^Bakiye yetersiz \(fiyat 1\.000,00 DEMO\)$/);
});

test('RTP text, round id and timeline options', () => {
  assert.equal(ebruRtp(0.957), '%95,7');
  assert.equal(ebruRtpRange(0.947, 0.967), '%94,7–96,7');
  assert.equal(ebruRtpText('standard'), `${ebruRtp(EBRU_RTP.standard.rtp)} (GA ${ebruRtpRange(EBRU_RTP.standard.ciLow, EBRU_RTP.standard.ciHigh)})`);
  for (const mode of MODES) assert.ok(EBRU_RTP[mode].rtp >= 0.94 && EBRU_RTP[mode].rtp <= 0.965, `${mode} RTP inside the owner band`);
  assert.equal(ebruRoundId('0123456789abcdef0123456789abcdef'), '0123…cdef');
  assert.deepEqual(ebruTimelineOptions({ spinSpeed: 'turbo', skipScreens: true }, true), { speed: 'turbo', skipScreens: true, reducedMotion: true });
});

test('autoplay adapter: one ledger round per spin, never buys, stops before the loss limit', () => {
  let state = createAutoplay({ spins: 10, lossLimitCents: 2500, stopOnAnyWin: false, stopOnFeature: true }, 100_000);
  let decision = ebruAutoplayBeforeSpin(state, { balanceCents: 100_000, betCents: 1000, ante: true, tabHidden: false });
  assert.equal(decision.continue, true); assert.equal(decision.costCents, 1250);
  state = ebruAutoplayAfterRound(state, { costCents: 1000, payoutCents: 0, featureTriggered: false, balanceBeforeCents: 100_000 });
  state = ebruAutoplayAfterRound(state, { costCents: 1000, payoutCents: 0, featureTriggered: false, balanceBeforeCents: 99_000 });
  decision = ebruAutoplayBeforeSpin(state, { balanceCents: 98_000, betCents: 1000, ante: false, tabHidden: false });
  assert.equal(decision.continue, false);
  if (!decision.continue) assert.equal(decision.code, 'loss-would-exceed');
  const feature = ebruAutoplayAfterRound(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { costCents: 1000, payoutCents: 300, featureTriggered: true, balanceBeforeCents: 100_000 });
  assert.equal(ebruAutoplayBeforeSpin(feature, { balanceCents: 99_300, betCents: 1000, ante: false, tabHidden: false }).continue, false);
  assert.equal(ebruAutoplayBeforeSpin(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { balanceCents: 100_000, betCents: 1000, ante: false, tabHidden: true }).continue, false);
});
