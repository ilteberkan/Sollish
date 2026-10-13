import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CEZERI_BET_LEVELS_CENTS, CEZERI_COST_FRACTION, CEZERI_ENGINE_ID, CEZERI_FALCON_COUNT, CEZERI_FREE_SPINS_RETRIGGER, CEZERI_FREE_SPINS_TRIGGER, CEZERI_GEAR_PAY,
  CEZERI_MAX_FREE_SPINS, CEZERI_MAX_RESPINS, CEZERI_MAX_WIN_MULTIPLIER, CEZERI_MODES, CEZERI_MODE_TABLES, CEZERI_PAYTABLE, CEZERI_RETRIGGER_VESSELS, CEZERI_RTP, CEZERI_SCATTER_PAY,
  CEZERI_STOP_BASE_WEIGHT, CEZERI_TRIGGER_VESSELS, __cezeriTest, cezeriCostCents, cezeriSeedFromEntropy, playCezeriRound,
  type CezeriBoard, type CezeriMode, type CezeriPaySymbol, type CezeriRingTable, type CezeriRound, type CezeriSpin, type CezeriSymbol, type CezeriTuning,
  type CezeriFalconStep, type CezeriHubStep, type CezeriLockStep, type CezeriRotateStep, type CezeriScatterStep, type CezeriWinStep,
} from "../src/cezeri.ts";
import * as protocol from "../src/index.ts";

const PAY: CezeriPaySymbol[] = ["h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4"];
const SEED = "0123456789abcdef0123456789abcdef";
const MODES = CEZERI_MODES;
function seeds(count: number, label = "f00dcafe00112233445566778899aabb"): string[] {
  const rng = __cezeriTest.createRng(label);
  return Array.from({ length: count }, () => cezeriSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
const ring = (strip: string, vesselStop = 100): CezeriRingTable => ({ strip, vesselStop });
const A30 = "A".repeat(30), B30 = "B".repeat(30), V30 = "V".repeat(30), W30 = "W".repeat(30), C30 = "C".repeat(30);
const AB30 = "AB".repeat(15);
/** Tuning that replaces the tables of one mode. Hub tables default to a constant hub of 3 (base) / 1 (free). */
const scenario = (mode: CezeriMode, base: string[], free: string[], extra: CezeriTuning = {}, hubBase: number = 3, hubFree: number = 1): CezeriTuning => ({
  tables: { [mode]: { base: base.map(s => ring(s)), respin: base.map(s => ring(s)), free: free.map(s => ring(s)), hubBase: [[hubBase, 1]], hubFree: [[hubFree, 1]] } },
  ...extra,
});
const richPay = Object.fromEntries(PAY.map(s => [s, [10 ** 7, 10 ** 7]])) as never;
const typesOf = (spin: CezeriSpin): string => spin.steps.map(s => ({ hub: "H", rotate: "R", win: "W", lock: "L", end: "E", scatter: "S", falcon: "F" })[s.type]).join("");
const stepsOf = <T extends CezeriSpin["steps"][number]["type"]>(spin: CezeriSpin, type: T): Extract<CezeriSpin["steps"][number], { type: T }>[] =>
  spin.steps.filter(s => s.type === type) as never;
const countSymbol = (board: CezeriBoard, symbol: CezeriSymbol): number => board.flat().filter(s => s === symbol).length;

/** Independent spoke oracle: best pay of the four slices of a spoke: a run of 3-4 slices that starts at ring 0 or a run of 3 slices from ring 1
 * (any symbol, gears are wild) or a pure gear run. */
function oracleRun(cells: readonly CezeriSymbol[]): { pay: number; start: number; length: number } {
  let best = { pay: 0, start: 0, length: 0 };
  for (const start of [0, 1]) {
    for (const symbol of PAY) {
      let n = 0;
      while (start + n < 4 && (cells[start + n] === symbol || cells[start + n] === "gear")) n++;
      if (n >= 3) { const pay = CEZERI_PAYTABLE[symbol][n - 3]!; if (pay > best.pay || (pay === best.pay && start < best.start)) best = { pay, start, length: n }; }
    }
    let g = 0;
    while (start + g < 4 && cells[start + g] === "gear") g++;
    if (g >= 3 && CEZERI_GEAR_PAY[g - 3]! > best.pay) best = { pay: CEZERI_GEAR_PAY[g - 3]!, start, length: g };
  }
  return best;
}
const oraclePay = (cells: readonly CezeriSymbol[]): number => oracleRun(cells).pay;
const spokeOf = (board: CezeriBoard, spoke: number): CezeriSymbol[] => [0, 1, 2, 3].map(r => board[r]![spoke]!);
const LETTER_SYMBOL: Record<string, CezeriSymbol> = { A: "h1", B: "h2", C: "h3", D: "h4", E: "l1", F: "l2", G: "l3", H: "l4", W: "gear", V: "vessel" };
const heldKey = (r: number, k: number): string => `${r},${k}`;

/** Replays the steps of one spin against the rules and checks every field (rotation strips included). */
function replaySpin(spin: CezeriSpin, mode: CezeriMode, kind: "base" | "free", carried: number, wildsBefore: ReadonlySet<string>): void {
  assert.equal(spin.kind, kind);
  assert.match(typesOf(spin), /^HRW*(?:LHRW*)*L?ES?F?$/, typesOf(spin));
  if (kind === "base") assert.ok(!typesOf(spin).includes("F"));
  const tables = CEZERI_MODE_TABLES[mode];
  const paid = new Array<number>(12).fill(0);
  const held = new Set<string>();
  let board: CezeriBoard | null = null, hub = 0, round = -1, chain = 0, respinPending = false, rotatedRound = -1, sawEnd = false, capEnded = false;
  let newThisRound: string[] = [];
  for (const step of spin.steps) {
    switch (step.type) {
      case "hub": {
        if (step.round === 0) {
          assert.equal(step.reason, "spin");
          assert.equal(step.carried, carried);
          assert.ok([1, 2, 3, 5, 10].includes(step.drawn!), "hub draws are 1,2,3,5,10");
          assert.equal(step.value, kind === "free" ? Math.max(carried, step.drawn!) : step.drawn);
          assert.equal(step.previous, 0);
        } else {
          assert.ok(respinPending, "a respin hub follows a lock that says respin");
          assert.equal(step.reason, "respin");
          assert.equal(step.drawn, null);
          assert.equal(step.previous, hub);
          assert.equal(step.value, hub + 1, "hub +1 per respin");
          assert.equal(step.round, round + 1);
          assert.ok(step.round <= CEZERI_MAX_RESPINS, "respin cap");
        }
        hub = step.value; round = step.round; respinPending = false;
        break;
      }
      case "rotate": {
        assert.equal(step.round, round, "rotate follows its hub");
        assert.deepEqual(step.rings.map(r => r.ring), [0, 1, 2, 3], "every ring turns in every rotation");
        const strips = kind === "free" ? tables.free : step.round === 0 ? tables.base : tables.respin;
        const next: CezeriBoard = [[], [], [], []];
        for (const r of step.rings) {
          assert.equal(r.slices.length, 12);
          const table = strips[r.ring]!.strip;
          assert.equal(r.stripLength, table.length);
          assert.ok(r.stop >= 0 && r.stop < table.length && table.length >= 30 && table.length <= 48);
          const wild = [...Array(12).keys()].filter(k => wildsBefore.has(heldKey(r.ring, k)));
          assert.deepEqual(r.pinned, kind === "free" ? wild : [], "pinned = permanent falcon wilds");
          const keep = [...Array(12).keys()].filter(k => held.has(heldKey(r.ring, k)) && !r.pinned.includes(k));
          assert.deepEqual(r.held, keep, "held = the chain-held slices (not wild)");
          for (let k = 0; k < 12; k++) {
            if (r.pinned.includes(k)) assert.equal(r.slices[k], "gear");
            else if (keep.includes(k)) assert.equal(r.slices[k], board![r.ring]![k], "held slices keep their symbol and never move");
            else assert.equal(r.slices[k], LETTER_SYMBOL[table[(r.stop + k) % table.length]!], "free slices come from the strip window");
          }
          next[r.ring] = r.slices;
        }
        assert.deepEqual(step.board, next);
        board = step.board; rotatedRound = step.round; newThisRound = [];
        break;
      }
      case "win": {
        assert.equal(step.round, rotatedRound);
        assert.equal(step.hub, hub);
        const cells = spokeOf(board!, step.spoke);
        const run = oracleRun(cells);
        assert.equal(step.fullHundredths, run.pay, `spoke ${step.spoke}`);
        assert.equal(step.startRing, run.start);
        assert.equal(step.length, run.length);
        assert.equal(step.paidBefore, paid[step.spoke]);
        assert.ok(step.fullHundredths > paid[step.spoke]!);
        assert.equal(step.payHundredths, step.fullHundredths - step.paidBefore);
        assert.equal(step.winHundredths, step.payHundredths * hub);
        assert.equal(step.cells.length, step.length);
        step.cells.forEach(([r, k], i) => { assert.equal(r, step.startRing + i); assert.equal(k, step.spoke); });
        assert.deepEqual(step.wildRings, step.cells.filter(([r, k]) => board![r]![k] === "gear").map(([r]) => r));
        if (step.symbol !== "gear") for (const [r, k] of step.cells) assert.ok(board![r]![k] === step.symbol || board![r]![k] === "gear");
        else assert.equal(step.wildRings.length, step.length);
        for (const [r, k] of step.cells) if (!held.has(heldKey(r, k))) newThisRound.push(heldKey(r, k));
        paid[step.spoke] = step.fullHundredths; chain += step.winHundredths;
        break;
      }
      case "lock": {
        assert.equal(step.round, rotatedRound);
        // every spoke with a pay beyond what it already paid was announced before the lock
        for (let s = 0; s < 12; s++) assert.ok(oraclePay(spokeOf(board!, s)) <= paid[s]!, `spoke ${s} fully paid`);
        assert.deepEqual(step.newHeld.map(([r, k]) => heldKey(r, k)), newThisRound);
        for (const key of newThisRound) held.add(key);
        assert.deepEqual(step.held.map(([r, k]) => heldKey(r, k)), [...held].sort((a, b) => { const [ar, ak] = a.split(",").map(Number) as [number, number], [br, bk] = b.split(",").map(Number) as [number, number]; return ar - br || ak - bk; }));
        assert.ok(step.newHeld.length >= 0);
        assert.equal(step.respin, round < CEZERI_MAX_RESPINS && held.size < 48);
        respinPending = step.respin; capEnded = !step.respin && round >= CEZERI_MAX_RESPINS;
        break;
      }
      case "end": {
        sawEnd = true;
        assert.equal(step.rotations, round + 1);
        assert.equal(step.respins, round);
        assert.ok(step.rotations >= 1 && step.rotations <= CEZERI_MAX_RESPINS + 1);
        assert.equal(step.hub, hub);
        assert.equal(step.heldSlices, held.size);
        assert.equal(step.chainHundredths, chain);
        assert.equal(step.chainCapped, capEnded);
        assert.ok(!respinPending);
        for (let s = 0; s < 12; s++) assert.ok(oraclePay(spokeOf(board!, s)) <= paid[s]!, "the chain ends only when nothing new pays (or the cap/full board ended it)");
        break;
      }
      default: break;
    }
  }
  assert.ok(sawEnd);
  assert.equal(spin.chainHundredths, chain);
  assert.equal(spin.rotations, round + 1);
  assert.equal(spin.respins, round);
  assert.equal(spin.hubEnd, hub);
}
function replayRound(round: CezeriRound): void {
  let carried = 0;
  round.spins.forEach((spin, i) => {
    const wildsBefore = new Set<string>(i === 0 ? [] : round.spins[i - 1]!.wilds.map(([r, k]) => heldKey(r, k)));
    replaySpin(spin, round.mode, i === 0 ? "base" : "free", i === 0 ? 0 : carried, wildsBefore);
    if (i > 0) carried = spin.hubEnd;
  });
}

test("engine id, exports and the protocol index re-export", () => {
  assert.equal(CEZERI_ENGINE_ID, "cezeri-gears-1");
  assert.equal(CEZERI_MAX_WIN_MULTIPLIER, 10_000);
  assert.equal(CEZERI_FREE_SPINS_TRIGGER, 10);
  assert.equal(CEZERI_FREE_SPINS_RETRIGGER, 4);
  assert.equal(CEZERI_TRIGGER_VESSELS, 3);
  assert.equal(CEZERI_RETRIGGER_VESSELS, 2);
  assert.equal(protocol.playCezeriRound, playCezeriRound);
  assert.equal(protocol.cezeriCostCents, cezeriCostCents);
  assert.equal(protocol.CEZERI_RTP, CEZERI_RTP);
  assert.equal(typeof protocol.playStormRound, "function", "the other engines are still exported");
  assert.deepEqual([...CEZERI_MODES], ["standard", "ante", "buy"]);
  assert.deepEqual([...CEZERI_BET_LEVELS_CENTS], [100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 40000, 50000]);
  assert.deepEqual(CEZERI_SCATTER_PAY, { 3: 200, 4: 1000, 5: 5000 });
  assert.ok(Object.isFrozen(CEZERI_BET_LEVELS_CENTS) && Object.isFrozen(CEZERI_MODE_TABLES.ante.hubFree) && Object.isFrozen(CEZERI_PAYTABLE.h1) && Object.isFrozen(CEZERI_GEAR_PAY));
  assert.deepEqual(CEZERI_FALCON_COUNT.map(r => r[0]), [1, 2, 3]);
  assert.equal(CEZERI_MAX_FREE_SPINS, 100);
});

test("structure: self-contained pure module (no imports, clock, Math.random, network or I/O)", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/cezeri.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/^\s*import\s/m.test(source), "no import statements: the evidence covers these bytes only");
  for (const forbidden of ["Math.random", "Date.now", "new Date", "performance.now", "fetch(", "process.", "require("]) assert.ok(!source.includes(forbidden), forbidden);
});

