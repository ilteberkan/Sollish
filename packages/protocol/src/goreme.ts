/** Göreme: Şafak Balonları engine `goreme-balloons-1`: DEMO-credit 6 x 5 ways game (15 625 ways) with rising balloon wilds that carry
 * multipliers, a wind that pushes them sideways, merges, and the Şafak Şöleni free spins with the sky band (Gök çarpanı).
 * Pure and deterministic: same 32-hex seed, bet level and mode always give the identical round. No clock, no Math.random, no
 * network, no balance or wager input beyond the bet level. The whole round (every lift, respin, free spin and the cap) is resolved
 * before presentation; animation, tab visibility, reduced motion or disconnects cannot change a result. All arithmetic is
 * integer: wins are summed in hundredths of the BET and the payout is floor(betCents * hundredths / 100).
 *
 * This file is self-contained (own RNG, picker, ways evaluator, lift) so the evidence covers these bytes only. Authoritative rules:
 * docs/product/games-wave3.md section 1.
 *
 * Board: 6 reels (columns) x 5 rows, grid[col][row], row 0 on top. Symbols: h1..h4, l1..l5 (pay), "balloon" (wild with a multiplier
 * 1..25), "sun" (scatter). Every cell has a stable id: a balloon keeps its id while it rises, drifts and merges (the survivor of a
 * merge keeps the lowest id); every freshly dealt cell gets a new id from one round counter that starts at 0 and never restarts.
 *
 * Rules:
 *   - Ways. For a pay symbol s and reel r let c(s,r) be the number of s cells on r and w(r) the SUM of the balloon multipliers on r.
 *     The run length L is the number of leading reels (from reel 0) with c + w > 0. When L >= 3 and at least one real s lies on
 *     reels 0..L-1, s pays GOREME_PAYTABLE[s][L-3] * (prod(c + w) - prod(w)) over r = 0..L-1 (TEN-THOUSANDTHS of the bet per way). The
 *     subtracted term removes the ways made only of balloons, so every paid way holds at least one real s; balloon multipliers on
 *     different reels multiply along a way. A balloon substitutes for every pay symbol (never for "sun") and pays nothing alone.
 *     Wins of one board are listed in symbol order h1..h4, l1..l5. A single win is clamped at the cap (the round ends there anyway).
 *   - Lift (base chain). After a board is paid, if it holds a balloon, a lift follows: one RNG draw picks the wind (left / calm /
 *     right, GOREME_WIND_WEIGHTS); every balloon rises one row, its multiplier grows by 1 (at most x25) and it drifts one reel with
 *     the wind (it stays put at the board edge). A balloon that rises above row 0 exits (base game: it flies away). Balloons that
 *     end on the same cell merge into one balloon: the lowest id survives, its multiplier is the sum (at most x25). Then every
 *     non-balloon cell is respun (fresh ids; new balloons can land) and the new board is paid in full again. The chain ends when a
 *     board holds no balloon or after GOREME_MAX_LIFTS lifts.
 *   - Sun scatter. Only the round's first board counts: 3 / 4 / 5 / 6+ suns pay 2x / 5x / 20x / 100x the bet and award 10 / 12 / 15 /
 *     20 free spins. Base respins never deal a sun.
 *   - Şafak Şöleni (free spins). The feature starts with an empty board and the sky multiplier x1 (base balloons never carry over).
 *     A free spin whose board holds balloons is a lift (rise, +1, wind, merges) followed by a respin of every non-balloon cell; a free
 *     spin on a board without balloons deals a whole fresh board. Balloons stay on the board between free spins. A balloon that
 *     exits at the top MOORS in the sky band: the sky multiplier becomes the sum of every moored balloon value (x1 before the first
 *     mooring), so it only grows. Every ways win of a free spin is multiplied by the sky value after that spin's moorings. 3+ suns on
 *     a free spin's board award +5 free spins (no scatter pay in free spins). At most 200 free spins are granted per round.
 *   - Cap 10 000 x bet in every mode: the round ends at once (also inside a base chain), free spins left become 0.
 *
 * Modes (bet = base bet in cents):
 *   standard  cost = bet.          Base, respin and free tables.
 *   ante      cost = bet * 5 / 4.  Base-board sun weight raised (about 2x the feature rate); mode-specific free table.
 *   buy       cost = bet * 100.    The first board is guaranteed to hold at least 3 suns (procedure below); mode-specific free table.
 * Wins are always measured against the bet. Each mode's RTP is measured against its COST and tuned separately (GOREME_RTP,
 * ops/evidence/goreme-20261021).
 *
 * RNG and draw order: SplitMix32 expands the seed into xoshiro128**. A whole board (base first board, or a free spin on an empty
 * board) is dealt reel 0..5, row 0..4; a respin deals the non-balloon cells in the same order. Every dealt cell draws one u32 for its
 * symbol; a cell that lands a balloon draws one more u32 for its multiplier (GOREME_LANDING_MULTIPLIERS weights of the phase). A lift
 * draws one u32 for the wind (only when at least one balloon is on the board). One stream continues across the whole round.
 *
 * Buy guarantee procedure (first board only, right after it is dealt): while fewer than 3 suns are on the board, list the cells that
 * are neither sun nor balloon in reel-major order (reel 0..5, row 0..4), draw one u32, pick index floor(u32 * listLength / 2^32) and
 * turn that cell into a sun (its id is kept). The sun pay still follows the normal 3 / 4 / 5 / 6+ table.
 */

