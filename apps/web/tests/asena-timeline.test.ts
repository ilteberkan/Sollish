import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASENA_MAX_WIN_MULTIPLIER, asenaSeedFromEntropy, playAsenaRound, type AsenaMode, type AsenaRound } from '@sollish/protocol';
import {
  ASENA_HOWL_DELAY_MS, ASENA_SKIP_SCREEN_HOLD, ASENA_TRACE_MS, ASENA_TURBO_MIN_HOLD, asenaApplyWalks, asenaCalloutTier, asenaCents, asenaClusterAnnouncement,
  asenaErgenekonLevel, asenaFinalBoard, asenaHistoryDetail, asenaMoney, asenaTimes, buildAsenaTimeline, type AsenaEvent, type AsenaTimeline,
} from '../lib/asena-timeline';
import { asenaPlanMatches } from '../components/asena/geometry';
import { TimelinePlayer, type FrameScheduler } from '../lib/slot-kit/timeline-player';
import { countUpValueAt, roundCelebration } from '../lib/slot-kit/win-tiers';

const seedOf = (v: number) => asenaSeedFromEntropy(new Uint32Array([v, v, v, v]));
const play = (v: number, bet = 1000, mode: AsenaMode = 'standard') => playAsenaRound(seedOf(v), bet, mode);
/** Fill values the browser spec also uses (its crypto.getRandomValues stub fills all four words). */
export const ASENA_SEEDS = {
  loss: 3_310_400_750, constWalk: 3_884_005_518, multiWalk: 2_145_086_872, tease: 3_516_772_860, kurtSmall: 734_929_546,
  buyuk: 3_279_853_108, kurtBuyuk: 1_187_265_894, mega: 3_843_476_550, super: 2_451_728_819,
  freeLow: 2_145_424_075, freeBig: 1_107_666_780,
  buyX2: 87_628_868, buyRetrigger: 4_148_119_648, buyX3: 381_260_976, buyX3Super: 2_058_875_646, buyX5: 1_630_921_133, buyCap100: 4_054_600_391,
};
const CAP = ASENA_MAX_WIN_MULTIPLIER * 100;
const of = <T extends AsenaEvent['type']>(timeline: AsenaTimeline, type: T) => timeline.events.filter((e): e is Extract<AsenaEvent, { type: T }> => e.type === type);

/** Engine data -> the events it must produce, in order (the ASENA_STEP_MAPPING contract). */
function expectedSequence(round: AsenaRound): string[] {
  const out: string[] = [];
  for (const spin of round.spins) {
    out.push(`spin-start:${spin.index}`, 'drop-in');
    spin.steps.forEach((step, k) => {
      if (k > 0) out.push('grid');
      if (!step.clusters.length) return;
      out.push('highlight');
      for (const cl of step.clusters) if (cl.constellation) out.push('constellation');
      if (step.map) {
        out.push('map');
        if (step.map.globalMultiplierAfter > step.map.globalMultiplierBefore) out.push('ergenekon');
        if (step.map.freeSpinsAwarded > 0) out.push('map-spins');
      }
      out.push('burst');
      if (step.fall) out.push('fall');
      for (let i = 0; i < step.wolfWalks.length; i++) out.push('wolf-walk');
    });
    if (spin.scatterCount >= 3) out.push('moons');
    if (spin.scatterHundredths > 0) out.push('scatter-pay');
    if (Math.min(spin.scatterSpinsAwarded, spin.freeSpinsAwarded) > 0) { out.push('scatter-trigger'); if (spin.kind === 'base') out.push('free-intro', 'free-mode'); }
    out.push(`spin-end:${spin.index}`);
  }
  const celebration = roundCelebration(round.totalHundredths, round.capped);
  if (round.freeSpinsTriggered) out.push('free-outro'); else if (celebration === 'flourish') out.push('total-win');
  if (celebration === 'celebration') out.push('big-win');
  out.push('end');
  return out;
}
const SEQ_TYPES = new Set(['spin-start', 'drop-in', 'grid', 'highlight', 'constellation', 'map', 'ergenekon', 'map-spins', 'burst', 'fall', 'wolf-walk', 'moons', 'scatter-pay', 'scatter-trigger', 'free-intro', 'free-mode', 'spin-end', 'free-outro', 'total-win', 'big-win', 'end']);
/** Event order by insertion (start time, then the engine order for simultaneous events). */
const sequenceOf = (timeline: AsenaTimeline) => timeline.events.filter(e => SEQ_TYPES.has(e.type)).map(e => (e.type === 'spin-start' || e.type === 'spin-end' ? `${e.type}:${e.spin}` : e.type));
/** Everything the screen shows, without times: the same at every speed and with reduced motion. */
const shownOf = (timeline: AsenaTimeline) => timeline.events.map(e => {
  const { at: _at, dur: _dur, ...rest } = e as AsenaEvent & Record<string, unknown>;
  void _at; void _dur;
  const r = rest as Record<string, unknown>;
  delete r.speed; delete r.ms; delete r.schedule; delete r.countUp;
  if (r.type === 'moon-land') delete r.n; // landing order follows the stagger; the set of moons is the same
  if (r.plan) r.plan = (r.plan as { nodes: unknown }).nodes;
  if (r.unlocked) r.unlocked = (r.unlocked as Array<Record<string, unknown>>).map(u => ({ template: u.template, count: u.count }));
  return JSON.stringify(r);
});

