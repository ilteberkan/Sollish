/** Engine-free metadata of the server-playable slot games (docs/architecture/scale.md, 6.2).
 *
 * The browser needs a game's id, engine id, modes, bet levels and payout cap on every slot route (receipt parsing, probe,
 * bet selector), but the engine itself only on that one game's route. `slot-games.ts` imports every engine, so a route that
 * read `SLOT_GAMES` shipped all five. This file imports nothing: it is a literal copy of the registry's scalar fields, and
 * `test/slot-fair.test.ts` fails when any value drifts from `SLOT_GAMES` (which stays the registry the RGS server uses).
 * A rule change still needs a NEW id/engineId in BOTH places.
 */
export const SLOT_GAME_IDS = ["cascade", "tarhun", "ebru", "cezeri", "asena", "damla", "goreme"] as const;
export type SlotGameId = (typeof SLOT_GAME_IDS)[number];

export interface SlotGameMeta {
  readonly id: SlotGameId;
  readonly engineId: string;
  readonly modes: readonly string[];
  readonly betLevels: readonly number[];
  readonly maxMultiplier: number;
  /** Expected RTP (return / cost) per mode as the game states it: the simulated value of the engine's RTP table, Damla's exact
   * binomial value. Engine-free copy for the in-game session statistics; test/slot-fair.test.ts keeps it equal to the engines. */
  readonly expectedRtp: Readonly<Record<string, number>>;
}

const MODES: readonly string[] = Object.freeze(["standard", "ante", "buy"]);
const BET_LEVELS: readonly number[] = Object.freeze([100, 200, 300, 400, 500, 800, 1000, 1500, 2000, 2500, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 40000, 50000]);

/** Damla (instant drop game): one mode per risk and terrace count. */
const DAMLA_MODES: readonly string[] = Object.freeze(["low", "medium", "high"].flatMap(risk => [8, 10, 12, 14, 16].map(rows => `${risk}-${rows}`)));

/** Damla's exact binomial RTP per mode (DAMLA_EXACT_RTP, 9 decimals). */
const DAMLA_EXPECTED_RTP: Readonly<Record<string, number>> = Object.freeze({
  "low-8": 0.98515625, "low-10": 0.984863281, "low-12": 0.985507812, "low-14": 0.985544433, "low-16": 0.98545227,
  "medium-8": 0.98484375, "medium-10": 0.98515625, "medium-12": 0.984467773, "medium-14": 0.984990234, "medium-16": 0.985117797,
  "high-8": 0.985, "high-10": 0.984570312, "high-12": 0.984526367, "high-14": 0.984876708, "high-16": 0.984908447,
});

export const SLOT_GAME_META: Readonly<Record<SlotGameId, SlotGameMeta>> = Object.freeze({
  cascade: Object.freeze({ id: "cascade", engineId: "candy-cascade-2", modes: MODES, betLevels: BET_LEVELS, maxMultiplier: 5000, expectedRtp: Object.freeze({ standard: 0.957, ante: 0.963, buy: 0.962 }) }),
  tarhun: Object.freeze({ id: "tarhun", engineId: "storm-throne-1", modes: MODES, betLevels: BET_LEVELS, maxMultiplier: 5000, expectedRtp: Object.freeze({ standard: 0.965, ante: 0.966, buy: 0.962 }) }),
  ebru: Object.freeze({ id: "ebru", engineId: "ebru-ink-1", modes: MODES, betLevels: BET_LEVELS, maxMultiplier: 10000, expectedRtp: Object.freeze({ standard: 0.957, ante: 0.95, buy: 0.954 }) }),
  cezeri: Object.freeze({ id: "cezeri", engineId: "cezeri-gears-1", modes: MODES, betLevels: BET_LEVELS, maxMultiplier: 10000, expectedRtp: Object.freeze({ standard: 0.955, ante: 0.953, buy: 0.957 }) }),
  asena: Object.freeze({ id: "asena", engineId: "asena-stars-1", modes: MODES, betLevels: BET_LEVELS, maxMultiplier: 5000, expectedRtp: Object.freeze({ standard: 0.952, ante: 0.943, buy: 0.958 }) }),
  damla: Object.freeze({ id: "damla", engineId: "damla-terraces-1", modes: DAMLA_MODES, betLevels: BET_LEVELS, maxMultiplier: 1000, expectedRtp: DAMLA_EXPECTED_RTP }),
  goreme: Object.freeze({ id: "goreme", engineId: "goreme-balloons-1", modes: MODES, betLevels: BET_LEVELS, maxMultiplier: 10000, expectedRtp: Object.freeze({ standard: 0.963, ante: 0.954, buy: 0.959 }) }),
});

/** Own-property lookup only ("__proto__", "constructor" and friends are not games). */
export function slotGameMeta(id: unknown): SlotGameMeta | null {
  return typeof id === "string" && Object.hasOwn(SLOT_GAME_META, id) ? SLOT_GAME_META[id as SlotGameId] : null;
}
