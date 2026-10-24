import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOREME_MODES, goremeSeedFromEntropy, playGoremeRound, type GoremeMode } from '@sollish/protocol';
import { goremeLineOrder, goremeRoundWins, goremeWinLines, splitByWeight } from '../lib/goreme-wins';
import { GOREME_MAX_LINE_CYCLE, buildGoremeTimeline, type GoremeEvent } from '../lib/goreme-timeline';

const engine = (fill: number, mode: GoremeMode = 'standard', bet = 1000) => playGoremeRound(goremeSeedFromEntropy(new Uint32Array([fill, fill, fill, fill])), bet, mode);
/* Fills found with the engine (the browser spec uses the same ones). */
const MULTI = 1_839_862_647;  // base: one board, three ways, 0,78x, no lift
const BIG = 1_753_536_851;    // base: one board, two ways, 12,32x (bursts)
const LIFT = 1_824_259_072;   // base: two or more lifts, 1,60x
const ofType = <T extends GoremeEvent['type']>(events: readonly GoremeEvent[], type: T) => events.filter((e): e is Extract<GoremeEvent, { type: T }> => e.type === type);

test('splitByWeight: integer parts that sum to the total, proportional, largest remainder', () => {
  assert.deepEqual(splitByWeight(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(splitByWeight(100, [3, 1]), [75, 25]);
  assert.deepEqual(splitByWeight(0, [5, 7]), [0, 0]);
  assert.deepEqual(splitByWeight(7, [0, 0]), [7, 0]);
  assert.deepEqual(splitByWeight(5, []), []);
  // near the cap: total × weight passes 2^53
  const parts = splitByWeight(100_000_000, [99_999_999, 1, 12_345_678]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100_000_000);
});

test('one board: a label per engine way, amounts sum to the round payout, ways / reels / multiplier copied', () => {
  const round = engine(MULTI);
  const wins = goremeRoundWins(round);
  assert.equal(wins.boards.length, 1);
  const board = wins.boards[0]!;
  const step = round.spins[0]!.steps.find(s => s.type === 'ways')!;
  assert.equal(step.type, 'ways');
  if (step.type !== 'ways') return;
  assert.equal(board.lines.length, step.wins.length);
  assert.ok(board.lines.length >= 3);
  board.lines.forEach((l, i) => {
    const w = step.wins[i]!;
    assert.equal(l.symbol, w.symbol); assert.equal(l.reels, w.length); assert.equal(l.ways, w.ways); assert.equal(l.multiplier, w.multiplierProduct);
    assert.deepEqual(l.cells, w.cells);
  });
  assert.equal(board.lines.reduce((n, l) => n + l.amountCents, 0), round.payoutCents);
  assert.equal(wins.payoutCents, round.payoutCents);
});

test('every mode, many seeds: boards + scatter cents add up to the engine payout exactly; lines add up to their board', () => {
  for (const mode of GOREME_MODES) for (const bet of [100, 1000, 7500, 50_000]) for (let i = 1; i <= 120; i++) {
    const round = engine((i * 2_654_435_761) >>> 0, mode, bet);
    const wins = goremeRoundWins(round);
    const sum = wins.boards.reduce((n, b) => n + b.cents, 0) + wins.scatterCents;
    assert.equal(sum, round.payoutCents, `${mode} ${bet} #${i}`);
    assert.equal(wins.payoutCents, round.payoutCents);
    for (const b of wins.boards) {
      assert.equal(b.lines.reduce((n, l) => n + l.amountCents, 0), b.cents);
      for (const l of b.lines) assert.ok(l.amountCents >= 0);
    }
  }
});

test('the sky multiplier shows in the way multiplier; pure (engine cells are copied, not shared)', () => {
  const step = { symbol: 'h1' as const, length: 3, ways: 4, weightedWays: 6, multiplierProduct: 2, payPerWayTenThousandths: 100, payTenThousandths: 600, cells: [1, 2, 3] };
  const [line] = goremeWinLines([step], 5, 30);
  assert.equal(line!.multiplier, 10);
  assert.equal(line!.amountCents, 30);
  line!.cells.push(9);
  assert.deepEqual(step.cells, [1, 2, 3]);
});

test('line order: biggest amount first, engine order on ties', () => {
  const mk = (amountCents: number) => ({ symbol: 'l1' as const, reels: 3, ways: 1, multiplier: 1, payTenThousandths: amountCents, amountCents, cells: [] });
  assert.deepEqual(goremeLineOrder([mk(5), mk(9), mk(5), mk(1)]), [1, 0, 2, 3]);
});

test('timeline: win carries the labels, then one win-line per way (capped), the lines never move a payout', () => {
  const round = engine(MULTI);
  const tl = buildGoremeTimeline(round);
  const [win] = ofType(tl.events, 'win');
  assert.ok(win);
  assert.equal(win!.lines.reduce((n, l) => n + l.amountCents, 0), round.payoutCents);
  assert.equal(win!.cents, round.payoutCents);
  const lines = ofType(tl.events, 'win-line');
  assert.equal(lines.length, Math.min(GOREME_MAX_LINE_CYCLE, win!.lines.length));
  lines.forEach((e, n) => {
    assert.equal(e.at, win!.at + win!.summaryMs + n * e.dur);
    assert.equal(e.n, n + 1);
    assert.deepEqual(e.line, win!.lines[e.index]);
  });
  assert.equal(win!.dur, win!.summaryMs + lines.reduce((n, e) => n + e.dur, 0));
  assert.deepEqual(lines.map(e => e.index), goremeLineOrder(win!.lines).slice(0, GOREME_MAX_LINE_CYCLE));
  assert.equal(ofType(tl.events, 'end')[0]!.payoutCents, round.payoutCents);
  // turbo shortens the summary and every way; reduced motion keeps every label
  const turbo = buildGoremeTimeline(round, { speed: 'turbo' });
  assert.ok(ofType(turbo.events, 'win')[0]!.dur < win!.dur);
  const reduced = buildGoremeTimeline(round, { reducedMotion: true });
  assert.equal(ofType(reduced.events, 'win-line').length, lines.length);
  assert.deepEqual(ofType(reduced.events, 'win')[0]!.lines, win!.lines);
});

test('timeline: a big board bursts, a small one does not; a lift chain sums its labels to the payout', () => {
  assert.equal(ofType(buildGoremeTimeline(engine(BIG)).events, 'win')[0]!.burst, true);
  assert.equal(ofType(buildGoremeTimeline(engine(MULTI)).events, 'win')[0]!.burst, false);
  const round = engine(LIFT);
  const wins = ofType(buildGoremeTimeline(round).events, 'win');
  assert.ok(wins.length >= 2);
  assert.equal(wins.reduce((n, w) => n + w.lines.reduce((m, l) => m + l.amountCents, 0), 0), round.payoutCents);
});
