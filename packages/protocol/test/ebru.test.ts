import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EBRU_BET_LEVELS_CENTS, EBRU_BUY_MIN_SCATTERS, EBRU_CLUSTER_TIER_STARTS, EBRU_COLOURS, EBRU_COMB_AMPLITUDE_WEIGHTS, EBRU_COMB_STEP_WEIGHTS, EBRU_COST_FRACTION,
  EBRU_ENGINE_ID, EBRU_FREE_SPINS_RETRIGGER, EBRU_FREE_SPINS_TRIGGER, EBRU_MAX_COMB_PASSES, EBRU_MAX_WIN_MULTIPLIER, EBRU_MODES, EBRU_MODE_TABLES, EBRU_PAYTABLE,
  EBRU_RTP, EBRU_SCATTER_PAY, EBRU_SIN_TABLE, EBRU_STAIN_MAX, __ebruTest, ebruCostCents, ebruSeedFromEntropy, playEbruRound,
  type EbruCell, type EbruColour, type EbruCombStep, type EbruGrid, type EbruMode, type EbruRound, type EbruSpin, type EbruStains, type EbruStep,
  type EbruSymbol,
} from "../src/ebru.ts";
import * as protocol from "../src/index.ts";

const SEED = "0123456789abcdef0123456789abcdef";
const MODES = EBRU_MODES;
const R = 7;
function seeds(count: number, label = "f00dcafe00112233445566778899aabb"): string[] {
  const rng = __ebruTest.createRng(label);
  return Array.from({ length: count }, () => ebruSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
const cellsOf = (grid: EbruGrid): EbruCell[] => grid.flat();
const combsIn = (grid: EbruGrid): number => cellsOf(grid).filter(cell => cell.symbol === "comb").length;
const idsOf = (grid: EbruGrid): number[] => cellsOf(grid).map(cell => cell.id);
/** Rows listed top to bottom, 7 characters each: 1..8 = c1..c8, d = drop, k = comb. Returns grid[col][row] with ids col * 7 + row. */
function gridOf(rows: readonly string[]): EbruGrid {
  assert.equal(rows.length, 7);
  return Array.from({ length: 7 }, (_, c) => Array.from({ length: 7 }, (_, r): EbruCell => {
    const ch = rows[r]![c]!;
    const symbol: EbruSymbol = ch === "d" ? "drop" : ch === "k" ? "comb" : (`c${ch}` as EbruColour);
    return { id: c * 7 + r, symbol };
  }));
}
const symbolsOf = (grid: EbruGrid): string => Array.from({ length: 7 }, (_, r) => grid.map(column => { const s = column[r]!.symbol; return s === "drop" ? "d" : s === "comb" ? "k" : s[1]!; }).join("")).join("/");
/** Grid after a step, when the step carries one. */
const gridAfter = (step: EbruStep): EbruGrid | undefined => (step.type === "drop-in" || step.type === "bleed" || step.type === "fall" || step.type === "comb" ? step.grid : undefined);
const mkStains = (): EbruStains => Array.from({ length: 7 }, () => new Array<number>(7).fill(0));
/** Independent comb: sin by Math.sin (the table is round(1000 sin)), halves away from zero. */
function referenceShifts(amplitude: number, phase: number, rowStep: number): number[] {
  return Array.from({ length: 7 }, (_, r) => {
    const sine = Math.round(1000 * Math.sin(2 * Math.PI * ((phase + r * rowStep) % 64) / 64));
    const x = Math.abs(amplitude * sine) / 1000;
    const n = Math.floor(x + 0.5 + 1e-9);
    return sine < 0 ? -n : n;
  });
}
const pos = (col: number, row: number): number => col * 7 + row;
const PAY1 = Object.fromEntries(EBRU_COLOURS.map(c => [c, new Array(12).fill(1)])) as never;
const ZERO = Object.fromEntries(EBRU_COLOURS.map(c => [c, new Array(12).fill(0)])) as never;
const RICH = Object.fromEntries(EBRU_COLOURS.map(c => [c, new Array(12).fill(10 ** 7)])) as never;
const only = (symbol: EbruSymbol, extra: readonly (readonly [EbruSymbol, number])[] = []): readonly (readonly [EbruSymbol, number])[] => [[symbol, 1000], ...extra];

/** Walks the steps of a round with an independent state machine and checks the structural contract. Returns counters. */
function audit(round: EbruRound): { combSteps: number; bleeds: number; freeStainedClusters: number; combWins: number } {
  let combSteps = 0, bleeds = 0, freeStainedClusters = 0, combWins = 0;
  let nextId = 0, stains: EbruStains | null = null, grandTotal = 0;
  round.spins.forEach((spin, s) => {
    assert.equal(spin.index, s);
    assert.equal(spin.kind, s === 0 ? "base" : "free");
    assert.ok(spin.steps.length >= 1 && spin.steps[0]!.type === "drop-in");
    let grid: EbruGrid | undefined, tumbleSum = 0, falls = 0, passes = 0, passWins = 0, clusters = 0, stainedClusters = 0;
    let lastClusters: Extract<EbruStep, { type: "clusters" }> | undefined, lastBurst: Extract<EbruStep, { type: "burst" }> | undefined;
    for (const step of spin.steps) {
      const g = gridAfter(step);
      if (g) {
        assert.equal(g.length, 7);
        for (const column of g) assert.equal(column.length, 7);
        assert.equal(new Set(idsOf(g)).size, 49, "ids are unique inside a grid");
      }
      switch (step.type) {
        case "drop-in":
          assert.equal(grid, undefined);
          assert.deepEqual(idsOf(step.grid), Array.from({ length: 49 }, (_, i) => nextId + i));
          nextId += 49;
          if (spin.kind === "base") assert.equal(step.stains, null);
          else {
            assert.ok(step.stains);
            assert.deepEqual(step.stains, stains ?? mkStains(), s === 1 ? "the first free spin starts with an empty field" : "the stain field persists from spin to spin");
            stains = step.stains!.map(c => c.slice());
          }
          grid = step.grid;
          break;
        case "bleed":
          bleeds++;
          assert.equal(grid![step.col]![step.row]!.symbol, "drop");
          assert.equal(grid![step.col]![step.row]!.id, step.id);
          assert.equal(step.grid[step.col]![step.row]!.symbol, step.colour);
          assert.equal(step.grid[step.col]![step.row]!.id, step.id, "ids are kept");
          for (const u of step.recoloured) {
            assert.equal(grid![u.col]![u.row]!.symbol, u.from); assert.equal(step.grid[u.col]![u.row]!.symbol, u.to); assert.equal(u.to, step.colour);
            assert.ok(Math.abs(u.col - step.col) + Math.abs(u.row - step.row) === 1);
          }
          assert.deepEqual(idsOf(step.grid), idsOf(grid!));
          grid = step.grid;
          break;
        case "clusters": {
          assert.ok(step.clusters.length > 0);
          assert.ok(cellsOf(grid!).every(cell => cell.symbol !== "drop"), "drops have bled before any cluster is searched");
          let sum = 0;
          for (const cluster of step.clusters) {
            assert.ok(cluster.size >= 5 && cluster.size === cluster.cells.length);
            for (const u of cluster.cells) { assert.equal(grid![u.col]![u.row]!.symbol, cluster.colour); assert.equal(grid![u.col]![u.row]!.id, u.id); }
            assert.equal(cluster.tier, __ebruTest.tierOf(cluster.size));
            assert.equal(cluster.payHundredths, EBRU_PAYTABLE[cluster.colour][cluster.tier]);
            const under = stains ? cluster.cells.reduce((a, u) => a + stains![u.col]![u.row]!, 0) : 0;
            assert.equal(cluster.stainSum, under, "stain sum = sum of the stain values under the cluster");
            assert.equal(cluster.multiplier, under || 1);
            assert.equal(cluster.winHundredths, cluster.payHundredths * cluster.multiplier);
            sum += cluster.winHundredths; clusters++;
            if (under > 0) { stainedClusters++; assert.equal(spin.kind, "free"); }
          }
          assert.equal(step.stepHundredths, sum);
          tumbleSum += sum;
          lastClusters = step;
          break;
        }
        case "burst":
          assert.ok(lastClusters && lastClusters === spin.steps[spin.steps.indexOf(step) - 1], "burst follows its clusters");
          assert.equal(step.removed.length, lastClusters.clusters.reduce((a, c) => a + c.size, 0));
          lastBurst = step;
          break;
        case "stains": {
          assert.equal(spin.kind, "free");
          assert.ok(lastBurst && spin.steps[spin.steps.indexOf(step) - 1] === lastBurst);
          const removed = new Set(lastBurst.removed.map(u => pos(u.col, u.row)));
          assert.equal(step.changes.length, removed.size);
          for (const ch of step.changes) {
            assert.ok(removed.has(pos(ch.col, ch.row)));
            assert.equal(ch.from, stains![ch.col]![ch.row]!);
            assert.equal(ch.to, ch.from === 0 ? 2 : Math.min(256, ch.from * 2));
            stains![ch.col]![ch.row] = ch.to;
          }
          assert.deepEqual(step.stains, stains);
          break;
        }
        case "fall": {
          falls++;
          const prev = grid!, removed = new Set(lastBurst!.removed.map(u => u.id));
          if (spin.kind === "free") assert.equal(spin.steps[spin.steps.indexOf(step) - 1]!.type, "stains"); else assert.equal(spin.steps[spin.steps.indexOf(step) - 1], lastBurst);
          const freshIds: number[] = [];
          for (let c = 0; c < 7; c++) {
            const survivors = prev[c]!.filter(cell => !removed.has(cell.id));
            const missing = 7 - survivors.length;
            assert.deepEqual(step.grid[c]!.slice(missing).map(cell => cell.id), survivors.map(cell => cell.id), "survivors keep order and ids");
            for (let r = 0; r < missing; r++) freshIds.push(step.grid[c]![r]!.id);
          }
          assert.deepEqual(freshIds, Array.from({ length: freshIds.length }, (_, i) => nextId + i), "fresh ids count up in draw order (column 0..6, top to bottom)");
          assert.deepEqual(step.fresh.map(f => f.id), freshIds);
          for (const f of step.fresh) { assert.equal(step.grid[f.col]![f.row]!.id, f.id); assert.equal(step.grid[f.col]![f.row]!.symbol, f.symbol); }
          for (const m of step.moves) { assert.ok(m.toRow > m.fromRow); assert.equal(prev[m.col]![m.fromRow]!.id, m.id); assert.equal(step.grid[m.col]![m.toRow]!.id, m.id); }
          nextId += freshIds.length;
          grid = step.grid;
          break;
        }
        case "comb": {
          combSteps++; passes++;
          assert.equal(step.pass, passes);
          assert.ok([1, 2, 3].includes(step.amplitude) && step.phase >= 0 && step.phase < 64 && step.rowStep >= 1);
          assert.deepEqual(step.shifts, referenceShifts(step.amplitude, step.phase, step.rowStep));
          assert.deepEqual(step.shifts, __ebruTest.combShifts(step.amplitude, step.phase, step.rowStep));
          assert.ok(step.shifts.every(x => Math.abs(x) <= step.amplitude));
          for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) assert.equal(step.grid[(((c + step.shifts[r]!) % 7) + 7) % 7]![r]!.id, grid![c]![r]!.id, "row r moves cyclically by shifts[r]");
          for (let r = 0; r < 7; r++) assert.deepEqual([...grid!.map(col => col[r]!.id)].sort((a, b) => a - b), [...step.grid.map(col => col[r]!.id)].sort((a, b) => a - b), "every row is a permutation");
          if (spin.kind === "free") {
            assert.ok(step.stains);
            for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) assert.equal(step.stains![(((c + step.shifts[r]!) % 7) + 7) % 7]![r], stains![c]![r], "stains move exactly like the symbols");
            stains = step.stains!.map(col => col.slice());
          } else assert.equal(step.stains, null);
          const created = __ebruTest.findClusters(step.grid).length > 0;
          if (falls < 100) assert.equal(step.createsWin, created);
          const next = spin.steps[spin.steps.indexOf(step) + 1];
          assert.equal(next?.type === "clusters", step.createsWin, "a comb pass that creates a win is followed by its clusters");
          if (step.createsWin) passWins++;
          grid = step.grid;
          break;
        }
      }
    }
    // Spin summary.
    assert.equal(spin.tumbleHundredths, tumbleSum);
    assert.equal(spin.tumbles, falls);
    assert.equal(spin.combPasses, passes);
    assert.ok(passes <= EBRU_MAX_COMB_PASSES);
    assert.equal(spin.combWins, passWins);
    combWins += passWins;
    assert.equal(spin.clusterCount, clusters);
    assert.equal(spin.stainedClusterCount, stainedClusters);
    freeStainedClusters += stainedClusters;
    assert.equal(spin.scatterCount, combsIn(grid!));
    assert.equal(spin.winHundredths, spin.tumbleHundredths + spin.scatterHundredths);
    if (spin.kind === "free") assert.equal(spin.scatterHundredths, 0);
    if (stains) {
      const flat = stains.flat();
      assert.equal(spin.stainedCells, flat.filter(v => v > 0).length);
      assert.equal(spin.maxStain, Math.max(...flat));
      assert.ok(flat.every(v => v === 0 || (v >= 2 && v <= EBRU_STAIN_MAX && Number.isInteger(Math.log2(v)))));
    } else assert.deepEqual([spin.maxStain, spin.stainedCells], [0, 0]);
    // The spin ended on a grid without a cluster (the comb cap or a dead pass or the tumble bound ended the chain) and without drops.
    assert.ok(cellsOf(grid!).every(cell => cell.symbol !== "drop"));
    if (spin.tumbles < 100) assert.equal(__ebruTest.findClusters(grid!).length, 0, "the last grid has no cluster");
    if (spin.tumbles < 100 && passes < EBRU_MAX_COMB_PASSES) assert.equal(spin.steps.at(-1)!.type === "comb" || spin.steps.at(-1)!.type === "fall" || spin.steps.at(-1)!.type === "bleed" || spin.steps.at(-1)!.type === "drop-in", true);
    grandTotal = Math.min(grandTotal + spin.winHundredths, EBRU_MAX_WIN_MULTIPLIER * 100);
    assert.equal(spin.totalHundredthsAfter, grandTotal);
  });
  assert.equal(round.totalHundredths, grandTotal);
  return { combSteps, bleeds, freeStainedClusters, combWins };
}