test("strips: lengths 30-48, valid letters, vessels at least 12 slices apart, positive stop weights, respin tables richer in wilds", () => {
  for (const mode of MODES) {
    const tables = CEZERI_MODE_TABLES[mode];
    for (const [kind, list] of [["base", tables.base], ["respin", tables.respin], ["free", tables.free]] as const) {
      assert.equal(list.length, 4);
      list.forEach((table, r) => {
        const s = table.strip;
        assert.ok(s.length >= 30 && s.length <= 48, `${mode} ${kind} ring ${r}: ${s.length}`);
        assert.match(s, /^[A-HWV]+$/);
        const at = [...s].flatMap((c, i) => (c === "V" ? [i] : []));
        assert.ok(at.length >= 1 && at.length <= 2, "one or two vessels on a strip");
        for (let i = 0; i < at.length; i++) assert.ok(((at[(i + 1) % at.length]! - at[i]! + s.length - 1) % s.length) + 1 >= 12 || at.length === 1, "no window holds two vessels");
        assert.ok(Number.isInteger(table.vesselStop) && table.vesselStop > 0 && table.vesselStop < 10 * CEZERI_STOP_BASE_WEIGHT);
        const weights = __cezeriTest.stopWeights(table);
        assert.equal(weights.length, s.length);
        assert.ok(weights.every(w => w === CEZERI_STOP_BASE_WEIGHT || w === table.vesselStop));
        // every symbol type shows up: a strip is a real mix, not a stub
        for (const letter of "ABCDEFGH") assert.ok(s.includes(letter), `${mode} ${kind} ring ${r} has ${letter}`);
      });
    }
    const wilds = (list: readonly CezeriRingTable[]): number => list.reduce((a, t) => a + [...t.strip].filter(c => c === "W").length, 0);
    assert.ok(wilds(tables.respin) > wilds(tables.base), `${mode}: the respin strips carry more gear wilds than the first rotation`);
    assert.ok(wilds(tables.free) >= wilds(tables.base), `${mode}: free strips carry at least as many gear wilds`);
    assert.ok(tables.hubFree.every(([v, w]) => [1, 2, 3, 5, 10].includes(v) && w > 0) && tables.hubBase.every(([v, w]) => [1, 2, 3, 5, 10].includes(v) && w > 0));
  }
  // modes share the base strips; ante raises the vessel stop weight (feature about 2x as often)
  assert.deepEqual(CEZERI_MODE_TABLES.standard.base.map(t => t.strip), CEZERI_MODE_TABLES.ante.base.map(t => t.strip));
  assert.ok(CEZERI_MODE_TABLES.ante.base[0]!.vesselStop > CEZERI_MODE_TABLES.standard.base[0]!.vesselStop);
});

