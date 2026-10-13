/** Ebru engine `ebru-ink-1` ("Ebru: Mürekkep Bahçesi"): DEMO-credit cluster-pays / tumble game on a 7x7 grid with the
 * deterministic COMB transform, three modes (standard, ante, buy) and the Lale Ebrusu free spins with stain multipliers.
 * Pure and deterministic: same 32-hex seed, bet level and mode always give the identical round. No clock, no
 * Math.random, no network, no balance or wager input beyond the bet level. The whole round (every tumble, comb pass,
 * free spin and the cap) is resolved before presentation; animation, tab visibility, reduced motion or disconnects
 * cannot change a result. All arithmetic is integer (the comb uses an integer sine table): wins are summed in
 * hundredths of the BET and the payout is floor(betCents * hundredths / 100).
 *
 * This file is self-contained (own RNG, picker, cluster search, tumble, comb) so the evidence covers these bytes
 * only; the other slot engines are not imported and stay frozen.
 *
 * Rules (authoritative text: docs/product/games-wave2.md section 2):
 *   - Grid 7 columns x 7 rows, grid[col][row], row 0 on top. Symbols: eight ink colours c1..c8 (c1 pays most), the
 *     wild `drop` and the scatter `comb` (Altin Tarak). The free-spin tables use c1..c7 only (c8 has weight 0 there).
 *   - Cluster pays: orthogonally (up/down/left/right) connected cells of the same colour, 5 or more. The size picks a
 *     tier of EBRU_CLUSTER_TIER_STARTS; the pay is EBRU_PAYTABLE[colour][tier] hundredths of the bet. All clusters of
 *     one grid pay (no cell belongs to two clusters).
 *   - Tumble: winning clusters burst, survivors fall inside their column (ids kept), gaps are refilled from the top.
 *   - Drop (ink bleed): a `drop` never takes part in a cluster; when it lands (initial deal or refill) it bleeds. In
 *     column-major order (col 0..6, row 0..6) for the drops present when the pass starts: count the colours of its 4
 *     orthogonal neighbours (comb scatters, not-yet-bled drops and the board edge do not count); the most frequent
 *     colour wins (a tie costs one RNG draw: index floor(u32 * n / 2^32) into the tied colours in c1..c6 order; no
 *     coloured neighbour at all costs one draw too: colour index floor(u32 * 8 / 2^32), any of c1..c8). Every coloured neighbour
 *     becomes that colour (ids kept), then the drop itself becomes that colour. One `bleed` step per drop.
 *   - Comb pass: whenever a grid has no cluster (end of a tumble chain, which includes a spin that never won) and fewer
 *     than EBRU_MAX_COMB_PASSES (3) passes were done in this spin, the comb sweeps the board once. It draws amplitude
 *     A (EBRU_COMB_AMPLITUDE_WEIGHTS: 1, 2 or 3), phase index p = floor(u32 * 64 / 2^32) and row-step index q
 *     (EBRU_COMB_STEP_WEIGHTS). Row r (0..6, top to bottom) is shifted cyclically by
 *       shift_r = roundHalfAwayFromZero(A * SIN[(p + r * q) mod 64] / 1000)
 *     where SIN[i] = round(1000 * sin(2 * pi * i / 64)) is the integer table EBRU_SIN_TABLE (phi = p * 2pi/64, k = q *
 *     2pi/64). A positive shift moves cells toward higher column numbers (to the right): new[(c + shift) mod 7][r] =
 *     old[c][r]. The shifts are a permutation of every row, so symbols (scatters included) are only moved, never
 *     created or removed. If the pass leaves at least one cluster the tumble chain continues; otherwise the spin ends.
 *   - Scatter `comb`: counted on the FINAL grid of a spin. Base spin: 3 / 4 / 5+ combs pay 3x / 10x / 100x the bet and
 *     award 8 free spins. Free spin: 3+ combs award 4 more (no scatter pay in free spins). Total granted <= 200.
 *   - Lale Ebrusu (free spins only): a stain field (7x7 integers, 0 = none) starts empty when the feature starts and
 *     persists through every free spin of the round (retriggers included). A cluster is paid with the stains as they
 *     were BEFORE it burst: the cluster pay is multiplied by the SUM of the stain values under its cells (x1 when no
 *     cell is stained). Then every cell of every bursting cluster gets a stain: 0 -> 2, v -> min(256, 2 * v). The
 *     stain field belongs to board positions: falls do not move it, but the comb shifts it with exactly the same row
 *     shifts as the symbols (stains[(c + shift) mod 7][r] = old[c][r]).
 *   - Cap 10000 x bet in every mode: the round ends at once, free spins left become 0.
 *
 * Modes (bet = base bet in cents):
 *   standard  cost = bet.          Base table, free table.
 *   ante      cost = bet * 5 / 4.  Base-game comb weight raised (about 2x feature rate); mode-specific free table;
 *                                  buying is off.
 *   buy       cost = bet * 100.    The base spin's initial grid is guaranteed to hold at least 3 combs (procedure
 *                                  below), so the 8 free spins always trigger; mode-specific free table.
 * Wins are always measured against the bet. Each mode's RTP is measured against its COST and tuned separately
 * (EBRU_RTP, ops/evidence/ebru-20261012).
 *
 * RNG and draw order: SplitMix32 expands the seed into xoshiro128**. One stream continues across the whole round.
 *   1. Initial grid: column 0..6, row 0..6 (row 0 on top), one u32 symbol draw per cell.
 *   2. Buy guarantee (base spin of mode buy only): while fewer than 3 combs are on the grid, list the non-comb cells in
 *      column-major order, draw one u32, pick index floor(u32 * length / 2^32) and turn that cell into a comb (id
 *      kept). 3 - k extra draws, 0 when k >= 3. Combs never burst, the comb pass only moves them and falls only move
 *      them down, so the final grid keeps them.
 *   3. Bleed pass (draws described above), then the cluster search. A bleed pass follows every deal and every refill.
 *   4. Each tumble: column 0..6 refilled top to bottom (one symbol draw per missing cell), then a bleed pass.
 *   5. Comb pass: 3 draws in the order A (weighted pick), p (uniform of 64), q (weighted pick).
 * Cell ids count up from 0 in draw order (the 49 initial cells first). The bet level never changes the draws.
 *
 * Steps (EbruStep, discriminated by `type`) drive the presentation, in order:
 *   drop-in   the dealt grid (+ stain field in free spins)        bleed  one drop spreading ink
 *   clusters  all clusters of the grid with pay, stain sum, factor burst  cells removed
 *   stains    (free) stain changes of the burst                    fall   survivor moves and fresh cells
 *   comb      one comb pass: A, p, q, per-row shifts, grid after, stain field after, `createsWin`
 */