/** Every invariant the screen relies on, checked against the engine round. */
function check(round: AsenaRound, timeline: AsenaTimeline) {
  const { events } = timeline;
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.at >= events[i - 1]!.at, `events sorted at ${i}`);
  for (const e of events) assert.ok(Number.isInteger(e.at) && Number.isInteger(e.dur) && e.dur >= 0, `${e.type} integer timing (${e.at}, ${e.dur})`);
  const end = events.at(-1)!;
  assert.equal(end.type, 'end');
  assert.equal(end.at, timeline.duration);
  if (end.type === 'end') { assert.equal(end.totalHundredths, round.totalHundredths); assert.equal(end.payoutCents, round.payoutCents); }
  assert.equal(asenaCents(round.betCents, round.totalHundredths), round.payoutCents);

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
  for (const spin of round.spins) {
    const se = spinEnds.find(e => e.spin === spin.index)!;
    assert.equal(se.meter.total, spin.totalHundredthsAfter, `spin ${spin.index} total`);
    assert.equal(se.freeSpinsLeft, spin.freeSpinsLeft);
    assert.equal(se.globalMultiplier, spin.globalMultiplierAfter);
    assert.deepEqual(se.pieces, spin.mapAfter);
    // The bursts add up to the tumble win (global multiplier applied), the scatter pay to the scatter win.
    const burst = of(timeline, 'burst').filter(e => e.spin === spin.index);
    assert.equal(burst.reduce((n, e) => n + e.stepHundredths, 0), spin.tumbleHundredths, `spin ${spin.index} cluster wins`);
    assert.equal(of(timeline, 'scatter-pay').filter(e => e.spin === spin.index).reduce((n, e) => n + e.hundredths, 0), spin.scatterHundredths);
    // Burst ids and their positions on the step grid are the engine's.
    const paying = spin.steps.filter(st => st.clusters.length);
    burst.forEach((e, i) => { assert.deepEqual(e.ids, paying[i]!.burst); assert.equal(e.positions.length, e.ids.length); });
    // Constellations: one per ignited cluster, in order; the trace plan covers exactly the engine positions.
    const ignitions = spin.steps.flatMap(st => st.clusters.flatMap(cl => (cl.constellation ? [cl.constellation] : [])));
    const shown = of(timeline, 'constellation').filter(e => e.spin === spin.index);
    assert.equal(shown.length, ignitions.length);
    shown.forEach((e, i) => {
      assert.deepEqual(e.ignition, ignitions[i]);
      assert.ok(asenaPlanMatches(e.plan, ignitions[i]!.positions), `plan covers ignition ${i}`);
      assert.equal(e.plan.multiplier, ignitions[i]!.multiplier);
      assert.equal(e.persist, spin.kind === 'free');
      const howl = of(timeline, 'howl').find(h => h.spin === e.spin && h.step === e.step && h.index === e.index)!;
      assert.equal(howl.at, e.at + e.plan.duration + ASENA_HOWL_DELAY_MS, 'the wolf howls when the sound howls');
      assert.ok(howl.at <= e.at + e.dur, 'howl inside the constellation beat');
    });
    // Wolf walks: every walk, in order, and the walks applied to the fall grid give the next step's grid.
    const walks = spin.steps.flatMap(st => st.wolfWalks);
    assert.deepEqual(of(timeline, 'wolf-walk').filter(e => e.spin === spin.index).map(e => e.walk), walks);
    spin.steps.forEach((st, k) => { if (st.fall) assert.deepEqual(asenaApplyWalks(st.fall.grid, st.wolfWalks), spin.steps[k + 1]!.grid, `walks applied, spin ${spin.index} step ${k}`); });
    // The board is set to every step grid.
    assert.deepEqual(of(timeline, 'grid').filter(e => e.spin === spin.index).map(e => e.grid), spin.steps.slice(1).map(st => st.grid));
    // Moons in landing order: n counts up, ends on the final board's count.
    const moons = of(timeline, 'moon-land').filter(e => e.spin === spin.index);
    moons.forEach((m, i) => assert.equal(m.n, i + 1));
    assert.equal(moons.length, spin.scatterCount);
  }
  // Map events re-state the engine map; the global multiplier only rises through ×2, ×3, ×5.
  for (const m of of(timeline, 'ergenekon')) { assert.ok(m.after > m.before); assert.ok([2, 3, 5].includes(m.after)); assert.equal(m.level, asenaErgenekonLevel(m.after)); }
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
  assert.deepEqual(asenaFinalBoard(round), round.spins.at(-1)!.steps.at(-1)!.grid);
}

