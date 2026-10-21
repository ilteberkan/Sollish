import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DAMLA_BET_LEVELS_CENTS, DAMLA_ENGINE_ID, DAMLA_EXACT_RTP, DAMLA_MAX_WIN_MULTIPLIER, DAMLA_MODES, DAMLA_PAYTABLES, DAMLA_RTP, DAMLA_ROWS, DAMLA_RISKS, __damlaTest,
  damlaCostCents, damlaSeedFromEntropy, playDamlaRound, type DamlaMode,
} from "../src/damla.ts";
import { ASENA_BET_LEVELS_CENTS } from "../src/asena.ts";
import * as protocol from "../src/index.ts";

const SEED = "0123456789abcdef0123456789abcdef";
function seeds(count: number, label = "d4m1a00112233445566778899aabbccd"): string[] {
  const rng = __damlaTest.createRng(label);
  return Array.from({ length: count }, () => damlaSeedFromEntropy(new Uint32Array([rng(), rng(), rng(), rng()])));
}
const choose = (n: number, k: number): bigint => { let r = 1n; for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i); return r; };
const rowsOf = (mode: DamlaMode): number => Number(mode.split("-")[1]);

test("exports, ids and bet levels", () => {
  assert.equal(DAMLA_ENGINE_ID, "damla-terraces-1");
  assert.equal(DAMLA_MODES.length, 15);
  assert.deepEqual([...DAMLA_BET_LEVELS_CENTS], [...ASENA_BET_LEVELS_CENTS]);
  assert.equal(protocol.playDamlaRound, playDamlaRound);
  assert.equal(protocol.DAMLA_PAYTABLES, DAMLA_PAYTABLES);
  for (const risk of DAMLA_RISKS) for (const rows of DAMLA_ROWS) assert.ok(DAMLA_MODES.includes(`${risk}-${rows}`));
});

test("seed from entropy", () => {
  assert.equal(damlaSeedFromEntropy(new Uint32Array([1, 2, 0xdeadbeef, 0xffffffff])), "0000000100000002deadbeefffffffff");
  assert.throws(() => damlaSeedFromEntropy(new Uint32Array(3)), RangeError);
  assert.throws(() => damlaSeedFromEntropy([1, 2, 3, 4] as unknown as Uint32Array), RangeError);
});

test("determinism: same input, same round; different seeds differ", () => {
  for (const mode of DAMLA_MODES) assert.deepEqual(playDamlaRound(SEED, 500, mode), playDamlaRound(SEED, 500, mode));
  const paths = new Set(seeds(50).map(s => playDamlaRound(s, 100, "medium-16").path.join("")));
  assert.ok(paths.size > 40);
  const a = playDamlaRound(SEED, 100, "low-8"), b = playDamlaRound(SEED, 100, "high-16");
  assert.deepEqual(a.path, b.path.slice(0, 8), "the draw order is shared: a shorter mode is a prefix of a longer one");
});

test("RangeError for a bad seed, bet or mode", () => {
  for (const bad of ["", "xyz", SEED.toUpperCase(), SEED.slice(1), SEED + "0", 5 as unknown as string]) assert.throws(() => playDamlaRound(bad, 100, "low-8"), RangeError);
  for (const bad of [0, 99, 101, -100, 1.5, NaN, 50_001, "100" as unknown as number]) assert.throws(() => playDamlaRound(SEED, bad, "low-8"), RangeError);
  for (const bad of ["low-9", "extreme-8", "low", "low-8 ", "", "LOW-8", "mid-8", undefined as unknown as DamlaMode]) assert.throws(() => playDamlaRound(SEED, 100, bad as DamlaMode), RangeError);
  assert.throws(() => damlaCostCents(99, "low-8"), RangeError);
  assert.throws(() => damlaCostCents(100, "low-7" as DamlaMode), RangeError);
});

test("cost equals the bet", () => {
  for (const bet of DAMLA_BET_LEVELS_CENTS) for (const mode of DAMLA_MODES) assert.equal(damlaCostCents(bet, mode), bet);
});

