/** Registry of server-playable slot games (docs/architecture/slot-rgs.md). The RGS (apps/realtime) and the browser
 * (rounds, /verify, /replay) read the same entries, so a game plugs in by id with one entry here.
 *
 * Adding a game: its engine must be pure and deterministic in (seedHex, betCents, mode), integer-only, and must throw
 * RangeError for an unknown bet level or mode. Use a NEW id/engineId for any rule change; an accepted round keeps the
 * engine it was played with, and the server refuses to recompute a stored round whose engine id is no longer listed.
 */
import { CASCADE2_BET_LEVELS_CENTS, CASCADE2_ENGINE_ID, CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_MODES, CASCADE2_RTP, cascadeCostCents, playCascade2Round, type Cascade2Round, type CascadeMode } from "./cascade-2";
import { STORM_BET_LEVELS_CENTS, STORM_ENGINE_ID, STORM_MAX_WIN_MULTIPLIER, STORM_MODES, STORM_RTP, playStormRound, stormCostCents, type StormMode, type StormRound } from "./storm-throne";
import { EBRU_BET_LEVELS_CENTS, EBRU_ENGINE_ID, EBRU_MAX_WIN_MULTIPLIER, EBRU_MODES, EBRU_RTP, ebruCostCents, playEbruRound, type EbruMode, type EbruRound } from "./ebru";
import { CEZERI_BET_LEVELS_CENTS, CEZERI_ENGINE_ID, CEZERI_MAX_WIN_MULTIPLIER, CEZERI_MODES, CEZERI_RTP, cezeriCostCents, playCezeriRound, type CezeriMode, type CezeriRound } from "./cezeri";
import type { SlotRoundSummary, SlotVerifiableGame } from "./slot-fair";

export interface SlotModeRtp { rtp: number; stdDev: number }
export interface SlotGameDefinition<R extends SlotRoundSummary = SlotRoundSummary> extends SlotVerifiableGame<R> {
  /** URL-safe id used in /v1/slots/:game/... */
  id: string;
  engineId: string;
  modes: readonly string[];
  /** Allowed base bets in cents. */
  betLevels: readonly number[];
  /** Payout cap as a multiple of the base bet; the server refuses any engine result above it. */
  maxMultiplier: number;
  /** Cost in cents of one round of `mode` at `betCents`; throws RangeError for an invalid bet or mode. */
  cost(betCents: number, mode: string): number;
  /** Expected return / cost and standard deviation per round in cost units (simulation, not certified). */
  rtp: Readonly<Record<string, SlotModeRtp>>;
}

function rtpTable(table: Readonly<Record<string, { rtp: number; stdDev: number }>>): Readonly<Record<string, SlotModeRtp>> {
  const out: Record<string, SlotModeRtp> = {};
  for (const [mode, row] of Object.entries(table)) out[mode] = Object.freeze({ rtp: row.rtp, stdDev: row.stdDev });
  return Object.freeze(out);
}

export const CASCADE_SLOT: SlotGameDefinition<Cascade2Round> = Object.freeze({
  id: "cascade", engineId: CASCADE2_ENGINE_ID, modes: CASCADE2_MODES, betLevels: CASCADE2_BET_LEVELS_CENTS, maxMultiplier: CASCADE2_MAX_WIN_MULTIPLIER,
  play: (seedHex: string, betCents: number, mode: string) => playCascade2Round(seedHex, betCents, mode as CascadeMode),
  cost: (betCents: number, mode: string) => cascadeCostCents(betCents, mode as CascadeMode),
  rtp: rtpTable(CASCADE2_RTP),
});
export const TARHUN_SLOT: SlotGameDefinition<StormRound> = Object.freeze({
  id: "tarhun", engineId: STORM_ENGINE_ID, modes: STORM_MODES, betLevels: STORM_BET_LEVELS_CENTS, maxMultiplier: STORM_MAX_WIN_MULTIPLIER,
  play: (seedHex: string, betCents: number, mode: string) => playStormRound(seedHex, betCents, mode as StormMode),
  cost: (betCents: number, mode: string) => stormCostCents(betCents, mode as StormMode),
  rtp: rtpTable(STORM_RTP),
});

export const EBRU_SLOT: SlotGameDefinition<EbruRound> = Object.freeze({
  id: "ebru", engineId: EBRU_ENGINE_ID, modes: EBRU_MODES, betLevels: EBRU_BET_LEVELS_CENTS, maxMultiplier: EBRU_MAX_WIN_MULTIPLIER,
  play: (seedHex: string, betCents: number, mode: string) => playEbruRound(seedHex, betCents, mode as EbruMode),
  cost: (betCents: number, mode: string) => ebruCostCents(betCents, mode as EbruMode),
  rtp: rtpTable(EBRU_RTP),
});

export const CEZERI_SLOT: SlotGameDefinition<CezeriRound> = Object.freeze({
  id: "cezeri", engineId: CEZERI_ENGINE_ID, modes: CEZERI_MODES, betLevels: CEZERI_BET_LEVELS_CENTS, maxMultiplier: CEZERI_MAX_WIN_MULTIPLIER,
  play: (seedHex: string, betCents: number, mode: string) => playCezeriRound(seedHex, betCents, mode as CezeriMode),
  cost: (betCents: number, mode: string) => cezeriCostCents(betCents, mode as CezeriMode),
  rtp: rtpTable(CEZERI_RTP),
});

/** id -> game. Frozen; new games are added here (other engines register when they ship). */
export const SLOT_GAMES: Readonly<Record<string, SlotGameDefinition>> = Object.freeze({
  [CASCADE_SLOT.id]: CASCADE_SLOT as SlotGameDefinition,
  [TARHUN_SLOT.id]: TARHUN_SLOT as SlotGameDefinition,
  [EBRU_SLOT.id]: EBRU_SLOT as SlotGameDefinition,
  [CEZERI_SLOT.id]: CEZERI_SLOT as SlotGameDefinition,
});
export const SLOT_GAME_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Own-property lookup only ("__proto__", "constructor" and friends are not games). */
export function slotGame(id: unknown): SlotGameDefinition | null {
  if (typeof id !== "string" || !SLOT_GAME_ID_PATTERN.test(id) || !Object.hasOwn(SLOT_GAMES, id)) return null;
  return SLOT_GAMES[id] ?? null;
}
