import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STORM_BET_LEVELS_CENTS, STORM_BUY_MIN_SCATTERS, STORM_COST_FRACTION, STORM_ENGINE_ID, STORM_FREE_SPINS_RETRIGGER, STORM_FREE_SPINS_TRIGGER,
  STORM_MAX_WIN_MULTIPLIER, STORM_MODES, STORM_MODE_TABLES, STORM_ORB_WEIGHTS, STORM_PAYTABLE, STORM_RTP, STORM_SCATTER_PAY, __stormTest,
  playStormRound, stormCostCents, stormSeedFromEntropy,
  type StormCell, type StormGrid, type StormMode, type StormPaySymbol, type StormRound, type StormSpin, type StormSymbol,
} from "../src/storm-throne.ts";
import * as protocol from "../src/index.ts";

const PAY: StormPaySymbol[] = ["h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4", "l5"];
const SEED = "0123456789abcdef0123456789abcdef";
const MODES = STORM_MODES;
const ORB_VALUES = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100, 250, 500];
function seeds(count: number, label = "f00dcafe00112233445566778899aabb"): string[] {
  const rng = __stormTest.createRng(label);
  return Array.from({ length: count }, () => stormSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
const cellsOf = (grid: StormGrid): StormCell[] => grid.flat();
const scattersIn = (grid: StormGrid): number => cellsOf(grid).filter(cell => cell.symbol === "scatter").length;
const allGrids = (round: StormRound): StormGrid[] => round.spins.flatMap(s => s.steps.map(step => step.grid));
const finalGrid = (spin: StormSpin): StormGrid => spin.steps.at(-1)!.grid;
const orbSumOf = (grid: StormGrid): number => cellsOf(grid).reduce((a, cell) => a + (cell.symbol === "orb" ? cell.multiplier! : 0), 0);
const makeGrid = (symbolAt: (col: number, row: number) => StormSymbol): StormGrid => {
  let id = 0;
  return Array.from({ length: 6 }, (_, c) => Array.from({ length: 5 }, (_, r): StormCell => {
    const symbol = symbolAt(c, r);
    return symbol === "orb" ? { id: id++, symbol, multiplier: 5 } : { id: id++, symbol };
  }));
};
const zeroPay = Object.fromEntries(PAY.map(s => [s, [0, 0, 0]])) as never;
const richPay = Object.fromEntries(PAY.map(s => [s, [10 ** 7, 10 ** 7, 10 ** 7]])) as never;
const winnersOnly = [["l5", 1]] as const; // every cell is l5: huge tumbles, 8+ always wins

test("engine id, exports and the protocol index re-export", () => {
  assert.equal(STORM_ENGINE_ID, "storm-throne-1");
  assert.equal(STORM_MAX_WIN_MULTIPLIER, 5000);
  assert.equal(STORM_FREE_SPINS_TRIGGER, 15);
  assert.equal(STORM_FREE_SPINS_RETRIGGER, 5);
  assert.equal(STORM_BUY_MIN_SCATTERS, 4);
  assert.equal(protocol.playStormRound, playStormRound);
  assert.equal(protocol.stormCostCents, stormCostCents);
  assert.equal(protocol.STORM_RTP, STORM_RTP);
  assert.equal(typeof protocol.playCascade2Round, "function", "the other engines are still exported");
  assert.deepEqual([...STORM_MODES], ["standard", "ante", "buy"]);
  assert.deepEqual([...STORM_BET_LEVELS_CENTS], [100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 40000, 50000]);
  assert.deepEqual(STORM_SCATTER_PAY, { 4: 300, 5: 500, 6: 10_000 });
  assert.ok(Object.isFrozen(STORM_BET_LEVELS_CENTS) && Object.isFrozen(STORM_MODE_TABLES.ante.base) && Object.isFrozen(STORM_PAYTABLE.h1) && Object.isFrozen(STORM_ORB_WEIGHTS));
});

test("structure: self-contained pure module (no imports, clock, Math.random, network or I/O)", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/storm-throne.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/^\s*import\s/m.test(source), "no import statements: the evidence covers these bytes only");
  assert.ok(!/from\s+["']\.\/cascade/.test(source));
  for (const forbidden of ["Math.random", "Date.now", "new Date", "performance.now", "fetch(", "process.", "require("]) assert.ok(!source.includes(forbidden), forbidden);
});

test("same seed, bet and mode give a byte-identical round; seed and mode both change the result", () => {
  for (const mode of MODES) {
    const a = playStormRound(SEED, 500, mode), b = playStormRound(SEED, 500, mode);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.engine, STORM_ENGINE_ID);
    assert.equal(a.seedHex, SEED);
    assert.equal(a.mode, mode);
    const distinct = new Set(seeds(40).map(s => JSON.stringify(playStormRound(s, 500, mode).spins[0]!.steps[0]!.grid)));
    assert.equal(distinct.size, 40);
    // The bet level never changes the dealt cards, only the payout and cost.
    assert.deepEqual(playStormRound(SEED, 100, mode).spins, playStormRound(SEED, 50_000, mode).spins);
  }
  assert.notEqual(JSON.stringify(playStormRound(SEED, 500, "ante").spins), JSON.stringify(playStormRound(SEED, 500, "buy").spins));
});

test("RNG and rules are frozen: a fingerprint of 200 fixed seeds across all modes and bets", () => {
  const rng = __stormTest.createRng(SEED), again = __stormTest.createRng(SEED);
  const first = Array.from({ length: 6 }, () => rng());
  assert.deepEqual(first, Array.from({ length: 6 }, () => again()));
  assert.ok(first.every(x => Number.isInteger(x) && x >= 0 && x < 2 ** 32));
  const other = __stormTest.createRng("ffffffffffffffffffffffffffffffff");
  assert.notDeepEqual(first, Array.from({ length: 6 }, () => other()));
  // Any change of RNG, draw order, tables or rules changes this hash (a new behavior needs a new engine id).
  const bets = [100, 200, 50_000, 4000], hash = createHash("sha256");
  for (let i = 0; i < 200; i++) {
    const seed = createHash("sha256").update(`storm-throne-1-frozen:${i}`).digest("hex").slice(0, 32);
    hash.update(JSON.stringify(playStormRound(seed, bets[i % 4]!, MODES[i % 3]!)));
  }
  assert.equal(hash.digest("hex"), "25a14db178dfccb79dd2c33fbab8406cc4f4e3a5757ee0bc4cd35c122d51c5d4");
});

test("input validation throws RangeError for seed, bet level and mode", () => {
  for (const bad of ["", "0123456789ABCDEF0123456789ABCDEF", SEED.slice(1), SEED + "0", "g".repeat(32), 123 as unknown as string, undefined as unknown as string]) {
    assert.throws(() => playStormRound(bad, 100, "standard"), RangeError, String(bad));
  }
  for (const bad of [0, 99, 101, 150, 450, 600, 9999, 50_001, 100.5, -100, Number.NaN, Number.POSITIVE_INFINITY, "100" as unknown as number, 100n as unknown as number, null as unknown as number, undefined as unknown as number]) {
    for (const mode of MODES) {
      assert.throws(() => playStormRound(SEED, bad, mode), RangeError, String(bad));
      assert.throws(() => stormCostCents(bad, mode), RangeError, String(bad));
    }
  }
  for (const bad of ["", "Standard", "free", "bonus", null, undefined, 1, {}, "constructor", "__proto__"] as unknown as StormMode[]) {
    assert.throws(() => playStormRound(SEED, 100, bad), RangeError, String(bad));
    assert.throws(() => stormCostCents(100, bad), RangeError, String(bad));
  }
  assert.throws(() => stormSeedFromEntropy(new Uint32Array(3)), RangeError);
  for (const bet of STORM_BET_LEVELS_CENTS) for (const mode of MODES) assert.doesNotThrow(() => playStormRound(SEED, bet, mode));
});

test("cost arithmetic: standard = bet, ante = bet * 5 / 4, buy = bet * 100, always an integer", () => {
  assert.deepEqual(STORM_COST_FRACTION.ante, [5, 4]);
  for (const bet of STORM_BET_LEVELS_CENTS) {
    assert.equal(bet % 4, 0, `${bet} divisible by 4`);
    assert.equal(stormCostCents(bet, "standard"), bet);
    assert.equal(stormCostCents(bet, "ante"), (bet / 4) * 5);
    assert.equal(stormCostCents(bet, "buy"), bet * 100);
    for (const mode of MODES) {
      assert.ok(Number.isSafeInteger(stormCostCents(bet, mode)));
      const round = playStormRound(SEED, bet, mode);
      assert.equal(round.costCents, stormCostCents(bet, mode));
      assert.equal(round.betCents, bet);
    }
  }
  assert.equal(stormCostCents(100, "ante"), 125);
  assert.equal(stormCostCents(50_000, "ante"), 62_500);
  assert.equal(stormCostCents(50_000, "buy"), 5_000_000);
});

test("payout is floor(bet * hundredths / 100) in every mode and never exceeds 5000 x bet", () => {
  for (const [i, seed] of seeds(2400).entries()) {
    const bet = STORM_BET_LEVELS_CENTS[i % STORM_BET_LEVELS_CENTS.length]!, mode = MODES[i % 3]!;
    const round = playStormRound(seed, bet, mode);
    assert.equal(round.payoutCents, Number(BigInt(bet) * BigInt(round.totalHundredths) / 100n));
    assert.ok(round.payoutCents <= bet * 5000);
    assert.equal(round.totalHundredths, round.spins.at(-1)!.totalHundredthsAfter);
    assert.equal(round.payoutCents, (bet / 100) * round.totalHundredths);
  }
});

test("structure: 6x5 grids, unique ids, ids keep their symbol, spin and round bookkeeping, all modes", () => {
  for (const mode of MODES) {
    for (const seed of seeds(250, `00ff00ff00ff00ff00ff00ff00ff00f${MODES.indexOf(mode)}`)) {
      const round = playStormRound(seed, 100, mode);
      const seen = new Map<number, string>();
      let total = 0, maxId = -1, left = 0;
      round.spins.forEach((spin, i) => {
        assert.equal(spin.index, i);
        assert.equal(spin.kind, i === 0 ? "base" : "free");
        total += spin.winHundredths;
        assert.equal(spin.totalHundredthsAfter, Math.min(total, 500_000));
        assert.equal(spin.winHundredths, spin.tumbleHundredths * spin.appliedMultiplier + spin.scatterHundredths);
        assert.equal(spin.multiplierSum, spin.orbSum);
        if (spin.kind === "free") { assert.equal(spin.scatterHundredths, 0); left--; }
        left += spin.freeSpinsAwarded;
        assert.equal(spin.freeSpinsLeft, left, "free spin bookkeeping");
        const ids = spin.steps.flatMap(step => cellsOf(step.grid).map(cell => cell.id));
        assert.ok(Math.min(...ids) > maxId, "ids of a new spin start above everything dealt before");
        maxId = Math.max(...ids);
      });
      assert.equal(left, 0);
      assert.equal(round.spins.length, round.freeSpinsTriggered ? 1 + round.spins.reduce((a, s) => a + s.freeSpinsAwarded, 0) : 1);
      for (const grid of allGrids(round)) {
        assert.equal(grid.length, 6);
        for (const column of grid) assert.equal(column.length, 5);
        assert.equal(new Set(cellsOf(grid).map(cell => cell.id)).size, 30);
        for (const cell of cellsOf(grid)) {
          const key = `${cell.symbol}:${cell.multiplier ?? ""}`;
          assert.equal(seen.get(cell.id) ?? key, key, "an id keeps its symbol (and an orb its value) for the whole round");
          seen.set(cell.id, key);
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
      const round = playStormRound(seed, 100, mode);
      for (const spin of round.spins) {
        const { steps } = spin;
        assert.equal(steps.at(-1)!.wins.length, 0, "last step has no wins");
        let sum = 0;
        steps.forEach((step, k) => {
          assert.equal(step.stepHundredths, step.wins.reduce((a, w) => a + w.payHundredths, 0));
          sum += step.stepHundredths;
          for (const win of step.wins) {
            assert.ok(win.count >= 8 && win.cells.length === win.count);
            assert.ok(!["scatter", "orb"].includes(win.symbol));
            const tier = win.count >= 12 ? 2 : win.count >= 10 ? 1 : 0;
            assert.equal(win.payHundredths, STORM_PAYTABLE[win.symbol][tier]);
            assert.deepEqual(win.cells, cellsOf(step.grid).filter(cell => cell.symbol === win.symbol).map(cell => cell.id));
          }
          assert.deepEqual(step.wins, __stormTest.findWins(step.grid));
          const following = steps[k + 1];
          if (!following) return;
          tumbled++;
          const removed = new Set(step.wins.flatMap(w => w.cells));
          step.grid.forEach((column, c) => {
            const survivors = column.filter(cell => !removed.has(cell.id));
            assert.deepEqual(following.grid[c]!.slice(5 - survivors.length), survivors, "survivors (scatters and orbs included) fall without changing");
          });
          const before = new Set(cellsOf(step.grid).map(cell => cell.id));
          const fresh = following.grid.flatMap(column => column.filter(cell => !before.has(cell.id))).map(cell => cell.id);
          assert.equal(fresh.length, removed.size);
          assert.ok(fresh.every((id, i) => i === 0 || id === fresh[i - 1]! + 1));
          for (const win of step.wins) assert.ok(win.cells.every(id => !cellsOf(following.grid).some(cell => cell.id === id)), "winners are gone");
        });
        assert.equal(spin.tumbleHundredths, sum);
      }
    }
  }
  assert.ok(tumbled > 1000, `tumbles exercised: ${tumbled}`);
});

test("paytable: tiers 8-9 < 10-11 < 12+ and higher symbols pay more; orb weights are the documented value set", () => {
  for (const symbol of PAY) {
    const [a, b, c] = STORM_PAYTABLE[symbol];
    assert.ok(a > 0 && a < b && b < c, symbol);
  }
  for (let i = 1; i < PAY.length; i++) for (let t = 0; t < 3; t++) assert.ok(STORM_PAYTABLE[PAY[i - 1]!][t]! > STORM_PAYTABLE[PAY[i]!][t]!, `${PAY[i - 1]} > ${PAY[i]} tier ${t}`);
  assert.deepEqual(STORM_ORB_WEIGHTS.map(([v]) => v), ORB_VALUES);
  for (let i = 1; i < STORM_ORB_WEIGHTS.length; i++) assert.ok(STORM_ORB_WEIGHTS[i - 1]![1] > STORM_ORB_WEIGHTS[i]![1], "bigger orbs are rarer");
  // Hand-built grids: tier boundaries and several winners in one step.
  const grid = makeGrid((c, r) => (c * 5 + r < 8 ? "h1" : c * 5 + r < 18 ? "l5" : c * 5 + r < 30 ? "l3" : "orb"));
  const wins = __stormTest.findWins(grid);
  assert.deepEqual(wins.map(w => [w.symbol, w.count, w.payHundredths]), [["h1", 8, STORM_PAYTABLE.h1[0]], ["l3", 12, STORM_PAYTABLE.l3[2]], ["l5", 10, STORM_PAYTABLE.l5[1]]]);
  assert.deepEqual(__stormTest.findWins(makeGrid((c, r) => (c * 5 + r < 7 ? "h1" : c * 5 + r < 12 ? "scatter" : c * 5 + r < 20 ? "orb" : PAY[(c * 5 + r) % 8 + 1]!))), []);
});

test("orbs: base and free spins both deal them, values come from the table, only orbs carry a value, orbSum is the final-grid sum", () => {
  const values = new Set(STORM_ORB_WEIGHTS.map(([v]) => v));
  for (const mode of MODES) {
    let baseOrbs = 0, freeOrbs = 0;
    const seen = new Set<number>();
    for (const seed of seeds(mode === "buy" ? 500 : 5000, `5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5${MODES.indexOf(mode)}`)) {
      for (const spin of playStormRound(seed, 100, mode).spins) {
        for (const step of spin.steps) for (const cell of cellsOf(step.grid)) {
          if (cell.symbol === "orb") { (spin.kind === "base" ? baseOrbs++ : freeOrbs++); assert.ok(values.has(cell.multiplier!)); seen.add(cell.multiplier!); } else assert.equal(cell.multiplier, undefined);
        }
        assert.equal(spin.orbSum, orbSumOf(finalGrid(spin)));
        assert.equal(spin.scatterCount, scattersIn(finalGrid(spin)));
      }
    }
    assert.ok(baseOrbs > 0 && freeOrbs > 0, `${mode}: base ${baseOrbs}, free ${freeOrbs}`);
    assert.ok(seen.size >= 10, `${mode}: ${seen.size} distinct orb values`);
  }
});

test("base spin: orbs multiply the tumble win only when it is > 0; the scatter pay is never multiplied; total multiplier fields stay 0", () => {
  let winsWithOrbs = 0, orbsNoWin = 0, scatterWithOrbs = 0, noOrbWin = 0;
  for (const mode of MODES) {
    for (const seed of seeds(6000, `0badc0de0badc0de0badc0de0badc0d${MODES.indexOf(mode)}`)) {
      const base = playStormRound(seed, 100, mode).spins[0]!;
      assert.equal(base.kind, "base");
      assert.equal(base.totalMultiplierBefore, 0);
      assert.equal(base.totalMultiplierAfter, 0);
      assert.equal(base.appliedMultiplier, base.orbSum || 1);
      if (base.orbSum > 0 && base.tumbleHundredths > 0) {
        winsWithOrbs++;
        assert.equal(base.winHundredths, base.tumbleHundredths * base.orbSum + base.scatterHundredths);
        assert.ok(base.winHundredths > base.tumbleHundredths);
      } else if (base.orbSum > 0) {
        orbsNoWin++;
        assert.equal(base.tumbleHundredths, 0);
        assert.equal(base.winHundredths, base.scatterHundredths, "orbs alone never pay: only the scatter pay (if any) remains");
        if (base.scatterHundredths > 0) scatterWithOrbs++;
      } else if (base.tumbleHundredths > 0) {
        noOrbWin++;
        assert.equal(base.winHundredths, base.tumbleHundredths + base.scatterHundredths);
      }
    }
  }
  assert.ok(winsWithOrbs > 100 && orbsNoWin > 100 && noOrbWin > 500, `cases: ${winsWithOrbs}/${orbsNoWin}/${noOrbWin} (scatter+orbs without win: ${scatterWithOrbs})`);
  // Hook: all orbs, no win possible -> the orb sum never creates a win by itself.
  const orbsOnly = __stormTest.play(SEED, 100, "standard", { tables: { standard: { base: [["orb", 1]] } }, orbs: [[500, 1]] });
  assert.equal(orbsOnly.spins[0]!.orbSum, 500 * 30);
  assert.equal(orbsOnly.spins[0]!.winHundredths, 0);
  assert.equal(orbsOnly.totalHundredths, 0);
  // Hook: a guaranteed small win (all l5 -> one tumble chain) with fixed orbs: win = tumble * orbSum exactly.
  const fixed = __stormTest.play(SEED, 100, "standard", { tables: { standard: { base: [["l5", 100], ["orb", 3]] } }, orbs: [[7, 1]], paytable: Object.fromEntries(PAY.map(s => [s, [10, 10, 10]])) as never });
  const s0 = fixed.spins[0]!;
  assert.ok(s0.tumbleHundredths > 0 && s0.orbSum > 0 && s0.orbSum % 7 === 0);
  assert.equal(s0.winHundredths, s0.tumbleHundredths * s0.orbSum);
});

test("free spins: the total multiplier starts at 0, grows only on winning spins by that spin's orb sum, persists, and multiplies the tumble win", () => {
  let winningWithOrbs = 0, losingWithOrbs = 0, noOrbWins = 0, spinsChecked = 0, afterRetrigger = 0, maxTotal = 0, ones = 0;
  for (const mode of MODES) {
    for (const seed of seeds(mode === "buy" ? 700 : 2500, `7777aaaa7777aaaa7777aaaa7777aaa${MODES.indexOf(mode)}`)) {
      const round = playStormRound(seed, 100, mode);
      let total = 0, retriggered = false;
      round.spins.forEach((spin, i) => {
        if (i === 0) return;
        spinsChecked++;
        assert.equal(spin.kind, "free");
        assert.equal(spin.totalMultiplierBefore, total, "the total persists from spin to spin");
        if (i === 1) assert.equal(spin.totalMultiplierBefore, 0, "a feature starts at 0");
        const added = spin.tumbleHundredths > 0 ? spin.orbSum : 0;
        assert.equal(spin.totalMultiplierAfter, spin.totalMultiplierBefore + added);
        assert.ok(spin.totalMultiplierAfter >= spin.totalMultiplierBefore, "never decreases");
        assert.equal(spin.appliedMultiplier, spin.totalMultiplierAfter || 1);
        assert.equal(spin.winHundredths, spin.tumbleHundredths * spin.appliedMultiplier);
        assert.equal(spin.scatterHundredths, 0);
        if (spin.tumbleHundredths === 0) assert.equal(spin.winHundredths, 0);
        if (spin.orbSum > 0 && spin.tumbleHundredths > 0) winningWithOrbs++;
        if (spin.orbSum > 0 && spin.tumbleHundredths === 0) { losingWithOrbs++; assert.equal(spin.totalMultiplierAfter, spin.totalMultiplierBefore, "orbs on a losing spin are not added"); }
        if (spin.tumbleHundredths > 0 && spin.orbSum === 0) { noOrbWins++; if (spin.totalMultiplierBefore === 0) { ones++; assert.equal(spin.winHundredths, spin.tumbleHundredths, "x1 while the total is 0"); } else assert.equal(spin.winHundredths, spin.tumbleHundredths * spin.totalMultiplierBefore, "an earlier total still multiplies a spin without orbs"); }
        if (retriggered && spin.totalMultiplierBefore > 0) afterRetrigger++;
        if (spin.freeSpinsAwarded > 0) retriggered = true;
        total = spin.totalMultiplierAfter;
        maxTotal = Math.max(maxTotal, total);
      });
      // The last spin of a feature may be the capped one; the total is whatever it accumulated.
      assert.equal(round.spins[0]!.totalMultiplierAfter, 0);
    }
  }
  assert.ok(spinsChecked > 8000, `free spins checked ${spinsChecked}`);
  assert.ok(winningWithOrbs > 500 && losingWithOrbs > 100 && noOrbWins > 500 && ones > 20, `cases ${winningWithOrbs}/${losingWithOrbs}/${noOrbWins}/${ones}`);
  assert.ok(afterRetrigger > 0, "totals persist across a retrigger");
  assert.ok(maxTotal > 30, `total reaches ${maxTotal}`);
  // Hook: free spins dealt with only l5 and fixed orbs of 2: every spin wins, so the total grows by orbSum every spin.
  const hook = __stormTest.play(SEED, 100, "buy", {
    tables: { buy: { free: [["l5", 100], ["orb", 4]] } }, orbs: [[2, 1]], paytable: Object.fromEntries(PAY.map(s => [s, [1, 1, 1]])) as never, maxFreeSpins: 15,
  });
  let running = 0;
  for (const spin of hook.spins.slice(1)) {
    assert.ok(spin.tumbleHundredths > 0);
    running += spin.orbSum;
    assert.equal(spin.totalMultiplierAfter, running);
  }
  assert.ok(running > 0 && hook.spins.length === 16);
});

test("free spins: a win with no orbs ever dealt is paid x1; a total of 0 never zeroes a win", () => {
  const round = __stormTest.play(SEED, 100, "buy", { tables: { buy: { free: [["l5", 100]] } }, paytable: Object.fromEntries(PAY.map(s => [s, [1, 1, 1]])) as never, maxFreeSpins: 15 });
  for (const spin of round.spins.slice(1)) {
    assert.equal(spin.totalMultiplierAfter, 0);
    assert.equal(spin.appliedMultiplier, 1);
    assert.ok(spin.winHundredths > 0 && spin.winHundredths === spin.tumbleHundredths);
  }
});

test("scatter pay and trigger: base spin only, 4 / 5 / 6+ = 3x / 5x / 100x, 15 free spins on 4+; free spins pay no scatter", () => {
  const pays = new Set<number>();
  let triggered = 0;
  for (const mode of MODES) {
    for (const seed of seeds(mode === "buy" ? 1500 : 30_000, `5ca77e55c0ffee00ddba11feed5eed0${MODES.indexOf(mode)}`)) {
      const round = playStormRound(seed, 100, mode);
      const base = round.spins[0]!;
      const n = base.scatterCount;
      assert.equal(base.scatterHundredths, n >= 4 ? STORM_SCATTER_PAY[Math.min(n, 6) as 4 | 5 | 6] : 0);
      assert.equal(base.freeSpinsAwarded, n >= 4 ? 15 : 0);
      assert.equal(round.freeSpinsTriggered, n >= 4);
      if (n >= 4) { triggered++; pays.add(base.scatterHundredths); }
      for (const spin of round.spins.slice(1)) assert.equal(spin.scatterHundredths, 0);
    }
  }
  assert.ok(triggered > 1500 && pays.has(300) && pays.has(500), `triggered ${triggered}, pays ${[...pays]}`);
  // 6+ scatters: forced through the buy hook.
  const six = __stormTest.play(SEED, 100, "buy", { buyMinScatters: 6, paytable: zeroPay });
  assert.equal(six.spins[0]!.scatterHundredths, 10_000);
  assert.equal(six.spins[0]!.winHundredths, 10_000);
});

test("retrigger: 3+ scatters on a free spin award 5 more (also from 3, not 4); the total of free spins granted is bounded", () => {
  let natural = 0, three = 0;
  for (const seed of seeds(1500, "7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e")) {
    const round = playStormRound(seed, 100, "buy");
    round.spins.slice(1).forEach(spin => {
      assert.equal(spin.freeSpinsAwarded, spin.scatterCount >= 3 ? 5 : 0);
      if (spin.freeSpinsAwarded > 0) { natural++; if (spin.scatterCount === 3) three++; }
    });
    assert.equal(round.spins.length, 1 + 15 + 5 * round.spins.slice(1).filter(s => s.freeSpinsAwarded > 0).length);
  }
  assert.ok(natural > 20 && three > 5, `retriggers ${natural}, with exactly 3: ${three}`);
  // Every free spin retriggers: grants stop at maxFreeSpins, spin count = 1 + maxFreeSpins, the last spin leaves 0.
  const free = [["l5", 100], ["scatter", 30]] as const;
  const heavy = __stormTest.play(SEED, 100, "buy", { tables: { buy: { free: free as never } }, maxFreeSpins: 40, paytable: zeroPay });
  assert.equal(heavy.spins.length - 1, 40);
  assert.equal(heavy.spins.reduce((a, s) => a + s.freeSpinsAwarded, 0), 40);
  assert.equal(heavy.spins.at(-1)!.freeSpinsLeft, 0);
  assert.ok(heavy.spins.slice(1).every(s => s.scatterCount >= 3));
});

test("retrigger keeps the accumulated total multiplier (hooks: every free spin wins and retriggers)", () => {
  const free = [["l5", 100], ["scatter", 8], ["orb", 6]] as const;
  const round = __stormTest.play(SEED, 100, "buy", {
    tables: { buy: { free: free as never } }, orbs: [[3, 1]], paytable: Object.fromEntries(PAY.map(s => [s, [1, 1, 1]])) as never, maxFreeSpins: 40,
  });
  const retriggers = round.spins.filter((s, i) => i > 0 && s.freeSpinsAwarded > 0);
  assert.ok(retriggers.length >= 3);
  let previous = 0;
  for (const spin of round.spins.slice(1)) { assert.equal(spin.totalMultiplierBefore, previous); previous = spin.totalMultiplierAfter; }
  assert.ok(previous > round.spins[1]!.totalMultiplierAfter);
});

test("buy: the initial base grid always has 4+ scatters, free spins always trigger, scatter still pays", () => {
  let forced = 0, natural = 0, maxScatters = 0;
  const pays = new Set<number>();
  for (const seed of seeds(4000, "b0b0b0b0c1c1c1c1d2d2d2d2e3e3e3e3")) {
    const round = playStormRound(seed, 100, "buy");
    const [base, ...free] = round.spins;
    assert.ok(scattersIn(base!.steps[0]!.grid) >= STORM_BUY_MIN_SCATTERS);
    assert.equal(round.freeSpinsTriggered, true);
    assert.equal(base!.freeSpinsAwarded, 15);
    assert.ok(base!.scatterCount >= 4, "scatters never explode, so the final grid keeps them");
    assert.ok(free.length >= 15);
    assert.equal(base!.scatterHundredths, STORM_SCATTER_PAY[Math.min(base!.scatterCount, 6) as 4 | 5 | 6]);
    pays.add(base!.scatterHundredths);
    assert.ok(free.every(spin => spin.kind === "free"));
    // Same seed in standard: the buy grid differs only by cells turned into scatters (the base table is shared).
    const std = playStormRound(seed, 100, "standard").spins[0]!.steps[0]!.grid;
    const buy = base!.steps[0]!.grid;
    const stdScatters = scattersIn(std);
    assert.equal(scattersIn(buy), Math.max(4, stdScatters));
    const diff = cellsOf(buy).filter((cell, i) => cell.symbol !== cellsOf(std)[i]!.symbol);
    assert.equal(diff.length, Math.max(0, 4 - stdScatters));
    assert.ok(diff.every(cell => cell.symbol === "scatter" && cell.multiplier === undefined));
    if (stdScatters >= 4) natural++; else forced++;
    maxScatters = Math.max(maxScatters, base!.scatterCount);
  }
  assert.ok(forced > 3900, `forced ${forced}, natural ${natural}`);
  assert.ok(maxScatters >= 5 && pays.has(300) && pays.has(500), `scatter counts and pays vary: max ${maxScatters}, pays ${[...pays]}`);
  for (const mode of ["standard", "ante"] as const) {
    assert.ok(seeds(200).some(s => scattersIn(playStormRound(s, 100, mode).spins[0]!.steps[0]!.grid) < 4));
  }
  for (const seed of seeds(40)) assert.ok(scattersIn(__stormTest.play(seed, 100, "buy", { buyMinScatters: 7 }).spins[0]!.steps[0]!.grid) >= 7);
});

test("ensureScatters follows the documented procedure: 4 - k draws, distinct non-scatter cells, ids kept, column-major candidate list", () => {
  for (const seed of seeds(60, "9999888877776666555544443333222a")) {
    for (const k of [0, 1, 2, 3, 4, 5, 9]) {
      const grid = makeGrid((c, r) => (c * 5 + r < k ? "scatter" : (c * 5 + r) % 7 === 0 ? "orb" : PAY[(c * 5 + r) % 9]!));
      const before = grid.map(column => column.map(cell => ({ ...cell })));
      __stormTest.ensureScatters(grid, 4, seed);
      assert.equal(scattersIn(grid), Math.max(4, k));
      assert.deepEqual(grid.map(column => column.map(cell => cell.id)), before.map(column => column.map(cell => cell.id)), "ids unchanged");
      const changed = cellsOf(grid).filter((cell, i) => cell.symbol !== cellsOf(before)[i]!.symbol);
      assert.equal(changed.length, Math.max(0, 4 - k));
      assert.ok(changed.every(cell => cell.symbol === "scatter" && cell.multiplier === undefined));
      // Independent re-implementation of the documented procedure.
      const rng = __stormTest.createRng(seed), expected = before.map(column => column.map(cell => ({ ...cell })));
      let scatters = k;
      while (scatters < 4) {
        const spots: [number, number][] = [];
        for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) if (expected[c]![r]!.symbol !== "scatter") spots.push([c, r]);
        const [c, r] = spots[Math.floor(rng() * spots.length / 4_294_967_296)]!;
        expected[c]![r] = { id: expected[c]![r]!.id, symbol: "scatter" };
        scatters++;
      }
      assert.deepEqual(grid, expected);
    }
  }
});

test("ante: feature rate is about 2x standard on the same seeds and never forced; a trigger is still 4+ scatters on the final base grid", () => {
  const n = 150_000, ids = seeds(n, "a47ea47ea47ea47ea47ea47ea47ea47e");
  let standard = 0, ante = 0;
  for (const seed of ids) {
    if (playStormRound(seed, 100, "standard").spins[0]!.scatterCount >= 4) standard++;
    if (playStormRound(seed, 100, "ante").freeSpinsTriggered) ante++;
  }
  assert.ok(standard > 200, `standard triggers ${standard}`);
  assert.ok(ante > standard * 1.6 && ante < standard * 2.6, `ante ${ante} vs standard ${standard}`);
  for (const seed of ids.slice(0, 10_000)) {
    const round = playStormRound(seed, 100, "ante");
    assert.equal(round.freeSpinsTriggered, round.spins[0]!.scatterCount >= 4);
  }
});

test("mode tables: positive integer weights, scatter is rare, ante raises only the base scatter weight, buy keeps the base table, orbs exist in base and free", () => {
  const weightOf = (table: readonly (readonly [StormSymbol, number])[], s: StormSymbol) => table.find(([x]) => x === s)![1];
  for (const mode of MODES) {
    for (const table of [STORM_MODE_TABLES[mode].base, STORM_MODE_TABLES[mode].free] as const) {
      assert.deepEqual(table.map(([s]) => s), [...PAY, "scatter", "orb"]);
      for (const [, w] of table) assert.ok(Number.isSafeInteger(w) && w > 0);
      const total = table.reduce((a, [, w]) => a + w, 0);
      assert.ok(weightOf(table, "scatter") / total < 0.04, `${mode} scatter share`);
      assert.ok(weightOf(table, "orb") / total < 0.15, `${mode} orb share`);
    }
  }
  for (const [, w] of STORM_ORB_WEIGHTS) assert.ok(Number.isSafeInteger(w) && w > 0);
  const { standard, ante, buy } = STORM_MODE_TABLES;
  assert.ok(weightOf(ante.base, "scatter") > weightOf(standard.base, "scatter"));
  assert.deepEqual(ante.base.filter(([s]) => s !== "scatter"), standard.base.filter(([s]) => s !== "scatter"));
  assert.deepEqual(buy.base, standard.base);
  // The base game deals fewer orbs than the free spins in every mode.
  for (const mode of MODES) {
    const base = STORM_MODE_TABLES[mode].base, free = STORM_MODE_TABLES[mode].free;
    assert.ok(weightOf(base, "orb") / base.reduce((a, [, w]) => a + w, 0) < weightOf(free, "orb") / free.reduce((a, [, w]) => a + w, 0));
  }
});

test("the 5000 x bet cap clamps the total in every mode, ends the round at once and zeroes the free spins left", () => {
  for (const mode of MODES) {
    let capped = 0;
    for (const seed of seeds(mode === "buy" ? 600 : 6000, `cafe0000cafe0000cafe0000cafe000${MODES.indexOf(mode)}`)) {
      const round = __stormTest.play(seed, 100, mode, { capHundredths: 5000 });
      const uncapped = __stormTest.play(seed, 100, mode, { capHundredths: 10 ** 12 });
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
  for (const mode of MODES) {
    let hit: StormRound | undefined;
    for (const seed of seeds(300)) { const r = __stormTest.play(seed, 50_000, mode, { paytable: richPay }); if (r.capped) { hit = r; break; } }
    assert.ok(hit, `${mode}: a capped round exists`);
    assert.equal(hit!.totalHundredths, 500_000);
    assert.equal(hit!.payoutCents, 50_000 * 5000);
    assert.equal(hit!.spins.at(-1)!.freeSpinsLeft, 0);
  }
  // Buy: a capped round ends even though 15 free spins were guaranteed.
  const buyRound = __stormTest.play(SEED, 100, "buy", { paytable: richPay });
  assert.equal(buyRound.capped, true);
  assert.equal(buyRound.freeSpinsTriggered, true);
  assert.equal(buyRound.payoutCents, 500_000);
  // A big total multiplier alone reaches the cap: small pays, fat orbs in the free spins.
  const fat = __stormTest.play(SEED, 100, "buy", {
    tables: { buy: { free: [["l5", 100], ["orb", 60]] } }, orbs: [[500, 1]], paytable: Object.fromEntries(PAY.map(s => [s, [5, 5, 5]])) as never,
  });
  assert.equal(fat.capped, true);
  assert.equal(fat.totalHundredths, 500_000);
  assert.ok(fat.spins.at(-1)!.totalMultiplierAfter >= 500);
  assert.equal(fat.spins.at(-1)!.freeSpinsLeft, 0);
  assert.ok(fat.spins.slice(0, -1).every(s => s.totalHundredthsAfter < 500_000));
});

test("safety bounds: tumbles per spin and total free spins are capped", () => {
  const round = __stormTest.play(SEED, 100, "standard", { tables: { standard: { base: winnersOnly as never } }, maxTumbles: 7 });
  assert.equal(round.spins[0]!.steps.length, 8);
  assert.equal(round.spins[0]!.steps.at(-1)!.wins.length, 0);
  const heavy = [["l5", 100], ["scatter", 500]] as const;
  const scatters = __stormTest.play(SEED, 100, "buy", { tables: { buy: { free: heavy as never } }, maxFreeSpins: 12, paytable: zeroPay });
  assert.equal(scatters.spins.length - 1, 12);
  assert.equal(scatters.spins.at(-1)!.freeSpinsLeft, 0);
  assert.throws(() => __stormTest.play(SEED, 100, "standard", { tables: { standard: { base: [["l5", 0]] as never } } }), RangeError);
});

test("STORM_RTP equals the simulation evidence and the evidence matches the engine source", () => {
  const dir = fileURLToPath(new URL("../../../ops/evidence/storm-throne-20261012/", import.meta.url));
  const evidence = JSON.parse(readFileSync(`${dir}rtp.json`, "utf8")) as {
    engine: string; engineSourceSha256: string; tuningOverride: unknown; seed: string; modes: Record<StormMode, {
      rounds: number; rtpVsCost: { pointEstimate: number; ci95: [number, number] }; hitRate: number; featureRate: number; stdDevPerRoundCostUnits: number; capHits: number;
    }>;
  };
  assert.equal(evidence.engine, STORM_ENGINE_ID);
  assert.equal(evidence.tuningOverride, null, "evidence runs never use a tuning override");
  assert.ok(!evidence.seed.includes("tune"), "evidence seeds are distinct from tuning seeds");
  const source = readFileSync(fileURLToPath(new URL("../src/storm-throne.ts", import.meta.url)), "utf8")
    .replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
  assert.equal(createHash("sha256").update(source).digest("hex"), evidence.engineSourceSha256, "engine code changed after the evidence run: rerun the simulation");
  const r3 = (x: number): number => Number(x.toFixed(3));
  for (const mode of MODES) {
    const e = evidence.modes[mode], c = STORM_RTP[mode];
    assert.ok(e.rounds >= 20_000_000, `${mode}: ${e.rounds} rounds`);
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
  assert.ok(STORM_RTP.standard.hitRate >= 0.22 && STORM_RTP.standard.hitRate <= 0.30);
  assert.ok(1 / STORM_RTP.standard.featureRate >= 350 && 1 / STORM_RTP.standard.featureRate <= 550);
  assert.ok(STORM_RTP.buy.featureRate === 1 && STORM_RTP.ante.featureRate > STORM_RTP.standard.featureRate * 1.6);
});
