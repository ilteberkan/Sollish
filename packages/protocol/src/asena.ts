/** Asena: Yildiz Kurdu engine `asena-stars-1` (working name "Asena: Yıldız Kurdu"): DEMO-credit 6x6 cluster-pays / tumble game
 * with constellation templates, a walking wolf wild and the Ergenekon free spins.
 * Pure and deterministic: same 32-hex seed, bet level and mode always give the identical round. No clock, no Math.random, no
 * network, no balance or wager input beyond the bet level. The whole round (all tumbles, free spins and the cap) is resolved
 * before presentation; animation, tab visibility, reduced motion or disconnects cannot change a result. All arithmetic is
 * integer: wins are summed in hundredths of the BET and the payout is floor(betCents * hundredths / 100).
 *
 * This file is self-contained (own RNG, picker, cluster search, template matcher, tumble) so the evidence covers these bytes
 * only. Authoritative rules: docs/product/games-wave2.md section 3.
 *
 * Board: 6 columns x 6 rows, grid[col][row], row 0 on top. Symbols: h1..h4, l1..l4 (pay), "wolf" (wild, dealt), "trail" (star-trail
 * wild, never dealt, only created by the wolf), "moon" (scatter).
 *
 * Rules:
 *   - Cluster pay. For every pay symbol S, the cells that are S or a wild (wolf / trail) are grouped into orthogonally connected
 *     components; a component with at least one S cell and 5+ cells is a cluster of S. A wild can therefore sit in the clusters
 *     of several symbols and pays in each. The cluster pay is ASENA_PAYTABLE[S][tier(size)] (hundredths of the bet; tiers 5, 6, 7,
 *     8-9, 10-12, 13-17, 18+). Clusters of one step are listed by symbol order h1..l4, then by their lowest cell index
 *     (col * 6 + row).
 *   - Constellations. ASENA_TEMPLATES holds 6 original shapes (5-7 cells) with a multiplier x2..x10. A cluster "contains" a template
 *     when some translation of one of the 8 rotations / reflections of the template lies completely inside the cluster's cells
 *     (wilds count as cluster cells). The template with the highest multiplier that fits ignites (ties: lowest index); inside a
 *     template the first transform index 0..7 (duplicates of symmetric shapes are skipped) and then the first anchor in row-major
 *     order (row of the top-left corner, then column) is reported. The cluster pay is multiplied by the template multiplier. At most
 *     one constellation per cluster, but different clusters of a step may ignite different (or the same) templates.
 *   - Tumble. After a step's clusters are paid, every cluster cell bursts EXCEPT wolves (a wolf stays and walks; a trail wild that
 *     takes part in a win is used up). Survivors fall down their column (ids kept, order kept), the gaps are refilled from the top
 *     with fresh ids, then the wolves walk. Repeat until a board has no cluster (at most maxTumbles tumbles).
 *   - Wolf. A wolf that is a cell of at least one cluster of the step walks once after that step's fall and refill: it moves one cell
 *     orthogonally (up, right, down, left candidates, drawn with the RNG), never off the board and never onto a moon or another wolf.
 *     The cell it enters is overwritten (the consumed symbol or trail wild is reported), the cell it leaves becomes a star-trail wild
 *     with a fresh id. Trail wilds fall with the survivors and stay (as wilds) until a win uses them up or THAT SPIN ends; the next
 *     spin starts with a fresh board, so no trail ever carries over. (Trail wilds that never burst would chain forever: a connected
 *     wild network of 5+ cells with any neighbouring symbol is a cluster.) Several walking wolves move one after the other in
 *     column-major position order and see each other's changes. A wolf with no legal target stays and draws nothing. A wolf that is
 *     dealt on the initial board stays on the board for the whole spin; the wolf count of a spin never changes after the first board.
 *   - Scatter (moon). The final board of a spin counts the moons. Base spin: 3 / 4 / 5+ moons pay 3x / 8x / 60x the bet and award 10 free
 *     spins. Free spin: 3+ moons award 3 more (no scatter pay in free spins). Moons never burst and the wolf never walks onto them, so
 *     the count can only grow during a spin. Total free spins granted in a round <= 200.
 *   - Ergenekon (free spins). At the start of the feature the map has 6 pieces at 0 and the global multiplier is x1. Every ignition in
 *     a free spin unlocks the map piece of its template (a piece counts at most twice). When the number of distinct lit pieces first
 *     reaches 3: +5 free spins and global multiplier >= x2; first reaches 6: +5 and >= x3; when all six pieces are lit twice: >= x5
 *     (no spins). The global multiplier and the map persist over the whole feature (retriggers included, never reset) and multiply
 *     EVERY cluster win of every later step, including the step in which they were unlocked (ignitions are processed first, then the
 *     step's pay is multiplied). The base game always plays with x1 and no map.
 *   - step win = (sum of the step's cluster pays, templates applied) * global multiplier. spin win = sum of step wins + scatter pay.
 *   - Cap 5000 x bet in every mode: the round ends at once, free spins left become 0.
 *   - Safety bounds (tuning hooks, not game rules): at most 100 tumbles per spin (after the 100th tumble the spin ends even if the
 *     board still holds a cluster) and at most 200 free spins granted per round.
 *
 * Modes (bet = base bet in cents):
 *   standard  cost = bet.          Base table, free table.
 *   ante      cost = bet * 5 / 4.  Base-game moon weight raised (about 2x feature rate); mode-specific free table; buying is off.
 *   buy       cost = bet * 80.     The base spin's initial board is guaranteed to hold at least 3 moons (procedure below), so the 10 free
 *                                  spins always trigger; mode-specific free table.
 * Wins are always measured against the bet. Each mode's RTP is measured against its COST and tuned separately (ASENA_RTP,
 * ops/evidence/asena-20261012).
 *
 * RNG and draw order: SplitMix32 expands the seed into xoshiro128**. Initial board column 0..5, row 0..5 (row 0 on top); every cell
 * draws one symbol (u32). Tumble refill: column 0..5, top to bottom within the column, same rule (one u32 per fresh cell) but with the
 * wolf weight set to 0: wolves are only dealt on the initial board of a spin (otherwise wild networks would feed themselves). Wolf
 * walk (after the refill of the same step): per walking wolf one u32 when it has n >= 1 legal targets, target index
 * floor(u32 * n / 2^32) in the order up, right, down, left. One stream continues across tumbles and free spins. Fresh ids (dealt cells
 * and trail wilds) come from one counter that starts at 0 in each round and never restarts, so the ids of a spin start above all
 * earlier ones.
 *
 * Buy guarantee procedure (base spin only, after the 36 initial cells are drawn, before any tumble): let k be the number of moons.
 * While fewer than 3 moons are on the board, list the non-moon cells in column-major order (column 0..5, row 0..5), draw one u32 from
 * the stream, pick index floor(u32 * listLength / 2^32) and turn that cell into a moon (its id is kept, no new id is drawn). That is
 * 3 - k extra draws, 0 when k >= 3. Moons never burst and nothing walks onto them, so the final board keeps those moons and the free
 * spins are always triggered. The moon pay still follows the normal 3 / 4 / 5+ table.
 */