test("round shape: path length = rows, slot = number of R, integer payout, no free spins", () => {
  for (const mode of DAMLA_MODES) for (const [i, seed] of seeds(60).entries()) {
    const bet = DAMLA_BET_LEVELS_CENTS[i % DAMLA_BET_LEVELS_CENTS.length]!, round = playDamlaRound(seed, bet, mode);
    const rows = rowsOf(mode);
    assert.equal(round.engine, DAMLA_ENGINE_ID);
    assert.equal(round.mode, mode);
    assert.equal(round.rows, rows);
    assert.equal(round.risk, mode.split("-")[0]);
    assert.equal(round.path.length, rows);
    assert.ok(round.path.every(p => p === "L" || p === "R"));
    assert.equal(round.slot, round.path.filter(p => p === "R").length);
    assert.equal(round.multiplierHundredths, DAMLA_PAYTABLES[mode]![round.slot]);
    assert.equal(round.totalHundredths, round.multiplierHundredths);
    assert.equal(round.costCents, bet);
    assert.ok(Number.isInteger(round.payoutCents));
    assert.equal(round.payoutCents, Math.floor(bet * round.multiplierHundredths / 100));
    assert.equal(round.freeSpinsTriggered, false);
  }
});

test("path is roughly fair: right spills about half the time", () => {
  let right = 0, total = 0;
  for (const seed of seeds(2000)) { const r = playDamlaRound(seed, 100, "high-16"); right += r.slot; total += 16; }
  assert.ok(Math.abs(right / total - 0.5) < 0.01, `${right / total}`);
});

test("paytables: 15 symmetric integer tables, non-decreasing from the centre out", () => {
  assert.deepEqual(Object.keys(DAMLA_PAYTABLES).sort(), [...DAMLA_MODES].sort());
  for (const mode of DAMLA_MODES) {
    const t = DAMLA_PAYTABLES[mode]!, rows = rowsOf(mode);
    assert.equal(t.length, rows + 1);
    assert.ok(t.every(v => Number.isInteger(v) && v > 0));
    for (let k = 0; k <= rows; k++) assert.equal(t[k], t[rows - k], `${mode} symmetric at ${k}`);
    for (let k = rows / 2; k < rows; k++) assert.ok(t[k + 1]! >= t[k]!, `${mode} monotone at ${k}`);
    assert.equal(Object.isFrozen(t), true);
  }
});

test("risk character: low centre >= 0.5x, high centre pools about 0.2x, high-16 edge = 1000x", () => {
  for (const rows of DAMLA_ROWS) {
    assert.ok(DAMLA_PAYTABLES[`low-${rows}`]![rows / 2]! >= 50);
    assert.ok(DAMLA_PAYTABLES[`high-${rows}`]![rows / 2]! <= 21);
    assert.ok(DAMLA_PAYTABLES[`medium-${rows}`]![rows / 2]! < DAMLA_PAYTABLES[`low-${rows}`]![rows / 2]!);
    const edge = (risk: string): number => DAMLA_PAYTABLES[`${risk}-${rows}` as DamlaMode]![0]!;
    assert.ok(edge("low") < edge("medium") && edge("medium") < edge("high"));
  }
  assert.equal(DAMLA_PAYTABLES["high-16"]![0], 100_000);
  assert.equal(DAMLA_MAX_WIN_MULTIPLIER, 1000);
  assert.equal(Math.max(...DAMLA_MODES.map(m => Math.max(...DAMLA_PAYTABLES[m]!))) / 100, DAMLA_MAX_WIN_MULTIPLIER);
});

test("exact RTP of every mode is within 98.00-99.00 percent (BigInt binomial sum), house edge >= 1 percent", () => {
  for (const mode of DAMLA_MODES) {
    const rows = rowsOf(mode), t = DAMLA_PAYTABLES[mode]!, den = 100n * (1n << BigInt(rows));
    let num = 0n;
    for (let k = 0; k <= rows; k++) num += choose(rows, k) * BigInt(t[k]!);
    assert.ok(num * 10_000n >= den * 9800n, `${mode} RTP >= 98.00%`);
    assert.ok(num * 10_000n <= den * 9900n, `${mode} RTP <= 99.00%`);
    assert.ok(DAMLA_EXACT_RTP[mode] >= 0.98 && DAMLA_EXACT_RTP[mode] <= 0.99);
    assert.equal(DAMLA_EXACT_RTP[mode], Number(num * 1_000_000_000n / den) / 1e9);
  }
});

