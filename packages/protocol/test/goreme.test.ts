import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GOREME_BET_LEVELS_CENTS, GOREME_BUY_MIN_SCATTERS, GOREME_COST_FRACTION, GOREME_ENGINE_ID, GOREME_FREE_SPINS_RETRIGGER, GOREME_LANDING_MULTIPLIERS,
  GOREME_MAX_BALLOON_MULTIPLIER, GOREME_MAX_FREE_SPINS, GOREME_MAX_LIFTS, GOREME_MAX_WIN_MULTIPLIER, GOREME_MIN_LENGTH, GOREME_MODES, GOREME_MODE_TABLES,
  GOREME_PAYTABLE, GOREME_PAY_SYMBOLS, GOREME_REELS, GOREME_ROWS, GOREME_RTP, GOREME_SCATTER_AWARDS, GOREME_WAYS, GOREME_WINDS, GOREME_WIND_WEIGHTS,
  __goremeTest, goremeCostCents, goremeSeedFromEntropy, playGoremeRound,
  type GoremeCell, type GoremeGrid, type GoremeLiftStep, type GoremeMode, type GoremePaySymbol, type GoremeRespinStep, type GoremeRound,
  type GoremeSpin, type GoremeStep, type GoremeSymbol, type GoremeTuning, type GoremeWaysStep,
} from "../src/goreme.ts";
import * as protocol from "../src/index.ts";

const SEED = "0123456789abcdef0123456789abcdef";
const MODES = GOREME_MODES;
const CAP = GOREME_MAX_WIN_MULTIPLIER * 100;
function seeds(count: number, label = "a1b2c3d4e5f60718293a4b5c6d7e8f90"): string[] {
  const rng = __goremeTest.createRng(label);
  return Array.from({ length: count }, () => goremeSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
type Spec = GoremeSymbol | readonly [GoremeSymbol, number] | undefined;
/** A board without any win: reel c holds only l-symbols that never repeat on 3 adjacent reels (tests draw their wins with h1..h4). */
const filler = (c: number): GoremeSymbol => (["l1", "l2", "l3", "l4", "l5", "l1"] as const)[c]!;
const board = (fn: (col: number, row: number) => Spec): GoremeGrid =>
  Array.from({ length: GOREME_REELS }, (_, c) => Array.from({ length: GOREME_ROWS }, (_, r): GoremeCell => {
    const spec = fn(c, r) ?? filler(c);
    const [symbol, multiplier] = typeof spec === "string" ? [spec, spec === "balloon" ? 1 : 0] : spec;
    return { id: c * GOREME_ROWS + r, symbol, multiplier };
  }));
/** Board from rows of 6 tokens: "h1", "B3" (balloon x3), "S" (sun), "." (filler). */
const fromRows = (rows: readonly string[]): GoremeGrid => {
  const cells = rows.map(row => row.trim().split(/\s+/));
  return board((c, r) => {
    const t = cells[r]![c]!;
    if (t === ".") return undefined;
    if (t === "S") return "sun";
    if (t.startsWith("B")) return ["balloon", Number(t.slice(1))];
    return t as GoremeSymbol;
  });
};
const flat = (grid: GoremeGrid): GoremeCell[] => grid.flat();
const ofType = <T extends GoremeStep["type"]>(steps: readonly GoremeStep[], type: T): Extract<GoremeStep, { type: T }>[] =>
  steps.filter((s): s is Extract<GoremeStep, { type: T }> => s.type === type);
const pay = (s: GoremePaySymbol, length: number): number => GOREME_PAYTABLE[s][length - 3]!;
/** Independent brute force: enumerate every way (one cell per reel over the run) and sum the multiplier products of the ways that
 * consist of s or balloons with at least one real s. */
function bruteWays(grid: GoremeGrid, s: GoremePaySymbol): { length: number; weighted: number; plain: number } {
  let length = 0;
  while (length < GOREME_REELS && grid[length]!.some(cell => cell.symbol === s || cell.symbol === "balloon")) length++;
  if (length < 3) return { length, weighted: 0, plain: 0 };
  let weighted = 0, plain = 0;
  const walk = (reel: number, product: number, real: boolean): void => {
    if (reel === length) { if (real) { weighted += product; plain++; } return; }
    for (const cell of grid[reel]!) {
      if (cell.symbol === s) walk(reel + 1, product, true);
      else if (cell.symbol === "balloon") walk(reel + 1, product * cell.multiplier, real);
    }
  };
  walk(0, 1, false);
  return { length, weighted, plain };
}
const tuned = (t: GoremeTuning): GoremeTuning => t;

test("engine id, exports and the protocol index re-export", () => {
  assert.equal(GOREME_ENGINE_ID, "goreme-balloons-1");
  assert.equal(GOREME_MAX_WIN_MULTIPLIER, 10_000);
  assert.equal(GOREME_REELS, 6);
  assert.equal(GOREME_ROWS, 5);
  assert.equal(GOREME_WAYS, 5 ** 6);
  assert.equal(GOREME_MIN_LENGTH, 3);
  assert.equal(GOREME_MAX_BALLOON_MULTIPLIER, 25);
  assert.equal(GOREME_MAX_LIFTS, 20);
  assert.equal(GOREME_MAX_FREE_SPINS, 200);
  assert.equal(GOREME_FREE_SPINS_RETRIGGER, 5);
  assert.equal(GOREME_BUY_MIN_SCATTERS, 3);
  assert.deepEqual([...GOREME_LANDING_MULTIPLIERS], [1, 2, 3, 5]);
  assert.deepEqual([...GOREME_WINDS], ["left", "calm", "right"]);
  assert.equal(GOREME_WIND_WEIGHTS.length, 3);
  assert.deepEqual(GOREME_SCATTER_AWARDS, { 3: { spins: 10, payHundredths: 200 }, 4: { spins: 12, payHundredths: 500 }, 5: { spins: 15, payHundredths: 2000 }, 6: { spins: 20, payHundredths: 10_000 } });
  assert.equal(protocol.playGoremeRound, playGoremeRound);
  assert.equal(protocol.goremeCostCents, goremeCostCents);
  assert.equal(protocol.goremeSeedFromEntropy, goremeSeedFromEntropy);
  assert.equal(protocol.GOREME_RTP, GOREME_RTP);
  assert.equal(typeof protocol.playAsenaRound, "function", "the other engines are still exported");
  assert.deepEqual([...MODES], ["standard", "ante", "buy"]);
  assert.deepEqual([...GOREME_BET_LEVELS_CENTS], [...protocol.ASENA_BET_LEVELS_CENTS], "same bet levels as the other slots");
  assert.deepEqual([...GOREME_PAY_SYMBOLS], ["h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4", "l5"]);
  assert.ok(Object.isFrozen(GOREME_BET_LEVELS_CENTS) && Object.isFrozen(GOREME_MODE_TABLES.ante.base) && Object.isFrozen(GOREME_PAYTABLE.h1) && Object.isFrozen(GOREME_SCATTER_AWARDS[3]));
});

test("structure: self-contained pure module (no imports, clock, Math.random, network or I/O)", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/goreme.ts", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/^\s*import\s/m.test(source), "no import statements: the evidence covers these bytes only");
  for (const forbidden of ["Math.random", "Date.now", "new Date", "performance.now", "fetch(", "process.", "require("]) assert.ok(!source.includes(forbidden), forbidden);
});

test("same seed, bet and mode give a byte-identical round; seed and mode both change the result", () => {
  for (const mode of MODES) {
    const a = playGoremeRound(SEED, 500, mode), b = playGoremeRound(SEED, 500, mode);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.engine, GOREME_ENGINE_ID);
    assert.equal(a.seedHex, SEED);
    assert.equal(a.mode, mode);
    const distinct = new Set(seeds(40).map(s => JSON.stringify(playGoremeRound(s, 500, mode).spins[0]!.steps[0])));
    assert.equal(distinct.size, 40);
    // The bet level never changes the board, only the payout and cost.
    assert.deepEqual(playGoremeRound(SEED, 100, mode).spins, playGoremeRound(SEED, 50_000, mode).spins);
  }
  assert.notEqual(JSON.stringify(playGoremeRound(SEED, 500, "standard").spins), JSON.stringify(playGoremeRound(SEED, 500, "buy").spins));
});

