/** Candy Cascade engine `candy-cascade-1`: DEMO-credit tumble / scatter-pays game, 6x5 grid.
 * Pure and deterministic: same 32-hex seed and stake always give the identical round. No clock, no
 * Math.random, no network, no balance or wager input. The whole round (all tumbles, free spins and
 * the cap) is resolved before presentation; animation, tab visibility, reduced motion or
 * disconnects cannot change a result. All arithmetic is integer: wins are summed in hundredths of
 * the stake and the payout is floor(stakeCents * hundredths / 100).
 *
 * Paytable, weights and symbol set are original Sollish design values tuned by Monte Carlo
 * (experiments/candy-cascade, ops/evidence/candy-cascade-20261011). The RTP figure is an estimate
 * with a wide interval on a heavy-tailed game, not a certified RTP; this game is DEMO only.
 * Changing any table, rule or RNG detail needs a new engine id; never edit this one in place.
 *
 * RNG: SplitMix32 expands the seed into the xoshiro128** state (Blackman and Vigna). Draw order is
 * fixed: initial grid column 0..5, row 0..4 (row 0 on top); every cell draws one symbol, and a
 * crystal draws its value immediately afterwards. Tumble refill: column 0..5, top to bottom within
 * the column, same draw rule. The single stream continues across tumbles and free spins.
 */
export const CASCADE_ENGINE_ID = "candy-cascade-1";
export const CASCADE_COLS = 6;
export const CASCADE_ROWS = 5;
export const CASCADE_MAX_WIN_MULTIPLIER = 5000;
export const CASCADE_MIN_STAKE_CENTS = 100;
export const CASCADE_MAX_STAKE_CENTS = 50_000;
export const CASCADE_FREE_SPINS_TRIGGER = 10;
export const CASCADE_FREE_SPINS_RETRIGGER = 5;
/** Safety bounds; a legitimate round never approaches either (see simulation evidence). */
export const CASCADE_MAX_FREE_SPINS = 200;
export const CASCADE_MAX_TUMBLES = 100;

export type CascadePaySymbol = "crown" | "cupcake" | "donut" | "gumdrop" | "strawberry" | "blueberry" | "kiwi" | "lemon" | "cherry";
export type CascadeSymbol = CascadePaySymbol | "star" | "crystal";
export interface CascadeCell { id: number; symbol: CascadeSymbol; multiplier?: number }
/** [col][row], row 0 on top. */
export type CascadeGrid = CascadeCell[][];
export interface CascadeWin { symbol: CascadePaySymbol; count: number; payHundredths: number; cells: number[] }
/** steps[0].grid is the first dealt grid; steps[k+1].grid is steps[k].grid with that step's winners
 * removed, survivors dropped (ids kept) and the gaps refilled with fresh ids. The last step has no wins.
 * Cell objects are shared between steps; treat them as read-only. */
export interface CascadeStep { grid: CascadeGrid; wins: CascadeWin[]; stepHundredths: number }
export interface CascadeSpin {
  index: number; kind: "base" | "free"; steps: CascadeStep[];
  scatterCount: number; scatterHundredths: number;
  /** Sum of crystal values on the final grid (0 = none). */
  multiplierSum: number;
  /** Sum of the steps, before the multiplier. */
  tumbleHundredths: number;
  /** tumble x (multiplierSum || 1) + scatter, before the round cap. */
  winHundredths: number;
  /** 10 on trigger, 5 on retrigger, otherwise 0. */
  freeSpinsAwarded: number;
  /** Free spins still to play after this spin (0 once the cap ended the round). */
  freeSpinsLeft: number;
  /** Cumulative round total with the cap applied. */
  totalHundredthsAfter: number;
}
export interface CascadeRound {
  engine: typeof CASCADE_ENGINE_ID; seedHex: string; stakeCents: number;
  spins: CascadeSpin[]; totalHundredths: number; payoutCents: number; capped: boolean;
  freeSpinsTriggered: boolean;
}