export const GOREME_ENGINE_ID = "goreme-balloons-1";
export const GOREME_REELS = 6;
export const GOREME_ROWS = 5;
export const GOREME_WAYS = 15_625;
export const GOREME_MIN_LENGTH = 3;
export const GOREME_MAX_WIN_MULTIPLIER = 10_000;
export const GOREME_MAX_BALLOON_MULTIPLIER = 25;
/** Base chain: at most 20 lifts per base spin. */
export const GOREME_MAX_LIFTS = 20;
/** Safety bound on the free spins granted in one round. */
export const GOREME_MAX_FREE_SPINS = 200;
export const GOREME_FREE_SPINS_RETRIGGER = 5;
export const GOREME_BUY_MIN_SCATTERS = 3;

export type GoremePaySymbol = "h1" | "h2" | "h3" | "h4" | "l1" | "l2" | "l3" | "l4" | "l5";
export type GoremeSymbol = GoremePaySymbol | "balloon" | "sun";
export type GoremeMode = "standard" | "ante" | "buy";
export type GoremeWind = "left" | "calm" | "right";
export const GOREME_MODES: readonly GoremeMode[] = Object.freeze(["standard", "ante", "buy"] as const);
/** Bet levels in cents (same as the other slots; all divisible by 4). */
export const GOREME_BET_LEVELS_CENTS: readonly number[] = Object.freeze([
  100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 40_000, 50_000,
]);
/** Cost = bet * numerator / denominator. */
export const GOREME_COST_FRACTION: Readonly<Record<GoremeMode, readonly [number, number]>> = Object.freeze({
  standard: Object.freeze([1, 1] as const), ante: Object.freeze([5, 4] as const), buy: Object.freeze([100, 1] as const),
});
export const GOREME_PAY_SYMBOLS: readonly GoremePaySymbol[] = Object.freeze(["h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4", "l5"] as const);
/** Display names (Turkish). */
export const GOREME_SYMBOL_NAMES: Readonly<Record<GoremeSymbol, string>> = Object.freeze({
  h1: "Peri Bacası", h2: "Güvercinlik", h3: "Avanos Çömleği", h4: "Kilim Atı",
  l1: "Kilim Gözü Mor", l2: "Kilim Gözü Şeftali", l3: "Kilim Gözü Altın", l4: "Kilim Gözü Turkuaz", l5: "Kilim Gözü Krem",
  balloon: "Balon", sun: "Şafak Güneşi",
});
/** Multiplier values a balloon can land with. */
export const GOREME_LANDING_MULTIPLIERS: readonly number[] = Object.freeze([1, 2, 3, 5]);
export const GOREME_WINDS: readonly GoremeWind[] = Object.freeze(["left", "calm", "right"] as const);
/** Wind weights in GOREME_WINDS order (shared by all modes and phases). */
export const GOREME_WIND_WEIGHTS: readonly number[] = Object.freeze([1, 1, 1]);

/** TEN-THOUSANDTHS of the bet PER WAY for run lengths 3, 4, 5, 6. Original table, shared by all modes. A board's win is
 * floor(sum of the way pays * sky / 100) hundredths of the bet. */
export const GOREME_PAYTABLE: Record<GoremePaySymbol, readonly number[]> = Object.freeze({
  h1: Object.freeze([1800, 4500, 9000, 22_500]),
  h2: Object.freeze([1300, 3400, 6800, 13_500]),
  h3: Object.freeze([900, 2250, 4500, 9000]),
  h4: Object.freeze([700, 1800, 3600, 6800]),
  l1: Object.freeze([450, 900, 1800, 3600]),
  l2: Object.freeze([360, 700, 1350, 2700]),
  l3: Object.freeze([270, 540, 1100, 2250]),
  l4: Object.freeze([220, 450, 900, 1800]),
  l5: Object.freeze([180, 360, 720, 1440]),
});
export interface GoremeScatterAward { spins: number; payHundredths: number }
/** First board only: suns -> free spins and scatter pay (hundredths of the bet). 6 stands for 6 or more. */
export const GOREME_SCATTER_AWARDS: Readonly<Record<3 | 4 | 5 | 6, GoremeScatterAward>> = Object.freeze({
  3: Object.freeze({ spins: 10, payHundredths: 200 }),
  4: Object.freeze({ spins: 12, payHundredths: 500 }),
  5: Object.freeze({ spins: 15, payHundredths: 2000 }),
  6: Object.freeze({ spins: 20, payHundredths: 10_000 }),
});

/** A table entry: a symbol, or "stack" (the cell repeats the pay symbol directly above it, see the file header). */
export type GoremeDealt = GoremeSymbol | "stack";
export type GoremeWeighted<T> = readonly (readonly [T, number])[];
export interface GoremeModeTables {
  /** The round's first board (balloon and sun included). */
  base: GoremeWeighted<GoremeDealt>;
  /** Base-chain respins (sun weight 0: only the first board counts suns). */
  respin: GoremeWeighted<GoremeDealt>;
  /** Every free-spin deal and respin. */
  free: GoremeWeighted<GoremeDealt>;
  /** Landing multipliers of balloons in the base game (first board and respins) and in free spins. */
  baseMultipliers: GoremeWeighted<number>;
  freeMultipliers: GoremeWeighted<number>;
}
const symbols = (pay: readonly number[], stack: number, balloon: number, sun: number): GoremeWeighted<GoremeDealt> => [
  ...GOREME_PAY_SYMBOLS.map((s, i) => [s, pay[i]!] as const), ["stack", stack], ["balloon", balloon], ["sun", sun],
];
const landing = (weights: readonly number[]): GoremeWeighted<number> => GOREME_LANDING_MULTIPLIERS.map((m, i) => [m, weights[i]!] as const);
/** Pay-symbol weights h1..h4, l1..l5. */
const BASE_PAY = [600, 700, 800, 900, 1100, 1200, 1300, 1400, 1500];
const FREE_PAY = [600, 700, 800, 900, 1100, 1200, 1300, 1400, 1500];
/** Stack weight: the cell repeats the pay symbol above it (fewer distinct symbols per reel, bigger way counts). */
const STACK = 6000;
const BASE_MULT = [75, 17, 6, 2];
const FREE_MULT = [75, 17, 6, 2];