test("RNG and rules are frozen: a fingerprint of 200 fixed seeds across all modes and bets", () => {
  const rng = __goremeTest.createRng(SEED), again = __goremeTest.createRng(SEED);
  const first = Array.from({ length: 6 }, () => rng());
  assert.deepEqual(first, Array.from({ length: 6 }, () => again()));
  assert.ok(first.every(x => Number.isInteger(x) && x >= 0 && x < 2 ** 32));
  // Any change of RNG, draw order, tables or rules changes this hash (a new behavior needs a new engine id).
  const bets = [100, 200, 50_000, 4000], hash = createHash("sha256");
  for (let i = 0; i < 200; i++) {
    const seed = createHash("sha256").update(`goreme-balloons-1-frozen:${i}`).digest("hex").slice(0, 32);
    hash.update(JSON.stringify(playGoremeRound(seed, bets[i % 4]!, MODES[i % 3]!)));
  }
  assert.equal(hash.digest("hex"), "FINGERPRINT");
});

test("input validation throws RangeError for seed, bet level and mode", () => {
  for (const bad of ["", "0123456789ABCDEF0123456789ABCDEF", SEED.slice(1), SEED + "0", "g".repeat(32), 123 as unknown as string, undefined as unknown as string]) {
    assert.throws(() => playGoremeRound(bad, 100, "standard"), RangeError, String(bad));
  }
  for (const bad of [0, 99, 101, 150, 450, 600, 9999, 50_001, 100.5, -100, Number.NaN, Number.POSITIVE_INFINITY, "100" as unknown as number, 100n as unknown as number, null as unknown as number, undefined as unknown as number]) {
    for (const mode of MODES) {
      assert.throws(() => playGoremeRound(SEED, bad, mode), RangeError, String(bad));
      assert.throws(() => goremeCostCents(bad, mode), RangeError, String(bad));
    }
  }
  for (const bad of ["", "Standard", "free", "bonus", null, undefined, 1, {}, "constructor", "__proto__"] as unknown as GoremeMode[]) {
    assert.throws(() => playGoremeRound(SEED, 100, bad), RangeError, String(bad));
    assert.throws(() => goremeCostCents(100, bad), RangeError, String(bad));
  }
  assert.throws(() => goremeSeedFromEntropy(new Uint32Array(3)), RangeError);
  assert.throws(() => goremeSeedFromEntropy([1, 2, 3, 4] as unknown as Uint32Array), RangeError);
  assert.throws(() => __goremeTest.play(SEED, 100, "standard", tuned({ tables: { standard: { base: [["h1", -1]] } } })), RangeError);
  assert.throws(() => __goremeTest.play(SEED, 100, "standard", tuned({ tables: { standard: { baseMultipliers: [[0, 1]] } } })), RangeError);
  assert.throws(() => __goremeTest.play(SEED, 100, "standard", tuned({ paytable: { ...GOREME_PAYTABLE, h1: [1, 2, 3] } })), RangeError);
  assert.throws(() => __goremeTest.play(SEED, 100, "standard", tuned({ windWeights: [1, 1] })), RangeError);
  for (const bet of GOREME_BET_LEVELS_CENTS) for (const mode of MODES) assert.doesNotThrow(() => playGoremeRound(SEED, bet, mode));
  assert.equal(goremeSeedFromEntropy(new Uint32Array([0, 1, 0xffffffff, 0xabc])), "0000000000000001ffffffff00000abc");
});

test("cost arithmetic: standard = bet, ante = bet * 5 / 4, buy = bet * 100, always an integer", () => {
  assert.deepEqual(GOREME_COST_FRACTION.standard, [1, 1]);
  assert.deepEqual(GOREME_COST_FRACTION.ante, [5, 4]);
  assert.deepEqual(GOREME_COST_FRACTION.buy, [100, 1]);
  for (const bet of GOREME_BET_LEVELS_CENTS) {
    assert.equal(goremeCostCents(bet, "standard"), bet);
    assert.equal(goremeCostCents(bet, "ante"), (bet / 4) * 5);
    assert.equal(goremeCostCents(bet, "buy"), bet * 100);
    for (const mode of MODES) {
      assert.ok(Number.isSafeInteger(goremeCostCents(bet, mode)));
      const round = playGoremeRound(SEED, bet, mode);
      assert.equal(round.costCents, goremeCostCents(bet, mode));
      assert.equal(round.betCents, bet);
    }
  }
  assert.equal(goremeCostCents(100, "ante"), 125);
  assert.equal(goremeCostCents(50_000, "buy"), 5_000_000);
});

