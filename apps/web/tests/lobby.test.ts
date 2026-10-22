import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ASENA_RTP, CASCADE2_RTP, CEZERI_RTP, EBRU_RTP, SLOT_GAMES, SLOT_GAME_IDS, STORM_RTP } from '@sollish/protocol';
import { LOBBY_CATEGORIES, LOBBY_GAMES, LOBBY_GAME_BY_ID, LOBBY_GAME_IDS, foldSearch, gamesIn, similarGames, gameForPath, inCategory, isLobbyCategory, matchesQuery, pushRecent, searchText, toggleFavorite } from '../lib/lobby/games';
import { CRASH_DEMO, COINFLIP_DEMO, SLOT_STANDARD_RTP, lobbyStats, volatilityOf } from '../lib/lobby/stats';
import { POSTER_SIZES, poster } from '../lib/lobby/posters';
import { POSTER_VERSIONS } from '../lib/lobby/posters.generated';
import { LOBBY_HEAD_SCRIPT } from '../lib/lobby/keys';
import { grossPayout, sampleCrash } from '../lib/demo';

test('lobby RTP copies equal each engine’s evidence constant (standard mode) and max win equals the registry', () => {
  const engines = { cascade: CASCADE2_RTP, tarhun: STORM_RTP, ebru: EBRU_RTP, cezeri: CEZERI_RTP, asena: ASENA_RTP } as const;
  for (const id of SLOT_GAME_IDS) {
    assert.equal(SLOT_STANDARD_RTP[id].rtp, engines[id].standard.rtp, `${id} rtp`);
    assert.equal(SLOT_STANDARD_RTP[id].stdDev, engines[id].standard.stdDev, `${id} stdDev`);
    assert.equal(lobbyStats(id).maxWin, SLOT_GAMES[id]!.maxMultiplier, `${id} max win`);
    assert.equal(lobbyStats(id).rtp, engines[id].standard.rtp);
  }
});

test('Crash and Coinflip practice return 98 % as lib/demo.ts plays them', () => {
  // Crash: P(crash point >= m) = 0.98 / m, so a cash-out target m returns 0.98. The boundary unit hits m exactly.
  for (const m of [1.5, 2, 10, 50]) {
    const u = 1 - CRASH_DEMO.rtp / m;
    assert.equal(sampleCrash(u + 1e-12), m, `reaches ${m}`);
    assert.ok(sampleCrash(Math.max(0, u - 1e-6)) < m, `stops below ${m}`);
  }
  assert.equal(sampleCrash(0.999999999), CRASH_DEMO.maxMultiplier);
  // Coinflip: 50 % at x1.96 gross.
  assert.equal(grossPayout(10_000, COINFLIP_DEMO.maxMultiplier) * 0.5 / 10_000, COINFLIP_DEMO.rtp);
  assert.equal(lobbyStats('crash').houseEdge, 0.02);
  assert.equal(lobbyStats('coinflip').houseEdge, 0.02);
  assert.equal(lobbyStats('ringside').rtp, null);
  assert.equal(lobbyStats('ringside').houseEdge, null);
  for (const id of SLOT_GAME_IDS) assert.equal(lobbyStats(id).houseEdge, null, `${id} shows no derived house edge`);
  assert.equal(lobbyStats('ringside').poolFee, 0.02);
});

test('volatility bands follow the evidence standard deviation', () => {
  assert.equal(volatilityOf(0.98), 'low');
  assert.equal(volatilityOf(5), 'medium');
  assert.equal(volatilityOf(12.7), 'high');
  assert.equal(volatilityOf(22.1), 'veryHigh');
  assert.deepEqual(SLOT_GAME_IDS.map(id => lobbyStats(id).volatility), ['high', 'high', 'veryHigh', 'high', 'veryHigh']);
  assert.equal(lobbyStats('crash').volatility, 'player');
});