const deepFreeze = (tables: Record<GoremeMode, GoremeModeTables>): Record<GoremeMode, GoremeModeTables> => {
  for (const mode of Object.keys(tables) as GoremeMode[]) {
    const t = tables[mode];
    for (const list of [t.base, t.respin, t.free, t.baseMultipliers, t.freeMultipliers] as readonly (readonly unknown[])[]) { for (const row of list) Object.freeze(row); Object.freeze(list); }
    Object.freeze(t);
  }
  return Object.freeze(tables);
};
/** Weight tables per mode. Tuned by Monte Carlo; see ops/evidence/goreme-20261021. */
export const GOREME_MODE_TABLES: Record<GoremeMode, GoremeModeTables> = deepFreeze({
  standard: { base: symbols(BASE_PAY, STACK, 30, 145), respin: symbols(BASE_PAY, STACK, 10, 0), free: symbols(FREE_PAY, STACK, 127, 200), baseMultipliers: landing(BASE_MULT), freeMultipliers: landing(FREE_MULT) },
  ante: { base: symbols(BASE_PAY, STACK, 30, 185), respin: symbols(BASE_PAY, STACK, 10, 0), free: symbols(FREE_PAY, STACK, 113, 200), baseMultipliers: landing(BASE_MULT), freeMultipliers: landing(FREE_MULT) },
  buy: { base: symbols(BASE_PAY, STACK, 30, 145), respin: symbols(BASE_PAY, STACK, 10, 0), free: symbols(FREE_PAY, STACK, 128, 200), baseMultipliers: landing(BASE_MULT), freeMultipliers: landing(FREE_MULT) },
});

export interface GoremeRtp { rtp: number; ciLow: number; ciHigh: number; rounds: number; hitRate: number; featureRate: number; stdDev: number }
// @evidence-block-begin (engineSourceSha256 in the evidence is the sha256 of this file with the lines from here to the end marker removed)
/** Copied from ops/evidence/goreme-20261021/rtp.json (a test keeps them equal). rtp, ciLow and ciHigh are return / COST as
 * ratios (0.955 = 95.5%), rounded to 3 decimals; hitRate = base spins with any win per round (3 decimals); featureRate = rounds
 * that trigger free spins (4 decimals); stdDev = standard deviation of the per-round return in cost units (3 decimals); rounds =
 * simulated rounds. DEMO estimate, not a certified RTP; the 95% interval is a normal approximation and optimistic for this heavy
 * tail. */
export const GOREME_RTP: Record<GoremeMode, GoremeRtp> = Object.freeze({
  standard: Object.freeze({ rtp: 0, ciLow: 0, ciHigh: 0, rounds: 0, hitRate: 0, featureRate: 0, stdDev: 0 }),
  ante: Object.freeze({ rtp: 0, ciLow: 0, ciHigh: 0, rounds: 0, hitRate: 0, featureRate: 0, stdDev: 0 }),
  buy: Object.freeze({ rtp: 0, ciLow: 0, ciHigh: 0, rounds: 0, hitRate: 0, featureRate: 0, stdDev: 0 }),
});
// @evidence-block-end