test("payout is floor(bet * hundredths / 100) in every mode and never exceeds 10 000 x bet", () => {
  for (const [i, seed] of seeds(1500).entries()) {
    const bet = GOREME_BET_LEVELS_CENTS[i % GOREME_BET_LEVELS_CENTS.length]!, mode = MODES[i % 3]!;
    const round = playGoremeRound(seed, bet, mode);
    assert.equal(round.payoutCents, Number(BigInt(bet) * BigInt(round.totalHundredths) / 100n));
    assert.ok(Number.isSafeInteger(round.totalHundredths) && round.totalHundredths >= 0 && round.totalHundredths <= CAP);
    assert.ok(round.payoutCents <= bet * GOREME_MAX_WIN_MULTIPLIER);
    assert.equal(round.totalHundredths, round.spins.at(-1)!.totalHundredthsAfter);
    assert.equal(round.payoutCents, (bet / 100) * round.totalHundredths);
  }
});

test("ways: plain counts, run length, pay = table[length] x ways, symbol order, sun and gaps end a run", () => {
  // h1 on reels 0..2 (2, 3, 1 cells), not on reel 3 -> length 3, 6 ways.
  let wins = __goremeTest.evaluateWays(fromRows([
    "h1 h1 h1 .  .  .",
    "h1 h1 .  .  .  .",
    ".  h1 .  .  .  .",
    ".  .  .  .  .  .",
    ".  .  .  .  .  .",
  ]));
  assert.equal(wins.length, 1);
  assert.deepEqual({ ...wins[0]!, cells: [] }, { symbol: "h1", length: 3, ways: 6, weightedWays: 6, multiplierProduct: 1, payPerWayTenThousandths: pay("h1", 3), payTenThousandths: 6 * pay("h1", 3), cells: [] });
  assert.deepEqual(wins[0]!.cells, [0, 1, 5, 6, 7, 10]);
  // Two cells only on 2 reels pay nothing; a sun does not substitute and breaks the run.
  assert.deepEqual(__goremeTest.evaluateWays(fromRows(["h2 h2 S h2 h2 h2", ". . . . . .", ". . . . . .", ". . . . . .", ". . . . . ."])), []);
  // Full length 6 for two symbols at once; listed in table order (h2 before l... and h3).
  wins = __goremeTest.evaluateWays(fromRows([
    "h3 h3 h3 h3 h3 h3",
    "h2 h2 h2 h2 .  .",
    "h2 .  .  .  .  .",
    ".  .  .  .  .  .",
    ".  .  .  .  .  .",
  ]));
  assert.deepEqual(wins.map(w => [w.symbol, w.length, w.ways, w.payTenThousandths]), [["h2", 4, 2, 2 * pay("h2", 4)], ["h3", 6, 1, pay("h3", 6)]]);
  // A dead board pays nothing.
  assert.deepEqual(__goremeTest.evaluateWays(board(() => undefined)), []);
});

test("ways with balloons: c + w per reel, multipliers multiply across reels, the all-balloon ways are subtracted", () => {
  // Spec example: x3 on reel 1 and x2 on reel 3, one h1 on reels 0, 2, 4 -> lengths 5, weighted (1)(3)(1)(2)(1) - 0 = 6.
  let wins = __goremeTest.evaluateWays(fromRows([
    "h1 B3 h1 B2 h1 .",
    ".  .  .  .  .  .",
    ".  .  .  .  .  .",
    ".  .  .  .  .  .",
    ".  .  .  .  .  .",
  ]));
  const h1 = wins.find(w => w.symbol === "h1")!;
  assert.deepEqual([h1.length, h1.ways, h1.weightedWays, h1.multiplierProduct, h1.payTenThousandths], [5, 1, 6, 6, 6 * pay("h1", 5)]);
  // Every other symbol needs a real cell; the l-fillers on reel 0..5 are different symbols, so only those with 3+ reels pay.
  for (const w of wins) assert.deepEqual(w, { ...w, ...bruteWays(fromRows(["h1 B3 h1 B2 h1 .", ". . . . . .", ". . . . . .", ". . . . . .", ". . . . . ."]), w.symbol) && {} });
  // Minus-all-wild: every reel of the run holds a balloon. (1+2)(0+3)(1+1) - 2*3*1 = 12 weighted ways; plain (1+1)(0+1)(1+1) - 1 = 3.
  const grid = fromRows([
    "h4 B3 h4 l2 l3 l4",
    "B2 l1 B1 l2 l3 l4",
    "l5 l1 l5 l2 l3 l4",
    "l5 l1 l5 l2 l3 l4",
    "l5 l1 l5 l2 l3 l4",
  ]);
  wins = __goremeTest.evaluateWays(grid);
  const h4 = wins.find(w => w.symbol === "h4")!;
  assert.deepEqual([h4.length, h4.ways, h4.weightedWays, h4.multiplierProduct], [3, 3, 12, 6]);
  assert.equal(h4.payTenThousandths, 12 * pay("h4", 3));
  // Balloons only: no symbol pays (the subtracted term removes all-balloon ways and a symbol needs a real cell).
  assert.deepEqual(__goremeTest.evaluateWays(fromRows(["B5 B5 B5 B5 B5 B5", "S S S S S S", "S S S S S S", "S S S S S S", "S S S S S S"])), []);
  // Two balloons on one reel add their multipliers: (1)(2+3)(1) = 5.
  const two = __goremeTest.evaluateWays(fromRows(["h2 B2 h2 . . .", ". B3 . . . .", ". . . . . .", ". . . . . .", ". . . . . ."])).find(w => w.symbol === "h2")!;
  assert.deepEqual([two.weightedWays, two.ways, two.multiplierProduct], [5, 2, 3]);
  // Order: every win of a board is in table order.
  for (const s of seeds(60)) {
    const round = playGoremeRound(s, 100, "buy");
    for (const spin of round.spins) for (const step of ofType(spin.steps, "ways")) {
      const idx = step.wins.map(w => GOREME_PAY_SYMBOLS.indexOf(w.symbol));
      assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
    }
  }
});