test("engine id, exports and the protocol index re-export", () => {
  assert.equal(EBRU_ENGINE_ID, "ebru-ink-1");
  assert.equal(EBRU_MAX_WIN_MULTIPLIER, 10_000);
  assert.equal(EBRU_FREE_SPINS_TRIGGER, 8);
  assert.equal(EBRU_FREE_SPINS_RETRIGGER, 4);
  assert.equal(EBRU_BUY_MIN_SCATTERS, 3);
  assert.equal(EBRU_MAX_COMB_PASSES, 3);
  assert.equal(protocol.playEbruRound, playEbruRound);
  assert.equal(protocol.ebruCostCents, ebruCostCents);
  assert.equal(protocol.EBRU_RTP, EBRU_RTP);
  assert.equal(typeof protocol.playStormRound, "function", "the other engines are still exported");
  assert.deepEqual([...EBRU_MODES], ["standard", "ante", "buy"]);
  assert.deepEqual([...EBRU_BET_LEVELS_CENTS], [100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 40000, 50000]);
  assert.deepEqual(EBRU_SCATTER_PAY, { 3: 300, 4: 1000, 5: 10_000 });
  assert.deepEqual([...EBRU_CLUSTER_TIER_STARTS], [5, 6, 7, 8, 9, 10, 12, 14, 17, 21, 26, 33]);
  assert.ok(Object.isFrozen(EBRU_BET_LEVELS_CENTS) && Object.isFrozen(EBRU_MODE_TABLES.ante.base) && Object.isFrozen(EBRU_PAYTABLE.c1) && Object.isFrozen(EBRU_SIN_TABLE));
  assert.ok(Object.isFrozen(EBRU_COMB_AMPLITUDE_WEIGHTS) && Object.isFrozen(EBRU_COMB_STEP_WEIGHTS));
});

test("structure: self-contained pure module (no imports, clock, Math.random, Math.sin, network or I/O)", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/ebru.ts", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/^\s*import\s/m.test(source), "no import statements: the evidence covers these bytes only");
  for (const forbidden of ["Math.random", "Math.sin", "Math.cos", "Date.now", "new Date", "performance.now", "fetch(", "process.", "require("]) assert.ok(!source.includes(forbidden), forbidden);
});

