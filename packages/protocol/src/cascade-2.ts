/** Candy Cascade engine `candy-cascade-2`: DEMO-credit tumble / scatter-pays game, 6x5 grid, three modes
 * (standard, ante, buy). Pure and deterministic: same 32-hex seed, bet level and mode always give the
 * identical round. No clock, no Math.random, no network, no balance or wager input beyond the bet level.
 * The whole round (all tumbles, free spins and the cap) is resolved before presentation; animation, tab
 * visibility, reduced motion or disconnects cannot change a result. All arithmetic is integer: wins are
 * summed in hundredths of the BET and the payout is floor(betCents * hundredths / 100).
 *
 * `candy-cascade-1` (cascade.ts) stays frozen. This file duplicates the few helpers it needs (RNG,
 * weighted pick, win search, tumble) instead of importing them, so v2 evidence covers v2 bytes only.
 * With mode "standard" the draw order and tables equal v1, so a standard v2 round replays the v1 spins
 * for the same seed (tested); v2 only adds the bet-level check, the cost and the two extra modes.
 *
 * Modes (bet = base bet in cents):
 *   standard  cost = bet.          v1 rules and v1 tables.
 *   ante      cost = bet * 5 / 4.  Base-game star weight raised (about 2x free-spin trigger rate);
 *                                  mode-specific free-spin weights; buying is off.
 *   buy       cost = bet * 100.    The base spin's initial grid is guaranteed to hold at least 4 stars
 *                                  (procedure below), so the 10 free spins always trigger; mode-specific
 *                                  free-spin weights.
 * Wins are always measured against the bet; the cap is 5000 x bet in every mode. Each mode's RTP is
 * measured against its COST and is tuned separately (CASCADE2_RTP, ops/evidence/candy-cascade-2-20261011).
 *
 * RNG and draw order (identical to v1): SplitMix32 expands the seed into xoshiro128**. Initial grid
 * column 0..5, row 0..4 (row 0 on top); every cell draws one symbol, a crystal draws its value right
 * after. Tumble refill: column 0..5, top to bottom within the column, same rule. One stream continues
 * across tumbles and free spins.
 *
 * Buy guarantee procedure (base spin only, after the 30 initial cells are drawn, before any tumble): let k
 * be the number of stars. While fewer than 4 stars are on the grid, list the non-star cells in column-major
 * order (column 0..5, row 0..4), draw one u32 from the stream, pick index floor(u32 * listLength / 2^32)
 * and turn that cell into a star (its id is kept, no new id is drawn). That is 4 - k extra draws, 0 when
 * k >= 4. Stars never explode and only move down, so the final grid keeps at least those 4 stars and the
 * free spins are always triggered. Scatter pay for the stars still follows the normal 4 / 5 / 6+ table.
 */
import {
  CASCADE_COLS, CASCADE_FREE_SPINS_RETRIGGER, CASCADE_FREE_SPINS_TRIGGER, CASCADE_MAX_FREE_SPINS, CASCADE_MAX_TUMBLES,
  CASCADE_MAX_WIN_MULTIPLIER, CASCADE_ROWS,
  type CascadeCell, type CascadeGrid, type CascadePaySymbol, type CascadeRound, type CascadeSpin, type CascadeStep,
  type CascadeSymbol, type CascadeWin,
} from "./cascade";

export const CASCADE2_ENGINE_ID = "candy-cascade-2";
export type CascadeMode = "standard" | "ante" | "buy";
export const CASCADE2_MODES: readonly CascadeMode[] = Object.freeze(["standard", "ante", "buy"] as const);
/** Bet levels in cents (1, 2, 3, 4, 5, 8, 10, 15, 20, 25, 40, 50, 75, 100, 150, 200, 250, 400, 500 DEMO). All divisible by 4. */
export const CASCADE2_BET_LEVELS_CENTS: readonly number[] = Object.freeze([
  100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 40_000, 50_000,
]);
export const CASCADE2_MAX_WIN_MULTIPLIER = CASCADE_MAX_WIN_MULTIPLIER;
/** Cost = bet * numerator / denominator. */
export const CASCADE2_COST_FRACTION: Readonly<Record<CascadeMode, readonly [number, number]>> = Object.freeze({
  standard: Object.freeze([1, 1] as const), ante: Object.freeze([5, 4] as const), buy: Object.freeze([100, 1] as const),
});
export const CASCADE2_BUY_MIN_STARS = 4;