test("ways formula equals an independent brute force over every way on engine boards (balloons included)", () => {
  let checked = 0, withBalloons = 0;
  for (const s of seeds(80, "0f0e0d0c0b0a09080706050403020100")) {
    const round = playGoremeRound(s, 100, "buy");
    for (const spin of round.spins) {
      let grid: GoremeGrid | null = null;
      for (const step of spin.steps) {
        if (step.type === "spin" || step.type === "respin") grid = step.grid;
        if (step.type !== "ways") continue;
        const wins = new Map(step.wins.map(w => [w.symbol, w]));
        const hasBalloon = flat(grid!).some(c => c.symbol === "balloon");
        if (hasBalloon) withBalloons++;
        for (const symbol of GOREME_PAY_SYMBOLS) {
          const brute = bruteWays(grid!, symbol), win = wins.get(symbol);
          if (brute.weighted === 0) { assert.equal(win, undefined); continue; }
          assert.ok(win, `${symbol} should win`);
          assert.deepEqual([win.length, win.weightedWays, win.ways], [brute.length, brute.weighted, brute.plain]);
          assert.equal(win.payTenThousandths, Math.min(pay(symbol, win.length) * win.weightedWays, CAP * 100));
          const ids = new Set(win.cells);
          for (let c = 0; c < win.length; c++) for (const cell of grid![c]!) assert.equal(ids.has(cell.id), cell.symbol === symbol || cell.symbol === "balloon");
          assert.equal(win.cells.length, ids.size);
          checked++;
        }
        assert.equal(step.baseTenThousandths, step.wins.reduce((a, w) => a + w.payTenThousandths, 0));
        assert.equal(step.winHundredths, Math.min(Math.floor(step.baseTenThousandths * step.skyMultiplier / 100), CAP));
      }
    }
  }
  assert.ok(checked > 500 && withBalloons > 200, `checked ${checked}, boards with balloons ${withBalloons}`);
});

test("lift: one row up, +1 (max 25), one reel with the wind (edges hold), top row exits, same cell merges with the lowest id surviving", () => {
  const grid = fromRows([
    "B4 .  .  .  .  .",
    ".  .  .  .  B3 B4",
    ".  .  B2 .  .  .",
    ".  .  .  .  .  .",
    ".  .  .  .  .  B25",
  ]);
  const right = __goremeTest.lift(grid, 1);
  assert.deepEqual(right.exits, [{ id: 0, from: [0, 0], multiplier: 5, moored: false }]);
  assert.deepEqual(right.moves, [
    { id: 12, from: [2, 2], to: [3, 1], multiplierBefore: 2, multiplierAfter: 3 },
    { id: 21, from: [4, 1], to: [5, 0], multiplierBefore: 3, multiplierAfter: 4 },
    { id: 26, from: [5, 1], to: [5, 0], multiplierBefore: 4, multiplierAfter: 5 },
    { id: 29, from: [5, 4], to: [5, 3], multiplierBefore: 25, multiplierAfter: 25 },
  ]);
  assert.deepEqual(right.merges, [{ id: 21, absorbed: [26], at: [5, 0], parts: [4, 5], multiplier: 9 }]);
  const balloons = right.board.flatMap((col, c) => col.flatMap((cell, r) => cell ? [[cell.id, c, r, cell.multiplier]] : []));
  assert.deepEqual(balloons, [[12, 3, 1, 3], [21, 5, 0, 9], [29, 5, 3, 25]]);
  // Calm: straight up; left at the left edge holds the reel.
  const calm = __goremeTest.lift(fromRows([". . . . . .", "B1 . . . . .", ". . . . . .", ". . . . . .", ". . . . . ."]), 0);
  assert.deepEqual(calm.moves[0]!.to, [0, 0]);
  const left = __goremeTest.lift(fromRows([". . . . . .", "B1 B2 . . . .", ". . . . . .", ". . . . . .", ". . . . . ."]), -1, true);
  assert.deepEqual(left.merges, [{ id: 1, absorbed: [6], at: [0, 0], parts: [2, 3], multiplier: 5 }]);
  // Merge sums are capped at 25; exits are moorings when asked.
  const big = __goremeTest.lift(fromRows(["B9 . . . . .", ". . . . B20 B10", ". . . . . .", ". . . . . .", ". . . . . ."]), 1, true);
  assert.equal(big.merges[0]!.multiplier, 25);
  assert.deepEqual(big.merges[0]!.parts, [21, 11]);
  assert.deepEqual(big.exits, [{ id: 0, from: [0, 0], multiplier: 10, moored: true }]);
  // Non-balloon cells are not part of the lift.
  assert.deepEqual(__goremeTest.lift(board(() => "h1"), 1), { moves: [], merges: [], exits: [], board: Array.from({ length: 6 }, () => Array(5).fill(null)) });
});

