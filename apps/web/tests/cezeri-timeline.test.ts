import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEZERI_MAX_RESPINS, __cezeriTest, cezeriSeedFromEntropy, playCezeriRound, type CezeriMode, type CezeriRound } from '@sollish/protocol';
import {
  CEZERI_SKIP_SCREEN_HOLD, CEZERI_TURBO_MIN_HOLD, buildCezeriTimeline, cezeriCents, cezeriFinalBoard, cezeriHistoryDetail, cezeriMoney, cezeriTimes,
  cezeriWinAnnouncement, type CezeriEvent, type CezeriTimeline,
} from '../lib/cezeri-timeline';
import { cezeriRotateTiming } from '../components/cezeri/geometry';
import { TimelinePlayer, type FrameScheduler } from '../lib/slot-kit/timeline-player';
import { countUpValueAt, multiplierCalloutTier, roundCelebration } from '../lib/slot-kit/win-tiers';
import {
  CEZERI_BET_LADDER, CEZERI_DEFAULT_BET_CENTS, cezeriAutoplayAfterRound, cezeriAutoplayBeforeSpin, cezeriBuyBlockReason, cezeriCost, cezeriLedgerLimits, cezeriRoundId, cezeriRtp,
} from '../lib/cezeri-controls';
import { createAutoplay } from '../lib/slot-kit/autoplay';

const seedOf = (v: number) => cezeriSeedFromEntropy(new Uint32Array([v, v, v, v]));
const play = (v: number, bet = 1000, mode: CezeriMode = 'standard') => playCezeriRound(seedOf(v), bet, mode);
/** Fill values the browser spec also uses (its crypto.getRandomValues stub fills all four words). Found with the engine. */
const SEEDS = {
  loss: 1_107_666_780, chain2: 4_072_214_393, hub10: 3_175_850_668, buyuk: 3_690_074_171, mega: 1_792_267_404, super: 4_204_801_977, long10: 1_846_062_645,
  free: 3_018_999_229, freeFalcon: 4_136_130_991, freeLow: 2_288_122_716, retrigger: 972_678_735,
  buyMega: 1_865_544_835, buyLow: 3_992_428_374, buySuper: 147_934_750, anteLoss: 147_934_750,
};
const of = <T extends CezeriEvent['type']>(timeline: CezeriTimeline, type: T) => timeline.events.filter((e): e is Extract<CezeriEvent, { type: T }> => e.type === type);