test("same seed, bet and mode give a byte-identical round; seed and mode both change the result; the bet never changes the draws", () => {
  for (const mode of MODES) {
    const a = playEbruRound(SEED, 500, mode), b = playEbruRound(SEED, 500, mode);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.engine, EBRU_ENGINE_ID);
    assert.equal(a.seedHex, SEED);
    assert.equal(a.mode, mode);
    const distinct = new Set(seeds(40).map(s => JSON.stringify(gridOf7(playEbruRound(s, 500, mode).spins[0]!.steps[0]!))));
    assert.equal(distinct.size, 40);
    assert.deepEqual(playEbruRound(SEED, 100, mode).spins, playEbruRound(SEED, 50_000, mode).spins);
  }
  assert.notEqual(JSON.stringify(playEbruRound(SEED, 500, "ante").spins), JSON.stringify(playEbruRound(SEED, 500, "buy").spins));
});
function gridOf7(step: EbruStep): EbruGrid { assert.equal(step.type, "drop-in"); return (step as Extract<EbruStep, { type: "drop-in" }>).grid; }

test("RNG and rules are frozen: a fingerprint of 200 fixed seeds across all modes and bets", () => {
  const rng = __ebruTest.createRng(SEED), again = __ebruTest.createRng(SEED);
  const first = Array.from({ length: 6 }, () => rng());
  assert.deepEqual(first, Array.from({ length: 6 }, () => again()));
  assert.ok(first.every(x => Number.isInteger(x) && x >= 0 && x < 2 ** 32));
  const other = __ebruTest.createRng("ffffffffffffffffffffffffffffffff");
  assert.notDeepEqual(first, Array.from({ length: 6 }, () => other()));
  // Any change of RNG, draw order, tables or rules changes this hash (a new behavior needs a new engine id).
  const bets = [100, 200, 50_000, 4000], hash = createHash("sha256");
  for (let i = 0; i < 200; i++) {
    const seed = createHash("sha256").update(`ebru-ink-1-frozen:${i}`).digest("hex").slice(0, 32);
    hash.update(JSON.stringify(playEbruRound(seed, bets[i % 4]!, MODES[i % 3]!)));
  }
  assert.equal(hash.digest("hex"), "cc590cec4588acdfa959de878072b4e3104cdcbc034621c8eda5e66f07758ecb");
});

test("input validation throws RangeError for seed, bet level and mode", () => {
  for (const bad of ["", "0123456789ABCDEF0123456789ABCDEF", SEED.slice(1), SEED + "0", "g".repeat(32), 123 as unknown as string, undefined as unknown as string]) {
    assert.throws(() => playEbruRound(bad, 100, "standard"), RangeError, String(bad));
  }
  for (const bad of [0, 99, 101, 150, 450, 600, 9999, 50_001, 100.5, -100, Number.NaN, Number.POSITIVE_INFINITY, "100" as unknown as number, 100n as unknown as number, null as unknown as number, undefined as unknown as number]) {
    for (const mode of MODES) {
      assert.throws(() => playEbruRound(SEED, bad, mode), RangeError, String(bad));
      assert.throws(() => ebruCostCents(bad, mode), RangeError, String(bad));
    }
  }
  for (const bad of ["", "Standard", "free", "bonus", null, undefined, 1, {}, "constructor", "__proto__"] as unknown as EbruMode[]) {
    assert.throws(() => playEbruRound(SEED, 100, bad), RangeError, String(bad));
    assert.throws(() => ebruCostCents(100, bad), RangeError, String(bad));
  }
  assert.throws(() => ebruSeedFromEntropy(new Uint32Array(3)), RangeError);
  assert.equal(ebruSeedFromEntropy(new Uint32Array([1, 0xffffffff, 0, 0x12345678])), "00000001ffffffff0000000012345678");
  for (const bet of EBRU_BET_LEVELS_CENTS) for (const mode of MODES) assert.doesNotThrow(() => playEbruRound(SEED, bet, mode));
});

test("cost arithmetic: standard = bet, ante = bet * 5 / 4, buy = bet * 100, always an integer", () => {
  assert.deepEqual(EBRU_COST_FRACTION.ante, [5, 4]);
  for (const bet of EBRU_BET_LEVELS_CENTS) {
    assert.equal(bet % 4, 0, `${bet} divisible by 4`);
    assert.equal(ebruCostCents(bet, "standard"), bet);
    assert.equal(ebruCostCents(bet, "ante"), (bet / 4) * 5);
    assert.equal(ebruCostCents(bet, "buy"), bet * 100);
    for (const mode of MODES) {
      assert.ok(Number.isSafeInteger(ebruCostCents(bet, mode)));
      const round = playEbruRound(SEED, bet, mode);
      assert.equal(round.costCents, ebruCostCents(bet, mode));
      assert.equal(round.betCents, bet);
    }
  }
  assert.equal(ebruCostCents(100, "ante"), 125);
  assert.equal(ebruCostCents(50_000, "ante"), 62_500);
  assert.equal(ebruCostCents(50_000, "buy"), 5_000_000);
});

test("payout is floor(bet * hundredths / 100) in every mode and never exceeds 10000 x bet", () => {
  for (const [i, seed] of seeds(2400).entries()) {
    const bet = EBRU_BET_LEVELS_CENTS[i % EBRU_BET_LEVELS_CENTS.length]!, mode = MODES[i % 3]!;
    const round = playEbruRound(seed, bet, mode);
    assert.equal(round.payoutCents, Number(BigInt(bet) * BigInt(round.totalHundredths) / 100n));
    assert.ok(round.payoutCents <= bet * 10_000);
    assert.equal(round.totalHundredths, round.spins.at(-1)!.totalHundredthsAfter);
    assert.equal(round.payoutCents, (bet / 100) * round.totalHundredths);
  }
});

test("integer sine table: round(1000 sin) for 64 steps, odd-symmetric, exact quarter points", () => {
  assert.equal(EBRU_SIN_TABLE.length, 64);
  for (let i = 0; i < 64; i++) {
    assert.equal(EBRU_SIN_TABLE[i], Math.round(1000 * Math.sin(2 * Math.PI * i / 64)), `index ${i}`);
    assert.equal(EBRU_SIN_TABLE[i]! + EBRU_SIN_TABLE[(i + 32) % 64]!, 0);
    assert.equal(EBRU_SIN_TABLE[i], EBRU_SIN_TABLE[(32 - i + 64) % 64]!);
  }
  assert.deepEqual([EBRU_SIN_TABLE[0], EBRU_SIN_TABLE[16], EBRU_SIN_TABLE[32], EBRU_SIN_TABLE[48]], [0, 1000, 0, -1000]);
  assert.ok(EBRU_SIN_TABLE.every(Number.isInteger));
});

test("comb shifts: round-half-away integer rounding and known vectors", () => {
  // halves away from zero
  assert.equal(__ebruTest.roundSine(2, 250), 1);
  assert.equal(__ebruTest.roundSine(2, -250), -1);
  assert.equal(__ebruTest.roundSine(1, 499), 0);
  assert.equal(__ebruTest.roundSine(1, 500), 1);
  assert.equal(__ebruTest.roundSine(1, -500), -1);
  assert.equal(__ebruTest.roundSine(3, -167), -1);
  assert.equal(__ebruTest.roundSine(3, 1000), 3);
  assert.equal(__ebruTest.roundSine(3, 0), 0);
  // vectors worked out by hand from the table (A, phase p, row step q)
  assert.deepEqual(__ebruTest.combShifts(2, 0, 8), [0, 1, 2, 1, 0, -1, -2]);
  assert.deepEqual(__ebruTest.combShifts(3, 16, 1), [3, 3, 3, 3, 3, 3, 2]);
  assert.deepEqual(__ebruTest.combShifts(1, 40, 2), [-1, -1, -1, -1, -1, -1, -1]);
  assert.deepEqual(__ebruTest.combShifts(1, 0, 5), [0, 0, 1, 1, 1, 1, 0]);
  assert.deepEqual(__ebruTest.combShifts(3, 0, 1), [0, 0, 1, 1, 1, 1, 2]);
  assert.deepEqual(__ebruTest.combShifts(2, 62, 16), referenceShifts(2, 62, 16));
  // wrap-around of the angle index
  for (let p = 0; p < 64; p++) for (const q of [1, 5, 16]) for (const a of [1, 2, 3]) assert.deepEqual(__ebruTest.combShifts(a, p, q), referenceShifts(a, p, q));
  // the discrete tables
  assert.deepEqual(EBRU_COMB_AMPLITUDE_WEIGHTS.map(([a]) => a), [1, 2, 3]);
  assert.ok(EBRU_COMB_STEP_WEIGHTS.every(([q, w]) => Number.isInteger(q) && q >= 1 && q <= 16 && w > 0));
});

