import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOREME_BET_LEVELS_CENTS, GOREME_RTP, goremeSeedFromEntropy, playGoremeRound, type GoremeMode } from '@sollish/protocol';
import { DemoLedger } from '../lib/demo';
import { createAutoplay } from '../lib/slot-kit/autoplay';
import { modeCostCents } from '../lib/slot-kit/bet';
import {
  GOREME_AUTOPLAY_GAP, GOREME_BET_LADDER, GOREME_COST_MODES, GOREME_DEFAULT_BET_CENTS, GOREME_MAX_BET_CENTS, GOREME_MIN_BET_CENTS,
  goremeAutoplayAfterRound, goremeAutoplayBeforeSpin, goremeBuyBlock, goremeCost, goremeLedgerLimits, goremeRoundId, goremeRtp, goremeRtpRange, goremeRtpText, goremeTimelineOptions,
} from '../lib/goreme-controls';

const MODES: GoremeMode[] = ['standard', 'ante', 'buy'];
const seedOf = (v: number) => goremeSeedFromEntropy(new Uint32Array([v, v, v, v]));

test('bet ladder and cost per mode follow the engine (ante x5/4, buy x100)', () => {
  assert.deepEqual([...GOREME_BET_LADDER], [...GOREME_BET_LEVELS_CENTS]);
  assert.equal(GOREME_MIN_BET_CENTS, 100);
  assert.equal(GOREME_MAX_BET_CENTS, 50_000);
  assert.ok(GOREME_BET_LADDER.includes(GOREME_DEFAULT_BET_CENTS));
  for (const bet of GOREME_BET_LADDER) for (const mode of MODES) {
    assert.equal(goremeCost(bet, mode), modeCostCents(bet, GOREME_COST_MODES[mode]), `${bet} ${mode}`);
    assert.equal(goremeCost(bet, mode), playGoremeRound('0'.repeat(32), bet, mode).costCents);
  }
  assert.equal(goremeCost(1000, 'ante'), 1250);
  assert.equal(goremeCost(1000, 'buy'), 100_000);
  assert.throws(() => goremeCost(1001, 'standard'), RangeError);
});

test('ledger limits: payout cap = 10 000 × bet in every mode, tight and within the ledger ceilings', () => {
  for (const bet of GOREME_BET_LADDER) for (const mode of MODES) {
    const { maxMultiplier, maxStakeCents } = goremeLedgerLimits(bet, mode);
    const cost = goremeCost(bet, mode);
    assert.ok(cost * maxMultiplier >= 10_000 * bet, `${bet} ${mode} covers the engine cap`);
    assert.ok(cost * (maxMultiplier - 1) < 10_000 * bet, `${bet} ${mode} cap is tight`);
    assert.ok(maxMultiplier <= 10_000 && cost <= maxStakeCents);
  }
  assert.deepEqual(MODES.map(m => goremeLedgerLimits(1000, m).maxMultiplier), [10_000, 8000, 100]);
});

test('one reservation and one settlement with the engine payout; the cap at the minimum bet fits the ledger', () => {
  const round = playGoremeRound(seedOf(4_139_144_192), 1000, 'buy');
  const ledger = new DemoLedger();
  const id = ledger.reserve(round.costCents, () => 'g1', goremeLedgerLimits(1000, 'buy'))!;
  assert.ok(id);
  assert.equal(ledger.settle({ id, stake: round.costCents, payout: round.payoutCents }), true);
  assert.equal(ledger.balance, 100_000 - 100_000 + round.payoutCents);
  assert.equal(ledger.settle({ id, stake: round.costCents, payout: round.payoutCents }), false, 'second settlement refused');
  const l2 = new DemoLedger();
  const id2 = l2.reserve(100, () => 'std', goremeLedgerLimits(100, 'standard'))!;
  assert.equal(l2.settle({ id: id2, stake: 100, payout: 1_000_000 }), true, '10 000 × 1 DEMO');
});

