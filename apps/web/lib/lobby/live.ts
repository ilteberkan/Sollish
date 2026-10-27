/**
 * Live casino tables of the lobby grid (888-style "Live Casino" tabs). Today only Ringside is live; a new live game is a
 * registry entry with kind 'live' and appears here with no lobby change. Facts come from code, never invented:
 * - bet range: the admission limits the server enforces (RINGSIDE_STAKE_CENTS, DEMO credit cents);
 * - host: Jev, the corner coach whose plans are hashed into the public decision log;
 * - viewer count and recent results: the lobby has no public HTTP feed (they reach only clients on the arena socket),
 *   so the card shows "shared match" and an empty-results chip instead of a number.
 */
import { LOBBY_GAMES, type LobbyGame } from './games';
import { RINGSIDE_STAKE_CENTS, lobbyStats } from './stats';

export const LIVE_TABS = ['featured', 'exclusive', 'new', 'pool'] as const;
export type LiveTab = (typeof LIVE_TABS)[number];

/** One recent result chip: the winning corner (red = KOR, white = AYAZ) or a draw. */
export type LiveResult = 'kor' | 'ayaz' | 'draw';

export interface LiveTable {
  readonly game: LobbyGame;
  /** Admission range per ticket in DEMO credit cents. */
  readonly stakeCents: Readonly<{ min: number; max: number }>;
  /** Recent results when a public feed exists; empty today (see file comment). */
  readonly results: readonly LiveResult[];
}

const STAKES: Readonly<Record<string, Readonly<{ min: number; max: number }>>> = { ringside: RINGSIDE_STAKE_CENTS };

export const LIVE_TABLES: readonly LiveTable[] = LOBBY_GAMES.filter(g => g.kind === 'live')
  .map(game => Object.freeze({ game, stakeCents: STAKES[game.id] ?? RINGSIDE_STAKE_CENTS, results: [] }));

export function inLiveTab(table: LiveTable, tab: LiveTab): boolean {
  switch (tab) {
    case 'featured': return true;
    case 'exclusive': return table.game.exclusive === true;
    case 'new': return table.game.isNew;
    case 'pool': return lobbyStats(table.game.id).poolFee !== null;
  }
}