test("comb transform is an exact row permutation: known grid, inverse and cyclic wrap", () => {
  const grid = gridOf(["1234567", "2345671", "3456712", "4567123", "5671234", "6712345", "7123456"]);
  const shifts = [1, 0, -1, 2, 3, -3, 7];
  const out = __ebruTest.shiftGrid(grid, shifts);
  // new[(c + s) mod 7][r] = old[c][r]: row 0 "1234567" moved right by 1 -> "7123456"; row 2 "3456712" left by 1 -> "4567123"
  const rowText = (g: EbruGrid, r: number): string => g.map(col => col[r]!.symbol[1]).join("");
  assert.equal(rowText(out, 0), "7123456");
  assert.equal(rowText(out, 1), "2345671");
  assert.equal(rowText(out, 2), "4567123");
  assert.equal(rowText(out, 3), "2345671"); // +2
  assert.equal(rowText(out, 4), "2345671"); // +3
  assert.equal(rowText(out, 5), "2345671"); // -3
  assert.equal(rowText(out, 6), "7123456"); // +7 = a full turn
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) assert.equal(out[(((c + shifts[r]!) % 7) + 7) % 7]![r]!.id, grid[c]![r]!.id);
  // a shift of 7 (a full turn) and 0 change nothing
  assert.deepEqual(out.map(col => col[6]!.id), grid.map(col => col[6]!.id));
  // inverse
  assert.deepEqual(__ebruTest.shiftGrid(out, shifts.map(x => -x)), grid);
  // the same shift on a stain field
  const stains = mkStains(); stains[2]![3] = 8; stains[0]![0] = 2; stains[6]![5] = 256;
  const shifted = __ebruTest.shiftStains(stains, shifts);
  assert.equal(shifted[(2 + 2) % 7]![3], 8);
  assert.equal(shifted[1]![0], 2);
  assert.equal(shifted[(6 - 3 + 7) % 7]![5], 256);
  assert.equal(shifted.flat().reduce((a, v) => a + v, 0), 266);
  assert.deepEqual(__ebruTest.shiftStains(shifted, shifts.map(x => -x)), stains);
  // combs and drops are moved like any other symbol
  const special = gridOf(["k111111", "1d11111", "1111111", "1111111", "1111111", "1111111", "111111k"]);
  const moved = __ebruTest.shiftGrid(special, [2, -1, 0, 0, 0, 0, 1]);
  assert.equal(moved[2]![0]!.symbol, "comb");
  assert.equal(moved[0]![1]!.symbol, "drop");
  assert.equal(moved[0]![6]!.symbol, "comb");
  assert.equal(cellsOf(moved).filter(c => c.symbol === "comb").length, 2);
});

test("cluster detection: orthogonal only, 5+, no wrap, wilds and combs excluded, deterministic order", () => {
  /** Filler colours 3..7 with no two orthogonal neighbours equal; `put` overrides cells as "col,row" -> character. */
  const build = (put: Record<string, string>): EbruGrid => gridOf(Array.from({ length: 7 }, (_, r) => Array.from({ length: 7 }, (_, c) => put[`${c},${r}`] ?? String(((c + 2 * r) % 5) + 3)).join("")));
  const line = (cells: readonly [number, number][], ch: string): Record<string, string> => Object.fromEntries(cells.map(([c, r]) => [`${c},${r}`, ch]));
  const found = (grid: EbruGrid) => __ebruTest.findClusters(grid).map(c => ({ colour: c.colour, cells: c.cells }));
  assert.deepEqual(found(build({})), [], "the filler has no cluster");
  // 4 in a row: no cluster; 5 in a row: one
  assert.deepEqual(found(build(line([[0, 0], [1, 0], [2, 0], [3, 0]], "1"))), []);
  assert.deepEqual(found(build(line([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], "1"))), [{ colour: "c1", cells: [pos(0, 0), pos(1, 0), pos(2, 0), pos(3, 0), pos(4, 0)] }]);
  // diagonal neighbours are not connected: a diagonal of 7 and a staircase of cells touching only at corners never form a cluster
  assert.deepEqual(found(build(line([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]], "1"))), []);
  // an orthogonal zig-zag chain of 5 (down, right, down, right) is one cluster
  assert.deepEqual(found(build(line([[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]], "1"))), [{ colour: "c1", cells: [pos(0, 0), pos(0, 1), pos(1, 1), pos(1, 2), pos(2, 2)] }]);
  // the same 5 cells with one diagonal link instead of an orthogonal one are two groups
  assert.deepEqual(found(build(line([[0, 0], [0, 1], [1, 1], [2, 2], [2, 3]], "1"))), []);
  // no wrap-around: 3 cells at the left edge and 2 at the right edge of a row never join
  assert.deepEqual(found(build(line([[0, 0], [1, 0], [2, 0], [5, 0], [6, 0]], "1"))), []);
  assert.deepEqual(found(build(line([[0, 0], [0, 1], [0, 2], [0, 4], [0, 6]], "1"))), [], "no wrap top to bottom either");
  // two separate clusters; order is by the first column-major cell, cells sorted column-major
  const two = found(build({ ...line([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3]], "2"), ...line([[0, 0], [0, 1], [0, 2], [1, 2], [1, 1]], "1") }));
  assert.deepEqual(two.map(c => [c.colour, c.cells.length]), [["c1", 5], ["c2", 5]]);
  for (const cluster of two) assert.ok(cluster.cells.every((v, i, a) => i === 0 || a[i - 1]! < v));
  // two groups of the same colour that touch are one cluster; a drop or a comb in the middle splits them
  const six = line([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]], "1");
  assert.equal(found(build(six))[0]!.cells.length, 6);
  assert.deepEqual(found(build({ ...six, "2,0": "d" })), [], "3 + 3 around a wild: wilds never join (they bleed first)");
  assert.deepEqual(found(build({ ...six, "3,0": "k" })), [], "3 + 2 around a comb");
  assert.deepEqual(found(build({ ...six, "5,0": "d" })).map(c => c.cells.length), [5], "the wild at the end leaves a cluster of 5");
  // vertical run of 7
  assert.deepEqual(found(build(line(Array.from({ length: 7 }, (_, r) => [3, r] as [number, number]), "8")))[0]!.cells, Array.from({ length: 7 }, (_, r) => pos(3, r)));
  // the whole board
  assert.deepEqual(found(gridOf(Array(7).fill("1111111")))[0]!.cells, Array.from({ length: 49 }, (_, i) => i));
  // tiers
  const tiers = [[5, 0], [6, 1], [7, 2], [8, 3], [9, 4], [10, 5], [11, 5], [12, 6], [13, 6], [14, 7], [16, 7], [17, 8], [20, 8], [21, 9], [25, 9], [26, 10], [32, 10], [33, 11], [49, 11]];
  for (const [size, tier] of tiers) assert.equal(__ebruTest.tierOf(size!), tier, `size ${size}`);
});

test("paytable: tiers and colours are monotonic, integer hundredths, 12 tiers", () => {
  let previousFirst = Infinity;
  for (const colour of EBRU_COLOURS) {
    const pay = EBRU_PAYTABLE[colour];
    assert.equal(pay.length, EBRU_CLUSTER_TIER_STARTS.length);
    assert.ok(pay.every((v, i) => Number.isInteger(v) && v > 0 && (i === 0 || v > pay[i - 1]!)));
    assert.ok(pay[0]! <= previousFirst, `${colour} pays no more than the colour before`);
    previousFirst = pay[0]!;
  }
  assert.ok(EBRU_PAYTABLE.c1.at(-1)! <= EBRU_MAX_WIN_MULTIPLIER * 100);
});

