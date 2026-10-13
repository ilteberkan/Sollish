import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ASENA_BET_LEVELS_CENTS, ASENA_BUY_MIN_SCATTERS, ASENA_COLS, ASENA_COST_FRACTION, ASENA_ENGINE_ID, ASENA_FREE_SPINS_RETRIGGER, ASENA_FREE_SPINS_TRIGGER,
  ASENA_MAP_MULTIPLIERS, ASENA_MAP_SPINS_AT_3, ASENA_MAP_SPINS_AT_6, ASENA_MAX_WIN_MULTIPLIER, ASENA_MIN_CLUSTER, ASENA_MODES, ASENA_MODE_TABLES, ASENA_PAYTABLE,
  ASENA_PAY_SYMBOLS, ASENA_ROWS, ASENA_RTP, ASENA_SCATTER_PAY, ASENA_TEMPLATES, ASENA_TEMPLATE_IDS, ASENA_TIER_COUNT, ASENA_TRANSFORM_COUNT, __asenaTest,
  asenaCostCents, asenaSeedFromEntropy, asenaTemplatePositions, asenaTier, asenaTransformCells, playAsenaRound,
  type AsenaCell, type AsenaGrid, type AsenaMode, type AsenaPaySymbol, type AsenaRound, type AsenaSpin, type AsenaSymbol, type AsenaTemplateId,
} from "../src/asena.ts";
import * as protocol from "../src/index.ts";

const SEED = "0123456789abcdef0123456789abcdef";
const MODES = ASENA_MODES;
const BET_CAP = ASENA_MAX_WIN_MULTIPLIER * 100;
function seeds(count: number, label = "f00dcafe00112233445566778899aab"): string[] {
  const rng = __asenaTest.createRng(label);
  return Array.from({ length: count }, () => asenaSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
const cellsOf = (grid: AsenaGrid): AsenaCell[] => grid.flat();
const count = (grid: AsenaGrid, symbol: AsenaSymbol): number => cellsOf(grid).filter(cell => cell.symbol === symbol).length;
const finalGrid = (spin: AsenaSpin): AsenaGrid => spin.steps.at(-1)!.grid;
/** A board whose cells never form a cluster: neighbours differ and h1 / h2 never appear (tests draw their shapes with h1 and h2). */
const filler = (c: number, r: number): AsenaSymbol => ASENA_PAY_SYMBOLS[2 + ((c + 2 * r) % 6)]!;
const board = (fn: (col: number, row: number) => AsenaSymbol | undefined): AsenaGrid =>
  Array.from({ length: 6 }, (_, c) => Array.from({ length: 6 }, (_, r): AsenaCell => ({ id: c * 6 + r, symbol: fn(c, r) ?? filler(c, r) })));
const withCells = (cells: readonly (readonly [number, number])[], symbol: AsenaSymbol, extra: Record<string, AsenaSymbol> = {}): AsenaGrid =>
  board((c, r) => extra[`${c},${r}`] ?? (cells.some(([x, y]) => x === c && y === r) ? symbol : undefined));
const idOf = (c: number, r: number): number => c * 6 + r;
const mult = (id: AsenaTemplateId): number => ASENA_TEMPLATES.find(t => t.id === id)!.multiplier;
const TEMPLATE_SHAPES: Record<AsenaTemplateId, string[]> = {
  "kurt-basi": ["X.X", "XXX", ".X.", ".X."],
  yay: ["XX", ".X", ".X", "XX"],
  at: ["XX..", ".X..", ".XXX"],
  kartal: ["X...X", "XXXXX"],
  "hayat-agaci": [".X.", "XXX", ".X.", ".X.", ".X."],
  hilal: ["XX", "X.", "XX"],
};
const zeroPay = Object.fromEntries(ASENA_PAY_SYMBOLS.map(s => [s, [0, 0, 0, 0, 0, 0, 0]])) as never;
const richPay = Object.fromEntries(ASENA_PAY_SYMBOLS.map(s => [s, Array(7).fill(10 ** 7)])) as never;
const onePay = Object.fromEntries(ASENA_PAY_SYMBOLS.map(s => [s, [1, 1, 1, 1, 1, 1, 1]])) as never;

test("engine id, exports and the protocol index re-export", () => {
  assert.equal(ASENA_ENGINE_ID, "asena-stars-1");
  assert.equal(ASENA_MAX_WIN_MULTIPLIER, 5000);
  assert.equal(ASENA_FREE_SPINS_TRIGGER, 10);
  assert.equal(ASENA_FREE_SPINS_RETRIGGER, 3);
  assert.equal(ASENA_BUY_MIN_SCATTERS, 3);
  assert.equal(ASENA_MIN_CLUSTER, 5);
  assert.equal(ASENA_COLS, 6);
  assert.equal(ASENA_ROWS, 6);
  assert.equal(protocol.playAsenaRound, playAsenaRound);
  assert.equal(protocol.asenaCostCents, asenaCostCents);
  assert.equal(protocol.ASENA_RTP, ASENA_RTP);
  assert.equal(protocol.ASENA_TEMPLATES, ASENA_TEMPLATES);
  assert.equal(typeof protocol.playStormRound, "function", "the other engines are still exported");
  assert.deepEqual([...ASENA_MODES], ["standard", "ante", "buy"]);
  assert.deepEqual([...ASENA_BET_LEVELS_CENTS], [100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 40000, 50000]);
  assert.deepEqual(ASENA_SCATTER_PAY, { 3: 300, 4: 800, 5: 6000 });
  assert.deepEqual(ASENA_MAP_MULTIPLIERS, { 3: 2, 6: 3, twice: 5 });
  assert.equal(ASENA_MAP_SPINS_AT_3, 5);
  assert.equal(ASENA_MAP_SPINS_AT_6, 5);
  assert.ok(Object.isFrozen(ASENA_BET_LEVELS_CENTS) && Object.isFrozen(ASENA_MODE_TABLES.ante.base) && Object.isFrozen(ASENA_PAYTABLE.h1) && Object.isFrozen(ASENA_TEMPLATES) && Object.isFrozen(ASENA_TEMPLATES[0]!.cells));
});

test("structure: self-contained pure module (no imports, clock, Math.random, network or I/O)", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/asena.ts", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/^\s*import\s/m.test(source), "no import statements: the evidence covers these bytes only");
  for (const forbidden of ["Math.random", "Date.now", "new Date", "performance.now", "fetch(", "process.", "require("]) assert.ok(!source.includes(forbidden), forbidden);
});

test("same seed, bet and mode give a byte-identical round; seed and mode both change the result", () => {
  for (const mode of MODES) {
    const a = playAsenaRound(SEED, 500, mode), b = playAsenaRound(SEED, 500, mode);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.engine, ASENA_ENGINE_ID);
    assert.equal(a.seedHex, SEED);
    assert.equal(a.mode, mode);
    const distinct = new Set(seeds(40).map(s => JSON.stringify(playAsenaRound(s, 500, mode).spins[0]!.steps[0]!.grid)));
    assert.equal(distinct.size, 40);
    // The bet level never changes the dealt cards, only the payout and cost.
    assert.deepEqual(playAsenaRound(SEED, 100, mode).spins, playAsenaRound(SEED, 50_000, mode).spins);
  }
  assert.notEqual(JSON.stringify(playAsenaRound(SEED, 500, "ante").spins), JSON.stringify(playAsenaRound(SEED, 500, "buy").spins));
});

test("RNG and rules are frozen: a fingerprint of 200 fixed seeds across all modes and bets", () => {
  const rng = __asenaTest.createRng(SEED), again = __asenaTest.createRng(SEED);
  const first = Array.from({ length: 6 }, () => rng());
  assert.deepEqual(first, Array.from({ length: 6 }, () => again()));
  assert.ok(first.every(x => Number.isInteger(x) && x >= 0 && x < 2 ** 32));
  const other = __asenaTest.createRng("ffffffffffffffffffffffffffffffff");
  assert.notDeepEqual(first, Array.from({ length: 6 }, () => other()));
  // Any change of RNG, draw order, tables or rules changes this hash (a new behavior needs a new engine id).
  const bets = [100, 200, 50_000, 4000], hash = createHash("sha256");
  for (let i = 0; i < 200; i++) {
    const seed = createHash("sha256").update(`asena-stars-1-frozen:${i}`).digest("hex").slice(0, 32);
    hash.update(JSON.stringify(playAsenaRound(seed, bets[i % 4]!, MODES[i % 3]!)));
  }
  assert.equal(hash.digest("hex"), "FINGERPRINT");
});

