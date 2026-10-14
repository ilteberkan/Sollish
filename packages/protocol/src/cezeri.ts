/** Cezeri engine `cezeri-gears-1` (working name "Cezeri: Zamanın Çarkları"): DEMO-credit concentric-ring slot with
 * 4 rings x 12 slices, 12 spokes, a hub multiplier, a gear-lock respin chain (Dişli Kilidi), vessel scatters and the "Fil Saati"
 * free spins (persistent hub + falcon wild slices). Three modes (standard, ante, buy).
 * Pure and deterministic: same 32-hex seed, bet level and mode always give the identical round. No clock, no
 * Math.random, no network, no balance or wager input beyond the bet level. The whole round (every rotation, lock,
 * respin, free spin and the cap) is resolved before presentation; animation, tab visibility, reduced motion or
 * disconnects cannot change a result. All arithmetic is integer: wins are summed in hundredths of the BET and the
 * payout is floor(betCents * hundredths / 100).
 *
 * This file is self-contained (own RNG, picker, strip tables, spoke evaluation) so the evidence covers these bytes
 * only; no other engine is imported.
 *
 * Board: rings 0 (innermost, next to the hub) .. 3 (outermost), each with 12 slices (slice 0..11 = angular
 * position). Spoke s is slice s of rings 0..3. board[ring][slice]. A ring spins on its own circular STRIP (length
 * 30..48, symbols below); one draw picks the stop i from a weighted stop table and the 12 visible slices are
 * strip[(i + k) mod L], k = 0..11. Stop weights are a "virtual reel": every stop weighs 100 except the stops
 * whose 12-slice window shows a vessel, which weigh `vesselStop` (per ring, per mode and base/free). That is how
 * the vessel rate is tuned although a single vessel on a long strip would otherwise be visible in 25 %+ of the stops.
 *
 * Symbols: h1..h4, l1..l4 pay; "gear" (Altin Disli, wild) substitutes for every pay symbol; "vessel" (Su Kabi) is
 * the scatter. Strip letters: A..H = h1..h4, l1..l4; W = gear; V = vessel.
 *
 * Rules (authoritative text: docs/product/games-wave2.md section 1):
 *   - Spoke win: along a spoke, 3 or 4 consecutive slices of the same pay symbol (gear counts as that symbol) that start at
 *     ring 0 (rings 0-2 or 0-3) or at ring 1 (rings 1-3, 3 slices). The target symbol is the first non-gear slice of the run's
 *     start; a vessel or a different symbol ends the run. A start that has 3 or 4 gears also has a pure-gear run (gear pay
 *     table); the better pays. Per spoke the better of the ring-0 run and the ring-1 run pays (a tie goes to ring 0), so a spoke
 *     holds at most one paying run. The 12 spokes pay independently. Pay table is in hundredths of the bet per spoke (before the hub).
 *   - Hub: every spin starts with a hub draw (HUB_BASE / HUB_FREE weights over x1,2,3,5,10). It multiplies every spoke
 *     win of the rotation. Base game: hub = draw. Free spin: hub = max(carried hub, draw) (see Fil Saati).
 *   - Dişli Kilidi (gear lock) chain, one per spin: rotation 0 turns all 4 rings. Every spoke is evaluated. A spoke win
 *     is NEW when its pay is larger than the pay already collected on that spoke in this chain (a run that grows from 3 to 4
 *     slices pays only the difference; unchanged spokes pay nothing). New wins pay (increment x hub). If there is at least one
 *     new win, the slices of the paying runs are HELD (pinned: they keep their symbol and do not move), the hub gets +1 and
 *     ALL four rings turn again underneath (four stop draws, rings 0..3), the held slices overlaying what the strips show. The
 *     chain goes on as long as a rotation produces a NEW pay (a new spoke, or a held run that is extended). It ends on the first
 *     rotation without a new pay, when all 48 slices are held, or after CEZERI_MAX_RESPINS (10) respins (the last rotation still
 *     pays). Held slices are released when the spin ends. Base-game respins turn on the `respin` strips (richer in gear wilds
 *     than the first rotation, which is what makes chains run on: about 2 respins per winning chain); free spins use the free strips
 *     for every rotation. Hub after k respins = start + k, so at most start + 10 in the base game.
 *   - Scatter (vessel): counted on the FINAL board of a spin, after the chain. Base spin: 3 / 4 / 5+ vessels pay 2x /
 *     10x / 50x the bet (never multiplied by the hub) and award 10 free spins. Free spin: 2+ vessels award 4 more (no
 *     scatter pay). Total free spins granted in a round <= CEZERI_MAX_FREE_SPINS.
 *   - Fil Saati (free spins): the hub carries between free spins and only rises: the first free spin starts at its
 *     draw, every later free spin at max(hub the previous spin ended on, its draw), and chain respins add +1 on top. The
 *     water reservoir gains one level after every free spin; at level 3 it empties and, if free spins remain, the
 *     automaton falcon turns 1..3 slices of one ring into persistent gear wilds (CEZERI_FALCON_COUNT weights). Falcon
 *     wilds are pinned to the window (ring, slice): every later rotation and respin shows gear there until the
 *     feature ends (they can also complete wins and are overwritten by nothing).
 *   - Cap 10000 x bet in every mode: the round ends at once, free spins left become 0.
 *
 * Modes (bet = base bet in cents):
 *   standard  cost = bet.          Base and free tables.
 *   ante      cost = bet * 5 / 4.  Base vessel stop weight raised (about 2x feature rate), mode-specific free hub
 *                                  weights; buying is off.
 *   buy       cost = bet * 100.    After the chain of the base spin, if fewer than 3 vessels are on the board, RNG-chosen
 *                                  slices become vessels until there are 3 (procedure below), so the 10 free spins
 *                                  always trigger; mode-specific free hub weights.
 * Wins are always measured against the bet. Each mode's RTP is measured against its COST and tuned separately
 * (CEZERI_RTP, ops/evidence/cezeri-20261012).
 *
 * RNG and draw order: SplitMix32 expands the seed into xoshiro128**. One stream continues across the whole round.
 *   spin: 1 hub draw (u32, weighted); rotation 0: rings 0,1,2,3 one stop draw each; every respin: rings 0,1,2,3 one stop
 *   draw each (also for rings whose slices are all held); buy-mode forge (base spin only, after the chain): see below.
 *   After a free spin (when the reservoir reaches 3 and free spins remain): ring draw (u32, uniform over the rings that
 *   still have a non-gear window slice), count draw (weighted 1..3, limited to the free slices of that ring), then one
 *   uniform u32 per placed slice over the remaining free slice ids (ascending, removing each pick).
 * Buy forge (base spin, after the chain, only when vessels < 3): candidates = non-vessel slices that are not held
 * (not part of any paying run of this spin), listed ring 0..3, slice 0..11. For each missing vessel draw one u32, pick index
 * floor(u32 * length / 2^32), turn that slice into a vessel (it leaves the list for the next pick). Only if that list is
 * empty before the guarantee is met, the same procedure continues over the remaining non-vessel slices of winning runs
 * (same listing order). Wins were already paid, so the forge can never remove a win.
 * Pick rule everywhere: index = floor(u32 * total / 2^32) over the cumulative weights (u32 * total < 2^53, exact).
 */