test("bleed rule: majority colour, RNG tie-break, edges, no-colour fallback, comb and unbled drops untouched, ids kept", () => {
  // Majority: drop at (3,3); up c1, left c1, right c1, down c2 -> c1 wins, the c2 neighbour becomes c1, so do the drop and the others.
  const base = (patch: (rows: string[][]) => void): EbruGrid => { const rowsText = Array.from({ length: 7 }, () => "5656565".split("")); patch(rowsText); return gridOf(rowsText.map(r => r.join(""))); };
  const g1 = base(r => { r[3]![3] = "d"; r[2]![3] = "1"; r[3]![2] = "1"; r[3]![4] = "1"; r[4]![3] = "2"; });
  const o1 = __ebruTest.bleed(g1, SEED);
  assert.equal(o1.steps.length, 1);
  const s1 = o1.steps[0]!;
  assert.deepEqual([s1.source, s1.colour, s1.candidates, s1.id, s1.col, s1.row], ["majority", "c1", ["c1"], pos(3, 3), 3, 3]);
  assert.deepEqual(s1.recoloured.map(u => [u.col, u.row, u.from, u.to]), [[3, 4, "c2", "c1"]]);
  for (const [c, r] of [[3, 3], [3, 2], [2, 3], [4, 3], [3, 4]] as const) { assert.equal(o1.grid[c]![r]!.symbol, "c1"); assert.equal(o1.grid[c]![r]!.id, g1[c]![r]!.id); }
  assert.equal(symbolsOf(o1.grid).replace(/\//g, "").split("").filter(ch => ch === "1").length, 5);
  assert.notEqual(o1.grid, g1);
  assert.equal(g1[3]![3]!.symbol, "drop", "the input grid is not mutated");
  // Tie: four different colours -> candidates c1..c4 in order, the RNG picks index floor(u32 * 4 / 2^32).
  const g2 = base(r => { r[3]![3] = "d"; r[2]![3] = "4"; r[3]![2] = "3"; r[3]![4] = "2"; r[4]![3] = "1"; });
  const seen = new Set<string>();
  for (const seed of seeds(60)) {
    const o = __ebruTest.bleed(g2, seed), s = o.steps[0]!;
    assert.equal(s.source, "tie");
    assert.deepEqual(s.candidates, ["c1", "c2", "c3", "c4"]);
    const index = Math.floor(__ebruTest.createRng(seed)() * 4 / 4_294_967_296);
    assert.equal(s.colour, `c${index + 1}`);
    assert.equal(o.grid[3]![3]!.symbol, s.colour);
    for (const [c, r] of [[3, 2], [2, 3], [4, 3], [3, 4]] as const) assert.equal(o.grid[c]![r]!.symbol, s.colour);
    seen.add(s.colour);
  }
  assert.equal(seen.size, 4);
  // Tie of two (2-2): candidates two colours.
  const g3 = base(r => { r[3]![3] = "d"; r[2]![3] = "7"; r[3]![2] = "7"; r[3]![4] = "8"; r[4]![3] = "8"; });
  const s3 = __ebruTest.bleed(g3, SEED).steps[0]!;
  assert.deepEqual([s3.source, s3.candidates], ["tie", ["c7", "c8"]]);
  assert.equal(s3.colour, ["c7", "c8"][Math.floor(__ebruTest.createRng(SEED)() * 2 / 4_294_967_296)]);
  // Corner: two neighbours only, majority 1-1 is a tie, one neighbour left alone
  const g4 = base(r => { r[0]![0] = "d"; r[0]![1] = "3"; r[1]![0] = "3"; });
  const s4 = __ebruTest.bleed(g4, SEED).steps[0]!;
  assert.deepEqual([s4.source, s4.colour, s4.recoloured.length], ["majority", "c3", 0]);
  // Edge cell with a missing neighbour: three neighbours (c5 c5 c1) -> c5 majority
  const g5 = base(r => { r[3]![0] = "d"; r[3]![1] = "1"; r[2]![0] = "5"; r[4]![0] = "5"; }); // drop at col 0, row 3
  const s5 = __ebruTest.bleed(g5, SEED).steps[0]!;
  assert.deepEqual([s5.colour, s5.source, s5.recoloured.map(u => [u.col, u.row])], ["c5", "majority", [[1, 3]]]);
  // No coloured neighbour at all (combs and drops around): a random colour costs one draw floor(u32 * 8 / 2^32); the comb neighbours stay.
  const g6 = base(r => { r[3]![3] = "d"; r[2]![3] = "k"; r[3]![2] = "k"; r[3]![4] = "k"; r[4]![3] = "k"; });
  for (const seed of seeds(20)) {
    const o = __ebruTest.bleed(g6, seed), s = o.steps[0]!;
    assert.deepEqual([s.source, s.candidates, s.recoloured.length], ["random", [], 0]);
    assert.equal(s.colour, `c${Math.floor(__ebruTest.createRng(seed)() * 8 / 4_294_967_296) + 1}`);
    assert.equal(combsIn(o.grid), 4, "combs are never recoloured");
  }
  // A not-yet-bled drop neighbour does not count and is left alone; it bleeds on its own turn (column-major: (3,3) before (3,4)).
  const g7 = base(r => { r[3]![3] = "d"; r[4]![3] = "d"; r[2]![3] = "1"; r[3]![2] = "1"; r[3]![4] = "2"; r[4]![2] = "2"; r[4]![4] = "1"; r[5]![3] = "3"; });
  const o7 = __ebruTest.bleed(g7, SEED);
  assert.equal(o7.steps.length, 2);
  assert.deepEqual(o7.steps.map(s => [s.col, s.row]), [[3, 3], [3, 4]]);
  assert.equal(o7.steps[0]!.colour, "c1");
  assert.deepEqual(o7.steps[0]!.recoloured.map(u => [u.col, u.row]), [[4, 3]]);
  assert.equal(o7.steps[0]!.recoloured.some(u => u.col === 3 && u.row === 4), false, "the unbled drop below was not recoloured by the first drop");
  // second drop: up = first drop (now c1), right c1, left c2, down c3 -> c1 only wins because the first drop's new colour counts
  assert.deepEqual([o7.steps[1]!.source, o7.steps[1]!.colour], ["majority", "c1"]);
  assert.ok(cellsOf(o7.grid).every(c => c.symbol !== "drop"));
  // Bleed steps snapshot the grid after each drop
  assert.equal(o7.steps[0]!.grid[3]![4]!.symbol, "drop");
  assert.equal(o7.steps[1]!.grid[3]![4]!.symbol, "c1");
  // A bleed at an interior cell with four coloured neighbours always leaves a plus-shaped cluster of at least 5.
  for (const seed of seeds(40)) {
    const rng = __ebruTest.createRng(seed);
    const grid = gridOf(Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => "12345678"[Math.floor(rng() * 8 / 4_294_967_296)]!).join("")));
    grid[3]![3] = { id: grid[3]![3]!.id, symbol: "drop" };
    const o = __ebruTest.bleed(grid, seed);
    assert.ok(__ebruTest.findClusters(o.grid).some(c => c.cells.includes(pos(3, 3)) && c.cells.length >= 5));
  }
});

test("no drop survives a bleed pass and bleeds only happen when a drop landed (real rounds)", () => {
  let bleeds = 0, drops = 0;
  for (const seed of seeds(300, "d00d00d00d00d00dd00d00d00d00d00d")) {
    const round = playEbruRound(seed, 100, "standard");
    bleeds += audit(round).bleeds;
    for (const spin of round.spins) for (const step of spin.steps) {
      if (step.type === "drop-in") drops += cellsOf(step.grid).filter(c => c.symbol === "drop").length;
      if (step.type === "clusters") for (const cl of step.clusters) assert.ok(cl.colour in EBRU_PAYTABLE);
    }
  }
  assert.ok(bleeds > 0 && drops > 0, `bleeds ${bleeds}`);
  // A drop-heavy table: every spin bleeds; audit() checks that no drop is left on a grid that is searched or kept.
  const heavy = __ebruTest.play(SEED, 100, "standard", { tables: { standard: { base: [["c1", 3], ["c2", 3], ["c3", 3], ["c4", 3], ["drop", 4]] as never } } });
  assert.ok(audit(heavy).bleeds >= 5);
});