/** Every invariant the screen relies on, checked against the engine round. */
function check(round: CezeriRound, timeline: CezeriTimeline) {
  const { events } = timeline;
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.at >= events[i - 1]!.at, `events sorted at ${i}`);
  for (const e of events) assert.ok(Number.isInteger(e.at) && Number.isInteger(e.dur) && e.dur >= 0, `${e.type} integer timing`);
  const end = events.at(-1)!;
  assert.equal(end.type, 'end');
  assert.equal(end.at, timeline.duration);
  if (end.type === 'end') { assert.equal(end.totalHundredths, round.totalHundredths); assert.equal(end.payoutCents, round.payoutCents); }
  assert.equal(cezeriCents(round.betCents, round.totalHundredths), round.payoutCents);

  // Cumulative meter: never decreases, never above the cap, equals the engine total at every spin end.
  let last = 0;
  for (const e of events) if ('meter' in e) {
    assert.ok(e.meter.total >= last, `${e.type} meter monotonic (${e.meter.total} < ${last})`);
    assert.ok(e.meter.total <= 1_000_000);
    last = e.meter.total;
  }
  assert.equal(last, round.totalHundredths, 'meter ends on the engine total');
  const spinEnds = of(timeline, 'spin-end');
  assert.equal(spinEnds.length, round.spins.length);
  assert.equal(of(timeline, 'spin-start').length, round.spins.length);
  for (const spin of round.spins) assert.equal(spinEnds[spin.index]!.meter.total, spin.totalHundredthsAfter, `spin ${spin.index} total`);

  for (const spin of round.spins) {
    const ev = events.filter(e => 'spin' in e && e.spin === spin.index);
    // Engine step order is kept: hub → rotate → win* → [lock → hub → rotate → win*]* → chain-end → [scatter] → [falcon].
    const engineOrder = spin.steps.map(s => (s.type === 'end' ? 'chain-end' : s.type));
    const shown = ev.map(e => e.type).filter(t => ['hub', 'rotate', 'win', 'lock', 'chain-end', 'scatter', 'falcon'].includes(t));
    assert.deepEqual(shown, engineOrder, `spin ${spin.index} step order`);
    // Wins re-state the engine numbers (increment × hub) and the spin's chain total.
    const wins = ev.filter((e): e is Extract<CezeriEvent, { type: 'win' }> => e.type === 'win');
    const engineWins = spin.steps.filter(s => s.type === 'win');
    assert.deepEqual(wins.map(w => [w.spoke, w.winHundredths, w.hub]), engineWins.map(w => w.type === 'win' ? [w.spoke, w.winHundredths, w.hub] : []));
    assert.equal(wins.reduce((s, w) => s + w.winHundredths, 0), spin.chainHundredths);
    // Hub values: round 0 = engine draw/carry; respins +1 each; the last hub = hubEnd.
    const hubs = ev.filter((e): e is Extract<CezeriEvent, { type: 'hub' }> => e.type === 'hub');
    assert.equal(hubs.length, spin.rotations);
    assert.equal(hubs[0]!.value, spin.hubStart);
    for (let i = 1; i < hubs.length; i++) { assert.equal(hubs[i]!.value, hubs[i - 1]!.value + 1); assert.equal(hubs[i]!.reason, 'respin'); }
    assert.equal(hubs.at(-1)!.value, spin.hubEnd);
    for (const h of hubs) assert.ok(h.calloutTier === 0 || h.calloutTier === multiplierCalloutTier(h.value));
    // Rotations: each lasts the slowest ring plan, every ring stops once, before the next step; respins wind under the held slices.
    const rotates = ev.filter((e): e is Extract<CezeriEvent, { type: 'rotate' }> => e.type === 'rotate');
    assert.equal(rotates.length, spin.rotations);
    for (const r of rotates) {
      assert.equal(r.rings.length, 4);
      assert.equal(r.kind, r.round === 0 ? 'first' : 'respin');
      const stops = ev.filter((e): e is Extract<CezeriEvent, { type: 'ring-stop' }> => e.type === 'ring-stop' && e.round === r.round);
      assert.deepEqual(stops.map(s => s.ring).sort(), [0, 1, 2, 3]);
      for (const s of stops) assert.ok(s.at > r.at && s.at <= r.at + r.dur, 'ring stops inside the rotation');
      if (!timeline.reducedMotion) {
        const plans = cezeriRotateTiming(r.kind, r.speed);
        for (const t of r.timing) assert.equal(t.ms, plans[t.ring]!.plan.total, 'sound and board share the ring plan');
      }
      const next = ev.find(e => e.at > r.at && (e.type === 'win' || e.type === 'chain-end' || e.type === 'lock'));
      if (next) assert.ok(next.at >= r.at + r.dur, 'the next beat waits for the last ring');
    }
    // Locks: newHeld comes from the engine; respin locks are followed by a +1 tick.
    const locks = ev.filter((e): e is Extract<CezeriEvent, { type: 'lock' }> => e.type === 'lock');
    assert.equal(locks.length, spin.steps.filter(s => s.type === 'lock').length);
    const chainEnd = ev.find((e): e is Extract<CezeriEvent, { type: 'chain-end' }> => e.type === 'chain-end')!;
    assert.equal(chainEnd.respins, spin.respins);
    assert.equal(chainEnd.chainHundredths, spin.chainHundredths);
    // Free spins: reservoir after every free spin; falcon drops pin exactly the engine wilds.
    if (spin.kind === 'free') {
      const res = ev.find((e): e is Extract<CezeriEvent, { type: 'reservoir' }> => e.type === 'reservoir');
      assert.equal(res?.level, Math.min(3, spin.reservoir));
      const falcon = spin.steps.find(s => s.type === 'falcon');
      const drops = ev.filter((e): e is Extract<CezeriEvent, { type: 'falcon-drop' }> => e.type === 'falcon-drop');
      if (falcon && falcon.type === 'falcon') {
        assert.equal(drops.length, falcon.slices.length);
        assert.deepEqual(drops.at(-1)!.pinned.map(p => `${p[0]},${p[1]}`).sort(), falcon.wilds.map(p => `${p[0]},${p[1]}`).sort());
        const fe = ev.find(e => e.type === 'falcon')!;
        for (const d of drops) assert.ok(d.at > fe.at && d.at <= fe.at + fe.dur);
      } else assert.equal(drops.length, 0);
      const startWilds = (ev.find(e => e.type === 'spin-start') as Extract<CezeriEvent, { type: 'spin-start' }>).wilds;
      const prev = round.spins[spin.index - 1]!;
      assert.deepEqual(startWilds, prev.kind === 'free' ? prev.wilds : [], 'pinned wilds carry into the next free spin');
    }
  }

  // Feature screens.
  const intros = of(timeline, 'free-intro'), outros = of(timeline, 'free-outro'), bigs = of(timeline, 'big-win');
  assert.equal(intros.length, round.freeSpinsTriggered ? 1 : 0);
  assert.equal(outros.length, round.freeSpinsTriggered ? 1 : 0, 'a free-spin round always ends on the total screen');
  const celebration = roundCelebration(round.totalHundredths, round.capped);
  assert.equal(bigs.length, celebration === 'celebration' ? 1 : 0);
  assert.equal(of(timeline, 'total-win').length, !round.freeSpinsTriggered && celebration === 'flourish' ? 1 : 0);
  if (outros[0]) {
    assert.equal(outros[0].totalHundredths, round.totalHundredths);
    assert.equal(outros[0].spins, round.spins.length - 1);
    assert.equal(outros[0].topHub, Math.max(...round.spins.map(s => s.hubEnd)));
    assert.equal(outros[0].falconVisits, round.spins.filter(s => s.steps.some(st => st.type === 'falcon')).length);
    if (bigs[0]) assert.ok(bigs[0].at >= outros[0].at + outros[0].dur, 'celebration after the total screen');
  }
  if (bigs[0]) {
    assert.equal(bigs[0].totalHundredths, round.totalHundredths);
    assert.equal(countUpValueAt(bigs[0].schedule, bigs[0].countUp), round.totalHundredths, 'count-up ends on the engine total');
    assert.equal(bigs[0].tier, round.capped ? 5 : bigs[0].schedule.finalLevel);
  }
  const retriggers = of(timeline, 'scatter').filter(e => e.retrigger && e.awarded > 0);
  assert.equal(retriggers.length, round.spins.filter(s => s.kind === 'free' && s.freeSpinsAwarded > 0).length);
}