export const CEZERI_ENGINE_ID = "cezeri-gears-1";
export const CEZERI_RINGS = 4;
export const CEZERI_SLICES = 12;
export const CEZERI_SPOKES = 12;
export const CEZERI_MAX_WIN_MULTIPLIER = 10_000;
export const CEZERI_FREE_SPINS_TRIGGER = 10;
export const CEZERI_FREE_SPINS_RETRIGGER = 4;
/** Vessels needed in a base spin to trigger (and the number the buy mode guarantees). */
export const CEZERI_TRIGGER_VESSELS = 3;
/** Vessels needed in a free spin to retrigger. */
export const CEZERI_RETRIGGER_VESSELS = 2;
/** Safety bound on the free spins granted in one round (the 10000 x cap normally ends a round long before). */
export const CEZERI_MAX_FREE_SPINS = 100;
/** Free spins between two falcon visits (the reservoir has this many levels). */
export const CEZERI_RESERVOIR_LEVELS = 3;
export const CEZERI_STOP_BASE_WEIGHT = 100;
/** Hard cap on respins in one chain (rotations <= 11). */
export const CEZERI_MAX_RESPINS = 10;

export type CezeriPaySymbol = "h1" | "h2" | "h3" | "h4" | "l1" | "l2" | "l3" | "l4";
export type CezeriSymbol = CezeriPaySymbol | "gear" | "vessel";
export type CezeriMode = "standard" | "ante" | "buy";
export const CEZERI_MODES: readonly CezeriMode[] = Object.freeze(["standard", "ante", "buy"] as const);
/** Bet levels in cents (same as Storm Throne): 1, 2, 3, 4, 5, 8, 10, 15, 20, 25, 40, 50, 75, 100, 150, 200, 250, 400, 500 DEMO. All divisible by 4. */
export const CEZERI_BET_LEVELS_CENTS: readonly number[] = Object.freeze([
  100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 40_000, 50_000,
]);
/** Cost = bet * numerator / denominator. */
export const CEZERI_COST_FRACTION: Readonly<Record<CezeriMode, readonly [number, number]>> = Object.freeze({
  standard: Object.freeze([1, 1] as const), ante: Object.freeze([5, 4] as const), buy: Object.freeze([100, 1] as const),
});

/** [ring 0..3 inner to outer][slice 0..11]. */
export type CezeriBoard = CezeriSymbol[][];
/** [ring, slice]. */
export type CezeriPos = readonly [ring: number, slice: number];

// --- Step types: the whole animation script of a spin ----------------------------------------------------------
// Order inside a spin (everything is already resolved; the UI only plays it back):
//   hub(round 0) -> rotate(round 0) -> win* -> [ lock -> hub(round k) -> rotate(round k) -> win* ]* -> end
//   -> [scatter] -> [falcon]
// `lock` is present only after a rotation that had at least one new win; the `hub`/`rotate` pair that follows exists
// only when `lock.respin` is true. The last rotation of a chain has no new win unless the respin cap ended it.
// `falcon` is last and only in free spins.
/** The hub shows its value for the rotation of `round`. round 0: draw (base) or max(carried, draw) (free). round k > 0:
 * previous + 1 (`reason: "respin"`, drawn null). */
export interface CezeriHubStep {
  type: "hub"; round: number; reason: "spin" | "respin"; value: number; previous: number; drawn: number | null;
  /** Hub carried in from the previous free spin (0 in the base spin and in the first free spin). */
  carried: number;
}
/** One ring turning to its stop (every ring turns in every rotation). `slices` is what the ring shows afterwards:
 * `pinned` lists the slice ids that are permanent falcon wilds (gear), `held` the slice ids held by the Dişli Kilidi
 * (the winning slices of earlier rotations of this chain: they keep their symbol and do not move). Every other slice comes
 * from the strip window starting at `stop`. */