test("structure invariants hold for every step of thousands of real rounds in every mode", () => {
  let combSteps = 0, combWins = 0, stainedFree = 0, spinsTotal = 0, freeSpins = 0;
  for (const mode of MODES) for (const seed of seeds(mode === "buy" ? 250 : 1200, `abcdef0123456789abcdef012345678${MODES.indexOf(mode)}`)) {
    const round = playEbruRound(seed, 100, mode);
    const a = audit(round);
    combSteps += a.combSteps; combWins += a.combWins; stainedFree += a.freeStainedClusters; spinsTotal += round.spins.length; freeSpins += round.spins.length - 1;
    assert.equal(round.freeSpinsTriggered, round.spins[0]!.freeSpinsAwarded > 0);
  }
  assert.ok(combSteps > 500 && combWins > 100 && stainedFree > 100 && freeSpins > 1000, `combs ${combSteps}, comb wins ${combWins}, stained ${stainedFree}, free ${freeSpins}, spins ${spinsTotal}`);
});

test("the comb sweeps once after every chain end, even for a spin that never won; a dead pass ends the spin", () => {
  let deadWithComb = 0, deadOnlyOneComb = 0, winningChainThenComb = 0;
  for (const seed of seeds(600, "c0ffee00c0ffee00c0ffee00c0ffee00")) {
    const spin = playEbruRound(seed, 100, "standard").spins[0]!;
    const types = spin.steps.map(s => s.type);
    const firstNonSetup = types.find(t => t !== "drop-in" && t !== "bleed");
    if (firstNonSetup === "comb") {
      deadWithComb++;
      const combs = spin.steps.filter((s): s is EbruCombStep => s.type === "comb");
      if (!combs[0]!.createsWin) { deadOnlyOneComb++; assert.equal(combs.length, 1); assert.equal(spin.steps.at(-1)!.type, "comb"); assert.equal(spin.winHundredths, spin.scatterHundredths); }
    }
    for (let i = 1; i < spin.steps.length; i++) if (spin.steps[i]!.type === "comb" && (spin.steps[i - 1]!.type === "fall" || spin.steps[i - 1]!.type === "bleed") && spin.tumbles > 0) winningChainThenComb++;
  }
  assert.ok(deadWithComb > 100 && deadOnlyOneComb > 50 && winningChainThenComb > 20, `${deadWithComb} ${deadOnlyOneComb} ${winningChainThenComb}`);
  // maxCombPasses bounds the passes; 0 turns the comb off completely.
  for (const maxCombPasses of [0, 1, 2]) {
    for (const seed of seeds(80)) {
      const round = __ebruTest.play(seed, 100, "standard", { maxCombPasses });
      for (const spin of round.spins) { assert.ok(spin.combPasses <= maxCombPasses); assert.equal(spin.steps.filter(s => s.type === "comb").length, spin.combPasses); }
    }
  }
  // A grid of one colour forever (maxTumbles 4): after the 4th tumble no more clusters are searched, so exactly one dead comb pass follows.
  const jam = __ebruTest.play(SEED, 100, "standard", { tables: { standard: { base: only("c1") } }, maxTumbles: 4, paytable: PAY1 });
  assert.equal(jam.spins[0]!.tumbles, 4);
  assert.deepEqual(jam.spins[0]!.steps.map(s => s.type), ["drop-in", ...Array(4).fill(["clusters", "burst", "fall"]).flat(), "comb"]);
  assert.equal(jam.spins[0]!.combPasses, 1);
});

test("comb-created wins: a pass that creates a cluster continues the chain, up to 3 passes, then stops", () => {
  let created = 0, third = 0;
  for (const seed of seeds(3000, "11112222333344445555666677778888")) {
    const spin = playEbruRound(seed, 100, "standard").spins[0]!;
    created += spin.combWins;
    if (spin.combPasses === 3) third++;
    assert.ok(spin.combWins <= spin.combPasses);
  }
  assert.ok(created > 200 && third > 0, `created ${created}, third passes ${third}`);
});

test("stains: base game has none; every free spin starts from the persisted field; the first free spin starts empty", () => {
  let checked = 0;
  for (const seed of seeds(150, "5151515151515151a1a1a1a1a1a1a1a1")) {
    const round = playEbruRound(seed, 100, "buy");
    const [base, first] = round.spins;
    assert.equal(base!.steps.every(s => s.type !== "stains"), true);
    assert.equal(base!.maxStain, 0);
    assert.equal(first!.steps[0]!.type, "drop-in");
    assert.deepEqual((first!.steps[0] as Extract<EbruStep, { type: "drop-in" }>).stains, mkStains());
    audit(round); // checks persistence spin to spin
    checked++;
  }
  assert.equal(checked, 150);
});

test("stain doubling: 2 -> 4 -> ... -> 256 and the cap holds (forced bursts of the whole board)", () => {
  const free = only("c1");
  const round = __ebruTest.play(SEED, 100, "buy", {
    tables: { buy: { base: [["c1", 1000], ["c2", 1]] as never, free: free as never } }, maxTumbles: 3, paytable: PAY1, capHundredths: 10 ** 15, buyMinScatters: 3,
  });
  assert.equal(round.spins.length, 9);
  let stain = 0, bursts = 0;
  const seenMax: number[] = [];
  for (const spin of round.spins.slice(1)) {
    assert.equal(spin.tumbles, 3);
    for (const step of spin.steps) {
      if (step.type === "clusters") {
        assert.equal(step.clusters.length, 1);
        assert.equal(step.clusters[0]!.size, 49);
        assert.equal(step.clusters[0]!.stainSum, 49 * stain, "sum of the 49 equal stains under the cluster");
        assert.equal(step.clusters[0]!.winHundredths, 49 * stain || 1);
      }
      if (step.type === "stains") {
        bursts++;
        const from = stain;
        stain = from === 0 ? 2 : Math.min(256, from * 2);
        assert.ok(step.stains.flat().every(v => v === stain), `all 49 cells at ${stain}`);
        assert.ok(step.changes.length === 49 && step.changes.every(c => c.from === from && c.to === stain));
      }
    }
    seenMax.push(spin.maxStain);
  }
  assert.equal(bursts, 24);
  assert.deepEqual(seenMax, [8, 64, 256, 256, 256, 256, 256, 256]);
  assert.equal(round.spins.at(-1)!.stainedCells, 49);
  // base spin: grid c1/c2 mix; free spins all c1 so the whole board bursts every time
  // Rule of the stain values themselves: only 0 or 2^n up to 256 anywhere.
  for (const spin of round.spins) assert.ok(spin.maxStain <= 256);
});

test("a cluster crossing stained cells is multiplied by the SUM of the stain values under it", () => {
  let checked = 0, multiSum = 0;
  for (const seed of seeds(120, "9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a")) {
    const round = playEbruRound(seed, 100, "buy");
    audit(round); // asserts stainSum / multiplier / win for every cluster
    for (const spin of round.spins.slice(1)) for (const step of spin.steps) if (step.type === "clusters") for (const cl of step.clusters) {
      checked++;
      if (cl.stainSum >= 4) multiSum++;
    }
  }
  assert.ok(checked > 500 && multiSum > 50, `${checked} ${multiSum}`);
  // Hand-made: one cluster over cells with stains 2, 4 and 8 pays pay * 14; unstained cells add nothing.
  const free = only("c1");
  const round = __ebruTest.play(SEED, 100, "buy", { tables: { buy: { base: [["c1", 1000], ["c2", 1]] as never, free: free as never } }, maxTumbles: 1, paytable: PAY1, capHundredths: 10 ** 15 });
  const second = round.spins[2]!.steps.find(s => s.type === "clusters") as Extract<EbruStep, { type: "clusters" }>;
  assert.equal(second.clusters[0]!.stainSum, 98);
  assert.equal(second.clusters[0]!.winHundredths, 98);
});

test("stains move with the comb exactly like the symbols (stain field after = symbol shift of the field before)", () => {
  let combsWithStains = 0;
  for (const seed of seeds(400, "7e7e7e7e7e7e7e7ef1f1f1f1f1f1f1f1")) {
    const round = playEbruRound(seed, 100, "buy");
    let stains: EbruStains | null = null;
    for (const spin of round.spins.slice(1)) for (const step of spin.steps) {
      if (step.type === "drop-in") stains = step.stains!.map(c => c.slice());
      else if (step.type === "stains") stains = step.stains.map(c => c.slice());
      else if (step.type === "comb") {
        assert.deepEqual(step.stains, __ebruTest.shiftStains(stains!, step.shifts));
        if (stains!.flat().some(v => v > 0) && step.shifts.some(v => v !== 0)) combsWithStains++;
        // the multiset of stain values is preserved by the comb
        assert.deepEqual([...step.stains!.flat()].sort((a, b) => a - b), [...stains!.flat()].sort((a, b) => a - b));
        stains = step.stains!.map(c => c.slice());
      }
    }
  }
  assert.ok(combsWithStains > 100, `${combsWithStains}`);
});