export const ASENA_ENGINE_ID = "asena-stars-1";
export const ASENA_COLS = 6;
export const ASENA_ROWS = 6;
export const ASENA_MIN_CLUSTER = 5;
export const ASENA_MAX_WIN_MULTIPLIER = 5000;
export const ASENA_FREE_SPINS_TRIGGER = 10;
export const ASENA_FREE_SPINS_RETRIGGER = 3;
/** Free spins awarded when the map first reaches 3 and 6 distinct constellations. */
export const ASENA_MAP_SPINS_AT_3 = 5;
export const ASENA_MAP_SPINS_AT_6 = 5;
/** Global multiplier unlocked at 3 distinct, at 6 distinct and when all six are lit twice. */
export const ASENA_MAP_MULTIPLIERS: { 3: number; 6: number; twice: number } = Object.freeze({ 3: 2, 6: 3, twice: 5 });
/** Safety bound on the free spins granted in one round (the 5000 x cap normally ends a round long before). */
export const ASENA_MAX_FREE_SPINS = 200;
/** Safety bound on tumbles per spin. */
export const ASENA_MAX_TUMBLES = 100;
export const ASENA_BUY_MIN_SCATTERS = 3;

export type AsenaPaySymbol = "h1" | "h2" | "h3" | "h4" | "l1" | "l2" | "l3" | "l4";
export type AsenaSymbol = AsenaPaySymbol | "wolf" | "trail" | "moon";
export type AsenaMode = "standard" | "ante" | "buy";
export const ASENA_MODES: readonly AsenaMode[] = Object.freeze(["standard", "ante", "buy"] as const);
/** Bet levels in cents (same as Storm Throne; all divisible by 4). */
export const ASENA_BET_LEVELS_CENTS: readonly number[] = Object.freeze([
  100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 40_000, 50_000,
]);
/** Cost = bet * numerator / denominator. */
export const ASENA_COST_FRACTION: Readonly<Record<AsenaMode, readonly [number, number]>> = Object.freeze({
  standard: Object.freeze([1, 1] as const), ante: Object.freeze([5, 4] as const), buy: Object.freeze([80, 1] as const),
});

// --- Constellation templates -------------------------------------------------------------------------
export type AsenaTemplateId = "kurt-basi" | "yay" | "at" | "kartal" | "hayat-agaci" | "hilal";
/** A cell of a template: [x, y] = [column offset, row offset], row 0 on top. */
export type AsenaTemplateCell = readonly [number, number];
export interface AsenaTemplate {
  id: AsenaTemplateId;
  /** Display name (Turkish). */
  name: string;
  /** Multiplier on the pay of the cluster that contains it (x2..x10). */
  multiplier: number;
  /** The untransformed shape (transform 0), x to the right, y down. The bounding box starts at [0,0]. */
  cells: readonly AsenaTemplateCell[];
  width: number;
  height: number;
}
const shape = (id: AsenaTemplateId, name: string, multiplier: number, cells: readonly (readonly [number, number])[]): AsenaTemplate => {
  const width = Math.max(...cells.map(([x]) => x)) + 1, height = Math.max(...cells.map(([, y]) => y)) + 1;
  return Object.freeze({ id, name, multiplier, cells: Object.freeze(cells.map(c => Object.freeze([c[0], c[1]] as const))), width, height });
};
/** The six original constellation shapes. Index order is the template index used everywhere (map pieces, ignition rates).
 *
 *   kurt-basi (wolf head, 7)   hayat-agaci (tree of life, 7)   kartal (eagle, 7)   at (horse, 6)   yay (bow, 6)   hilal (crescent, 5)
 *     X.X                          .X.                           X...X               XX..            XX             XX
 *     XXX                          XXX                           XXXXX               .X..            .X             X.
 *     .X.                          .X.                                               .XXX            .X             XX
 *     .X.                          .X.                                                               XX
 *                                  .X.
 */
export const ASENA_TEMPLATES: readonly AsenaTemplate[] = Object.freeze([
  shape("kurt-basi", "Kurt Başı", 10, [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2], [1, 3]]),
  shape("yay", "Yay", 3, [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [0, 3]]),
  shape("at", "At", 4, [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2], [3, 2]]),
  shape("kartal", "Kartal", 6, [[0, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]),
  shape("hayat-agaci", "Hayat Ağacı", 8, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [1, 3], [1, 4]]),
  shape("hilal", "Hilal", 2, [[0, 0], [1, 0], [0, 1], [0, 2], [1, 2]]),
]);
export const ASENA_TEMPLATE_IDS: readonly AsenaTemplateId[] = Object.freeze(ASENA_TEMPLATES.map(t => t.id));

/** The 8 symmetries of the square. Transform t: if t & 1, mirror first (x -> -x); then rotate ((t >> 1) & 3) times by 90 degrees
 * clockwise on screen ((x, y) -> (-y, x) with y pointing down); finally translate so the minimum x and y are 0. */