export interface CezeriRingSpin { ring: number; stop: number; stripLength: number; slices: CezeriSymbol[]; pinned: number[]; held: number[] }
/** `rings` has all 4 rings in ascending order; `board` is the complete board after the rotation (a copy). */
export interface CezeriRotateStep { type: "rotate"; round: number; rings: CezeriRingSpin[]; board: CezeriBoard }
/** One new spoke win. `cells` are the slices of the winning run (rings startRing..startRing+length-1, slice = spoke), `wildRings` the rings of
 * the run that show a gear. `fullHundredths` is the run's pay, `paidBefore` what the spoke already paid in this chain,
 * `payHundredths` = fullHundredths - paidBefore (> 0), `winHundredths` = payHundredths * hub. */
export interface CezeriWinStep {
  type: "win"; round: number; spoke: number; symbol: CezeriPaySymbol | "gear"; length: 3 | 4; startRing: 0 | 1; cells: CezeriPos[]; wildRings: number[];
  fullHundredths: number; paidBefore: number; payHundredths: number; hub: number; winHundredths: number;
}
/** After a rotation with new wins. `held` = every slice that is held now, `newHeld` = slices held by this rotation's wins,
 * `respin` = another rotation follows (false when the respin cap is reached or no free slice is left). */
export interface CezeriLockStep { type: "lock"; round: number; held: CezeriPos[]; newHeld: CezeriPos[]; respin: boolean }
/** Chain finished (the held slices are released now). rotations = 1 + respins; hub = the hub of the last rotation;
 * chainCapped = the last rotation still paid but the respin cap (CEZERI_MAX_RESPINS) ended the chain. */
export interface CezeriEndStep { type: "end"; rotations: number; respins: number; hub: number; heldSlices: number; chainCapped: boolean; chainHundredths: number }
/** Vessels on the final board. `forged` lists the slices the buy guarantee turned into vessels (already in `cells`).
 * base: payHundredths for 3+ vessels; `freeSpinsAwarded` is what this spin really granted (10 on trigger, 4 on
 * retrigger, less when CEZERI_MAX_FREE_SPINS bounds it). */
export interface CezeriScatterStep {
  type: "scatter"; count: number; cells: CezeriPos[]; forged: CezeriPos[]; payHundredths: number; freeSpinsAwarded: number;
}
/** The falcon landed on `ring` and pinned the gear wilds at `slices`; `wilds` = every pinned wild slice now. */
export interface CezeriFalconStep { type: "falcon"; ring: number; slices: number[]; wilds: CezeriPos[] }
export type CezeriStep = CezeriHubStep | CezeriRotateStep | CezeriWinStep | CezeriLockStep | CezeriEndStep | CezeriScatterStep | CezeriFalconStep;

export interface CezeriSpin {
  index: number; kind: "base" | "free"; steps: CezeriStep[];
  /** Final board of the spin (after the chain and the buy forge). */
  board: CezeriBoard;
  rotations: number; respins: number;
  /** Hub of the first rotation / of the last rotation of this spin. */
  hubStart: number; hubEnd: number;
  /** Sum of the win steps x hub, i.e. the whole chain. */
  chainHundredths: number;
  vesselCount: number; scatterHundredths: number;
  /** chainHundredths + scatterHundredths, before the round cap. */
  winHundredths: number;
  /** 10 on trigger, 4 on retrigger, otherwise 0 (what was really granted). */
  freeSpinsAwarded: number;
  /** Free spins still to play after this spin (0 once the cap ended the round). */
  freeSpinsLeft: number;
  /** Reservoir level after this free spin before the falcon empties it (0 in the base game; 3 = the falcon came or would have come). */
  reservoir: number;
  /** Pinned falcon wild slices after this spin (free spins only). */
  wilds: CezeriPos[];
  /** Cumulative round total with the cap applied. */
  totalHundredthsAfter: number;
}
export interface CezeriRound {
  engine: typeof CEZERI_ENGINE_ID; seedHex: string; mode: CezeriMode; betCents: number; costCents: number;
  spins: CezeriSpin[]; totalHundredths: number; payoutCents: number; capped: boolean; freeSpinsTriggered: boolean;
}

/** Hundredths of the bet per spoke for a run of [3, 4] slices, before the hub. */
export const CEZERI_PAYTABLE: Record<CezeriPaySymbol, readonly [number, number]> = Object.freeze({
  h1: Object.freeze([23, 114] as const),
  h2: Object.freeze([15, 76] as const),
  h3: Object.freeze([10, 53] as const),
  h4: Object.freeze([8, 38] as const),
  l1: Object.freeze([5, 24] as const),
  l2: Object.freeze([4, 19] as const),
  l3: Object.freeze([3, 14] as const),
  l4: Object.freeze([2, 11] as const),
});
/** Pure gear run (3 or 4 gears from ring 0), hundredths of the bet before the hub. */
export const CEZERI_GEAR_PAY: readonly [number, number] = Object.freeze([38, 190] as const);
/** Base game only, hundredths of the bet for 3, 4 and 5+ vessels on the final board. */
export const CEZERI_SCATTER_PAY: { 3: number; 4: number; 5: number } = Object.freeze({ 3: 200, 4: 1000, 5: 5000 });
/** Falcon: number of wild slices placed per visit. */
export const CEZERI_FALCON_COUNT: readonly (readonly [number, number])[] = Object.freeze([[1, 50], [2, 35], [3, 15]].map(r => Object.freeze(r)) as unknown as readonly (readonly [number, number])[]);