test("same seed, bet and mode give a byte-identical round; seed and mode both change the result", () => {
  for (const mode of MODES) {
    const a = playCezeriRound(SEED, 500, mode), b = playCezeriRound(SEED, 500, mode);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.engine, CEZERI_ENGINE_ID);
    assert.equal(a.seedHex, SEED);
    assert.equal(a.mode, mode);
    const distinct = new Set(seeds(40).map(s => JSON.stringify(playCezeriRound(s, 500, mode).spins[0]!.board)));
    assert.ok(distinct.size >= 39, `${mode}: ${distinct.size} distinct first boards`);
    // The bet level never changes the dealt boards, only the payout and cost.
    assert.deepEqual(playCezeriRound(SEED, 100, mode).spins, playCezeriRound(SEED, 50_000, mode).spins);
  }
  assert.notEqual(JSON.stringify(playCezeriRound(SEED, 500, "ante").spins), JSON.stringify(playCezeriRound(SEED, 500, "buy").spins));
});

test("draw order: hub draw first, then ring stops 0..3, all from one SplitMix32-seeded xoshiro128** stream", () => {
  const pickOf = (rng: () => number, cumulative: number[]): number => {
    const target = Math.floor(rng() * cumulative.at(-1)! / 2 ** 32);
    return cumulative.findIndex(c => c > target);
  };
  const cum = (weights: number[]): number[] => weights.reduce<number[]>((a, w) => [...a, (a.at(-1) ?? 0) + w], []);
  for (const seed of seeds(25, "00000000000000000000000000000001")) {
    const tables = CEZERI_MODE_TABLES.standard;
    const rng = __cezeriTest.createRng(seed);
    const hub = tables.hubBase[pickOf(rng, cum(tables.hubBase.map(r => r[1])))]![0];
    const stops = tables.base.map(t => pickOf(rng, cum(__cezeriTest.stopWeights(t))));
    const spin = playCezeriRound(seed, 100, "standard").spins[0]!;
    const first = spin.steps[0] as CezeriHubStep, rotate = spin.steps[1] as CezeriRotateStep;
    assert.equal(first.value, hub);
    assert.deepEqual(rotate.rings.map(r => r.stop), stops);
    rotate.rings.forEach((r, i) => {
      const strip = tables.base[i]!.strip;
      assert.equal(r.slices.join(""), Array.from({ length: 12 }, (_, k) => ({ A: "h1", B: "h2", C: "h3", D: "h4", E: "l1", F: "l2", G: "l3", H: "l4", W: "gear", V: "vessel" })[strip[(stops[i]! + k) % strip.length]!]).join(""));
    });
  }
});

test("RNG and rules are frozen: a fingerprint of 200 fixed seeds across all modes and bets", () => {
  const rng = __cezeriTest.createRng(SEED), again = __cezeriTest.createRng(SEED);
  const first = Array.from({ length: 6 }, () => rng());
  assert.deepEqual(first, Array.from({ length: 6 }, () => again()));
  assert.ok(first.every(x => Number.isInteger(x) && x >= 0 && x < 2 ** 32));
  const other = __cezeriTest.createRng("ffffffffffffffffffffffffffffffff");
  assert.notDeepEqual(first, Array.from({ length: 6 }, () => other()));
  // Any change of RNG, draw order, tables or rules changes this hash (a new behavior needs a new engine id).
  const bets = [100, 200, 50_000, 4000], hash = createHash("sha256");
  for (let i = 0; i < 200; i++) {
    const seed = createHash("sha256").update(`cezeri-gears-1-frozen:${i}`).digest("hex").slice(0, 32);
    hash.update(JSON.stringify(playCezeriRound(seed, bets[i % 4]!, MODES[i % 3]!)));
  }
  assert.equal(hash.digest("hex"), "563533bd34b875ba171b01527e62ec327acf699c73abb8711a81db7378536f62");
});

test("input validation throws RangeError for seed, bet level and mode", () => {
  for (const bad of ["", "0123456789ABCDEF0123456789ABCDEF", SEED.slice(1), SEED + "0", "g".repeat(32), 123 as unknown as string, undefined as unknown as string]) {
    assert.throws(() => playCezeriRound(bad, 100, "standard"), RangeError, String(bad));
  }
  for (const bad of [0, 99, 101, 150, 450, 600, 9999, 50_001, 100.5, -100, Number.NaN, Number.POSITIVE_INFINITY, "100" as unknown as number, 100n as unknown as number, null as unknown as number, undefined as unknown as number]) {
    for (const mode of MODES) {
      assert.throws(() => playCezeriRound(SEED, bad, mode), RangeError, String(bad));
      assert.throws(() => cezeriCostCents(bad, mode), RangeError, String(bad));
    }
  }
  for (const bad of ["", "Standard", "free", "bonus", null, undefined, 1, {}, "constructor", "__proto__"] as unknown as CezeriMode[]) {
    assert.throws(() => playCezeriRound(SEED, 100, bad), RangeError, String(bad));
    assert.throws(() => cezeriCostCents(100, bad), RangeError, String(bad));
  }
  assert.throws(() => cezeriSeedFromEntropy(new Uint32Array(3)), RangeError);
  assert.equal(cezeriSeedFromEntropy(new Uint32Array([1, 0xdeadbeef, 0, 255])), "00000001deadbeef00000000000000ff");
  for (const bet of CEZERI_BET_LEVELS_CENTS) for (const mode of MODES) assert.doesNotThrow(() => playCezeriRound(SEED, bet, mode));
  // tuning errors are RangeErrors too
  assert.throws(() => __cezeriTest.play(SEED, 100, "standard", scenario("standard", ["A".repeat(11), A30, A30, A30], [A30, A30, A30, A30])), RangeError);
  assert.throws(() => __cezeriTest.play(SEED, 100, "standard", scenario("standard", ["X".repeat(30), A30, A30, A30], [A30, A30, A30, A30])), RangeError);
  assert.throws(() => __cezeriTest.play(SEED, 100, "standard", { tables: { standard: { base: [ring(A30)] } } }), RangeError);
  assert.throws(() => __cezeriTest.play(SEED, 100, "standard", { tables: { standard: { hubBase: [[1, 0]] } } }), RangeError);
});

test("cost arithmetic: standard = bet, ante = bet * 5 / 4, buy = bet * 100, always an integer", () => {
  assert.deepEqual(CEZERI_COST_FRACTION.ante, [5, 4]);
  for (const bet of CEZERI_BET_LEVELS_CENTS) {
    assert.equal(bet % 4, 0, `${bet} divisible by 4`);
    assert.equal(cezeriCostCents(bet, "standard"), bet);
    assert.equal(cezeriCostCents(bet, "ante"), (bet / 4) * 5);
    assert.equal(cezeriCostCents(bet, "buy"), bet * 100);
    for (const mode of MODES) {
      assert.ok(Number.isSafeInteger(cezeriCostCents(bet, mode)));
      const round = playCezeriRound(SEED, bet, mode);
      assert.equal(round.costCents, cezeriCostCents(bet, mode));
      assert.equal(round.betCents, bet);
    }
  }
  assert.equal(cezeriCostCents(100, "ante"), 125);
  assert.equal(cezeriCostCents(50_000, "ante"), 62_500);
  assert.equal(cezeriCostCents(50_000, "buy"), 5_000_000);
});

test("payout is floor(bet * hundredths / 100) in every mode and never exceeds 10000 x bet; totals add up spin by spin", () => {
  for (const [i, seed] of seeds(2400).entries()) {
    const bet = CEZERI_BET_LEVELS_CENTS[i % CEZERI_BET_LEVELS_CENTS.length]!, mode = MODES[i % 3]!;
    const round = playCezeriRound(seed, bet, mode);
    assert.equal(round.payoutCents, Number(BigInt(bet) * BigInt(round.totalHundredths) / 100n));
    assert.ok(round.payoutCents <= bet * 10_000);
    assert.equal(round.totalHundredths, round.spins.at(-1)!.totalHundredthsAfter);
    assert.equal(round.payoutCents, (bet / 100) * round.totalHundredths);
    let running = 0;
    for (const spin of round.spins) {
      assert.equal(spin.winHundredths, spin.chainHundredths + spin.scatterHundredths);
      running = round.capped && spin === round.spins.at(-1) ? round.totalHundredths : running + spin.winHundredths;
      assert.equal(spin.totalHundredthsAfter, running);
    }
  }
});