/** Hundredths of the bet per tier [8-9, 10-11, 12+]. Same values as v1, shared by all modes. */
export const CASCADE2_PAYTABLE: Record<CascadePaySymbol, readonly [number, number, number]> = Object.freeze({
  crown: Object.freeze([2023, 5058, 10_115] as const),
  cupcake: Object.freeze([1012, 3034, 6069] as const),
  donut: Object.freeze([607, 2023, 4046] as const),
  gumdrop: Object.freeze([405, 1214, 3034] as const),
  strawberry: Object.freeze([202, 607, 1618] as const),
  blueberry: Object.freeze([152, 405, 1214] as const),
  kiwi: Object.freeze([101, 303, 1012] as const),
  lemon: Object.freeze([81, 243, 809] as const),
  cherry: Object.freeze([51, 202, 607] as const),
});
/** Base game only, hundredths of the bet for 4, 5 and 6+ stars on the final grid of a spin. */
export const CASCADE2_SCATTER_PAY: { 4: number; 5: number; 6: number } = Object.freeze({ 4: 300, 5: 500, 6: 10_000 });

export type Cascade2Weighted<T> = readonly (readonly [T, number])[];
export interface Cascade2ModeTables {
  /** Base-game symbol weights. */
  base: Cascade2Weighted<CascadeSymbol>;
  /** Free-spin symbol weights (crystals only appear here). */
  free: Cascade2Weighted<CascadeSymbol>;
  /** Crystal value weights. */
  crystals: Cascade2Weighted<number>;
}

const V1_BASE: Cascade2Weighted<CascadeSymbol> = [
  ["crown", 60], ["cupcake", 80], ["donut", 100], ["gumdrop", 120],
  ["strawberry", 160], ["blueberry", 170], ["kiwi", 180], ["lemon", 190], ["cherry", 200], ["star", 21],
];
const V1_FREE: Cascade2Weighted<CascadeSymbol> = [
  ["crown", 93], ["cupcake", 114], ["donut", 133], ["gumdrop", 142],
  ["strawberry", 138], ["blueberry", 107], ["kiwi", 86], ["lemon", 57], ["cherry", 38], ["star", 21], ["crystal", 100],
];
/** Same as V1_BASE with a different star weight (21 in v1). Ante uses 26: about 2.1x the free-spin trigger rate. */
const withStar = (star: number): Cascade2Weighted<CascadeSymbol> => V1_BASE.map(([s, w]) => [s, s === "star" ? star : w] as const);
/** Same as V1_FREE with a different crystal weight (100 in v1); this is the free-spin intensity knob. */
const withCrystal = (crystal: number): Cascade2Weighted<CascadeSymbol> => V1_FREE.map(([s, w]) => [s, s === "crystal" ? crystal : w] as const);
const V1_CRYSTALS: Cascade2Weighted<number> = [
  [2, 600], [3, 440], [4, 320], [5, 220], [6, 160], [8, 100], [10, 70], [12, 40], [15, 24], [20, 14], [25, 8], [50, 3], [100, 1],
];

