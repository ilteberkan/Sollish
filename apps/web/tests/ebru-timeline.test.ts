import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EBRU_MAX_WIN_MULTIPLIER, ebruSeedFromEntropy, playEbruRound, type EbruMode, type EbruRound } from '@sollish/protocol';
import {
  EBRU_MIN_COMB_MS, EBRU_SKIP_SCREEN_HOLD, EBRU_TURBO_MIN_HOLD, buildEbruTimeline, ebruCalloutTier, ebruCents, ebruClusterAnnouncement, ebruFinalBoard,
  ebruHistoryDetail, ebruMoney, ebruTimes, type EbruEvent, type EbruTimeline,
} from '../lib/ebru-timeline';
import { TimelinePlayer, type FrameScheduler } from '../lib/slot-kit/timeline-player';
import { countUpValueAt, roundCelebration } from '../lib/slot-kit/win-tiers';

const seedOf = (v: number) => ebruSeedFromEntropy(new Uint32Array([v, v, v, v]));
const play = (v: number, bet = 1000, mode: EbruMode = 'standard') => playEbruRound(seedOf(v), bet, mode);
/** Fill values the browser spec also uses (its crypto.getRandomValues stub fills all four words). */
export const EBRU_SEEDS = {
  loss: 2_654_435_761, combWin: 1_788_458_060, bleedComb: 1_549_107_668,
  buyuk: 2_353_484_640, mega: 2_825_556_777, super: 1_011_608_362, efsane: 3_052_687_292,
  freeLow: 1_514_186_459, freeBig: 608_189_478, freeRetrigger: 2_095_696_417,
  buyMult10: 0, buyMult25: 2_950_288_811, buyRetrMega: 1_309_757_276, buyCap100: 3_373_783_151,
};
const CAP = EBRU_MAX_WIN_MULTIPLIER * 100;
const of = <T extends EbruEvent['type']>(timeline: EbruTimeline, type: T) => timeline.events.filter((e): e is Extract<EbruEvent, { type: T }> => e.type === type);

/** Engine step type -> the events it must produce, in order (clusters: highlight [stain-hit] dissolve). */
function expectedSequence(round: EbruRound): string[] {
  const out: string[] = [];
  for (const spin of round.spins) {
    out.push(`spin-start:${spin.index}`);
    for (const step of spin.steps) {
      switch (step.type) {
        case 'drop-in': out.push('clear', 'deal'); break;
        case 'bleed': out.push('bleed', 'bleed-apply'); break;
        case 'clusters': out.push('highlight'); if (step.clusters.some(c => c.stainSum > 0)) out.push('stain-hit'); out.push('dissolve'); break;
        case 'burst': break;
        case 'stains': out.push('stains'); break;
        case 'fall': out.push('fall'); break;
        case 'comb': out.push('comb', 'comb-end'); break;
      }
    }
    if (spin.scatterHundredths > 0) out.push('scatter-pay');
    if (spin.freeSpinsAwarded > 0) { out.push('scatter-trigger'); if (spin.kind === 'base') out.push('free-intro', 'free-mode'); }
    out.push(`spin-end:${spin.index}`);
  }
  const celebration = roundCelebration(round.totalHundredths, round.capped);
  if (round.freeSpinsTriggered) out.push('free-outro'); else if (celebration === 'flourish') out.push('total-win');
  if (celebration === 'celebration') out.push('big-win');
  out.push('end');
  return out;
}
const SEQ_TYPES = new Set(['spin-start', 'clear', 'deal', 'bleed', 'bleed-apply', 'highlight', 'stain-hit', 'dissolve', 'stains', 'fall', 'comb', 'comb-end', 'scatter-pay', 'scatter-trigger', 'free-intro', 'free-mode', 'spin-end', 'free-outro', 'total-win', 'big-win', 'end']);
const sequenceOf = (timeline: EbruTimeline) => timeline.events.filter(e => SEQ_TYPES.has(e.type)).map(e => (e.type === 'spin-start' || e.type === 'spin-end' ? `${e.type}:${e.spin}` : e.type));