export type CezeriWeighted<T> = readonly (readonly [T, number])[];
export interface CezeriRingTable { /** Strip letters (A..H pay, W gear, V vessel), length 30..48. */ strip: string; /** Weight of the stops that show a vessel (normal stops weigh 100). */ vesselStop: number }
export interface CezeriModeTables {
  /** Four rings, inner to outer. */
  base: readonly CezeriRingTable[];
  /** Base game only: the strips the rings turn on in the respins of a chain (the first rotation uses `base`). Free spins use `free` for every rotation. */
  respin: readonly CezeriRingTable[];
  free: readonly CezeriRingTable[];
  hubBase: CezeriWeighted<number>;
  hubFree: CezeriWeighted<number>;
}

// Strips were generated by experiments/cezeri/make-strips.ts (symbol counts in its SPEC, see the README there) and are frozen here.
/** First rotation of a base spin (no gears). */
const BASE_STRIPS: readonly string[] = ["VADHBCHECEFEBGABFCHGFACDBFDGAGDEH", "VGDHAFCHBAEDBEDAGFHBCFHCDCFEGABGE", "VDCFGHGFEBFECBDEDFAGACAFDHAHBHGHBEGBCEDAC", "VCFBGAFADEAHBDHFBEFCDCGAFGBDGHECHDACHEBGE"];
/** Base-game respins of a chain (one gear per ring). */
const RESPIN_STRIPS: readonly string[] = ["VBAHBDEGCBGACHFWEDAECDHEGHFCBGFAFD", "VDAFDFDEWHABCBEGCBECADHGACBGHGFEHF", "VCWBDGHEBGBACFCEBDGCADHFABDEHAGFHADGECHFEF", "VAEDHBCFGCABADCDBHDGAEGCAEBHBGFWFCGDHFEFEH"];
/** Every rotation of a free spin. */
const FREE_STRIPS: readonly string[] = ["VCDCBDFGECEFDAGBHGAFHEHAFGBEWCBD", "VHEDGBGHEAWDCAHGBACEDFCFDFEFEBDFBCGC", "VFBEAGHAFDECAHEBEHBAHEDCGDWBDFCFGCGBFDCG", "VFEBFECGHDHABDFECWFCFGCGDHBAGDBDHEACADFCEGEB"];

const rings = (strips: readonly string[], vesselStop: readonly number[]): readonly CezeriRingTable[] => strips.map((strip, i) => Object.freeze({ strip, vesselStop: vesselStop[i]! }));
const deepFreeze = (tables: Record<CezeriMode, CezeriModeTables>): Record<CezeriMode, CezeriModeTables> => {
  for (const mode of Object.keys(tables) as CezeriMode[]) {
    const t = tables[mode];
    for (const list of [t.hubBase, t.hubFree] as readonly (readonly unknown[])[]) { for (const row of list) Object.freeze(row); Object.freeze(list); }
    Object.freeze(t.base); Object.freeze(t.respin); Object.freeze(t.free); Object.freeze(t);
  }
  return Object.freeze(tables);
};
/** Weight tables per mode. Tuned by Monte Carlo; see ops/evidence/cezeri-20261012. */
export const CEZERI_MODE_TABLES: Record<CezeriMode, CezeriModeTables> = deepFreeze({
  standard: { base: rings(BASE_STRIPS, [22, 22, 22, 22]), respin: rings(RESPIN_STRIPS, [22, 22, 22, 22]), free: rings(FREE_STRIPS, [23, 23, 23, 23]),
    hubBase: [[1, 40], [2, 26], [3, 17], [5, 11], [10, 6]],
    hubFree: [[1, 72], [2, 120], [3, 100], [5, 67], [10, 36]] },
  // Ante: vessel stops weigh more in the base game (about 2x feature rate); the free vessel stop and hub draws are a little tamer so the doubled trigger rate stays at about 95.5% of the (5/4) cost.
  ante: { base: rings(BASE_STRIPS, [28, 28, 28, 28]), respin: rings(RESPIN_STRIPS, [28, 28, 28, 28]), free: rings(FREE_STRIPS, [21, 21, 21, 21]),
    hubBase: [[1, 40], [2, 26], [3, 17], [5, 11], [10, 6]],
    hubFree: [[1, 346], [2, 308], [3, 216], [5, 82], [10, 38]] },
  // Buy: base as standard (plus the 3-vessel guarantee); a lower free vessel stop and tamer hub draws so the guaranteed feature returns about 95.5% of its 100 x bet cost.
  buy: { base: rings(BASE_STRIPS, [22, 22, 22, 22]), respin: rings(RESPIN_STRIPS, [22, 22, 22, 22]), free: rings(FREE_STRIPS, [19, 19, 19, 19]),
    hubBase: [[1, 40], [2, 26], [3, 17], [5, 11], [10, 6]],
    hubFree: [[1, 220], [2, 126], [3, 38], [5, 14], [10, 2]] },
});

export interface CezeriRtp { rtp: number; ciLow: number; ciHigh: number; rounds: number; hitRate: number; featureRate: number; stdDev: number }
// @evidence-block-begin (engineSourceSha256 in the evidence is the sha256 of this file with the lines from here to the end marker removed)
/** Copied from ops/evidence/cezeri-20261012/rtp.json (a test keeps them equal). rtp, ciLow and ciHigh are return / COST as ratios (0.955 = 95.5%),
 * rounded to 3 decimals; hitRate = base spins with any win per round (3 decimals); featureRate = rounds that trigger free spins (4 decimals);
 * stdDev = standard deviation of the per-round return in cost units (3 decimals); rounds = simulated rounds. DEMO estimate, not a certified RTP;
 * the 95% interval is a normal approximation and optimistic for this heavy tail. */
