/**
 * The lobby's game catalog: static descriptors only (no engine, no protocol import), so the shell (sidebar, search) and
 * the lobby share one list without shipping any game code. Display names come from `common.games.<id>`; RTP, max win
 * and volatility are computed on the server from the engines' evidence constants (lib/lobby/stats.ts).
 */
export const LOBBY_GAME_IDS = ['tarhun', 'ebru', 'cezeri', 'asena', 'cascade', 'ringside', 'crash', 'coinflip'] as const;
export type LobbyGameId = (typeof LOBBY_GAME_IDS)[number];

/** Lobby sections. `slots`/`live`/`instant` are kinds; `new`, `fair` and `favorites` are cross-cutting. */
export const LOBBY_CATEGORIES = ['all', 'slots', 'live', 'instant', 'new', 'fair', 'favorites'] as const;
export type LobbyCategory = (typeof LOBBY_CATEGORIES)[number];
export type LobbyKind = 'slot' | 'live' | 'instant';

export interface LobbyGame {
  readonly id: LobbyGameId;
  readonly href: string;
  readonly kind: LobbyKind;
  /** components/icons.tsx name. */
  readonly icon: string;
  /** Short brand name for compact places (sidebar, search): game names stay untranslated. */
  readonly short: string;
  /** First evidence date of the shipped engine (ops/evidence/<game>-<date>). */
  readonly released: string;
  /** Editorial "New" badge: the October 2026 slot releases. */
  readonly isNew: boolean;
  /** The result can be re-computed by the player: slots via /verify (server seed + client seed), Ringside via the
   * published seed hashes. The local Crash/Coinflip practice uses browser randomness and is NOT provably fair. */
  readonly provablyFair: boolean;
  /** Featured in the hero carousel (order = slide order). */
  readonly hero: number | null;
  /** Scene colours: the tile's placeholder gradient while the poster loads, and the hover glow. */
  readonly tone: readonly [string, string];
  /** Extra search words (English/Turkish themes); the localized title and category names are matched too. */
  readonly keywords: string;
}

const game = (g: LobbyGame) => Object.freeze(g);
export const LOBBY_GAMES: readonly LobbyGame[] = Object.freeze([
  game({ id: 'asena', href: '/game/asena', kind: 'slot', icon: 'stars', short: 'Asena', released: '2026-10-12', isNew: true, provablyFair: true, hero: 0, tone: ['#1b2a5c', '#0a1024'], keywords: 'wolf star constellation kurt yildiz cluster' }),
  game({ id: 'cezeri', href: '/game/cezeri', kind: 'slot', icon: 'gears', short: 'Cezeri', released: '2026-10-12', isNew: true, provablyFair: true, hero: 1, tone: ['#13505a', '#0b1a22'], keywords: 'wheel gear clock elephant cark disli saat' }),
  game({ id: 'ebru', href: '/game/ebru', kind: 'slot', icon: 'ink', short: 'Ebru', released: '2026-10-12', isNew: true, provablyFair: true, hero: 2, tone: ['#5a2a3a', '#1a0f18'], keywords: 'ink marbling flower murekkep cicek cluster' }),
  game({ id: 'tarhun', href: '/game/tarhun', kind: 'slot', icon: 'storm', short: 'Tarhun', released: '2026-10-12', isNew: true, provablyFair: true, hero: 3, tone: ['#24406a', '#0a1222'], keywords: 'storm lightning god firtina simsek tumble' }),
  game({ id: 'cascade', href: '/game/cascade', kind: 'slot', icon: 'candy', short: 'Candy Cascade', released: '2026-10-11', isNew: false, provablyFair: true, hero: null, tone: ['#4a2a6a', '#160f2a'], keywords: 'candy sweet tumble seker' }),
  game({ id: 'ringside', href: '/live/ringside', kind: 'live', icon: 'boxing', short: 'Ringside', released: '2026-10-09', isNew: false, provablyFair: true, hero: null, tone: ['#5a2414', '#0e1a26'], keywords: 'boxing fight live boks dovus canli pool' }),
  game({ id: 'crash', href: '/game/crash', kind: 'instant', icon: 'crash', short: 'Crash', released: '2026-10-01', isNew: false, provablyFair: false, hero: null, tone: ['#4a1e14', '#0d0f15'], keywords: 'multiplier cash out carpan cikis' }),
  game({ id: 'coinflip', href: '/game/coinflip', kind: 'instant', icon: 'coin', short: 'Coinflip', released: '2026-10-01', isNew: false, provablyFair: false, hero: null, tone: ['#123a46', '#0a1118'], keywords: 'coin heads tails yazi tura para' }),
]);

export const LOBBY_GAME_BY_ID: Readonly<Record<LobbyGameId, LobbyGame>> = Object.freeze(Object.fromEntries(LOBBY_GAMES.map(g => [g.id, g])) as Record<LobbyGameId, LobbyGame>);

export function isLobbyGameId(value: unknown): value is LobbyGameId {
  return typeof value === 'string' && (LOBBY_GAME_IDS as readonly string[]).includes(value);
}
export function isLobbyCategory(value: unknown): value is LobbyCategory {
  return typeof value === 'string' && (LOBBY_CATEGORIES as readonly string[]).includes(value);
}

/** The game whose page `pathname` is (exact route match), for "recently played". */
export function gameForPath(pathname: string): LobbyGame | null {
  return LOBBY_GAMES.find(g => g.href === pathname) ?? null;
}

/** Does a game belong to a category? `favorites` needs the player's list. */
export function inCategory(game: LobbyGame, category: LobbyCategory, favorites: readonly string[] = []): boolean {
  switch (category) {
    case 'all': return true;
    case 'slots': return game.kind === 'slot';
    case 'live': return game.kind === 'live';
    case 'instant': return game.kind === 'instant';
    case 'new': return game.isNew;
    case 'fair': return game.provablyFair;
    case 'favorites': return favorites.includes(game.id);
  }
}

/** Lower case, no diacritics, Turkish dotless/dotted i folded: "CEZERİ" and "fırtına" match "cezeri" and "firtina". */
export function foldSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Every word of the query must start a word of (or appear inside) the haystack. Empty query matches everything. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = foldSearch(query);
  if (!q) return true;
  const hay = foldSearch(haystack);
  return q.split(' ').every(word => hay.includes(word));
}

/** Search text for a game: its localized title, short name, category label, provider and keywords. */
export function searchText(game: LobbyGame, title: string, extra: readonly string[] = []): string {
  return [title, game.short, game.id, game.keywords, 'sollish', ...extra].join(' ');
}

/** Recently played: newest first, unique, known ids only, at most `limit`. */
export function pushRecent(list: readonly unknown[], id: LobbyGameId, limit = 8): LobbyGameId[] {
  return [id, ...list.filter((x): x is LobbyGameId => isLobbyGameId(x) && x !== id)].slice(0, limit);
}
export function toggleFavorite(list: readonly unknown[], id: LobbyGameId): LobbyGameId[] {
  const clean = list.filter(isLobbyGameId);
  return clean.includes(id) ? clean.filter(x => x !== id) : [...clean, id];
}