/** Every invariant the screen relies on, checked against the engine round. */
function check(round: EbruRound, timeline: EbruTimeline) {
  const { events } = timeline;
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.at >= events[i - 1]!.at, `events sorted at ${i}`);
  for (const e of events) assert.ok(Number.isInteger(e.at) && Number.isInteger(e.dur) && e.dur >= 0, `${e.type} integer timing`);
  const end = events.at(-1)!;
  assert.equal(end.type, 'end');
  assert.equal(end.at, timeline.duration);
  if (end.type === 'end') { assert.equal(end.totalHundredths, round.totalHundredths); assert.equal(end.payoutCents, round.payoutCents); }
  assert.equal(ebruCents(round.betCents, round.totalHundredths), round.payoutCents);

  // Step order: every engine step is presented, in engine order.
  assert.deepEqual(sequenceOf(timeline), expectedSequence(round));

  // Cumulative meter: never decreases, never above the cap, equals the engine total at every spin end and at the end.
  let last = 0;
  for (const e of events) if ('meter' in e) {
    assert.ok(e.meter.total >= last, `${e.type} meter monotonic (${e.meter.total} < ${last})`);
    assert.ok(e.meter.total <= CAP);
    last = e.meter.total;
  }
  assert.equal(last, round.totalHundredths, 'meter ends on the engine total');
  const spinEnds = of(timeline, 'spin-end');
  for (const spin of round.spins) assert.equal(spinEnds[spin.index]!.meter.total, spin.totalHundredthsAfter, `spin ${spin.index} total`);

  // Per spin: the dissolve steps add up to the tumble win, the scatter pay to the scatter win.
  for (const spin of round.spins) {
    const dissolved = of(timeline, 'dissolve').filter(e => e.spin === spin.index).reduce((n, e) => n + e.stepHundredths, 0);
    assert.equal(dissolved, spin.tumbleHundredths, `spin ${spin.index} cluster wins`);
    const scatter = of(timeline, 'scatter-pay').filter(e => e.spin === spin.index).reduce((n, e) => n + e.hundredths, 0);
    assert.equal(scatter, spin.scatterHundredths, `spin ${spin.index} scatter pay`);
    // Cluster factors are the engine's stain sums.
    const clusters = spin.steps.flatMap(st => (st.type === 'clusters' ? st.clusters : []));
    const shown = of(timeline, 'dissolve').filter(e => e.spin === spin.index).flatMap(e => e.clusters);
    assert.deepEqual(shown.map(c => [c.colour, c.size, c.multiplier, c.winHundredths]), clusters.map(c => [c.colour, c.size, c.multiplier, c.winHundredths]));
    // Comb passes: the engine's shifts, the same length for every pass, comb-end exactly at the end of the sweep.
    const combs = spin.steps.filter(st => st.type === 'comb');
    const shownCombs = of(timeline, 'comb').filter(e => e.spin === spin.index);
    assert.deepEqual(shownCombs.map(c => c.shifts), combs.map(c => (c.type === 'comb' ? c.shifts : [])));
    const ends = of(timeline, 'comb-end').filter(e => e.spin === spin.index);
    shownCombs.forEach((c, i) => { assert.equal(ends[i]!.at, c.at + c.dur); assert.equal(ends[i]!.pass, c.pass); assert.equal(c.dur, timeline.events.find(e => e.type === 'comb')!.dur); });
    combs.forEach((c, i) => { if (c.type === 'comb') { assert.deepEqual(ends[i]!.grid, c.grid); assert.deepEqual(ends[i]!.stains, c.stains); } });
  }
  // Bleeds recolour mid-way through their own animation.
  const bleeds = of(timeline, 'bleed'), applies = of(timeline, 'bleed-apply');
  assert.equal(bleeds.length, applies.length);
  bleeds.forEach((b, i) => { assert.ok(applies[i]!.at > b.at && applies[i]!.at < b.at + b.dur); assert.equal(applies[i]!.id, b.id); });
  // Stain hits: one per stained clusters step; `best` = the highest factor; callout tier from it.
  for (const hit of of(timeline, 'stain-hit')) {
    assert.equal(hit.best, Math.max(...hit.clusters.map(c => c.multiplier)));
    assert.ok(hit.clusters.every(c => c.stainSum > 0));
    assert.equal(hit.calloutTier, ebruCalloutTier(hit.best));
  }
  // Celebration and feature screens.
  const celebration = roundCelebration(round.totalHundredths, round.capped);
  assert.equal(of(timeline, 'free-outro').length, round.freeSpinsTriggered ? 1 : 0);
  const big = of(timeline, 'big-win');
  assert.equal(big.length, celebration === 'celebration' ? 1 : 0);
  for (const b of big) {
    assert.equal(b.totalHundredths, round.totalHundredths);
    assert.equal(countUpValueAt(b.schedule, b.countUp), round.totalHundredths);
    assert.equal(b.dur, b.schedule.countUp + b.schedule.hold);
  }
  // The final board is the engine's last grid.
  const finalSpin = round.spins.at(-1)!;
  const lastGrid = [...finalSpin.steps].reverse().find(st => st.type === 'drop-in' || st.type === 'bleed' || st.type === 'fall' || st.type === 'comb');
  assert.deepEqual(ebruFinalBoard(round).grid, (lastGrid as { grid: unknown }).grid);
}