const deepFreeze = <T>(tables: Record<CascadeMode, Cascade2ModeTables>): Record<CascadeMode, Cascade2ModeTables> => {
  for (const mode of Object.keys(tables) as CascadeMode[]) {
    const t = tables[mode];
    for (const list of [t.base, t.free, t.crystals] as readonly (readonly unknown[])[]) { for (const row of list) Object.freeze(row); Object.freeze(list); }
    Object.freeze(t);
  }
  return Object.freeze(tables);
};
/** Weight tables per mode. Tuned by Monte Carlo; see ops/evidence/candy-cascade-2-20261011. */
export const CASCADE2_MODE_TABLES: Record<CascadeMode, Cascade2ModeTables> = deepFreeze({
  standard: { base: V1_BASE, free: V1_FREE, crystals: V1_CRYSTALS },
  // Ante: star 26 instead of 21 in the base game; crystal weight 47 instead of 100 in the free spins so that the
  // doubled trigger rate does not push the return above 96% of the (5/4) cost.
  ante: { base: withStar(26), free: withCrystal(47), crystals: V1_CRYSTALS },
  // Buy: base table as standard (plus the 4-star guarantee); crystal weight 21 so that the guaranteed feature
  // returns about 96% of its 100 x bet cost.
  buy: { base: V1_BASE, free: withCrystal(21), crystals: V1_CRYSTALS },
});

export interface Cascade2Rtp { rtp: number; ciLow: number; ciHigh: number; rounds: number; hitRate: number; featureRate: number; stdDev: number }
// @evidence-block-begin (engineSourceSha256 in the evidence is the sha256 of this file with the lines from here to the end marker removed)
/** Copied from ops/evidence/candy-cascade-2-20261011/rtp.json (a test keeps them equal). rtp, ciLow and ciHigh
 * are return / COST as ratios (0.96 = 96%), rounded to 3 decimals; hitRate = base spins with any win per round
 * (3 decimals); featureRate = rounds that trigger free spins (4 decimals); stdDev = standard deviation of the
 * per-round return in cost units (3 decimals); rounds = simulated rounds. DEMO estimate, not a certified RTP;
 * the 95% interval is a normal approximation and optimistic for this heavy tail. */
export const CASCADE2_RTP: Record<CascadeMode, Cascade2Rtp> = Object.freeze({
  standard: Object.freeze({ rtp: 0.957, ciLow: 0.951, ciHigh: 0.963, rounds: 20_000_000, hitRate: 0.265, featureRate: 0.0021, stdDev: 13.874 }),
  ante: Object.freeze({ rtp: 0.963, ciLow: 0.957, ciHigh: 0.968, rounds: 20_000_000, hitRate: 0.262, featureRate: 0.0044, stdDev: 12.742 }),
  buy: Object.freeze({ rtp: 0.962, ciLow: 0.961, ciHigh: 0.962, rounds: 20_000_000, hitRate: 1, featureRate: 1, stdDev: 1.319 }),
});
// @evidence-block-end

export interface Cascade2Round extends Omit<CascadeRound, "engine"> {
  engine: typeof CASCADE2_ENGINE_ID; mode: CascadeMode; betCents: number; costCents: number;
}

