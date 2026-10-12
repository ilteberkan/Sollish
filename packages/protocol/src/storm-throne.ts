/** Storm Throne engine `storm-throne-1` (working name "Fırtına Tahtı"): DEMO-credit tumble / scatter-pays game,
 * 6x5 grid, three modes (standard, ante, buy), multiplier orbs in the base game AND in the free spins.
 * Pure and deterministic: same 32-hex seed, bet level and mode always give the identical round. No clock, no
 * Math.random, no network, no balance or wager input beyond the bet level. The whole round (all tumbles, free
 * spins and the cap) is resolved before presentation; animation, tab visibility, reduced motion or disconnects
 * cannot change a result. All arithmetic is integer: wins are summed in hundredths of the BET and the payout is
 * floor(betCents * hundredths / 100).
 *
 * This file is self-contained (own RNG, picker, win search, tumble) so the evidence covers these bytes only;
 * `cascade.ts` and `cascade-2.ts` are not imported and stay frozen.
 *
 * Rules (authoritative text: docs/product/storm-throne-spec.md):
 *   - 8+ identical normal symbols anywhere pay (tiers 8-9 / 10-11 / 12+); winners explode, survivors fall in
 *     their column (ids kept), gaps are refilled; repeat until a grid has no win (at most maxTumbles tumbles).
 *   - Scatter: base spin, final grid, 4 / 5 / 6+ scatters pay 3x / 5x / 100x the bet and award 15 free spins.
 *     Free spin, final grid, 3+ scatters award 5 more (no scatter pay in free spins). Total granted <= 200.
 *   - Orbs (symbol "orb", value from STORM_ORB_WEIGHTS) can land in the base game and in free spins. They never
 *     explode; like every non-winning cell they fall with the survivors. orbSum = sum of orb values on the FINAL
 *     grid of the spin.
 *       base spin : win = tumble * (orbSum || 1) + scatterPay. Orbs multiply only when the tumble win is > 0
 *                   (a zero tumble win stays zero); the scatter pay is never multiplied.
 *       free spin : a persistent total multiplier starts at 0 when the feature starts. If the spin's tumble win is
 *                   > 0, orbSum is ADDED to the total first; the tumble win is then multiplied by the new total
 *                   (x1 while the total is still 0). A spin without a tumble win adds nothing. The total is kept
 *                   for the rest of the round (retriggers included).
 *   - appliedMultiplier = (base) orbSum || 1; (free) totalMultiplierAfter || 1.
 *   - Cap 5000 x bet in every mode: the round ends at once, free spins left become 0.
 *
 * Modes (bet = base bet in cents):
 *   standard  cost = bet.          Base table, free table.
 *   ante      cost = bet * 5 / 4.  Base-game scatter weight raised (about 2x feature rate); mode-specific free
 *                                  table; buying is off.
 *   buy       cost = bet * 100.    The base spin's initial grid is guaranteed to hold at least 4 scatters
 *                                  (procedure below), so the 15 free spins always trigger; mode-specific free table.
 * Wins are always measured against the bet. Each mode's RTP is measured against its COST and tuned separately
 * (STORM_RTP, ops/evidence/storm-throne-20261012).
 *
 * RNG and draw order: SplitMix32 expands the seed into xoshiro128**. Initial grid column 0..5, row 0..4 (row 0 on
 * top); every cell draws one symbol (u32), an orb draws its value (u32) right after. Tumble refill: column 0..5,
 * top to bottom within the column, same rule. One stream continues across tumbles and free spins.
 *
 * Buy guarantee procedure (base spin only, after the 30 initial cells are drawn, before any tumble): let k be the
 * number of scatters. While fewer than 4 scatters are on the grid, list the non-scatter cells in column-major order
 * (column 0..5, row 0..4), draw one u32 from the stream, pick index floor(u32 * listLength / 2^32) and turn that cell
 * into a scatter (its id is kept, no new id is drawn; an orb that is replaced loses its value). That is 4 - k extra
 * draws, 0 when k >= 4. Scatters never explode and only move down, so the final grid keeps at least those 4
 * scatters and the free spins are always triggered. Scatter pay still follows the normal 4 / 5 / 6+ table.
 */