test("cap: only the mode's largest pool is capped; edge slots are capped, centre is not", () => {
  for (const mode of DAMLA_MODES) {
    const t = DAMLA_PAYTABLES[mode]!, cap = Math.max(...t);
    assert.equal(__damlaTest.caps[mode], cap);
    assert.ok(cap <= DAMLA_MAX_WIN_MULTIPLIER * 100);
  }
  let capped = 0, plain = 0;
  for (const seed of seeds(4000)) {
    const r = playDamlaRound(seed, 100, "low-8");
    assert.equal(r.capped, r.slot === 0 || r.slot === 8);
    if (r.capped) { capped++; assert.equal(r.multiplierHundredths, 560); } else plain++;
  }
  assert.ok(capped > 0 && plain > 0);
});

test("integer sums over exhaustive paths reproduce the exact RTP", () => {
  for (const mode of ["low-8", "high-10"] as DamlaMode[]) {
    const rows = rowsOf(mode); let total = 0n;
    for (let bits = 0; bits < 1 << rows; bits++) { let k = 0; for (let b = 0; b < rows; b++) k += (bits >> b) & 1; total += BigInt(DAMLA_PAYTABLES[mode]![k]!); }
    assert.equal(Number(total * 1_000_000_000n / (100n * (1n << BigInt(rows)))) / 1e9, DAMLA_EXACT_RTP[mode]);
  }
});

test("frozen sample: pinned digest of 200 rounds (engine change breaks it on purpose)", () => {
  const hash = createHash("sha256");
  for (const [i, seed] of seeds(200, "f00dcafe00112233445566778899aab").entries()) {
    const r = playDamlaRound(seed, 100 * (1 + (i % 4)), DAMLA_MODES[i % 15]!);
    hash.update(`${r.mode}:${r.path.join("")}:${r.payoutCents}|`);
  }
  assert.equal(hash.digest("hex"), "b9949f986b85a0e521055a7824834c300902221d6f522b59297cae4dee65e264");
});

test("DAMLA_RTP equals the simulation evidence and the evidence matches the engine source", () => {
  const dir = fileURLToPath(new URL("../../../ops/evidence/damla-20261021/", import.meta.url));
  const evidence = JSON.parse(readFileSync(`${dir}rtp.json`, "utf8")) as {
    engine: string; engineSourceSha256: string; seed: string;
    modes: Record<DamlaMode, { rounds: number; exactRtp: number; mcRtp: number; stdDev: number; withinThreeSigma: boolean; integerPayoutMismatches: number }>;
  };
  assert.equal(evidence.engine, DAMLA_ENGINE_ID);
  const source = readFileSync(fileURLToPath(new URL("../src/damla.ts", import.meta.url)), "utf8").replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
  assert.equal(createHash("sha256").update(source).digest("hex"), evidence.engineSourceSha256, "engine code changed after the evidence run: rerun the simulation");
  assert.deepEqual(Object.keys(DAMLA_RTP).sort(), [...DAMLA_MODES].sort());
  for (const mode of DAMLA_MODES) {
    const e = evidence.modes[mode], c = DAMLA_RTP[mode];
    assert.ok(e.rounds >= 20_000_000, `${mode}: ${e.rounds} rounds`);
    assert.equal(c.rtp, Number(e.mcRtp.toFixed(4)));
    assert.equal(c.stdDev, Number(e.stdDev.toFixed(3)));
    assert.equal(e.exactRtp, DAMLA_EXACT_RTP[mode]);
    assert.equal(e.integerPayoutMismatches, 0);
    assert.ok(e.withinThreeSigma, `${mode}: Monte Carlo within 3 sigma of the exact RTP`);
    assert.ok(Math.abs(c.rtp - DAMLA_EXACT_RTP[mode]) < 0.01);
  }
});
