import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __cascadeTest, cascadeSeedFromEntropy, playCascadeRound, CASCADE_COLS, CASCADE_ROWS, type CascadeRound } from '@sollish/protocol';
import {
  buildCascadeTimeline, bigWinTier, cascadeHistoryDetail, centsFor, finalState, multiplierText, winAnnouncement,
  CASCADE_TURBO_FACTOR, CASCADE_TURBO_MIN_HOLD, type CascadeTimeline, type TimelineEvent,
} from '../lib/cascade-timeline';
import { TimelinePlayer, type FrameScheduler } from '../lib/cascade-player';
import { countUpSchedule, countUpValueAt, multiplierCalloutTier, roundCelebration, winTierOf } from '../lib/slot-kit/win-tiers';

const seedOf = (value: number) => cascadeSeedFromEntropy(new Uint32Array([value, value, value, value]));
/** Fill values the browser spec also uses (crypto.getRandomValues stub fills all four words). */
const SEEDS = { none: 0, tumbles: 2_563_011_894, bigBase: 699_613_345, freeSmall: 2_677_206_375, freeBig: 1_621_328_416, legend: 460_262_953, retrigger: 2_477_875_263 };
const of = <T extends TimelineEvent['type']>(timeline: CascadeTimeline, type: T) => timeline.events.filter((e): e is Extract<TimelineEvent, { type: T }> => e.type === type);

function checkTimeline(round: CascadeRound, timeline: CascadeTimeline) {
  const { events } = timeline;
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.at >= events[i - 1]!.at, `events sorted at ${i}`);
  const end = events[events.length - 1]!;
  assert.equal(end.type, 'end');
  assert.equal(end.at, timeline.duration);
  if (end.type !== 'end') return;
  assert.equal(end.totalHundredths, round.totalHundredths);
  assert.equal(end.payoutCents, round.payoutCents);
  assert.equal(centsFor(round.stakeCents, end.totalHundredths), round.payoutCents);
  for (const event of events) assert.ok(event.dur >= 0 && Number.isInteger(event.at) && Number.isInteger(event.dur), `${event.type} integer timing`);
  // Meters: monotonic total, never above the cap, equal to the engine at every spin end.
  let lastTotal = 0;
  for (const event of events) if ('meter' in event) {
    assert.ok(event.meter.total >= lastTotal, `${event.type} total monotonic`);
    assert.ok(event.meter.total <= 500_000);
    lastTotal = event.meter.total;
  }
  const spinEnds = of(timeline, 'spin-end');
  assert.equal(spinEnds.length, round.spins.length);
  assert.equal(of(timeline, 'spin-start').length, round.spins.length);
  let previous = 0;
  for (const spin of round.spins) {
    const endEvent = spinEnds[spin.index]!;
    assert.equal(endEvent.meter.total, spin.totalHundredthsAfter);
    assert.equal(endEvent.winHundredths, spin.totalHundredthsAfter - previous);
    previous = spin.totalHundredthsAfter;
    const pops = of(timeline, 'pop').filter(e => e.spin === spin.index);
    assert.equal(pops.reduce((sum, e) => sum + e.stepHundredths, 0), spin.tumbleHundredths, 'pops sum to tumble win');
    assert.equal(pops.length, spin.steps.filter(step => step.wins.length).length);
    // The drop shows exactly steps[0]; every tumble lays out exactly the next step's grid.
    const drop = of(timeline, 'drop').find(e => e.spin === spin.index)!;
    const layout = (cells: { id: number; col: number; row: number }[]) => cells.map(c => `${c.id}@${c.col},${c.row}`).sort().join();
    const gridLayout = (k: number) => layout(spin.steps[k]!.grid.flatMap((column, col) => column.map((cell, row) => ({ id: cell.id, col, row }))));
    assert.equal(layout(drop.cells), gridLayout(0));
    const tumbles = of(timeline, 'tumble').filter(e => e.spin === spin.index);
    assert.equal(tumbles.length, spin.steps.length - 1);
    for (const tumble of tumbles) {
      assert.equal(layout(tumble.cells), gridLayout(tumble.step));
      assert.equal(tumble.cells.length, CASCADE_COLS * CASCADE_ROWS);
      for (const cell of tumble.cells) assert.ok(cell.fromRow <= cell.row, 'cells only fall');
      const popped = new Set(spin.steps[tumble.step - 1]!.wins.flatMap(win => win.cells));
      assert.deepEqual(new Set(tumble.removed), popped);
    }
    const multiply = of(timeline, 'multiply').find(e => e.spin === spin.index);
    if (spin.multiplierSum > 0 && spin.tumbleHundredths > 0) {
      assert.ok(multiply);
      assert.equal(multiply.sum, spin.multiplierSum);
      assert.equal(multiply.meter.spin, Math.min(spin.tumbleHundredths * spin.multiplierSum, 500_000 - (spin.totalHundredthsAfter - endEvent.winHundredths)));
      const arrivals = of(timeline, 'crystal-arrive').filter(e => e.spin === spin.index);
      assert.equal(arrivals[arrivals.length - 1]!.parts.reduce((a, b) => a + b, 0), spin.multiplierSum);
    } else assert.equal(multiply, undefined);
  }
}