const ALL: Array<[string, number, number, EbruMode]> = [
  ['loss', EBRU_SEEDS.loss, 1000, 'standard'], ['comb win', EBRU_SEEDS.combWin, 1000, 'standard'], ['bleed + comb', EBRU_SEEDS.bleedComb, 1000, 'standard'],
  ['Büyük', EBRU_SEEDS.buyuk, 1000, 'standard'], ['Mega', EBRU_SEEDS.mega, 1000, 'standard'], ['Süper', EBRU_SEEDS.super, 1000, 'standard'], ['Efsane', EBRU_SEEDS.efsane, 1000, 'standard'],
  ['free low', EBRU_SEEDS.freeLow, 1000, 'standard'], ['free big', EBRU_SEEDS.freeBig, 1000, 'standard'], ['free retrigger', EBRU_SEEDS.freeRetrigger, 1000, 'standard'],
  ['ante loss', EBRU_SEEDS.loss, 1000, 'ante'], ['buy ×10 stain', EBRU_SEEDS.buyMult10, 1000, 'buy'], ['buy ×25 stain', EBRU_SEEDS.buyMult25, 1000, 'buy'],
  ['buy retrigger', EBRU_SEEDS.buyRetrMega, 1000, 'buy'], ['buy cap', EBRU_SEEDS.buyCap100, 100, 'buy'],
];

test('every scenario: step order, durations, cumulative totals = engine payout, at every speed and with reduced motion', () => {
  for (const [name, v, bet, mode] of ALL) {
    const round = play(v, bet, mode);
    const base = buildEbruTimeline(round);
    check(round, base);
    for (const options of [{ speed: 'quick' as const }, { speed: 'turbo' as const }, { reducedMotion: true }, { speed: 'turbo' as const, skipScreens: true, reducedMotion: true }]) {
      const t = buildEbruTimeline(round, options);
      check(round, t);
      // Presentation options change timing only, never what is shown.
      assert.deepEqual(sequenceOf(t), sequenceOf(base), `${name} ${JSON.stringify(options)} same events`);
    }
  }
});

test('the seeds show what their names say', () => {
  const r = (k: keyof typeof EBRU_SEEDS, bet = 1000, mode: EbruMode = 'standard') => play(EBRU_SEEDS[k], bet, mode);
  assert.equal(r('loss').totalHundredths, 0);
  assert.ok(r('combWin').spins[0]!.combWins > 0 && r('combWin').totalHundredths < 1000);
  assert.ok(r('bleedComb').spins[0]!.steps.some(s => s.type === 'bleed'));
  const tiers = (['buyuk', 'mega', 'super', 'efsane'] as const).map(k => r(k).totalHundredths);
  assert.ok(tiers[0]! >= 1000 && tiers[0]! < 2500 && tiers[1]! >= 2500 && tiers[1]! < 5000 && tiers[2]! >= 5000 && tiers[2]! < 10_000 && tiers[3]! >= 10_000);
  assert.ok(r('freeLow').freeSpinsTriggered && r('freeLow').totalHundredths < 1000);
  assert.ok(r('freeRetrigger').spins.some(s => s.kind === 'free' && s.freeSpinsAwarded === 4));
  const mult = (round: EbruRound) => Math.max(0, ...round.spins.flatMap(s => s.steps.flatMap(st => (st.type === 'clusters' ? st.clusters.map(c => c.multiplier) : []))));
  assert.ok(mult(r('buyMult10', 1000, 'buy')) >= 10);
  assert.ok(mult(r('buyMult25', 1000, 'buy')) >= 25);
  const cap = r('buyCap100', 100, 'buy');
  assert.ok(cap.capped && cap.payoutCents === 1_000_000);
});