test("spoke evaluation: 3-4 from ring 0 or 3 from ring 1, gear is wild, a vessel or other symbol ends the run, pure gear runs pay their own table", () => {
  const ev = (...cells: CezeriSymbol[]) => __cezeriTest.evalSpoke(cells);
  assert.deepEqual(ev("h1", "h1", "h1", "h2"), { symbol: "h1", length: 3, pay: CEZERI_PAYTABLE.h1[0], start: 0 });
  assert.deepEqual(ev("l4", "l4", "l4", "l4"), { symbol: "l4", length: 4, pay: CEZERI_PAYTABLE.l4[1], start: 0 });
  assert.equal(ev("h1", "h1", "h2", "h1"), null, "a run must be consecutive");
  assert.equal(ev("h1", "h1", "vessel", "h1"), null);
  assert.deepEqual(ev("h2", "h1", "h1", "h1"), { symbol: "h1", length: 3, pay: CEZERI_PAYTABLE.h1[0], start: 1 }, "a run may start at ring 1 (rings 1-3)");
  assert.deepEqual(ev("vessel", "l2", "l2", "l2"), { symbol: "l2", length: 3, pay: CEZERI_PAYTABLE.l2[0], start: 1 });
  assert.equal(ev("vessel", "vessel", "vessel", "vessel"), null, "vessels never pay on a spoke");
  assert.equal(ev("h1", "h2", "h1", "h1"), null, "a run from ring 2 would be only 2 slices");
  // wilds
  assert.deepEqual(ev("h1", "gear", "h2", "h2"), { symbol: "h2", length: 3, pay: CEZERI_PAYTABLE.h2[0], start: 1 }, "gear then h2 h2 from ring 1");
  assert.deepEqual(ev("h3", "gear", "h3", "l1"), { symbol: "h3", length: 3, pay: CEZERI_PAYTABLE.h3[0], start: 0 });
  assert.deepEqual(ev("gear", "l2", "l2", "l2"), { symbol: "l2", length: 4, pay: CEZERI_PAYTABLE.l2[1], start: 0 });
  assert.deepEqual(ev("h4", "h4", "gear", "gear"), { symbol: "h4", length: 4, pay: CEZERI_PAYTABLE.h4[1], start: 0 });
  assert.deepEqual(ev("gear", "gear", "l3", "l3"), { symbol: "l3", length: 4, pay: CEZERI_PAYTABLE.l3[1], start: 0 });
  assert.deepEqual(ev("gear", "gear", "l1", "vessel"), { symbol: "l1", length: 3, pay: CEZERI_PAYTABLE.l1[0], start: 0 });
  assert.equal(ev("gear", "gear", "vessel", "h1"), null, "two gears and a vessel is not a run of three");
  assert.equal(ev("gear", "h1", "h2", "h2"), null);
  // the better of the run from ring 0 and the run from ring 1; a tie goes to ring 0
  assert.equal(ev("h4", "gear", "gear", "h3")!.pay, Math.max(CEZERI_PAYTABLE.h4[0], CEZERI_PAYTABLE.h3[0]));
  assert.equal(ev("h1", "h2", "h2", "h2")!.start, 1);
  assert.equal(ev("h2", "h2", "h2", "h2")!.start, 0);
  // pure gear runs: 3 gears + vessel, 4 gears; the better of the pure-gear and symbol runs pays
  assert.deepEqual(ev("gear", "gear", "gear", "vessel"), { symbol: "gear", length: 3, pay: CEZERI_GEAR_PAY[0], start: 0 });
  assert.deepEqual(ev("vessel", "gear", "gear", "gear"), { symbol: "gear", length: 3, pay: CEZERI_GEAR_PAY[0], start: 1 });
  assert.deepEqual(ev("gear", "gear", "gear", "gear"), { symbol: "gear", length: 4, pay: CEZERI_GEAR_PAY[1], start: 0 });
  const g3h1 = ev("gear", "gear", "gear", "h1")!;
  assert.equal(g3h1.pay, Math.max(CEZERI_GEAR_PAY[0], CEZERI_PAYTABLE.h1[1]));
  const g3l4 = ev("gear", "gear", "gear", "l4")!;
  assert.equal(g3l4.pay, Math.max(CEZERI_GEAR_PAY[0], CEZERI_PAYTABLE.l4[1]));
  assert.ok(CEZERI_GEAR_PAY[0] > CEZERI_PAYTABLE.h1[0] && CEZERI_GEAR_PAY[1] > CEZERI_PAYTABLE.h1[1], "gear runs pay at least as much as the best symbol");
  // paytable shape: higher symbols pay more, a 4-run pays more than a 3-run
  for (let i = 0; i < PAY.length; i++) {
    assert.ok(CEZERI_PAYTABLE[PAY[i]!][1] > CEZERI_PAYTABLE[PAY[i]!][0]);
    if (i > 0) assert.ok(CEZERI_PAYTABLE[PAY[i - 1]!][0] > CEZERI_PAYTABLE[PAY[i]!][0] && CEZERI_PAYTABLE[PAY[i - 1]!][1] > CEZERI_PAYTABLE[PAY[i]!][1]);
  }
  // exhaustive agreement with the independent oracle on every 4-slice spoke
  const all: CezeriSymbol[] = [...PAY, "gear", "vessel"];
  for (const a of all) for (const b of all) for (const c of all) for (const d of all) {
    const got = __cezeriTest.evalSpoke([a, b, c, d]);
    assert.equal(got?.pay ?? 0, oraclePay([a, b, c, d]), [a, b, c, d].join());
  }
});

test("step grammar and chain replay: every step of thousands of rounds obeys the rules", () => {
  const stats = { wildWins: 0, upgrades: 0, startOne: 0, rotations: new Array<number>(12).fill(0), falcons: 0, scatters: 0, heldRotations: 0 };
  for (const [i, seed] of seeds(2400, "11112222333344445555666677778888").entries()) {
    const mode = MODES[i % 3]!;
    const round = playCezeriRound(seed, 100, mode);
    replayRound(round);
    for (const spin of round.spins) {
      stats.rotations[spin.rotations]!++;
      for (const step of spin.steps) {
        if (step.type === "win") { if (step.wildRings.length > 0) stats.wildWins++; if (step.paidBefore > 0) stats.upgrades++; if (step.startRing === 1) stats.startOne++; }
        if (step.type === "falcon") stats.falcons++;
        if (step.type === "scatter") stats.scatters++;
        if (step.type === "rotate" && step.rings.some(r => r.held.length > 0)) stats.heldRotations++;
      }
    }
  }
  assert.ok(stats.wildWins > 20, `wild wins ${stats.wildWins}`);
  assert.equal(stats.rotations[0], 0);
  for (const n of [1, 2, 3, 4, 5]) assert.ok(stats.rotations[n]! > 0, `chains of ${n} rotations occur`);
  assert.ok(stats.heldRotations > 100, "respins with held slices occur");
  assert.ok(stats.upgrades > 20 && stats.startOne > 20, `upgrades ${stats.upgrades}, runs from ring 1: ${stats.startOne}`);
  assert.ok(stats.falcons > 0 && stats.scatters > 0);
});

test("chain length: respins per winning base spin average 1.8-2.5 with a visible tail; the cap of 10 respins is never exceeded and is reached sometimes", () => {
  let winning = 0, respins = 0, tail = 0, capped = 0, rounds = 0;
  const play = __cezeriTest.player();
  const rng = __cezeriTest.createRng("c4a1c4a1c4a1c4a1c4a1c4a1c4a1c4a1");
  while (rounds < 300_000) {
    rounds++;
    const round = play(cezeriSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])), 100, "standard");
    const spin = round.spins[0]!;
    assert.ok(spin.respins <= CEZERI_MAX_RESPINS && spin.rotations === spin.respins + 1);
    if (spin.chainHundredths > 0) { winning++; respins += spin.respins; if (spin.respins >= 5) tail++; }
    if (spin.respins === CEZERI_MAX_RESPINS) {
      capped++;
      replayRound(round);
      assert.equal((spin.steps.find(s => s.type === "end") as { chainCapped: boolean }).chainCapped, true);
      assert.equal(spin.hubEnd, spin.hubStart + CEZERI_MAX_RESPINS);
    }
  }
  const avg = respins / winning;
  assert.ok(avg >= 1.8 && avg <= 2.5, `average respins per winning chain ${avg}`);
  assert.ok(tail / winning >= 0.01, `chains with 5+ respins: ${tail / winning}`);
  assert.ok(capped > 0, "the 10-respin cap is reached in 300k spins");
});