test('timeline restates engine totals for a broad sample of rounds, every option combination', () => {
  const values = [...Object.values(SEEDS), ...Array.from({ length: 160 }, (_, i) => (i * 2_654_435_761 + 12_345) >>> 0)];
  for (const value of values) for (const stake of [100, 1000, 12_345]) {
    const round = playCascadeRound(seedOf(value), stake);
    for (const turbo of [false, true]) for (const reducedMotion of [false, true]) checkTimeline(round, buildCascadeTimeline(round, { turbo, reducedMotion }));
  }
});

test('turbo keeps the order and scales durations by 0.35 (holds keep a readable minimum)', () => {
  for (const value of [SEEDS.tumbles, SEEDS.freeBig, SEEDS.legend]) {
    const round = playCascadeRound(seedOf(value), 1000);
    const normal = buildCascadeTimeline(round), fast = buildCascadeTimeline(round, { turbo: true });
    assert.deepEqual(fast.events.map(e => e.type).filter(t => t !== 'land').join(), normal.events.map(e => e.type).filter(t => t !== 'land').join());
    const a = normal.events.filter(e => e.type !== 'land'), b = fast.events.filter(e => e.type !== 'land');
    for (let i = 0; i < a.length; i++) {
      const n = a[i]!, f = b[i]!;
      if ('hold' in n) {
        if (n.type === 'big-win' && f.type === 'big-win') {
          assert.deepEqual(f.schedule, countUpSchedule(round.totalHundredths, round.capped, { speed: 'turbo' }));
          assert.ok(f.countUp < n.countUp && f.countUp >= CASCADE_TURBO_MIN_HOLD);
        } else assert.equal(f.dur, Math.max(CASCADE_TURBO_MIN_HOLD, Math.round(n.dur * CASCADE_TURBO_FACTOR)));
      } else assert.ok(Math.abs(f.dur - n.dur * CASCADE_TURBO_FACTOR) <= 2.5, `${n.type} ${n.dur} -> ${f.dur}`);
    }
    const holdsNormal = normal.events.filter(e => 'hold' in e).reduce((s, e) => s + e.dur, 0);
    const holdsFast = fast.events.filter(e => 'hold' in e).reduce((s, e) => s + e.dur, 0);
    assert.ok(fast.duration - holdsFast <= (normal.duration - holdsNormal) * 0.37, 'non-hold time shrinks to ~35%');
  }
});

test('drop staggers columns left to right; reduced motion removes the stagger but keeps every step', () => {
  const round = playCascadeRound(seedOf(SEEDS.tumbles), 1000);
  const normal = buildCascadeTimeline(round), reduced = buildCascadeTimeline(round, { reducedMotion: true });
  const drop = of(normal, 'drop')[0]!;
  const firstDelay = (col: number) => Math.min(...drop.cells.filter(c => c.col === col).map(c => c.delay));
  for (let col = 1; col < CASCADE_COLS; col++) assert.ok(firstDelay(col) > firstDelay(col - 1));
  for (const cell of drop.cells) assert.ok(cell.fromRow < 0, 'drops start above the board');
  assert.ok(of(reduced, 'drop')[0]!.cells.every(c => c.delay === 0));
  assert.equal(of(reduced, 'highlight').length, of(normal, 'highlight').length);
  assert.equal(of(reduced, 'pop').length, 4);
  assert.ok(reduced.duration < normal.duration);
  assert.equal(of(normal, 'land').filter(e => e.spin === 0).length >= CASCADE_COLS, true);
});