test('buy block reasons in priority order', () => {
  const base = { betCents: 1000, balanceCents: 200_000, ante: false, autoplay: false, busy: false };
  assert.equal(goremeBuyBlock(base), null);
  assert.deepEqual(goremeBuyBlock({ ...base, gated: true, autoplay: true }), { code: 'gated' });
  assert.deepEqual(goremeBuyBlock({ ...base, autoplay: true, busy: true }), { code: 'autoplay' });
  assert.deepEqual(goremeBuyBlock({ ...base, busy: true, ante: true }), { code: 'busy' });
  assert.deepEqual(goremeBuyBlock({ ...base, ante: true }), { code: 'ante' });
  assert.deepEqual(goremeBuyBlock({ ...base, balanceCents: 99_999 }), { code: 'balance', priceCents: 100_000 });
});

test('RTP text inside the owner band, round id, timeline options and autoplay gaps', () => {
  for (const mode of MODES) assert.ok(GOREME_RTP[mode].rtp >= 0.94 && GOREME_RTP[mode].rtp <= 0.965, `${mode} RTP inside 94–96.5 %`);
  assert.equal(goremeRtp(0.963), '%96,3');
  assert.equal(goremeRtp(0.963, 'en'), '96.3%');
  assert.equal(goremeRtpRange(0.957, 0.968), '%95,7–96,8');
  assert.equal(goremeRtpText('standard'), `${goremeRtp(GOREME_RTP.standard.rtp)} (${goremeRtpRange(GOREME_RTP.standard.ciLow, GOREME_RTP.standard.ciHigh)})`);
  assert.equal(goremeRoundId('0123456789abcdef0123456789abcdef'), '0123…cdef');
  assert.deepEqual(goremeTimelineOptions({ spinSpeed: 'turbo', skipScreens: true }, true), { speed: 'turbo', skipScreens: true, reducedMotion: true });
  assert.ok(GOREME_AUTOPLAY_GAP.turbo < GOREME_AUTOPLAY_GAP.quick && GOREME_AUTOPLAY_GAP.quick < GOREME_AUTOPLAY_GAP.normal);
});

test('autoplay adapter: one ledger round per spin, never buys, stops before the loss limit, on a feature and when hidden', () => {
  let state = createAutoplay({ spins: 10, lossLimitCents: 2500, stopOnAnyWin: false, stopOnFeature: true }, 100_000);
  let decision = goremeAutoplayBeforeSpin(state, { balanceCents: 100_000, betCents: 1000, ante: true, tabHidden: false });
  assert.equal(decision.continue, true); assert.equal(decision.costCents, 1250);
  state = goremeAutoplayAfterRound(state, { costCents: 1000, payoutCents: 0, featureTriggered: false, balanceBeforeCents: 100_000 });
  state = goremeAutoplayAfterRound(state, { costCents: 1000, payoutCents: 0, featureTriggered: false, balanceBeforeCents: 99_000 });
  decision = goremeAutoplayBeforeSpin(state, { balanceCents: 98_000, betCents: 1000, ante: false, tabHidden: false });
  assert.equal(decision.continue, false);
  if (!decision.continue) assert.equal(decision.code, 'loss-would-exceed');
  const feature = goremeAutoplayAfterRound(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { costCents: 1000, payoutCents: 300, featureTriggered: true, balanceBeforeCents: 100_000 });
  assert.equal(goremeAutoplayBeforeSpin(feature, { balanceCents: 99_300, betCents: 1000, ante: false, tabHidden: false }).continue, false);
  assert.equal(goremeAutoplayBeforeSpin(createAutoplay({ spins: 10, lossLimitCents: 5000, stopOnAnyWin: false, stopOnFeature: true }, 100_000), { balanceCents: 100_000, betCents: 1000, ante: false, tabHidden: true }).continue, false);
});