/** Replays a spin's steps like a UI would and checks every invariant the animation relies on. Returns stats. */
function replaySpin(spin: GoremeSpin, previousBoard: GoremeGrid | null, mode: GoremeMode): { lifts: number; merges: number; moorings: number } {
  let grid: GoremeGrid | null = previousBoard, sky = spin.skyBefore, lifts = 0, merges = 0, moorings = 0, lastLift: GoremeLiftStep | null = null;
  let ways = 0;
  const tables = GOREME_MODE_TABLES[mode];
  for (const step of spin.steps) {
    if (step.type === "spin") {
      assert.ok(spin.kind === "base" ? lifts === 0 && grid === null : grid === null || !flat(grid).some(c => c.symbol === "balloon"), "a whole deal only on an empty board");
      assert.deepEqual(step.balloons, step.grid.flatMap((col, c) => col.flatMap((cell, r) => cell.symbol === "balloon" ? [{ id: cell.id, col: c, row: r, multiplier: cell.multiplier }] : [])));
      grid = step.grid;
    } else if (step.type === "lift") {
      lifts++; lastLift = step;
      assert.equal(step.lift, lifts);
      assert.equal(step.shift, ({ left: -1, calm: 0, right: 1 } as const)[step.wind]);
      const before = grid!.flatMap((col, c) => col.flatMap((cell, r) => cell.symbol === "balloon" ? [{ cell, c, r }] : []));
      assert.ok(before.length > 0, "a lift needs a balloon");
      assert.equal(step.moves.length + step.exits.length, before.length);
      for (const { cell, c, r } of before) {
        const value = Math.min(cell.multiplier + 1, GOREME_MAX_BALLOON_MULTIPLIER);
        if (r === 0) { assert.deepEqual(step.exits.find(e => e.id === cell.id), { id: cell.id, from: [c, r], multiplier: value, moored: spin.kind === "free" }); continue; }
        assert.deepEqual(step.moves.find(m => m.id === cell.id), { id: cell.id, from: [c, r], to: [Math.min(5, Math.max(0, c + step.shift)), r - 1], multiplierBefore: cell.multiplier, multiplierAfter: value });
      }
      // Balloons after the lift: one per occupied target cell, merges listed with the lowest id surviving.
      const targets = new Map<string, number[]>();
      for (const m of step.moves) targets.set(m.to.join(","), [...(targets.get(m.to.join(",")) ?? []), m.id]);
      assert.equal(step.balloons.length, targets.size);
      for (const b of step.balloons) {
        const ids = targets.get(`${b.col},${b.row}`)!;
        assert.equal(b.id, Math.min(...ids));
        const sum = step.moves.filter(m => ids.includes(m.id)).reduce((a, m) => a + m.multiplierAfter, 0);
        assert.equal(b.multiplier, Math.min(sum, GOREME_MAX_BALLOON_MULTIPLIER));
        assert.ok(b.multiplier >= 2 && b.multiplier <= GOREME_MAX_BALLOON_MULTIPLIER);
      }
      assert.equal(step.merges.length, [...targets.values()].filter(ids => ids.length > 1).length);
      merges += step.merges.length;
      if (spin.kind === "base") assert.ok(step.exits.every(e => !e.moored));
    } else if (step.type === "sky") {
      assert.equal(spin.kind, "free");
      assert.deepEqual(step.moored, lastLift!.exits.map(e => ({ id: e.id, multiplier: e.multiplier })));
      assert.equal(step.skyBefore, sky);
      assert.ok(step.skyAfter > step.skyBefore, "the sky multiplier only grows");
      assert.equal(step.skyAfter, (sky === 1 ? 0 : sky) + step.moored.reduce((a, m) => a + m.multiplier, 0));
      sky = step.skyAfter; moorings += step.moored.length;
    } else if (step.type === "respin") {
      assert.ok(lastLift, "a respin follows a lift");
      const kept = new Map(lastLift.balloons.map(b => [`${b.col},${b.row}`, b]));
      const drops = new Map(step.drops.map(d => [`${d.col},${d.row}`, d]));
      let previousId = -1;
      for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) {
        const cell = step.grid[c]![r]!, b = kept.get(`${c},${r}`), d = drops.get(`${c},${r}`);
        if (b) { assert.deepEqual([cell.id, cell.symbol, cell.multiplier], [b.id, "balloon", b.multiplier]); assert.equal(d, undefined); continue; }
        assert.ok(d, "every non-balloon cell is respun");
        assert.deepEqual(d, { id: cell.id, col: c, row: r, symbol: cell.symbol, multiplier: cell.multiplier });
        assert.ok(cell.id > previousId, "fresh ids are increasing");
        previousId = cell.id;
        if (spin.kind === "base") assert.notEqual(cell.symbol, "sun", "base respins never deal a sun");
      }
      assert.equal(step.drops.length + kept.size, 30);
      assert.deepEqual(step.balloons, step.drops.filter(d => d.symbol === "balloon").map(d => ({ id: d.id, col: d.col, row: d.row, multiplier: d.multiplier })));
      grid = step.grid;
    } else if (step.type === "ways") {
      assert.equal(step.skyMultiplier, spin.kind === "base" ? 1 : sky);
      const expected = __goremeTest.evaluateWays(grid!);
      assert.deepEqual(step.wins, expected);
      ways += step.winHundredths;
    } else if (step.type === "scatter") {
      const suns = flat(grid!).filter(c => c.symbol === "sun").map(c => c.id);
      assert.deepEqual(step.cells, suns);
      assert.equal(step.count, suns.length);
      assert.ok(step.count >= 3);
    }
  }
  assert.equal(spin.lifts, lifts);
  assert.equal(spin.skyAfter, sky);
  assert.equal(spin.waysHundredths, ways);
  assert.equal(spin.finalGrid, grid);
  void tables;
  return { lifts, merges, moorings };
}

test("step lists replay exactly in every mode: deals, lifts, merges, respins, ways, scatters and sky (a UI can animate from them)", () => {
  let lifts = 0, merges = 0, moorings = 0, freeSpins = 0, multiLift = 0;
  for (const [i, s] of seeds(500, "1234123412341234abcdabcdabcdabcd").entries()) {
    const mode = MODES[i % 3]!;
    const round = playGoremeRound(s, 100, mode);
    let previous: GoremeGrid | null = null;
    for (const spin of round.spins) {
      const r = replaySpin(spin, spin.kind === "base" ? null : previous, mode);
      lifts += r.lifts; merges += r.merges; moorings += r.moorings;
      if (spin.kind === "base" && r.lifts > 1) multiLift++;
      if (spin.kind === "free") freeSpins++;
      // Unique ids on every board.
      for (const step of spin.steps) if (step.type === "spin" || step.type === "respin") assert.equal(new Set(flat(step.grid).map(c => c.id)).size, 30);
      previous = spin.finalGrid;
    }
  }
  assert.ok(lifts > 300 && merges > 0 && moorings > 200 && freeSpins > 1000 && multiLift > 5, `lifts ${lifts}, merges ${merges}, moorings ${moorings}, free spins ${freeSpins}`);
});

test("base chain: a lift follows every paid board that holds a balloon, ends with an empty board or after 20 lifts", () => {
  let chains = 0;
  for (const s of seeds(1500, "feedfacefeedfacefeedfacefeedface")) {
    const round = playGoremeRound(s, 100, "standard"), base = round.spins[0]!;
    const boards = base.steps.filter((st): st is Extract<GoremeStep, { grid: GoremeGrid }> => st.type === "spin" || st.type === "respin");
    assert.equal(boards.length, base.lifts + 1);
    assert.equal(ofType(base.steps, "ways").length, base.lifts + 1, "every board is paid in full");
    boards.slice(0, -1).forEach(b => assert.ok(flat(b.grid).some(c => c.symbol === "balloon")));
    if (!round.capped && base.lifts < GOREME_MAX_LIFTS) assert.ok(!flat(base.finalGrid).some(c => c.symbol === "balloon"), "the chain ends on a board without balloons");
    if (base.lifts > 0) chains++;
  }
  assert.ok(chains > 30, `chains ${chains}`);
  // With balloons on every respin cell the chain stops at 20 lifts.
  const always = tuned({ tables: { standard: { respin: [["balloon", 1]], base: [["balloon", 1]] } }, maxFreeSpins: 0 });
  const round = __goremeTest.play(SEED, 100, "standard", always);
  assert.ok(round.capped || round.spins[0]!.lifts === GOREME_MAX_LIFTS);
  const lowCap = tuned({ tables: { standard: { respin: [["balloon", 1]], base: [["balloon", 1]] } }, maxFreeSpins: 0, paytable: Object.fromEntries(GOREME_PAY_SYMBOLS.map(s => [s, [0, 0, 0, 0]])) as never });
  assert.equal(__goremeTest.play(SEED, 100, "standard", lowCap).spins[0]!.lifts, GOREME_MAX_LIFTS);
});