export const EBRU_ENGINE_ID = "ebru-ink-1";
export const EBRU_COLS = 7;
export const EBRU_ROWS = 7;
export const EBRU_MIN_CLUSTER = 5;
export const EBRU_MAX_WIN_MULTIPLIER = 10_000;
export const EBRU_FREE_SPINS_TRIGGER = 8;
export const EBRU_FREE_SPINS_RETRIGGER = 4;
/** Safety bound on the free spins granted in one round (the 10000 x cap normally ends a round long before). */
export const EBRU_MAX_FREE_SPINS = 200;
/** Safety bound on tumbles (falls) per spin. */
export const EBRU_MAX_TUMBLES = 100;
export const EBRU_MAX_COMB_PASSES = 3;
export const EBRU_BUY_MIN_SCATTERS = 3;
export const EBRU_STAIN_FIRST = 2;
export const EBRU_STAIN_MAX = 256;
/** Number of angle units of the comb: phi = p * 2pi / 64 and k = q * 2pi / 64. */
export const EBRU_SIN_STEPS = 64;
export const EBRU_SIN_SCALE = 1000;
/** EBRU_SIN_TABLE[i] = round(1000 * sin(2 * pi * i / 64)), i = 0..63 (a test checks it against Math.sin). */
export const EBRU_SIN_TABLE: readonly number[] = Object.freeze([
  0, 98, 195, 290, 383, 471, 556, 634, 707, 773, 831, 882, 924, 957, 981, 995, 1000, 995, 981, 957, 924, 882, 831, 773, 707, 634, 556, 471, 383, 290, 195, 98,
  0, -98, -195, -290, -383, -471, -556, -634, -707, -773, -831, -882, -924, -957, -981, -995, -1000, -995, -981, -957, -924, -882, -831, -773, -707, -634, -556, -471, -383, -290, -195, -98,
]);