test('comb timing: one sweep length per speed (turbo floor), reduced motion still sweeps', () => {
  const round = play(EBRU_SEEDS.combWin);
  const dur = (o: Parameters<typeof buildEbruTimeline>[1]) => of(buildEbruTimeline(round, o), 'comb')[0]!.dur;
  assert.equal(dur({}), 1700);
  assert.equal(dur({ speed: 'quick' }), 1020);
  assert.equal(dur({ speed: 'turbo' }), Math.max(EBRU_MIN_COMB_MS, 595));
  assert.ok(dur({ reducedMotion: true }) > 0 && dur({ reducedMotion: true }) < 600);
  assert.ok(buildEbruTimeline(round, { speed: 'turbo' }).duration < buildEbruTimeline(round).duration * 0.6);
});

test('hold screens: turbo keeps them readable, "skip screens" caps them', () => {
  const round = play(EBRU_SEEDS.freeLow);
  const intro = (o: Parameters<typeof buildEbruTimeline>[1]) => of(buildEbruTimeline(round, o), 'free-intro')[0]!.dur;
  const outro = (o: Parameters<typeof buildEbruTimeline>[1]) => of(buildEbruTimeline(round, o), 'free-outro')[0]!.dur;
  assert.equal(intro({}), 2800);
  assert.equal(intro({ speed: 'turbo' }), EBRU_TURBO_MIN_HOLD);
  assert.ok(intro({ skipScreens: true }) <= EBRU_SKIP_SCREEN_HOLD && outro({ skipScreens: true }) <= EBRU_SKIP_SCREEN_HOLD);
  assert.ok(of(buildEbruTimeline(round), 'free-intro')[0]!.hold && of(buildEbruTimeline(round), 'free-outro')[0]!.hold);
});

test('free spins: the stain field persists, shifts with the comb and multiplies stained clusters', () => {
  const round = play(EBRU_SEEDS.buyMult25, 1000, 'buy');
  const t = buildEbruTimeline(round);
  const stains = of(t, 'stains');
  assert.ok(stains.length > 0);
  for (const s of stains) for (const c of s.changes) assert.ok(c.to === (c.from === 0 ? 2 : Math.min(256, c.from * 2)));
  const hits = of(t, 'stain-hit');
  assert.ok(hits.some(h => h.best >= 25 && h.calloutTier >= 2));
  // Deal events of free spins carry the persistent field; the base deal has none.
  const deals = of(t, 'deal');
  assert.equal(deals[0]!.stains, null);
  assert.ok(deals.slice(1).every(d => d.stains !== null));
  // Base spin: no stains anywhere.
  assert.ok(of(t, 'stains').every(s => s.spin > 0));
});

test('timeline player replays every event exactly once, in order', () => {
  const round = play(EBRU_SEEDS.freeRetrigger);
  const timeline = buildEbruTimeline(round, { speed: 'turbo' });
  const queue: Array<(now: number) => void> = [];
  const scheduler: FrameScheduler = { request: cb => { queue.push(cb); return queue.length; }, cancel: () => undefined };
  const seen: EbruEvent[] = [];
  const player = new TimelinePlayer<EbruEvent>(timeline, e => seen.push(e), scheduler);
  player.start();
  let now = 0;
  while (!player.finished && queue.length) { now += 16; queue.shift()!(now); }
  assert.equal(seen.length, timeline.events.length);
  assert.deepEqual(seen.map(e => e.type), timeline.events.map(e => e.type));
});

test('formatting, history detail and screen-reader lines', () => {
  assert.equal(ebruMoney(3510), '35,10');
  assert.equal(ebruTimes(1240), '12,40');
  assert.equal(ebruHistoryDetail(play(EBRU_SEEDS.loss)), 'Kazanç yok');
  assert.match(ebruHistoryDetail(play(EBRU_SEEDS.combWin)), /^\d+ küme · \d+ tarak kazancı · \d+,\d\d×$/);
  assert.match(ebruHistoryDetail(play(EBRU_SEEDS.freeRetrigger)), /^Lale Ebrusu ×\d+( · en büyük leke ×\d+)? · [\d.]+,\d\d×$/);
  assert.equal(ebruHistoryDetail(play(EBRU_SEEDS.buyCap100, 100, 'buy')), 'Azami kazanç · 10.000,00×');
  assert.equal(ebruClusterAnnouncement({ colour: 'c1', size: 6, winHundredths: 1200, stainSum: 4 }, { c1: 'Altın Lale' }), '6 altın lale, leke ×4, 12,00× kazanç');
  assert.equal(ebruCalloutTier(9), 0); assert.equal(ebruCalloutTier(10), 1); assert.equal(ebruCalloutTier(256), 5);
});