test('fixed seeds: every invariant holds in every mode, speed and motion setting', () => {
  for (const [name, fill] of Object.entries(SEEDS)) {
    const mode: CezeriMode = name.startsWith('buy') ? 'buy' : name === 'anteLoss' ? 'ante' : 'standard';
    const round = play(fill, name.startsWith('buy') ? 100 : 1000, mode);
    for (const speed of ['normal', 'quick', 'turbo'] as const) for (const reducedMotion of [false, true]) check(round, buildCezeriTimeline(round, { speed, reducedMotion }));
    check(round, buildCezeriTimeline(round, { skipScreens: true }));
  }
});

test('seed facts the browser spec relies on', () => {
  assert.equal(play(SEEDS.loss).totalHundredths, 0);
  const chain = play(SEEDS.chain2);
  assert.equal(chain.spins[0]!.respins, 2); assert.equal(chain.totalHundredths, 230); assert.equal(chain.freeSpinsTriggered, false);
  assert.ok(play(SEEDS.hub10).spins[0]!.hubEnd >= 10);
  assert.equal(roundCelebration(play(SEEDS.buyuk).totalHundredths, false), 'celebration');
  assert.ok(play(SEEDS.mega).totalHundredths >= 2500 && play(SEEDS.mega).totalHundredths < 5000);
  assert.ok(play(SEEDS.freeLow).freeSpinsTriggered && play(SEEDS.freeLow).totalHundredths < 1000);
  const buy = play(SEEDS.buyMega, 100, 'buy');
  assert.equal(buy.costCents, 10_000); assert.ok(buy.totalHundredths >= 2500 && buy.totalHundredths < 5000);
  assert.ok(buy.spins.some(s => s.steps.some(st => st.type === 'falcon')));
  assert.equal(play(SEEDS.anteLoss, 1000, 'ante').costCents, 1250);
});

