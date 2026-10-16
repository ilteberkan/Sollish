import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASENA_BET_LEVELS_CENTS, ASENA_RTP, asenaSeedFromEntropy, playAsenaRound, type AsenaMode } from '@sollish/protocol';
import { DemoLedger } from '../lib/demo';
import { createAutoplay } from '../lib/slot-kit/autoplay';
import { modeCostCents } from '../lib/slot-kit/bet';
import {
  ASENA_BET_LADDER, ASENA_COST_MODES, ASENA_DEFAULT_BET_CENTS, ASENA_MAX_BET_CENTS, ASENA_MIN_BET_CENTS,
  asenaAutoplayAfterRound, asenaAutoplayBeforeSpin, asenaBuyBlockReason, asenaCost, asenaLedgerLimits, asenaRoundId, asenaRtp, asenaRtpRange, asenaRtpText, asenaTimelineOptions,
} from '../lib/asena-controls';

const MODES: AsenaMode[] = ['standard', 'ante', 'buy'];
const seedOf = (v: number) => asenaSeedFromEntropy(new Uint32Array([v, v, v, v]));

test('bet ladder and cost per mode follow the engine', () => {
  assert.deepEqual([...ASENA_BET_LADDER], [...ASENA_BET_LEVELS_CENTS]);
  assert.equal(ASENA_MIN_BET_CENTS, 100);
  assert.equal(ASENA_MAX_BET_CENTS, 50_000);
  assert.ok(ASENA_BET_LADDER.includes(ASENA_DEFAULT_BET_CENTS));
  for (const bet of ASENA_BET_LADDER) for (const mode of MODES) {
    assert.equal(asenaCost(bet, mode), modeCostCents(bet, ASENA_COST_MODES[mode]), `${bet} ${mode}`);
    assert.equal(asenaCost(bet, mode), playAsenaRound('0'.repeat(32), bet, mode).costCents);
  }
  assert.equal(asenaCost(1000, 'ante'), 1250);
  assert.equal(asenaCost(1000, 'buy'), 80_000);
});

test('ledger limits: payout cap = 5000 × bet in every mode, tight and within the ledger ceilings', () => {
  for (const bet of ASENA_BET_LADDER) for (const mode of MODES) {
    const { maxMultiplier, maxStakeCents } = asenaLedgerLimits(bet, mode);
    const cost = asenaCost(bet, mode);
    assert.ok(cost * maxMultiplier >= 5000 * bet, `${bet} ${mode} covers the engine cap`);
    assert.ok(cost * (maxMultiplier - 1) < 5000 * bet, `${bet} ${mode} cap is tight`);
    assert.ok(maxMultiplier <= 5000 && cost <= maxStakeCents);
  }
  assert.deepEqual(MODES.map(m => asenaLedgerLimits(1000, m).maxMultiplier), [5000, 4000, 63]);
});

test('one reservation and one settlement with the engine payout, including a capped buy (5000 × bet)', () => {
  const round = playAsenaRound(seedOf(4_054_600_391), 100, 'buy');
  assert.equal(round.capped, true);
  assert.equal(round.payoutCents, 500_000);
  const ledger = new DemoLedger();
  const id = ledger.reserve(8000, () => 'cap', asenaLedgerLimits(100, 'buy'))!;
  assert.ok(id);
  assert.equal(ledger.settle({ id, stake: 8000, payout: round.payoutCents }), true);
  assert.equal(ledger.balance, 100_000 - 8000 + 500_000);
  assert.equal(ledger.settle({ id, stake: 8000, payout: round.payoutCents }), false, 'second settlement refused');
  // The standard limit admits the full cap at the minimum bet: 5000 × 1 DEMO.
  const l2 = new DemoLedger();
  const id2 = l2.reserve(100, () => 'std', asenaLedgerLimits(100, 'standard'))!;
  assert.equal(l2.settle({ id: id2, stake: 100, payout: 500_000 }), true);
  assert.throws(() => { const l3 = new DemoLedger(); const id3 = l3.reserve(100, () => 'x', asenaLedgerLimits(100, 'standard'))!; l3.settle({ id: id3, stake: 100, payout: 500_001 }); }, RangeError);
});

test('buy block reasons in priority order', () => {
  const base = { betCents: 1000, balanceCents: 100_000, ante: false, autoplay: false, busy: false };
  assert.equal(asenaBuyBlockReason(base), null);
  assert.equal(asenaBuyBlockReason({ ...base, gated: true, autoplay: true }), 'Yalnız DEMO kredisiyle satın alınır');
  assert.equal(asenaBuyBlockReason({ ...base, autoplay: true, busy: true }), 'Otomatik oyun sürerken satın alınamaz');
  assert.equal(asenaBuyBlockReason({ ...base, busy: true, ante: true }), 'Tur bitmeden satın alınamaz');
  assert.equal(asenaBuyBlockReason({ ...base, ante: true }), 'Şans ×2 açıkken satın alınamaz');
  assert.match(asenaBuyBlockReason({ ...base, balanceCents: 79_999 })!, /^Bakiye yetersiz \(fiyat 800,00 DEMO\)$/);
});

test('RTP text, round id and timeline options', () => {
  assert.equal(asenaRtp(0.952), '%95,2');
  assert.equal(asenaRtpRange(0.947, 0.967), '%94,7–96,7');
  assert.equal(asenaRtpText('standard'), `${asenaRtp(ASENA_RTP.standard.rtp)} (GA ${asenaRtpRange(ASENA_RTP.standard.ciLow, ASENA_RTP.standard.ciHigh)})`);
  for (const mode of MODES) assert.ok(ASENA_RTP[mode].rtp >= 0.94 && ASENA_RTP[mode].rtp <= 0.965, `${mode} RTP inside the owner band`);
  assert.equal(asenaRoundId('0123456789abcdef0123456789abcdef'), '0123…cdef');
  assert.deepEqual(asenaTimelineOptions({ spinSpeed: 'turbo', skipScreens: true }, true), { speed: 'turbo', skipScreens: true, reducedMotion: true });
});

test('autoplay adapter: one ledger round per spin, never buys, stops before the loss limit', () => {
  let state = createAutoplay({ spins: 10, lossLimitCents: 2500, stopOnAnyWin: false, stopOnFeature: true }, 100_000);
  let decision = asenaAutoplayBeforeSpin(state, { balanceCents: 100_000, betCents: 1000, ante: true, tabHidden: false });
  assert.equal(decision.continue, true); assert.equal(decision.costCents, 1250);
  state = asenaAutoplayAfterRound(state, { costCents: 1000, payoutCents: 0, featureTriggered: false, balanceBeforeCents: 100_000 });
  state = asenaAutoplayAfterRound(state, { costCents: 1000, payoutCents: 0, featureTriggered: false, balanceBeforeCents: 99_000 });
  decision = asenaAutoplayBeforeSpin(state, { balanceCents: 98_000, betCents: 1000, ante: false, tabHidden: false });
  assert.equal(decision.continue, false);
  if (!decision.continue) assert.equal(decision.code, 'loss-would-exceed');
  const feature = asenaAutoplayAfterRound(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { costCents: 1000, payoutCents: 300, featureTriggered: true, balanceBeforeCents: 100_000 });
  assert.equal(asenaAutoplayBeforeSpin(feature, { balanceCents: 99_300, betCents: 1000, ante: false, tabHidden: false }).continue, false);
  assert.equal(asenaAutoplayBeforeSpin(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { balanceCents: 100_000, betCents: 1000, ante: false, tabHidden: true }).continue, false);
});