export const STORM_ENGINE_ID = "storm-throne-1";
export const STORM_COLS = 6;
export const STORM_ROWS = 5;
export const STORM_MAX_WIN_MULTIPLIER = 5000;
export const STORM_FREE_SPINS_TRIGGER = 15;
export const STORM_FREE_SPINS_RETRIGGER = 5;
/** Safety bound on the free spins granted in one round (the 5000 x cap normally ends a round long before). */
export const STORM_MAX_FREE_SPINS = 200;
/** Safety bound on tumbles per spin. */
export const STORM_MAX_TUMBLES = 100;
export const STORM_BUY_MIN_SCATTERS = 4;

export type StormPaySymbol = "h1" | "h2" | "h3" | "h4" | "l1" | "l2" | "l3" | "l4" | "l5";
export type StormSymbol = StormPaySymbol | "scatter" | "orb";
export type StormMode = "standard" | "ante" | "buy";
export const STORM_MODES: readonly StormMode[] = Object.freeze(["standard", "ante", "buy"] as const);
/** Bet levels in cents (1, 2, 3, 4, 5, 8, 10, 15, 20, 25, 40, 50, 75, 100, 150, 200, 250, 400, 500 DEMO). All divisible by 4. */
export const STORM_BET_LEVELS_CENTS: readonly number[] = Object.freeze([
  100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 40_000, 50_000,
]);
/** Cost = bet * numerator / denominator. */
export const STORM_COST_FRACTION: Readonly<Record<StormMode, readonly [number, number]>> = Object.freeze({
  standard: Object.freeze([1, 1] as const), ante: Object.freeze([5, 4] as const), buy: Object.freeze([100, 1] as const),
});

export interface StormCell { id: number; symbol: StormSymbol; /** Only on orbs. */ multiplier?: number }
/** [col][row], row 0 on top. */
export type StormGrid = StormCell[][];
export interface StormWin { symbol: StormPaySymbol; count: number; payHundredths: number; cells: number[] }
/** steps[0].grid is the first dealt grid; steps[k+1].grid is steps[k].grid with that step's winners removed,
 * survivors dropped (ids kept) and the gaps refilled with fresh ids. The last step has no wins.
 * Cell objects are shared between steps; treat them as read-only. */
export interface StormStep { grid: StormGrid; wins: StormWin[]; stepHundredths: number }
export interface StormSpin {
  index: number; kind: "base" | "free"; steps: StormStep[];
  scatterCount: number; scatterHundredths: number;
  /** Sum of orb values on the final grid (0 = none). */
  orbSum: number;
  /** Same number as orbSum (name kept for consumers written against the Candy Cascade spin shape). */
  multiplierSum: number;
  /** Sum of the steps, before any multiplier. */
  tumbleHundredths: number;
  /** Free-spin total multiplier before this spin (always 0 in the base spin). */
  totalMultiplierBefore: number;
  /** After adding this spin's orbSum when tumbleHundredths > 0 (free spins only; 0 in the base spin). */
  totalMultiplierAfter: number;
  /** The factor applied to tumbleHundredths: base orbSum || 1; free totalMultiplierAfter || 1. */
  appliedMultiplier: number;
  /** tumbleHundredths * appliedMultiplier + scatterHundredths, before the round cap. */
  winHundredths: number;
  /** 15 on trigger, 5 on retrigger, otherwise 0. */
  freeSpinsAwarded: number;
  /** Free spins still to play after this spin (0 once the cap ended the round). */
  freeSpinsLeft: number;
  /** Cumulative round total with the cap applied. */
  totalHundredthsAfter: number;
}
export interface StormRound {
  engine: typeof STORM_ENGINE_ID; seedHex: string; mode: StormMode; betCents: number; costCents: number;
  spins: StormSpin[]; totalHundredths: number; payoutCents: number; capped: boolean; freeSpinsTriggered: boolean;
}