const ALL: Array<[string, number, number, AsenaMode]> = [
  ['loss', ASENA_SEEDS.loss, 1000, 'standard'], ['constellation + walk', ASENA_SEEDS.constWalk, 1000, 'standard'], ['multi walk', ASENA_SEEDS.multiWalk, 1000, 'standard'],
  ['tease', ASENA_SEEDS.tease, 1000, 'standard'], ['Kurt Başı', ASENA_SEEDS.kurtSmall, 1000, 'standard'],
  ['Büyük', ASENA_SEEDS.buyuk, 1000, 'standard'], ['Mega', ASENA_SEEDS.mega, 1000, 'standard'], ['Süper', ASENA_SEEDS.super, 1000, 'standard'],
  ['free low', ASENA_SEEDS.freeLow, 1000, 'standard'], ['free big', ASENA_SEEDS.freeBig, 1000, 'standard'], ['ante loss', ASENA_SEEDS.loss, 1000, 'ante'],
  ['buy ×2', ASENA_SEEDS.buyX2, 1000, 'buy'], ['buy retrigger', ASENA_SEEDS.buyRetrigger, 1000, 'buy'], ['buy ×3', ASENA_SEEDS.buyX3Super, 1000, 'buy'],
  ['buy ×5', ASENA_SEEDS.buyX5, 1000, 'buy'], ['buy cap', ASENA_SEEDS.buyCap100, 100, 'buy'],
];

test('every scenario: step order, integer durations, cumulative totals = engine payout, at every speed and with reduced motion', () => {
  for (const [name, v, bet, mode] of ALL) {
    const round = play(v, bet, mode);
    const base = buildAsenaTimeline(round);
    check(round, base);
    for (const options of [{ speed: 'quick' as const }, { speed: 'turbo' as const }, { reducedMotion: true }, { speed: 'turbo' as const, skipScreens: true, reducedMotion: true }]) {
      const t = buildAsenaTimeline(round, options);
      check(round, t);
      // Presentation options change timing only, never what is shown.
      assert.deepEqual(sequenceOf(t), sequenceOf(base), `${name} ${JSON.stringify(options)} same events`);
      assert.deepEqual(shownOf(t).sort(), shownOf(base).sort(), `${name} ${JSON.stringify(options)} same content`);
    }
  }
});