export const CEZERI_RTP: Record<CezeriMode, CezeriRtp> = Object.freeze({
  standard: Object.freeze({ rtp: 0.949, ciLow: 0.942, ciHigh: 0.955, rounds: 20_000_000, hitRate: 0.287, featureRate: 0.0029, stdDev: 14.424 }),
  ante: Object.freeze({ rtp: 0.956, ciLow: 0.95, ciHigh: 0.962, rounds: 20_000_000, hitRate: 0.29, featureRate: 0.0052, stdDev: 13.923 }),
  buy: Object.freeze({ rtp: 0.955, ciLow: 0.954, ciHigh: 0.955, rounds: 20_000_000, hitRate: 1, featureRate: 1, stdDev: 1.701 }),
});
// @evidence-block-end

// --- Compiled configuration ---------------------------------------------------------------------
interface Compiled<T> { items: T[]; cumulative: number[]; total: number }
interface CompiledRing { strip: CezeriSymbol[]; stops: Compiled<number> }
interface ModeConfig { base: CompiledRing[]; respin: CompiledRing[]; free: CompiledRing[]; hubBase: Compiled<number>; hubFree: Compiled<number> }
interface EngineConfig {
  modes: Record<CezeriMode, ModeConfig>;
  paytable: Record<CezeriPaySymbol, readonly [number, number]>;
  gearPay: readonly [number, number];
  scatterPay: { 3: number; 4: number; 5: number };
  falcon: Compiled<number>;
  capHundredths: number; maxFreeSpins: number; buyMinVessels: number; maxRespins: number;
}
export type CezeriTuning = Partial<{
  tables: Partial<Record<CezeriMode, Partial<CezeriModeTables>>>;
  paytable: Record<CezeriPaySymbol, readonly [number, number]>;
  gearPay: readonly [number, number];
  scatterPay: { 3: number; 4: number; 5: number };
  falconCount: CezeriWeighted<number>;
  capHundredths: number; maxFreeSpins: number; buyMinVessels: number; maxRespins: number;
}>;

const PAY_SYMBOLS: readonly CezeriPaySymbol[] = ["h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4"];
const LETTER: Record<string, CezeriSymbol> = { A: "h1", B: "h2", C: "h3", D: "h4", E: "l1", F: "l2", G: "l3", H: "l4", W: "gear", V: "vessel" };
const SEED_PATTERN = /^[0-9a-f]{32}$/;
const TWO_POW_32 = 4_294_967_296;
const BET_LEVELS = new Set<number>(CEZERI_BET_LEVELS_CENTS);