/** Hundredths of the bet per tier [8-9, 10-11, 12+], shared by all modes. */
export const STORM_PAYTABLE: Record<StormPaySymbol, readonly [number, number, number]> = Object.freeze({
  h1: Object.freeze([960, 2400, 5760] as const),
  h2: Object.freeze([480, 1440, 3360] as const),
  h3: Object.freeze([320, 960, 2400] as const),
  h4: Object.freeze([200, 600, 1600] as const),
  l1: Object.freeze([128, 400, 1120] as const),
  l2: Object.freeze([96, 280, 800] as const),
  l3: Object.freeze([72, 200, 600] as const),
  l4: Object.freeze([48, 144, 440] as const),
  l5: Object.freeze([32, 104, 320] as const),
});
/** Base game only, hundredths of the bet for 4, 5 and 6+ scatters on the final grid of a spin. */
export const STORM_SCATTER_PAY: { 4: number; 5: number; 6: number } = Object.freeze({ 4: 300, 5: 500, 6: 10_000 });

export type StormWeighted<T> = readonly (readonly [T, number])[];
export interface StormModeTables {
  /** Base-game symbol weights (scatter and orb included). */
  base: StormWeighted<StormSymbol>;
  /** Free-spin symbol weights (scatter and orb included). */
  free: StormWeighted<StormSymbol>;
}
/** Orb value weights, shared by all modes and by base and free spins. */
export const STORM_ORB_WEIGHTS: StormWeighted<number> = Object.freeze([
  [2, 5600], [3, 4000], [4, 3000], [5, 2200], [6, 1700], [8, 1200], [10, 900], [12, 600], [15, 400], [20, 250],
  [25, 150], [50, 60], [100, 20], [250, 6], [500, 2],
].map(row => Object.freeze(row)) as unknown as StormWeighted<number>);

/** Normal-symbol weights in the order h1..h4, l1..l5, then scatter and orb. Base weights are flatter than the free
 * weights (free spins hit more often, which is what makes the total multiplier accumulate). */
const symbols = (pay: readonly number[], scatter: number, orb: number): StormWeighted<StormSymbol> => [
  ["h1", pay[0]!], ["h2", pay[1]!], ["h3", pay[2]!], ["h4", pay[3]!], ["l1", pay[4]!], ["l2", pay[5]!], ["l3", pay[6]!], ["l4", pay[7]!], ["l5", pay[8]!],
  ["scatter", scatter], ["orb", orb],
];
const BASE_PAY = [56, 76, 100, 126, 156, 172, 184, 194, 200];
/** Free-spin pay weights are written x10 so the orb weight (the free-spin intensity knob) can be tuned in fine steps. */
const FREE_PAY = [500, 660, 880, 1100, 1500, 1760, 2000, 2240, 2400];

const deepFreeze = (tables: Record<StormMode, StormModeTables>): Record<StormMode, StormModeTables> => {
  for (const mode of Object.keys(tables) as StormMode[]) {
    const t = tables[mode];
    for (const list of [t.base, t.free] as readonly (readonly unknown[])[]) { for (const row of list) Object.freeze(row); Object.freeze(list); }
    Object.freeze(t);
  }
  return Object.freeze(tables);
};
/** Weight tables per mode. Tuned by Monte Carlo; see ops/evidence/storm-throne-20261012. */
export const STORM_MODE_TABLES: Record<StormMode, StormModeTables> = deepFreeze({
  standard: { base: symbols(BASE_PAY, 22, 5), free: symbols(FREE_PAY, 160, 405) },
  // Ante: scatter 27 instead of 22 in the base game (about 2x the feature rate); fewer orbs in the free spins so that
  // the doubled trigger rate stays at about 96% of the (5/4) cost.
  ante: { base: symbols(BASE_PAY, 27, 5), free: symbols(FREE_PAY, 160, 303) },
  // Buy: base table as standard (plus the 4-scatter guarantee); orb weight 194 so that the guaranteed feature returns
  // about 96% of its 100 x bet cost.
  buy: { base: symbols(BASE_PAY, 22, 5), free: symbols(FREE_PAY, 160, 194) },
});

export interface StormRtp { rtp: number; ciLow: number; ciHigh: number; rounds: number; hitRate: number; featureRate: number; stdDev: number }
// @evidence-block-begin (engineSourceSha256 in the evidence is the sha256 of this file with the lines from here to the end marker removed)
/** Copied from ops/evidence/storm-throne-20261012/rtp.json (a test keeps them equal). rtp, ciLow and ciHigh are
 * return / COST as ratios (0.96 = 96%), rounded to 3 decimals; hitRate = base spins with any win per round (3
 * decimals); featureRate = rounds that trigger free spins (4 decimals); stdDev = standard deviation of the per-round
 * return in cost units (3 decimals); rounds = simulated rounds. DEMO estimate, not a certified RTP; the 95% interval
 * is a normal approximation and optimistic for this heavy tail. */