test('the seeds show what their names say', () => {
  const r = (k: keyof typeof ASENA_SEEDS, bet = 1000, mode: AsenaMode = 'standard') => play(ASENA_SEEDS[k], bet, mode);
  const ignitions = (round: AsenaRound) => round.spins.flatMap(s => s.steps.flatMap(st => st.clusters.flatMap(c => (c.constellation ? [c.constellation] : []))));
  const walks = (round: AsenaRound) => round.spins.flatMap(s => s.steps.flatMap(st => st.wolfWalks));
  assert.equal(r('loss').totalHundredths, 0); assert.equal(r('loss', 1000, 'ante').totalHundredths, 0);
  assert.ok(ignitions(r('constWalk')).length >= 1 && walks(r('constWalk')).length >= 1 && r('constWalk').totalHundredths < 1000);
  assert.ok(walks(r('multiWalk')).length >= 2 && ignitions(r('multiWalk')).length >= 2);
  assert.equal(r('tease').spins[0]!.steps[0]!.grid.flat().filter(c => c.symbol === 'moon').length, 2);
  assert.ok(ignitions(r('kurtSmall')).some(i => i.templateId === 'kurt-basi'));
  const tiers = (['buyuk', 'mega', 'super'] as const).map(k => r(k).totalHundredths);
  assert.ok(tiers[0]! >= 1000 && tiers[0]! < 2500 && tiers[1]! >= 2500 && tiers[1]! < 5000 && tiers[2]! >= 5000 && tiers[2]! < 10_000);
  assert.ok(!r('mega').freeSpinsTriggered && !r('super').freeSpinsTriggered);
  assert.ok(r('freeLow').freeSpinsTriggered && r('freeLow').totalHundredths < 1000);
  assert.equal(r('freeBig').spins.at(-1)!.globalMultiplierAfter, 3);
  assert.equal(r('buyX2', 1000, 'buy').spins.at(-1)!.globalMultiplierAfter, 2);
  assert.ok(r('buyRetrigger', 1000, 'buy').spins.some(s => s.kind === 'free' && s.scatterSpinsAwarded > 0));
  assert.equal(r('buyX3Super', 1000, 'buy').spins.at(-1)!.globalMultiplierAfter, 3);
  assert.equal(r('buyX5', 1000, 'buy').spins.at(-1)!.globalMultiplierAfter, 5);
  const cap = r('buyCap100', 100, 'buy');
  assert.ok(cap.capped && cap.payoutCents === 500_000);
});

test('constellation trace: one plan length per speed (0.6 floor), reduced motion still traces, callout when template × global ≥ 10', () => {
  const round = play(ASENA_SEEDS.kurtSmall);
  const first = (o: Parameters<typeof buildAsenaTimeline>[1]) => of(buildAsenaTimeline(round, o), 'constellation')[0]!;
  assert.equal(first({}).plan.duration, ASENA_TRACE_MS);
  assert.equal(first({ speed: 'quick' }).plan.duration, Math.round(ASENA_TRACE_MS * 0.6));
  assert.equal(first({ speed: 'turbo' }).plan.duration, Math.round(ASENA_TRACE_MS * 0.6));
  assert.ok(first({ reducedMotion: true }).plan.duration > 0);
  const howls = of(buildAsenaTimeline(round), 'howl');
  const kurt = howls.find(h => h.templateId === 'kurt-basi')!;
  assert.deepEqual(kurt.callout, { value: 10, tier: 1 });
  assert.ok(howls.filter(h => h.multiplier < 10).every(h => h.callout === null), 'base game: only ×10 is called out');
  // In free spins the global multiplier counts: ×3 template under ×5 = ×15.
  const x5 = buildAsenaTimeline(play(ASENA_SEEDS.buyX5, 1000, 'buy'));
  assert.ok(of(x5, 'howl').some(h => h.callout && h.callout.value > h.multiplier), 'global multiplier raises the callout value');
  assert.ok(buildAsenaTimeline(round, { speed: 'turbo' }).duration < buildAsenaTimeline(round).duration * 0.75);
});

test('hold screens: turbo keeps them readable, "skip screens" caps them', () => {
  const round = play(ASENA_SEEDS.freeLow);
  const intro = (o: Parameters<typeof buildAsenaTimeline>[1]) => of(buildAsenaTimeline(round, o), 'free-intro')[0]!.dur;
  const outro = (o: Parameters<typeof buildAsenaTimeline>[1]) => of(buildAsenaTimeline(round, o), 'free-outro')[0]!.dur;
  assert.equal(intro({}), 3200);
  assert.equal(intro({ speed: 'turbo' }), ASENA_TURBO_MIN_HOLD);
  assert.ok(intro({ skipScreens: true }) <= ASENA_SKIP_SCREEN_HOLD && outro({ skipScreens: true }) <= ASENA_SKIP_SCREEN_HOLD);
  assert.ok(of(buildAsenaTimeline(round), 'free-intro')[0]!.hold && of(buildAsenaTimeline(round), 'free-outro')[0]!.hold);
});