function compile<T>(table: readonly (readonly [T, number])[]): Compiled<T> {
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
function compileRing(table: CezeriRingTable): CompiledRing {
  const letters = table.strip;
  if (typeof letters !== "string" || letters.length < CEZERI_SLICES) throw new RangeError("A strip needs at least 12 symbols");
  const strip = [...letters].map(ch => { const s = LETTER[ch]; if (!s) throw new RangeError(`Unknown strip letter ${ch}`); return s; });
  const length = strip.length;
  if (!Number.isSafeInteger(table.vesselStop) || table.vesselStop < 0) throw new RangeError("vesselStop must be a non-negative safe integer");
  const weights: (readonly [number, number])[] = [];
  for (let i = 0; i < length; i++) {
    let vessel = false;
    for (let k = 0; k < CEZERI_SLICES; k++) if (strip[(i + k) % length] === "vessel") { vessel = true; break; }
    weights.push([i, vessel ? table.vesselStop : CEZERI_STOP_BASE_WEIGHT]);
  }
  return { strip, stops: compile(weights) };
}
function compileRings(list: readonly CezeriRingTable[]): CompiledRing[] {
  if (list.length !== CEZERI_RINGS) throw new RangeError("Four ring tables are required");
  return list.map(compileRing);
}
function configFrom(tuning: CezeriTuning): EngineConfig {
  const modes = {} as Record<CezeriMode, ModeConfig>;
  for (const mode of CEZERI_MODES) {
    const t = CEZERI_MODE_TABLES[mode], over = tuning.tables?.[mode] ?? {};
    modes[mode] = {
      base: compileRings(over.base ?? t.base), respin: compileRings(over.respin ?? t.respin), free: compileRings(over.free ?? t.free),
      hubBase: compile(over.hubBase ?? t.hubBase), hubFree: compile(over.hubFree ?? t.hubFree),
    };
  }
  return {
    modes, paytable: tuning.paytable ?? CEZERI_PAYTABLE, gearPay: tuning.gearPay ?? CEZERI_GEAR_PAY,
    scatterPay: tuning.scatterPay ?? CEZERI_SCATTER_PAY, falcon: compile(tuning.falconCount ?? CEZERI_FALCON_COUNT),
    capHundredths: tuning.capHundredths ?? CEZERI_MAX_WIN_MULTIPLIER * 100,
    maxFreeSpins: tuning.maxFreeSpins ?? CEZERI_MAX_FREE_SPINS, buyMinVessels: tuning.buyMinVessels ?? CEZERI_TRIGGER_VESSELS, maxRespins: tuning.maxRespins ?? CEZERI_MAX_RESPINS,
  };
}
let defaultConfig: EngineConfig | undefined;
const getDefaultConfig = (): EngineConfig => (defaultConfig ??= configFrom({}));

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

// --- Spoke evaluation -----------------------------------------------------------------------------
interface SpokeRun { symbol: CezeriPaySymbol | "gear"; length: 3 | 4; pay: number; /** Ring of the first slice of the run (0 or 1). */ start: 0 | 1 }
/** Best run that starts exactly at ring `start` (4 - start slices available, run length 3 or 4), or null. Pure-gear run vs run of the first
 * non-gear symbol: the larger pay wins (ties: the symbol run). */
function evalFrom(cells: readonly CezeriSymbol[], start: 0 | 1, paytable: EngineConfig["paytable"], gearPay: EngineConfig["gearPay"]): SpokeRun | null {
  let leading = 0;
  while (start + leading < CEZERI_RINGS && cells[start + leading] === "gear") leading++;
  let best: SpokeRun | null = null;
  if (leading >= 3) best = { symbol: "gear", length: leading as 3 | 4, pay: gearPay[leading - 3]!, start };
  if (start + leading < CEZERI_RINGS) {
    const target = cells[start + leading]!;
    if (target !== "vessel" && target !== "gear") {
      let n = leading + 1;
      while (start + n < CEZERI_RINGS && (cells[start + n] === target || cells[start + n] === "gear")) n++;
      if (n >= 3) {
        const pay = paytable[target][n - 3]!;
        if (!best || pay >= best.pay) best = { symbol: target, length: n as 3 | 4, pay, start };
      }
    }
  }
  return best;
}
/** Best run of a spoke given its four slices ring 0..3, or null: the better of the run that starts at ring 0 (3 or 4 slices) and the run
 * that starts at ring 1 (3 slices, rings 1-3); a tie goes to the run from ring 0. */
function evalSpoke(cells: readonly CezeriSymbol[], paytable: EngineConfig["paytable"], gearPay: EngineConfig["gearPay"]): SpokeRun | null {
  const a = evalFrom(cells, 0, paytable, gearPay), b = evalFrom(cells, 1, paytable, gearPay);
  return !b || (a && a.pay >= b.pay) ? a : b;
}

// --- Spin -----------------------------------------------------------------------------------------
interface State {
  cfg: EngineConfig; rng: () => number;
  /** pinned falcon wilds [ring][slice] (free spins only). */
  wild: boolean[][];
}
const copyBoard = (board: CezeriBoard): CezeriBoard => board.map(ring => ring.slice());
function spinRing(s: State, ring: CompiledRing, ringId: number, board: CezeriBoard, withWilds: boolean, held: boolean[][]): CezeriRingSpin {
  const stop = pick(ring.stops, s.rng), length = ring.strip.length;
  const previous = board[ringId]!;
  const slices: CezeriSymbol[] = [], pinned: number[] = [], kept: number[] = [];
  for (let k = 0; k < CEZERI_SLICES; k++) {
    if (withWilds && s.wild[ringId]![k]) { slices.push("gear"); pinned.push(k); }
    else if (held[ringId]![k]) { slices.push(previous[k]!); kept.push(k); }
    else slices.push(ring.strip[(stop + k) % length]!);
  }
  board[ringId] = slices;
  return { ring: ringId, stop, stripLength: length, slices: slices.slice(), pinned, held: kept };
}
const posOf = (ring: number, slice: number): CezeriPos => [ring, slice];

interface SpinCore {
  steps: CezeriStep[]; board: CezeriBoard; rotations: number; respins: number; hubStart: number; hubEnd: number; chainHundredths: number;
  vesselCount: number; scatterHundredths: number; winHundredths: number; wanted: number;
}
/** One whole spin: hub draw, chain, vessel count (+ buy forge). `carriedHub` is 0 outside free spins. */
function playSpin(s: State, ringsOf: CompiledRing[], respinOf: CompiledRing[], hubTable: Compiled<number>, kind: "base" | "free", carriedHub: number, forge: number): SpinCore {
  const { cfg } = s;
  const withWilds = kind === "free";
  const steps: CezeriStep[] = [];
  const drawn = pick(hubTable, s.rng);
  let hub = kind === "free" ? Math.max(carriedHub, drawn) : drawn;
  const hubStart = hub;
  steps.push({ type: "hub", round: 0, reason: "spin", value: hub, previous: 0, drawn, carried: carriedHub });
  const board: CezeriBoard = [[], [], [], []];
  const held: boolean[][] = Array.from({ length: CEZERI_RINGS }, () => new Array<boolean>(CEZERI_SLICES).fill(false));
  let heldCount = 0;
  const spinAll = (tables: CompiledRing[]): CezeriRingSpin[] => tables.map((table, r) => spinRing(s, table, r, board, withWilds, held));
  steps.push({ type: "rotate", round: 0, rings: spinAll(ringsOf), board: copyBoard(board) });
  const paid = new Array<number>(CEZERI_SPOKES).fill(0);
  let round = 0, chain = 0, chainCapped = false;
  for (;;) {
    const newHeld: CezeriPos[] = [];
    let fresh = 0;
    for (let spoke = 0; spoke < CEZERI_SPOKES; spoke++) {
      const run = evalSpoke([board[0]![spoke]!, board[1]![spoke]!, board[2]![spoke]!, board[3]![spoke]!], cfg.paytable, cfg.gearPay);
      if (!run || run.pay <= paid[spoke]!) continue;
      const cells: CezeriPos[] = [], wildRings: number[] = [];
      for (let r = run.start; r < run.start + run.length; r++) {
        cells.push(posOf(r, spoke));
        if (!held[r]![spoke]) { held[r]![spoke] = true; heldCount++; newHeld.push(posOf(r, spoke)); }
        if (board[r]![spoke] === "gear") wildRings.push(r);
      }
      const increment = run.pay - paid[spoke]!;
      steps.push({
        type: "win", round, spoke, symbol: run.symbol, length: run.length, startRing: run.start, cells, wildRings,
        fullHundredths: run.pay, paidBefore: paid[spoke]!, payHundredths: increment, hub, winHundredths: increment * hub,
      });
      paid[spoke] = run.pay; chain += increment * hub; fresh++;
    }
    if (fresh === 0) break;
    const again = round < cfg.maxRespins && heldCount < CEZERI_RINGS * CEZERI_SLICES;
    if (!again && round >= cfg.maxRespins) chainCapped = true;
    const heldAll: CezeriPos[] = [];
    for (let r = 0; r < CEZERI_RINGS; r++) for (let k = 0; k < CEZERI_SLICES; k++) if (held[r]![k]) heldAll.push(posOf(r, k));
    steps.push({ type: "lock", round, held: heldAll, newHeld, respin: again });
    if (!again) break;
    round++;
    steps.push({ type: "hub", round, reason: "respin", value: hub + 1, previous: hub, drawn: null, carried: carriedHub });
    hub++;
    steps.push({ type: "rotate", round, rings: spinAll(respinOf), board: copyBoard(board) });
  }
  const winCells = new Set<number>(); // ring * 12 + slice of every winning run
  for (let r = 0; r < CEZERI_RINGS; r++) for (let k = 0; k < CEZERI_SLICES; k++) if (held[r]![k]) winCells.add(r * CEZERI_SLICES + k);
  steps.push({ type: "end", rotations: round + 1, respins: round, hub, heldSlices: heldCount, chainCapped, chainHundredths: chain });
  // Vessels on the final board, buy forge, scatter.
  let vessels = 0;
  for (const ring of board) for (const symbol of ring) if (symbol === "vessel") vessels++;
  const forged: CezeriPos[] = [];
  if (forge > 0 && vessels < forge) {
    const quiet: number[] = [], inRun: number[] = [];
    for (let r = 0; r < CEZERI_RINGS; r++) for (let k = 0; k < CEZERI_SLICES; k++) if (board[r]![k] !== "vessel") (winCells.has(r * CEZERI_SLICES + k) ? inRun : quiet).push(r * CEZERI_SLICES + k);
    while (vessels < forge && quiet.length + inRun.length > 0) {
      const spots = quiet.length > 0 ? quiet : inRun;
      const at = Math.floor(s.rng() * spots.length / TWO_POW_32);
      const spot = spots.splice(at, 1)[0]!;
      board[Math.floor(spot / CEZERI_SLICES)]![spot % CEZERI_SLICES] = "vessel";
      forged.push(posOf(Math.floor(spot / CEZERI_SLICES), spot % CEZERI_SLICES));
      vessels++;
    }
  }
  const scatterHundredths = kind === "base" && vessels >= CEZERI_TRIGGER_VESSELS ? cfg.scatterPay[vessels >= 5 ? 5 : vessels === 4 ? 4 : 3] : 0;
  const wanted = kind === "base" ? (vessels >= CEZERI_TRIGGER_VESSELS ? CEZERI_FREE_SPINS_TRIGGER : 0) : (vessels >= CEZERI_RETRIGGER_VESSELS ? CEZERI_FREE_SPINS_RETRIGGER : 0);
  if (wanted > 0 || forged.length > 0) {
    const cells: CezeriPos[] = [];
    for (let r = 0; r < CEZERI_RINGS; r++) for (let k = 0; k < CEZERI_SLICES; k++) if (board[r]![k] === "vessel") cells.push(posOf(r, k));
    steps.push({ type: "scatter", count: vessels, cells, forged, payHundredths: scatterHundredths, freeSpinsAwarded: wanted });
  }
  return { steps, board, rotations: round + 1, respins: round, hubStart, hubEnd: hub, chainHundredths: chain, vesselCount: vessels, scatterHundredths, winHundredths: chain + scatterHundredths, wanted };
}

/** The falcon visit: 1..3 free slices of one ring become persistent gear wilds. Returns the step, or null when the board is full of wilds. */
function falconVisit(s: State): CezeriFalconStep | null {
  const eligible: number[] = [];
  for (let r = 0; r < CEZERI_RINGS; r++) if (s.wild[r]!.some(w => !w)) eligible.push(r);
  if (eligible.length === 0) return null;
  const ring = eligible[Math.floor(s.rng() * eligible.length / TWO_POW_32)]!;
  let free: number[] = [];
  for (let k = 0; k < CEZERI_SLICES; k++) if (!s.wild[ring]![k]) free.push(k);
  const count = Math.min(pick(s.cfg.falcon, s.rng), free.length);
  const slices: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = Math.floor(s.rng() * free.length / TWO_POW_32);
    const slice = free[at]!;
    free = free.filter((_, j) => j !== at);
    s.wild[ring]![slice] = true; slices.push(slice);
  }
  const wilds: CezeriPos[] = [];
  for (let r = 0; r < CEZERI_RINGS; r++) for (let k = 0; k < CEZERI_SLICES; k++) if (s.wild[r]![k]) wilds.push(posOf(r, k));
  return { type: "falcon", ring, slices, wilds };
}