// --- Public data shapes --------------------------------------------------------------------------------
/** multiplier is 1..25 for a balloon and 0 for every other symbol. */
export interface GoremeCell { id: number; symbol: GoremeSymbol; multiplier: number }
/** [col][row], row 0 on top. */
export type GoremeGrid = GoremeCell[][];
export interface GoremeBalloon { id: number; col: number; row: number; multiplier: number }
export interface GoremeDrop { id: number; col: number; row: number; symbol: GoremeSymbol; multiplier: number }
/** A whole fresh board: the round's first board, or a free spin on a board without balloons. */
export interface GoremeSpinStep { type: "spin"; grid: GoremeGrid; /** Balloons that landed (reel-major). */ balloons: GoremeBalloon[] }
/** Every non-balloon cell after a lift is dealt again; balloons keep their cell objects. */
export interface GoremeRespinStep { type: "respin"; grid: GoremeGrid; /** Fresh cells (reel-major, ids consecutive). */ drops: GoremeDrop[]; /** Balloons that landed in this respin. */ balloons: GoremeBalloon[] }
export interface GoremeWayWin {
  symbol: GoremePaySymbol;
  /** Run length 3..6 (leading reels with the symbol or a balloon). */
  length: number;
  /** Plain way count with at least one real symbol: prod(c + balloons) - prod(balloons). */
  ways: number;
  /** Multiplier-weighted ways that are paid: prod(c + w) - prod(w). */
  weightedWays: number;
  /** Largest multiplier one way gets: product over the run of the biggest balloon multiplier on each reel (1 on reels without a balloon). */
  multiplierProduct: number;
  /** Ten-thousandths of the bet per way. */
  payPerWayTenThousandths: number;
  /** payPerWayTenThousandths * weightedWays (ten-thousandths of the bet, clamped at the cap). */
  payTenThousandths: number;
  /** Ids of the symbol and balloon cells on the run's reels, reel-major. */
  cells: number[];
}
export interface GoremeWaysStep {
  type: "ways"; wins: GoremeWayWin[];
  /** Sum of the wins before the sky multiplier. */
  baseTenThousandths: number;
  /** x1 in the base game; in free spins the sky value after this spin's moorings. */
  skyMultiplier: number;
  /** floor(baseTenThousandths * skyMultiplier / 100): the board's win in hundredths of the bet (clamped at the cap). */
  winHundredths: number;
}
export interface GoremeLiftMove { id: number; from: [number, number]; to: [number, number]; multiplierBefore: number; /** +1, at most 25 (before any merge). */ multiplierAfter: number }
export interface GoremeMerge { /** Survivor (lowest id). */ id: number; absorbed: number[]; at: [number, number]; /** Multipliers of the parts after the rise, survivor first then absorbed. */ parts: number[]; /** Sum of the parts, at most 25. */ multiplier: number }
export interface GoremeExit { id: number; from: [number, number]; /** Value after the rise (+1, at most 25). */ multiplier: number; /** true in free spins (the balloon joins the sky band). */ moored: boolean }
export interface GoremeLiftStep {
  type: "lift";
  /** 1-based lift number within the spin (always 1 in a free spin). */
  lift: number;
  wind: GoremeWind; shift: -1 | 0 | 1;
  /** Every balloon that stays on the board, reel-major by origin. */
  moves: GoremeLiftMove[];
  merges: GoremeMerge[];
  exits: GoremeExit[];
  /** Balloons on the board after the lift (after merges), reel-major. */
  balloons: GoremeBalloon[];
}
export interface GoremeScatterStep { type: "scatter"; count: number; cells: number[]; payHundredths: number; /** Free spins this scatter asks for (before the 200 bound). */ freeSpins: number }
export interface GoremeSkyStep { type: "sky"; moored: { id: number; multiplier: number }[]; skyBefore: number; skyAfter: number }
export type GoremeStep = GoremeSpinStep | GoremeRespinStep | GoremeWaysStep | GoremeLiftStep | GoremeScatterStep | GoremeSkyStep;

/** Step order. Base spin: spin, ways, [scatter], then per lift: lift, respin, ways. Free spin: either spin, ways, [scatter] (board
 * without balloons) or lift, [sky], respin, ways, [scatter]. Cell objects are shared between steps; treat them as read-only. */
export interface GoremeSpin {
  index: number; kind: "base" | "free"; steps: GoremeStep[];
  /** Suns on the first board (base) or on the free spin's board. */
  scatterCount: number; scatterHundredths: number;
  /** Sum of the ways steps' winHundredths (sky applied). */
  waysHundredths: number;
  lifts: number;
  skyBefore: number; skyAfter: number;
  /** waysHundredths + scatterHundredths, before the round cap. */
  winHundredths: number;
  /** Free spins asked for by suns (10/12/15/20 on trigger, 5 on retrigger), before the 200 bound. */
  scatterSpinsAwarded: number;
  /** Free spins actually granted by this spin. */
  freeSpinsAwarded: number;
  freeSpinsLeft: number;
  /** Cumulative round total with the cap applied. */
  totalHundredthsAfter: number;
  /** The board at the end of the spin (balloons on it carry into the next free spin). */
  finalGrid: GoremeGrid;
}
export interface GoremeRound {
  engine: typeof GOREME_ENGINE_ID; seedHex: string; mode: GoremeMode; betCents: number; costCents: number;
  spins: GoremeSpin[]; totalHundredths: number; payoutCents: number; capped: boolean; freeSpinsTriggered: boolean;
}

// --- Compiled configuration ---------------------------------------------------------------------------
interface Compiled<T> { items: T[]; cumulative: number[]; total: number }
interface DealTable { full: Compiled<GoremeDealt>; plain: Compiled<GoremeSymbol> }
interface ModeConfig { base: DealTable; respin: DealTable; free: DealTable; baseMultipliers: Compiled<number>; freeMultipliers: Compiled<number> }
interface EngineConfig {
  modes: Record<GoremeMode, ModeConfig>;
  paytable: number[][];
  scatterAwards: Record<3 | 4 | 5 | 6, GoremeScatterAward>;
  wind: Compiled<number>;
  capHundredths: number; maxFreeSpins: number; maxLifts: number; buyMinScatters: number; retrigger: number; maxMultiplier: number;
}
export type GoremeTuning = Partial<{
  tables: Partial<Record<GoremeMode, Partial<GoremeModeTables>>>;
  paytable: Record<GoremePaySymbol, readonly number[]>;
  scatterAwards: Record<3 | 4 | 5 | 6, GoremeScatterAward>;
  windWeights: readonly number[];
  capHundredths: number; maxFreeSpins: number; maxLifts: number; buyMinScatters: number; retrigger: number; maxMultiplier: number;
}>;

const SEED_PATTERN = /^[0-9a-f]{32}$/;
const TWO_POW_32 = 4_294_967_296;
const BET_LEVELS = new Set<number>(GOREME_BET_LEVELS_CENTS);
const R = GOREME_REELS, H = GOREME_ROWS;
const SHIFT: readonly (-1 | 0 | 1)[] = [-1, 0, 1];