test('free-spin round: trigger, intro hold, mode switch, counters and crystal collection', () => {
  const round = playCascadeRound(seedOf(SEEDS.freeBig), 1000);
  assert.ok(round.freeSpinsTriggered);
  const timeline = buildCascadeTimeline(round);
  const trigger = of(timeline, 'scatter-trigger')[0]!;
  assert.equal(trigger.spin, 0); assert.equal(trigger.awarded, 10); assert.equal(trigger.retrigger, false);
  assert.ok(trigger.ids.length >= 4);
  const intro = of(timeline, 'free-intro')[0]!;
  assert.ok(intro.at >= trigger.at + trigger.dur && intro.dur === 2400);
  assert.equal(of(timeline, 'free-mode')[0]!.at, intro.at + intro.dur);
  const starts = of(timeline, 'spin-start');
  assert.deepEqual(starts.map(s => s.freeSpinNumber), round.spins.map(s => s.index));
  assert.deepEqual(starts.slice(1).map(s => s.freeSpinsLeft), round.spins.slice(1).map(s => s.freeSpinsLeft));
  assert.ok(of(timeline, 'crystal-collect').length >= 1);
  const tier = bigWinTier(round.totalHundredths);
  assert.ok(tier >= 1);
  assert.equal(of(timeline, 'big-win')[0]!.tier, tier);
  // The free-spin total screen comes first, then the celebration.
  assert.ok(of(timeline, 'free-outro')[0]!.at < of(timeline, 'big-win')[0]!.at);
  assert.equal(of(timeline, 'free-outro')[0]!.celebration, true);
  // Every spin after the first clears the previous spin's final grid.
  const clears = of(timeline, 'clear');
  assert.equal(clears[0]!.ids, null);
  for (let i = 1; i < clears.length; i++) {
    const prev = round.spins[i - 1]!; const grid = prev.steps[prev.steps.length - 1]!.grid;
    assert.deepEqual([...clears[i]!.ids!].sort((a, b) => a - b), grid.flat().map(c => c.id).sort((a, b) => a - b));
  }
});

test('retrigger adds five spins and the counter follows the engine', () => {
  const round = playCascadeRound(seedOf(SEEDS.retrigger), 1000);
  const timeline = buildCascadeTimeline(round);
  const retriggers = of(timeline, 'scatter-trigger').filter(e => e.retrigger);
  assert.ok(retriggers.length >= 1);
  for (const event of retriggers) { assert.equal(event.awarded, 5); assert.equal(event.freeSpinsLeft, round.spins[event.spin]!.freeSpinsLeft); }
  assert.equal(of(timeline, 'free-intro').length, 1);
});

test('capped round ends on the Azami celebration and never displays more than 5000x', () => {
  let capped: CascadeRound | null = null;
  for (let i = 0; i < 4000 && !capped; i++) {
    const round = __cascadeTest.play(seedOf((i * 2_246_822_519) >>> 0), 1000, { capHundredths: 1500 });
    if (round.capped && round.spins.length > 1) capped = round;
  }
  assert.ok(capped, 'found a capped round with a low test cap');
  const timeline = buildCascadeTimeline(capped);
  const end = timeline.events[timeline.events.length - 1]!;
  const big = of(timeline, 'big-win');
  assert.equal(big.length, 1);
  assert.equal(big[0]!.tier, 5); assert.equal(big[0]!.capped, true);
  assert.equal(big[0]!.schedule.stages.at(-1)!.level, 5);
  assert.equal(of(timeline, 'free-outro')[0]!.capped, true);
  assert.ok(end.type === 'end' && end.capped && end.totalHundredths === 1500);
  // The real engine cap is 5000x; real rounds can never show above it.
  for (const event of buildCascadeTimeline(playCascadeRound(seedOf(SEEDS.legend), 1000)).events) if ('meter' in event) assert.ok(event.meter.total <= 500_000);
});