test("stack entries repeat the pay symbol directly above; on row 0 or under a balloon / sun they redraw from the table without stack", () => {
  const t = tuned({ tables: { standard: { base: [["h3", 1], ["l2", 1], ["stack", 1_000_000_000]] } }, maxFreeSpins: 0 });
  for (const s of seeds(20)) {
    const grid = (__goremeTest.play(s, 100, "standard", t).spins[0]!.steps[0] as { grid: GoremeGrid }).grid;
    for (const column of grid) assert.ok(column.every(cell => cell.symbol === column[0]!.symbol && (cell.symbol === "h3" || cell.symbol === "l2")));
  }
  const underSun = tuned({ tables: { standard: { base: [["sun", 1], ["stack", 1]] } }, maxFreeSpins: 0 });
  const grid = (__goremeTest.play(SEED, 100, "standard", underSun).spins[0]!.steps[0] as { grid: GoremeGrid }).grid;
  assert.ok(flat(grid).every(c => c.symbol === "sun"), "a stack under a sun redraws (here only suns exist)");
  for (const mode of MODES) for (const key of ["base", "respin", "free"] as const) assert.ok(GOREME_MODE_TABLES[mode][key].some(([s]) => s === "stack"));
});

test("sun scatter: first board only; 3 / 4 / 5 / 6+ pay 2x / 5x / 20x / 100x and award 10 / 12 / 15 / 20 free spins; free spins retrigger +5 from 3 suns", () => {
  const seen = new Set<number>();
  let retriggers = 0;
  for (const s of seeds(1200, "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a")) {
    for (const mode of ["standard", "buy"] as const) {
      const round = playGoremeRound(s, 100, mode), base = round.spins[0]!;
      const firstBoard = (base.steps[0] as { grid: GoremeGrid }).grid;
      const suns = flat(firstBoard).filter(c => c.symbol === "sun").length;
      assert.equal(base.scatterCount, suns);
      const award = suns >= 3 ? GOREME_SCATTER_AWARDS[Math.min(suns, 6) as 3 | 4 | 5 | 6] : null;
      assert.equal(base.scatterHundredths, award ? award.payHundredths : 0);
      assert.equal(base.scatterSpinsAwarded, award ? award.spins : 0);
      assert.equal(round.freeSpinsTriggered, award !== null && base.totalHundredthsAfter < CAP);
      if (award && !round.capped) { assert.equal(base.freeSpinsAwarded, award.spins); seen.add(Math.min(suns, 6)); }
      assert.equal(base.winHundredths, base.waysHundredths + base.scatterHundredths);
      for (const spin of round.spins.slice(1)) {
        assert.equal(spin.scatterHundredths, 0, "no scatter pay in free spins");
        const n = flat(spin.finalGrid).filter(c => c.symbol === "sun").length;
        assert.equal(spin.scatterCount, n);
        assert.equal(spin.scatterSpinsAwarded, n >= 3 ? GOREME_FREE_SPINS_RETRIGGER : 0);
        if (n >= 3) retriggers++;
      }
    }
  }
  assert.ok(seen.has(3), `sun counts seen ${[...seen]}`);
  assert.ok(retriggers > 0, "retriggers happen");
  // A sunny table reaches every award row (same mapping, tuned weights only).
  const sunny = tuned({ tables: { standard: { base: GOREME_MODE_TABLES.standard.base.map(([s, w]) => [s, s === "sun" ? 2500 : w] as const) } } });
  const rows = new Map<number, number>();
  for (const s of seeds(400)) {
    const round = __goremeTest.play(s, 100, "standard", sunny), base = round.spins[0]!;
    if (base.scatterCount < 3) continue;
    const award = GOREME_SCATTER_AWARDS[Math.min(base.scatterCount, 6) as 3 | 4 | 5 | 6];
    assert.deepEqual([base.scatterHundredths, base.scatterSpinsAwarded], [award.payHundredths, award.spins]);
    const step = ofType(base.steps, "scatter")[0]!;
    assert.deepEqual([step.count, step.payHundredths, step.freeSpins], [base.scatterCount, award.payHundredths, award.spins]);
    rows.set(Math.min(base.scatterCount, 6), (rows.get(Math.min(base.scatterCount, 6)) ?? 0) + 1);
  }
  assert.deepEqual([...rows.keys()].sort(), [3, 4, 5, 6], `rows ${[...rows]}`);
});

test("free spins: balloons carry between spins, exits moor into the sky band, the sky multiplier starts at x1, only grows and multiplies every win", () => {
  let moored = 0, boosted = 0, carried = 0;
  for (const s of seeds(150, "babababababababababababababababa")) {
    const round = playGoremeRound(s, 100, "buy");
    assert.ok(round.freeSpinsTriggered);
    let sky = 1, previous: GoremeGrid | null = null, mooredSum = 0;
    for (const spin of round.spins) {
      if (spin.kind === "base") { assert.equal(spin.skyAfter, 1); continue; }
      assert.equal(spin.skyBefore, sky);
      assert.ok(spin.skyAfter >= spin.skyBefore);
      const first = spin.steps[0]!;
      const before = previous ? flat(previous).filter(c => c.symbol === "balloon") : [];
      if (before.length > 0) {
        assert.equal(first.type, "lift");
        carried++;
        const lift = first as GoremeLiftStep;
        assert.deepEqual([...lift.moves.map(m => m.id), ...lift.exits.map(e => e.id)].sort((a, b) => a - b), before.map(c => c.id).sort((a, b) => a - b));
        for (const e of lift.exits) { assert.equal(e.moored, true); mooredSum += e.multiplier; moored++; }
        const respin = spin.steps.find((x): x is GoremeRespinStep => x.type === "respin")!;
        for (const b of lift.balloons) assert.equal(respin.grid[b.col]![b.row]!.id, b.id, "balloons keep their ids across the free spin");
      } else assert.equal(first.type, "spin");
      if (mooredSum > 0) assert.equal(spin.skyAfter, mooredSum);
      else assert.equal(spin.skyAfter, 1);
      const ways = ofType(spin.steps, "ways");
      assert.equal(ways.length, 1);
      assert.equal(ways[0]!.skyMultiplier, spin.skyAfter);
      if (spin.skyAfter > 1 && ways[0]!.winHundredths > 0) boosted++;
      sky = spin.skyAfter; previous = spin.finalGrid;
    }
  }
  assert.ok(moored > 100 && boosted > 50 && carried > 200, `moored ${moored}, boosted ${boosted}, carried ${carried}`);
  // The feature starts with an empty board: the first free spin deals a whole board.
  for (const s of seeds(30)) assert.equal(playGoremeRound(s, 100, "buy").spins[1]!.steps[0]!.type, "spin");
});