export const STORM_RTP: Record<StormMode, StormRtp> = Object.freeze({
  standard: Object.freeze({ rtp: 0.965, ciLow: 0.959, ciHigh: 0.97, rounds: 20_000_000, hitRate: 0.268, featureRate: 0.0024, stdDev: 12.709 }),
  ante: Object.freeze({ rtp: 0.966, ciLow: 0.961, ciHigh: 0.972, rounds: 20_000_000, hitRate: 0.264, featureRate: 0.0049, stdDev: 12.077 }),
  buy: Object.freeze({ rtp: 0.962, ciLow: 0.962, ciHigh: 0.963, rounds: 20_000_000, hitRate: 1, featureRate: 1, stdDev: 1.353 }),
});
// @evidence-block-end

// --- Compiled configuration ---------------------------------------------------------------------
interface Compiled<T> { items: T[]; cumulative: number[]; total: number }
interface ModeConfig { base: Compiled<StormSymbol>; free: Compiled<StormSymbol> }
interface EngineConfig {
  modes: Record<StormMode, ModeConfig>;
  orbs: Compiled<number>;
  paytable: Record<StormPaySymbol, readonly [number, number, number]>;
  scatterPay: { 4: number; 5: number; 6: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; buyMinScatters: number;
}
export type StormTuning = Partial<{
  tables: Partial<Record<StormMode, Partial<StormModeTables>>>;
  orbs: StormWeighted<number>;
  paytable: Record<StormPaySymbol, readonly [number, number, number]>;
  scatterPay: { 4: number; 5: number; 6: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; buyMinScatters: number;
}>;

const PAY_SYMBOLS: readonly StormPaySymbol[] = ["h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4", "l5"];
const SEED_PATTERN = /^[0-9a-f]{32}$/;
const TWO_POW_32 = 4_294_967_296;
const BET_LEVELS = new Set<number>(STORM_BET_LEVELS_CENTS);

function compile<T>(table: StormWeighted<T>): Compiled<T> {
  let total = 0;
  const cumulative = table.map(([, w]) => {
    if (!Number.isSafeInteger(w) || w < 0) throw new RangeError("Weights must be non-negative safe integers");
    return (total += w);
  });
  if (total <= 0) throw new RangeError("A weight table needs a positive total");
  return { items: table.map(([item]) => item), cumulative, total };
}
function pick<T>(table: Compiled<T>, rng: () => number): T {
  // u32 * total < 2^53, so the product and the division by 2^32 are exact in doubles.
  const target = Math.floor(rng() * table.total / TWO_POW_32);
  let i = 0;
  while (table.cumulative[i]! <= target) i++;
  return table.items[i]!;
}
function configFrom(tuning: StormTuning): EngineConfig {
  const modes = {} as Record<StormMode, ModeConfig>;
  for (const mode of STORM_MODES) {
    const base = STORM_MODE_TABLES[mode], over = tuning.tables?.[mode] ?? {};
    modes[mode] = { base: compile(over.base ?? base.base), free: compile(over.free ?? base.free) };
  }
  return {
    modes, orbs: compile(tuning.orbs ?? STORM_ORB_WEIGHTS), paytable: tuning.paytable ?? STORM_PAYTABLE,
    scatterPay: tuning.scatterPay ?? STORM_SCATTER_PAY,
    capHundredths: tuning.capHundredths ?? STORM_MAX_WIN_MULTIPLIER * 100,
    maxFreeSpins: tuning.maxFreeSpins ?? STORM_MAX_FREE_SPINS, maxTumbles: tuning.maxTumbles ?? STORM_MAX_TUMBLES,
    buyMinScatters: tuning.buyMinScatters ?? STORM_BUY_MIN_SCATTERS,
  };
}
const DEFAULT_CONFIG = configFrom({});

// --- RNG ------------------------------------------------------------------------------------------
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
  for (let i = 0; i < 8; i++) next(); // discard the first outputs while the state diffuses
  return next;
}

// --- Grid mechanics -------------------------------------------------------------------------------
interface Dealer { rng: () => number; table: Compiled<StormSymbol>; orbs: Compiled<number>; nextId: number }
function dealCell(d: Dealer): StormCell {
  const symbol = pick(d.table, d.rng);
  const id = d.nextId++;
  return symbol === "orb" ? { id, symbol, multiplier: pick(d.orbs, d.rng) } : { id, symbol };
}
function dealGrid(d: Dealer): StormGrid {
  const grid: StormGrid = [];
  for (let c = 0; c < STORM_COLS; c++) {
    const column: StormCell[] = [];
    for (let r = 0; r < STORM_ROWS; r++) column.push(dealCell(d));
    grid.push(column);
  }
  return grid;
}
/** Buy guarantee: turns RNG-chosen non-scatter cells into scatters until the grid holds `minScatters`. See the file header. */
function ensureScatters(grid: StormGrid, minScatters: number, rng: () => number): void {
  let scatters = 0;
  for (const column of grid) for (const cell of column) if (cell.symbol === "scatter") scatters++;
  while (scatters < minScatters) {
    const spots: [number, number][] = [];
    for (let c = 0; c < STORM_COLS; c++) for (let r = 0; r < STORM_ROWS; r++) if (grid[c]![r]!.symbol !== "scatter") spots.push([c, r]);
    const [c, r] = spots[Math.floor(rng() * spots.length / TWO_POW_32)]!;
    grid[c]![r] = { id: grid[c]![r]!.id, symbol: "scatter" };
    scatters++;
  }
}
function tierIndex(count: number): 0 | 1 | 2 { return count >= 12 ? 2 : count >= 10 ? 1 : 0; }
function findWins(grid: StormGrid, paytable: EngineConfig["paytable"]): StormWin[] {
  const cells = new Map<StormPaySymbol, number[]>();
  for (const column of grid) for (const cell of column) {
    if (cell.symbol === "scatter" || cell.symbol === "orb") continue;
    const list = cells.get(cell.symbol);
    if (list) list.push(cell.id); else cells.set(cell.symbol, [cell.id]);
  }
  const wins: StormWin[] = [];
  for (const symbol of PAY_SYMBOLS) {
    const ids = cells.get(symbol);
    if (ids && ids.length >= 8) wins.push({ symbol, count: ids.length, payHundredths: paytable[symbol][tierIndex(ids.length)], cells: ids });
  }
  return wins;
}
function tumbleGrid(grid: StormGrid, wins: readonly StormWin[], d: Dealer): StormGrid {
  const removed = new Set<number>();
  for (const win of wins) for (const id of win.cells) removed.add(id);
  const survivors = grid.map(column => column.filter(cell => !removed.has(cell.id)));
  return survivors.map(column => {
    const fresh: StormCell[] = [];
    for (let missing = STORM_ROWS - column.length; missing > 0; missing--) fresh.push(dealCell(d));
    return [...fresh, ...column];
  });
}

type SpinCore = Omit<StormSpin, "freeSpinsAwarded" | "freeSpinsLeft" | "totalHundredthsAfter">;
function playSpin(cfg: EngineConfig, d: Dealer, kind: "base" | "free", index: number, guaranteeScatters: number, totalMultiplier: number): SpinCore {
  let grid = dealGrid(d);
  if (guaranteeScatters > 0) ensureScatters(grid, guaranteeScatters, d.rng);
  const steps: StormStep[] = [];
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
  let scatterCount = 0, orbSum = 0;
  for (const column of grid) for (const cell of column) {
    if (cell.symbol === "scatter") scatterCount++;
    else if (cell.symbol === "orb") orbSum += cell.multiplier ?? 0;
  }
  const scatterHundredths = kind === "base" && scatterCount >= 4 ? cfg.scatterPay[scatterCount >= 6 ? 6 : scatterCount === 5 ? 5 : 4] : 0;
  let before = 0, after = 0, applied: number;
  if (kind === "base") applied = orbSum || 1;
  else {
    before = totalMultiplier;
    after = tumbleHundredths > 0 ? before + orbSum : before;
    applied = after || 1;
  }
  const winHundredths = tumbleHundredths * applied + scatterHundredths;
  return {
    index, kind, steps, scatterCount, scatterHundredths, orbSum, multiplierSum: orbSum, tumbleHundredths,
    totalMultiplierBefore: before, totalMultiplierAfter: after, appliedMultiplier: applied, winHundredths,
  };
}

function costOf(betCents: number, mode: StormMode): number {
  const [num, den] = STORM_COST_FRACTION[mode];
  return (betCents * num) / den;
}
function validate(seedHex: unknown, betCents: unknown, mode: unknown): asserts seedHex is string {
  if (typeof seedHex !== "string" || !SEED_PATTERN.test(seedHex)) throw new RangeError("seedHex must be 32 lowercase hex characters");
  if (typeof betCents !== "number" || !BET_LEVELS.has(betCents)) throw new RangeError("betCents must be one of STORM_BET_LEVELS_CENTS");
  if (typeof mode !== "string" || !(STORM_MODES as readonly string[]).includes(mode)) throw new RangeError("mode must be standard, ante or buy");
}

function playRound(cfg: EngineConfig, seedHex: string, betCents: number, mode: StormMode): StormRound {
  validate(seedHex, betCents, mode);
  const tables = cfg.modes[mode];
  const dealer: Dealer = { rng: createRng(seedHex), table: tables.base, orbs: cfg.orbs, nextId: 0 };
  const spins: StormSpin[] = [];
  let total = 0, capped = false, freeLeft = 0, freeGranted = 0, triggered = false, totalMultiplier = 0;
  for (let index = 0; ; index++) {
    const kind = index === 0 ? "base" : "free";
    if (kind === "free") freeLeft--;
    dealer.table = kind === "base" ? tables.base : tables.free;
    const spin = playSpin(cfg, dealer, kind, index, kind === "base" && mode === "buy" ? cfg.buyMinScatters : 0, totalMultiplier);
    totalMultiplier = spin.totalMultiplierAfter;
    const wanted = kind === "base" ? (spin.scatterCount >= 4 ? STORM_FREE_SPINS_TRIGGER : 0) : (spin.scatterCount >= 3 ? STORM_FREE_SPINS_RETRIGGER : 0);
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
    engine: STORM_ENGINE_ID, seedHex, mode, betCents, costCents: costOf(betCents, mode),
    spins, totalHundredths: total, payoutCents, capped, freeSpinsTriggered: triggered,
  };
}

/** Cost in cents of one round: standard = bet, ante = bet * 5 / 4, buy = bet * 100.
 * Throws RangeError for a bet that is not a level of STORM_BET_LEVELS_CENTS or an unknown mode. */
export function stormCostCents(betCents: number, mode: StormMode): number {
  validate("0".repeat(32), betCents, mode);
  return costOf(betCents, mode);
}

/** Resolves a whole round: base spin, tumbles, orbs, any free spins, the 5000 x bet cap and the integer payout.
 * Throws RangeError for a seed that is not 32 lowercase hex characters, a bet outside the levels or an unknown mode. */
export function playStormRound(seedHex: string, betCents: number, mode: StormMode): StormRound {
  return playRound(DEFAULT_CONFIG, seedHex, betCents, mode);
}

/** 4 x uint32 (for example crypto.getRandomValues) -> 32 lowercase hex characters, word 0 first. */
export function stormSeedFromEntropy(words: Uint32Array): string {
  if (!(words instanceof Uint32Array) || words.length !== 4) throw new RangeError("Entropy must be a Uint32Array of 4 words");
  let out = "";
  for (let i = 0; i < 4; i++) out += (words[i]! >>> 0).toString(16).padStart(8, "0");
  return out;
}

/** Test and simulation hooks: not part of the public game API. */
export const __stormTest = {
  play: (seedHex: string, betCents: number, mode: StormMode, tuning: StormTuning = {}): StormRound => playRound(configFrom(tuning), seedHex, betCents, mode),
  createRng,
  findWins: (grid: StormGrid, paytable: EngineConfig["paytable"] = STORM_PAYTABLE): StormWin[] => findWins(grid, paytable),
  ensureScatters: (grid: StormGrid, minScatters: number, seedHex: string): void => ensureScatters(grid, minScatters, createRng(seedHex)),
};