test('big-win tiers, final state, history detail and announcements', () => {
  assert.deepEqual([0, 999, 1000, 2499, 2500, 4999, 5000, 9999, 10_000, 500_000].map(bigWinTier), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(multiplierText(1240), '12,40'); assert.equal(multiplierText(500_000), '5.000,00');
  assert.equal(centsFor(123, 51), 62);
  const none = playCascadeRound(seedOf(SEEDS.none), 1000);
  assert.equal(cascadeHistoryDetail(none), 'Kazanç yok');
  assert.equal(of(buildCascadeTimeline(none), 'big-win').length, 0);
  const tumbles = playCascadeRound(seedOf(SEEDS.tumbles), 1000);
  assert.equal(cascadeHistoryDetail(tumbles), `4 düşme · ${multiplierText(tumbles.totalHundredths)}×`);
  const free = playCascadeRound(seedOf(SEEDS.legend), 1000);
  assert.equal(cascadeHistoryDetail(free), `Bedava dönüş ×${free.spins.length - 1} · ${multiplierText(free.totalHundredths)}×`);
  assert.equal(of(buildCascadeTimeline(free), 'big-win')[0]!.tier, bigWinTier(free.totalHundredths));
  assert.ok(free.totalHundredths >= 10_000 && bigWinTier(free.totalHundredths) === 4);
  const fin = finalState(free);
  assert.equal(fin.meter.total, free.totalHundredths); assert.equal(fin.cells.length, 30); assert.ok(fin.free);
  assert.equal(winAnnouncement({ symbol: 'strawberry', count: 8, payHundredths: 202 }, { strawberry: 'Çilek' }), '8 çilek, 2,02× kazanç');
});

function fakeFrames() {
  let queue: Array<(now: number) => void> = []; let now = 0;
  const scheduler: FrameScheduler = { request: cb => { queue.push(cb); return queue.length; }, cancel: () => { queue = []; } };
  const frame = (ms: number) => { now += ms; const run = queue; queue = []; for (const cb of run) cb(now); };
  return { scheduler, frame, pending: () => queue.length };
}

test('player fires each event once in order; slow frames are clamped, holds can be skipped forward', () => {
  const round = playCascadeRound(seedOf(SEEDS.freeSmall), 1000);
  const timeline = buildCascadeTimeline(round);
  const seen: TimelineEvent[] = [];
  const frames = fakeFrames();
  const player = new TimelinePlayer(timeline, e => seen.push(e), frames.scheduler, 64);
  player.start();
  frames.frame(16); frames.frame(5000); // a 5 s stall advances at most 64 ms
  assert.ok(player.time <= 64 + 1e-9);
  let guard = 0;
  while (!player.finished && guard++ < 100_000) {
    const hold = player.currentHold();
    if (hold) player.jumpTo(hold.at + hold.dur);
    frames.frame(16);
  }
  assert.ok(player.finished);
  assert.deepEqual(seen, timeline.events);
  assert.equal(frames.pending(), 0);
});

test('player stop() fires nothing further', () => {
  const round = playCascadeRound(seedOf(SEEDS.tumbles), 1000);
  const timeline = buildCascadeTimeline(round, { turbo: true });
  const seen: string[] = []; const frames = fakeFrames();
  const player = new TimelinePlayer(timeline, e => seen.push(e.type), frames.scheduler);
  player.start(); for (let i = 0; i < 10; i++) frames.frame(16);
  const count = seen.length; player.stop();
  for (let i = 0; i < 500; i++) frames.frame(16);
  assert.equal(seen.length, count); assert.ok(!seen.includes('end'));
  player.jumpTo(1e9); assert.equal(seen.length, count);
});

test('cumulative meter: never decreases inside a round and ends exactly on the engine payout', () => {
  const values = [...Object.values(SEEDS), ...Array.from({ length: 220 }, (_, i) => (i * 2_246_822_519 + 99) >>> 0)];
  let freeRounds = 0;
  for (const value of values) for (const stake of [100, 1000, 12_345]) {
    const round = playCascadeRound(seedOf(value), stake);
    if (round.freeSpinsTriggered) freeRounds++;
    for (const speed of ['normal', 'turbo'] as const) {
      const timeline = buildCascadeTimeline(round, { speed });
      // What the single main meter shows after each event (free spins included: no per-spin reset).
      let shown = 0;
      for (const event of timeline.events) {
        if (!('meter' in event)) continue;
        assert.ok(event.meter.total >= shown, `meter dropped at ${event.type} (${shown} -> ${event.meter.total})`);
        shown = event.meter.total;
      }
      assert.equal(shown, round.totalHundredths, 'last meter value is the round total');
      assert.equal(centsFor(stake, shown), round.payoutCents, 'and its DEMO amount is the payout');
      const spinStarts = of(timeline, 'spin-start');
      for (let i = 1; i < spinStarts.length; i++) assert.equal(spinStarts[i]!.meter.total, round.spins[i - 1]!.totalHundredthsAfter, 'a free spin starts from the running total');
      for (const event of timeline.events) {
        if (event.type === 'free-outro' || event.type === 'total-win' || event.type === 'big-win') assert.equal(event.totalHundredths, round.totalHundredths);
      }
    }
  }
  assert.ok(freeRounds > 5, 'sample includes free-spin rounds');
});

test('round end: free spins always show their total screen; <10x flourish, >=10x or capped celebrate', () => {
  const values = [...Object.values(SEEDS), ...Array.from({ length: 400 }, (_, i) => (i * 2_654_435_761 + 4242) >>> 0)];
  const seen = { flourish: 0, celebration: 0, freeLow: 0 };
  for (const value of values) {
    const round = playCascadeRound(seedOf(value), 1000);
    const timeline = buildCascadeTimeline(round);
    const outro = of(timeline, 'free-outro'), flourish = of(timeline, 'total-win'), big = of(timeline, 'big-win');
    const kind = roundCelebration(round.totalHundredths, round.capped);
    assert.equal(outro.length, round.freeSpinsTriggered ? 1 : 0);
    assert.equal(big.length, kind === 'celebration' ? 1 : 0);
    assert.equal(flourish.length, kind === 'flourish' && !round.freeSpinsTriggered ? 1 : 0);
    if (outro[0]) {
      assert.equal(outro[0].celebration, kind === 'celebration');
      const applied = round.spins.filter(s => s.multiplierSum > 0 && s.tumbleHundredths > 0).map(s => s.multiplierSum);
      assert.deepEqual(outro[0].multipliers, applied);
      if (kind !== 'celebration') seen.freeLow++;
    }
    if (big[0]) {
      seen.celebration++;
      assert.equal(big[0].tier, round.capped ? 5 : winTierOf(round.totalHundredths));
      assert.equal(big[0].dur, big[0].countUp + big[0].schedule.hold);
      assert.equal(countUpValueAt(big[0].schedule, big[0].countUp), round.totalHundredths);
    }
    if (flourish[0]) seen.flourish++;
    const last = timeline.events.filter(e => e.type !== 'end' && e.type !== 'land').at(-1)!;
    if (round.freeSpinsTriggered && kind !== 'celebration') assert.equal(last.type, 'free-outro');
  }
  assert.ok(seen.flourish > 10 && seen.celebration > 0 && seen.freeLow > 0, JSON.stringify(seen));
});

test('multiplier callouts escalate with the crystal total and get longer on screen', () => {
  for (const value of [SEEDS.freeBig, SEEDS.legend, SEEDS.retrigger, SEEDS.freeSmall]) {
    const round = playCascadeRound(seedOf(value), 1000);
    const timeline = buildCascadeTimeline(round);
    for (const event of of(timeline, 'multiply')) assert.equal(event.calloutTier, multiplierCalloutTier(event.sum));
  }
  assert.deepEqual([2, 9, 10, 24, 25, 49, 50, 99, 100, 156].map(multiplierCalloutTier), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});