function costOf(betCents: number, mode: CezeriMode): number {
  const [num, den] = CEZERI_COST_FRACTION[mode];
  return (betCents * num) / den;
}
function validate(seedHex: unknown, betCents: unknown, mode: unknown): asserts seedHex is string {
  if (typeof seedHex !== "string" || !SEED_PATTERN.test(seedHex)) throw new RangeError("seedHex must be 32 lowercase hex characters");
  if (typeof betCents !== "number" || !BET_LEVELS.has(betCents)) throw new RangeError("betCents must be one of CEZERI_BET_LEVELS_CENTS");
  if (typeof mode !== "string" || !(CEZERI_MODES as readonly string[]).includes(mode)) throw new RangeError("mode must be standard, ante or buy");
}

function playRound(cfg: EngineConfig, seedHex: string, betCents: number, mode: CezeriMode): CezeriRound {
  validate(seedHex, betCents, mode);
  const tables = cfg.modes[mode];
  const s: State = { cfg, rng: createRng(seedHex), wild: Array.from({ length: CEZERI_RINGS }, () => new Array<boolean>(CEZERI_SLICES).fill(false)) };
  const spins: CezeriSpin[] = [];
  let total = 0, capped = false, freeLeft = 0, freeGranted = 0, triggered = false, carriedHub = 0, reservoir = 0;
  for (let index = 0; ; index++) {
    const kind = index === 0 ? "base" : "free";
    if (kind === "free") freeLeft--;
    const core = kind === "base"
      ? playSpin(s, tables.base, tables.respin, tables.hubBase, "base", 0, mode === "buy" ? cfg.buyMinVessels : 0)
      : playSpin(s, tables.free, tables.free, tables.hubFree, "free", carriedHub, 0);
    if (kind === "free") carriedHub = core.hubEnd;
    const awarded = Math.max(0, Math.min(core.wanted, cfg.maxFreeSpins - freeGranted));
    freeGranted += awarded;
    freeLeft += awarded;
    if (kind === "base" && awarded > 0) triggered = true;
    for (const step of core.steps) if (step.type === "scatter") step.freeSpinsAwarded = awarded;
    const raw = total + core.winHundredths;
    if (raw >= cfg.capHundredths) { total = cfg.capHundredths; capped = true; freeLeft = 0; } else total = raw;
    let reservoirLevel = 0;
    if (kind === "free") {
      reservoir++;
      reservoirLevel = reservoir;
      if (reservoir >= CEZERI_RESERVOIR_LEVELS) {
        reservoir = 0;
        if (freeLeft > 0) { const visit = falconVisit(s); if (visit) core.steps.push(visit); }
      }
    }
    const wilds: CezeriPos[] = [];
    if (kind === "free") for (let r = 0; r < CEZERI_RINGS; r++) for (let k = 0; k < CEZERI_SLICES; k++) if (s.wild[r]![k]) wilds.push(posOf(r, k));
    spins.push({
      index, kind, steps: core.steps, board: core.board, rotations: core.rotations, respins: core.respins, hubStart: core.hubStart, hubEnd: core.hubEnd,
      chainHundredths: core.chainHundredths, vesselCount: core.vesselCount, scatterHundredths: core.scatterHundredths, winHundredths: core.winHundredths,
      freeSpinsAwarded: awarded, freeSpinsLeft: freeLeft, reservoir: reservoirLevel, wilds, totalHundredthsAfter: total,
    });
    if (capped || freeLeft <= 0) break;
  }
  const payoutCents = Number(BigInt(betCents) * BigInt(total) / 100n);
  return {
    engine: CEZERI_ENGINE_ID, seedHex, mode, betCents, costCents: costOf(betCents, mode),
    spins, totalHundredths: total, payoutCents, capped, freeSpinsTriggered: triggered,
  };
}