function compile<T>(table: GoremeWeighted<T>): Compiled<T> {
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
function configFrom(tuning: GoremeTuning): EngineConfig {
  const modes = {} as Record<GoremeMode, ModeConfig>;
  for (const mode of GOREME_MODES) {
    const base = GOREME_MODE_TABLES[mode], over = tuning.tables?.[mode] ?? {};
    const multipliers = (t: GoremeWeighted<number>): Compiled<number> => {
      for (const [m] of t) if (!Number.isSafeInteger(m) || m < 1) throw new RangeError("Landing multipliers must be positive integers");
      return compile(t);
    };
    const deal = (t: GoremeWeighted<GoremeDealt>): DealTable => ({ full: compile(t), plain: compile(t.filter((e): e is readonly [GoremeSymbol, number] => e[0] !== "stack")) });
    modes[mode] = {
      base: deal(over.base ?? base.base), respin: deal(over.respin ?? base.respin), free: deal(over.free ?? base.free),
      baseMultipliers: multipliers(over.baseMultipliers ?? base.baseMultipliers), freeMultipliers: multipliers(over.freeMultipliers ?? base.freeMultipliers),
    };
  }
  const table = tuning.paytable ?? GOREME_PAYTABLE;
  const paytable = GOREME_PAY_SYMBOLS.map(s => {
    const row = table[s];
    if (!row || row.length !== 4 || row.some(v => !Number.isSafeInteger(v) || v < 0 || v > 1_000_000)) throw new RangeError("paytable rows need 4 integers 0..1000000");
    return row.slice();
  });
  const windWeights = tuning.windWeights ?? GOREME_WIND_WEIGHTS;
  if (windWeights.length !== 3) throw new RangeError("windWeights needs left, calm, right");
  return {
    modes, paytable, scatterAwards: tuning.scatterAwards ?? GOREME_SCATTER_AWARDS, wind: compile(windWeights.map((w, i) => [i, w] as const)),
    capHundredths: tuning.capHundredths ?? GOREME_MAX_WIN_MULTIPLIER * 100, maxFreeSpins: tuning.maxFreeSpins ?? GOREME_MAX_FREE_SPINS,
    maxLifts: tuning.maxLifts ?? GOREME_MAX_LIFTS, buyMinScatters: tuning.buyMinScatters ?? GOREME_BUY_MIN_SCATTERS,
    retrigger: tuning.retrigger ?? GOREME_FREE_SPINS_RETRIGGER, maxMultiplier: tuning.maxMultiplier ?? GOREME_MAX_BALLOON_MULTIPLIER,
  };
}
const DEFAULT_CONFIG = configFrom({});

// --- RNG ---------------------------------------------------------------------------------------------------
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

// --- Board mechanics -------------------------------------------------------------------------------------
interface Dealer { rng: () => number; nextId: number }
function dealCell(d: Dealer, table: DealTable, multipliers: Compiled<number>, above: GoremeCell | null): GoremeCell {
  const dealt = pick(table.full, d.rng);
  const symbol: GoremeSymbol = dealt !== "stack" ? dealt : above !== null && CODE_OF[above.symbol] < 9 ? above.symbol : pick(table.plain, d.rng);
  const multiplier = symbol === "balloon" ? pick(multipliers, d.rng) : 0;
  return { id: d.nextId++, symbol, multiplier };
}
function dealGrid(d: Dealer, table: DealTable, multipliers: Compiled<number>): GoremeGrid {
  const grid: GoremeGrid = [];
  for (let c = 0; c < R; c++) {
    const column: GoremeCell[] = [];
    for (let r = 0; r < H; r++) column.push(dealCell(d, table, multipliers, r > 0 ? column[r - 1]! : null));
    grid.push(column);
  }
  return grid;
}
function balloonsOf(grid: GoremeGrid): GoremeBalloon[] {
  const out: GoremeBalloon[] = [];
  for (let c = 0; c < R; c++) for (let r = 0; r < H; r++) { const cell = grid[c]![r]!; if (cell.symbol === "balloon") out.push({ id: cell.id, col: c, row: r, multiplier: cell.multiplier }); }
  return out;
}
/** Buy guarantee: turns RNG-chosen cells (neither sun nor balloon) into suns until the board holds `minScatters`. See the file header. */
function ensureSuns(grid: GoremeGrid, minScatters: number, rng: () => number): void {
  let suns = 0;
  for (const column of grid) for (const cell of column) if (cell.symbol === "sun") suns++;
  while (suns < minScatters) {
    const spots: [number, number][] = [];
    for (let c = 0; c < R; c++) for (let r = 0; r < H; r++) { const s = grid[c]![r]!.symbol; if (s !== "sun" && s !== "balloon") spots.push([c, r]); }
    if (spots.length === 0) return;
    const [c, r] = spots[Math.floor(rng() * spots.length / TWO_POW_32)]!;
    grid[c]![r] = { id: grid[c]![r]!.id, symbol: "sun", multiplier: 0 };
    suns++;
  }
}

const CODE_OF: Record<GoremeSymbol, number> = { h1: 0, h2: 1, h3: 2, h4: 3, l1: 4, l2: 5, l3: 6, l4: 7, l5: 8, balloon: 9, sun: 10 };
const counts = new Int32Array(9 * R);
const wsum = new Int32Array(R), bcount = new Int32Array(R), bmax = new Int32Array(R);
/** Every ways win of a board (symbol order), before the sky multiplier. */
function evaluateWays(grid: GoremeGrid, paytable: readonly (readonly number[])[], cap: number): GoremeWayWin[] {
  counts.fill(0); wsum.fill(0); bcount.fill(0); bmax.fill(0);
  for (let c = 0; c < R; c++) {
    const column = grid[c]!;
    for (let r = 0; r < H; r++) {
      const cell = column[r]!, code = CODE_OF[cell.symbol];
      if (code < 9) counts[code * R + c]!++;
      else if (code === 9) { wsum[c]! += cell.multiplier; bcount[c]!++; if (cell.multiplier > bmax[c]!) bmax[c] = cell.multiplier; }
    }
  }
  const wins: GoremeWayWin[] = [];
  for (let s = 0; s < 9; s++) {
    const off = s * R;
    let length = 0, real = 0;
    while (length < R && counts[off + length]! + wsum[length]! > 0) { real += counts[off + length]!; length++; }
    if (length < GOREME_MIN_LENGTH || real === 0) continue;
    let full = 1, wild = 1, plain = 1, plainWild = 1, mult = 1;
    for (let r = 0; r < length; r++) {
      const c = counts[off + r]!;
      full *= c + wsum[r]!; wild *= wsum[r]!; plain *= c + bcount[r]!; plainWild *= bcount[r]!;
      if (bcount[r]! > 0) mult *= bmax[r]!;
    }
    const weightedWays = full - wild, perWay = paytable[s]![length - GOREME_MIN_LENGTH]!;
    if (perWay === 0) continue;
    const cells: number[] = [];
    for (let c = 0; c < length; c++) for (let r = 0; r < H; r++) { const cell = grid[c]![r]!; if (cell.symbol === "balloon" || CODE_OF[cell.symbol] === s) cells.push(cell.id); }
    wins.push({
      symbol: GOREME_PAY_SYMBOLS[s]!, length, ways: plain - plainWild, weightedWays, multiplierProduct: mult, payPerWayTenThousandths: perWay,
      payTenThousandths: Math.min(perWay * weightedWays, cap * 100), cells,
    });
  }
  return wins;
}

/** Lifts every balloon of `grid` once with the given shift. Returns the step data (without type/lift/wind) and the balloon-only board. */
function liftBalloons(grid: GoremeGrid, shift: -1 | 0 | 1, maxMultiplier: number, moored: boolean):
  { moves: GoremeLiftMove[]; merges: GoremeMerge[]; exits: GoremeExit[]; board: (GoremeCell | null)[][] } {
  const moves: GoremeLiftMove[] = [], exits: GoremeExit[] = [];
  const landed: { cell: GoremeCell; col: number; row: number; value: number }[][] = Array.from({ length: R * H }, () => []);
  for (let c = 0; c < R; c++) for (let r = 0; r < H; r++) {
    const cell = grid[c]![r]!;
    if (cell.symbol !== "balloon") continue;
    const value = Math.min(cell.multiplier + 1, maxMultiplier);
    if (r === 0) { exits.push({ id: cell.id, from: [c, r], multiplier: value, moored }); continue; }
    const tc = Math.min(R - 1, Math.max(0, c + shift)), tr = r - 1;
    moves.push({ id: cell.id, from: [c, r], to: [tc, tr], multiplierBefore: cell.multiplier, multiplierAfter: value });
    landed[tc * H + tr]!.push({ cell, col: c, row: r, value });
  }
  const board: (GoremeCell | null)[][] = Array.from({ length: R }, () => Array.from({ length: H }, () => null));
  const merges: GoremeMerge[] = [];
  for (let c = 0; c < R; c++) for (let r = 0; r < H; r++) {
    const here = landed[c * H + r]!;
    if (here.length === 0) continue;
    if (here.length === 1) { board[c]![r] = { id: here[0]!.cell.id, symbol: "balloon", multiplier: here[0]!.value }; continue; }
    const sorted = here.slice().sort((a, b) => a.cell.id - b.cell.id);
    const sum = sorted.reduce((a, x) => a + x.value, 0), multiplier = Math.min(sum, maxMultiplier);
    board[c]![r] = { id: sorted[0]!.cell.id, symbol: "balloon", multiplier };
    merges.push({ id: sorted[0]!.cell.id, absorbed: sorted.slice(1).map(x => x.cell.id), at: [c, r], parts: sorted.map(x => x.value), multiplier });
  }
  return { moves, merges, exits, board };
}
/** Respin: keeps the balloons of `board`, deals every empty cell. */
function respin(board: (GoremeCell | null)[][], d: Dealer, table: DealTable, multipliers: Compiled<number>): GoremeRespinStep {
  const drops: GoremeDrop[] = [], landedBalloons: GoremeBalloon[] = [];
  const grid: GoremeGrid = board.map((source, c) => {
    const column: GoremeCell[] = [];
    for (let r = 0; r < H; r++) {
      const kept = source[r];
      if (kept) { column.push(kept); continue; }
      const fresh = dealCell(d, table, multipliers, r > 0 ? column[r - 1]! : null);
      drops.push({ id: fresh.id, col: c, row: r, symbol: fresh.symbol, multiplier: fresh.multiplier });
      if (fresh.symbol === "balloon") landedBalloons.push({ id: fresh.id, col: c, row: r, multiplier: fresh.multiplier });
      column.push(fresh);
    }
    return column;
  });
  return { type: "respin", grid, drops, balloons: landedBalloons };
}
function boardBalloons(board: (GoremeCell | null)[][]): GoremeBalloon[] {
  const out: GoremeBalloon[] = [];
  for (let c = 0; c < R; c++) for (let r = 0; r < H; r++) { const cell = board[c]![r]; if (cell) out.push({ id: cell.id, col: c, row: r, multiplier: cell.multiplier }); }
  return out;
}
function hasBalloon(grid: GoremeGrid): boolean {
  for (const column of grid) for (const cell of column) if (cell.symbol === "balloon") return true;
  return false;
}
function sunCells(grid: GoremeGrid): number[] {
  const out: number[] = [];
  for (const column of grid) for (const cell of column) if (cell.symbol === "sun") out.push(cell.id);
  return out;
}

interface Feature { sky: number; mooredSum: number; board: GoremeGrid | null }
interface RoundState { total: number; capped: boolean }

type SpinCore = Omit<GoremeSpin, "freeSpinsAwarded" | "freeSpinsLeft" | "totalHundredthsAfter">;
/** Adds a win to the round total; returns true when the cap is reached. */
function add(state: RoundState, cfg: EngineConfig, hundredths: number): boolean {
  const raw = state.total + hundredths;
  if (raw >= cfg.capHundredths) { state.total = cfg.capHundredths; state.capped = true; return true; }
  state.total = raw;
  return false;
}
function waysStep(grid: GoremeGrid, cfg: EngineConfig, sky: number): GoremeWaysStep {
  const wins = evaluateWays(grid, cfg.paytable, cfg.capHundredths);
  let base = 0;
  for (const w of wins) base += w.payTenThousandths;
  const winHundredths = Math.min(Math.floor(base * sky / 100), cfg.capHundredths);
  return { type: "ways", wins, baseTenThousandths: base, skyMultiplier: sky, winHundredths };
}

function playBaseSpin(cfg: EngineConfig, tables: ModeConfig, d: Dealer, guaranteeSuns: number, state: RoundState): SpinCore {
  const steps: GoremeStep[] = [];
  let grid = dealGrid(d, tables.base, tables.baseMultipliers);
  if (guaranteeSuns > 0) ensureSuns(grid, guaranteeSuns, d.rng);
  steps.push({ type: "spin", grid, balloons: balloonsOf(grid) });
  let ways = 0, scatterHundredths = 0, scatterSpins = 0, lifts = 0;
  const first = waysStep(grid, cfg, 1);
  steps.push(first);
  ways += first.winHundredths;
  let stop = add(state, cfg, first.winHundredths);
  const suns = sunCells(grid);
  if (suns.length >= 3) {
    const award = cfg.scatterAwards[suns.length >= 6 ? 6 : suns.length as 3 | 4 | 5];
    scatterHundredths = award.payHundredths; scatterSpins = award.spins;
    steps.push({ type: "scatter", count: suns.length, cells: suns, payHundredths: award.payHundredths, freeSpins: award.spins });
    if (!stop) stop = add(state, cfg, scatterHundredths);
  }
  while (!stop && lifts < cfg.maxLifts && hasBalloon(grid)) {
    lifts++;
    const windIndex = pick(cfg.wind, d.rng), shift = SHIFT[windIndex]!;
    const lifted = liftBalloons(grid, shift, cfg.maxMultiplier, false);
    const re = respin(lifted.board, d, tables.respin, tables.baseMultipliers);
    steps.push({ type: "lift", lift: lifts, wind: GOREME_WINDS[windIndex]!, shift, moves: lifted.moves, merges: lifted.merges, exits: lifted.exits, balloons: boardBalloons(lifted.board) });
    steps.push(re);
    grid = re.grid;
    const w = waysStep(grid, cfg, 1);
    steps.push(w);
    ways += w.winHundredths;
    stop = add(state, cfg, w.winHundredths);
  }
  return {
    index: 0, kind: "base", steps, scatterCount: suns.length, scatterHundredths, waysHundredths: ways, lifts, skyBefore: 1, skyAfter: 1,
    winHundredths: ways + scatterHundredths, scatterSpinsAwarded: scatterSpins, finalGrid: grid,
  };
}

function playFreeSpin(cfg: EngineConfig, tables: ModeConfig, d: Dealer, index: number, f: Feature, state: RoundState): SpinCore {
  const steps: GoremeStep[] = [];
  const skyBefore = f.sky;
  let grid: GoremeGrid, lifts = 0;
  if (f.board && hasBalloon(f.board)) {
    lifts = 1;
    const windIndex = pick(cfg.wind, d.rng), shift = SHIFT[windIndex]!;
    const lifted = liftBalloons(f.board, shift, cfg.maxMultiplier, true);
    const re = respin(lifted.board, d, tables.free, tables.freeMultipliers);
    steps.push({ type: "lift", lift: 1, wind: GOREME_WINDS[windIndex]!, shift, moves: lifted.moves, merges: lifted.merges, exits: lifted.exits, balloons: boardBalloons(lifted.board) });
    if (lifted.exits.length > 0) {
      const before = f.sky;
      for (const e of lifted.exits) f.mooredSum += e.multiplier;
      f.sky = Math.max(f.sky, f.mooredSum);
      steps.push({ type: "sky", moored: lifted.exits.map(e => ({ id: e.id, multiplier: e.multiplier })), skyBefore: before, skyAfter: f.sky });
    }
    steps.push(re);
    grid = re.grid;
  } else {
    grid = dealGrid(d, tables.free, tables.freeMultipliers);
    steps.push({ type: "spin", grid, balloons: balloonsOf(grid) });
  }
  const w = waysStep(grid, cfg, f.sky);
  steps.push(w);
  add(state, cfg, w.winHundredths);
  const suns = sunCells(grid);
  let scatterSpins = 0;
  if (suns.length >= 3) {
    scatterSpins = cfg.retrigger;
    steps.push({ type: "scatter", count: suns.length, cells: suns, payHundredths: 0, freeSpins: scatterSpins });
  }
  f.board = grid;
  return {
    index, kind: "free", steps, scatterCount: suns.length, scatterHundredths: 0, waysHundredths: w.winHundredths, lifts, skyBefore, skyAfter: f.sky,
    winHundredths: w.winHundredths, scatterSpinsAwarded: scatterSpins, finalGrid: grid,
  };
}

function costOf(betCents: number, mode: GoremeMode): number {
  const [num, den] = GOREME_COST_FRACTION[mode];
  return (betCents * num) / den;
}
function validate(seedHex: unknown, betCents: unknown, mode: unknown): asserts seedHex is string {
  if (typeof seedHex !== "string" || !SEED_PATTERN.test(seedHex)) throw new RangeError("seedHex must be 32 lowercase hex characters");
  if (typeof betCents !== "number" || !BET_LEVELS.has(betCents)) throw new RangeError("betCents must be one of GOREME_BET_LEVELS_CENTS");
  if (typeof mode !== "string" || !(GOREME_MODES as readonly string[]).includes(mode)) throw new RangeError("mode must be standard, ante or buy");
}

function playRound(cfg: EngineConfig, seedHex: string, betCents: number, mode: GoremeMode): GoremeRound {
  validate(seedHex, betCents, mode);
  const tables = cfg.modes[mode];
  const dealer: Dealer = { rng: createRng(seedHex), nextId: 0 };
  const state: RoundState = { total: 0, capped: false };
  const spins: GoremeSpin[] = [];
  let freeLeft = 0, freeGranted = 0, triggered = false;
  const feature: Feature = { sky: 1, mooredSum: 0, board: null };
  for (let index = 0; ; index++) {
    let spin: SpinCore;
    if (index === 0) spin = playBaseSpin(cfg, tables, dealer, mode === "buy" ? cfg.buyMinScatters : 0, state);
    else { freeLeft--; spin = playFreeSpin(cfg, tables, dealer, index, feature, state); }
    const awarded = state.capped ? 0 : Math.max(0, Math.min(spin.scatterSpinsAwarded, cfg.maxFreeSpins - freeGranted));
    freeGranted += awarded;
    freeLeft += awarded;
    if (index === 0 && awarded > 0) triggered = true;
    if (state.capped) freeLeft = 0;
    spins.push({ ...spin, freeSpinsAwarded: awarded, freeSpinsLeft: freeLeft, totalHundredthsAfter: state.total });
    if (state.capped || freeLeft <= 0) break;
  }
  const payoutCents = Number(BigInt(betCents) * BigInt(state.total) / 100n);
  return {
    engine: GOREME_ENGINE_ID, seedHex, mode, betCents, costCents: costOf(betCents, mode),
    spins, totalHundredths: state.total, payoutCents, capped: state.capped, freeSpinsTriggered: triggered,
  };
}

/** Cost in cents of one round: standard = bet, ante = bet * 5 / 4, buy = bet * 100.
 * Throws RangeError for a bet that is not a level of GOREME_BET_LEVELS_CENTS or an unknown mode. */
export function goremeCostCents(betCents: number, mode: GoremeMode): number {
  validate("0".repeat(32), betCents, mode);
  return costOf(betCents, mode);
}

/** Resolves a whole round: first board, the base lift chain, any Şafak Şöleni free spins with the sky band, the 10 000 x bet cap and
 * the integer payout. Throws RangeError for a seed that is not 32 lowercase hex characters, a bet outside the levels or an unknown mode. */
export function playGoremeRound(seedHex: string, betCents: number, mode: GoremeMode): GoremeRound {
  return playRound(DEFAULT_CONFIG, seedHex, betCents, mode);
}

/** 4 x uint32 (for example crypto.getRandomValues) -> 32 lowercase hex characters, word 0 first. */
export function goremeSeedFromEntropy(words: Uint32Array): string {
  if (!(words instanceof Uint32Array) || words.length !== 4) throw new RangeError("Entropy must be a Uint32Array of 4 words");
  let out = "";
  for (let i = 0; i < 4; i++) out += (words[i]! >>> 0).toString(16).padStart(8, "0");
  return out;
}

const EMPTY_TUNING: GoremeTuning = Object.freeze({});
const tunedConfigs = new WeakMap<object, EngineConfig>();
/** Test and simulation hooks: not part of the public game API. */
export const __goremeTest = {
  /** Plays with a tuning override; the compiled configuration is cached per tuning object (do not mutate a tuning after using it). */
  play: (seedHex: string, betCents: number, mode: GoremeMode, tuning: GoremeTuning = EMPTY_TUNING): GoremeRound => {
    let cfg = tunedConfigs.get(tuning);
    if (!cfg) { cfg = configFrom(tuning); tunedConfigs.set(tuning, cfg); }
    return playRound(cfg, seedHex, betCents, mode);
  },
  createRng,
  /** Ways wins of a hand-built board (same order and numbers as the engine reports them, before the sky). */
  evaluateWays: (grid: GoremeGrid, tuning: GoremeTuning = {}): GoremeWayWin[] => { const cfg = configFrom(tuning); return evaluateWays(grid, cfg.paytable, cfg.capHundredths); },
  /** One lift of a hand-built board with a fixed shift; `moored` marks the exits as free-spin moorings. */
  lift: (grid: GoremeGrid, shift: -1 | 0 | 1, moored = false, maxMultiplier = GOREME_MAX_BALLOON_MULTIPLIER) => liftBalloons(grid, shift, maxMultiplier, moored),
  ensureSuns: (grid: GoremeGrid, minScatters: number, seedHex: string): void => ensureSuns(grid, minScatters, createRng(seedHex)),
};
