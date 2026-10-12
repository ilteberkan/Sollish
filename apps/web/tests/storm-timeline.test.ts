import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playStormRound, stormSeedFromEntropy, type StormMode, type StormRound } from '@sollish/protocol';
import {
  STORM_SKIP_SCREEN_HOLD, STORM_TURBO_MIN_HOLD, buildStormTimeline, stormCalloutTier, stormCents, stormFinalCells, stormHistoryDetail, stormMoney,
  stormTimes, stormWinAnnouncement, type StormEvent, type StormTimeline,
} from '../lib/storm-timeline';
import { TimelinePlayer, type FrameScheduler } from '../lib/slot-kit/timeline-player';
import { countUpValueAt, roundCelebration } from '../lib/slot-kit/win-tiers';

const seedOf = (v: number) => stormSeedFromEntropy(new Uint32Array([v, v, v, v]));
const play = (v: number, bet = 1000, mode: StormMode = 'standard') => playStormRound(seedOf(v), bet, mode);
/** Fill values the browser spec also uses (its crypto.getRandomValues stub fills all four words). */
const SEEDS = {
  loss: 0, tumbles: 2_951_033_815, orbSmall: 2_955_465_964, orb25: 61_151_303, orb100: 3_892_496_642, fizzle: 1_381_971_571,
  buyuk: 2_426_448_758, mega: 3_916_550_943, super: 1_863_343_164, efsane: 3_847_534_678,
  free: 3_001_001_962, freeRetrigger: 3_733_550_018, freeLow: 1_618_517_822,
  buyEfsane: 85_964_127, buyMegaRetr: 2_911_921_316, buyCap100: 1_918_632_665,
};
const of = <T extends StormEvent['type']>(timeline: StormTimeline, type: T) => timeline.events.filter((e): e is Extract<StormEvent, { type: T }> => e.type === type);

