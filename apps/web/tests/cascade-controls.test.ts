import test from 'node:test';
import assert from 'node:assert/strict';
import { CASCADE2_BET_LEVELS_CENTS, CASCADE2_RTP, cascadeSeedFromEntropy, playCascade2Round, type CascadeMode } from '@sollish/protocol';
import {
  CASCADE_BET_LADDER, CASCADE_COST_MODES, autoplayAfterRound, autoplayBeforeSpin, buyBlockReason, cascadeCost, cascadeLedgerLimits,
  cascadeRtpText, cascadeTimelineOptions, formatRtp, formatRtpRange, shortRoundId,
} from '../lib/cascade-controls';
import { buildCascadeTimeline, CASCADE_SKIP_SCREEN_HOLD, CASCADE_SPEED_FACTOR, type TimelineEvent } from '../lib/cascade-timeline';
import { SKIP_COUNT_UP_MS, SKIP_HOLD_MS, countUpSchedule } from '../lib/slot-kit/win-tiers';
import { createAutoplay, type AutoplayConfig } from '../lib/slot-kit/autoplay';
import { betLevels, modeCostCents } from '../lib/slot-kit/bet';
import { DemoLedger } from '../lib/demo';

const seedOf = (value: number) => cascadeSeedFromEntropy(new Uint32Array([value, value, value, value]));
const FREE = 1_621_328_416;
const MODES: CascadeMode[] = ['standard', 'ante', 'buy'];

test('cost per mode equals the engine and the kit ratio for every bet level', () => {
  assert.deepEqual([...CASCADE_BET_LADDER], [...CASCADE2_BET_LEVELS_CENTS]);
  for (const bet of CASCADE2_BET_LEVELS_CENTS) for (const mode of MODES) {
    assert.equal(cascadeCost(bet, mode), modeCostCents(bet, CASCADE_COST_MODES[mode]), `${bet} ${mode}`);
  }
  assert.equal(cascadeCost(1000, 'standard'), 1000);
  assert.equal(cascadeCost(1000, 'ante'), 1250);
  assert.equal(cascadeCost(1000, 'buy'), 100_000);
  assert.throws(() => cascadeCost(1234, 'standard'), RangeError);
});

test('bet levels above the balance are disabled for the selected mode cost', () => {
  const ante = betLevels(CASCADE_BET_LADDER, { balanceCents: 10_000, cost: CASCADE_COST_MODES.ante });
  // 75 DEMO x 1,25 = 93,75 DEMO fits; 100 DEMO x 1,25 = 125 does not.
  assert.equal(ante.find(l => l.betCents === 7500)!.enabled, true);
  assert.equal(ante.find(l => l.betCents === 10_000)!.enabled, false);
  assert.equal(ante.find(l => l.betCents === 10_000)!.reason, 'balance');
});

test('ledger limits let every mode pay the 5000x bet cap and nothing more, inside the ledger ceilings', () => {
  for (const bet of CASCADE2_BET_LEVELS_CENTS) for (const mode of MODES) {
    const cost = cascadeCost(bet, mode);
    const { maxMultiplier, maxStakeCents } = cascadeLedgerLimits(bet, mode);
    assert.ok(maxMultiplier >= 1 && maxMultiplier <= 5000);
    assert.ok(cost * maxMultiplier >= 5000 * bet, `${bet} ${mode} cap covers the engine cap`);
    assert.ok(cost * (maxMultiplier - 1) < 5000 * bet, `${bet} ${mode} cap is tight`);
    assert.ok(cost <= maxStakeCents);
  }
  assert.deepEqual(MODES.map(mode => cascadeLedgerLimits(1000, mode).maxMultiplier), [5000, 4000, 50]);
  // A real engine payout settles through the real ledger with these limits.
  const round = playCascade2Round(seedOf(FREE), 500, 'buy');
  const ledger = new DemoLedger();
  const id = ledger.reserve(round.costCents, () => 'buy', cascadeLedgerLimits(500, 'buy'));
  assert.equal(id, 'buy');
  assert.equal(ledger.settle({ id: 'buy', stake: round.costCents, payout: round.payoutCents }), true);
  assert.equal(ledger.balance, 100_000 - round.costCents + round.payoutCents);
});

test('RTP text comes from the engine evidence, Turkish formatting', () => {
  assert.equal(formatRtp(0.962), '%96,2');
  assert.equal(formatRtp(0.9575), '%95,8');
  assert.equal(formatRtpRange(0.951, 0.963), '%95,1–96,3');
  assert.equal(cascadeRtpText('buy'), `${formatRtp(CASCADE2_RTP.buy.rtp)} (GA ${formatRtpRange(CASCADE2_RTP.buy.ciLow, CASCADE2_RTP.buy.ciHigh)})`);
});

test('buy is blocked with a visible reason: autoplay, round, ante, balance', () => {
  const base = { betCents: 1000, balanceCents: 100_000, ante: false, autoplay: false, busy: false };
  assert.equal(buyBlockReason(base), null);
  assert.match(buyBlockReason({ ...base, autoplay: true })!, /Otomatik oyun/);
  assert.match(buyBlockReason({ ...base, busy: true })!, /Tur bitmeden/);
  assert.match(buyBlockReason({ ...base, ante: true })!, /Şans ×2/);
  assert.match(buyBlockReason({ ...base, balanceCents: 99_999 })!, /Bakiye yetersiz \(fiyat 1\.000,00 DEMO\)/);
  assert.match(buyBlockReason({ ...base, gated: true })!, /DEMO/);
});