test("scatter pays 3 / 4 / 5+ combs in the base game only; 8 free spins on trigger, +4 on a free-spin retrigger", () => {
  const counts = new Map<number, number>();
  const table = [["c1", 100], ["c2", 100], ["c3", 100], ["c4", 100], ["c5", 100], ["c6", 100], ["c7", 100], ["c8", 100], ["comb", 22]] as never;
  let retriggers = 0;
  for (const seed of seeds(3000, "5ca77e5ca77e5ca77e5ca77e5ca77e5c")) {
    const round = __ebruTest.play(seed, 100, "standard", { tables: { standard: { base: table, free: table } } });
    const base = round.spins[0]!;
    const n = base.scatterCount;
    counts.set(n, (counts.get(n) ?? 0) + 1);
    assert.equal(base.scatterHundredths, n >= 5 ? 10_000 : n === 4 ? 1000 : n === 3 ? 300 : 0);
    assert.equal(base.freeSpinsAwarded, n >= 3 ? 8 : 0);
    assert.equal(round.freeSpinsTriggered, n >= 3);
    assert.equal(round.spins.length, n >= 3 ? 1 + 8 + 4 * round.spins.slice(1).filter(s => s.freeSpinsAwarded > 0).length : 1);
    for (const spin of round.spins.slice(1)) {
      assert.equal(spin.scatterHundredths, 0, "no scatter pay in free spins");
      assert.equal(spin.freeSpinsAwarded, spin.scatterCount >= 3 ? 4 : 0);
      if (spin.freeSpinsAwarded > 0) retriggers++;
    }
    const left = round.spins.map(s => s.freeSpinsLeft);
    for (let i = 1; i < left.length; i++) assert.equal(left[i], left[i - 1]! - 1 + round.spins[i]!.freeSpinsAwarded);
    assert.equal(left.at(-1), 0);
  }
  for (const n of [3, 4, 5]) assert.ok((counts.get(n) ?? 0) > 20, `${n} combs: ${counts.get(n)}`);
  assert.ok(retriggers > 20, `retriggers ${retriggers}`);
  // combs only ever leave via nothing: they never burst, so the final count equals the number on the board after every fall
  for (const seed of seeds(50)) {
    const spin = __ebruTest.play(seed, 100, "standard", { tables: { standard: { base: table } } }).spins[0]!;
    let previous = -1;
    for (const step of spin.steps) { const g = gridAfter(step); if (g) { const n = combsIn(g); if (step.type === "fall" || step.type === "bleed" || step.type === "comb") assert.ok(n >= previous); previous = n; } }
  }
});

test("free spins: total granted is bounded (every spin retriggers), the last spin leaves 0", () => {
  const heavy = [["c1", 100], ["comb", 30]] as never;
  const round = __ebruTest.play(SEED, 100, "buy", { tables: { buy: { free: heavy } }, maxFreeSpins: 40, paytable: ZERO });
  assert.equal(round.spins.length - 1, 40);
  assert.equal(round.spins.reduce((a, s) => a + s.freeSpinsAwarded, 0), 40);
  assert.equal(round.spins.at(-1)!.freeSpinsLeft, 0);
  assert.ok(round.spins.slice(1).every(s => s.scatterCount >= 3));
  const huge = __ebruTest.play(SEED, 100, "buy", { tables: { buy: { free: heavy } }, paytable: ZERO });
  assert.equal(huge.spins.length - 1, 200);
});

test("buy: the initial base grid always has 3+ combs, free spins always trigger, scatter still pays", () => {
  let forced = 0, natural = 0, maxScatters = 0;
  const pays = new Set<number>();
  for (const seed of seeds(3000, "b0b0b0b0c1c1c1c1d2d2d2d2e3e3e3e3")) {
    const round = playEbruRound(seed, 100, "buy");
    const [base, ...free] = round.spins;
    assert.ok(combsIn(gridOf7(base!.steps[0]!)) >= EBRU_BUY_MIN_SCATTERS);
    assert.equal(round.freeSpinsTriggered, true);
    assert.equal(base!.freeSpinsAwarded, 8);
    assert.ok(base!.scatterCount >= 3, "combs never burst and the comb only moves them, so the final grid keeps them");
    assert.ok(free.length >= 8);
    assert.equal(base!.scatterHundredths, EBRU_SCATTER_PAY[Math.min(base!.scatterCount, 5) as 3 | 4 | 5]);
    pays.add(base!.scatterHundredths);
    assert.ok(free.every(spin => spin.kind === "free"));
    // Same seed in standard: the buy grid differs only by cells turned into combs (the base table is shared).
    const std = gridOf7(playEbruRound(seed, 100, "standard").spins[0]!.steps[0]!);
    const buy = gridOf7(base!.steps[0]!);
    const stdScatters = combsIn(std);
    assert.equal(combsIn(buy), Math.max(3, stdScatters));
    const diff = cellsOf(buy).filter((cell, i) => cell.symbol !== cellsOf(std)[i]!.symbol);
    assert.equal(diff.length, Math.max(0, 3 - stdScatters));
    assert.ok(diff.every(cell => cell.symbol === "comb"));
    if (stdScatters >= 3) natural++; else forced++;
    maxScatters = Math.max(maxScatters, base!.scatterCount);
  }
  assert.ok(forced > 2900, `forced ${forced}, natural ${natural}`);
  assert.ok(maxScatters >= 4 && pays.has(300), `scatter counts and pays vary: max ${maxScatters}, pays ${[...pays]}`);
  for (const mode of ["standard", "ante"] as const) assert.ok(seeds(300).some(s => combsIn(gridOf7(playEbruRound(s, 100, mode).spins[0]!.steps[0]!)) < 3));
  for (const seed of seeds(30)) assert.ok(combsIn(gridOf7(__ebruTest.play(seed, 100, "buy", { buyMinScatters: 7 }).spins[0]!.steps[0]!)) >= 7);
});

test("ensureScatters follows the documented procedure: 3 - k draws, distinct non-comb cells, ids kept, column-major candidate list", () => {
  for (const seed of seeds(40, "9999888877776666555544443333222a")) {
    for (const k of [0, 1, 2, 3, 4, 9]) {
      const grid = gridOf(Array.from({ length: 7 }, (_, r) => Array.from({ length: 7 }, (_, c) => (c * 7 + r < k ? "k" : "12345678"[(c * 7 + r) % 8]!)).join("")));
      const before = grid.map(column => column.map(cell => ({ ...cell })));
      __ebruTest.ensureScatters(grid, 3, seed);
      assert.equal(combsIn(grid), Math.max(3, k));
      assert.deepEqual(idsOf(grid), before.flat().map(c => c.id), "ids unchanged");
      assert.equal(cellsOf(grid).filter((cell, i) => cell.symbol !== before.flat()[i]!.symbol).length, Math.max(0, 3 - k));
      // Independent re-implementation of the documented procedure.
      const rng = __ebruTest.createRng(seed), expected = before.map(column => column.map(cell => ({ ...cell })));
      let scatters = k;
      while (scatters < 3) {
        const spots: [number, number][] = [];
        for (let c = 0; c < 7; c++) for (let r = 0; r < 7; r++) if (expected[c]![r]!.symbol !== "comb") spots.push([c, r]);
        const [c, r] = spots[Math.floor(rng() * spots.length / 4_294_967_296)]!;
        expected[c]![r] = { id: expected[c]![r]!.id, symbol: "comb" };
        scatters++;
      }
      assert.deepEqual(grid, expected);
    }
  }
});

test("ante: feature rate is about 2x standard on the same seeds and never forced; a trigger is still 3+ combs on the final base grid", () => {
  const n = 150_000, ids = seeds(n, "a47ea47ea47ea47ea47ea47ea47ea47e");
  let standard = 0, ante = 0;
  for (const seed of ids) {
    if (__ebruTest.play(seed, 100, "standard", { maxFreeSpins: 0 }, false).spins[0]!.scatterCount >= 3) standard++;
    if (__ebruTest.play(seed, 100, "ante", { maxFreeSpins: 0 }, false).spins[0]!.scatterCount >= 3) ante++;
  }
  assert.ok(standard > 300, `standard triggers ${standard}`);
  assert.ok(ante > standard * 1.5 && ante < standard * 2.7, `ante ${ante} vs standard ${standard}`);
  for (const seed of ids.slice(0, 8000)) {
    const round = playEbruRound(seed, 100, "ante");
    assert.equal(round.freeSpinsTriggered, round.spins[0]!.scatterCount >= 3);
  }
});

