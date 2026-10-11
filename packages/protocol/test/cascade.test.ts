import test from "node:test";
import assert from "node:assert/strict";
import {
  CASCADE_BASE_WEIGHTS, CASCADE_COLS, CASCADE_CRYSTAL_WEIGHTS, CASCADE_ENGINE_ID, CASCADE_FREE_WEIGHTS, CASCADE_MAX_WIN_MULTIPLIER,
  CASCADE_PAYTABLE, CASCADE_ROWS, CASCADE_SCATTER_PAY, __cascadeTest, cascadeSeedFromEntropy, playCascadeRound,
  type CascadeCell, type CascadeGrid, type CascadePaySymbol, type CascadeRound, type CascadeSymbol,
} from "../src/cascade.ts";
import * as protocol from "../src/index.ts";

const PAY: CascadePaySymbol[] = ["crown", "cupcake", "donut", "gumdrop", "strawberry", "blueberry", "kiwi", "lemon", "cherry"];
const SEED = "0123456789abcdef0123456789abcdef";
/** Deterministic stream of distinct round seeds for searches. */
function seeds(count: number, label = "f00dcafe00112233445566778899aabb"): string[] {
  const rng = __cascadeTest.createRng(label);
  return Array.from({ length: count }, () => cascadeSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
const makeGrid = (symbolAt: (col: number, row: number) => CascadeSymbol, firstId = 0): CascadeGrid => {
  let id = firstId;
  return Array.from({ length: CASCADE_COLS }, (_, c) => Array.from({ length: CASCADE_ROWS }, (_, r): CascadeCell => ({ id: id++, symbol: symbolAt(c, r) })));
};
const weights = (table: readonly (readonly [CascadeSymbol, number])[], over: Partial<Record<CascadeSymbol, number>>) =>
  table.map(([s, w]) => [s, over[s] ?? w] as const);
const allGrids = (round: CascadeRound): CascadeGrid[] => round.spins.flatMap(s => s.steps.map(step => step.grid));
const cellsOf = (grid: CascadeGrid): CascadeCell[] => grid.flat();

test("engine id, constants and the protocol index re-export", () => {
  assert.equal(CASCADE_ENGINE_ID, "candy-cascade-1");
  assert.equal(CASCADE_COLS, 6);
  assert.equal(CASCADE_ROWS, 5);
  assert.equal(CASCADE_MAX_WIN_MULTIPLIER, 5000);
  assert.equal(protocol.playCascadeRound, playCascadeRound);
});

test("same seed and stake give a byte-identical round; different seeds differ", () => {
  const a = playCascadeRound(SEED, 500), b = playCascadeRound(SEED, 500);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.engine, CASCADE_ENGINE_ID);
  assert.equal(a.seedHex, SEED);
  assert.equal(a.stakeCents, 500);
  const distinct = new Set(seeds(50).map(s => JSON.stringify(playCascadeRound(s, 500).spins[0]!.steps[0]!.grid)));
  assert.equal(distinct.size, 50);
  assert.notEqual(JSON.stringify(playCascadeRound("0123456789abcdef0123456789abcdee", 500)), JSON.stringify(a));
  // The stake never changes the dealt cards, only the payout.
  assert.deepEqual(playCascadeRound(SEED, 100).spins, playCascadeRound(SEED, 40_000).spins);
});

test("all-equal entropy words give a live RNG and a valid round", () => {
  for (const word of [0, 1, 0x80000000, 0x9e3779b9, 0xffffffff, 0xdeadbeef]) {
    const hex = cascadeSeedFromEntropy(new Uint32Array([word, word, word, word]));
    assert.match(hex, /^[0-9a-f]{32}$/);
    const rng = __cascadeTest.createRng(hex);
    const outputs = Array.from({ length: 16 }, rng);
    assert.ok(new Set(outputs).size > 8, `stream for ${hex} looks stuck`);
    const round = playCascadeRound(hex, 100);
    assert.equal(round.spins[0]!.steps[0]!.grid.length, 6);
    assert.ok(round.totalHundredths >= 0);
  }
  // The same holds for a stubbed getRandomValues(fill(constant)) style source.
  for (const fill of [0, 0xffffffff]) assert.doesNotThrow(() => playCascadeRound(cascadeSeedFromEntropy(new Uint32Array(4).fill(fill)), 100));
  // Sweep of repeating-byte seeds never yields a degenerate stream either.
  for (let b = 0; b < 256; b++) {
    const hex = b.toString(16).padStart(2, "0").repeat(16);
    const outputs = Array.from({ length: 8 }, __cascadeTest.createRng(hex));
    assert.ok(new Set(outputs).size > 1, hex);
  }
});

test("cascadeSeedFromEntropy formats 4 words and rejects other lengths", () => {
  assert.equal(cascadeSeedFromEntropy(new Uint32Array([1, 0xabcdef12, 0, 0xffffffff])), "00000001abcdef1200000000ffffffff");
  assert.throws(() => cascadeSeedFromEntropy(new Uint32Array(3)), RangeError);
  assert.throws(() => cascadeSeedFromEntropy(new Uint32Array(5)), RangeError);
  assert.throws(() => cascadeSeedFromEntropy([1, 2, 3, 4] as unknown as Uint32Array), RangeError);
});

test("input validation throws RangeError", () => {
  for (const bad of ["", "0123456789ABCDEF0123456789ABCDEF", SEED.slice(1), SEED + "0", "g".repeat(32), ` ${SEED.slice(1)}`, 123 as unknown as string, undefined as unknown as string]) {
    assert.throws(() => playCascadeRound(bad, 100), RangeError, String(bad));
  }
  for (const bad of [99, 50_001, 0, -100, 100.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "100" as unknown as number, 100n as unknown as number, null as unknown as number]) {
    assert.throws(() => playCascadeRound(SEED, bad), RangeError, String(bad));
  }
  assert.doesNotThrow(() => playCascadeRound(SEED, 100));
  assert.doesNotThrow(() => playCascadeRound(SEED, 50_000));
});

test("every grid is 6x5 and its ids are unique; ids never repeat inside a round", () => {
  for (const seed of seeds(300)) {
    const round = playCascadeRound(seed, 100);
    const seen = new Map<number, CascadeSymbol>();
    for (const grid of allGrids(round)) {
      assert.equal(grid.length, 6);
      for (const column of grid) assert.equal(column.length, 5);
      const ids = cellsOf(grid).map(cell => cell.id);
      assert.equal(new Set(ids).size, 30);
      for (const cell of cellsOf(grid)) {
        assert.ok(Number.isInteger(cell.id) && cell.id >= 0);
        assert.equal(seen.get(cell.id) ?? cell.symbol, cell.symbol, "an id keeps its symbol for the whole round");
        seen.set(cell.id, cell.symbol);
      }
    }
  }
});

test("win detection counts 8+ per symbol and pays by tier 8-9, 10-11, 12+", () => {
  const fill = (n: number, symbol: CascadePaySymbol, rest: CascadeSymbol[] = ["cherry"]): CascadeGrid => {
    let placed = 0, filler = 0;
    return makeGrid(() => (placed++ < n ? symbol : rest[filler++ % rest.length]!));
  };
  const rest: CascadeSymbol[] = ["lemon", "kiwi", "star", "blueberry", "strawberry"]; // never reaches 8 of anything
  assert.deepEqual(__cascadeTest.findWins(fill(7, "crown", rest)), []);
  for (const [count, tier] of [[8, 0], [9, 0], [10, 1], [11, 1], [12, 2], [17, 2]] as const) {
    const wins = __cascadeTest.findWins(fill(count, "crown", rest));
    assert.equal(wins.length, 1);
    assert.equal(wins[0]!.symbol, "crown");
    assert.equal(wins[0]!.count, count);
    assert.equal(wins[0]!.payHundredths, CASCADE_PAYTABLE.crown[tier]);
    assert.equal(wins[0]!.cells.length, count);
  }
  // Two symbols can win in the same step; star and crystal never do, however many there are.
  const grid = makeGrid((c) => (c < 2 ? "donut" : c < 4 ? "kiwi" : c === 4 ? "star" : "crystal"));
  const wins = __cascadeTest.findWins(grid);
  assert.deepEqual(wins.map(w => [w.symbol, w.count]), [["donut", 10], ["kiwi", 10]]);
  assert.equal(__cascadeTest.findWins(makeGrid(() => "star")).length, 0);
  assert.equal(__cascadeTest.findWins(makeGrid(() => "crystal")).length, 0);
});

test("tumble removes the winners, keeps survivors in order with their ids, and falls per column", () => {
  const grid = makeGrid((c, r) => (c === 0 ? (r % 2 === 0 ? "cherry" : "star") : c === 1 ? "crystal" : c === 2 ? "lemon" : c === 3 ? "cherry" : r === 4 ? "kiwi" : "cherry"));
  const wins = __cascadeTest.findWins(grid);
  assert.equal(wins.length, 1);
  assert.equal(wins[0]!.symbol, "cherry");
  const removed = new Set(wins[0]!.cells);
  const next = __cascadeTest.tumble(grid, wins, SEED, 30);
  assert.equal(next.length, 6);
  grid.forEach((column, c) => {
    const survivors = column.filter(cell => !removed.has(cell.id));
    const tail = next[c]!.slice(CASCADE_ROWS - survivors.length);
    assert.deepEqual(tail, survivors, `column ${c}: survivors keep ids and order, resting at the bottom`);
    assert.equal(next[c]!.length, 5);
    for (const cell of next[c]!.slice(0, CASCADE_ROWS - survivors.length)) assert.ok(cell.id >= 30, "refill uses fresh ids");
  });
  for (const id of removed) assert.ok(!cellsOf(next).some(cell => cell.id === id));
  assert.equal(next[1]!.every(cell => cell.symbol === "crystal" && cell.id < 30), true); // crystals never removed
  // Fresh ids are handed out column 0..5, top to bottom.
  const fresh = next.flatMap(column => column.filter(cell => cell.id >= 30)).map(cell => cell.id);
  assert.deepEqual(fresh, fresh.map((_, i) => 30 + i));
  assert.equal(fresh.length, removed.size);
});

test("steps follow the tumble contract across many seeds", () => {
  let tumbled = 0, multiWin = 0;
  for (const seed of seeds(4000)) {
    const round = playCascadeRound(seed, 100);
    let maxId = -1;
    for (const spin of round.spins) {
      const { steps } = spin;
      assert.equal(steps.at(-1)!.wins.length, 0, "last step has no wins");
      assert.equal(steps.at(-1)!.stepHundredths, 0);
      let sum = 0;
      steps.forEach((step, k) => {
        assert.equal(step.stepHundredths, step.wins.reduce((a, w) => a + w.payHundredths, 0));
        sum += step.stepHundredths;
        for (const win of step.wins) {
          assert.ok(win.count >= 8 && win.cells.length === win.count);
          assert.ok(!["star", "crystal"].includes(win.symbol));
          const tier = win.count >= 12 ? 2 : win.count >= 10 ? 1 : 0;
          assert.equal(win.payHundredths, CASCADE_PAYTABLE[win.symbol][tier]);
          const inGrid = cellsOf(step.grid).filter(cell => cell.symbol === win.symbol).map(cell => cell.id);
          assert.deepEqual(win.cells, inGrid, "a win lists every cell of its symbol (column-major)");
        }
        // Nothing wins except what is listed.
        assert.deepEqual(step.wins, __cascadeTest.findWins(step.grid));
        if (step.wins.length > 1) multiWin++;
        const following = steps[k + 1];
        if (!following) return;
        tumbled++;
        const removed = new Set(step.wins.flatMap(w => w.cells));
        step.grid.forEach((column, c) => {
          const survivors = column.filter(cell => !removed.has(cell.id));
          assert.deepEqual(following.grid[c]!.slice(5 - survivors.length), survivors);
        });
        const before = new Set(cellsOf(step.grid).map(cell => cell.id));
        for (const id of removed) assert.ok(!cellsOf(following.grid).some(cell => cell.id === id));
        const fresh = following.grid.flatMap(column => column.filter(cell => !before.has(cell.id))).map(cell => cell.id);
        assert.equal(fresh.length, removed.size);
        assert.ok(fresh.every((id, i) => i === 0 || id === fresh[i - 1]! + 1), "fresh ids are consecutive in fill order");
      });
      assert.equal(spin.tumbleHundredths, sum);
      const ids = steps.flatMap(step => cellsOf(step.grid).map(cell => cell.id));
      assert.ok(Math.min(...ids) > maxId, "ids of a new spin start above everything dealt before");
      maxId = Math.max(...ids);
    }
  }
  assert.ok(tumbled > 500 && multiWin > 0, `tumbles exercised: ${tumbled}, multi-win steps: ${multiWin}`);
});

test("symbol tables: crystal only in free spins, weights and paytable ordering", () => {
  assert.ok(!CASCADE_BASE_WEIGHTS.some(([s]) => s === "crystal"));
  assert.ok(CASCADE_FREE_WEIGHTS.some(([s]) => s === "crystal"));
  const weightOf = (table: typeof CASCADE_BASE_WEIGHTS, s: CascadeSymbol) => table.find(([x]) => x === s)![1];
  for (const table of [CASCADE_BASE_WEIGHTS, CASCADE_FREE_WEIGHTS]) {
    for (const [, w] of table) assert.ok(Number.isSafeInteger(w) && w > 0);
    const total = table.reduce((a, [, w]) => a + w, 0);
    assert.ok(weightOf(table, "star") / total < 0.03, "star is rare");
    for (const s of PAY) assert.ok(weightOf(table, "star") < weightOf(table, s));
  }
  assert.deepEqual(CASCADE_CRYSTAL_WEIGHTS.map(([v]) => v), [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100]);
  // Paytable: rising per tier, falling from the high class to the low class.
  PAY.forEach((s, i) => {
    const [a, b, c] = CASCADE_PAYTABLE[s];
    assert.ok(0 < a && a < b && b < c);
    if (i > 0) CASCADE_PAYTABLE[s].forEach((v, t) => assert.ok(v < CASCADE_PAYTABLE[PAY[i - 1]!][t]!, `${s} tier ${t}`));
  });
  assert.deepEqual(CASCADE_SCATTER_PAY, { 4: 300, 5: 500, 6: 10_000 });
  for (const seed of seeds(2500)) {
    const round = playCascadeRound(seed, 100);
    for (const spin of round.spins) {
      const crystals = spin.steps.flatMap(step => cellsOf(step.grid)).filter(cell => cell.symbol === "crystal");
      if (spin.kind === "base") assert.equal(crystals.length, 0);
      for (const cell of crystals) assert.ok(CASCADE_CRYSTAL_WEIGHTS.some(([v]) => v === cell.multiplier));
      for (const cell of spin.steps.flatMap(step => cellsOf(step.grid)).filter(cell => cell.symbol !== "crystal")) assert.equal(cell.multiplier, undefined);
    }
  }
});

test("scatter: 4+ stars in base pay and trigger 10 free spins; 3+ stars in free spins add 5 without pay", () => {
  const triggered = seeds(40_000).map(s => playCascadeRound(s, 100)).filter(r => r.freeSpinsTriggered);
  assert.ok(triggered.length > 20, `found ${triggered.length} triggers`);
  let paid = new Set<number>(), retriggered = 0, checkedBase = 0;
  for (const round of triggered) {
    const [first, ...free] = round.spins;
    assert.equal(first!.kind, "base");
    assert.ok(first!.scatterCount >= 4);
    assert.equal(first!.freeSpinsAwarded, 10);
    assert.equal(first!.freeSpinsLeft, 10);
    paid.add(first!.scatterHundredths);
    assert.equal(first!.scatterHundredths, CASCADE_SCATTER_PAY[Math.min(first!.scatterCount, 6) as 4 | 5 | 6]);
    let left = 10, played = 0, granted = 10;
    for (const spin of free) {
      assert.equal(spin.kind, "free");
      assert.equal(spin.scatterHundredths, 0);
      left -= 1;
      played++;
      assert.equal(spin.freeSpinsAwarded, spin.scatterCount >= 3 ? 5 : 0);
      if (spin.freeSpinsAwarded) retriggered++;
      left += spin.freeSpinsAwarded; granted += spin.freeSpinsAwarded;
      assert.equal(spin.freeSpinsLeft, round.capped ? 0 : left);
    }
    if (!round.capped) { assert.equal(played, granted); assert.equal(free.at(-1)!.freeSpinsLeft, 0); }
    checkedBase++;
  }
  assert.ok(retriggered > 0, "a retrigger occurred");
  assert.ok(paid.has(300), "4-star scatter pay seen");
  // Non-triggering base rounds have a single spin; 3 stars never trigger from base.
  for (const seed of seeds(3000)) {
    const round = playCascadeRound(seed, 100);
    if (!round.freeSpinsTriggered) { assert.equal(round.spins.length, 1); assert.equal(round.spins[0]!.freeSpinsAwarded, 0); assert.equal(round.spins[0]!.scatterHundredths, 0); }
  }
  assert.ok(checkedBase > 0);
  // Forced via tuning: every free spin retriggers, bounded by maxFreeSpins.
  const heavy = weights(CASCADE_FREE_WEIGHTS, { star: 400 });
  const round = __cascadeTest.play(SEED, 100, { base: weights(CASCADE_BASE_WEIGHTS, { star: 400 }), free: heavy, maxFreeSpins: 25, paytable: Object.fromEntries(PAY.map(s => [s, [0, 0, 0]])) as never });
  assert.equal(round.spins.length - 1, 25);
  assert.equal(round.spins.reduce((a, s) => a + s.freeSpinsAwarded, 0), 25);
  assert.equal(round.spins.at(-1)!.freeSpinsLeft, 0);
});

test("scatter pay tiers by star count on the base game", () => {
  const byCount = new Map<number, number>();
  const tuning = { base: weights(CASCADE_BASE_WEIGHTS, { star: 70 }), paytable: Object.fromEntries(PAY.map(s => [s, [0, 0, 0]])) as never };
  for (const seed of seeds(3000)) {
    const spin = __cascadeTest.play(seed, 100, tuning).spins[0]!;
    if (spin.scatterCount >= 4) byCount.set(Math.min(spin.scatterCount, 6), spin.scatterHundredths);
    else assert.equal(spin.scatterHundredths, 0);
  }
  assert.equal(byCount.get(4), 300);
  assert.equal(byCount.get(5), 500);
  assert.equal(byCount.get(6), 10_000);
});

test("multiplier: crystal values are summed per spin and applied only when the tumble wins", () => {
  let applied = 0, idle = 0, multiCrystal = 0;
  for (const seed of seeds(15_000)) {
    const round = playCascadeRound(seed, 100);
    for (const spin of round.spins) {
      const last = spin.steps.at(-1)!.grid;
      const crystals = cellsOf(last).filter(cell => cell.symbol === "crystal");
      const sum = crystals.reduce((a, cell) => a + cell.multiplier!, 0);
      assert.equal(spin.multiplierSum, sum);
      if (spin.kind === "base") assert.equal(spin.multiplierSum, 0);
      assert.equal(spin.winHundredths, spin.tumbleHundredths * (sum || 1) + spin.scatterHundredths);
      if (sum > 0 && spin.tumbleHundredths > 0) applied++;
      if (sum > 0 && spin.tumbleHundredths === 0) { idle++; assert.equal(spin.winHundredths, 0); }
      if (crystals.length > 1) multiCrystal++;
      // Crystals that landed during tumbles stay in the grid and count.
      const everSeen = new Set(spin.steps.flatMap(step => cellsOf(step.grid)).filter(cell => cell.symbol === "crystal").map(cell => cell.id));
      assert.equal(everSeen.size, crystals.length);
    }
  }
  assert.ok(applied > 20 && idle > 20 && multiCrystal > 20, `applied ${applied}, idle ${idle}, multi ${multiCrystal}`);
});

test("round totals accumulate the spin wins and stay under the cap", () => {
  for (const seed of seeds(1500)) {
    const round = playCascadeRound(seed, 100);
    let total = 0;
    round.spins.forEach((spin, i) => {
      assert.equal(spin.index, i);
      assert.equal(spin.kind, i === 0 ? "base" : "free");
      total += spin.winHundredths;
      assert.equal(spin.totalHundredthsAfter, Math.min(total, 500_000));
    });
    assert.equal(round.totalHundredths, round.spins.at(-1)!.totalHundredthsAfter);
    assert.equal(round.capped, false);
  }
});

test("the 5000x cap clamps the total, ends the round at once and zeroes the free spins left", () => {
  // Lower cap through the test hook: the production logic runs, only the threshold changes.
  const tuning = { capHundredths: 600 };
  let capped = 0, triggeredCapped = 0;
  for (const seed of seeds(20_000)) {
    const round = __cascadeTest.play(seed, 100, tuning);
    const uncapped = __cascadeTest.play(seed, 100, { capHundredths: 10 ** 12 });
    if (round.capped) {
      capped++;
      assert.equal(round.totalHundredths, 600);
      const last = round.spins.at(-1)!;
      assert.equal(last.totalHundredthsAfter, 600);
      assert.equal(last.freeSpinsLeft, 0);
      assert.ok(round.spins.length <= uncapped.spins.length);
      assert.ok(round.spins.slice(0, -1).every(s => s.totalHundredthsAfter < 600), "no earlier spin reached the cap");
      assert.ok(uncapped.totalHundredths >= 600);
      if (round.freeSpinsTriggered) triggeredCapped++;
      // The spin itself reports its raw win; only the cumulative total is clamped.
      assert.ok(last.winHundredths + (round.spins.at(-2)?.totalHundredthsAfter ?? 0) >= 600);
    } else {
      assert.ok(round.totalHundredths < 600);
      assert.equal(JSON.stringify(round.spins), JSON.stringify(uncapped.spins));
    }
  }
  assert.ok(capped > 50 && triggeredCapped >= 0);
  // Production cap: absurd paytable, one spin hits 5000x exactly, payout is stake * 5000.
  const rich = Object.fromEntries(PAY.map(s => [s, [10 ** 7, 10 ** 7, 10 ** 7]])) as never;
  let hit: CascadeRound | undefined;
  for (const seed of seeds(200)) { const r = __cascadeTest.play(seed, 50_000, { paytable: rich }); if (r.capped) { hit = r; break; } }
  assert.ok(hit, "a capped round exists");
  assert.equal(hit!.totalHundredths, 500_000);
  assert.equal(hit!.payoutCents, 50_000 * 5000);
  assert.equal(hit!.spins.at(-1)!.freeSpinsLeft, 0);
  assert.ok(hit!.spins.at(-1)!.winHundredths >= 500_000);
  // Exactly reaching the cap counts as capped.
  const exact = __cascadeTest.play(SEED, 100, { capHundredths: playCascadeRound(SEED, 100).spins[0]!.winHundredths || 1 });
  if (playCascadeRound(SEED, 100).spins[0]!.winHundredths > 0) assert.equal(exact.capped, true);
});

test("payout is floor(stakeCents * hundredths / 100) with exact integer arithmetic", () => {
  const stakes = [100, 101, 137, 999, 12_345, 33_333, 49_999, 50_000];
  let nonDivisible = 0;
  for (const [i, seed] of seeds(3000).entries()) {
    const stake = stakes[i % stakes.length]!;
    const round = playCascadeRound(seed, stake);
    const expected = Number((BigInt(stake) * BigInt(round.totalHundredths)) / 100n);
    assert.equal(round.payoutCents, expected);
    assert.ok(Number.isSafeInteger(round.payoutCents));
    assert.ok(round.payoutCents <= stake * CASCADE_MAX_WIN_MULTIPLIER);
    if ((stake * round.totalHundredths) % 100 !== 0) nonDivisible++;
  }
  assert.ok(nonDivisible > 50, "rounding down is exercised");
  const big = __cascadeTest.play(SEED, 50_000, { paytable: Object.fromEntries(PAY.map(s => [s, [10 ** 8, 10 ** 8, 10 ** 8]])) as never });
  assert.ok(big.payoutCents <= 250_000_000);
});

test("safety bounds: tumbles per spin and free spins per round are capped", () => {
  // Only cherries: every refill wins again, so the loop must be stopped by the bound.
  const only = [["cherry", 1]] as const;
  const round = __cascadeTest.play(SEED, 100, { base: only as never, maxTumbles: 7 });
  const steps = round.spins[0]!.steps;
  assert.equal(steps.length, 8);
  assert.equal(steps.at(-1)!.wins.length, 0);
  assert.equal(steps.slice(0, -1).every(s => s.wins.length === 1), true);
  const production = __cascadeTest.play(SEED, 100, { base: only as never });
  assert.equal(production.spins[0]!.steps.length, 101);
  // maxFreeSpins is the total granted, retriggers included.
  const heavyStars = __cascadeTest.play(SEED, 100, { base: weights(CASCADE_BASE_WEIGHTS, { star: 500 }), free: weights(CASCADE_FREE_WEIGHTS, { star: 500 }), maxFreeSpins: 12 });
  assert.equal(heavyStars.spins.length - 1, 12);
});

test("simulation smoke: hit frequency, trigger frequency and RTP stay in the designed range", () => {
  const n = 40_000;
  let hits = 0, triggers = 0, total = 0;
  for (const seed of seeds(n, "00112233445566778899aabbccddeeff")) {
    const round = playCascadeRound(seed, 100);
    if (round.spins[0]!.winHundredths > 0) hits++;
    if (round.freeSpinsTriggered) triggers++;
    total += round.totalHundredths;
  }
  assert.ok(hits / n > 0.2 && hits / n < 0.4, `hit frequency ${hits / n}`);
  assert.ok(triggers / n > 1 / 900 && triggers / n < 1 / 250, `trigger frequency ${triggers / n}`);
  const rtp = total / n / 100;
  assert.ok(rtp > 0.5 && rtp < 1.6, `loose RTP sanity ${rtp} (precise figure lives in ops/evidence)`);
});
