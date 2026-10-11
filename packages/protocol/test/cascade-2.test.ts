import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CASCADE2_BET_LEVELS_CENTS, CASCADE2_BUY_MIN_STARS, CASCADE2_COST_FRACTION, CASCADE2_ENGINE_ID, CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_MODES,
  CASCADE2_MODE_TABLES, CASCADE2_PAYTABLE, CASCADE2_RTP, CASCADE2_SCATTER_PAY, __cascade2Test, cascadeCostCents, playCascade2Round,
  type Cascade2Round, type CascadeMode,
} from "../src/cascade-2.ts";
import { CASCADE_PAYTABLE, CASCADE_SCATTER_PAY, cascadeSeedFromEntropy, playCascadeRound, type CascadeCell, type CascadeGrid, type CascadePaySymbol, type CascadeSymbol } from "../src/cascade.ts";
import * as protocol from "../src/index.ts";

const PAY: CascadePaySymbol[] = ["crown", "cupcake", "donut", "gumdrop", "strawberry", "blueberry", "kiwi", "lemon", "cherry"];
const SEED = "0123456789abcdef0123456789abcdef";
const MODES = CASCADE2_MODES;
function seeds(count: number, label = "f00dcafe00112233445566778899aabb"): string[] {
  const rng = __cascade2Test.createRng(label);
  return Array.from({ length: count }, () => cascadeSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
const cellsOf = (grid: CascadeGrid): CascadeCell[] => grid.flat();
const starsIn = (grid: CascadeGrid): number => cellsOf(grid).filter(cell => cell.symbol === "star").length;
const allGrids = (round: Cascade2Round): CascadeGrid[] => round.spins.flatMap(s => s.steps.map(step => step.grid));
const makeGrid = (symbolAt: (col: number, row: number) => CascadeSymbol): CascadeGrid => {
  let id = 0;
  return Array.from({ length: 6 }, (_, c) => Array.from({ length: 5 }, (_, r): CascadeCell => ({ id: id++, symbol: symbolAt(c, r) })));
};
const zeroPay = Object.fromEntries(PAY.map(s => [s, [0, 0, 0]])) as never;

test("v1 engine is frozen: 200 fixed seeds hash to the value computed before v2 existed", () => {
  const stakes = [100, 250, 50_000, 777];
  const hash = createHash("sha256");
  for (let i = 0; i < 200; i++) {
    const seed = createHash("sha256").update(`candy-cascade-1-frozen:${i}`).digest("hex").slice(0, 32);
    hash.update(JSON.stringify(playCascadeRound(seed, stakes[i % 4]!)));
  }
  assert.equal(hash.digest("hex"), "fe852f5a351c7f0753982c8cf26e4c39d4f940908ec54e6c218965d04edaee35");
});

test("engine id, exports and the protocol index re-export", () => {
  assert.equal(CASCADE2_ENGINE_ID, "candy-cascade-2");
  assert.equal(CASCADE2_MAX_WIN_MULTIPLIER, 5000);
  assert.equal(protocol.playCascade2Round, playCascade2Round);
  assert.equal(protocol.cascadeCostCents, cascadeCostCents);
  assert.equal(protocol.CASCADE2_RTP, CASCADE2_RTP);
  assert.equal(protocol.playCascadeRound, playCascadeRound, "v1 is still exported");
  assert.deepEqual([...CASCADE2_MODES], ["standard", "ante", "buy"]);
  assert.deepEqual([...CASCADE2_BET_LEVELS_CENTS], [100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 40000, 50000]);
  assert.ok(Object.isFrozen(CASCADE2_BET_LEVELS_CENTS) && Object.isFrozen(CASCADE2_MODE_TABLES.ante.base));
});

test("same seed, bet and mode give a byte-identical round; seed and mode both change the result", () => {
  for (const mode of MODES) {
    const a = playCascade2Round(SEED, 500, mode), b = playCascade2Round(SEED, 500, mode);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.engine, CASCADE2_ENGINE_ID);
    assert.equal(a.seedHex, SEED);
    assert.equal(a.mode, mode);
    const distinct = new Set(seeds(40).map(s => JSON.stringify(playCascade2Round(s, 500, mode).spins[0]!.steps[0]!.grid)));
    assert.equal(distinct.size, 40);
    // The bet level never changes the dealt cards, only the payout and cost.
    assert.deepEqual(playCascade2Round(SEED, 100, mode).spins, playCascade2Round(SEED, 50_000, mode).spins);
  }
  assert.notEqual(JSON.stringify(playCascade2Round(SEED, 500, "ante").spins), JSON.stringify(playCascade2Round(SEED, 500, "buy").spins));
});

test("standard mode replays candy-cascade-1 exactly (same RNG, draw order, tables and rules)", () => {
  let triggered = 0;
  for (const [i, seed] of seeds(1500, "1111222233334444aaaabbbbccccdddd").entries()) {
    const bet = CASCADE2_BET_LEVELS_CENTS[i % CASCADE2_BET_LEVELS_CENTS.length]!;
    const v1 = playCascadeRound(seed, bet), v2 = playCascade2Round(seed, bet, "standard");
    assert.deepEqual(v2.spins, v1.spins);
    assert.equal(v2.totalHundredths, v1.totalHundredths);
    assert.equal(v2.payoutCents, v1.payoutCents);
    assert.equal(v2.capped, v1.capped);
    assert.equal(v2.freeSpinsTriggered, v1.freeSpinsTriggered);
    if (v1.freeSpinsTriggered) triggered++;
  }
  assert.ok(triggered > 0);
  assert.deepEqual(CASCADE2_PAYTABLE, CASCADE_PAYTABLE);
  assert.deepEqual(CASCADE2_SCATTER_PAY, CASCADE_SCATTER_PAY);
});

test("input validation throws RangeError for seed, bet level and mode", () => {
  for (const bad of ["", "0123456789ABCDEF0123456789ABCDEF", SEED.slice(1), SEED + "0", "g".repeat(32), 123 as unknown as string, undefined as unknown as string]) {
    assert.throws(() => playCascade2Round(bad, 100, "standard"), RangeError, String(bad));
  }
  for (const bad of [0, 99, 101, 150, 450, 600, 9999, 50_001, 100.5, -100, Number.NaN, Number.POSITIVE_INFINITY, "100" as unknown as number, 100n as unknown as number, null as unknown as number, undefined as unknown as number]) {
    for (const mode of MODES) {
      assert.throws(() => playCascade2Round(SEED, bad, mode), RangeError, String(bad));
      assert.throws(() => cascadeCostCents(bad, mode), RangeError, String(bad));
    }
  }
  for (const bad of ["", "Standard", "free", "bonus", null, undefined, 1, {}, "constructor", "__proto__"] as unknown as CascadeMode[]) {
    assert.throws(() => playCascade2Round(SEED, 100, bad), RangeError, String(bad));
    assert.throws(() => cascadeCostCents(100, bad), RangeError, String(bad));
  }
  for (const bet of CASCADE2_BET_LEVELS_CENTS) for (const mode of MODES) assert.doesNotThrow(() => playCascade2Round(SEED, bet, mode));
});

test("cost arithmetic: standard = bet, ante = bet * 5 / 4, buy = bet * 100, always an integer", () => {
  assert.deepEqual(CASCADE2_COST_FRACTION.ante, [5, 4]);
  for (const bet of CASCADE2_BET_LEVELS_CENTS) {
    assert.equal(bet % 4, 0, `${bet} divisible by 4`);
    assert.equal(cascadeCostCents(bet, "standard"), bet);
    assert.equal(cascadeCostCents(bet, "ante"), (bet / 4) * 5);
    assert.equal(cascadeCostCents(bet, "buy"), bet * 100);
    for (const mode of MODES) {
      assert.ok(Number.isSafeInteger(cascadeCostCents(bet, mode)));
      const round = playCascade2Round(SEED, bet, mode);
      assert.equal(round.costCents, cascadeCostCents(bet, mode));
      assert.equal(round.betCents, bet);
      assert.equal(round.stakeCents, bet, "stakeCents is kept equal to betCents for v1 consumers");
    }
  }
  assert.equal(cascadeCostCents(100, "ante"), 125);
  assert.equal(cascadeCostCents(50_000, "ante"), 62_500);
  assert.equal(cascadeCostCents(50_000, "buy"), 5_000_000);
});

test("payout is floor(bet * hundredths / 100) in every mode and never exceeds 5000 x bet", () => {
  for (const [i, seed] of seeds(2400).entries()) {
    const bet = CASCADE2_BET_LEVELS_CENTS[i % CASCADE2_BET_LEVELS_CENTS.length]!, mode = MODES[i % 3]!;
    const round = playCascade2Round(seed, bet, mode);
    assert.equal(round.payoutCents, Number(BigInt(bet) * BigInt(round.totalHundredths) / 100n));
    assert.ok(round.payoutCents <= bet * 5000);
    assert.equal(round.totalHundredths, round.spins.at(-1)!.totalHundredthsAfter);
    // Every bet level is a whole number of DEMO credits, so the floor never loses a cent here.
    assert.equal(round.payoutCents, (bet / 100) * round.totalHundredths);
  }
});

test("structure: 6x5 grids, unique ids, ids keep their symbol, spin and round bookkeeping, all modes", () => {
  for (const mode of MODES) {
    for (const seed of seeds(250, `00ff00ff00ff00ff00ff00ff00ff00f${MODES.indexOf(mode)}`)) {
      const round = playCascade2Round(seed, 100, mode);
      const seen = new Map<number, CascadeSymbol>();
      let total = 0, maxId = -1;
      round.spins.forEach((spin, i) => {
        assert.equal(spin.index, i);
        assert.equal(spin.kind, i === 0 ? "base" : "free");
        total += spin.winHundredths;
        assert.equal(spin.totalHundredthsAfter, Math.min(total, 500_000));
        assert.equal(spin.winHundredths, spin.tumbleHundredths * (spin.multiplierSum || 1) + spin.scatterHundredths);
        if (spin.kind === "base") assert.equal(spin.multiplierSum, 0);
        if (spin.kind === "free") assert.equal(spin.scatterHundredths, 0);
        const ids = spin.steps.flatMap(step => cellsOf(step.grid).map(cell => cell.id));
        assert.ok(Math.min(...ids) > maxId, "ids of a new spin start above everything dealt before");
        maxId = Math.max(...ids);
      });
      for (const grid of allGrids(round)) {
        assert.equal(grid.length, 6);
        for (const column of grid) assert.equal(column.length, 5);
        assert.equal(new Set(cellsOf(grid).map(cell => cell.id)).size, 30);
        for (const cell of cellsOf(grid)) {
          assert.equal(seen.get(cell.id) ?? cell.symbol, cell.symbol, "an id keeps its symbol for the whole round");
          seen.set(cell.id, cell.symbol);
        }
      }
      assert.equal(round.capped, false);
    }
  }
});

test("tumble contract holds in every mode (survivors keep ids and order, fresh ids consecutive, wins match the tables)", () => {
  let tumbled = 0;
  for (const mode of MODES) {
    for (const seed of seeds(1500, `abcdabcdabcdabcdabcdabcdabcdabc${MODES.indexOf(mode)}`)) {
      const round = playCascade2Round(seed, 100, mode);
      for (const spin of round.spins) {
        const { steps } = spin;
        assert.equal(steps.at(-1)!.wins.length, 0, "last step has no wins");
        let sum = 0;
        steps.forEach((step, k) => {
          assert.equal(step.stepHundredths, step.wins.reduce((a, w) => a + w.payHundredths, 0));
          sum += step.stepHundredths;
          for (const win of step.wins) {
            assert.ok(win.count >= 8 && win.cells.length === win.count);
            assert.ok(!["star", "crystal"].includes(win.symbol));
            const tier = win.count >= 12 ? 2 : win.count >= 10 ? 1 : 0;
            assert.equal(win.payHundredths, CASCADE2_PAYTABLE[win.symbol][tier]);
            assert.deepEqual(win.cells, cellsOf(step.grid).filter(cell => cell.symbol === win.symbol).map(cell => cell.id));
          }
          assert.deepEqual(step.wins, __cascade2Test.findWins(step.grid));
          const following = steps[k + 1];
          if (!following) return;
          tumbled++;
          const removed = new Set(step.wins.flatMap(w => w.cells));
          step.grid.forEach((column, c) => {
            const survivors = column.filter(cell => !removed.has(cell.id));
            assert.deepEqual(following.grid[c]!.slice(5 - survivors.length), survivors);
          });
          const before = new Set(cellsOf(step.grid).map(cell => cell.id));
          const fresh = following.grid.flatMap(column => column.filter(cell => !before.has(cell.id))).map(cell => cell.id);
          assert.equal(fresh.length, removed.size);
          assert.ok(fresh.every((id, i) => i === 0 || id === fresh[i - 1]! + 1));
        });
        assert.equal(spin.tumbleHundredths, sum);
      }
    }
  }
  assert.ok(tumbled > 1000, `tumbles exercised: ${tumbled}`);
});

test("crystals only appear in free spins and carry values from the mode's crystal table", () => {
  for (const mode of MODES) {
    const values = new Set(CASCADE2_MODE_TABLES[mode].crystals.map(([v]) => v));
    assert.ok(!CASCADE2_MODE_TABLES[mode].base.some(([s]) => s === "crystal"));
    let crystals = 0;
    for (const seed of seeds(1200, `5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5${MODES.indexOf(mode)}`)) {
      for (const spin of playCascade2Round(seed, 100, mode).spins) {
        const cells = spin.steps.flatMap(step => cellsOf(step.grid));
        if (spin.kind === "base") assert.ok(cells.every(cell => cell.symbol !== "crystal"));
        for (const cell of cells) {
          if (cell.symbol === "crystal") { crystals++; assert.ok(values.has(cell.multiplier!)); } else assert.equal(cell.multiplier, undefined);
        }
        const last = spin.steps.at(-1)!.grid;
        assert.equal(spin.multiplierSum, cellsOf(last).reduce((a, cell) => a + (cell.multiplier ?? 0), 0));
      }
    }
    assert.ok(crystals > 0, `${mode} produced crystals`);
  }
});

test("mode tables: positive integer weights, rare star, ante raises only the base star weight, buy keeps the base table", () => {
  const weightOf = (table: readonly (readonly [CascadeSymbol, number])[], s: CascadeSymbol) => table.find(([x]) => x === s)![1];
  for (const mode of MODES) {
    for (const table of [CASCADE2_MODE_TABLES[mode].base, CASCADE2_MODE_TABLES[mode].free] as const) {
      for (const [, w] of table) assert.ok(Number.isSafeInteger(w) && w > 0);
      const total = table.reduce((a, [, w]) => a + w, 0);
      assert.ok(weightOf(table, "star") / total < 0.04, `${mode} star share`);
    }
    for (const [, w] of CASCADE2_MODE_TABLES[mode].crystals) assert.ok(Number.isSafeInteger(w) && w > 0);
  }
  const { standard, ante, buy } = CASCADE2_MODE_TABLES;
  assert.ok(weightOf(ante.base, "star") > weightOf(standard.base, "star"));
  assert.deepEqual(ante.base.filter(([s]) => s !== "star"), standard.base.filter(([s]) => s !== "star"));
  assert.deepEqual(buy.base, standard.base);
  assert.deepEqual(standard.crystals.map(([v]) => v), [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100]);
});

test("ensureStars follows the documented procedure: 4 - k draws, distinct non-star cells, ids kept, column-major candidate list", () => {
  const rngOf = (seed: string) => __cascade2Test.createRng(seed);
  for (const seed of seeds(60, "9999888877776666555544443333222a")) {
    for (const k of [0, 1, 2, 3, 4, 5, 9]) {
      const grid = makeGrid((c, r) => (c * 5 + r < k ? "star" : PAY[(c * 5 + r) % 9]!));
      const before = grid.map(column => column.map(cell => ({ ...cell })));
      __cascade2Test.ensureStars(grid, 4, seed);
      assert.equal(starsIn(grid), Math.max(4, k));
      assert.deepEqual(grid.map(column => column.map(cell => cell.id)), before.map(column => column.map(cell => cell.id)), "ids unchanged");
      const changed = cellsOf(grid).filter((cell, i) => cell.symbol !== cellsOf(before)[i]!.symbol);
      assert.equal(changed.length, Math.max(0, 4 - k));
      assert.ok(changed.every(cell => cell.symbol === "star"));
      // Independent re-implementation of the documented procedure.
      const rng = rngOf(seed), expected = before.map(column => column.map(cell => ({ ...cell })));
      let stars = k;
      while (stars < 4) {
        const spots: [number, number][] = [];
        for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) if (expected[c]![r]!.symbol !== "star") spots.push([c, r]);
        const [c, r] = spots[Math.floor(rng() * spots.length / 4_294_967_296)]!;
        expected[c]![r]!.symbol = "star";
        stars++;
      }
      assert.deepEqual(grid, expected);
    }
  }
});