test("mode tables: buy shares the standard base table, ante raises the base comb weight, free tables differ", () => {
  const weightOf = (list: readonly (readonly [string, number])[], symbol: string): number => list.find(([s]) => s === symbol)![1];
  const std = EBRU_MODE_TABLES.standard, ante = EBRU_MODE_TABLES.ante, buy = EBRU_MODE_TABLES.buy;
  assert.deepEqual(buy.base, std.base);
  assert.ok(weightOf(ante.base, "comb") > weightOf(std.base, "comb"));
  for (const mode of MODES) {
    for (const table of [EBRU_MODE_TABLES[mode].base, EBRU_MODE_TABLES[mode].free]) {
      assert.deepEqual(table.map(([s]) => s), [...EBRU_COLOURS, "drop", "comb"]);
      assert.ok(table.every(([, w]) => Number.isInteger(w) && w >= 0));
    }
  }
  assert.equal(weightOf(std.free, "c8"), 0, "c8 is drained in the free spins");
  assert.notDeepEqual(std.free, buy.free);
  assert.notDeepEqual(std.free, ante.free);
});

test("the 10000 x bet cap clamps the total in every mode, ends the round at once and zeroes the free spins left", () => {
  for (const mode of MODES) {
    let capped = 0;
    for (const seed of seeds(mode === "buy" ? 500 : 5000, `cafe0000cafe0000cafe0000cafe000${MODES.indexOf(mode)}`)) {
      const round = __ebruTest.play(seed, 100, mode, { capHundredths: 3000 });
      const uncapped = __ebruTest.play(seed, 100, mode, { capHundredths: 10 ** 12 });
      if (round.capped) {
        capped++;
        assert.equal(round.totalHundredths, 3000);
        assert.equal(round.spins.at(-1)!.freeSpinsLeft, 0);
        assert.ok(round.spins.slice(0, -1).every(s => s.totalHundredthsAfter < 3000));
        assert.ok(uncapped.totalHundredths >= 3000 && round.spins.length <= uncapped.spins.length);
      } else assert.equal(JSON.stringify(round.spins), JSON.stringify(uncapped.spins));
    }
    assert.ok(capped > 0, `${mode}: capped rounds ${capped}`);
  }
  for (const mode of MODES) {
    const hit = seeds(300).map(seed => __ebruTest.play(seed, 50_000, mode, { paytable: RICH })).find(r => r.capped);
    assert.ok(hit, `${mode}: a capped round exists`);
    assert.equal(hit!.totalHundredths, 1_000_000);
    assert.equal(hit!.payoutCents, 50_000 * 10_000);
    assert.equal(hit!.spins.at(-1)!.freeSpinsLeft, 0);
  }
  const buyRound = __ebruTest.play(SEED, 100, "buy", { paytable: RICH });
  assert.equal(buyRound.capped, true);
  assert.equal(buyRound.freeSpinsTriggered, true);
  assert.equal(buyRound.payoutCents, 1_000_000);
  // Stains alone reach the cap: tiny pays, whole-board bursts.
  const PAY10 = Object.fromEntries(EBRU_COLOURS.map(c => [c, new Array(12).fill(10)])) as never;
  const fat = __ebruTest.play(SEED, 100, "buy", { tables: { buy: { base: [["c1", 1000], ["c2", 1]] as never, free: only("c1") as never } }, maxTumbles: 3, paytable: PAY10 });
  assert.equal(fat.capped, true);
  assert.equal(fat.totalHundredths, 1_000_000);
  assert.equal(fat.spins.at(-1)!.freeSpinsLeft, 0);
  assert.ok(fat.spins.slice(0, -1).every(s => s.totalHundredthsAfter < 1_000_000));
});

test("safety bounds: tumbles per spin are capped", () => {
  const round = __ebruTest.play(SEED, 100, "standard", { tables: { standard: { base: only("c1") as never } }, maxTumbles: 7, paytable: PAY1 });
  assert.equal(round.spins[0]!.tumbles, 7);
  assert.equal(round.spins[0]!.steps.filter(s => s.type === "clusters").length, 7);
  assert.equal(round.spins[0]!.steps.at(-1)!.type, "comb");
  assert.throws(() => __ebruTest.play(SEED, 100, "standard", { tables: { standard: { base: [["c1", 0]] as never } } }), RangeError);
});

test("recording is presentation only: record = false gives the same totals, summaries and RNG use", () => {
  for (const mode of MODES) for (const seed of seeds(300, "12121212343434345656565678787878")) {
    const full = __ebruTest.play(seed, 500, mode), lean = __ebruTest.play(seed, 500, mode, {}, false);
    assert.equal(lean.totalHundredths, full.totalHundredths);
    assert.equal(lean.payoutCents, full.payoutCents);
    assert.equal(lean.capped, full.capped);
    assert.deepEqual(lean.spins.map(s => ({ ...s, steps: [] })), full.spins.map(s => ({ ...s, steps: [] })));
    assert.ok(lean.spins.every(s => s.steps.length === 0));
  }
});

test("EBRU_RTP equals the simulation evidence and the evidence matches the engine source", () => {
  const dir = fileURLToPath(new URL("../../../ops/evidence/ebru-20261012/", import.meta.url));
  const evidence = JSON.parse(readFileSync(`${dir}rtp.json`, "utf8")) as {
    engine: string; engineSourceSha256: string; tuningOverride: unknown; seed: string; modes: Record<EbruMode, {
      rounds: number; rtpVsCost: { pointEstimate: number; ci95: [number, number] }; hitRate: number; featureRate: number; stdDevPerRoundCostUnits: number; capHits: number;
      costMismatches: number; winTiersShareOfRounds: Record<string, number>;
    }>;
  };
  assert.equal(evidence.engine, EBRU_ENGINE_ID);
  assert.equal(evidence.tuningOverride, null, "evidence runs never use a tuning override");
  assert.ok(!evidence.seed.includes("tune"), "evidence seeds are distinct from tuning seeds");
  const source = readFileSync(fileURLToPath(new URL("../src/ebru.ts", import.meta.url)), "utf8").replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
  assert.equal(createHash("sha256").update(source).digest("hex"), evidence.engineSourceSha256, "engine code changed after the evidence run: rerun the simulation");
  const r3 = (x: number): number => Number(x.toFixed(3));
  for (const mode of MODES) {
    const e = evidence.modes[mode], c = EBRU_RTP[mode];
    assert.ok(e.rounds >= 20_000_000, `${mode}: ${e.rounds} rounds`);
    assert.equal(e.costMismatches, 0);
    assert.equal(c.rounds, e.rounds);
    assert.equal(c.rtp, r3(e.rtpVsCost.pointEstimate));
    assert.equal(c.ciLow, r3(e.rtpVsCost.ci95[0]));
    assert.equal(c.ciHigh, r3(e.rtpVsCost.ci95[1]));
    assert.equal(c.hitRate, r3(e.hitRate));
    assert.equal(c.featureRate, Number(e.featureRate.toFixed(4)));
    assert.equal(c.stdDev, r3(e.stdDevPerRoundCostUnits));
    assert.ok(c.rtp >= 0.94 && c.rtp <= 0.965, `${mode} rtp ${c.rtp} within 94-96.5%`);
    assert.ok(c.ciLow <= c.rtp && c.rtp <= c.ciHigh);
  }
  for (const mode of ["standard", "ante"] as const) assert.ok(EBRU_RTP[mode].hitRate >= 0.22 && EBRU_RTP[mode].hitRate <= 0.32, `${mode} hit rate`);
  assert.ok(1 / EBRU_RTP.standard.featureRate >= 250 && 1 / EBRU_RTP.standard.featureRate <= 450);
  assert.ok(EBRU_RTP.buy.featureRate === 1 && EBRU_RTP.ante.featureRate > EBRU_RTP.standard.featureRate * 1.6 && EBRU_RTP.ante.featureRate < EBRU_RTP.standard.featureRate * 2.6);
});