/** Every invariant the screen relies on, checked against the engine round. */
function check(round: StormRound, timeline: StormTimeline) {
  const { events } = timeline;
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.at >= events[i - 1]!.at, `events sorted at ${i}`);
  for (const e of events) assert.ok(Number.isInteger(e.at) && Number.isInteger(e.dur) && e.dur >= 0, `${e.type} integer timing`);
  const end = events.at(-1)!;
  assert.equal(end.type, 'end');
  assert.equal(end.at, timeline.duration);
  if (end.type === 'end') { assert.equal(end.totalHundredths, round.totalHundredths); assert.equal(end.payoutCents, round.payoutCents); }
  assert.equal(stormCents(round.betCents, round.totalHundredths), round.payoutCents);

  // Cumulative meter: never decreases, never above the cap, equals the engine total at every spin end.
  let last = 0;
  for (const e of events) if ('meter' in e) {
    assert.ok(e.meter.total >= last, `${e.type} meter monotonic (${e.meter.total} < ${last})`);
    assert.ok(e.meter.total <= 500_000);
    last = e.meter.total;
  }
  assert.equal(last, round.totalHundredths, 'meter ends on the engine total');
  const spinEnds = of(timeline, 'spin-end');
  assert.equal(spinEnds.length, round.spins.length);
  assert.equal(of(timeline, 'spin-start').length, round.spins.length);
  for (const spin of round.spins) assert.equal(spinEnds[spin.index]!.meter.total, spin.totalHundredthsAfter, `spin ${spin.index} total`);

  // Multipliers: one multiply event per spin that applies a factor > 1, equal to the engine's applied multiplier.
  const applied = round.spins.filter(s => s.tumbleHundredths > 0 && s.appliedMultiplier > 1);
  const multiplies = of(timeline, 'multiply');
  assert.deepEqual(multiplies.map(m => [m.spin, m.multiplier]), applied.map(s => [s.index, s.appliedMultiplier]));
  for (const m of multiplies) {
    const spin = round.spins[m.spin]!;
    assert.equal(m.baseHundredths, spin.tumbleHundredths);
    assert.equal(m.calloutTier, stormCalloutTier(spin.appliedMultiplier));
    if (!round.capped || spin.index < round.spins.length - 1) assert.equal(m.meter.spin, spin.tumbleHundredths * spin.appliedMultiplier);
  }

  // Orb strikes: every orb on a winning spin's final grid is struck once, in order; the running multiplier the meter
  // shows ends on the engine number (base: orbSum; free: totalMultiplierAfter). Spins without a win fizzle.
  for (const spin of round.spins) {
    const finalGrid = spin.steps.at(-1)!.grid;
    const orbIds = finalGrid.flat().filter(c => c.symbol === 'orb');
    const strikes = of(timeline, 'orb-strike').filter(e => e.spin === spin.index);
    const hits = of(timeline, 'orb-hit').filter(e => e.spin === spin.index);
    const arrivals = of(timeline, 'orb-arrive').filter(e => e.spin === spin.index);
    const fizzles = of(timeline, 'orb-fizzle').filter(e => e.spin === spin.index);
    if (orbIds.length && spin.tumbleHundredths > 0) {
      const expectedIds = [];
      for (const column of finalGrid) for (const cell of column) if (cell.symbol === 'orb') expectedIds.push(cell.id);
      assert.deepEqual(strikes.map(s => s.id), expectedIds, `spin ${spin.index} strike order`);
      assert.deepEqual(hits.map(s => s.id), expectedIds);
      assert.deepEqual(arrivals.map(s => s.id), expectedIds);
      for (let i = 0; i < strikes.length; i++) {
        assert.equal(hits[i]!.at, strikes[i]!.at + strikes[i]!.dur, 'hit after the wind-up');
        assert.equal(arrivals[i]!.at, hits[i]!.at + hits[i]!.dur, 'arrive after the flight');
      }
      const running = arrivals.map(a => a.multiplier);
      for (let i = 1; i < running.length; i++) assert.ok(running[i]! > running[i - 1]!, 'multiplier meter climbs orb by orb');
      if (spin.kind === 'base') assert.equal(running.at(-1), spin.orbSum);
      else {
        assert.equal(running.at(-1), spin.totalMultiplierAfter, `free spin ${spin.index} total multiplier`);
        assert.equal(running[0], spin.totalMultiplierBefore + orbIds[0]!.multiplier!);
      }
      assert.equal(fizzles.length, 0);
      const multiply = multiplies.find(m => m.spin === spin.index)!;
      assert.ok(multiply.at >= arrivals.at(-1)!.at, 'multiply after the last orb');
    } else {
      assert.equal(strikes.length + hits.length + arrivals.length, 0);
      assert.equal(fizzles.length, orbIds.length ? 1 : 0);
    }
  }
  // Free-spin total multiplier shown at each spin start and end = engine before/after.
  for (const e of of(timeline, 'spin-start')) assert.equal(e.totalMultiplier, round.spins[e.spin]!.totalMultiplierBefore);
  for (const e of of(timeline, 'spin-end')) if (e.kind === 'free') assert.equal(e.totalMultiplier, round.spins[e.spin]!.totalMultiplierAfter);

  // Feature screens.
  const intros = of(timeline, 'free-intro'), outros = of(timeline, 'free-outro'), bigs = of(timeline, 'big-win');
  assert.equal(intros.length, round.freeSpinsTriggered ? 1 : 0);
  assert.equal(outros.length, round.freeSpinsTriggered ? 1 : 0, 'a free-spin round always ends on the total screen');
  const celebration = roundCelebration(round.totalHundredths, round.capped);
  assert.equal(bigs.length, celebration === 'celebration' ? 1 : 0);
  if (outros[0]) {
    assert.equal(outros[0].totalHundredths, round.totalHundredths);
    assert.equal(outros[0].spins, round.spins.length - 1);
    assert.equal(outros[0].totalMultiplier, round.spins.at(-1)!.totalMultiplierAfter);
    assert.equal(outros[0].strikes, of(timeline, 'orb-strike').length);
    if (bigs[0]) assert.ok(bigs[0].at >= outros[0].at + outros[0].dur, 'celebration after the total screen');
  }
  if (bigs[0]) {
    assert.equal(bigs[0].totalHundredths, round.totalHundredths);
    assert.equal(countUpValueAt(bigs[0].schedule, bigs[0].countUp), round.totalHundredths, 'count-up ends on the engine total');
    assert.equal(bigs[0].tier, round.capped ? 5 : bigs[0].schedule.finalLevel);
  }
  const retriggers = of(timeline, 'scatter-trigger').filter(e => e.retrigger);
  assert.equal(retriggers.length, round.spins.filter(s => s.kind === 'free' && s.freeSpinsAwarded > 0).length);
  for (const r of retriggers) assert.equal(r.awarded, round.spins[r.spin]!.freeSpinsAwarded);
}

test('fixed seeds: every invariant holds in every mode, speed and motion setting', () => {
  for (const [name, fill] of Object.entries(SEEDS)) {
    const mode: StormMode = name.startsWith('buy') ? 'buy' : 'standard';
    const bet = name === 'buyCap100' ? 100 : 1000;
    const round = play(fill, bet, mode);
    for (const speed of ['normal', 'quick', 'turbo'] as const) for (const reducedMotion of [false, true]) {
      check(round, buildStormTimeline(round, { speed, reducedMotion }));
    }
    check(round, buildStormTimeline(round, { skipScreens: true }));
  }
});