test("input validation throws RangeError for seed, bet level and mode", () => {
  for (const bad of ["", "0123456789ABCDEF0123456789ABCDEF", SEED.slice(1), SEED + "0", "g".repeat(32), 123 as unknown as string, undefined as unknown as string]) {
    assert.throws(() => playAsenaRound(bad, 100, "standard"), RangeError, String(bad));
  }
  for (const bad of [0, 99, 101, 150, 450, 600, 9999, 50_001, 100.5, -100, Number.NaN, Number.POSITIVE_INFINITY, "100" as unknown as number, 100n as unknown as number, null as unknown as number, undefined as unknown as number]) {
    for (const mode of MODES) {
      assert.throws(() => playAsenaRound(SEED, bad, mode), RangeError, String(bad));
      assert.throws(() => asenaCostCents(bad, mode), RangeError, String(bad));
    }
  }
  for (const bad of ["", "Standard", "free", "bonus", null, undefined, 1, {}, "constructor", "__proto__"] as unknown as AsenaMode[]) {
    assert.throws(() => playAsenaRound(SEED, 100, bad), RangeError, String(bad));
    assert.throws(() => asenaCostCents(100, bad), RangeError, String(bad));
  }
  assert.throws(() => asenaSeedFromEntropy(new Uint32Array(3)), RangeError);
  assert.throws(() => asenaTransformCells(ASENA_TEMPLATES[0]!.cells, 8), RangeError);
  assert.throws(() => asenaTransformCells(ASENA_TEMPLATES[0]!.cells, -1), RangeError);
  assert.throws(() => asenaTemplatePositions("nope" as never, 0, 0, 0), RangeError);
  for (const bet of ASENA_BET_LEVELS_CENTS) for (const mode of MODES) assert.doesNotThrow(() => playAsenaRound(SEED, bet, mode));
});

test("cost arithmetic: standard = bet, ante = bet * 5 / 4, buy = bet * 80, always an integer", () => {
  assert.deepEqual(ASENA_COST_FRACTION.ante, [5, 4]);
  assert.deepEqual(ASENA_COST_FRACTION.buy, [80, 1]);
  for (const bet of ASENA_BET_LEVELS_CENTS) {
    assert.equal(bet % 4, 0, `${bet} divisible by 4`);
    assert.equal(asenaCostCents(bet, "standard"), bet);
    assert.equal(asenaCostCents(bet, "ante"), (bet / 4) * 5);
    assert.equal(asenaCostCents(bet, "buy"), bet * 80);
    for (const mode of MODES) {
      assert.ok(Number.isSafeInteger(asenaCostCents(bet, mode)));
      const round = playAsenaRound(SEED, bet, mode);
      assert.equal(round.costCents, asenaCostCents(bet, mode));
      assert.equal(round.betCents, bet);
    }
  }
  assert.equal(asenaCostCents(100, "ante"), 125);
  assert.equal(asenaCostCents(50_000, "buy"), 4_000_000);
});

test("payout is floor(bet * hundredths / 100) in every mode and never exceeds 5000 x bet", () => {
  for (const [i, seed] of seeds(2400).entries()) {
    const bet = ASENA_BET_LEVELS_CENTS[i % ASENA_BET_LEVELS_CENTS.length]!, mode = MODES[i % 3]!;
    const round = playAsenaRound(seed, bet, mode);
    assert.equal(round.payoutCents, Number(BigInt(bet) * BigInt(round.totalHundredths) / 100n));
    assert.ok(round.payoutCents <= bet * 5000);
    assert.equal(round.totalHundredths, round.spins.at(-1)!.totalHundredthsAfter);
    assert.equal(round.payoutCents, (bet / 100) * round.totalHundredths);
  }
});

test("constellation templates: six original shapes of 5-7 cells, multipliers x2..x10, 8 transforms with known vectors", () => {
  assert.deepEqual([...ASENA_TEMPLATE_IDS], ["kurt-basi", "yay", "at", "kartal", "hayat-agaci", "hilal"]);
  assert.equal(ASENA_TRANSFORM_COUNT, 8);
  const keys = new Set<string>();
  for (const [index, template] of ASENA_TEMPLATES.entries()) {
    assert.ok(template.cells.length >= 5 && template.cells.length <= 7, template.id);
    assert.ok(template.multiplier >= 2 && template.multiplier <= 10, template.id);
    assert.equal(new Set(template.cells.map(c => c.join(","))).size, template.cells.length, "no repeated cell");
    assert.equal(Math.min(...template.cells.map(c => c[0])), 0);
    assert.equal(Math.min(...template.cells.map(c => c[1])), 0);
    assert.equal(template.width, Math.max(...template.cells.map(c => c[0])) + 1);
    assert.equal(template.height, Math.max(...template.cells.map(c => c[1])) + 1);
    assert.ok(template.width <= 6 && template.height <= 6);
    // the drawing in the file header, cell by cell
    const drawn = TEMPLATE_SHAPES[template.id].flatMap((line, y) => [...line].flatMap((ch, x) => (ch === "X" ? [`${x},${y}`] : [])));
    assert.deepEqual(template.cells.map(c => c.join(",")).sort(), drawn.sort(), template.id);
    // orthogonally connected, so a cluster can contain it
    const set = new Set(template.cells.map(c => c.join(",")));
    const seen = new Set<string>([template.cells[0]!.join(",")]), stack = [template.cells[0]!];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const key = `${x! + dx!},${y! + dy!}`; if (set.has(key) && !seen.has(key)) { seen.add(key); stack.push([x! + dx!, y! + dy!]); } }
    }
    assert.equal(seen.size, template.cells.length, `${template.id} is connected`);
    // distinct normalised shapes under the 8 transforms: 8 for the chiral horse, 4 for the symmetric ones; no two templates share a shape
    const shapes = new Set<string>();
    for (let t = 0; t < 8; t++) {
      const cells = asenaTransformCells(template.cells, t);
      assert.equal(cells.length, template.cells.length);
      assert.equal(Math.min(...cells.map(c => c[0])), 0);
      assert.equal(Math.min(...cells.map(c => c[1])), 0);
      shapes.add(cells.map(c => c.join(",")).join(";"));
    }
    assert.equal(shapes.size, template.id === "at" ? 8 : 4, template.id);
    for (const s of shapes) { assert.ok(!keys.has(s), `${template.id} shares a shape with another template`); keys.add(s); }
    assert.ok(index < 6);
  }
  assert.deepEqual(ASENA_TEMPLATES.map(t => t.multiplier), [10, 3, 4, 6, 8, 2]);
  // transform 0 is the identity (sorted by row, then column)
  assert.deepEqual(asenaTransformCells(ASENA_TEMPLATES[2]!.cells, 0), [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2], [3, 2]]);
  // known vectors for the horse (x right, y down): mirror, rotate 90 / 180 / 270 clockwise, and mirrored rotations
  const at = ASENA_TEMPLATES[2]!.cells;
  assert.deepEqual(asenaTransformCells(at, 1), [[2, 0], [3, 0], [2, 1], [0, 2], [1, 2], [2, 2]]);
  assert.deepEqual(asenaTransformCells(at, 2), [[2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [0, 3]]);
  assert.deepEqual(asenaTransformCells(at, 4), [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [3, 2]]);
  assert.deepEqual(asenaTransformCells(at, 5), [[1, 0], [2, 0], [3, 0], [1, 1], [0, 2], [1, 2]]);
  // mirror twice is the identity; rotating four times is the identity
  for (const t of ASENA_TEMPLATES) {
    assert.deepEqual(asenaTransformCells(asenaTransformCells(t.cells, 1), 1), asenaTransformCells(t.cells, 0));
    let cells: readonly (readonly [number, number])[] = t.cells;
    for (let k = 0; k < 4; k++) cells = asenaTransformCells(cells, 2);
    assert.deepEqual(cells, asenaTransformCells(t.cells, 0));
  }
  // placement on the board
  assert.deepEqual(asenaTemplatePositions("hilal", 0, 3, 2), [[3, 2], [4, 2], [3, 3], [3, 4], [4, 4]]);
  assert.deepEqual(asenaTemplatePositions("at", 2, 1, 1), [[3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [1, 4]]);
});

test("cluster detection: 5+ orthogonal cells of one symbol; 4 cells, diagonals and a dead board pay nothing", () => {
  assert.deepEqual(__asenaTest.findClusters(board(() => undefined)), [], "the filler board has no cluster");
  const line5 = __asenaTest.findClusters(withCells([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], "h1"));
  assert.equal(line5.length, 1);
  assert.equal(line5[0]!.symbol, "h1");
  assert.equal(line5[0]!.size, 5);
  assert.deepEqual(line5[0]!.cells, [0, 1, 2, 3, 4].map(c => idOf(c, 0)));
  assert.equal(line5[0]!.basePayHundredths, ASENA_PAYTABLE.h1[0]);
  assert.equal(line5[0]!.templateMultiplier, 1, "a straight line contains no constellation");
  assert.equal(line5[0]!.payHundredths, ASENA_PAYTABLE.h1[0]);
  assert.equal(line5[0]!.constellation, null);
  assert.deepEqual(__asenaTest.findClusters(withCells([[0, 0], [1, 0], [2, 0], [3, 0]], "h1")), [], "4 cells");
  assert.deepEqual(__asenaTest.findClusters(withCells([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]], "h1")), [], "5 cells on a diagonal do not connect");
  assert.deepEqual(__asenaTest.findClusters(withCells([[0, 0], [1, 0], [2, 0], [4, 0], [5, 0]], "h1")), [], "a gap splits the line");
  // a column and a bend connect
  const bend = __asenaTest.findClusters(withCells([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], "h1"));
  assert.equal(bend.length, 1);
  assert.equal(bend[0]!.size, 5);
  // moons are never part of a cluster and separate cells
  assert.deepEqual(__asenaTest.findClusters(withCells([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], "h1", { "2,0": "moon" })), []);
});