test('speed and skip-screens map to the timeline; holds stay visible but shorter', () => {
  assert.deepEqual(cascadeTimelineOptions({ spinSpeed: 'quick', skipScreens: true }, false), { speed: 'quick', skipScreens: true, reducedMotion: false });
  const round = playCascade2Round(seedOf(FREE), 1000, 'standard');
  const normal = buildCascadeTimeline(round);
  const quick = buildCascadeTimeline(round, { speed: 'quick' });
  const skip = buildCascadeTimeline(round, { skipScreens: true });
  assert.equal(quick.speed, 'quick'); assert.equal(skip.skipScreens, true);
  const kinds = (events: TimelineEvent[]) => events.map(e => e.type).join();
  assert.equal(kinds(quick.events), kinds(normal.events));
  assert.equal(kinds(skip.events), kinds(normal.events));
  for (let i = 0; i < normal.events.length; i++) {
    const n = normal.events[i]!, q = quick.events[i]!, s = skip.events[i]!;
    if ('hold' in n) {
      if (n.type === 'big-win' && s.type === 'big-win' && q.type === 'big-win') {
        // The celebration follows the shared count-up schedule: quick is shorter, skipped screens are capped.
        assert.deepEqual(q.schedule, countUpSchedule(round.totalHundredths, round.capped, { speed: 'quick' }));
        assert.ok(q.countUp < n.countUp);
        assert.ok(s.countUp <= SKIP_COUNT_UP_MS && s.dur - s.countUp <= SKIP_HOLD_MS);
        assert.equal(s.dur, s.countUp + s.schedule.hold);
      } else {
        assert.equal(q.dur, n.dur, `${n.type} quick keeps holds`);
        assert.equal(s.dur, Math.min(CASCADE_SKIP_SCREEN_HOLD, n.dur), `${n.type} skip`);
      }
      assert.ok(s.dur > 0, 'still shown');
    } else assert.ok(Math.abs(q.dur - n.dur * CASCADE_SPEED_FACTOR.quick) <= 2.5, `${n.type} scaled`);
  }
  assert.ok(quick.duration < normal.duration && skip.duration < normal.duration);
});

test('free-spin outro follows the last free spin with the engine total and the number of spins', () => {
  const round = playCascade2Round(seedOf(FREE), 1000, 'buy');
  assert.ok(round.freeSpinsTriggered);
  const timeline = buildCascadeTimeline(round);
  const outro = timeline.events.filter(e => e.type === 'free-outro');
  assert.equal(outro.length, 1);
  const o = outro[0]!;
  assert.ok(o.type === 'free-outro');
  assert.equal(o.spins, round.spins.length - 1);
  assert.equal(o.totalHundredths, round.totalHundredths);
  const lastSpinEnd = timeline.events.filter(e => e.type === 'spin-end').at(-1)!;
  assert.ok(o.at >= lastSpinEnd.at + lastSpinEnd.dur);
  const base = playCascade2Round(seedOf(0), 1000, 'standard');
  assert.equal(base.freeSpinsTriggered, false);
  assert.equal(buildCascadeTimeline(base).events.filter(e => e.type === 'free-outro').length, 0);
});

const CONFIG: AutoplayConfig = { spins: 10, lossLimitCents: 3000, stopOnAnyWin: false, stopOnFeature: true };

test('autoplay adapter: loss limit checked before a spin that would exceed it, ante cost used, never buy', () => {
  let state = createAutoplay(CONFIG, 100_000);
  let balance = 100_000;
  let spins = 0;
  for (;;) {
    const decision = autoplayBeforeSpin(state, { balanceCents: balance, betCents: 1000, ante: true, tabHidden: false });
    assert.equal(decision.costCents, 1250);
    if (!decision.continue) { assert.equal(decision.code, 'loss-would-exceed'); break; }
    state = autoplayAfterRound(state, { costCents: decision.costCents, payoutCents: 0, featureTriggered: false, balanceBeforeCents: balance });
    balance -= decision.costCents;
    spins++;
  }
  // 2 x 12,50 = 25 <= 30, a third spin would make 37,50 > 30.
  assert.equal(spins, 2);
  assert.equal(state.spentCents, 2500);
  assert.equal(state.lastRound!.balanceAfterCents, 97_500);
  const hidden = autoplayBeforeSpin(state, { balanceCents: balance, betCents: 1000, ante: false, tabHidden: true });
  assert.equal(hidden.continue === false && hidden.code, 'tab-hidden');
});

test('autoplay adapter stops on a feature and counts payouts as net', () => {
  let state = createAutoplay({ ...CONFIG, lossLimitCents: 100_000 }, 50_000);
  state = autoplayAfterRound(state, { costCents: 1000, payoutCents: 40_000, featureTriggered: true, balanceBeforeCents: 50_000 });
  assert.equal(state.lastRound!.balanceAfterCents, 89_000);
  const decision = autoplayBeforeSpin(state, { balanceCents: 89_000, betCents: 1000, ante: false, tabHidden: false });
  assert.equal(decision.continue, false);
  assert.equal(decision.continue === false && decision.code, 'feature');
});

test('short round id', () => {
  assert.equal(shortRoundId('0123456789abcdef0123456789abcdef'), '0123…cdef');
  assert.equal(shortRoundId('abc'), 'abc');
});