test('long chain: 10 respins, hub +1 each, the cap ends the chain, the duration stays watchable', () => {
  const round = play(SEEDS.long10);
  const spin = round.spins[0]!;
  assert.equal(spin.respins, CEZERI_MAX_RESPINS);
  const normal = buildCezeriTimeline(round), turbo = buildCezeriTimeline(round, { speed: 'turbo' });
  const hubs = of(normal, 'hub');
  assert.equal(hubs.length, 11);
  assert.deepEqual(hubs.map(h => h.value), Array.from({ length: 11 }, (_, i) => spin.hubStart + i));
  assert.equal(of(normal, 'rotate').filter(r => r.kind === 'respin').length, 10);
  const end = of(normal, 'chain-end')[0]!;
  assert.equal(end.respins, 10);
  // all ten respin locks were followed by a respin; the cap flag matches the engine (last rotation paid or not)
  const locks = of(normal, 'lock');
  assert.equal(locks.filter(l => l.respin).length, 10);
  assert.equal(end.chainCapped, spin.steps.some(s => s.type === 'end' && s.chainCapped));
  if (end.chainCapped) { assert.equal(locks.at(-1)!.respin, false); assert.ok(of(normal, 'win').some(w => w.round === 10)); }
  // respins wind faster than the first rotation; the whole chain stays under 40 s normal and 15 s turbo
  const first = of(normal, 'rotate')[0]!, respin = of(normal, 'rotate')[1]!;
  assert.ok(respin.dur < first.dur);
  const chainMs = end.at - first.at;
  assert.ok(chainMs < 40_000, `normal chain ${chainMs} ms`);
  assert.ok(of(turbo, 'chain-end')[0]!.at - of(turbo, 'rotate')[0]!.at < 15_000);
  assert.ok(turbo.duration < normal.duration);
});

test('chain durations: hub tick follows each respin lock, rotations are sequential, ring order inner → outer', () => {
  const round = play(SEEDS.chain2);
  const t = buildCezeriTimeline(round);
  const seq = t.events.filter(e => ['hub', 'rotate', 'lock', 'chain-end'].includes(e.type)).map(e => e.type);
  assert.deepEqual(seq, ['hub', 'rotate', 'lock', 'hub', 'rotate', 'lock', 'hub', 'rotate', 'chain-end']);
  const locks = of(t, 'lock'), hubs = of(t, 'hub'), rotates = of(t, 'rotate');
  for (let i = 0; i < locks.length; i++) {
    assert.ok(hubs[i + 1]!.at >= locks[i]!.at + locks[i]!.dur, 'tick after the clamp slam');
    assert.ok(rotates[i + 1]!.at >= hubs[i + 1]!.at + hubs[i + 1]!.dur, 'rings wind after the tick');
  }
  for (const r of rotates) {
    const stops = of(t, 'ring-stop').filter(s => s.round === r.round);
    assert.deepEqual(stops.map(s => s.ring), [0, 1, 2, 3]);
    assert.equal(stops.at(-1)!.last, true);
  }
});

test('cumulative totals equal the engine payout over 1500 seeds (standard, ante, buy)', () => {
  let x = 0x2545f491;
  const next = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x; };
  let features = 0, chains = 0;
  for (let i = 0; i < 1500; i++) {
    const mode: CezeriMode = i % 25 === 0 ? 'buy' : i % 3 === 0 ? 'ante' : 'standard';
    const round = play(next(), mode === 'buy' ? 100 : 1000, mode);
    check(round, buildCezeriTimeline(round, { speed: i % 2 ? 'turbo' : 'normal', reducedMotion: i % 7 === 0 }));
    if (round.freeSpinsTriggered) features++;
    if (round.spins[0]!.respins > 0) chains++;
  }
  assert.ok(features >= 60 && chains > 100, `${features} features, ${chains} chains`);
});

test('capped round (test cap): meter clamps to the cap, the round ends on Azami', () => {
  const play2 = __cezeriTest.player({ capHundredths: 2000 });
  let x = 7;
  let round: CezeriRound | null = null;
  for (let i = 0; i < 5000 && !round; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; const r = play2(seedOf(x), 100, 'buy'); if (r.capped) round = r; }
  assert.ok(round, 'a capped buy round with a 20x test cap');
  const t = buildCezeriTimeline(round);
  for (const e of t.events) if ('meter' in e) assert.ok(e.meter.total <= 2000);
  assert.equal(of(t, 'big-win')[0]!.tier, 5);
  assert.equal((t.events.at(-1) as Extract<CezeriEvent, { type: 'end' }>).totalHundredths, 2000);
});

test('speed and screens: quick/turbo shorten everything, holds stay readable, skipped screens are short', () => {
  const round = play(SEEDS.freeFalcon);
  const normal = buildCezeriTimeline(round), quick = buildCezeriTimeline(round, { speed: 'quick' }), turbo = buildCezeriTimeline(round, { speed: 'turbo' });
  assert.ok(quick.duration < normal.duration && turbo.duration < quick.duration);
  const intro = of(turbo, 'free-intro')[0]!, outro = of(turbo, 'free-outro')[0]!;
  assert.ok(intro.dur >= CEZERI_TURBO_MIN_HOLD && outro.dur >= CEZERI_TURBO_MIN_HOLD);
  const skipped = buildCezeriTimeline(round, { skipScreens: true });
  assert.ok(of(skipped, 'free-intro')[0]!.dur <= CEZERI_SKIP_SCREEN_HOLD);
  assert.ok(of(skipped, 'free-outro')[0]!.dur <= CEZERI_SKIP_SCREEN_HOLD);
  // presentation options never change a number
  const numbers = (t: CezeriTimeline) => t.events.flatMap(e => ('meter' in e ? [e.type, e.meter.total] : []));
  assert.deepEqual(numbers(normal), numbers(turbo));
  assert.deepEqual(numbers(normal), numbers(buildCezeriTimeline(round, { reducedMotion: true })));
});