test("buy: the first board always holds 3+ suns, the free spins always trigger, the sun pay still counts", () => {
  for (const s of seeds(400, "77777777777777777777777777777777")) {
    const round = playGoremeRound(s, 100, "buy");
    const base = round.spins[0]!;
    assert.ok(base.scatterCount >= GOREME_BUY_MIN_SCATTERS);
    assert.ok(round.freeSpinsTriggered);
    assert.ok(round.spins.length >= 11 || round.capped);
    assert.ok(base.scatterHundredths >= GOREME_SCATTER_AWARDS[3].payHundredths);
  }
});

test("ensureSuns follows the documented procedure: 3 - k draws over cells that are neither sun nor balloon, reel-major, ids kept", () => {
  const grid = fromRows(["S . . . . .", "B2 . . . . .", ". . . . . .", ". . . . . .", ". . . . . ."]);
  const ids = flat(grid).map(c => c.id);
  __goremeTest.ensureSuns(grid, 3, SEED);
  assert.equal(flat(grid).filter(c => c.symbol === "sun").length, 3);
  assert.deepEqual(flat(grid).map(c => c.id), ids, "ids kept");
  assert.equal(grid[0]![1]!.symbol, "balloon", "balloons are never replaced");
  // Same draws by hand.
  const rng = __goremeTest.createRng(SEED), copy = fromRows(["S . . . . .", "B2 . . . . .", ". . . . . .", ". . . . . .", ". . . . . ."]);
  for (let k = 0; k < 2; k++) {
    const spots: [number, number][] = [];
    for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) if (copy[c]![r]!.symbol !== "sun" && copy[c]![r]!.symbol !== "balloon") spots.push([c, r]);
    const [c, r] = spots[Math.floor(rng() * spots.length / 2 ** 32)]!;
    copy[c]![r] = { ...copy[c]![r]!, symbol: "sun" };
  }
  assert.deepEqual(flat(copy).map(c => c.symbol), flat(grid).map(c => c.symbol));
  const full = fromRows(["S S S . . .", ". . . . . .", ". . . . . .", ". . . . . .", ". . . . . ."]), before = JSON.stringify(full);
  __goremeTest.ensureSuns(full, 3, SEED);
  assert.equal(JSON.stringify(full), before, "no draws when 3 suns are there");
});

test("ante: the feature is about twice as frequent as in standard on the same seeds and is never forced", () => {
  const list = seeds(24_000, "a0a0a0a0b1b1b1b1c2c2c2c2d3d3d3d3");
  let standard = 0, ante = 0;
  for (const s of list) {
    if (playGoremeRound(s, 100, "standard").freeSpinsTriggered) standard++;
    if (playGoremeRound(s, 100, "ante").freeSpinsTriggered) ante++;
  }
  assert.ok(standard > 40 && ante > standard * 1.5 && ante < standard * 2.8, `standard ${standard}, ante ${ante}`);
});

test("mode tables: positive integer weights, base respins deal no sun, ante raises only the base sun weight, buy keeps the base tables", () => {
  for (const mode of MODES) {
    const t = GOREME_MODE_TABLES[mode];
    for (const list of [t.base, t.respin, t.free]) {
      assert.deepEqual(list.map(([s]) => s), [...GOREME_PAY_SYMBOLS, "stack", "balloon", "sun"]);
      for (const [, w] of list) assert.ok(Number.isSafeInteger(w) && w >= 0);
    }
    assert.equal(t.respin.find(([s]) => s === "sun")![1], 0, "base respins deal no sun");
    for (const list of [t.baseMultipliers, t.freeMultipliers]) assert.deepEqual(list.map(([m]) => m), [...GOREME_LANDING_MULTIPLIERS]);
    const weight = (s: string): number => t.base.find(([x]) => x === s)![1];
    assert.ok(weight("balloon") > 0 && weight("sun") > 0 && weight("balloon") < weight("l5") && weight("sun") < weight("l5"));
  }
  const sun = (mode: GoremeMode): number => GOREME_MODE_TABLES[mode].base.find(([s]) => s === "sun")![1];
  assert.ok(sun("ante") > sun("standard"));
  assert.deepEqual(GOREME_MODE_TABLES.ante.base.filter(([s]) => s !== "sun"), GOREME_MODE_TABLES.standard.base.filter(([s]) => s !== "sun"));
  assert.deepEqual(GOREME_MODE_TABLES.buy.base, GOREME_MODE_TABLES.standard.base);
  assert.deepEqual(GOREME_MODE_TABLES.buy.respin, GOREME_MODE_TABLES.standard.respin);
});