export const ASENA_TRANSFORM_COUNT = 8;
/** Transforms the cells; the result is normalised to start at [0,0] and sorted by row, then column. */
export function asenaTransformCells(cells: readonly AsenaTemplateCell[], transform: number): [number, number][] {
  if (!Number.isInteger(transform) || transform < 0 || transform >= ASENA_TRANSFORM_COUNT) throw new RangeError("transform must be an integer 0..7");
  let out = cells.map(([x, y]): [number, number] => [transform & 1 ? -x : x, y]);
  for (let k = (transform >> 1) & 3; k > 0; k--) out = out.map(([x, y]): [number, number] => [-y, x]);
  const minX = Math.min(...out.map(([x]) => x)), minY = Math.min(...out.map(([, y]) => y));
  return out.map(([x, y]): [number, number] => [x - minX, y - minY]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
/** The board cells [col, row] a template covers for a transform and the top-left corner of its bounding box. */
export function asenaTemplatePositions(templateId: AsenaTemplateId, transform: number, col: number, row: number): [number, number][] {
  const template = ASENA_TEMPLATES.find(t => t.id === templateId);
  if (!template) throw new RangeError("unknown template id");
  return asenaTransformCells(template.cells, transform).map(([x, y]): [number, number] => [col + x, row + y]);
}

// --- Public data shapes --------------------------------------------------------------------------------
export interface AsenaCell { id: number; symbol: AsenaSymbol }
/** [col][row], row 0 on top. */
export type AsenaGrid = AsenaCell[][];
export interface AsenaIgnition {
  templateIndex: number; templateId: AsenaTemplateId; multiplier: number;
  /** 0..7, see ASENA_TRANSFORM_COUNT. */
  transform: number;
  /** Top-left corner of the transformed template's bounding box on the board. */
  origin: [number, number];
  /** The template's board positions [col, row] (row-major sorted) and the matching cell ids. */
  positions: [number, number][];
  cells: number[];
}
export interface AsenaCluster {
  symbol: AsenaPaySymbol; size: number;
  /** Ids of every cluster cell (wilds included), sorted by cell index. */
  cells: number[];
  /** Pay from the table before the template multiplier. */
  basePayHundredths: number;
  /** 1 when no constellation ignites. */
  templateMultiplier: number;
  /** basePayHundredths * templateMultiplier (before the global multiplier). */
  payHundredths: number;
  constellation: AsenaIgnition | null;
}
export interface AsenaMove { id: number; col: number; fromRow: number; toRow: number }
export interface AsenaDrop { id: number; col: number; row: number; symbol: AsenaSymbol }
export interface AsenaFall {
  /** The board after burst, gravity and refill (before the wolf walks). */
  grid: AsenaGrid;
  /** Survivors whose row changed. */
  moves: AsenaMove[];
  /** Fresh cells, column by column, top to bottom (ids consecutive). */
  drops: AsenaDrop[];
}
export interface AsenaWolfWalk {
  /** The wolf's cell id (it keeps its id). */
  id: number;
  from: [number, number]; to: [number, number];
  /** [from, to]. */
  path: [[number, number], [number, number]];
  /** The star-trail wild left on `from` (fresh id). */
  trail: { id: number; col: number; row: number };
  /** The cell overwritten on `to` (its id disappears from the board). */
  consumed: { id: number; symbol: AsenaSymbol };
}
export interface AsenaMapUnlock { template: number; templateId: AsenaTemplateId; count: number }
export interface AsenaMapEvent {
  /** Pieces unlocked in this step (a piece counts at most twice); never empty. */
  unlocked: AsenaMapUnlock[];
  /** Pieces per template after the step (0..2 each). */
  pieces: number[];
  distinct: number;
  globalMultiplierBefore: number; globalMultiplierAfter: number;
  /** Free spins unlocked by the map in this step (+5 at 3 distinct, +5 at 6). */
  freeSpinsAwarded: number;
}
/** steps[k].grid is the board at the start of the step. The last step has no clusters and no fall. For every other step
 * steps[k+1].grid is steps[k].fall.grid with that step's wolf walks applied. Cell objects are shared between steps; treat them
 * as read-only. */
export interface AsenaStep {
  grid: AsenaGrid;
  clusters: AsenaCluster[];
  /** Sum of the cluster pays (templates applied), before the global multiplier. */
  clusterHundredths: number;
  /** Global multiplier applied to this step (x1 in the base game; in free spins the value after this step's map unlocks). */
  globalMultiplier: number;
  /** clusterHundredths * globalMultiplier. */
  winHundredths: number;
  /** Ids that explode (every cluster cell except wolves; a trail wild that takes part in a win is used up). */
  burst: number[];
  fall: AsenaFall | null;
  wolfWalks: AsenaWolfWalk[];
  /** Free spins only, only when an ignition unlocked a map piece. */
  map: AsenaMapEvent | null;
}
export interface AsenaWolfPath { id: number; cells: [number, number][] }
export interface AsenaSpin {
  index: number; kind: "base" | "free"; steps: AsenaStep[];
  scatterCount: number; scatterHundredths: number;
  /** Sum of step wins (global multiplier applied). */
  tumbleHundredths: number;
  /** Sum of the steps' clusterHundredths (before the global multiplier). */
  clusterHundredths: number;
  /** Global multiplier at the start / end of the spin (always 1 in the base spin). */
  globalMultiplierBefore: number; globalMultiplierAfter: number;
  /** Map pieces per template at the start / end of the spin (all 0 in the base spin). */
  mapBefore: number[]; mapAfter: number[];
  /** Full path of every wolf that walked in this spin (start cell, then one cell per walk). */
  wolfPaths: AsenaWolfPath[];
  /** tumbleHundredths + scatterHundredths, before the round cap. */
  winHundredths: number;
  /** From 3+ moons (10 on trigger, 3 on retrigger) and from the map (5 + 5), before the safety bound. */
  scatterSpinsAwarded: number; mapSpinsAwarded: number;
  /** Free spins actually granted by this spin (after the 200 bound). */
  freeSpinsAwarded: number;
  /** Free spins still to play after this spin (0 once the cap ended the round). */
  freeSpinsLeft: number;
  /** Cumulative round total with the cap applied. */
  totalHundredthsAfter: number;
}
export interface AsenaRound {
  engine: typeof ASENA_ENGINE_ID; seedHex: string; mode: AsenaMode; betCents: number; costCents: number;
  spins: AsenaSpin[]; totalHundredths: number; payoutCents: number; capped: boolean; freeSpinsTriggered: boolean;
}

// --- Tables ----------------------------------------------------------------------------------------------
/** Pay symbols in table order. */
export const ASENA_PAY_SYMBOLS: readonly AsenaPaySymbol[] = Object.freeze(["h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4"] as const);
/** Cluster-size tiers: sizes 5, 6, 7, 8-9, 10-12, 13-17, 18+. */
export const ASENA_TIER_COUNT = 7;
export function asenaTier(size: number): number { return size <= 7 ? Math.max(0, size - 5) : size <= 9 ? 3 : size <= 12 ? 4 : size <= 17 ? 5 : 6; }
/** Hundredths of the bet per size tier, shared by all modes. */
export const ASENA_PAYTABLE: Record<AsenaPaySymbol, readonly number[]> = Object.freeze({
  h1: Object.freeze([60, 120, 240, 480, 960, 1680, 2880]),
  h2: Object.freeze([40, 80, 160, 320, 640, 1120, 1920]),
  h3: Object.freeze([28, 56, 112, 224, 448, 784, 1344]),
  h4: Object.freeze([20, 40, 80, 160, 320, 560, 960]),
  l1: Object.freeze([14, 28, 56, 112, 224, 392, 672]),
  l2: Object.freeze([10, 20, 40, 80, 160, 280, 480]),
  l3: Object.freeze([8, 16, 32, 64, 128, 224, 384]),
  l4: Object.freeze([6, 12, 24, 48, 96, 168, 288]),
});
/** Base game only, hundredths of the bet for 3, 4 and 5+ moons on the final board of a spin. */
export const ASENA_SCATTER_PAY: { 3: number; 4: number; 5: number } = Object.freeze({ 3: 300, 4: 800, 5: 6000 });

export type AsenaWeighted<T> = readonly (readonly [T, number])[];
export interface AsenaModeTables {
  /** Base-game symbol weights (wolf and moon included; "trail" is never dealt; the wolf weight counts on the initial board only). */
  base: AsenaWeighted<AsenaSymbol>;
  /** Free-spin symbol weights. */
  free: AsenaWeighted<AsenaSymbol>;
}
const symbols = (pay: readonly number[], wolf: number, moon: number): AsenaWeighted<AsenaSymbol> => [
  ["h1", pay[0]!], ["h2", pay[1]!], ["h3", pay[2]!], ["h4", pay[3]!], ["l1", pay[4]!], ["l2", pay[5]!], ["l3", pay[6]!], ["l4", pay[7]!],
  ["wolf", wolf], ["moon", moon],
];
/** Symbol weights h1..h4, l1..l4. All weights are written x100 of the unit weight so the wolf and moon weights (the intensity knobs)
 * can be tuned in very fine steps: the RTP reacts strongly to the wolf weight. */
const BASE_PAY = [5600, 7000, 8600, 10_200, 12_200, 14_400, 16_600, 19_000];
/** Free spins are much more clustered than the base game (fewer effective symbols), which is what lights the constellations. */
const FREE_PAY = [1600, 2500, 4000, 6200, 10_000, 15_500, 24_000, 40_000];
const FREE_PAY_MILD = [2000, 3000, 4500, 6500, 10_000, 15_000, 22_000, 34_000];

const deepFreeze = (tables: Record<AsenaMode, AsenaModeTables>): Record<AsenaMode, AsenaModeTables> => {
  for (const mode of Object.keys(tables) as AsenaMode[]) {
    const t = tables[mode];
    for (const list of [t.base, t.free] as readonly (readonly unknown[])[]) { for (const row of list) Object.freeze(row); Object.freeze(list); }
    Object.freeze(t);
  }
  return Object.freeze(tables);
};
/** Weight tables per mode. Tuned by Monte Carlo; see ops/evidence/asena-20261012. */
export const ASENA_MODE_TABLES: Record<AsenaMode, AsenaModeTables> = deepFreeze({
  standard: { base: symbols(BASE_PAY, 700, 640), free: symbols(FREE_PAY, 850, 800) },
  // Ante: moon weight 830 instead of 640 in the base game (about 1.8x the feature rate); a slightly milder free table so that the
  // higher trigger rate returns about 95.5% of the (5/4) cost.
  ante: { base: symbols(BASE_PAY, 700, 830), free: symbols(FREE_PAY, 830, 800) },
  // Buy: base table as standard (plus the 3-moon guarantee); a milder free table so that the guaranteed feature returns about
  // 95.5% of its 80 x bet cost.
  buy: { base: symbols(BASE_PAY, 700, 640), free: symbols(FREE_PAY_MILD, 860, 800) },
});

export interface AsenaRtp { rtp: number; ciLow: number; ciHigh: number; rounds: number; hitRate: number; featureRate: number; stdDev: number }
// @evidence-block-begin (engineSourceSha256 in the evidence is the sha256 of this file with the lines from here to the end marker removed)
/** Copied from ops/evidence/asena-20261012/rtp.json (a test keeps them equal). rtp, ciLow and ciHigh are return / COST as
 * ratios (0.955 = 95.5%), rounded to 3 decimals; hitRate = base spins with any win per round (3 decimals); featureRate = rounds
 * that trigger free spins (4 decimals); stdDev = standard deviation of the per-round return in cost units (3 decimals); rounds =
 * simulated rounds. DEMO estimate, not a certified RTP; the 95% interval is a normal approximation and optimistic for this heavy
 * tail. */
export const ASENA_RTP: Record<AsenaMode, AsenaRtp> = Object.freeze({
  standard: Object.freeze({ rtp: 0, ciLow: 0, ciHigh: 0, rounds: 0, hitRate: 0, featureRate: 0, stdDev: 0 }),
  ante: Object.freeze({ rtp: 0, ciLow: 0, ciHigh: 0, rounds: 0, hitRate: 0, featureRate: 0, stdDev: 0 }),
  buy: Object.freeze({ rtp: 0, ciLow: 0, ciHigh: 0, rounds: 0, hitRate: 0, featureRate: 0, stdDev: 0 }),
});
// @evidence-block-end

// --- Compiled configuration ---------------------------------------------------------------------------
interface Compiled<T> { items: T[]; cumulative: number[]; total: number }
interface ModeConfig { base: Compiled<AsenaSymbol>; free: Compiled<AsenaSymbol>; baseRefill: Compiled<AsenaSymbol>; freeRefill: Compiled<AsenaSymbol> }
/** One placement of one transformed template: the cells as a 36-bit mask (bit = col * 6 + row; lo = bits 0-31, hi = bits 32-35). */
interface Placement { transform: number; x0: number; y0: number; lo: number; hi: number; dx: number[]; dy: number[] }
interface CompiledTemplate { index: number; id: AsenaTemplateId; multiplier: number; size: number; /** Match order: transform 0..7 (repeated shapes skipped), then top-left corner row-major. */ placements: Placement[] }
interface EngineConfig {
  modes: Record<AsenaMode, ModeConfig>;
  paytable: Record<AsenaPaySymbol, readonly number[]>;
  scatterPay: { 3: number; 4: number; 5: number };
  /** Templates in match order: highest multiplier first, ties by index. */
  templates: CompiledTemplate[];
  mapMultipliers: { 3: number; 6: number; twice: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; buyMinScatters: number;
}
export type AsenaTuning = Partial<{
  tables: Partial<Record<AsenaMode, Partial<AsenaModeTables>>>;
  paytable: Record<AsenaPaySymbol, readonly number[]>;
  scatterPay: { 3: number; 4: number; 5: number };
  /** Six multipliers in template index order. */
  templateMultipliers: readonly number[];
  mapMultipliers: { 3: number; 6: number; twice: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number; buyMinScatters: number;
}>;

const SEED_PATTERN = /^[0-9a-f]{32}$/;
const TWO_POW_32 = 4_294_967_296;
const BET_LEVELS = new Set<number>(ASENA_BET_LEVELS_CENTS);
const CELLS = ASENA_COLS * ASENA_ROWS;

function compile<T>(table: AsenaWeighted<T>): Compiled<T> {
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
function compileTemplate(template: AsenaTemplate, index: number, multiplier: number): CompiledTemplate {
  if (!Number.isSafeInteger(multiplier) || multiplier < 1) throw new RangeError("Template multipliers must be positive safe integers");
  const seen = new Set<string>();
  const placements: Placement[] = [];
  for (let transform = 0; transform < ASENA_TRANSFORM_COUNT; transform++) {
    const cells = asenaTransformCells(template.cells, transform), key = cells.map(c => `${c[0]},${c[1]}`).join(";");
    if (seen.has(key)) continue; // a symmetric shape repeats; the lowest transform index owns the shape
    seen.add(key);
    const dx = cells.map(c => c[0]), dy = cells.map(c => c[1]);
    const width = Math.max(...dx) + 1, height = Math.max(...dy) + 1;
    for (let y0 = 0; y0 + height <= ASENA_ROWS; y0++) {
      for (let x0 = 0; x0 + width <= ASENA_COLS; x0++) {
        let lo = 0, hi = 0;
        for (let k = 0; k < dx.length; k++) {
          const bit = (x0 + dx[k]!) * ASENA_ROWS + y0 + dy[k]!;
          if (bit < 32) lo |= 1 << bit; else hi |= 1 << (bit - 32);
        }
        placements.push({ transform, x0, y0, lo, hi, dx, dy });
      }
    }
  }
  return { index, id: template.id, multiplier, size: template.cells.length, placements };
}
function configFrom(tuning: AsenaTuning): EngineConfig {
  const modes = {} as Record<AsenaMode, ModeConfig>;
  for (const mode of ASENA_MODES) {
    const base = ASENA_MODE_TABLES[mode], over = tuning.tables?.[mode] ?? {};
    const noWolf = (table: AsenaWeighted<AsenaSymbol>): AsenaWeighted<AsenaSymbol> => table.map(([symbol, w]) => [symbol, symbol === "wolf" ? 0 : w] as const);
    const baseTable = over.base ?? base.base, freeTable = over.free ?? base.free;
    modes[mode] = { base: compile(baseTable), free: compile(freeTable), baseRefill: compile(noWolf(baseTable)), freeRefill: compile(noWolf(freeTable)) };
  }
  const multipliers = tuning.templateMultipliers ?? ASENA_TEMPLATES.map(t => t.multiplier);
  if (multipliers.length !== ASENA_TEMPLATES.length) throw new RangeError("templateMultipliers needs one value per template");
  const templates = ASENA_TEMPLATES.map((t, i) => compileTemplate(t, i, multipliers[i]!)).sort((a, b) => b.multiplier - a.multiplier || a.index - b.index);
  return {
    modes, paytable: tuning.paytable ?? ASENA_PAYTABLE, scatterPay: tuning.scatterPay ?? ASENA_SCATTER_PAY, templates,
    mapMultipliers: tuning.mapMultipliers ?? ASENA_MAP_MULTIPLIERS,
    capHundredths: tuning.capHundredths ?? ASENA_MAX_WIN_MULTIPLIER * 100,
    maxFreeSpins: tuning.maxFreeSpins ?? ASENA_MAX_FREE_SPINS, maxTumbles: tuning.maxTumbles ?? ASENA_MAX_TUMBLES,
    buyMinScatters: tuning.buyMinScatters ?? ASENA_BUY_MIN_SCATTERS,
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
interface Dealer { rng: () => number; table: Compiled<AsenaSymbol>; refill: Compiled<AsenaSymbol>; nextId: number }
function dealCell(d: Dealer, table: Compiled<AsenaSymbol> = d.table): AsenaCell { return { symbol: pick(table, d.rng), id: d.nextId++ }; }
function dealGrid(d: Dealer): AsenaGrid {
  const grid: AsenaGrid = [];
  for (let c = 0; c < ASENA_COLS; c++) {
    const column: AsenaCell[] = [];
    for (let r = 0; r < ASENA_ROWS; r++) column.push(dealCell(d));
    grid.push(column);
  }
  return grid;
}
/** Buy guarantee: turns RNG-chosen non-moon cells into moons until the board holds `minScatters`. See the file header. */
function ensureMoons(grid: AsenaGrid, minScatters: number, rng: () => number): void {
  let moons = 0;
  for (const column of grid) for (const cell of column) if (cell.symbol === "moon") moons++;
  while (moons < minScatters) {
    const spots: [number, number][] = [];
    for (let c = 0; c < ASENA_COLS; c++) for (let r = 0; r < ASENA_ROWS; r++) if (grid[c]![r]!.symbol !== "moon") spots.push([c, r]);
    const [c, r] = spots[Math.floor(rng() * spots.length / TWO_POW_32)]!;
    grid[c]![r] = { id: grid[c]![r]!.id, symbol: "moon" };
    moons++;
  }
}

/** Orthogonal neighbours of a cell index (col * 6 + row) in the order up, right, down, left. */
const NEIGHBOURS: readonly (readonly number[])[] = Array.from({ length: CELLS }, (_, i) => {
  const c = Math.floor(i / ASENA_ROWS), r = i % ASENA_ROWS, n: number[] = [];
  if (r > 0) n.push(i - 1);
  if (c < ASENA_COLS - 1) n.push(i + ASENA_ROWS);
  if (r < ASENA_ROWS - 1) n.push(i + 1);
  if (c > 0) n.push(i - ASENA_ROWS);
  return n;
});

const seenStamp = new Int32Array(CELLS);
let stamp = 0;
/** Per cell: 0..7 pay symbol index, 8 wild, 9 moon. Filled by findClusterIndices from the flat board. */
const codes = new Int8Array(CELLS);
const stack = new Int32Array(CELLS);
const CODE_OF: Record<AsenaSymbol, number> = { h1: 0, h2: 1, h3: 2, h4: 3, l1: 4, l2: 5, l3: 6, l4: 7, wolf: 8, trail: 8, moon: 9 };
interface RawCluster { symbol: AsenaPaySymbol; indices: number[] }
function findClusterIndices(flat: readonly AsenaCell[]): RawCluster[] {
  const found: RawCluster[] = [];
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  let wilds = 0;
  for (let i = 0; i < CELLS; i++) {
    const code = CODE_OF[flat[i]!.symbol];
    codes[i] = code;
    if (code < 8) counts[code]!++; else if (code === 8) wilds++;
  }
  for (let symbol = 0; symbol < 8; symbol++) {
    if (counts[symbol]! === 0 || counts[symbol]! + wilds < ASENA_MIN_CLUSTER) continue;
    if (++stamp > 2_000_000_000) { seenStamp.fill(0); stamp = 1; }
    for (let i = 0; i < CELLS; i++) {
      if (codes[i] !== symbol || seenStamp[i] === stamp) continue;
      let top = 0;
      const component = [i];
      stack[top++] = i;
      seenStamp[i] = stamp;
      while (top > 0) {
        const j = stack[--top]!;
        for (const k of NEIGHBOURS[j]!) {
          if (seenStamp[k] === stamp) continue;
          const code = codes[k]!;
          if (code === symbol || code === 8) { seenStamp[k] = stamp; stack[top++] = k; component.push(k); }
        }
      }
      if (component.length >= ASENA_MIN_CLUSTER) found.push({ symbol: ASENA_PAY_SYMBOLS[symbol]!, indices: component.sort((a, b) => a - b) });
    }
  }
  return found;
}
function flatten(grid: AsenaGrid): AsenaCell[] {
  const flat: AsenaCell[] = new Array(CELLS);
  for (let c = 0; c < ASENA_COLS; c++) for (let r = 0; r < ASENA_ROWS; r++) flat[c * ASENA_ROWS + r] = grid[c]![r]!;
  return flat;
}
/** The best constellation inside a set of cell indices, or null. */
function matchTemplates(indices: readonly number[], flat: readonly AsenaCell[], templates: readonly CompiledTemplate[]): AsenaIgnition | null {
  let lo = 0, hi = 0;
  for (const i of indices) { if (i < 32) lo |= 1 << i; else hi |= 1 << (i - 32); }
  for (const template of templates) {
    if (template.size > indices.length) continue;
    for (const p of template.placements) {
      if ((lo & p.lo) !== p.lo || (hi & p.hi) !== p.hi) continue;
      const positions = p.dx.map((dx, k): [number, number] => [p.x0 + dx, p.y0 + p.dy[k]!]);
      return {
        templateIndex: template.index, templateId: template.id, multiplier: template.multiplier, transform: p.transform, origin: [p.x0, p.y0],
        positions, cells: positions.map(([c, r]) => flat[c * ASENA_ROWS + r]!.id),
      };
    }
  }
  return null;
}

function fallAndRefill(grid: AsenaGrid, burst: ReadonlySet<number>, d: Dealer): AsenaFall {
  const moves: AsenaMove[] = [], drops: AsenaDrop[] = [];
  const next: AsenaCell[][] = grid.map((column, c) => {
    const survivors: AsenaCell[] = [];
    column.forEach(cell => { if (!burst.has(cell.id)) survivors.push(cell); });
    const missing = ASENA_ROWS - survivors.length, fresh: AsenaCell[] = [];
    for (let k = 0; k < missing; k++) { const cell = dealCell(d, d.refill); fresh.push(cell); drops.push({ id: cell.id, col: c, row: k, symbol: cell.symbol }); }
    survivors.forEach((cell, k) => {
      const toRow = missing + k, fromRow = column.indexOf(cell);
      if (fromRow !== toRow) moves.push({ id: cell.id, col: c, fromRow, toRow });
    });
    return [...fresh, ...survivors];
  });
  return { grid: next, moves, drops };
}
/** Walks every wolf in `walkers` once (column-major position order). Returns the walks and the new board (same object when nobody moved). */
function walkWolves(grid: AsenaGrid, walkers: ReadonlySet<number>, d: Dealer): { grid: AsenaGrid; walks: AsenaWolfWalk[] } {
  const order: [number, number][] = [];
  for (let c = 0; c < ASENA_COLS; c++) for (let r = 0; r < ASENA_ROWS; r++) {
    const cell = grid[c]![r]!;
    if (cell.symbol === "wolf" && walkers.has(cell.id)) order.push([c, r]);
  }
  if (order.length === 0) return { grid, walks: [] };
  const board = grid.map(column => column.slice());
  const walks: AsenaWolfWalk[] = [];
  for (const [c, r] of order) {
    const targets: [number, number][] = [];
    const candidates: [number, number][] = [[c, r - 1], [c + 1, r], [c, r + 1], [c - 1, r]];
    for (const [tc, tr] of candidates) {
      if (tc < 0 || tc >= ASENA_COLS || tr < 0 || tr >= ASENA_ROWS) continue;
      const s = board[tc]![tr]!.symbol;
      if (s !== "moon" && s !== "wolf") targets.push([tc, tr]);
    }
    if (targets.length === 0) continue;
    const [tc, tr] = targets[Math.floor(d.rng() * targets.length / TWO_POW_32)]!;
    const wolf = board[c]![r]!, eaten = board[tc]![tr]!;
    const trail: AsenaCell = { id: d.nextId++, symbol: "trail" };
    board[tc]![tr] = wolf;
    board[c]![r] = trail;
    walks.push({ id: wolf.id, from: [c, r], to: [tc, tr], path: [[c, r], [tc, tr]], trail: { id: trail.id, col: c, row: r }, consumed: { id: eaten.id, symbol: eaten.symbol } });
  }
  return { grid: walks.length > 0 ? board : grid, walks };
}

interface Feature { pieces: number[]; multiplier: number; reached3: boolean; reached6: boolean; reachedTwice: boolean }
function newFeature(): Feature { return { pieces: ASENA_TEMPLATES.map(() => 0), multiplier: 1, reached3: false, reached6: false, reachedTwice: false }; }

/** Ergenekon map: lights the pieces of the ignited templates (in cluster order), then applies the thresholds. Returns null when no piece changed. */
function applyIgnitions(f: Feature, ignitions: readonly AsenaIgnition[], cfg: Pick<EngineConfig, "mapMultipliers">): AsenaMapEvent | null {
  const before = f.multiplier, unlocked: AsenaMapUnlock[] = [];
  for (const ignition of ignitions) {
    if (f.pieces[ignition.templateIndex]! < 2) { f.pieces[ignition.templateIndex]!++; unlocked.push({ template: ignition.templateIndex, templateId: ignition.templateId, count: f.pieces[ignition.templateIndex]! }); }
  }
  if (unlocked.length === 0) return null;
  const distinct = f.pieces.filter(p => p >= 1).length;
  let spins = 0;
  if (distinct >= 3 && !f.reached3) { f.reached3 = true; spins += ASENA_MAP_SPINS_AT_3; f.multiplier = Math.max(f.multiplier, cfg.mapMultipliers[3]); }
  if (distinct >= 6 && !f.reached6) { f.reached6 = true; spins += ASENA_MAP_SPINS_AT_6; f.multiplier = Math.max(f.multiplier, cfg.mapMultipliers[6]); }
  if (!f.reachedTwice && f.pieces.every(p => p >= 2)) { f.reachedTwice = true; f.multiplier = Math.max(f.multiplier, cfg.mapMultipliers.twice); }
  return { unlocked, pieces: f.pieces.slice(), distinct, globalMultiplierBefore: before, globalMultiplierAfter: f.multiplier, freeSpinsAwarded: spins };
}

type SpinCore = Omit<AsenaSpin, "freeSpinsAwarded" | "freeSpinsLeft" | "totalHundredthsAfter">;
function playSpin(cfg: EngineConfig, d: Dealer, kind: "base" | "free", index: number, guaranteeMoons: number, feature: Feature | null): SpinCore {
  let grid = dealGrid(d);
  if (guaranteeMoons > 0) ensureMoons(grid, guaranteeMoons, d.rng);
  const free = kind === "free" && feature !== null;
  const multiplierBefore = free ? feature!.multiplier : 1, mapBefore = free ? feature!.pieces.slice() : ASENA_TEMPLATES.map(() => 0);
  const steps: AsenaStep[] = [];
  const paths = new Map<number, [number, number][]>();
  let tumbleHundredths = 0, clusterTotal = 0, mapSpinsAwarded = 0;
  for (let t = 0; ; t++) {
    const flat = flatten(grid);
    const raw = t >= cfg.maxTumbles ? [] : findClusterIndices(flat);
    if (raw.length === 0) {
      steps.push({ grid, clusters: [], clusterHundredths: 0, globalMultiplier: free ? feature!.multiplier : 1, winHundredths: 0, burst: [], fall: null, wolfWalks: [], map: null });
      break;
    }
    const clusters: AsenaCluster[] = [];
    let clusterHundredths = 0;
    for (const rc of raw) {
      const size = rc.indices.length, basePay = cfg.paytable[rc.symbol]![asenaTier(size)]!;
      const constellation = matchTemplates(rc.indices, flat, cfg.templates);
      const templateMultiplier = constellation ? constellation.multiplier : 1;
      const payHundredths = basePay * templateMultiplier;
      clusterHundredths += payHundredths;
      clusters.push({ symbol: rc.symbol, size, cells: rc.indices.map(i => flat[i]!.id), basePayHundredths: basePay, templateMultiplier, payHundredths, constellation });
    }
    let map: AsenaMapEvent | null = null;
    if (free) {
      map = applyIgnitions(feature!, clusters.map(c => c.constellation).filter((x): x is AsenaIgnition => x !== null), cfg);
      if (map) mapSpinsAwarded += map.freeSpinsAwarded;
    }
    const globalMultiplier = free ? feature!.multiplier : 1;
    const winHundredths = clusterHundredths * globalMultiplier;
    tumbleHundredths += winHundredths;
    clusterTotal += clusterHundredths;
    // Burst: every cluster cell except wolves (a wolf stays and walks); trail wilds are used up when they take part in a win.
    const burst = new Set<number>(), walkers = new Set<number>();
    for (const rc of raw) {
      for (const i of rc.indices) {
        const cell = flat[i]!;
        if (cell.symbol === "wolf") walkers.add(cell.id); else burst.add(cell.id);
      }
    }
    const fall = fallAndRefill(grid, burst, d);
    const walked = walkWolves(fall.grid, walkers, d);
    for (const w of walked.walks) {
      const path = paths.get(w.id);
      if (path) path.push(w.to); else paths.set(w.id, [w.from, w.to]);
    }
    steps.push({ grid, clusters, clusterHundredths, globalMultiplier, winHundredths, burst: [...burst].sort((a, b) => a - b), fall, wolfWalks: walked.walks, map });
    grid = walked.grid;
  }
  let scatterCount = 0;
  for (const column of grid) for (const cell of column) if (cell.symbol === "moon") scatterCount++;
  const scatterHundredths = kind === "base" && scatterCount >= 3 ? cfg.scatterPay[scatterCount >= 5 ? 5 : scatterCount === 4 ? 4 : 3] : 0;
  const scatterSpinsAwarded = scatterCount >= 3 ? (kind === "base" ? ASENA_FREE_SPINS_TRIGGER : ASENA_FREE_SPINS_RETRIGGER) : 0;
  return {
    index, kind, steps, scatterCount, scatterHundredths, tumbleHundredths, clusterHundredths: clusterTotal,
    globalMultiplierBefore: multiplierBefore, globalMultiplierAfter: free ? feature!.multiplier : 1, mapBefore, mapAfter: free ? feature!.pieces.slice() : mapBefore.slice(),
    wolfPaths: [...paths].map(([id, cells]) => ({ id, cells })), winHundredths: tumbleHundredths + scatterHundredths, scatterSpinsAwarded, mapSpinsAwarded,
  };
}

function costOf(betCents: number, mode: AsenaMode): number {
  const [num, den] = ASENA_COST_FRACTION[mode];
  return (betCents * num) / den;
}
function validate(seedHex: unknown, betCents: unknown, mode: unknown): asserts seedHex is string {
  if (typeof seedHex !== "string" || !SEED_PATTERN.test(seedHex)) throw new RangeError("seedHex must be 32 lowercase hex characters");
  if (typeof betCents !== "number" || !BET_LEVELS.has(betCents)) throw new RangeError("betCents must be one of ASENA_BET_LEVELS_CENTS");
  if (typeof mode !== "string" || !(ASENA_MODES as readonly string[]).includes(mode)) throw new RangeError("mode must be standard, ante or buy");
}

function playRound(cfg: EngineConfig, seedHex: string, betCents: number, mode: AsenaMode): AsenaRound {
  validate(seedHex, betCents, mode);
  const tables = cfg.modes[mode];
  const dealer: Dealer = { rng: createRng(seedHex), table: tables.base, refill: tables.baseRefill, nextId: 0 };
  const spins: AsenaSpin[] = [];
  let total = 0, capped = false, freeLeft = 0, freeGranted = 0, triggered = false, feature: Feature | null = null;
  for (let index = 0; ; index++) {
    const kind = index === 0 ? "base" : "free";
    if (kind === "free") freeLeft--;
    dealer.table = kind === "base" ? tables.base : tables.free;
    dealer.refill = kind === "base" ? tables.baseRefill : tables.freeRefill;
    const spin = playSpin(cfg, dealer, kind, index, kind === "base" && mode === "buy" ? cfg.buyMinScatters : 0, feature);
    const wanted = spin.scatterSpinsAwarded + spin.mapSpinsAwarded;
    const awarded = Math.max(0, Math.min(wanted, cfg.maxFreeSpins - freeGranted));
    freeGranted += awarded;
    freeLeft += awarded;
    if (kind === "base" && awarded > 0) { triggered = true; feature = newFeature(); }
    const raw = total + spin.winHundredths;
    if (raw >= cfg.capHundredths) { total = cfg.capHundredths; capped = true; freeLeft = 0; } else total = raw;
    spins.push({ ...spin, freeSpinsAwarded: awarded, freeSpinsLeft: freeLeft, totalHundredthsAfter: total });
    if (capped || freeLeft <= 0) break;
  }
  const payoutCents = Number(BigInt(betCents) * BigInt(total) / 100n);
  return {
    engine: ASENA_ENGINE_ID, seedHex, mode, betCents, costCents: costOf(betCents, mode),
    spins, totalHundredths: total, payoutCents, capped, freeSpinsTriggered: triggered,
  };
}

/** Cost in cents of one round: standard = bet, ante = bet * 5 / 4, buy = bet * 80.
 * Throws RangeError for a bet that is not a level of ASENA_BET_LEVELS_CENTS or an unknown mode. */
export function asenaCostCents(betCents: number, mode: AsenaMode): number {
  validate("0".repeat(32), betCents, mode);
  return costOf(betCents, mode);
}

/** Resolves a whole round: base spin, tumbles, constellations, wolf walks, any Ergenekon free spins, the 5000 x bet cap and the
 * integer payout. Throws RangeError for a seed that is not 32 lowercase hex characters, a bet outside the levels or an unknown mode. */
export function playAsenaRound(seedHex: string, betCents: number, mode: AsenaMode): AsenaRound {
  return playRound(DEFAULT_CONFIG, seedHex, betCents, mode);
}

/** 4 x uint32 (for example crypto.getRandomValues) -> 32 lowercase hex characters, word 0 first. */
export function asenaSeedFromEntropy(words: Uint32Array): string {
  if (!(words instanceof Uint32Array) || words.length !== 4) throw new RangeError("Entropy must be a Uint32Array of 4 words");
  let out = "";
  for (let i = 0; i < 4; i++) out += (words[i]! >>> 0).toString(16).padStart(8, "0");
  return out;
}

const EMPTY_TUNING: AsenaTuning = Object.freeze({});
const tunedConfigs = new WeakMap<object, EngineConfig>();
/** Test and simulation hooks: not part of the public game API. */
export const __asenaTest = {
  /** Plays with a tuning override; the compiled configuration is cached per tuning object (do not mutate a tuning after using it). */
  play: (seedHex: string, betCents: number, mode: AsenaMode, tuning: AsenaTuning = EMPTY_TUNING): AsenaRound => {
    let cfg = tunedConfigs.get(tuning);
    if (!cfg) { cfg = configFrom(tuning); tunedConfigs.set(tuning, cfg); }
    return playRound(cfg, seedHex, betCents, mode);
  },
  createRng,
  /** Clusters of a hand-built board (same order as the engine reports them), with the constellation of each. */
  findClusters: (grid: AsenaGrid, tuning: AsenaTuning = {}): AsenaCluster[] => {
    const cfg = configFrom(tuning), flat = flatten(grid);
    return findClusterIndices(flat).map(rc => {
      const size = rc.indices.length, basePay = cfg.paytable[rc.symbol]![asenaTier(size)]!, constellation = matchTemplates(rc.indices, flat, cfg.templates);
      return { symbol: rc.symbol, size, cells: rc.indices.map(i => flat[i]!.id), basePayHundredths: basePay, templateMultiplier: constellation ? constellation.multiplier : 1, payHundredths: basePay * (constellation ? constellation.multiplier : 1), constellation };
    });
  },
  /** Best constellation inside an arbitrary set of [col, row] positions (no connectivity or size check). */
  matchPositions: (positions: readonly (readonly [number, number])[], tuning: AsenaTuning = {}): AsenaIgnition | null => {
    const cfg = configFrom(tuning), grid: AsenaGrid = Array.from({ length: ASENA_COLS }, (_, c) => Array.from({ length: ASENA_ROWS }, (_, r): AsenaCell => ({ id: c * ASENA_ROWS + r, symbol: "h1" })));
    return matchTemplates(positions.map(([c, r]) => c * ASENA_ROWS + r), flatten(grid), cfg.templates);
  },
  /** Runs the Ergenekon map state machine on a list of ignited template indices (one per cluster). Returns the events and the final state. */
  mapRun: (steps: readonly (readonly number[])[], tuning: AsenaTuning = {}): { events: (AsenaMapEvent | null)[]; multiplier: number; pieces: number[] } => {
    const cfg = configFrom(tuning), f = newFeature();
    const events = steps.map(step => applyIgnitions(f, step.map(i => ({ templateIndex: i, templateId: ASENA_TEMPLATES[i]!.id, multiplier: 1, transform: 0, origin: [0, 0] as [number, number], positions: [], cells: [] })), cfg));
    return { events, multiplier: f.multiplier, pieces: f.pieces.slice() };
  },
  ensureMoons: (grid: AsenaGrid, minScatters: number, seedHex: string): void => ensureMoons(grid, minScatters, createRng(seedHex)),
  /** Walks the wolves in `walkers` on a hand-built board with a seeded stream; ids of new trail wilds start at `nextId`. */
  walk: (grid: AsenaGrid, walkers: readonly number[], seedHex: string, nextId = 1000): { grid: AsenaGrid; walks: AsenaWolfWalk[] } =>
    walkWolves(grid, new Set(walkers), { rng: createRng(seedHex), table: compile([["h1", 1]]), refill: compile([["h1", 1]]), nextId }),
};