test('meter is monotonic and ends on the engine payout over 3000 seeds (standard, ante, buy)', () => {
  let x = 0x2545f491;
  const next = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x; };
  let features = 0, multiplied = 0, freeMultiplied = 0;
  for (let i = 0; i < 3000; i++) {
    const mode: StormMode = i % 20 === 0 ? 'buy' : i % 3 === 0 ? 'ante' : 'standard';
    const round = play(next(), 1000, mode);
    const timeline = buildStormTimeline(round, { speed: i % 2 ? 'turbo' : 'normal' });
    check(round, timeline);
    if (round.freeSpinsTriggered) features++;
    if (round.spins.some(s => s.kind === 'base' && s.appliedMultiplier > 1 && s.tumbleHundredths > 0)) multiplied++;
    if (round.spins.some(s => s.kind === 'free' && s.appliedMultiplier > 1 && s.tumbleHundredths > 0)) freeMultiplied++;
  }
  assert.ok(features >= 150, `features covered (${features})`);
  assert.ok(multiplied >= 20, `base multipliers covered (${multiplied})`);
  assert.ok(freeMultiplied >= 100, `free-spin multipliers covered (${freeMultiplied})`);
});

test('the fixed seeds are what the browser spec expects', () => {
  assert.equal(play(SEEDS.loss).payoutCents, 0);
  assert.equal(play(SEEDS.loss, 1000, 'ante').payoutCents, 0);
  const tumbles = play(SEEDS.tumbles);
  assert.equal(tumbles.spins[0]!.steps.filter(s => s.wins.length).length, 4);
  assert.equal(tumbles.spins[0]!.orbSum, 0);
  const orb25 = play(SEEDS.orb25);
  assert.equal(orb25.spins[0]!.appliedMultiplier, 25);
  assert.equal(orb25.totalHundredths, 800);
  assert.equal(stormCalloutTier(25), 2);
  const orb100 = play(SEEDS.orb100);
  assert.equal(orb100.spins[0]!.appliedMultiplier, 100);
  assert.equal(stormCalloutTier(100), 4);
  assert.ok(play(SEEDS.fizzle).spins[0]!.orbSum > 0 && play(SEEDS.fizzle).totalHundredths === 0);
  const tiers = [SEEDS.buyuk, SEEDS.mega, SEEDS.super, SEEDS.efsane].map(v => buildStormTimeline(play(v)));
  assert.deepEqual(tiers.map(t => of(t, 'big-win')[0]!.tier), [1, 2, 3, 4]);
  assert.deepEqual(tiers.map(t => of(t, 'big-win')[0]!.schedule.stages.map(s => s.level)), [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4]]);
  const cap = play(SEEDS.buyCap100, 100, 'buy');
  assert.equal(cap.capped, true);
  assert.equal(cap.payoutCents, 500_000);
  const capped = buildStormTimeline(cap);
  assert.equal(of(capped, 'big-win')[0]!.tier, 5);
  assert.deepEqual(of(capped, 'big-win')[0]!.schedule.stages.map(s => s.level), [1, 2, 3, 4, 5]);
  const retrigger = buildStormTimeline(play(SEEDS.buyMegaRetr, 1000, 'buy'));
  assert.ok(of(retrigger, 'scatter-trigger').some(e => e.retrigger && e.awarded === 5));
  const low = play(SEEDS.freeLow);
  assert.ok(low.freeSpinsTriggered && low.totalHundredths < 1000);
  assert.equal(of(buildStormTimeline(low), 'big-win').length, 0);
});