test("the 10 000 x bet cap clamps the total in every mode, ends the round at once and zeroes the free spins left", () => {
  const rich = Object.fromEntries(GOREME_PAY_SYMBOLS.map(s => [s, [100_000_000, 100_000_000, 100_000_000, 100_000_000]])) as never;
  const richTuning = tuned({ paytable: rich });
  for (const mode of MODES) {
    let capped = 0;
    for (const s of seeds(100)) {
      const round = __goremeTest.play(s, 100, mode, richTuning);
      if (!round.capped) continue;
      capped++;
      assert.equal(round.totalHundredths, CAP);
      assert.equal(round.payoutCents, 100 * GOREME_MAX_WIN_MULTIPLIER);
      const last = round.spins.at(-1)!;
      assert.equal(last.freeSpinsLeft, 0);
      assert.equal(last.totalHundredthsAfter, CAP);
      // The cap ends a base chain at once: the last step is the ways (or scatter) step that reached it.
      const lastStep = last.steps.at(-1)!;
      assert.ok(lastStep.type === "ways" || lastStep.type === "scatter");
      for (const spin of round.spins.slice(0, -1)) assert.ok(spin.totalHundredthsAfter < CAP);
    }
    assert.ok(capped > 20, `${mode}: ${capped} capped`);
  }
  // A small custom cap behaves the same.
  const r = __goremeTest.play(SEED, 100, "buy", tuned({ capHundredths: 200 }));
  assert.ok(r.capped && r.totalHundredths === 200 && r.spins.length === 1, "the buy scatter pay alone reaches a 2 x cap");
});

test("safety bound: total free spins granted per round <= GOREME_MAX_FREE_SPINS (custom bound honoured)", () => {
  const t = tuned({ maxFreeSpins: 12, tables: { buy: { free: [["l1", 1], ["sun", 1]] } } });
  for (const s of seeds(10)) {
    const round = __goremeTest.play(s, 100, "buy", t);
    assert.equal(round.spins.reduce((a, sp) => a + sp.freeSpinsAwarded, 0), 12);
    assert.equal(round.spins.length, 13);
  }
});

test("structure: 6x5 boards and bookkeeping add up in all modes", () => {
  for (const [i, s] of seeds(600, "c0ffeec0ffeec0ffeec0ffeec0ffee00").entries()) {
    const mode = MODES[i % 3]!;
    const round: GoremeRound = playGoremeRound(s, 100, mode);
    let total = 0, granted = 0, left = 0;
    round.spins.forEach((spin, k) => {
      assert.equal(spin.index, k);
      assert.equal(spin.kind, k === 0 ? "base" : "free");
      if (k > 0) left--;
      assert.equal(spin.finalGrid.length, 6);
      for (const column of spin.finalGrid) assert.equal(column.length, 5);
      const ways = ofType(spin.steps, "ways") as GoremeWaysStep[];
      assert.equal(spin.waysHundredths, ways.reduce((a, w) => a + w.winHundredths, 0));
      assert.equal(spin.winHundredths, spin.waysHundredths + spin.scatterHundredths);
      total = Math.min(CAP, total + spin.winHundredths);
      assert.equal(spin.totalHundredthsAfter, total);
      granted += spin.freeSpinsAwarded; left += spin.freeSpinsAwarded;
      assert.equal(spin.freeSpinsLeft, round.capped && k === round.spins.length - 1 ? 0 : left);
      for (const cell of flat(spin.finalGrid)) assert.equal(cell.multiplier > 0, cell.symbol === "balloon");
    });
    assert.ok(granted <= GOREME_MAX_FREE_SPINS);
    assert.equal(round.freeSpinsTriggered, round.spins[0]!.freeSpinsAwarded > 0);
    if (!round.capped) assert.equal(round.spins.length, 1 + granted);
  }
});

test("GOREME_RTP equals the simulation evidence and the evidence matches the engine source", () => {
  const dir = fileURLToPath(new URL("../../../ops/evidence/goreme-20261021/", import.meta.url));
  const evidence = JSON.parse(readFileSync(`${dir}rtp.json`, "utf8")) as {
    engine: string; engineSourceSha256: string; tuningOverride: unknown; seed: string; modes: Record<GoremeMode, {
      rounds: number; rtpVsCost: { pointEstimate: number; ci95: [number, number] }; hitRate: number; featureRate: number; stdDevPerRoundCostUnits: number; capHits: number;
      winTiersShareOfRounds: Record<string, number>; minSunsOnFirstBoard: number; costMismatches: number;
      liftChain: { avgChainLengthWhenLifting: number }; sky: { moorings: number; maxFinalSky: number }; balloons: { mergesInBase: number; mergesInFree: number };
    }>;
  };
  assert.equal(evidence.engine, GOREME_ENGINE_ID);
  assert.equal(evidence.tuningOverride, null, "evidence runs never use a tuning override");
  assert.ok(!evidence.seed.includes("tune"), "evidence seeds are distinct from tuning seeds");
  const source = readFileSync(fileURLToPath(new URL("../src/goreme.ts", import.meta.url)), "utf8")
    .replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
  assert.equal(createHash("sha256").update(source).digest("hex"), evidence.engineSourceSha256, "engine code changed after the evidence run: rerun the simulation");
  const r3 = (x: number): number => Number(x.toFixed(3));
  for (const mode of MODES) {
    const e = evidence.modes[mode], c = GOREME_RTP[mode];
    assert.ok(e.rounds >= 20_000_000, `${mode}: ${e.rounds} rounds`);
    assert.equal(c.rounds, e.rounds);
    assert.equal(c.rtp, r3(e.rtpVsCost.pointEstimate));
    assert.equal(c.ciLow, r3(e.rtpVsCost.ci95[0]));
    assert.equal(c.ciHigh, r3(e.rtpVsCost.ci95[1]));
    assert.equal(c.hitRate, r3(e.hitRate));
    assert.equal(c.featureRate, Number(e.featureRate.toFixed(4)));
    assert.equal(c.stdDev, r3(e.stdDevPerRoundCostUnits));
    assert.ok(c.rtp >= 0.94 && c.rtp <= 0.965, `${mode} rtp ${c.rtp} within 94-96.5%`);
    assert.ok(c.ciLow <= c.rtp && c.rtp <= c.ciHigh);
    assert.equal(e.costMismatches, 0);
    assert.ok(e.liftChain.avgChainLengthWhenLifting >= 1 && e.sky.moorings > 0 && e.balloons.mergesInBase + e.balloons.mergesInFree > 0);
    for (const key of ["atLeast10xBet", "atLeast100xBet", "atLeast1000xBet", "atLeast10000xBet"]) assert.ok(key in e.winTiersShareOfRounds, key);
  }
  assert.ok(evidence.modes.buy.minSunsOnFirstBoard >= 3);
  assert.ok(GOREME_RTP.buy.featureRate === 1 && GOREME_RTP.ante.featureRate > GOREME_RTP.standard.featureRate * 1.6 && GOREME_RTP.ante.featureRate < GOREME_RTP.standard.featureRate * 2.5);
});