test("board and step data shapes: 4 rings x 12 slices, known symbols, snapshots are independent copies, fields are plain data", () => {
  const symbols = new Set<string>([...PAY, "gear", "vessel"]);
  for (const seed of seeds(300, "aaaa0000bbbb1111cccc2222dddd3333")) {
    const round = playCezeriRound(seed, 100, "buy");
    for (const spin of round.spins) {
      assert.equal(spin.board.length, 4);
      for (const r of spin.board) { assert.equal(r.length, 12); assert.ok(r.every(s => symbols.has(s))); }
      const rotates = stepsOf(spin, "rotate");
      for (const [a, b] of rotates.slice(0, -1).map((x, k) => [x, rotates[k + 1]!] as const)) assert.notEqual(a.board, b.board);
      const lastRotate = rotates.at(-1)!;
      // the final board equals the last rotation, except for the slices the buy guarantee turned into vessels
      const forged = stepsOf(spin, "scatter").flatMap(s => s.forged);
      const expected = lastRotate.board.map(r => r.slice());
      for (const [r, k] of forged) expected[r]![k] = "vessel";
      assert.deepEqual(spin.board, expected);
    }
    assert.equal(JSON.stringify(round), JSON.stringify(JSON.parse(JSON.stringify(round))), "JSON round trip is lossless");
  }
});


const FIRST_SPIN = 12 * CEZERI_PAYTABLE.h1[0] * 3; // forced board [h1,h1,h1,h2] at hub 3
const NOWIN = [A30, B30, C30, "D".repeat(30)];

test("Dişli Kilidi (forced board): winning slices are held, every ring turns underneath, held slices never move, the hub rises by 1 per respin", () => {
  // rings 0..2 show only h1, ring 3 only h2: 12 spokes pay h1 x3 (rings 0-2 of every spoke are held); all four rings turn again and find nothing new.
  const round = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [A30, A30, A30, B30], [A30, A30, A30, A30]));
  assert.equal(round.spins.length, 1);
  const spin = round.spins[0]!;
  assert.equal(typesOf(spin), "HR" + "W".repeat(12) + "LHRE");
  const wins = stepsOf(spin, "win");
  assert.deepEqual(wins.map(w => w.spoke), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const w of wins) {
    assert.deepEqual([w.symbol, w.length, w.startRing, w.round, w.hub, w.paidBefore], ["h1", 3, 0, 0, 3, 0]);
    assert.equal(w.payHundredths, CEZERI_PAYTABLE.h1[0]);
    assert.equal(w.winHundredths, CEZERI_PAYTABLE.h1[0] * 3);
    assert.deepEqual(w.wildRings, []);
    assert.deepEqual(w.cells, [[0, w.spoke], [1, w.spoke], [2, w.spoke]]);
  }
  const [lock] = stepsOf(spin, "lock");
  assert.equal(lock!.held.length, 36);
  assert.equal(lock!.newHeld.length, 36);
  assert.equal(lock!.respin, true);
  assert.ok(lock!.held.every(([r]) => r <= 2));
  const [hub0, hub1] = stepsOf(spin, "hub");
  assert.deepEqual([hub0!.value, hub0!.reason, hub1!.value, hub1!.previous, hub1!.reason, hub1!.round], [3, "spin", 4, 3, "respin", 1]);
  const [rot0, rot1] = stepsOf(spin, "rotate");
  assert.deepEqual(rot0!.rings.map(r => r.ring), [0, 1, 2, 3]);
  assert.deepEqual(rot1!.rings.map(r => r.ring), [0, 1, 2, 3], "all four rings turn in a respin");
  assert.deepEqual(rot1!.rings.map(r => r.held.length), [12, 12, 12, 0]);
  for (const r of [0, 1, 2]) assert.deepEqual(rot1!.board[r], rot0!.board[r], "held slices never move");
  const [end] = stepsOf(spin, "end");
  assert.deepEqual([end!.rotations, end!.respins, end!.hub, end!.heldSlices, end!.chainCapped, end!.chainHundredths], [2, 1, 4, 36, false, FIRST_SPIN]);
  assert.equal(spin.winHundredths, FIRST_SPIN);
  assert.equal(round.totalHundredths, spin.winHundredths);
  assert.equal(round.freeSpinsTriggered, false);
  replayRound(round);
  // the next spin starts clean: held slices are released at the end of the chain (a free spin of the same scenario holds nothing in its first rotation)
  const withFree = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [V30, V30, V30, A30], [A30, A30, A30, B30]));
  for (const spin2 of withFree.spins.slice(1)) assert.ok(stepsOf(spin2, "rotate")[0]!.rings.every(r => r.held.length === 0));
});

test("Dişli Kilidi: a respin that extends a run or pays a new spoke pays only the increment, at the new hub; the chain goes on while something new pays", () => {
  // rings 0..2 are all h1, ring 3 holds a single h1 slice among h2: a rotation shows it at one spoke (or not at all).
  const tuning = scenario("standard", [A30, A30, A30, B30.slice(1) + "A"], [A30, A30, A30, A30]);
  let found = 0, multi = 0;
  for (const seed of seeds(400, "5eed5eed5eed5eed5eed5eed5eed5eed")) {
    const round = __cezeriTest.play(seed, 100, "standard", tuning);
    replayRound(round);
    const spin = round.spins[0]!;
    const later = stepsOf(spin, "win").filter(w => w.round >= 1);
    const first = stepsOf(spin, "win").filter(w => w.round === 0);
    // round 0 may already show the ring-3 h1 slice (a 4-run); every other spoke pays the 3-run
    assert.equal(first.length, 12);
    let expected = first.reduce((a, w) => a + w.winHundredths, 0);
    const roundsWithPay = new Set(later.map(w => w.round));
    for (const w of later) {
      assert.deepEqual([w.symbol, w.length, w.startRing, w.hub, w.paidBefore, w.fullHundredths], ["h1", 4, 0, 3 + w.round, CEZERI_PAYTABLE.h1[0], CEZERI_PAYTABLE.h1[1]]);
      assert.equal(w.payHundredths, CEZERI_PAYTABLE.h1[1] - CEZERI_PAYTABLE.h1[0]);
      assert.equal(w.winHundredths, w.payHundredths * w.hub);
      expected += w.winHundredths;
    }
    assert.equal(spin.chainHundredths, expected);
    // the chain ended on a rotation without a new pay (or when all 48 slices were held)
    const last = stepsOf(spin, "rotate").at(-1)!;
    assert.ok(!later.some(w => w.round === last.round) || stepsOf(spin, "lock").at(-1)!.respin === false || last.round === CEZERI_MAX_RESPINS);
    if (later.length > 0) found++;
    if (roundsWithPay.size >= 2) multi++;
    assert.equal(spin.rotations, 1 + (spin.rotations - 1));
  }
  assert.ok(found > 20, `${found} chains with an extension`);
  assert.ok(multi > 3, `${multi} chains with extensions in two or more respins`);
});

test("respin cap: tuning maxRespins 0 and 1 stop the chain, flag chainCapped, and still pay the last rotation", () => {
  const tuning = scenario("standard", [A30, A30, A30, B30.slice(1) + "A"], [A30, A30, A30, A30]);
  let capped1 = 0;
  for (const seed of seeds(300, "ca9ca9ca9ca9ca9ca9ca9ca9ca9ca9ca")) {
    const zero = __cezeriTest.play(seed, 100, "standard", { ...tuning, maxRespins: 0 }).spins[0]!;
    assert.equal(zero.rotations, 1);
    assert.equal((stepsOf(zero, "end")[0] as { chainCapped: boolean }).chainCapped, true);
    assert.equal(stepsOf(zero, "lock")[0]!.respin, false);
    const one = __cezeriTest.play(seed, 100, "standard", { ...tuning, maxRespins: 1 }).spins[0]!;
    assert.ok(one.rotations <= 2);
    if (one.rotations === 2 && stepsOf(one, "win").some(w => w.round === 1)) { capped1++; assert.equal(stepsOf(one, "lock").at(-1)!.respin, false); assert.equal((stepsOf(one, "end")[0] as { chainCapped: boolean }).chainCapped, true); }
  }
  assert.ok(capped1 > 10);
  assert.equal(CEZERI_MAX_RESPINS, 10);
});