test('Ergenekon: map pieces fly from their constellation, the multiplier steps ×2 → ×3 → ×5, +5 spins at 3 and 6', () => {
  const round = play(ASENA_SEEDS.buyX5, 1000, 'buy');
  const t = buildAsenaTimeline(round);
  const maps = of(t, 'map');
  assert.ok(maps.length > 0);
  for (const m of maps) {
    const step = round.spins[m.spin]!.steps[m.step]!;
    assert.deepEqual(m.pieces, step.map!.pieces);
    assert.deepEqual(m.unlocked.map(u => [u.template, u.count]), step.map!.unlocked.map(u => [u.template, u.count]));
    assert.ok(m.unlocked.every(u => u.from !== null), 'every piece flies from its constellation');
  }
  assert.deepEqual(of(t, 'ergenekon').map(e => e.after), [2, 3, 5]);
  assert.deepEqual(of(t, 'map-spins').map(e => e.awarded), [5, 5]);
  // Free-spin counter: map spins add to it, the spin end restates the engine count.
  for (const ms of of(t, 'map-spins')) assert.ok(ms.freeSpinsLeft <= round.spins[ms.spin]!.freeSpinsLeft + 3);
  // Base spin: no map, ×1.
  assert.ok(maps.every(m => m.spin > 0));
  assert.equal(of(t, 'spin-start')[0]!.globalMultiplier, 1);
  const outro = of(t, 'free-outro')[0]!;
  assert.equal(outro.globalMultiplier, 5); assert.equal(outro.distinct, 6); assert.equal(outro.spins, round.spins.length - 1);
});

test('timeline player replays every event exactly once, in order', () => {
  const round = play(ASENA_SEEDS.buyRetrigger, 1000, 'buy');
  const timeline = buildAsenaTimeline(round, { speed: 'turbo' });
  const queue: Array<(now: number) => void> = [];
  const scheduler: FrameScheduler = { request: cb => { queue.push(cb); return queue.length; }, cancel: () => undefined };
  const seen: AsenaEvent[] = [];
  const player = new TimelinePlayer<AsenaEvent>(timeline, e => seen.push(e), scheduler);
  player.start();
  let now = 0;
  while (!player.finished && queue.length) { now += 16; queue.shift()!(now); }
  assert.equal(seen.length, timeline.events.length);
  assert.deepEqual(seen.map(e => e.type), timeline.events.map(e => e.type));
});

test('formatting, history detail and screen-reader lines', () => {
  assert.equal(asenaMoney(3510), '35,10');
  assert.equal(asenaTimes(1240), '12,40');
  assert.equal(asenaHistoryDetail(play(ASENA_SEEDS.loss)), 'Kazanç yok');
  assert.match(asenaHistoryDetail(play(ASENA_SEEDS.constWalk)), /^\d+ küme · \d+ takımyıldız · \d+,\d\d×$/);
  assert.match(asenaHistoryDetail(play(ASENA_SEEDS.buyX3Super, 1000, 'buy')), /^Ergenekon ×\d+ · genel ×3 · [\d.]+,\d\d×$/);
  assert.equal(asenaHistoryDetail(play(ASENA_SEEDS.buyCap100, 100, 'buy')), 'Azami kazanç · 5.000,00×');
  assert.equal(asenaClusterAnnouncement({ symbol: 'h1', size: 7, winHundredths: 2400, templateId: 'kurt-basi', templateMultiplier: 10 }, { h1: 'Asena' }), '7 asena, Kurt Başı ×10, 24,00× kazanç');
  assert.equal(asenaCalloutTier(9), 0); assert.equal(asenaCalloutTier(10), 1); assert.equal(asenaCalloutTier(50), 3);
  assert.deepEqual([1, 2, 3, 5].map(asenaErgenekonLevel), [0, 1, 2, 3]);
});