test("buy: base initial grid always has at least 4 stars, free spins always trigger, scatter still pays", () => {
  let forced = 0, natural = 0, maxStars = 0, retriggers = 0;
  const pays = new Set<number>();
  for (const seed of seeds(4000, "b0b0b0b0c1c1c1c1d2d2d2d2e3e3e3e3")) {
    const round = playCascade2Round(seed, 100, "buy");
    const [base, ...free] = round.spins;
    assert.ok(starsIn(base!.steps[0]!.grid) >= CASCADE2_BUY_MIN_STARS);
    assert.equal(round.freeSpinsTriggered, true);
    assert.equal(base!.freeSpinsAwarded, 10);
    assert.ok(base!.scatterCount >= 4, "stars never explode, so the final grid keeps them");
    assert.ok(free.length >= 10);
    assert.equal(base!.scatterHundredths, CASCADE2_SCATTER_PAY[Math.min(base!.scatterCount, 6) as 4 | 5 | 6]);
    assert.ok(base!.scatterHundredths >= 300);
    assert.ok(base!.winHundredths >= base!.scatterHundredths);
    pays.add(base!.scatterHundredths);
    assert.ok(free.every(spin => spin.kind === "free" && spin.scatterHundredths === 0));
    retriggers += free.filter(s => s.freeSpinsAwarded > 0).length;
    // Same seed in standard: the buy grid differs only by cells turned into stars (the base table is shared).
    const std = playCascade2Round(seed, 100, "standard").spins[0]!.steps[0]!.grid;
    const buy = base!.steps[0]!.grid;
    const stdStars = starsIn(std);
    assert.equal(starsIn(buy), Math.max(4, stdStars));
    const diff = cellsOf(buy).filter((cell, i) => cell.symbol !== cellsOf(std)[i]!.symbol);
    assert.equal(diff.length, Math.max(0, 4 - stdStars));
    assert.ok(diff.every(cell => cell.symbol === "star"));
    if (stdStars >= 4) natural++; else forced++;
    maxStars = Math.max(maxStars, base!.scatterCount);
  }
  assert.ok(forced > 3900, `forced ${forced}, natural ${natural}`);
  assert.ok(maxStars >= 5 && pays.has(300) && pays.has(500), `star counts and pays vary: max ${maxStars}, pays ${[...pays]}`);
  assert.ok(retriggers > 0);
  // Only buy forces stars; standard and ante do not.
  for (const mode of ["standard", "ante"] as const) {
    assert.ok(seeds(200).some(s => starsIn(playCascade2Round(s, 100, mode).spins[0]!.steps[0]!.grid) < 4));
  }
  // Raising the minimum through the hook is honoured (a 7-star guarantee).
  for (const seed of seeds(40)) assert.ok(starsIn(__cascade2Test.play(seed, 100, "buy", { buyMinStars: 7 }).spins[0]!.steps[0]!.grid) >= 7);
});