test("Dişli Kilidi: spokes already paid are not paid again; increments add up to the final run pay of each spoke", () => {
  const rotations = new Array<number>(12).fill(0);
  for (const seed of seeds(4000, "c0ffee00c0ffee00c0ffee00c0ffee00")) {
    const round = playCezeriRound(seed, 100, "standard");
    for (const spin of round.spins) {
      rotations[spin.rotations]!++;
      const perSpoke = new Map<number, number>();
      for (const w of stepsOf(spin, "win")) {
        perSpoke.set(w.spoke, (perSpoke.get(w.spoke) ?? 0) + w.payHundredths);
        assert.ok(w.payHundredths > 0);
      }
      const finalBoard = spin.steps.filter((s): s is CezeriRotateStep => s.type === "rotate").at(-1)!.board;
      for (const [spoke, paid] of perSpoke) assert.equal(paid, oraclePay(spokeOf(finalBoard, spoke)), "increments add up to the final run pay");
    }
  }
  assert.equal(rotations[0], 0);
  for (const n of [1, 2, 3, 4]) assert.ok(rotations[n]! > 0, `${n}-rotation chains occur`);
  assert.ok(rotations.slice(6).some(n => n > 0), "chains of 5+ respins occur");
});

test("wild gear in a forced board: substitutes in a symbol run and in a pure gear run", () => {
  const withGears = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [W30, W30, W30, C30], [A30, A30, A30, A30])).spins[0]!;
  const w = stepsOf(withGears, "win")[0]!;
  const symbolRun = CEZERI_PAYTABLE.h3[1] >= CEZERI_GEAR_PAY[0];
  assert.equal(w.fullHundredths, Math.max(CEZERI_PAYTABLE.h3[1], CEZERI_GEAR_PAY[0]));
  assert.deepEqual([w.symbol, w.length, w.wildRings], symbolRun ? ["h3", 4, [0, 1, 2]] : ["gear", 3, [0, 1, 2]]);
  const pure = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [W30, W30, W30, W30], [A30, A30, A30, A30])).spins[0]!;
  const p = stepsOf(pure, "win");
  assert.equal(p.length, 12);
  for (const win of p) assert.deepEqual([win.symbol, win.length, win.fullHundredths, win.wildRings], ["gear", 4, CEZERI_GEAR_PAY[1], [0, 1, 2, 3]]);
  assert.equal(stepsOf(pure, "lock")[0]!.held.length, 48);
  assert.equal(stepsOf(pure, "lock")[0]!.respin, false, "all 48 slices held: no respin");
  assert.equal(pure.rotations, 1);
  assert.equal(stepsOf(pure, "hub").length, 1);
  assert.equal(pure.chainHundredths, 12 * CEZERI_GEAR_PAY[1] * 3);
  // gear completes a run for a symbol that only appears on some rings; a gear held in the run stays a gear
  const mixed = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [A30, W30, A30, D(30)], [A30, A30, A30, A30])).spins[0]!;
  for (const win of stepsOf(mixed, "win")) assert.deepEqual([win.symbol, win.wildRings], ["h1", [1]]);
  assert.equal(stepsOf(mixed, "rotate")[1]!.board[1]!.every(x => x === "gear"), true);
  // a run that starts at ring 1
  const late = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [B30, A30, A30, A30], [A30, A30, A30, A30])).spins[0]!;
  for (const win of stepsOf(late, "win")) assert.deepEqual([win.symbol, win.length, win.startRing, win.cells.length], ["h1", 3, 1, 3]);
  assert.equal(stepsOf(late, "win").length, 12);
});
function D(n: number): string { return "D".repeat(n); }

test("scatter: vessels count on the whole final board; trigger 3+, pay 2x / 10x / 50x of the bet, never multiplied by the hub", () => {
  assert.equal(CEZERI_SCATTER_PAY[3], 200);
  for (const [vessels, pay] of [[3, 200], [4, 1000], [5, 5000], [6, 5000], [9, 5000]] as const) {
    const round = __cezeriTest.play(SEED, 100, "buy", { tables: { buy: { base: NOWIN.map(s => ring(s)), respin: NOWIN.map(s => ring(s)), hubBase: [[10, 1]] } }, buyMinVessels: vessels });
    const spin = round.spins[0]!;
    const [scatter] = stepsOf(spin, "scatter");
    assert.equal(scatter!.count, vessels);
    assert.equal(scatter!.cells.length, vessels);
    assert.equal(scatter!.forged.length, vessels, "no natural vessels: all forged");
    assert.equal(scatter!.payHundredths, pay, "scatter pay is bet-based, hub 10 does not multiply it");
    assert.equal(spin.scatterHundredths, pay);
    assert.equal(spin.winHundredths, pay);
    assert.equal(scatter!.freeSpinsAwarded, 10);
    assert.equal(spin.freeSpinsAwarded, 10);
    assert.equal(spin.vesselCount, vessels);
    assert.equal(countSymbol(spin.board, "vessel"), vessels);
    assert.equal(round.freeSpinsTriggered, true);
  }
  // natural scatter on a board of vessels (36 vessels, no wins possible on those spokes)
  const full = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [V30, V30, V30, A30], [A30, B30, C30, "D".repeat(30)]));
  const spin = full.spins[0]!;
  assert.equal(spin.vesselCount, 36);
  assert.equal(spin.scatterHundredths, 5000);
  assert.deepEqual(stepsOf(spin, "scatter")[0]!.forged, []);
  assert.equal(full.spins.length, 11, "1 base spin + 10 free spins");
  // fewer than 3 vessels: no trigger and no scatter step
  let seen = 0;
  for (const seed of seeds(600, "abababababababababababababababab")) {
    const spin = playCezeriRound(seed, 100, "standard").spins[0]!;
    if (spin.vesselCount < 3) { seen++; assert.equal(spin.freeSpinsAwarded, 0); assert.equal(spin.scatterHundredths, 0); assert.equal(stepsOf(spin, "scatter").length, 0); }
  }
  assert.ok(seen > 500);
});

test("free spins: 10 on trigger, 2+ vessels retrigger +4 (no scatter pay), the safety bound limits the grant, counts add up", () => {
  const retrigger = __cezeriTest.play(SEED, 100, "standard", { ...scenario("standard", [V30, V30, V30, A30], [V30, A30, A30, A30]), maxFreeSpins: 30 });
  assert.equal(retrigger.spins.length, 31);
  assert.equal(retrigger.spins.slice(1).reduce((a, s) => a + s.freeSpinsAwarded, 0), 30 - 10, "10 on the trigger, 20 more by retriggers, bounded at 30");
  assert.equal(retrigger.spins[0]!.freeSpinsAwarded, 10);
  assert.equal(retrigger.spins[1]!.freeSpinsAwarded, 4);
  assert.equal(retrigger.spins.at(-1)!.freeSpinsLeft, 0);
  assert.equal(retrigger.spins.at(-2)!.freeSpinsAwarded, 0, "bound reached");
  assert.equal(stepsOf(retrigger.spins[1]!, "scatter")[0]!.payHundredths, 0, "no scatter pay in free spins");
  assert.equal(stepsOf(retrigger.spins[1]!, "scatter")[0]!.freeSpinsAwarded, 4);
  let left = 10;
  for (const spin of retrigger.spins.slice(1)) { left += spin.freeSpinsAwarded - 1; assert.equal(spin.freeSpinsLeft, left); }
  // natural rounds
  let triggered = 0, retriggered = 0;
  for (const [i, seed] of seeds(2500, "1357913579135791357913579135791a").entries()) {
    const round = playCezeriRound(seed, 100, MODES[i % 3]!);
    const free = round.spins.slice(1);
    if (!round.freeSpinsTriggered) { assert.equal(round.spins.length, 1); continue; }
    triggered++;
    assert.ok(round.spins[0]!.vesselCount >= 3);
    const granted = round.spins.reduce((a, s) => a + s.freeSpinsAwarded, 0);
    if (!round.capped) assert.equal(free.length, granted);
    assert.ok(granted >= 10 && (granted - 10) % 4 === 0 && granted <= CEZERI_MAX_FREE_SPINS);
    for (const spin of free) {
      assert.equal(spin.freeSpinsAwarded, spin.vesselCount >= 2 && !round.capped ? 4 : spin.freeSpinsAwarded);
      if (spin.freeSpinsAwarded > 0) retriggered++;
      assert.equal(spin.scatterHundredths, 0);
    }
    assert.equal(round.spins.at(-1)!.freeSpinsLeft, 0);
  }
  assert.ok(triggered > 100 && retriggered > 0);
});