export type EbruColour = "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "c7" | "c8";
export type EbruSymbol = EbruColour | "drop" | "comb";
export type EbruMode = "standard" | "ante" | "buy";
export const EBRU_MODES: readonly EbruMode[] = Object.freeze(["standard", "ante", "buy"] as const);
export const EBRU_COLOURS: readonly EbruColour[] = Object.freeze(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"] as const);
const COLOUR_COUNT = EBRU_COLOURS.length;
/** Bet levels in cents (same as storm-throne). All divisible by 4. */
export const EBRU_BET_LEVELS_CENTS: readonly number[] = Object.freeze([
  100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 40_000, 50_000,
]);
/** Cost = bet * numerator / denominator. */
export const EBRU_COST_FRACTION: Readonly<Record<EbruMode, readonly [number, number]>> = Object.freeze({
  standard: Object.freeze([1, 1] as const), ante: Object.freeze([5, 4] as const), buy: Object.freeze([100, 1] as const),
});

export interface EbruCell { id: number; symbol: EbruSymbol }
/** [col][row], row 0 on top. */
export type EbruGrid = EbruCell[][];
/** [col][row] stain values: 0 (none) or 2, 4, ..., 256. */
export type EbruStains = number[][];
export interface EbruPos { id: number; col: number; row: number }
export interface EbruCluster {
  colour: EbruColour; size: number; cells: EbruPos[];
  /** Index into EBRU_CLUSTER_TIER_STARTS. */
  tier: number; payHundredths: number;
  /** Sum of the stain values under the cluster (0 = none, then the factor is 1). */
  stainSum: number; multiplier: number;
  /** payHundredths * multiplier. */
  winHundredths: number;
}
export interface EbruDropInStep { type: "drop-in"; grid: EbruGrid; stains: EbruStains | null }
export interface EbruBleedStep {
  type: "bleed"; /** The drop that bled. */ id: number; col: number; row: number; colour: EbruColour;
  /** "majority" (one most common colour), "tie" (RNG picked among `candidates`) or "random" (no coloured neighbour). */
  source: "majority" | "tie" | "random"; candidates: EbruColour[];
  recoloured: { id: number; col: number; row: number; from: EbruColour; to: EbruColour }[];
  grid: EbruGrid;
}
export interface EbruClustersStep { type: "clusters"; clusters: EbruCluster[]; stepHundredths: number }
export interface EbruBurstStep { type: "burst"; removed: EbruPos[] }
export interface EbruStainsStep {
  type: "stains"; changes: { col: number; row: number; from: number; to: number }[]; stains: EbruStains;
}
export interface EbruFallStep {
  type: "fall";
  /** Surviving cells that moved down (fromRow < toRow). */
  moves: { id: number; col: number; fromRow: number; toRow: number }[];
  /** New cells in draw order (column 0..6, top to bottom), at their final rows. */
  fresh: { id: number; col: number; row: number; symbol: EbruSymbol }[];
  grid: EbruGrid;
}
export interface EbruCombStep {
  type: "comb"; /** 1..3 */ pass: number; amplitude: number; /** p, phi = p * 2pi/64 */ phase: number; /** q, k = q * 2pi/64 */ rowStep: number;
  /** Cyclic shift per row (index = row), positive = toward higher columns. */
  shifts: number[]; grid: EbruGrid; /** Free spins only: the stain field after the same shifts. */ stains: EbruStains | null;
  /** True when the grid after the pass holds at least one cluster. */
  createsWin: boolean;
}
export type EbruStep = EbruDropInStep | EbruBleedStep | EbruClustersStep | EbruBurstStep | EbruStainsStep | EbruFallStep | EbruCombStep;

export interface EbruSpin {
  index: number; kind: "base" | "free"; steps: EbruStep[];
  scatterCount: number; scatterHundredths: number;
  /** Sum of the cluster wins (stain factors included), scatter pay excluded. */
  tumbleHundredths: number;
  /** Number of falls (tumbles). */
  tumbles: number;
  combPasses: number;
  /** Comb passes that created at least one cluster. */
  combWins: number;
  /** Clusters paid in this spin and how many of them crossed at least one stained cell. */
  clusterCount: number; stainedClusterCount: number;
  /** Stain field after this spin (free spins; 0 in the base spin). */
  maxStain: number; stainedCells: number;
  /** tumbleHundredths + scatterHundredths, before the round cap. */
  winHundredths: number;
  /** 8 on trigger, 4 on retrigger, otherwise 0. */
  freeSpinsAwarded: number;
  /** Free spins still to play after this spin (0 once the cap ended the round). */
  freeSpinsLeft: number;
  /** Cumulative round total with the cap applied. */
  totalHundredthsAfter: number;
}
export interface EbruRound {
  engine: typeof EBRU_ENGINE_ID; seedHex: string; mode: EbruMode; betCents: number; costCents: number;
  spins: EbruSpin[]; totalHundredths: number; payoutCents: number; capped: boolean; freeSpinsTriggered: boolean;
}

/** Cluster size -> tier: the highest start that is <= size (sizes below 5 do not pay). */
export const EBRU_CLUSTER_TIER_STARTS: readonly number[] = Object.freeze([5, 6, 7, 8, 9, 10, 12, 14, 17, 21, 26, 33]);
/** Hundredths of the bet per colour and tier of EBRU_CLUSTER_TIER_STARTS, shared by all modes. */
export const EBRU_PAYTABLE: Record<EbruColour, readonly number[]> = Object.freeze({
  c1: Object.freeze([160, 288, 560, 1120, 2080, 3840, 8800, 19200, 41600, 88000, 192000, 416000]),
  c2: Object.freeze([122, 220, 427, 854, 1586, 2928, 6710, 14640, 31720, 67100, 146400, 317200]),
  c3: Object.freeze([95, 171, 333, 665, 1235, 2280, 5225, 11400, 24700, 52250, 114000, 247000]),
  c4: Object.freeze([74, 133, 259, 518, 962, 1776, 4070, 8880, 19240, 40700, 88800, 192400]),
  c5: Object.freeze([58, 104, 203, 406, 754, 1392, 3190, 6960, 15080, 31900, 69600, 150800]),
  c6: Object.freeze([48, 86, 168, 336, 624, 1152, 2640, 5760, 12480, 26400, 57600, 124800]),
  c7: Object.freeze([40, 72, 140, 280, 520, 960, 2200, 4800, 10400, 22000, 48000, 104000]),
  c8: Object.freeze([32, 58, 112, 224, 416, 768, 1760, 3840, 8320, 17600, 38400, 83200]),
});
/** Base game only, hundredths of the bet for 3, 4 and 5+ combs on the final grid of a spin. */
export const EBRU_SCATTER_PAY: { 3: number; 4: number; 5: number } = Object.freeze({ 3: 300, 4: 1000, 5: 10_000 });

export type EbruWeighted<T> = readonly (readonly [T, number])[];
export interface EbruModeTables {
  /** Base-game symbol weights (drop and comb included). */
  base: EbruWeighted<EbruSymbol>;
  /** Free-spin symbol weights (drop and comb included). */
  free: EbruWeighted<EbruSymbol>;
}
/** Comb amplitude A weights, shared by all modes. */
export const EBRU_COMB_AMPLITUDE_WEIGHTS: EbruWeighted<number> = Object.freeze([
  [1, 30], [2, 40], [3, 30],
].map(row => Object.freeze(row)) as unknown as EbruWeighted<number>);
/** Comb row-step q weights (k = q * 2pi/64), shared by all modes. */
export const EBRU_COMB_STEP_WEIGHTS: EbruWeighted<number> = Object.freeze([
  [1, 10], [2, 12], [3, 12], [4, 12], [5, 10], [6, 10], [8, 10], [10, 8], [12, 8], [16, 8],
].map(row => Object.freeze(row)) as unknown as EbruWeighted<number>);

const symbols = (colours: readonly number[], drop: number, comb: number): EbruWeighted<EbruSymbol> => [
  ...EBRU_COLOURS.map((c, i): readonly [EbruSymbol, number] => [c, colours[i]!]), ["drop", drop], ["comb", comb],
];
const BASE_COLOURS = [1250, 1250, 1250, 1250, 1250, 1250, 1250, 1250];
/** Free-spin palette (Lale Ebrusu): c8 is drained (weight 0) and c7 is the per-mode intensity knob: the fewer c7, the more
 * same-colour clusters, the faster the stains build up. Standard 108, ante 285, buy 495 were set by Monte Carlo so that
 * each mode lands at about 95% of its own cost. */
const FREE_STANDARD = [1580, 1580, 1580, 1580, 1580, 1580, 108, 0];
const FREE_ANTE = [1580, 1580, 1580, 1580, 1580, 1580, 285, 0];
const FREE_BUY = [1580, 1580, 1580, 1580, 1580, 1580, 495, 0];

const deepFreeze = (tables: Record<EbruMode, EbruModeTables>): Record<EbruMode, EbruModeTables> => {
  for (const mode of Object.keys(tables) as EbruMode[]) {
    const t = tables[mode];
    for (const list of [t.base, t.free] as readonly (readonly unknown[])[]) { for (const row of list) Object.freeze(row); Object.freeze(list); }
    Object.freeze(t);
  }
  return Object.freeze(tables);
};
/** Weight tables per mode. Tuned by Monte Carlo; see ops/evidence/ebru-20261012. */
export const EBRU_MODE_TABLES: Record<EbruMode, EbruModeTables> = deepFreeze({
  standard: { base: symbols(BASE_COLOURS, 12, 57), free: symbols(FREE_STANDARD, 20, 100) },
  ante: { base: symbols(BASE_COLOURS, 12, 72), free: symbols(FREE_ANTE, 20, 100) },
  buy: { base: symbols(BASE_COLOURS, 12, 57), free: symbols(FREE_BUY, 20, 100) },
});

export interface EbruRtp { rtp: number; ciLow: number; ciHigh: number; rounds: number; hitRate: number; featureRate: number; stdDev: number }
// @evidence-block-begin (engineSourceSha256 in the evidence is the sha256 of this file with the lines from here to the end marker removed)
/** Copied from ops/evidence/ebru-20261012/rtp.json (a test keeps them equal). rtp, ciLow and ciHigh are
 * return / COST as ratios (0.955 = 95.5%), rounded to 3 decimals; hitRate = base spins with any win per round (3
 * decimals); featureRate = rounds that trigger free spins (4 decimals); stdDev = standard deviation of the per-round
 * return in cost units (3 decimals); rounds = simulated rounds. DEMO estimate, not a certified RTP; the 95% interval
 * is a normal approximation and optimistic for this heavy tail. */
export const EBRU_RTP: Record<EbruMode, EbruRtp> = Object.freeze({
  standard: Object.freeze({ rtp: 0.957, ciLow: 0.947, ciHigh: 0.967, rounds: 20_000_000, hitRate: 0.278, featureRate: 0.0031, stdDev: 22.114 }),
  ante: Object.freeze({ rtp: 0.95, ciLow: 0.942, ciHigh: 0.959, rounds: 20_000_000, hitRate: 0.279, featureRate: 0.0058, stdDev: 18.882 }),
  buy: Object.freeze({ rtp: 0.954, ciLow: 0.953, ciHigh: 0.955, rounds: 20_000_000, hitRate: 1, featureRate: 1, stdDev: 2.28 }),
});
// @evidence-block-end

// --- Compiled configuration ---------------------------------------------------------------------
interface Compiled<T> { items: T[]; cumulative: number[]; total: number }
interface ModeConfig { base: Compiled<EbruSymbol>; free: Compiled<EbruSymbol> }
interface EngineConfig {
  modes: Record<EbruMode, ModeConfig>;
  amplitudes: Compiled<number>;
  rowSteps: Compiled<number>;
  paytable: Record<EbruColour, readonly number[]>;
  scatterPay: { 3: number; 4: number; 5: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; maxCombPasses: number; buyMinScatters: number;
}
export type EbruTuning = Partial<{
  tables: Partial<Record<EbruMode, Partial<EbruModeTables>>>;
  amplitudes: EbruWeighted<number>;
  rowSteps: EbruWeighted<number>;
  paytable: Record<EbruColour, readonly number[]>;
  scatterPay: { 3: number; 4: number; 5: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; maxCombPasses: number; buyMinScatters: number;
}>;

const SEED_PATTERN = /^[0-9a-f]{32}$/;
const TWO_POW_32 = 4_294_967_296;
const BET_LEVELS = new Set<number>(EBRU_BET_LEVELS_CENTS);
const CELLS = EBRU_COLS * EBRU_ROWS;
const COLOUR_INDEX: Record<string, number> = { c1: 0, c2: 1, c3: 2, c4: 3, c5: 4, c6: 5, c7: 6, c8: 7 };

function compile<T>(table: EbruWeighted<T>): Compiled<T> {
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
function configFrom(tuning: EbruTuning): EngineConfig {
  const modes = {} as Record<EbruMode, ModeConfig>;
  for (const mode of EBRU_MODES) {
    const base = EBRU_MODE_TABLES[mode], over = tuning.tables?.[mode] ?? {};
    modes[mode] = { base: compile(over.base ?? base.base), free: compile(over.free ?? base.free) };
  }
  return {
    modes, amplitudes: compile(tuning.amplitudes ?? EBRU_COMB_AMPLITUDE_WEIGHTS), rowSteps: compile(tuning.rowSteps ?? EBRU_COMB_STEP_WEIGHTS),
    paytable: tuning.paytable ?? EBRU_PAYTABLE, scatterPay: tuning.scatterPay ?? EBRU_SCATTER_PAY,
    capHundredths: tuning.capHundredths ?? EBRU_MAX_WIN_MULTIPLIER * 100,
    maxFreeSpins: tuning.maxFreeSpins ?? EBRU_MAX_FREE_SPINS, maxTumbles: tuning.maxTumbles ?? EBRU_MAX_TUMBLES,
    maxCombPasses: tuning.maxCombPasses ?? EBRU_MAX_COMB_PASSES, buyMinScatters: tuning.buyMinScatters ?? EBRU_BUY_MIN_SCATTERS,
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
const below = (rng: () => number, n: number): number => Math.floor(rng() * n / TWO_POW_32);

// --- Grid mechanics -------------------------------------------------------------------------------
interface Dealer { rng: () => number; table: Compiled<EbruSymbol>; nextId: number; record: boolean }
function dealCell(d: Dealer): EbruCell { return { id: d.nextId++, symbol: pick(d.table, d.rng) }; }
function dealGrid(d: Dealer): EbruGrid {
  const grid: EbruGrid = [];
  for (let c = 0; c < EBRU_COLS; c++) {
    const column: EbruCell[] = [];
    for (let r = 0; r < EBRU_ROWS; r++) column.push(dealCell(d));
    grid.push(column);
  }
  return grid;
}
const copyGrid = (grid: EbruGrid): EbruGrid => grid.map(column => column.slice());
const copyStains = (stains: EbruStains): EbruStains => stains.map(column => column.slice());
const emptyStains = (): EbruStains => Array.from({ length: EBRU_COLS }, () => new Array<number>(EBRU_ROWS).fill(0));
const isColour = (symbol: EbruSymbol): symbol is EbruColour => symbol !== "drop" && symbol !== "comb";
const countScatters = (grid: EbruGrid): number => {
  let n = 0;
  for (const column of grid) for (const cell of column) if (cell.symbol === "comb") n++;
  return n;
};

/** Buy guarantee: turns RNG-chosen non-comb cells into combs until the grid holds `minScatters`. See the file header. */
function ensureScatters(grid: EbruGrid, minScatters: number, rng: () => number): void {
  let scatters = countScatters(grid);
  while (scatters < minScatters) {
    const spots: [number, number][] = [];
    for (let c = 0; c < EBRU_COLS; c++) for (let r = 0; r < EBRU_ROWS; r++) if (grid[c]![r]!.symbol !== "comb") spots.push([c, r]);
    const [c, r] = spots[below(rng, spots.length)]!;
    grid[c]![r] = { id: grid[c]![r]!.id, symbol: "comb" };
    scatters++;
  }
}

/** One bleed pass: every drop on the grid bleeds in column-major order. Returns the new grid (the input is not mutated). */
function resolveBleeds(grid: EbruGrid, d: Dealer, steps: EbruStep[]): EbruGrid {
  let drops: [number, number][] | undefined;
  for (let c = 0; c < EBRU_COLS; c++) for (let r = 0; r < EBRU_ROWS; r++) if (grid[c]![r]!.symbol === "drop") (drops ??= []).push([c, r]);
  if (!drops) return grid;
  const g = copyGrid(grid);
  for (const [c, r] of drops) {
    const counts = new Array<number>(COLOUR_COUNT).fill(0);
    const around: [number, number][] = [];
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= EBRU_COLS || nr < 0 || nr >= EBRU_ROWS) continue;
      const symbol = g[nc]![nr]!.symbol;
      if (isColour(symbol)) { counts[COLOUR_INDEX[symbol]!]!++; around.push([nc, nr]); }
    }
    let best = 0;
    for (const n of counts) if (n > best) best = n;
    let colourIndex: number, source: "majority" | "tie" | "random";
    const tied: number[] = [];
    if (best === 0) { colourIndex = below(d.rng, COLOUR_COUNT); source = "random"; }
    else {
      for (let i = 0; i < COLOUR_COUNT; i++) if (counts[i] === best) tied.push(i);
      if (tied.length === 1) { colourIndex = tied[0]!; source = "majority"; } else { colourIndex = tied[below(d.rng, tied.length)]!; source = "tie"; }
    }
    const colour = EBRU_COLOURS[colourIndex]!;
    const recoloured: EbruBleedStep["recoloured"] = [];
    for (const [nc, nr] of around) {
      const cell = g[nc]![nr]!;
      if (cell.symbol !== colour) {
        if (d.record) recoloured.push({ id: cell.id, col: nc, row: nr, from: cell.symbol as EbruColour, to: colour });
        g[nc]![nr] = { id: cell.id, symbol: colour };
      }
    }
    g[c]![r] = { id: g[c]![r]!.id, symbol: colour };
    if (d.record) {
      steps.push({
        type: "bleed", id: g[c]![r]!.id, col: c, row: r, colour, source, candidates: source === "random" ? [] : tied.map(i => EBRU_COLOURS[i]!),
        recoloured, grid: copyGrid(g),
      });
    }
  }
  return g;
}

function tierOf(size: number): number {
  let tier = 0;
  while (tier + 1 < EBRU_CLUSTER_TIER_STARTS.length && size >= EBRU_CLUSTER_TIER_STARTS[tier + 1]!) tier++;
  return tier;
}
/** Cells of every colour cluster of size >= 5, in column-major order of their first cell; cells inside a cluster
 * are sorted column-major. Pay and stain factor are filled in by the caller. */
function findClusters(grid: EbruGrid): { colour: EbruColour; cells: number[] }[] {
  const seen = new Uint8Array(CELLS);
  const found: { colour: EbruColour; cells: number[] }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < CELLS; start++) {
    if (seen[start]) continue;
    const sc = Math.floor(start / EBRU_ROWS), sr = start % EBRU_ROWS;
    const symbol = grid[sc]![sr]!.symbol;
    if (!isColour(symbol)) continue;
    const cells: number[] = [];
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const at = stack.pop()!;
      cells.push(at);
      const c = Math.floor(at / EBRU_ROWS), r = at % EBRU_ROWS;
      if (r > 0 && !seen[at - 1] && grid[c]![r - 1]!.symbol === symbol) { seen[at - 1] = 1; stack.push(at - 1); }
      if (r < EBRU_ROWS - 1 && !seen[at + 1] && grid[c]![r + 1]!.symbol === symbol) { seen[at + 1] = 1; stack.push(at + 1); }
      if (c > 0 && !seen[at - EBRU_ROWS] && grid[c - 1]![r]!.symbol === symbol) { seen[at - EBRU_ROWS] = 1; stack.push(at - EBRU_ROWS); }
      if (c < EBRU_COLS - 1 && !seen[at + EBRU_ROWS] && grid[c + 1]![r]!.symbol === symbol) { seen[at + EBRU_ROWS] = 1; stack.push(at + EBRU_ROWS); }
    }
    if (cells.length >= EBRU_MIN_CLUSTER) found.push({ colour: symbol, cells: cells.sort((a, b) => a - b) });
  }
  return found;
}

/** round(n / 1000) with halves away from zero, integers only. */
function roundSine(amplitude: number, sine: number): number {
  const n = amplitude * sine, m = Math.floor((2 * Math.abs(n) + EBRU_SIN_SCALE) / (2 * EBRU_SIN_SCALE));
  return n < 0 ? -m : m;
}
function combShifts(amplitude: number, phase: number, rowStep: number): number[] {
  const shifts: number[] = [];
  for (let r = 0; r < EBRU_ROWS; r++) shifts.push(roundSine(amplitude, EBRU_SIN_TABLE[(phase + r * rowStep) % EBRU_SIN_STEPS]!));
  return shifts;
}
const wrap = (n: number): number => ((n % EBRU_COLS) + EBRU_COLS) % EBRU_COLS;
function shiftGrid(grid: EbruGrid, shifts: readonly number[]): EbruGrid {
  const out: EbruGrid = Array.from({ length: EBRU_COLS }, () => new Array<EbruCell>(EBRU_ROWS));
  for (let c = 0; c < EBRU_COLS; c++) for (let r = 0; r < EBRU_ROWS; r++) out[wrap(c + shifts[r]!)]![r] = grid[c]![r]!;
  return out;
}
function shiftStains(stains: EbruStains, shifts: readonly number[]): EbruStains {
  const out: EbruStains = Array.from({ length: EBRU_COLS }, () => new Array<number>(EBRU_ROWS).fill(0));
  for (let c = 0; c < EBRU_COLS; c++) for (let r = 0; r < EBRU_ROWS; r++) out[wrap(c + shifts[r]!)]![r] = stains[c]![r]!;
  return out;
}

type SpinCore = Omit<EbruSpin, "freeSpinsAwarded" | "freeSpinsLeft" | "totalHundredthsAfter">;
/** `stains` is the persistent stain field of the round (mutated in place) for a free spin, null for the base spin. */
function playSpin(cfg: EngineConfig, d: Dealer, kind: "base" | "free", index: number, guaranteeScatters: number, stainsIn: EbruStains | null): SpinCore & { stains: EbruStains | null } {
  const steps: EbruStep[] = [];
  let stains = stainsIn;
  let grid = dealGrid(d);
  if (guaranteeScatters > 0) ensureScatters(grid, guaranteeScatters, d.rng);
  if (d.record) steps.push({ type: "drop-in", grid, stains: stains ? copyStains(stains) : null });
  grid = resolveBleeds(grid, d, steps);
  let tumbleHundredths = 0, tumbles = 0, combPasses = 0, combWins = 0, clusterCount = 0, stainedClusterCount = 0;
  const search = (): { colour: EbruColour; cells: number[] }[] => (tumbles >= cfg.maxTumbles ? [] : findClusters(grid));
  let found = search();
  for (;;) {
    if (found.length > 0) {
      const clusters: EbruCluster[] = [];
      let stepHundredths = 0;
      for (const f of found) {
        const tier = tierOf(f.cells.length), pay = cfg.paytable[f.colour][tier]!;
        let stainSum = 0;
        if (stains) for (const at of f.cells) stainSum += stains[Math.floor(at / EBRU_ROWS)]![at % EBRU_ROWS]!;
        const multiplier = stainSum || 1, win = pay * multiplier;
        stepHundredths += win; clusterCount++; if (stainSum > 0) stainedClusterCount++;
        if (d.record) {
          clusters.push({
            colour: f.colour, size: f.cells.length, cells: f.cells.map(at => { const c = Math.floor(at / EBRU_ROWS), r = at % EBRU_ROWS; return { id: grid[c]![r]!.id, col: c, row: r }; }),
            tier, payHundredths: pay, stainSum, multiplier, winHundredths: win,
          });
        }
      }
      tumbleHundredths += stepHundredths;
      if (d.record) steps.push({ type: "clusters", clusters, stepHundredths });
      // Burst.
      const gone = new Uint8Array(CELLS);
      for (const f of found) for (const at of f.cells) gone[at] = 1;
      if (d.record) {
        const removed: EbruPos[] = [];
        for (let at = 0; at < CELLS; at++) if (gone[at]) { const c = Math.floor(at / EBRU_ROWS), r = at % EBRU_ROWS; removed.push({ id: grid[c]![r]!.id, col: c, row: r }); }
        steps.push({ type: "burst", removed });
      }
      if (stains) {
        const changes: EbruStainsStep["changes"] = [];
        for (let at = 0; at < CELLS; at++) if (gone[at]) {
          const c = Math.floor(at / EBRU_ROWS), r = at % EBRU_ROWS, from = stains[c]![r]!;
          const to = from === 0 ? EBRU_STAIN_FIRST : Math.min(EBRU_STAIN_MAX, from * 2);
          stains[c]![r] = to;
          if (d.record) changes.push({ col: c, row: r, from, to });
        }
        if (d.record) steps.push({ type: "stains", changes, stains: copyStains(stains) });
      }
      // Fall and refill: survivors keep their order and ids, fresh cells come from the top, column 0..6.
      const moves: EbruFallStep["moves"] = [], fresh: EbruFallStep["fresh"] = [];
      const next: EbruGrid = [];
      for (let c = 0; c < EBRU_COLS; c++) {
        const survivors: EbruCell[] = [], fromRows: number[] = [];
        for (let r = 0; r < EBRU_ROWS; r++) if (!gone[c * EBRU_ROWS + r]) { survivors.push(grid[c]![r]!); fromRows.push(r); }
        const missing = EBRU_ROWS - survivors.length, column: EbruCell[] = [];
        for (let r = 0; r < missing; r++) {
          const cell = dealCell(d);
          column.push(cell);
          if (d.record) fresh.push({ id: cell.id, col: c, row: r, symbol: cell.symbol });
        }
        survivors.forEach((cell, i) => {
          column.push(cell);
          if (d.record && fromRows[i]! !== missing + i) moves.push({ id: cell.id, col: c, fromRow: fromRows[i]!, toRow: missing + i });
        });
        next.push(column);
      }
      tumbles++;
      grid = next;
      if (d.record) steps.push({ type: "fall", moves, fresh, grid: copyGrid(grid) });
      grid = resolveBleeds(grid, d, steps);
      found = search();
      continue;
    }
    if (combPasses >= cfg.maxCombPasses) break;
    // Comb pass: A, p, q.
    const amplitude = pick(cfg.amplitudes, d.rng), phase = below(d.rng, EBRU_SIN_STEPS), rowStep = pick(cfg.rowSteps, d.rng);
    const shifts = combShifts(amplitude, phase, rowStep);
    grid = shiftGrid(grid, shifts);
    if (stains) stains = shiftStains(stains, shifts);
    combPasses++;
    found = search();
    if (d.record) steps.push({ type: "comb", pass: combPasses, amplitude, phase, rowStep, shifts, grid, stains: stains ? copyStains(stains) : null, createsWin: found.length > 0 });
    if (found.length === 0) break;
    combWins++;
  }
  const scatterCount = countScatters(grid);
  const scatterHundredths = kind === "base" && scatterCount >= 3 ? cfg.scatterPay[scatterCount >= 5 ? 5 : scatterCount === 4 ? 4 : 3] : 0;
  let maxStain = 0, stainedCells = 0;
  if (stains) for (const column of stains) for (const v of column) if (v > 0) { stainedCells++; if (v > maxStain) maxStain = v; }
  return {
    index, kind, steps, scatterCount, scatterHundredths, tumbleHundredths, tumbles, combPasses, combWins, clusterCount, stainedClusterCount,
    maxStain, stainedCells, winHundredths: tumbleHundredths + scatterHundredths, stains,
  };
}

function costOf(betCents: number, mode: EbruMode): number {
  const [num, den] = EBRU_COST_FRACTION[mode];
  return (betCents * num) / den;
}
function validate(seedHex: unknown, betCents: unknown, mode: unknown): asserts seedHex is string {
  if (typeof seedHex !== "string" || !SEED_PATTERN.test(seedHex)) throw new RangeError("seedHex must be 32 lowercase hex characters");
  if (typeof betCents !== "number" || !BET_LEVELS.has(betCents)) throw new RangeError("betCents must be one of EBRU_BET_LEVELS_CENTS");
  if (typeof mode !== "string" || !(EBRU_MODES as readonly string[]).includes(mode)) throw new RangeError("mode must be standard, ante or buy");
}

function playRound(cfg: EngineConfig, seedHex: string, betCents: number, mode: EbruMode, record: boolean): EbruRound {
  validate(seedHex, betCents, mode);
  const tables = cfg.modes[mode];
  const dealer: Dealer = { rng: createRng(seedHex), table: tables.base, nextId: 0, record };
  const spins: EbruSpin[] = [];
  let total = 0, capped = false, freeLeft = 0, freeGranted = 0, triggered = false;
  let stains: EbruStains | null = null;
  for (let index = 0; ; index++) {
    const kind = index === 0 ? "base" : "free";
    if (kind === "free") freeLeft--;
    dealer.table = kind === "base" ? tables.base : tables.free;
    const { stains: after, ...spin } = playSpin(cfg, dealer, kind, index, kind === "base" && mode === "buy" ? cfg.buyMinScatters : 0, stains);
    stains = after;
    const wanted = kind === "base" ? (spin.scatterCount >= 3 ? EBRU_FREE_SPINS_TRIGGER : 0) : (spin.scatterCount >= 3 ? EBRU_FREE_SPINS_RETRIGGER : 0);
    const awarded = Math.max(0, Math.min(wanted, cfg.maxFreeSpins - freeGranted));
    freeGranted += awarded;
    freeLeft += awarded;
    if (kind === "base" && awarded > 0) { triggered = true; stains = emptyStains(); }
    const raw = total + spin.winHundredths;
    if (raw >= cfg.capHundredths) { total = cfg.capHundredths; capped = true; freeLeft = 0; } else total = raw;
    spins.push({ ...spin, freeSpinsAwarded: awarded, freeSpinsLeft: freeLeft, totalHundredthsAfter: total });
    if (capped || freeLeft <= 0) break;
  }
  const payoutCents = Number(BigInt(betCents) * BigInt(total) / 100n);
  return {
    engine: EBRU_ENGINE_ID, seedHex, mode, betCents, costCents: costOf(betCents, mode),
    spins, totalHundredths: total, payoutCents, capped, freeSpinsTriggered: triggered,
  };
}

/** Cost in cents of one round: standard = bet, ante = bet * 5 / 4, buy = bet * 100.
 * Throws RangeError for a bet that is not a level of EBRU_BET_LEVELS_CENTS or an unknown mode. */
export function ebruCostCents(betCents: number, mode: EbruMode): number {
  validate("0".repeat(32), betCents, mode);
  return costOf(betCents, mode);
}

/** Resolves a whole round: base spin, tumbles, comb passes, bleeds, any free spins with the stain field, the 10000 x
 * bet cap and the integer payout. Throws RangeError for a seed that is not 32 lowercase hex characters, a bet outside
 * the levels or an unknown mode. */
export function playEbruRound(seedHex: string, betCents: number, mode: EbruMode): EbruRound {
  return playRound(DEFAULT_CONFIG, seedHex, betCents, mode, true);
}

/** 4 x uint32 (for example crypto.getRandomValues) -> 32 lowercase hex characters, word 0 first. */
export function ebruSeedFromEntropy(words: Uint32Array): string {
  if (!(words instanceof Uint32Array) || words.length !== 4) throw new RangeError("Entropy must be a Uint32Array of 4 words");
  let out = "";
  for (let i = 0; i < 4; i++) out += (words[i]! >>> 0).toString(16).padStart(8, "0");
  return out;
}

/** Test and simulation hooks: not part of the public game API. `record: false` skips the step objects (the spin
 * summaries, totals and RNG use are identical; a test checks that). */
export const __ebruTest = {
  play: (seedHex: string, betCents: number, mode: EbruMode, tuning: EbruTuning = {}, record = true): EbruRound => playRound(configFrom(tuning), seedHex, betCents, mode, record),
  createRng,
  findClusters: (grid: EbruGrid): { colour: EbruColour; cells: number[] }[] => findClusters(grid),
  combShifts,
  shiftGrid,
  shiftStains,
  roundSine,
  tierOf,
  ensureScatters: (grid: EbruGrid, minScatters: number, seedHex: string): void => ensureScatters(grid, minScatters, createRng(seedHex)),
  /** Bleed pass on a copy of `grid` with the given seed; returns the new grid and the bleed steps. */
  bleed: (grid: EbruGrid, seedHex: string): { grid: EbruGrid; steps: EbruBleedStep[] } => {
    const steps: EbruStep[] = [];
    const d: Dealer = { rng: createRng(seedHex), table: compile<EbruSymbol>([["c1", 1]]), nextId: 1000, record: true };
    return { grid: resolveBleeds(grid, d, steps), steps: steps as EbruBleedStep[] };
  },
};