test("ante: free-spin trigger rate is clearly above standard on the same seeds, about 2x", () => {
  const n = 200_000, ids = seeds(n, "a47ea47ea47ea47ea47ea47ea47ea47e");
  let standard = 0, ante = 0;
  for (const seed of ids) {
    if (playCascade2Round(seed, 100, "standard").freeSpinsTriggered) standard++;
    if (playCascade2Round(seed, 100, "ante").freeSpinsTriggered) ante++;
  }
  assert.ok(standard > 200, `standard triggers ${standard}`);
  assert.ok(ante > standard * 1.6 && ante < standard * 2.7, `ante ${ante} vs standard ${standard}`);
  // Ante never forces a trigger, and a trigger is still 4+ stars on the final base grid.
  for (const seed of ids.slice(0, 20_000)) {
    const round = playCascade2Round(seed, 100, "ante");
    assert.equal(round.freeSpinsTriggered, round.spins[0]!.scatterCount >= 4);
  }
});

test("the 5000 x bet cap clamps the total in every mode, ends the round at once and zeroes the free spins left", () => {
  // Lower cap through the hook: the production logic runs, only the threshold changes.
  for (const mode of MODES) {
    let capped = 0;
    for (const seed of seeds(mode === "buy" ? 600 : 6000, `cafe0000cafe0000cafe0000cafe000${MODES.indexOf(mode)}`)) {
      const round = __cascade2Test.play(seed, 100, mode, { capHundredths: 5000 });
      const uncapped = __cascade2Test.play(seed, 100, mode, { capHundredths: 10 ** 12 });
      if (round.capped) {
        capped++;
        assert.equal(round.totalHundredths, 5000);
        assert.equal(round.spins.at(-1)!.freeSpinsLeft, 0);
        assert.ok(round.spins.slice(0, -1).every(s => s.totalHundredthsAfter < 5000));
        assert.ok(uncapped.totalHundredths >= 5000 && round.spins.length <= uncapped.spins.length);
      } else assert.equal(JSON.stringify(round.spins), JSON.stringify(uncapped.spins));
    }
    assert.ok(capped > 0, `${mode}: capped rounds ${capped}`);
  }
  // Production cap: absurd paytable, payout is bet * 5000 whatever the mode and cost.
  const rich = Object.fromEntries(PAY.map(s => [s, [10 ** 7, 10 ** 7, 10 ** 7]])) as never;
  for (const mode of MODES) {
    let hit: Cascade2Round | undefined;
    for (const seed of seeds(300)) { const r = __cascade2Test.play(seed, 50_000, mode, { paytable: rich }); if (r.capped) { hit = r; break; } }
    assert.ok(hit, `${mode}: a capped round exists`);
    assert.equal(hit!.totalHundredths, 500_000);
    assert.equal(hit!.payoutCents, 50_000 * 5000);
    assert.equal(hit!.spins.at(-1)!.freeSpinsLeft, 0);
  }
  // Buy: a capped round ends even though 10 free spins were guaranteed.
  const buyRound = __cascade2Test.play(SEED, 100, "buy", { paytable: rich });
  assert.equal(buyRound.capped, true);
  assert.equal(buyRound.freeSpinsTriggered, true);
  assert.equal(buyRound.payoutCents, 500_000);
});

