import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ASENA_RTP, CASCADE2_RTP, CEZERI_RTP, DAMLA_EXACT_RTP, EBRU_RTP, GOREME_RTP, SLOT_GAMES, SLOT_GAME_IDS, STORM_RTP } from '@sollish/protocol';
import { LOBBY_GAMES, LOBBY_GAME_IDS, foldSearch, gameForPath, inCategory, isLobbyCategory, matchesQuery, pushRecent, searchText, toggleFavorite } from '../lib/lobby/games';
import { CRASH_DEMO, COINFLIP_DEMO, DAMLA_LOBBY, SLOT_STANDARD_RTP, lobbyStats, volatilityOf } from '../lib/lobby/stats';
import { POSTER_SIZES, poster } from '../lib/lobby/posters';
import { POSTER_VERSIONS } from '../lib/lobby/posters.generated';
import { LOBBY_HEAD_SCRIPT } from '../lib/lobby/keys';
import { grossPayout, sampleCrash } from '../lib/demo';

test('lobby RTP copies equal each engine’s evidence constant (standard mode) and max win equals the registry', () => {
  const engines = { cascade: CASCADE2_RTP, tarhun: STORM_RTP, ebru: EBRU_RTP, cezeri: CEZERI_RTP, asena: ASENA_RTP, goreme: GOREME_RTP } as const;
  for (const id of SLOT_GAME_IDS) {
    if (id === 'damla') continue; // instant game: no standard mode, checked below
    assert.equal(SLOT_STANDARD_RTP[id].rtp, engines[id].standard.rtp, `${id} rtp`);
    assert.equal(SLOT_STANDARD_RTP[id].stdDev, engines[id].standard.stdDev, `${id} stdDev`);
    assert.equal(lobbyStats(id).maxWin, SLOT_GAMES[id]!.maxMultiplier, `${id} max win`);
    assert.equal(lobbyStats(id).rtp, engines[id].standard.rtp);
  }
  // Damla: the tile shows the lowest exact mode RTP (medium-12, the default) and the registry cap; volatility is the player's choice.
  assert.equal(DAMLA_LOBBY.rtp, Math.min(...Object.values(DAMLA_EXACT_RTP)));
  assert.equal(DAMLA_LOBBY.rtp, DAMLA_EXACT_RTP['medium-12']);
  assert.deepEqual(lobbyStats('damla'), { rtp: DAMLA_LOBBY.rtp, maxWin: SLOT_GAMES.damla!.maxMultiplier, volatility: 'player', poolFee: null });
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
  assert.equal(lobbyStats('ringside').rtp, null);
  assert.equal(lobbyStats('ringside').poolFee, 0.02);
});

test('volatility bands follow the evidence standard deviation', () => {
  assert.equal(volatilityOf(0.98), 'low');
  assert.equal(volatilityOf(5), 'medium');
  assert.equal(volatilityOf(12.7), 'high');
  assert.equal(volatilityOf(22.1), 'veryHigh');
  assert.deepEqual(SLOT_GAME_IDS.map(id => lobbyStats(id).volatility), ['high', 'high', 'veryHigh', 'high', 'veryHigh', 'player', 'veryHigh']);
  assert.equal(lobbyStats('crash').volatility, 'player');
});

test('catalog: every game once, routes exist, categories partition by kind, provably fair excludes local practice', () => {
  assert.deepEqual([...LOBBY_GAMES.map(g => g.id)].sort(), [...LOBBY_GAME_IDS].sort());
  for (const game of LOBBY_GAMES) {
    const route = game.href.replace(/^\//, '');
    assert.ok(existsSync(join(import.meta.dirname, '../app', route, 'page.tsx')), `${game.href} has a page`);
    assert.equal(gameForPath(game.href), game);
  }
  assert.equal(LOBBY_GAMES.filter(g => inCategory(g, 'slots')).length, 6);
  assert.deepEqual(LOBBY_GAMES.filter(g => inCategory(g, 'live')).map(g => g.id), ['ringside']);
  assert.deepEqual(LOBBY_GAMES.filter(g => inCategory(g, 'instant')).map(g => g.id).sort(), ['coinflip', 'crash', 'damla']);
  assert.ok(!inCategory(LOBBY_GAMES.find(g => g.id === 'crash')!, 'fair'));
  assert.deepEqual(LOBBY_GAMES.filter(g => g.hero !== null).sort((a, b) => a.hero! - b.hero!).map(g => g.id), ['goreme', 'asena', 'cezeri', 'ebru', 'tarhun']);
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
  const damla = LOBBY_GAMES.find(g => g.id === 'damla')!;
  for (const q of ['plinko', 'drop', 'pamukkale', 'damla']) assert.ok(matchesQuery(searchText(damla, 'Damla: Pamukkale'), q), q);
  assert.equal(damla.kind, 'instant'); assert.ok(damla.isNew && damla.provablyFair && damla.original);
  const goreme = LOBBY_GAMES.find(g => g.id === 'goreme')!;
  for (const q of ['balloon', 'cappadocia', 'kapadokya', 'balon', 'ways', 'sky', 'göreme']) assert.ok(matchesQuery(searchText(goreme, 'Göreme: Dawn Balloons'), q), q);
  assert.equal(goreme.kind, 'slot'); assert.equal(goreme.hero, 0); assert.ok(goreme.isNew && goreme.provablyFair && !goreme.original);
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
  for (const id of ['goreme', 'asena', 'cezeri', 'ebru', 'tarhun', 'ringside', 'damla']) { assert.ok(poster(id, 'wide')); assert.ok(poster(id, 'narrow')); }
  assert.ok(poster('damla', 'land'));
  assert.equal(poster('__proto__', 'tile'), null);
});