/** Hundredths of stake per tier [8-9, 10-11, 12+], ordered from the highest to the lowest symbol class. */
export const CASCADE_PAYTABLE: Record<CascadePaySymbol, readonly [number, number, number]> = Object.freeze({
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
/** Base game only, hundredths of stake for 4, 5 and 6+ stars on the final grid of a spin. */
export const CASCADE_SCATTER_PAY: { 4: number; 5: number; 6: number } = Object.freeze({ 4: 300, 5: 500, 6: 10_000 });

type Weighted<T> = readonly (readonly [T, number])[];
export const CASCADE_BASE_WEIGHTS: Weighted<CascadeSymbol> = Object.freeze([
  ["crown", 60], ["cupcake", 80], ["donut", 100], ["gumdrop", 120],
  ["strawberry", 160], ["blueberry", 170], ["kiwi", 180], ["lemon", 190], ["cherry", 200], ["star", 21],
] as const);
/** Free spins add crystals (multiplier carriers) and shift weight toward the richer symbols. */
export const CASCADE_FREE_WEIGHTS: Weighted<CascadeSymbol> = Object.freeze([
  ["crown", 93], ["cupcake", 114], ["donut", 133], ["gumdrop", 142],
  ["strawberry", 138], ["blueberry", 107], ["kiwi", 86], ["lemon", 57], ["cherry", 38], ["star", 21], ["crystal", 100],
] as const);
export const CASCADE_CRYSTAL_WEIGHTS: Weighted<number> = Object.freeze([
  [2, 600], [3, 440], [4, 320], [5, 220], [6, 160], [8, 100], [10, 70], [12, 40], [15, 24], [20, 14], [25, 8], [50, 3], [100, 1],
] as const);

interface Compiled<T> { items: T[]; cumulative: number[]; total: number }
interface EngineConfig {
  base: Compiled<CascadeSymbol>; free: Compiled<CascadeSymbol>; crystals: Compiled<number>;
  paytable: Record<CascadePaySymbol, readonly [number, number, number]>;
  scatterPay: { 4: number; 5: number; 6: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number;
}
export type CascadeTuning = Partial<{
  base: Weighted<CascadeSymbol>; free: Weighted<CascadeSymbol>; crystals: Weighted<number>;
  paytable: Record<CascadePaySymbol, readonly [number, number, number]>;
  scatterPay: { 4: number; 5: number; 6: number };
  capHundredths: number; maxFreeSpins: number; maxTumbles: number;
}>;

const PAY_SYMBOLS: readonly CascadePaySymbol[] = ["crown", "cupcake", "donut", "gumdrop", "strawberry", "blueberry", "kiwi", "lemon", "cherry"];
const SEED_PATTERN = /^[0-9a-f]{32}$/;
const TWO_POW_32 = 4_294_967_296;

function compile<T>(table: Weighted<T>): Compiled<T> {
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

const DEFAULT_CONFIG: EngineConfig = {
  base: compile(CASCADE_BASE_WEIGHTS), free: compile(CASCADE_FREE_WEIGHTS), crystals: compile(CASCADE_CRYSTAL_WEIGHTS),
  paytable: CASCADE_PAYTABLE, scatterPay: CASCADE_SCATTER_PAY,
  capHundredths: CASCADE_MAX_WIN_MULTIPLIER * 100, maxFreeSpins: CASCADE_MAX_FREE_SPINS, maxTumbles: CASCADE_MAX_TUMBLES,
};
function configFrom(tuning: CascadeTuning): EngineConfig {
  return {
    base: tuning.base ? compile(tuning.base) : DEFAULT_CONFIG.base,
    free: tuning.free ? compile(tuning.free) : DEFAULT_CONFIG.free,
    crystals: tuning.crystals ? compile(tuning.crystals) : DEFAULT_CONFIG.crystals,
    paytable: tuning.paytable ?? DEFAULT_CONFIG.paytable,
    scatterPay: tuning.scatterPay ?? DEFAULT_CONFIG.scatterPay,
    capHundredths: tuning.capHundredths ?? DEFAULT_CONFIG.capHundredths,
    maxFreeSpins: tuning.maxFreeSpins ?? DEFAULT_CONFIG.maxFreeSpins,
    maxTumbles: tuning.maxTumbles ?? DEFAULT_CONFIG.maxTumbles,
  };
}

// --- RNG ---------------------------------------------------------------------------------------
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
/** xoshiro128** whose 128-bit state comes from SplitMix32 outputs xor-ed with the seed words.
 * The state can never be all zero, including for equal entropy words such as 0 or 0xffffffff. */
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

/** 4 x uint32 (for example crypto.getRandomValues) -> 32 lowercase hex characters, word 0 first. */
export function cascadeSeedFromEntropy(words: Uint32Array): string {
  if (!(words instanceof Uint32Array) || words.length !== 4) throw new RangeError("Entropy must be a Uint32Array of 4 words");
  let out = "";
  for (let i = 0; i < 4; i++) out += (words[i]! >>> 0).toString(16).padStart(8, "0");
  return out;
}

// --- Grid mechanics ----------------------------------------------------------------------------
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
function tierIndex(count: number): 0 | 1 | 2 { return count >= 12 ? 2 : count >= 10 ? 1 : 0; }
function findWins(grid: CascadeGrid, paytable: EngineConfig["paytable"]): CascadeWin[] {
  const cells = new Map<CascadePaySymbol, number[]>();
  for (const column of grid) for (const cell of column) {
    if (cell.symbol === "star" || cell.symbol === "crystal") continue;
    const list = cells.get(cell.symbol);
    if (list) list.push(cell.id); else cells.set(cell.symbol, [cell.id]);
  }
  const wins: CascadeWin[] = [];
  for (const symbol of PAY_SYMBOLS) { // fixed class order, so the result never depends on grid layout
    const ids = cells.get(symbol);
    if (ids && ids.length >= 8) wins.push({ symbol, count: ids.length, payHundredths: paytable[symbol][tierIndex(ids.length)], cells: ids });
  }
  return wins;
}
/** Removes the winning cells, drops the survivors and refills the top of every column. */
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

function playSpin(cfg: EngineConfig, d: Dealer, kind: "base" | "free", index: number): Omit<CascadeSpin, "freeSpinsAwarded" | "freeSpinsLeft" | "totalHundredthsAfter"> {
  let grid = dealGrid(d);
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

function playRound(cfg: EngineConfig, seedHex: string, stakeCents: number): CascadeRound {
  if (typeof seedHex !== "string" || !SEED_PATTERN.test(seedHex)) throw new RangeError("seedHex must be 32 lowercase hex characters");
  if (typeof stakeCents !== "number" || !Number.isSafeInteger(stakeCents) || stakeCents < CASCADE_MIN_STAKE_CENTS || stakeCents > CASCADE_MAX_STAKE_CENTS) {
    throw new RangeError(`stakeCents must be a safe integer in ${CASCADE_MIN_STAKE_CENTS}..${CASCADE_MAX_STAKE_CENTS}`);
  }
  const rng = createRng(seedHex);
  const dealer: Dealer = { rng, table: cfg.base, crystals: cfg.crystals, nextId: 0 };
  const spins: CascadeSpin[] = [];
  let total = 0, capped = false, freeLeft = 0, freeGranted = 0, triggered = false;
  for (let index = 0; ; index++) {
    const kind = index === 0 ? "base" : "free";
    if (kind === "free") freeLeft--;
    dealer.table = kind === "base" ? cfg.base : cfg.free;
    const spin = playSpin(cfg, dealer, kind, index); // ids keep counting up, unique across the whole round
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
  const payoutCents = Number(BigInt(stakeCents) * BigInt(total) / 100n);
  return { engine: CASCADE_ENGINE_ID, seedHex, stakeCents, spins, totalHundredths: total, payoutCents, capped, freeSpinsTriggered: triggered };
}

/** Resolves a whole round: base spin, tumbles, any free spins, the 5000x cap and the integer payout.
 * Throws RangeError for a seed that is not 32 lowercase hex characters or a stake outside 100..50000. */
export function playCascadeRound(seedHex: string, stakeCents: number): CascadeRound {
  return playRound(DEFAULT_CONFIG, seedHex, stakeCents);
}

/** Test and simulation hooks: not part of the public game API. `play` accepts alternative tables or a
 * lower cap so that rare branches (cap, retrigger, safety bounds) can be exercised deterministically. */
export const __cascadeTest = {
  play: (seedHex: string, stakeCents: number, tuning: CascadeTuning = {}): CascadeRound => playRound(configFrom(tuning), seedHex, stakeCents),
  createRng,
  findWins: (grid: CascadeGrid, paytable: EngineConfig["paytable"] = CASCADE_PAYTABLE): CascadeWin[] => findWins(grid, paytable),
  tumble: (grid: CascadeGrid, wins: readonly CascadeWin[], seedHex: string, nextId: number): CascadeGrid =>
    tumbleGrid(grid, wins, { rng: createRng(seedHex), table: DEFAULT_CONFIG.base, crystals: DEFAULT_CONFIG.crystals, nextId }),
};