test("safety bounds: tumbles per spin and total free spins are capped", () => {
  const only = [["cherry", 1]] as const;
  const round = __cascade2Test.play(SEED, 100, "standard", { tables: { standard: { base: only as never } }, maxTumbles: 7 });
  assert.equal(round.spins[0]!.steps.length, 8);
  const heavy = [["cherry", 100], ["star", 500]] as const;
  const stars = __cascade2Test.play(SEED, 100, "buy", { tables: { buy: { free: heavy as never } }, maxFreeSpins: 12, paytable: zeroPay });
  assert.equal(stars.spins.length - 1, 12);
  assert.equal(stars.spins.at(-1)!.freeSpinsLeft, 0);
});

test("CASCADE2_RTP equals the simulation evidence and the evidence matches the engine source", () => {
  const dir = fileURLToPath(new URL("../../../ops/evidence/candy-cascade-2-20261011/", import.meta.url));
  const evidence = JSON.parse(readFileSync(`${dir}rtp.json`, "utf8")) as {
    engine: string; engineSourceSha256: string; modes: Record<CascadeMode, {
      rounds: number; rtpVsCost: { pointEstimate: number; ci95: [number, number] }; hitRate: number; featureRate: number; stdDevPerRoundCostUnits: number; capHits: number;
    }>;
  };
  assert.equal(evidence.engine, CASCADE2_ENGINE_ID);
  // The RTP constants sit inside cascade-2.ts, so the hash covers the file without the marked evidence block.
  const source = readFileSync(fileURLToPath(new URL("../src/cascade-2.ts", import.meta.url)), "utf8")
    .replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
  assert.equal(createHash("sha256").update(source).digest("hex"), evidence.engineSourceSha256, "engine code changed after the evidence run: rerun the simulation");
  const r3 = (x: number): number => Number(x.toFixed(3));
  for (const mode of MODES) {
    const e = evidence.modes[mode], c = CASCADE2_RTP[mode];
    assert.ok(e.rounds >= 10_000_000, `${mode}: ${e.rounds} rounds`);
    assert.equal(c.rounds, e.rounds);
    assert.equal(c.rtp, r3(e.rtpVsCost.pointEstimate));
    assert.equal(c.ciLow, r3(e.rtpVsCost.ci95[0]));
    assert.equal(c.ciHigh, r3(e.rtpVsCost.ci95[1]));
    assert.equal(c.hitRate, r3(e.hitRate));
    assert.equal(c.featureRate, Number(e.featureRate.toFixed(4)));
    assert.equal(c.stdDev, r3(e.stdDevPerRoundCostUnits));
    assert.ok(c.rtp >= 0.95 && c.rtp <= 0.97, `${mode} rtp ${c.rtp} within 95-97%`);
    assert.ok(c.ciLow <= c.rtp && c.rtp <= c.ciHigh);
  }
  assert.ok(CASCADE2_RTP.buy.featureRate === 1 && CASCADE2_RTP.ante.featureRate > CASCADE2_RTP.standard.featureRate * 1.6);
});