// --- Compiled configuration ---------------------------------------------------------------------
interface Compiled<T> { items: T[]; cumulative: number[]; total: number }
interface ModeConfig { base: Compiled<CascadeSymbol>; free: Compiled<CascadeSymbol>; crystals: Compiled<number> }
interface EngineConfig {
  modes: Record<CascadeMode, ModeConfig>;
  paytable: Record<CascadePaySymbol, readonly [number, number, number]>;
  scatterPay: { 4: number; 5: number; 6: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; buyMinStars: number;
}
export type Cascade2Tuning = Partial<{
  tables: Partial<Record<CascadeMode, Partial<Cascade2ModeTables>>>;
  paytable: Record<CascadePaySymbol, readonly [number, number, number]>;
  scatterPay: { 4: number; 5: number; 6: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; buyMinStars: number;
}>;

const PAY_SYMBOLS: readonly CascadePaySymbol[] = ["crown", "cupcake", "donut", "gumdrop", "strawberry", "blueberry", "kiwi", "lemon", "cherry"];
const SEED_PATTERN = /^[0-9a-f]{32}$/;
const TWO_POW_32 = 4_294_967_296;
const BET_LEVELS = new Set<number>(CASCADE2_BET_LEVELS_CENTS);

function compile<T>(table: Cascade2Weighted<T>): Compiled<T> {
  let total = 0;
  const cumulative = table.map(([, w]) => {
    if (!Number.isSafeInteger(w) || w <= 0) throw new RangeError("Weights must be positive safe integers");
    return (total += w);
  });
  return { items: table.map(([item]) => item), cumulative, total };
}
function pick<T>(table: Compiled<T>, rng: () => number): T {
  // u32 * total < 2^53, so the product and the division by 2^32 are exact in doubles.
  const target = Math.floor(rng() * table.total / TWO_POW_32);
  let i = 0;
  while (table.cumulative[i]! <= target) i++;
  return table.items[i]!;
}
function configFrom(tuning: Cascade2Tuning): EngineConfig {
  const modes = {} as Record<CascadeMode, ModeConfig>;
  for (const mode of CASCADE2_MODES) {
    const base = CASCADE2_MODE_TABLES[mode], over = tuning.tables?.[mode] ?? {};
    modes[mode] = { base: compile(over.base ?? base.base), free: compile(over.free ?? base.free), crystals: compile(over.crystals ?? base.crystals) };
  }
  return {
    modes, paytable: tuning.paytable ?? CASCADE2_PAYTABLE, scatterPay: tuning.scatterPay ?? CASCADE2_SCATTER_PAY,
    capHundredths: tuning.capHundredths ?? CASCADE2_MAX_WIN_MULTIPLIER * 100,
    maxFreeSpins: tuning.maxFreeSpins ?? CASCADE_MAX_FREE_SPINS, maxTumbles: tuning.maxTumbles ?? CASCADE_MAX_TUMBLES,
    buyMinStars: tuning.buyMinStars ?? CASCADE2_BUY_MIN_STARS,
  };
}
const DEFAULT_CONFIG = configFrom({});

// --- RNG (same construction as v1) --------------------------------------------------------------
function splitMix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}
const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
function createRng(seedHex: string): () => number {
  const words = [0, 1, 2, 3].map(i => parseInt(seedHex.slice(i * 8, i * 8 + 8), 16) >>> 0);
  const fold = (words[0]! ^ rotl(words[1]!, 8) ^ rotl(words[2]!, 16) ^ rotl(words[3]!, 24)) >>> 0;
  const expand = splitMix32(fold);
  let s0 = (expand() ^ words[0]!) >>> 0, s1 = (expand() ^ words[1]!) >>> 0;
  let s2 = (expand() ^ words[2]!) >>> 0, s3 = (expand() ^ words[3]!) >>> 0;
  if ((s0 | s1 | s2 | s3) === 0) s0 = 0x9e3779b9;
  const next = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0; s3 = (s3 ^ s1) >>> 0; s1 = (s1 ^ s2) >>> 0; s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0; s3 = rotl(s3, 11);
    return result;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

// --- Grid mechanics -----------------------------------------------------------------------------
interface Dealer { rng: () => number; table: Compiled<CascadeSymbol>; crystals: Compiled<number>; nextId: number }
function dealCell(d: Dealer): CascadeCell {
  const symbol = pick(d.table, d.rng);
  const id = d.nextId++;
  return symbol === "crystal" ? { id, symbol, multiplier: pick(d.crystals, d.rng) } : { id, symbol };
}
function dealGrid(d: Dealer): CascadeGrid {
  const grid: CascadeGrid = [];
  for (let c = 0; c < CASCADE_COLS; c++) {
    const column: CascadeCell[] = [];
    for (let r = 0; r < CASCADE_ROWS; r++) column.push(dealCell(d));
    grid.push(column);
  }
  return grid;
}
/** Buy guarantee: turns RNG-chosen non-star cells into stars until the grid holds `minStars`. See the file header. */
function ensureStars(grid: CascadeGrid, minStars: number, rng: () => number): void {
  let stars = 0;
  for (const column of grid) for (const cell of column) if (cell.symbol === "star") stars++;
  while (stars < minStars) {
    const spots: [number, number][] = [];
    for (let c = 0; c < CASCADE_COLS; c++) for (let r = 0; r < CASCADE_ROWS; r++) if (grid[c]![r]!.symbol !== "star") spots.push([c, r]);
    const [c, r] = spots[Math.floor(rng() * spots.length / TWO_POW_32)]!;
    grid[c]![r] = { id: grid[c]![r]!.id, symbol: "star" };
    stars++;
  }
}
function tierIndex(count: number): 0 | 1 | 2 { return count >= 12 ? 2 : count >= 10 ? 1 : 0; }
function findWins(grid: CascadeGrid, paytable: EngineConfig["paytable"]): CascadeWin[] {
  const cells = new Map<CascadePaySymbol, number[]>();
  for (const column of grid) for (const cell of column) {
    if (cell.symbol === "star" || cell.symbol === "crystal") continue;
    const list = cells.get(cell.symbol);
    if (list) list.push(cell.id); else cells.set(cell.symbol, [cell.id]);
  }
  const wins: CascadeWin[] = [];
  for (const symbol of PAY_SYMBOLS) {
    const ids = cells.get(symbol);
    if (ids && ids.length >= 8) wins.push({ symbol, count: ids.length, payHundredths: paytable[symbol][tierIndex(ids.length)], cells: ids });
  }
  return wins;
}
function tumbleGrid(grid: CascadeGrid, wins: readonly CascadeWin[], d: Dealer): CascadeGrid {
  const removed = new Set<number>();
  for (const win of wins) for (const id of win.cells) removed.add(id);
  const survivors = grid.map(column => column.filter(cell => !removed.has(cell.id)));
  return survivors.map(column => {
    const fresh: CascadeCell[] = [];
    for (let missing = CASCADE_ROWS - column.length; missing > 0; missing--) fresh.push(dealCell(d));
    return [...fresh, ...column];
  });
}

function playSpin(cfg: EngineConfig, d: Dealer, kind: "base" | "free", index: number, guaranteeStars: number): Omit<CascadeSpin, "freeSpinsAwarded" | "freeSpinsLeft" | "totalHundredthsAfter"> {
  let grid = dealGrid(d);
  if (guaranteeStars > 0) ensureStars(grid, guaranteeStars, d.rng);
  const steps: CascadeStep[] = [];
  let tumbleHundredths = 0;
  for (let t = 0; ; t++) {
    const wins = t >= cfg.maxTumbles ? [] : findWins(grid, cfg.paytable);
    let stepHundredths = 0;
    for (const win of wins) stepHundredths += win.payHundredths;
    steps.push({ grid, wins, stepHundredths });
    tumbleHundredths += stepHundredths;
    if (wins.length === 0) break;
    grid = tumbleGrid(grid, wins, d);
  }
  let scatterCount = 0, multiplierSum = 0;
  for (const column of grid) for (const cell of column) {
    if (cell.symbol === "star") scatterCount++;
    else if (cell.symbol === "crystal") multiplierSum += cell.multiplier ?? 0;
  }
  const scatterHundredths = kind === "base" && scatterCount >= 4 ? cfg.scatterPay[scatterCount >= 6 ? 6 : scatterCount === 5 ? 5 : 4] : 0;
  const winHundredths = tumbleHundredths * (multiplierSum || 1) + scatterHundredths;
  return { index, kind, steps, scatterCount, scatterHundredths, multiplierSum, tumbleHundredths, winHundredths };
}

function costOf(betCents: number, mode: CascadeMode): number {
  const [num, den] = CASCADE2_COST_FRACTION[mode];
  return (betCents * num) / den;
}
function validate(seedHex: unknown, betCents: unknown, mode: unknown): asserts seedHex is string {
  if (typeof seedHex !== "string" || !SEED_PATTERN.test(seedHex)) throw new RangeError("seedHex must be 32 lowercase hex characters");
  if (typeof betCents !== "number" || !BET_LEVELS.has(betCents)) throw new RangeError("betCents must be one of CASCADE2_BET_LEVELS_CENTS");
  if (typeof mode !== "string" || !(CASCADE2_MODES as readonly string[]).includes(mode)) throw new RangeError("mode must be standard, ante or buy");
}

function playRound(cfg: EngineConfig, seedHex: string, betCents: number, mode: CascadeMode): Cascade2Round {
  validate(seedHex, betCents, mode);
  const tables = cfg.modes[mode];
  const dealer: Dealer = { rng: createRng(seedHex), table: tables.base, crystals: tables.crystals, nextId: 0 };
  const spins: CascadeSpin[] = [];
  let total = 0, capped = false, freeLeft = 0, freeGranted = 0, triggered = false;
  for (let index = 0; ; index++) {
    const kind = index === 0 ? "base" : "free";
    if (kind === "free") freeLeft--;
    dealer.table = kind === "base" ? tables.base : tables.free;
    const spin = playSpin(cfg, dealer, kind, index, kind === "base" && mode === "buy" ? cfg.buyMinStars : 0);
    const wanted = kind === "base" ? (spin.scatterCount >= 4 ? CASCADE_FREE_SPINS_TRIGGER : 0) : (spin.scatterCount >= 3 ? CASCADE_FREE_SPINS_RETRIGGER : 0);
    const awarded = Math.max(0, Math.min(wanted, cfg.maxFreeSpins - freeGranted));
    freeGranted += awarded;
    freeLeft += awarded;
    if (kind === "base" && awarded > 0) triggered = true;
    const raw = total + spin.winHundredths;
    if (raw >= cfg.capHundredths) { total = cfg.capHundredths; capped = true; freeLeft = 0; } else total = raw;
    spins.push({ ...spin, freeSpinsAwarded: awarded, freeSpinsLeft: freeLeft, totalHundredthsAfter: total });
    if (capped || freeLeft <= 0) break;
  }
  const payoutCents = Number(BigInt(betCents) * BigInt(total) / 100n);
  return {
    engine: CASCADE2_ENGINE_ID, seedHex, stakeCents: betCents, mode, betCents, costCents: costOf(betCents, mode),
    spins, totalHundredths: total, payoutCents, capped, freeSpinsTriggered: triggered,
  };
}

/** Cost in cents of one round: standard = bet, ante = bet * 5 / 4, buy = bet * 100.
 * Throws RangeError for a bet that is not a level of CASCADE2_BET_LEVELS_CENTS or an unknown mode. */
export function cascadeCostCents(betCents: number, mode: CascadeMode): number {
  validate("0".repeat(32), betCents, mode);
  return costOf(betCents, mode);
}

/** Resolves a whole round: base spin, tumbles, any free spins, the 5000 x bet cap and the integer payout.
 * Throws RangeError for a seed that is not 32 lowercase hex characters, a bet outside the levels or an unknown mode. */
export function playCascade2Round(seedHex: string, betCents: number, mode: CascadeMode): Cascade2Round {
  return playRound(DEFAULT_CONFIG, seedHex, betCents, mode);
}

/** Test and simulation hooks: not part of the public game API. */
export const __cascade2Test = {
  play: (seedHex: string, betCents: number, mode: CascadeMode, tuning: Cascade2Tuning = {}): Cascade2Round => playRound(configFrom(tuning), seedHex, betCents, mode),
  createRng,
  findWins: (grid: CascadeGrid, paytable: EngineConfig["paytable"] = CASCADE2_PAYTABLE): CascadeWin[] => findWins(grid, paytable),
  ensureStars: (grid: CascadeGrid, minStars: number, seedHex: string): void => ensureStars(grid, minStars, createRng(seedHex)),
};