test("Fil Saati: hub persists and only rises between free spins; forced board shows the exact ladder", () => {
  const round = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [V30, V30, V30, A30], [A30, A30, A30, B30], {}, 3, 1));
  const free = round.spins.slice(1);
  assert.equal(free.length, 10);
  // free spins 1..3 happen before the first falcon: each wins 12 x h1 and respins ring 3 once, so the hub climbs by 1 per spin
  assert.deepEqual(free.slice(0, 3).map(s => s.hubStart), [1, 2, 3]);
  assert.deepEqual(free.slice(0, 3).map(s => s.hubEnd), [2, 3, 4]);
  const hub0 = stepsOf(free[1]!, "hub")[0]!;
  assert.deepEqual([hub0.carried, hub0.drawn, hub0.value], [2, 1, 2]);
  for (let i = 1; i < free.length; i++) assert.equal(free[i]!.hubStart, free[i - 1]!.hubEnd, "the drawn 1 never lowers the carried hub");
  for (const s of free) assert.ok(s.hubEnd >= s.hubStart);
  // base game hub never carries
  assert.equal(stepsOf(round.spins[0]!, "hub")[0]!.carried, 0);
  // natural rounds: hubStart = max(previous hubEnd, draw); hubEnd >= hubStart; hubs never fall inside the feature
  let checked = 0;
  for (const seed of seeds(600, "7777777777777777aaaaaaaaaaaaaaaa")) {
    const natural = playCezeriRound(seed, 100, "buy");
    let previous = 0;
    for (const spin of natural.spins.slice(1)) {
      const hubStep = spin.steps[0] as CezeriHubStep;
      assert.equal(hubStep.carried, previous);
      assert.equal(spin.hubStart, Math.max(previous, hubStep.drawn!));
      assert.ok(spin.hubStart >= previous && spin.hubEnd >= spin.hubStart);
      previous = spin.hubEnd; checked++;
    }
  }
  assert.ok(checked > 3000);
});

test("falcon: every 3rd free spin (if spins remain) pins 1-3 gear wilds on one ring; wilds persist for the rest of the feature", () => {
  let falcons = 0, newWildSlices = 0;
  const countDist = [0, 0, 0, 0];
  for (const seed of seeds(500, "fa1c0nfa1c0nfa1c0nfa1c0nfa1c0n00")) {
    const round = playCezeriRound(seed, 100, "buy");
    let wilds = new Set<string>();
    round.spins.forEach((spin, i) => {
      if (i === 0) { assert.deepEqual(spin.wilds, []); assert.equal(spin.reservoir, 0); return; }
      assert.equal(spin.reservoir, ((i - 1) % 3) + 1, "the water reservoir gains one level per free spin");
      // pinned wilds from earlier spins show on every rotation of this spin
      for (const rot of stepsOf(spin, "rotate")) {
        for (const key of wilds) { const [r, k] = key.split(",").map(Number) as [number, number]; assert.equal(rot.board[r]![k], "gear", `wild ${key} persists`); }
        for (const r of rot.rings) for (const key of wilds) { const [wr, wk] = key.split(",").map(Number) as [number, number]; if (wr === r.ring) assert.ok(r.pinned.includes(wk)); }
      }
      const falcon = stepsOf(spin, "falcon") as CezeriFalconStep[];
      const expected = spin.reservoir === 3 && spin.freeSpinsLeft > 0;
      assert.equal(falcon.length, expected ? 1 : 0, `free spin ${i}`);
      assert.ok(typesOf(spin).endsWith(expected ? "F" : typesOf(spin).at(-1)!));
      if (falcon.length) {
        falcons++;
        const f = falcon[0]!;
        assert.ok(f.ring >= 0 && f.ring <= 3);
        assert.ok(f.slices.length >= 1 && f.slices.length <= 3);
        countDist[f.slices.length]!++;
        assert.equal(new Set(f.slices).size, f.slices.length);
        for (const k of f.slices) { assert.ok(k >= 0 && k < 12); assert.ok(!wilds.has(`${f.ring},${k}`), "a falcon never re-targets a wild"); wilds.add(`${f.ring},${k}`); newWildSlices++; }
        assert.equal(f.wilds.length, wilds.size);
        assert.deepEqual(new Set(f.wilds.map(([r, k]) => `${r},${k}`)), wilds);
      }
      assert.deepEqual(new Set(spin.wilds.map(([r, k]) => `${r},${k}`)), wilds);
    });
    assert.ok(wilds.size <= 48);
  }
  assert.ok(falcons > 300 && newWildSlices >= falcons);
  assert.ok(countDist[1]! > 0 && countDist[2]! > 0 && countDist[3]! > 0);
  // forced: no vessels and no wins in the free spins, so the reservoir ladder and the falcon cadence are exact
  const forced = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [V30, V30, V30, A30], NOWIN));
  const free = forced.spins.slice(1);
  assert.equal(free.length, 10);
  assert.deepEqual(free.map(s => s.reservoir), [1, 2, 3, 1, 2, 3, 1, 2, 3, 1]);
  assert.deepEqual(free.map(s => stepsOf(s, "falcon").length), [0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  // a falcon never fires after the last free spin
  const last = __cezeriTest.play(SEED, 100, "standard", scenario("standard", [V30, V30, V30, A30], NOWIN, {}));
  assert.equal(stepsOf(last.spins.at(-1)!, "falcon").length, 0);
  // the falcon places at most the free slices of a ring: all-wild boards do not break it
  const dense = __cezeriTest.play(SEED, 100, "standard", { ...scenario("standard", [V30, V30, V30, A30], NOWIN, { falconCount: [[3, 1]] }), maxFreeSpins: 60 });
  assert.ok(dense.spins.length >= 11);
});

test("cap: 10000 x bet ends the round at once and zeroes the free spins left", () => {
  const rich = __cezeriTest.play(SEED, 100, "standard", { ...scenario("standard", [A30, A30, A30, B30], [A30, A30, A30, A30]), paytable: richPay });
  assert.equal(rich.capped, true);
  assert.equal(rich.totalHundredths, 1_000_000);
  assert.equal(rich.payoutCents, 100 * 10_000);
  assert.equal(rich.spins.length, 1);
  assert.ok(rich.spins[0]!.winHundredths > 1_000_000, "the spin's raw win is above the cap");
  assert.equal(rich.spins[0]!.totalHundredthsAfter, 1_000_000);
  for (const bet of CEZERI_BET_LEVELS_CENTS) assert.equal(__cezeriTest.play(SEED, bet, "standard", { ...scenario("standard", [A30, A30, A30, B30], [A30, A30, A30, A30]), paytable: richPay }).payoutCents, bet * 10_000);
  // a small cap on the trigger spin: 10 free spins are never played
  const small = __cezeriTest.play(SEED, 100, "standard", { ...scenario("standard", [V30, V30, V30, A30], [A30, A30, A30, B30]), capHundredths: 3000 });
  assert.equal(small.capped, true);
  assert.equal(small.totalHundredths, 3000);
  assert.equal(small.spins.length, 1);
  assert.equal(small.spins[0]!.freeSpinsAwarded, 10);
  assert.equal(small.spins[0]!.freeSpinsLeft, 0);
  assert.equal(small.freeSpinsTriggered, true);
  // cap hit inside the feature
  const inFree = __cezeriTest.play(SEED, 100, "standard", { ...scenario("standard", [V30, V30, V30, A30], [A30, A30, A30, B30]), capHundredths: 5000 + FIRST_SPIN });
  assert.equal(inFree.capped, true);
  assert.equal(inFree.totalHundredths, 5000 + FIRST_SPIN);
  assert.ok(inFree.spins.length >= 2 && inFree.spins.length < 11);
  assert.equal(inFree.spins.at(-1)!.freeSpinsLeft, 0);
  // exactly below the cap is not capped
  const below = __cezeriTest.play(SEED, 100, "standard", { ...scenario("standard", [A30, A30, A30, B30], [A30, A30, A30, A30]), capHundredths: 8641 });
  assert.equal(below.capped, false);
  assert.equal(below.totalHundredths, FIRST_SPIN);
  const exact = __cezeriTest.play(SEED, 100, "standard", { ...scenario("standard", [A30, A30, A30, B30], [A30, A30, A30, A30]), capHundredths: FIRST_SPIN });
  assert.equal(exact.capped, true);
  for (const seed of seeds(3000, "99999999999999999999999999999999")) {
    const round = playCezeriRound(seed, 100, "buy");
    assert.ok(round.totalHundredths <= 1_000_000);
    if (!round.capped) assert.ok(round.totalHundredths < 1_000_000); else assert.equal(round.totalHundredths, 1_000_000);
  }
});