test('callout tiers: <10, ≥10, ≥25, ≥50, ≥100, ≥250, ≥500', () => {
  assert.deepEqual([2, 9, 10, 24, 25, 50, 99, 100, 249, 250, 499, 500, 1200].map(stormCalloutTier), [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
});

test('speed scales play; holds stay readable in turbo; skipped screens stay short', () => {
  const round = play(SEEDS.free);
  const normal = buildStormTimeline(round, { speed: 'normal' });
  const quick = buildStormTimeline(round, { speed: 'quick' });
  const turbo = buildStormTimeline(round, { speed: 'turbo' });
  assert.ok(quick.duration < normal.duration && turbo.duration < quick.duration);
  for (const t of [turbo]) for (const e of t.events) if ('hold' in e && e.type !== 'big-win') assert.ok(e.dur >= STORM_TURBO_MIN_HOLD);
  const skipped = buildStormTimeline(round, { skipScreens: true });
  for (const e of skipped.events) if (e.type === 'free-intro' || e.type === 'free-outro') assert.ok(e.dur <= STORM_SKIP_SCREEN_HOLD);
  // Same engine numbers regardless of speed.
  const totals = (t: StormTimeline) => of(t, 'spin-end').map(e => e.meter.total);
  assert.deepEqual(totals(normal), totals(turbo));
  assert.deepEqual(totals(normal), totals(skipped));
});

test('cells keep their ids across tumbles; orbs and scatters survive and fall', () => {
  const round = play(SEEDS.orb25);
  const t = buildStormTimeline(round);
  const tumbles = of(t, 'tumble');
  assert.ok(tumbles.length > 0);
  for (const tumble of tumbles) {
    const grid = round.spins[0]!.steps[tumble.step]!.grid;
    assert.deepEqual(tumble.cells.map(c => c.id).sort((a, b) => a - b), grid.flat().map(c => c.id).sort((a, b) => a - b));
    for (const c of tumble.cells) assert.ok(c.row >= c.fromRow, 'cells only fall');
    const removed = new Set(tumble.removed);
    for (const c of tumble.cells) if (c.symbol === 'orb' || c.symbol === 'scatter') assert.ok(!removed.has(c.id), 'orbs and scatters never explode');
  }
  const final = stormFinalCells(round);
  assert.equal(final.length, 30);
  assert.equal(final.filter(c => c.symbol === 'orb').reduce((s, c) => s + (c.multiplier ?? 0), 0), round.spins[0]!.orbSum);
});

test('orb landings and scatter landings are announced once per new cell', () => {
  let x = 77;
  const next = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x; };
  for (let i = 0; i < 300; i++) {
    const round = play(next());
    const t = buildStormTimeline(round);
    for (const spin of round.spins) {
      const seen = new Set<number>();
      for (const step of spin.steps) for (const c of step.grid.flat()) if (c.symbol === 'orb') seen.add(c.id);
      const landed = of(t, 'orb-land').filter(e => e.spin === spin.index).map(e => e.id);
      assert.deepEqual([...landed].sort(), [...seen].sort(), 'each orb lands once');
    }
  }
});

test('hero reactions: charge before strikes, laugh on long chains, triumph on the celebration, idle at the end', () => {
  const t = buildStormTimeline(play(SEEDS.tumbles));
  const poses = of(t, 'hero').map(e => e.pose);
  assert.ok(poses.includes('laugh'));
  assert.equal(poses.at(-1), 'idle');
  const orb = buildStormTimeline(play(SEEDS.orb25));
  const charge = of(orb, 'hero').find(e => e.pose === 'charge')!;
  assert.ok(charge.at <= of(orb, 'orb-strike')[0]!.at);
  const big = buildStormTimeline(play(SEEDS.efsane));
  const triumph = of(big, 'hero').filter(e => e.pose === 'triumph');
  assert.ok(triumph.some(e => e.at === of(big, 'big-win')[0]!.at));
  const loss = buildStormTimeline(play(SEEDS.loss));
  assert.ok(of(loss, 'hero').some(e => e.pose === 'calm'));
});

test('player fires every event once, in order, and tap-jumps only forward', () => {
  const round = play(SEEDS.efsane);
  const timeline = buildStormTimeline(round, { speed: 'turbo' });
  let now = 0;
  const queue: Array<(t: number) => void> = [];
  const scheduler: FrameScheduler = { request: cb => { queue.push(cb); return queue.length; }, cancel: () => {} };
  const fired: StormEvent[] = [];
  const player = new TimelinePlayer<StormEvent>(timeline, e => fired.push(e), scheduler);
  player.start();
  let guard = 0;
  while (!player.finished && guard++ < 100_000) {
    const hold = player.currentHold();
    if (hold?.type === 'big-win') { player.jumpTo(hold.at + hold.countUp); player.jumpTo(hold.at + hold.dur); }
    now += 16;
    queue.shift()?.(now);
  }
  assert.equal(player.finished, true);
  assert.deepEqual(fired.map(e => e.type), timeline.events.map(e => e.type));
  assert.equal(fired.at(-1)!.type, 'end');
});

test('history text, money and announcements', () => {
  assert.equal(stormHistoryDetail(play(SEEDS.loss)), 'Kazanç yok');
  assert.equal(stormHistoryDetail(play(SEEDS.orb25)), '3 düşme · ×25 · 8,00×'.replace('3 düşme', `${play(SEEDS.orb25).spins[0]!.steps.filter(s => s.wins.length).length} düşme`));
  assert.match(stormHistoryDetail(play(SEEDS.free)), /^Bedava dönüş ×\d+ · toplam ×\d+ · [\d.,]+×$/);
  assert.equal(stormHistoryDetail(play(SEEDS.buyCap100, 100, 'buy')), 'Azami kazanç · 5.000,00×');
  assert.equal(stormMoney(350_010), '3.500,10');
  assert.equal(stormTimes(1240), '12,40');
  assert.equal(stormWinAnnouncement({ symbol: 'h1', count: 8, payHundredths: 960 }, { h1: 'Altın Boğa Ritonu' }), '8 altın boğa ritonu, 9,60× kazanç');
});