test("cluster pay tiers: sizes 5, 6, 7, 8-9, 10-12, 13-17, 18+ read the pay table; sizes are measured including wilds", () => {
  assert.equal(ASENA_TIER_COUNT, 7);
  assert.deepEqual([5, 6, 7, 8, 9, 10, 12, 13, 17, 18, 36].map(asenaTier), [0, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  for (const symbol of ASENA_PAY_SYMBOLS) {
    const row = ASENA_PAYTABLE[symbol];
    assert.equal(row.length, 7);
    for (let t = 1; t < 7; t++) assert.ok(row[t]! > row[t - 1]!, `${symbol} tier ${t}`);
  }
  for (let i = 1; i < ASENA_PAY_SYMBOLS.length; i++) for (let t = 0; t < 7; t++) assert.ok(ASENA_PAYTABLE[ASENA_PAY_SYMBOLS[i - 1]!][t]! > ASENA_PAYTABLE[ASENA_PAY_SYMBOLS[i]!][t]!, `${ASENA_PAY_SYMBOLS[i - 1]} > ${ASENA_PAY_SYMBOLS[i]} tier ${t}`);
  for (let n = 5; n <= 24; n++) {
    const cells: [number, number][] = [];
    for (let i = 0; i < n; i++) cells.push([Math.floor(i / 6), i % 6]);
    const clusters = __asenaTest.findClusters(withCells(cells, "h1"), { templateMultipliers: [1, 1, 1, 1, 1, 1] });
    assert.equal(clusters.length, 1, `n=${n}`);
    assert.equal(clusters[0]!.size, n);
    assert.equal(clusters[0]!.basePayHundredths, ASENA_PAYTABLE.h1[asenaTier(n)]);
  }
  // a whole board of one symbol is one cluster of 36
  const all = __asenaTest.findClusters(board(() => "h1"));
  assert.equal(all.length, 1);
  assert.equal(all[0]!.size, 36);
});

test("wild wolf and trail: substitute for every symbol, bridge clusters, count towards the size, never form a cluster alone", () => {
  // one wolf at (2,2): left and up arms of h1, right and down arms of h2 -> two clusters of 5 sharing the wolf
  const arms = board((c, r) => {
    if (c === 2 && r === 2) return "wolf";
    if ((c === 1 || c === 0) && r === 2) return "h1";
    if (c === 2 && (r === 1 || r === 0)) return "h1";
    if ((c === 3 || c === 4) && r === 2) return "h2";
    if (c === 2 && (r === 3 || r === 4)) return "h2";
    return undefined;
  });
  const both = __asenaTest.findClusters(arms);
  assert.deepEqual(both.map(c => [c.symbol, c.size]), [["h1", 5], ["h2", 5]], "the wolf pays in both clusters, symbols in table order");
  for (const cluster of both) assert.ok(cluster.cells.includes(idOf(2, 2)));
  // a trail wild behaves the same
  const trail = board((c, r) => (c === 2 && r === 2 ? "trail" : (c === 1 || c === 0) && r === 2 ? "h2" : c === 2 && (r === 1 || r === 0) ? "h2" : undefined));
  assert.deepEqual(__asenaTest.findClusters(trail).map(c => [c.symbol, c.size]), [["h2", 5]]);
  // the wolf bridges two h1 groups of 2 and 2 into a cluster of 5
  const bridge = withCells([[0, 0], [1, 0], [3, 0], [4, 0]], "h1", { "2,0": "wolf" });
  assert.deepEqual(__asenaTest.findClusters(bridge).map(c => [c.symbol, c.size]), [["h1", 5]]);
  // wolves alone, walled in by moons: no cluster (a cluster needs at least one real symbol)
  const walled = board((c, r) => ((c === 0 && r <= 2) || (c === 1 && r <= 1) ? "wolf" : (c === 2 && r <= 1) || (c === 1 && r === 2) || (c === 0 && r === 3) ? "moon" : undefined));
  assert.equal(count(walled, "wolf"), 5);
  assert.deepEqual(__asenaTest.findClusters(walled), []);
  // an unwalled wolf network plus one touching symbol is a cluster of 6
  const open = board((c, r) => ((c === 0 && r <= 2) || (c === 1 && r <= 1) ? "wolf" : undefined));
  assert.equal(__asenaTest.findClusters(open).length > 0, true);
});

test("cluster order: symbols in table order, then lowest cell index; separate clusters of one symbol are separate wins", () => {
  const grid = board((c, r) => {
    if (c <= 4 && r === 0) return "h1";
    if (c <= 4 && r === 5) return "h2";
    if (c === 5 && r >= 1) return "h1";
    return undefined;
  });
  const clusters = __asenaTest.findClusters(grid);
  assert.deepEqual(clusters.map(c => [c.symbol, c.size, c.cells[0]]), [["h1", 5, idOf(0, 0)], ["h1", 5, idOf(5, 1)], ["h2", 5, idOf(0, 5)]]);
  assert.ok(clusters.every(c => c.cells.every((id, i) => i === 0 || id > c.cells[i - 1]!)), "cells sorted by index");
});

test("constellations: every template under all 8 transforms and several origins is found inside a cluster (known vectors)", () => {
  for (const template of ASENA_TEMPLATES) {
    for (let transform = 0; transform < 8; transform++) {
      const expected = asenaTransformCells(template.cells, transform);
      const w = Math.max(...expected.map(c => c[0])) + 1, h = Math.max(...expected.map(c => c[1])) + 1;
      for (const [col, row] of [[0, 0], [6 - w, 6 - h], [Math.min(1, 6 - w), Math.min(2, 6 - h)]] as const) {
        const positions = asenaTemplatePositions(template.id, transform, col, row);
        const clusters = __asenaTest.findClusters(withCells(positions, "h1"));
        assert.equal(clusters.length, 1, `${template.id} t${transform} @${col},${row}`);
        const c = clusters[0]!;
        assert.equal(c.size, template.cells.length);
        assert.ok(c.constellation, `${template.id} t${transform} @${col},${row} ignites`);
        // the best template of the exact shape: the shape itself, or a higher-multiplier template (never lower)
        assert.equal(c.constellation!.templateId, template.id);
        assert.equal(c.templateMultiplier, template.multiplier);
        assert.equal(c.payHundredths, ASENA_PAYTABLE.h1[asenaTier(template.cells.length)]! * template.multiplier);
        // the reported transform is the lowest one with this normalised shape, and the reported cells are exactly the placed ones
        const reported = asenaTransformCells(template.cells, c.constellation!.transform);
        assert.deepEqual(reported, expected);
        for (let lower = 0; lower < c.constellation!.transform; lower++) assert.notDeepEqual(asenaTransformCells(template.cells, lower), expected);
        assert.deepEqual(c.constellation!.origin, [col, row]);
        assert.deepEqual(c.constellation!.positions.map(p => p.join(",")).sort(), positions.map(p => p.join(",")).sort());
        assert.deepEqual([...c.constellation!.cells].sort((a, b) => a - b), [...c.cells]);
      }
    }
  }
});

test("constellations: near misses do not ignite, bigger clusters containing a shape do, the best multiplier wins, ties go to the lowest index", () => {
  // each template with one cell moved away (dead cell instead): no ignition for that template
  for (const template of ASENA_TEMPLATES) {
    const positions = asenaTemplatePositions(template.id, 0, 0, 0);
    for (let drop = 0; drop < positions.length; drop++) {
      const rest = positions.filter((_, i) => i !== drop);
      const found = __asenaTest.matchPositions(rest);
      if (found) assert.notEqual(found.templateId, template.id, `${template.id} minus cell ${drop}`);
    }
  }
  // exact pentomino lines and blocks are not constellations
  assert.equal(__asenaTest.matchPositions([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]), null);
  assert.equal(__asenaTest.matchPositions([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]), null, "P pentomino");
  // a plus sign alone (5 cells) is not the tree of life (it needs the 2-cell trunk extension)
  assert.equal(__asenaTest.matchPositions([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]), null);
  // the whole board contains everything: the highest multiplier (wolf head) at transform 0, anchored top-left
  const all = __asenaTest.findClusters(board(() => "h1"))[0]!;
  assert.equal(all.constellation!.templateId, "kurt-basi");
  assert.equal(all.constellation!.transform, 0);
  assert.deepEqual(all.constellation!.origin, [0, 0]);
  assert.equal(all.templateMultiplier, 10);
  // a wolf head also contains the crescent (U shape): the higher multiplier wins; swapping the multipliers swaps the winner
  const head = asenaTemplatePositions("kurt-basi", 0, 1, 1);
  assert.equal(__asenaTest.matchPositions(head)!.templateId, "kurt-basi");
  assert.equal(__asenaTest.matchPositions(head, { templateMultipliers: [2, 3, 4, 6, 8, 10] })!.templateId, "hilal");
  // equal multipliers: the lowest template index
  assert.equal(__asenaTest.matchPositions(head, { templateMultipliers: [5, 5, 5, 5, 5, 5] })!.templateId, "kurt-basi");
  // the first anchor in row-major order is reported: a crescent drawn twice (rows 0-2 at columns 0 and 3), the upper-left one wins
  const twice = __asenaTest.matchPositions([...asenaTemplatePositions("hilal", 0, 3, 0), ...asenaTemplatePositions("hilal", 0, 0, 3)]);
  assert.deepEqual(twice!.origin, [3, 0]);
  // ignition inside a bigger cluster: an extra cell touching the template does not matter
  const bigger = withCells([...asenaTemplatePositions("yay", 3, 0, 0), [3, 0], [3, 1], [4, 1]], "h2");
  const bc = __asenaTest.findClusters(bigger).find(c => c.symbol === "h2")!;
  assert.ok(bc.size > 6 && bc.constellation !== null, "a cluster larger than the template still contains it");
  // template cells may use wilds
  const wild = board((c, r) => {
    const t = asenaTemplatePositions("at", 6, 1, 1).some(([x, y]) => x === c && y === r);
    return t ? ((c + r) % 3 === 0 ? "wolf" : "h2") : undefined;
  });
  const wc = __asenaTest.findClusters(wild).find(c => c.symbol === "h2");
  assert.ok(wc && wc.constellation?.templateId === "at", "wilds count as cluster cells for the templates");
});

test("constellation ignition multiplies only that cluster's pay and uses cluster pay x template multiplier", () => {
  // crescent in h1 (x2) and an unrelated line of 5 in h2 on one board
  const grid = board((c, r) => {
    if (asenaTemplatePositions("hilal", 0, 0, 0).some(([x, y]) => x === c && y === r)) return "h1";
    if (c <= 4 && r === 5) return "h2";
    return undefined;
  });
  const clusters = __asenaTest.findClusters(grid);
  const h1 = clusters.find(c => c.symbol === "h1")!, h2 = clusters.find(c => c.symbol === "h2")!;
  assert.equal(h1.templateMultiplier, 2);
  assert.equal(h1.payHundredths, ASENA_PAYTABLE.h1[0]! * 2);
  assert.equal(h2.templateMultiplier, 1);
  assert.equal(h2.payHundredths, ASENA_PAYTABLE.h2[0]);
});

// --- Wolf walk -------------------------------------------------------------------------------------------
const symbolsOf = (grid: AsenaGrid): string => grid.map(column => column.map(cell => cell.symbol).join(",")).join("|");
const walkBoard = (wolves: readonly (readonly [number, number])[], extra: Record<string, AsenaSymbol> = {}): AsenaGrid =>
  board((c, r) => extra[`${c},${r}`] ?? (wolves.some(([x, y]) => x === c && y === r) ? "wolf" : undefined));

test("wolf walk: one orthogonal step, always on the board, leaves a trail wild, overwrites the entered cell, never enters a moon or a wolf", () => {
  const moves = new Set<string>();
  for (const seed of seeds(120, "1111aaaa2222bbbb3333cccc4444dddd")) {
    // corner wolf: only right and down exist
    const grid = walkBoard([[0, 0]]);
    const { grid: next, walks } = __asenaTest.walk(grid, [idOf(0, 0)], seed, 5000);
    assert.equal(walks.length, 1);
    const w = walks[0]!;
    assert.deepEqual(w.from, [0, 0]);
    assert.ok((w.to[0] === 1 && w.to[1] === 0) || (w.to[0] === 0 && w.to[1] === 1), `corner wolf moved to ${w.to}`);
    moves.add(w.to.join(","));
    assert.deepEqual(w.path, [w.from, w.to]);
    assert.equal(w.id, idOf(0, 0));
    assert.deepEqual(w.trail, { id: 5000, col: 0, row: 0 });
    assert.equal(w.consumed.id, grid[w.to[0]]![w.to[1]]!.id);
    assert.equal(w.consumed.symbol, grid[w.to[0]]![w.to[1]]!.symbol);
    assert.deepEqual(next[0]![0], { id: 5000, symbol: "trail" });
    assert.deepEqual(next[w.to[0]]![w.to[1]], { id: idOf(0, 0), symbol: "wolf" });
    assert.equal(cellsOf(next).length, 36);
    assert.equal(count(next, "wolf"), 1);
    assert.equal(count(next, "trail"), 1);
    assert.equal(symbolsOf(grid), symbolsOf(walkBoard([[0, 0]])), "the input board is not mutated");
  }
  assert.deepEqual([...moves].sort(), ["0,1", "1,0"], "both legal directions happen");
  // walled in by moons and a second wolf: no legal target, no walk, no random draw
  const stuck = walkBoard([[0, 0], [1, 0]], { "0,1": "moon" });
  assert.deepEqual(__asenaTest.walk(stuck, [idOf(0, 0)], SEED).walks, [], "wolf at (0,0) has a moon below and a wolf to the right");
  assert.equal(__asenaTest.walk(stuck, [idOf(0, 0)], SEED).grid, stuck, "nothing changed: the same board object");
  // interior wolf: targets are the 4 neighbours except moons / wolves / off-board, trails are allowed
  const seen = new Set<string>();
  for (const seed of seeds(200, "5555eeee6666ffff7777000088881111")) {
    const grid = walkBoard([[3, 3], [4, 3]], { "3,2": "moon", "3,4": "trail" });
    const { walks } = __asenaTest.walk(grid, [idOf(3, 3)], seed);
    assert.equal(walks.length, 1);
    seen.add(walks[0]!.to.join(","));
  }
  assert.deepEqual([...seen].sort(), ["2,3", "3,4"], "up is a moon, right is a wolf: left and the trail below remain");
  // a wolf that is not asked to walk never moves
  const idle = walkBoard([[2, 2], [4, 4]]);
  const only = __asenaTest.walk(idle, [idOf(4, 4)], SEED);
  assert.equal(only.walks.length, 1);
  assert.equal(only.walks[0]!.id, idOf(4, 4));
  assert.equal(only.grid[2]![2]!.symbol, "wolf");
});

test("wolf walk: several wolves move in column-major order and see each other's changes; a stuck wolf draws nothing", () => {
  for (const seed of seeds(80, "9999aaaa8888bbbb7777cccc6666dddd")) {
    const grid = walkBoard([[1, 1], [2, 1], [1, 2]]);
    const { grid: next, walks } = __asenaTest.walk(grid, [idOf(1, 1), idOf(2, 1), idOf(1, 2)], seed, 7000);
    assert.deepEqual(walks.map(w => w.id), [idOf(1, 1), idOf(1, 2), idOf(2, 1)], "column-major position order: (1,1), (1,2), (2,1)");
    assert.deepEqual(walks.map(w => w.trail.id), [7000, 7001, 7002]);
    assert.equal(count(next, "wolf"), 3, "no wolf is ever overwritten or lost");
    assert.equal(count(next, "trail"), 3 - walks.filter(w => w.consumed.symbol === "trail").length);
    assert.equal(cellsOf(next).length, 36);
    assert.equal(new Set(cellsOf(next).map(c => c.id)).size, 36, "every walk swaps one consumed cell for one fresh trail id: ids stay unique");
  }
  // A walled-in wolf consumes no randomness: the other wolf moves exactly as if it walked alone.
  const stuckBoard = walkBoard([[0, 0], [4, 4]], { "1,0": "moon", "0,1": "moon" });
  for (const seed of seeds(30, "abababababababababababababababab")) {
    const both = __asenaTest.walk(stuckBoard, [idOf(0, 0), idOf(4, 4)], seed);
    const alone = __asenaTest.walk(stuckBoard, [idOf(4, 4)], seed);
    assert.equal(both.walks.length, 1);
    assert.deepEqual(both.walks[0], alone.walks[0]);
  }
});

function stepsOf(round: AsenaRound): { spin: AsenaSpin; k: number }[] { return round.spins.flatMap(spin => spin.steps.map((_, k) => ({ spin, k }))); }

test("engine rounds: wolf walks and trail wilds follow the rules, trails persist only inside their spin", () => {
  let walks = 0, trailsKept = 0, trailsUsed = 0, spinsWithTrailAtEnd = 0, multiWalkSteps = 0;
  for (const mode of MODES) {
    for (const seed of seeds(mode === "buy" ? 400 : 3000, `c0ffee00c0ffee00c0ffee00c0ffee0${MODES.indexOf(mode)}`)) {
      const round = playAsenaRound(seed, 100, mode);
      const trailIdsBySpin: Set<number>[] = [];
      for (const spin of round.spins) {
        const first = spin.steps[0]!.grid;
        assert.equal(count(first, "trail"), 0, "a spin starts without trail wilds");
        const wolvesAtStart = count(first, "wolf");
        const ids = new Set<number>();
        for (const [k, step] of spin.steps.entries()) {
          assert.equal(count(step.grid, "wolf"), wolvesAtStart, "wolves are dealt on the first board only and never destroyed");
          for (const cell of cellsOf(step.grid)) if (cell.symbol === "trail") ids.add(cell.id);
          const next = spin.steps[k + 1];
          if (!next) { assert.equal(step.wolfWalks.length, 0); continue; }
          const fall = step.fall!;
          // walkers: wolves that are cells of a cluster; each walks once if it has a legal target when its turn comes
          const clusterIds = new Set(step.clusters.flatMap(c => c.cells));
          const walkers = cellsOf(step.grid).filter(c => c.symbol === "wolf" && clusterIds.has(c.id)).map(c => c.id);
          const replay = fall.grid.map(column => column.slice());
          const expectedWalks: number[] = [];
          for (let c = 0; c < 6; c++) for (let r = 0; r < 6; r++) {
            const cell = fall.grid[c]![r]!;
            if (cell.symbol !== "wolf" || !walkers.includes(cell.id)) continue;
            const legal = [[c, r - 1], [c + 1, r], [c, r + 1], [c - 1, r]].filter(([x, y]) => x! >= 0 && x! < 6 && y! >= 0 && y! < 6 && !["moon", "wolf"].includes(replay[x!]![y!]!.symbol));
            const walk = step.wolfWalks.find(w => w.id === cell.id);
            if (legal.length === 0) { assert.equal(walk, undefined); continue; }
            assert.ok(walk, "a wolf in a cluster with a legal target walks");
            expectedWalks.push(cell.id);
            assert.deepEqual(walk.from, [c, r]);
            assert.ok(legal.some(([x, y]) => x === walk.to[0] && y === walk.to[1]), "legal target");
            assert.equal(Math.abs(walk.to[0] - walk.from[0]) + Math.abs(walk.to[1] - walk.from[1]), 1);
            assert.ok(walk.to[0] >= 0 && walk.to[0] < 6 && walk.to[1] >= 0 && walk.to[1] < 6);
            assert.equal(walk.consumed.id, replay[walk.to[0]]![walk.to[1]]!.id);
            replay[walk.to[0]]![walk.to[1]] = replay[c]![r]!;
            replay[c]![r] = { id: walk.trail.id, symbol: "trail" };
            walks++;
          }
          assert.deepEqual(step.wolfWalks.map(w => w.id), expectedWalks, "no other wolf walks, column-major order");
          if (step.wolfWalks.length > 1) multiWalkSteps++;
          assert.deepEqual(next.grid.map(column => column.map(cell => [cell.id, cell.symbol])), replay.map(column => column.map(cell => [cell.id, cell.symbol])), "next board = fall board + walks");
          // trail wilds: kept unless a win used them up
          const burst = new Set(step.burst);
          for (const cell of cellsOf(step.grid)) {
            if (cell.symbol !== "trail") continue;
            if (burst.has(cell.id)) { trailsUsed++; assert.ok(clusterIds.has(cell.id)); assert.ok(!cellsOf(next.grid).some(x => x.id === cell.id)); }
            else { trailsKept++; assert.ok(!clusterIds.has(cell.id)); assert.ok(cellsOf(next.grid).some(x => x.id === cell.id && x.symbol === "trail"), "an unused trail wild stays"); }
          }
          for (const w of step.wolfWalks) assert.equal(next.grid[w.to[0]]![w.to[1]]!.id, w.id, "the wolf is where it walked");
        }
        if (count(finalGrid(spin), "trail") > 0) spinsWithTrailAtEnd++;
        // wolf paths: start cell, then one cell per walk, adjacent cells
        for (const path of spin.wolfPaths) {
          const mine = spin.steps.flatMap(s => s.wolfWalks).filter(w => w.id === path.id);
          assert.equal(path.cells.length, mine.length + 1);
          assert.deepEqual(path.cells[0], mine[0]!.from);
          mine.forEach((w, i) => assert.deepEqual(path.cells[i + 1], w.to));
        }
        assert.equal(spin.wolfPaths.length, new Set(spin.steps.flatMap(s => s.wolfWalks.map(w => w.id))).size);
        trailIdsBySpin.push(ids);
      }
      for (let i = 1; i < trailIdsBySpin.length; i++) for (const id of trailIdsBySpin[i]!) assert.ok(!trailIdsBySpin[i - 1]!.has(id), "no trail wild carries over into the next spin");
    }
  }
  assert.ok(walks > 300 && trailsKept > 20 && trailsUsed > 20 && spinsWithTrailAtEnd > 20 && multiWalkSteps > 5, `walks ${walks}, kept ${trailsKept}, used ${trailsUsed}, trail at end ${spinsWithTrailAtEnd}, multi ${multiWalkSteps}`);
});

// --- Ergenekon -------------------------------------------------------------------------------------------
test("Ergenekon map: 3 distinct = +5 spins and x2, 6 distinct = +5 and x3, all six twice = x5; pieces cap at 2; the multiplier only grows", () => {
  const run = (steps: number[][], tuning = {}) => __asenaTest.mapRun(steps, tuning);
  // 1 distinct, then the same piece again (2 pieces of one constellation), then more
  const a = run([[0], [0], [0]]);
  assert.deepEqual(a.pieces, [2, 0, 0, 0, 0, 0]);
  assert.equal(a.events[0]!.distinct, 1);
  assert.deepEqual(a.events[1]!.unlocked, [{ template: 0, templateId: "kurt-basi", count: 2 }]);
  assert.equal(a.events[2], null, "a third ignition of a piece that is already lit twice unlocks nothing");
  assert.equal(a.multiplier, 1);
  // three distinct pieces: +5 spins and x2, exactly once
  const b = run([[0], [1], [2], [3], [4]]);
  assert.deepEqual(b.events.map(e => e!.freeSpinsAwarded), [0, 0, ASENA_MAP_SPINS_AT_3, 0, 0]);
  assert.deepEqual(b.events.map(e => e!.globalMultiplierAfter), [1, 1, 2, 2, 2]);
  assert.equal(b.events[2]!.globalMultiplierBefore, 1);
  assert.deepEqual(b.events.map(e => e!.distinct), [1, 2, 3, 4, 5]);
  // six distinct: +5 and x3 on top, once; then every piece twice: x5 and no spins
  const c = run([[0], [1], [2], [3], [4], [5], [0, 1, 2, 3, 4], [5], [5]]);
  assert.deepEqual(c.events.map(e => e?.freeSpinsAwarded ?? null), [0, 0, 5, 0, 0, 5, 0, 0, null]);
  assert.deepEqual(c.events.map(e => e?.globalMultiplierAfter ?? null), [1, 1, 2, 2, 2, 3, 3, 5, null]);
  assert.deepEqual(c.pieces, [2, 2, 2, 2, 2, 2]);
  assert.equal(c.multiplier, 5);
  assert.equal(ASENA_MAP_MULTIPLIERS.twice, 5);
  // several ignitions of one step can jump over a threshold: 2 -> 6 distinct in one step gives both awards and the larger multiplier
  const d = run([[0], [1], [2, 3, 4, 5]]);
  assert.equal(d.events[2]!.freeSpinsAwarded, 10);
  assert.equal(d.events[2]!.globalMultiplierBefore, 1);
  assert.equal(d.events[2]!.globalMultiplierAfter, 3);
  assert.deepEqual(d.events[2]!.unlocked.map(u => u.template), [2, 3, 4, 5]);
  // the same template twice in one step lights two pieces
  assert.deepEqual(run([[2, 2]]).pieces, [0, 0, 2, 0, 0, 0]);
  // an order that reaches all six twice before six distinct is impossible: twice implies six distinct, so x3 comes first or together
  const e = run([[0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5]]);
  assert.deepEqual(e.events.map(x => x!.globalMultiplierAfter), [3, 5]);
  assert.equal(e.events[0]!.freeSpinsAwarded, 10);
  // multipliers never decrease even when the tuning is odd
  const f = run([[0, 1, 2], [3, 4, 5], [0, 1, 2, 3, 4, 5]], { mapMultipliers: { 3: 7, 6: 3, twice: 2 } });
  assert.deepEqual(f.events.map(x => x!.globalMultiplierAfter), [7, 7, 7]);
  assert.equal(f.multiplier, 7);
});

test("Ergenekon in real rounds: map events replay exactly, the global multiplier persists over every free spin and multiplies every win", () => {
  let events = 0, mult2 = 0, mult3 = 0, mult5 = 0, spinAwards = 0, features = 0, multiSpin = 0;
  for (const seed of seeds(700, "e46e4e40e46e4e40e46e4e40e46e4e40")) {
    const round = playAsenaRound(seed, 100, "buy");
    features++;
    const pieces = [0, 0, 0, 0, 0, 0];
    let mult = 1, reached3 = false, reached6 = false, twice = false;
    for (const spin of round.spins) {
      assert.equal(spin.globalMultiplierBefore, spin.kind === "base" ? 1 : mult, "the multiplier persists from spin to spin");
      assert.deepEqual(spin.mapBefore, spin.kind === "base" ? [0, 0, 0, 0, 0, 0] : pieces);
      let awards = 0;
      for (const step of spin.steps) {
        const ignitions = step.clusters.filter(c => c.constellation).map(c => c.constellation!.templateIndex);
        if (spin.kind === "base") { assert.equal(step.map, null, "no map in the base game"); assert.equal(step.globalMultiplier, 1); }
        else {
          const unlocked: number[] = [];
          for (const t of ignitions) if (pieces[t]! < 2) { pieces[t]!++; unlocked.push(t); }
          const before = mult;
          let spins = 0;
          if (unlocked.length > 0) {
            const distinct = pieces.filter(x => x >= 1).length;
            if (distinct >= 3 && !reached3) { reached3 = true; spins += 5; mult = Math.max(mult, 2); }
            if (distinct >= 6 && !reached6) { reached6 = true; spins += 5; mult = Math.max(mult, 3); }
            if (!twice && pieces.every(x => x >= 2)) { twice = true; mult = Math.max(mult, 5); }
          }
          if (unlocked.length === 0) assert.equal(step.map, null);
          else {
            events++;
            assert.ok(step.map);
            assert.deepEqual(step.map.unlocked.map(u => u.template), unlocked);
            assert.deepEqual(step.map.pieces, pieces);
            assert.equal(step.map.globalMultiplierBefore, before);
            assert.equal(step.map.globalMultiplierAfter, mult);
            assert.equal(step.map.freeSpinsAwarded, spins);
            awards += spins; spinAwards += spins;
          }
          assert.equal(step.globalMultiplier, mult, "a step is paid with the multiplier in force after its own unlocks");
        }
        assert.equal(step.winHundredths, step.clusterHundredths * step.globalMultiplier);
        assert.equal(step.clusterHundredths, step.clusters.reduce((a, c) => a + c.payHundredths, 0));
      }
      assert.equal(spin.mapSpinsAwarded, awards);
      assert.equal(spin.globalMultiplierAfter, spin.kind === "base" ? 1 : mult);
      assert.deepEqual(spin.mapAfter, spin.kind === "base" ? [0, 0, 0, 0, 0, 0] : pieces);
      assert.ok(spin.globalMultiplierAfter >= spin.globalMultiplierBefore);
    }
    if (mult >= 2) mult2++;
    if (mult >= 3) mult3++;
    if (mult >= 5) mult5++;
    if (round.spins.length > 11) multiSpin++;
  }
  assert.ok(events > 500 && mult2 > 100 && mult3 > 3 && spinAwards > 100 && multiSpin > 50, `events ${events}, x2 ${mult2}, x3 ${mult3}, x5 ${mult5}, awards ${spinAwards}, longer ${multiSpin} of ${features}`);
});

test("Ergenekon with a whole board of one symbol: the wolf-head ignites every step, its piece caps at 2, no threshold is reached, the multiplier stays x1", () => {
  const tuning = {
    tables: { buy: { base: [["h1", 1000], ["moon", 40]] as never, free: [["h1", 1]] as never } },
    paytable: onePay, maxTumbles: 2, scatterPay: { 3: 0, 4: 0, 5: 0 },
  };
  const round = __asenaTest.play(SEED, 100, "buy", tuning);
  assert.equal(round.freeSpinsTriggered, true);
  const free = round.spins.slice(1);
  assert.equal(free.length, 10);
  assert.deepEqual(free[0]!.steps.map(s => s.clusters.length), [1, 1, 0]);
  assert.equal(free[0]!.steps[0]!.clusters[0]!.constellation!.templateId, "kurt-basi");
  assert.equal(free[0]!.steps[0]!.clusters[0]!.size, 36);
  assert.deepEqual(free[0]!.steps[0]!.map!.unlocked, [{ template: 0, templateId: "kurt-basi", count: 1 }]);
  assert.deepEqual(free[0]!.steps[1]!.map!.unlocked, [{ template: 0, templateId: "kurt-basi", count: 2 }]);
  assert.equal(free[1]!.steps[0]!.map, null);
  assert.deepEqual(free.at(-1)!.mapAfter, [2, 0, 0, 0, 0, 0]);
  assert.equal(free.at(-1)!.globalMultiplierAfter, 1);
  assert.equal(free.reduce((a, s) => a + s.mapSpinsAwarded, 0), 0);
  // with a higher x2 reward for 3 distinct nothing changes either: only one constellation ever lights
  for (const spin of free) for (const step of spin.steps) assert.equal(step.globalMultiplier, 1);
});

// --- Scatter, trigger, retrigger, buy, ante --------------------------------------------------------------
test("moon scatters: base 3 / 4 / 5+ moons on the final board pay 3x / 8x / 60x and award 10 free spins; free spins award 3 more from 3 moons and pay no scatter", () => {
  let base3 = 0, base4 = 0, base5 = 0, retriggers = 0, nearMiss = 0;
  for (const mode of ["ante", "buy", "standard"] as const) {
    for (const seed of seeds(mode === "standard" ? 6000 : 1200, `5ca77e55c0ffee115ca77e55c0ffee1${MODES.indexOf(mode)}`)) {
      const round = playAsenaRound(seed, 100, mode);
      let granted = 0;
      for (const spin of round.spins) {
        const moons = count(finalGrid(spin), "moon");
        assert.equal(spin.scatterCount, moons);
        if (spin.kind === "base") {
          assert.equal(spin.scatterHundredths, moons >= 5 ? 6000 : moons === 4 ? 800 : moons === 3 ? 300 : 0);
          assert.equal(spin.scatterSpinsAwarded, moons >= 3 ? 10 : 0);
          assert.equal(round.freeSpinsTriggered, moons >= 3);
          if (moons === 3) base3++; else if (moons === 4) base4++; else if (moons >= 5) base5++; else if (moons === 2) nearMiss++;
        } else {
          assert.equal(spin.scatterHundredths, 0, "no scatter pay in free spins");
          assert.equal(spin.scatterSpinsAwarded, moons >= 3 ? 3 : 0);
          if (moons >= 3) retriggers++;
        }
        assert.equal(spin.winHundredths, spin.tumbleHundredths + spin.scatterHundredths);
        granted += spin.freeSpinsAwarded;
        assert.equal(spin.freeSpinsAwarded, spin.scatterSpinsAwarded + spin.mapSpinsAwarded);
      }
      if (!round.capped) assert.equal(round.spins.length - 1, granted, "every granted free spin is played");
      assert.ok(granted <= 200);
    }
  }
  assert.ok(base3 > 20 && base4 > 3 && retriggers > 5 && nearMiss > 20, `3: ${base3}, 4: ${base4}, 5+: ${base5}, retriggers ${retriggers}, 2 moons ${nearMiss}`);
});

test("moons never burst and only fall: the count on a spin's board never drops", () => {
  for (const seed of seeds(2500, "00ddba1100ddba1100ddba1100ddba11")) {
    for (const spin of playAsenaRound(seed, 100, "ante").spins) {
      let previous = 0;
      for (const step of spin.steps) {
        const moons = count(step.grid, "moon");
        assert.ok(moons >= previous);
        previous = moons;
        const burstSet = new Set(step.burst);
        for (const cell of cellsOf(step.grid)) if (cell.symbol === "moon") assert.ok(!burstSet.has(cell.id));
      }
    }
  }
});

test("retrigger: a free spin with 3+ moons awards 3 more; the total of free spins granted is bounded", () => {
  const tuning = { tables: { buy: { free: [["l4", 100], ["moon", 500]] as never } }, paytable: zeroPay, maxFreeSpins: 30 };
  const round = __asenaTest.play(SEED, 100, "buy", tuning);
  assert.equal(round.spins.length - 1, 30);
  assert.equal(round.spins[0]!.freeSpinsAwarded, 10);
  assert.ok(round.spins.slice(1).every(s => s.scatterCount >= 3));
  assert.equal(round.spins.slice(1).reduce((a, s) => a + s.freeSpinsAwarded, 0), 20, "3 per retrigger until the bound of 30 is reached");
  assert.equal(round.spins.at(-1)!.freeSpinsLeft, 0);
  assert.equal(round.totalHundredths, round.spins[0]!.winHundredths, "free spins pay nothing with a zero pay table");
  // exactly 3 moons retrigger, 2 do not (checked on whole natural spins above); here a table that never deals moons never retriggers
  const none = __asenaTest.play(SEED, 100, "buy", { tables: { buy: { free: [["l4", 1]] as never } }, paytable: zeroPay });
  assert.equal(none.spins.length, 11);
});

test("buy: the initial base board always has 3+ moons, the free spins always trigger, the moon pay still counts", () => {
  let minMoons = 36;
  for (const seed of seeds(600, "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0")) {
    const round = playAsenaRound(seed, 100, "buy");
    const first = round.spins[0]!;
    const moons = count(first.steps[0]!.grid, "moon");
    minMoons = Math.min(minMoons, moons);
    assert.ok(moons >= ASENA_BUY_MIN_SCATTERS);
    assert.equal(round.freeSpinsTriggered, true);
    assert.ok(first.scatterCount >= 3, "moons survive every tumble");
    assert.ok(first.scatterHundredths >= 300);
    assert.ok(round.spins.length >= 11 || round.capped);
  }
  assert.equal(minMoons, 3);
});

test("ensureMoons follows the documented procedure: 3 - k draws, distinct non-moon cells, ids kept, column-major candidate list", () => {
  for (const k of [0, 1, 2, 3, 5]) {
    for (const seed of seeds(25, `abc0def1abc0def1abc0def1abc0def${k}`)) {
      const grid = board((c, r) => (c * 6 + r < k ? "moon" : filler(c, r)));
      const before = grid.map(column => column.map(cell => ({ ...cell })));
      __asenaTest.ensureMoons(grid, 3, seed);
      // reference implementation of the written procedure
      const rng = __asenaTest.createRng(seed);
      const expected = before.map(column => column.map(cell => ({ ...cell })));
      let moons = k;
      while (moons < 3) {
        const spots: [number, number][] = [];
        for (let c = 0; c < 6; c++) for (let r = 0; r < 6; r++) if (expected[c]![r]!.symbol !== "moon") spots.push([c, r]);
        const [c, r] = spots[Math.floor(rng() * spots.length / 2 ** 32)]!;
        expected[c]![r]!.symbol = "moon";
        moons++;
      }
      assert.deepEqual(grid, expected);
      assert.equal(count(grid, "moon"), Math.max(3, k));
      for (const [c, column] of grid.entries()) for (const [r, cell] of column.entries()) assert.equal(cell.id, before[c]![r]!.id, "ids kept");
    }
  }
});

test("ante: the feature is about twice as frequent as in standard on the same seeds and is never forced", () => {
  let standard = 0, ante = 0, anteMissed = 0;
  for (const seed of seeds(40_000, "a17e00a17e00a17e00a17e00a17e00a1")) {
    const s = playAsenaRound(seed, 100, "standard"), a = playAsenaRound(seed, 100, "ante");
    if (s.freeSpinsTriggered) standard++;
    if (a.freeSpinsTriggered) ante++; else anteMissed++;
    assert.equal(a.freeSpinsTriggered, a.spins[0]!.scatterCount >= 3, "a trigger is still 3+ moons on the final base board");
  }
  assert.ok(ante > standard * 1.6 && ante < standard * 2.8, `standard ${standard}, ante ${ante}`);
  assert.ok(anteMissed > 39_000);
  assert.ok(standard / 40_000 > 1 / 500 && standard / 40_000 < 1 / 200, `standard feature rate ${standard / 40_000}`);
});

test("mode tables: positive integer weights, moon and wolf are rare, trail is never dealt, ante raises only the base moon weight, buy keeps the base table", () => {
  const sum = (t: readonly (readonly [string, number])[]): number => t.reduce((a, [, w]) => a + w, 0);
  const weight = (t: readonly (readonly [string, number])[], symbol: string): number => t.find(([s]) => s === symbol)?.[1] ?? 0;
  for (const mode of MODES) {
    for (const table of [ASENA_MODE_TABLES[mode].base, ASENA_MODE_TABLES[mode].free]) {
      assert.ok(table.every(([symbol, w]) => Number.isSafeInteger(w) && w > 0 && symbol !== "trail"));
      assert.deepEqual(table.map(([s]) => s), [...ASENA_PAY_SYMBOLS, "wolf", "moon"]);
      assert.ok(weight(table, "moon") / sum(table) < 0.02, `${mode} moon share`);
      assert.ok(weight(table, "wolf") / sum(table) < 0.1, `${mode} wolf share`);
      for (let i = 1; i < 8; i++) assert.ok(table[i - 1]![1] <= table[i]![1], "low symbols are dealt more often than high symbols");
    }
  }
  const std = ASENA_MODE_TABLES.standard, ante = ASENA_MODE_TABLES.ante, buy = ASENA_MODE_TABLES.buy;
  assert.deepEqual(ante.base.filter(([s]) => s !== "moon"), std.base.filter(([s]) => s !== "moon"));
  assert.ok(weight(ante.base, "moon") > weight(std.base, "moon"));
  assert.deepEqual(buy.base, std.base);
  assert.notDeepEqual(buy.free, std.free, "buy has its own free table");
  assert.notDeepEqual(ante.free, std.free, "ante has its own free table");
});

test("the 5000 x bet cap clamps the total in every mode, ends the round at once and zeroes the free spins left", () => {
  for (const mode of ["standard", "ante"] as const) {
    let hit: AsenaRound | undefined;
    for (const seed of seeds(300)) {
      const round = __asenaTest.play(seed, 100, mode, { paytable: richPay });
      if (round.spins[0]!.winHundredths > 0 || round.spins[0]!.scatterHundredths > 0) { hit = round; break; }
    }
    assert.ok(hit, `${mode}: a winning base spin exists`);
    assert.equal(hit!.capped, true);
    assert.equal(hit!.totalHundredths, BET_CAP);
    assert.equal(hit!.payoutCents, 500_000);
    assert.equal(hit!.spins.length, 1, "the round ends with the capped spin");
    assert.equal(hit!.spins.at(-1)!.freeSpinsLeft, 0);
  }
  // Buy: a capped round ends even though 10 free spins were guaranteed.
  const buyRound = __asenaTest.play(SEED, 100, "buy", { paytable: richPay });
  assert.equal(buyRound.capped, true);
  assert.equal(buyRound.freeSpinsTriggered, true);
  assert.equal(buyRound.payoutCents, 500_000);
  assert.equal(buyRound.totalHundredths, BET_CAP);
  assert.ok(buyRound.spins.length <= 2);
  // Large bets: the cap is 5000 x bet in cents too
  assert.equal(__asenaTest.play(SEED, 50_000, "buy", { paytable: richPay }).payoutCents, 50_000 * 5000);
  // A big global multiplier can reach the cap on its own: tiny pays, a table that ignites the wolf-head every step
  const fat = __asenaTest.play(SEED, 100, "buy", {
    tables: { buy: { base: [["h1", 1000], ["moon", 40]] as never, free: [["h1", 1]] as never } }, paytable: Object.fromEntries(ASENA_PAY_SYMBOLS.map(s => [s, Array(7).fill(200_000)])) as never, maxTumbles: 3,
  });
  assert.equal(fat.capped, true);
  assert.equal(fat.totalHundredths, BET_CAP);
  assert.equal(fat.spins.at(-1)!.freeSpinsLeft, 0);
  assert.ok(fat.spins.slice(0, -1).every(s => s.totalHundredthsAfter < BET_CAP));
});

test("safety bounds: tumbles per spin and total free spins are capped", () => {
  const round = __asenaTest.play(SEED, 100, "standard", { tables: { standard: { base: [["h1", 1]] as never } }, maxTumbles: 7, paytable: onePay });
  assert.equal(round.spins[0]!.steps.length, 8);
  assert.equal(round.spins[0]!.steps.at(-1)!.clusters.length, 0);
  assert.ok(round.spins[0]!.steps.slice(0, -1).every(s => s.clusters.length === 1 && s.fall !== null));
  const scatters = __asenaTest.play(SEED, 100, "buy", { tables: { buy: { free: [["l4", 100], ["moon", 500]] as never } }, maxFreeSpins: 12, paytable: zeroPay });
  assert.equal(scatters.spins.length - 1, 12);
  assert.equal(scatters.spins.at(-1)!.freeSpinsLeft, 0);
  assert.throws(() => __asenaTest.play(SEED, 100, "standard", { tables: { standard: { base: [["h1", 0]] as never } } }), RangeError);
  assert.throws(() => __asenaTest.play(SEED, 100, "standard", { templateMultipliers: [1, 2] }), RangeError);
  assert.throws(() => __asenaTest.play(SEED, 100, "standard", { templateMultipliers: [1, 2, 3, 4, 5, 0] }), RangeError);
});

test("structure: 6x6 boards, unique ids, steps replay each other, clusters match an independent search, bookkeeping adds up in all modes", () => {
  let tumbles = 0, ignitions = 0;
  for (const mode of MODES) {
    for (const seed of seeds(mode === "buy" ? 250 : 1200, `00ff00ff00ff00ff00ff00ff00ff00f${MODES.indexOf(mode)}`)) {
      const round = playAsenaRound(seed, 100, mode);
      const symbolOfId = new Map<number, string>();
      let total = 0, maxId = -1, left = 0;
      assert.equal(round.spins.length, round.freeSpinsTriggered ? 1 + round.spins.reduce((a, s) => a + s.freeSpinsAwarded, 0) : 1);
      round.spins.forEach((spin, i) => {
        assert.equal(spin.index, i);
        assert.equal(spin.kind, i === 0 ? "base" : "free");
        total += spin.winHundredths;
        assert.equal(spin.totalHundredthsAfter, Math.min(total, BET_CAP));
        assert.equal(spin.tumbleHundredths, spin.steps.reduce((a, s) => a + s.winHundredths, 0));
        assert.equal(spin.clusterHundredths, spin.steps.reduce((a, s) => a + s.clusterHundredths, 0));
        if (spin.kind === "free") left--;
        left += spin.freeSpinsAwarded;
        assert.equal(spin.freeSpinsLeft, left, "free spin bookkeeping");
        const ids = spin.steps.flatMap(step => cellsOf(step.grid).map(cell => cell.id));
        assert.ok(Math.min(...ids) > maxId, "ids of a new spin start above everything dealt before");
        maxId = Math.max(...ids);
        spin.steps.forEach((step, k) => {
          assert.equal(step.grid.length, 6);
          for (const column of step.grid) assert.equal(column.length, 6);
          assert.equal(new Set(cellsOf(step.grid).map(cell => cell.id)).size, 36);
          for (const cell of cellsOf(step.grid)) { assert.equal(symbolOfId.get(cell.id) ?? cell.symbol, cell.symbol, "an id keeps its symbol for the whole round"); symbolOfId.set(cell.id, cell.symbol); }
          // the clusters are exactly what an independent search finds on this board
          if (spin.steps.length === 101 && k === 100) assert.deepEqual(step.clusters, [], "the safety bound of 100 tumbles ends the spin");
          else assert.deepEqual(step.clusters, __asenaTest.findClusters(step.grid));
          for (const cluster of step.clusters) {
            assert.ok(cluster.size >= 5 && cluster.cells.length === cluster.size);
            assert.equal(cluster.basePayHundredths, ASENA_PAYTABLE[cluster.symbol][asenaTier(cluster.size)]);
            assert.equal(cluster.payHundredths, cluster.basePayHundredths * cluster.templateMultiplier);
            const symbolsInCluster = cellsOf(step.grid).filter(c => cluster.cells.includes(c.id)).map(c => c.symbol);
            assert.ok(symbolsInCluster.every(s => s === cluster.symbol || s === "wolf" || s === "trail") && symbolsInCluster.includes(cluster.symbol));
            if (cluster.constellation) {
              ignitions++;
              const t = ASENA_TEMPLATES[cluster.constellation.templateIndex]!;
              assert.equal(t.id, cluster.constellation.templateId);
              assert.equal(cluster.templateMultiplier, t.multiplier);
              const placed = asenaTemplatePositions(t.id, cluster.constellation.transform, cluster.constellation.origin[0], cluster.constellation.origin[1]);
              assert.deepEqual(placed, cluster.constellation.positions);
              assert.deepEqual(placed.map(([c, r]) => step.grid[c]![r]!.id), cluster.constellation.cells);
              assert.ok(cluster.constellation.cells.every(id => cluster.cells.includes(id)), "the shape lies inside the cluster");
            } else assert.equal(cluster.templateMultiplier, 1);
          }
          const last = k === spin.steps.length - 1;
          if (last) { assert.equal(step.clusters.length, 0); assert.equal(step.fall, null); assert.deepEqual(step.burst, []); assert.deepEqual(step.wolfWalks, []); return; }
          tumbles++;
          assert.ok(step.clusters.length > 0);
          const clusterIds = new Set(step.clusters.flatMap(c => c.cells));
          const burstExpected = cellsOf(step.grid).filter(c => clusterIds.has(c.id) && c.symbol !== "wolf").map(c => c.id).sort((a, b) => a - b);
          assert.deepEqual(step.burst, burstExpected, "everything in a cluster bursts except wolves");
          const burst = new Set(step.burst), fall = step.fall!;
          fall.grid.forEach((column, c) => {
            const survivors = step.grid[c]!.filter(cell => !burst.has(cell.id));
            assert.deepEqual(column.slice(6 - survivors.length), survivors, "survivors fall without changing (wolves, trails and moons included)");
          });
          const before = new Set(cellsOf(step.grid).map(cell => cell.id));
          const fresh = fall.drops.map(d => d.id);
          assert.equal(fresh.length, burst.size);
          assert.ok(fresh.every((id, i) => !before.has(id) && (i === 0 || id === fresh[i - 1]! + 1)), "fresh ids are consecutive, column by column, top to bottom");
          for (const d of fall.drops) { assert.equal(fall.grid[d.col]![d.row]!.id, d.id); assert.equal(fall.grid[d.col]![d.row]!.symbol, d.symbol); assert.ok(d.symbol !== "wolf" && d.symbol !== "trail", "refills never deal wolves or trails"); }
          for (const m of fall.moves) { assert.equal(step.grid[m.col]![m.fromRow]!.id, m.id); assert.equal(fall.grid[m.col]![m.toRow]!.id, m.id); assert.ok(m.toRow > m.fromRow); }
          for (const id of burst) assert.ok(!cellsOf(fall.grid).some(c => c.id === id), "winners are gone");
        });
      });
      assert.equal(left, 0);
      assert.equal(round.capped, false);
    }
  }
  assert.ok(tumbles > 1500 && ignitions > 200, `tumbles ${tumbles}, ignitions ${ignitions}`);
});

test("ASENA_RTP equals the simulation evidence and the evidence matches the engine source", () => {
  const dir = fileURLToPath(new URL("../../../ops/evidence/asena-20261012/", import.meta.url));
  const evidence = JSON.parse(readFileSync(`${dir}rtp.json`, "utf8")) as {
    engine: string; engineSourceSha256: string; tuningOverride: unknown; seed: string; modes: Record<AsenaMode, {
      rounds: number; rtpVsCost: { pointEstimate: number; ci95: [number, number] }; hitRate: number; featureRate: number; stdDevPerRoundCostUnits: number; capHits: number;
      winTiersShareOfRounds: Record<string, number>; constellations: { perTemplate: Record<string, { ignitionsInBase: number; ignitionsInFree: number }> };
      wolf: { totalWalks: number }; ergenekon: { finalGlobalMultiplierHistogram: Record<string, number> };
    }>;
  };
  assert.equal(evidence.engine, ASENA_ENGINE_ID);
  assert.equal(evidence.tuningOverride, null, "evidence runs never use a tuning override");
  assert.ok(!evidence.seed.includes("tune"), "evidence seeds are distinct from tuning seeds");
  const source = readFileSync(fileURLToPath(new URL("../src/asena.ts", import.meta.url)), "utf8")
    .replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
  assert.equal(createHash("sha256").update(source).digest("hex"), evidence.engineSourceSha256, "engine code changed after the evidence run: rerun the simulation");
  const r3 = (x: number): number => Number(x.toFixed(3));
  for (const mode of MODES) {
    const e = evidence.modes[mode], c = ASENA_RTP[mode];
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
    assert.ok(e.wolf.totalWalks > 0);
    assert.equal(Object.keys(e.constellations.perTemplate).length, 6);
    for (const id of ASENA_TEMPLATE_IDS) assert.ok(e.constellations.perTemplate[id]!.ignitionsInBase + e.constellations.perTemplate[id]!.ignitionsInFree > 0, `${mode}: ${id} ignites`);
    for (const key of ["atLeast10xBet", "atLeast25xBet", "atLeast50xBet", "atLeast100xBet", "atLeast1000xBet"]) assert.ok(key in e.winTiersShareOfRounds, key);
  }
  assert.ok(ASENA_RTP.standard.hitRate >= 0.22 && ASENA_RTP.standard.hitRate <= 0.32);
  assert.ok(1 / ASENA_RTP.standard.featureRate >= 250 && 1 / ASENA_RTP.standard.featureRate <= 450);
  assert.ok(ASENA_RTP.buy.featureRate === 1 && ASENA_RTP.ante.featureRate > ASENA_RTP.standard.featureRate * 1.6);
});