test('catalog: every game once, routes exist, categories partition by kind, provably fair excludes local practice', () => {
  assert.deepEqual([...LOBBY_GAMES.map(g => g.id)].sort(), [...LOBBY_GAME_IDS].sort());
  for (const game of LOBBY_GAMES) {
    const route = game.href.replace(/^\//, '');
    assert.ok(existsSync(join(import.meta.dirname, '../app', route, 'page.tsx')), `${game.href} has a page`);
    assert.equal(gameForPath(game.href), game);
  }
  assert.equal(LOBBY_GAMES.filter(g => inCategory(g, 'slots')).length, 5);
  assert.deepEqual(LOBBY_GAMES.filter(g => inCategory(g, 'live')).map(g => g.id), ['ringside']);
  assert.deepEqual(LOBBY_GAMES.filter(g => inCategory(g, 'instant')).map(g => g.id).sort(), ['coinflip', 'crash']);
  assert.ok(!inCategory(LOBBY_GAMES.find(g => g.id === 'crash')!, 'fair'));
  assert.deepEqual(LOBBY_GAMES.filter(g => g.hero !== null).sort((a, b) => a.hero! - b.hero!).map(g => g.id), ['asena', 'cezeri', 'ebru', 'tarhun']);
  assert.ok(!isLobbyCategory('__proto__') && isLobbyCategory('favorites'));
  assert.equal(gameForPath('/game/crash/extra'), null);
});

test('search folds case, diacritics and Turkish i; every word must match', () => {
  assert.equal(foldSearch('  CEZERİ  Fırtına '), 'cezeri firtina');
  const tarhun = LOBBY_GAMES.find(g => g.id === 'tarhun')!;
  const text = searchText(tarhun, 'Tarhun: Fırtına Tahtı', ['Slot']);
  assert.ok(matchesQuery(text, 'firtina'));
  assert.ok(matchesQuery(text, 'TARH slot'));
  assert.ok(matchesQuery(text, 'storm'));
  assert.ok(!matchesQuery(text, 'wolf'));
  assert.ok(matchesQuery(text, ''));
  assert.ok(matchesQuery(searchText(LOBBY_GAMES.find(g => g.id === 'asena')!, 'Asena：星狼'), '星狼'));
});

test('recent and favorites lists stay clean, unique and bounded', () => {
  assert.deepEqual(pushRecent(['crash', 'x', 'asena', 'crash'], 'asena'), ['asena', 'crash']);
  assert.equal(pushRecent(LOBBY_GAME_IDS, 'crash', 4).length, 4);
  assert.deepEqual(toggleFavorite(['ebru', 'bad'], 'asena'), ['ebru', 'asena']);
  assert.deepEqual(toggleFavorite(['ebru', 'asena'], 'ebru'), ['asena']);
  assert.match(LOBBY_HEAD_SCRIPT, /^try\{.*\}catch\(e\)\{\}$/);
});

test('every poster in the manifest exists with its hash and size; each game has a tile poster', () => {
  const dir = join(import.meta.dirname, '../public/images/lobby');
  for (const [key, version] of Object.entries(POSTER_VERSIONS)) {
    const bytes = readFileSync(join(dir, `${key}.webp`));
    assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 10), version, `${key} hash`);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
    assert.ok(bytes.length < 80 * 1024, `${key} stays small (${bytes.length} B)`);
  }
  for (const id of LOBBY_GAME_IDS) {
    const tile = poster(id, 'tile');
    assert.ok(tile, `${id} tile poster`);
    assert.deepEqual([tile.width, tile.height], [...POSTER_SIZES.tile]);
    assert.match(tile.src, /^\/images\/lobby\/[a-z]+-tile\.webp\?v=[0-9a-f]{10}$/);
  }
  for (const id of ['asena', 'cezeri', 'ebru', 'tarhun', 'ringside']) { assert.ok(poster(id, 'wide')); assert.ok(poster(id, 'narrow')); }
  assert.equal(poster('__proto__', 'tile'), null);
});

test('registry is complete: every /game/* page is listed, has i18n copy in all 9 locales and an info strip', () => {
  const pages = readdirSync(join(import.meta.dirname, '../app/game'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => `/game/${d.name}`);
  for (const href of pages) assert.ok(LOBBY_GAMES.some(g => g.href === href), `${href} is in lib/lobby/games.ts`);
  const components = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? components(join(dir, d.name)) : d.name.endsWith('.tsx') ? [readFileSync(join(dir, d.name), 'utf8')] : []);
  const source = components(join(import.meta.dirname, '../components')).join('\n');
  for (const game of LOBBY_GAMES) {
    if (game.href.startsWith('/game/')) assert.ok(source.includes(`<GameInfoStrip id="${game.id}"`), `${game.id} renders <GameInfoStrip id="${game.id}" />`);
  }
  for (const locale of ['en', 'de', 'pt', 'fr', 'it', 'es', 'tr', 'zh', 'ko']) {
    const common = JSON.parse(readFileSync(join(import.meta.dirname, `../messages/${locale}/common.json`), 'utf8'));
    const lobby = JSON.parse(readFileSync(join(import.meta.dirname, `../messages/${locale}/lobby.json`), 'utf8'));
    for (const id of LOBBY_GAME_IDS) {
      assert.equal(typeof common.games[id], 'string', `${locale} common.games.${id}`);
      for (const key of ['tagline', 'text', 'type']) assert.equal(typeof lobby.cards[id]?.[key], 'string', `${locale} lobby.cards.${id}.${key}`);
    }
  }
});

test('category lists and similar games come from the registry', () => {
  for (const c of LOBBY_CATEGORIES) if (c !== 'favorites') assert.ok(gamesIn(c).length > 0, c);
  assert.deepEqual(gamesIn('favorites', ['ebru', 'nope']).map(g => g.id), ['ebru']);
  for (const id of LOBBY_GAME_IDS) {
    const list = similarGames(id);
    assert.ok(!list.some(g => g.id === id), `${id} excludes itself`);
    assert.equal(new Set(list.map(g => g.id)).size, list.length);
    assert.ok(list.length <= 6 && list.length > 0);
    const sameKind = LOBBY_GAMES.filter(g => g.id !== id && g.kind === LOBBY_GAME_BY_ID[id].kind).length;
    assert.ok(list.slice(0, Math.min(sameKind, 6)).every(g => g.kind === LOBBY_GAME_BY_ID[id].kind), `${id} lists its own kind first`);
  }
  assert.deepEqual(similarGames('crash').map(g => g.id).slice(0, 1), ['coinflip']);
});