/** Cost in cents of one round: standard = bet, ante = bet * 5 / 4, buy = bet * 100.
 * Throws RangeError for a bet that is not a level of CEZERI_BET_LEVELS_CENTS or an unknown mode. */
export function cezeriCostCents(betCents: number, mode: CezeriMode): number {
  validate("0".repeat(32), betCents, mode);
  return costOf(betCents, mode);
}

/** Resolves a whole round: base spin with its lock-and-respin chain, vessels, any Fil Saati free spins, the 10000 x bet cap and the
 * integer payout. Throws RangeError for a seed that is not 32 lowercase hex characters, a bet outside the levels or an unknown mode. */
export function playCezeriRound(seedHex: string, betCents: number, mode: CezeriMode): CezeriRound {
  return playRound(getDefaultConfig(), seedHex, betCents, mode);
}

/** 4 x uint32 (for example crypto.getRandomValues) -> 32 lowercase hex characters, word 0 first. */
export function cezeriSeedFromEntropy(words: Uint32Array): string {
  if (!(words instanceof Uint32Array) || words.length !== 4) throw new RangeError("Entropy must be a Uint32Array of 4 words");
  let out = "";
  for (let i = 0; i < 4; i++) out += (words[i]! >>> 0).toString(16).padStart(8, "0");
  return out;
}

/** Test and simulation hooks: not part of the public game API. */
export const __cezeriTest = {
  play: (seedHex: string, betCents: number, mode: CezeriMode, tuning: CezeriTuning = {}): CezeriRound => playRound(configFrom(tuning), seedHex, betCents, mode),
  /** Compiles a tuning once; the returned function plays rounds with it (simulation speed). */
  player: (tuning: CezeriTuning = {}): ((seedHex: string, betCents: number, mode: CezeriMode) => CezeriRound) => { const cfg = configFrom(tuning); return (seedHex, betCents, mode) => playRound(cfg, seedHex, betCents, mode); },
  createRng,
  evalSpoke: (cells: readonly CezeriSymbol[], paytable: EngineConfig["paytable"] = CEZERI_PAYTABLE, gearPay: EngineConfig["gearPay"] = CEZERI_GEAR_PAY): SpokeRun | null => evalSpoke(cells, paytable, gearPay),
  /** Window probability bookkeeping for tests: the compiled stop weights of a ring table. */
  stopWeights: (table: CezeriRingTable): number[] => { const c = compileRing(table); return c.stops.cumulative.map((x, i) => x - (c.stops.cumulative[i - 1] ?? 0)); },
};