test('player: events fire once in order; a jump through a hold never skips or repeats one', () => {
  const round = play(SEEDS.buyMega, 100, 'buy');
  const timeline = buildCezeriTimeline(round, { speed: 'turbo' });
  const queue: Array<(now: number) => void> = [];
  const scheduler: FrameScheduler = { request: cb => { queue.push(cb); return queue.length; }, cancel: () => {} };
  const seen: CezeriEvent[] = [];
  const player = new TimelinePlayer<CezeriEvent>(timeline, e => seen.push(e), scheduler, 250);
  player.start();
  let now = 0;
  while (!player.finished && now < 1e7) {
    now += 100;
    const cb = queue.shift(); if (!cb) break;
    cb(now);
    const h = player.currentHold(); if (h) player.jumpTo(h.at + h.dur);
  }
  assert.ok(player.finished);
  assert.deepEqual(seen, timeline.events);
});

test('formatting, history text, announcements and the final board', () => {
  assert.equal(cezeriMoney(3510), '35,10');
  assert.equal(cezeriTimes(1240), '12,40');
  assert.equal(cezeriHistoryDetail(play(SEEDS.loss)), 'Kazanç yok');
  assert.match(cezeriHistoryDetail(play(SEEDS.chain2)), /^2 yeniden dönüş · göbek ×3 · 2,30×$/);
  assert.match(cezeriHistoryDetail(play(SEEDS.freeLow)), /^Fil Saati ×10 · göbek ×\d+ · \d+,\d\d×$/);
  assert.equal(cezeriWinAnnouncement({ spoke: 3, length: 3, symbol: 'h1', hub: 3, winHundredths: 69, paidBefore: 0 }, { h1: 'Fil Saati' }), 'Işın 4: 3 Fil Saati, göbek ×3, 0,69× kazanç');
  const round = play(SEEDS.chain2);
  assert.deepEqual(cezeriFinalBoard(round).board, round.spins.at(-1)!.board);
});

test('controls: costs, ledger limits, buy blocking, autoplay never buys', () => {
  assert.equal(CEZERI_DEFAULT_BET_CENTS, 1000);
  assert.ok(CEZERI_BET_LADDER.includes(1000));
  assert.equal(cezeriCost(1000, 'ante'), 1250); assert.equal(cezeriCost(1000, 'buy'), 100_000);
  assert.deepEqual(cezeriLedgerLimits(1000, 'standard').maxMultiplier, 10_000);
  assert.deepEqual(cezeriLedgerLimits(1000, 'ante').maxMultiplier, 8000);
  assert.deepEqual(cezeriLedgerLimits(1000, 'buy').maxMultiplier, 100);
  assert.equal(cezeriRtp(0.955), '%95,5');
  assert.equal(cezeriRoundId('0123456789abcdef0123456789abcdef'), '0123…cdef');
  const base = { betCents: 1000, balanceCents: 1_000_000, ante: false, autoplay: false, busy: false };
  assert.equal(cezeriBuyBlockReason(base), null);
  assert.match(cezeriBuyBlockReason({ ...base, ante: true })!, /Şans ×2/);
  assert.match(cezeriBuyBlockReason({ ...base, balanceCents: 99_999 })!, /Bakiye yetersiz/);
  assert.match(cezeriBuyBlockReason({ ...base, autoplay: true })!, /Otomatik/);
  const state = createAutoplay({ spins: 10, lossLimitCents: 2500, stopOnAnyWin: false, stopOnFeature: true }, 100_000);
  const decision = cezeriAutoplayBeforeSpin(state, { balanceCents: 100_000, betCents: 1000, ante: true, tabHidden: false });
  assert.equal(decision.costCents, 1250);
  const after = cezeriAutoplayAfterRound(state, { costCents: 1250, payoutCents: 0, featureTriggered: false, balanceBeforeCents: 100_000 });
  assert.equal(after.spinsDone, 1);
});