test("buy mode guarantees the feature: >= 3 vessels after the chain, forged on slices outside winning runs, 10 free spins always", () => {
  let forgedRounds = 0, naturalRounds = 0;
  for (const seed of seeds(3000, "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0")) {
    const round = playCezeriRound(seed, 100, "buy");
    const base = round.spins[0]!;
    assert.equal(round.freeSpinsTriggered, true);
    assert.ok(base.vesselCount >= 3);
    assert.ok(base.freeSpinsAwarded === 10 || round.capped);
    const [scatter] = stepsOf(base, "scatter");
    assert.ok(scatter, "a scatter step is always present in buy mode");
    const lastRotate = stepsOf(base, "rotate").at(-1)!;
    const natural = countSymbol(lastRotate.board, "vessel");
    assert.equal(scatter!.forged.length, Math.max(0, 3 - natural));
    assert.equal(base.vesselCount, Math.max(3, natural));
    const winning = new Set(stepsOf(base, "win").flatMap(w => w.cells.map(([r, k]) => `${r},${k}`)));
    for (const [r, k] of scatter!.forged) { assert.equal(base.board[r]![k], "vessel"); assert.equal(lastRotate.board[r]![k] !== "vessel", true); assert.ok(!winning.has(`${r},${k}`), "forged slice is not in a winning run"); }
    if (scatter!.forged.length) forgedRounds++; else naturalRounds++;
    assert.ok(round.spins.length >= 2 || round.capped);
    // standard and ante never forge
    for (const mode of ["standard", "ante"] as const) for (const step of stepsOf(playCezeriRound(seed, 100, mode).spins[0]!, "scatter")) assert.deepEqual(step.forged, []);
  }
  assert.ok(forgedRounds > 2000 && naturalRounds > 0, `${forgedRounds} forged, ${naturalRounds} natural`);
  // forge order: slices outside winning runs first, winning-run slices only when those are used up
  const dense = __cezeriTest.play(SEED, 100, "buy", { tables: { buy: { base: [A30, A30, A30, B30].map(s => ring(s)), respin: [A30, A30, A30, B30].map(s => ring(s)), hubBase: [[3, 1]] } }, buyMinVessels: 14 });
  const forged = stepsOf(dense.spins[0]!, "scatter")[0]!.forged;
  assert.equal(forged.length, 14);
  assert.ok(forged.slice(0, 12).every(([r]) => r === 3), "the 12 quiet ring-3 slices go first");
  assert.ok(forged.slice(12).every(([r]) => r < 3));
  assert.equal(new Set(forged.map(([r, k]) => r * 12 + k)).size, 14);
  // the natural case: 3+ vessels already there, nothing forged, no extra draws
  const natural = __cezeriTest.play(SEED, 100, "buy", scenario("buy", [V30, V30, A30, B30], [A30, B30, C30, "D".repeat(30)]));
  assert.deepEqual(stepsOf(natural.spins[0]!, "scatter")[0]!.forged, []);
});

test("ante: the feature comes about twice as often as in standard mode; buying is the only mode priced at 100 x", () => {
  const counts: Record<string, number> = { standard: 0, ante: 0 };
  const n = 400_000;
  for (const mode of ["standard", "ante"] as const) {
    const play = __cezeriTest.player();
    const rng = __cezeriTest.createRng(`ant3${mode === "ante" ? "0" : "1"}000000000000000000000000000`.slice(0, 32).padEnd(32, "0"));
    for (let i = 0; i < n; i++) if (play(cezeriSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])), 100, mode).freeSpinsTriggered) counts[mode]!++;
  }
  const ratio = counts.ante! / counts.standard!;
  assert.ok(ratio > 1.55 && ratio < 2.3, `ante/standard feature ratio ${ratio} (${counts.ante}/${counts.standard})`);
  assert.ok(counts.standard! / n > 1 / 600 && counts.standard! / n < 1 / 250, `standard feature rate ${counts.standard! / n}`);
});

test("structure invariants: totals, free-spin accounting, step grammar for every mode", () => {
  for (const [i, seed] of seeds(900, "dd00dd00dd00dd00dd00dd00dd00dd00").entries()) {
    const mode = MODES[i % 3]!;
    const round = playCezeriRound(seed, 100, mode);
    assert.equal(round.spins[0]!.kind, "base");
    assert.ok(round.spins.slice(1).every(s => s.kind === "free"));
    round.spins.forEach((s, k) => assert.equal(s.index, k));
    assert.equal(round.spins.filter(s => s.kind === "base").length, 1);
    assert.equal(round.freeSpinsTriggered, round.spins[0]!.freeSpinsAwarded > 0 || (round.capped && round.spins[0]!.vesselCount >= 3));
    if (round.spins.length > 1) assert.equal(round.freeSpinsTriggered, true);
    for (const s of round.spins) {
      assert.ok(Number.isSafeInteger(s.winHundredths) && s.winHundredths >= 0);
      assert.ok(s.rotations >= 1 && s.rotations <= CEZERI_MAX_RESPINS + 1 && s.respins === s.rotations - 1);
      assert.ok(s.freeSpinsLeft >= 0);
      assert.ok(s.hubStart >= 1 && s.hubEnd === s.hubStart + s.respins);
    }
    if (mode === "buy") assert.equal(round.freeSpinsTriggered, true);
  }
});

test("CEZERI_RTP equals the simulation evidence and the evidence matches the engine source", () => {
  const dir = fileURLToPath(new URL("../../../ops/evidence/cezeri-20261012/", import.meta.url));
  const evidence = JSON.parse(readFileSync(`${dir}rtp.json`, "utf8")) as {
    engine: string; engineSourceSha256: string; tuningOverride: unknown; seed: string; modes: Record<CezeriMode, {
      rounds: number; rtpVsCost: { pointEstimate: number; ci95: [number, number] }; hitRate: number; featureRate: number; stdDevPerRoundCostUnits: number; capHits: number;
      avgFreeSpinsPerTrigger: number; maxObservedXBet: number; winTiersShareOfRounds: Record<string, number>; respinChain: { avgRespinsPerWinningBaseChain: number };
      costMismatches: number; minVesselsOnFirstBaseBoard: number;
    }>;
  };
  assert.equal(evidence.engine, CEZERI_ENGINE_ID);
  assert.equal(evidence.tuningOverride, null, "evidence runs never use a tuning override");
  assert.ok(!evidence.seed.includes("tune"), "evidence seeds are distinct from tuning seeds");
  const source = readFileSync(fileURLToPath(new URL("../src/cezeri.ts", import.meta.url)), "utf8")
    .replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
  assert.equal(createHash("sha256").update(source).digest("hex"), evidence.engineSourceSha256, "engine code changed after the evidence run: rerun the simulation");
  const r3 = (x: number): number => Number(x.toFixed(3));
  for (const mode of MODES) {
    const e = evidence.modes[mode], c = CEZERI_RTP[mode];
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
    assert.ok(e.maxObservedXBet <= 10_000);
  }
  assert.ok(CEZERI_RTP.standard.hitRate >= 0.2 && CEZERI_RTP.standard.hitRate <= 0.32);
  assert.ok(CEZERI_RTP.ante.hitRate >= 0.2 && CEZERI_RTP.ante.hitRate <= 0.32);
  assert.ok(1 / CEZERI_RTP.standard.featureRate >= 250 && 1 / CEZERI_RTP.standard.featureRate <= 450);
  assert.ok(CEZERI_RTP.buy.featureRate === 1 && CEZERI_RTP.ante.featureRate > CEZERI_RTP.standard.featureRate * 1.6);
  assert.ok(evidence.modes.buy.minVesselsOnFirstBaseBoard >= 0);
});
