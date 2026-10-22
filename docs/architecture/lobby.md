# Lobby and game registry

Status: 21 October 2026. Code: `apps/web/lib/lobby/*`, `apps/web/components/lobby/*`, `apps/web/components/game-info-strip.tsx`. The lobby is served at `/` and `/games`.

## One registry

`apps/web/lib/lobby/games.ts` is the only list of games. The sidebar, the top-bar search, the lobby rows, the category tiles and grids (`?c=`), "recently played", favorites, the hero carousel, the info strip under each game and the "Similar games" row all read it. It holds static descriptors only. It never imports an engine or `@sollish/protocol`, so the shell ships no game code.

Facts derived from the registry:
- `lib/lobby/stats.ts` → `lobbyStats(id)`: RTP, max win, volatility, pool fee. Slot max win comes from the engine-free `SLOT_GAME_META` (`@sollish/protocol`). Slot RTP and stdDev are literal copies of each engine's evidence constant (standard mode), and `tests/lobby.test.ts` fails when a copy drifts. These are simulated DEMO estimates, not certified figures, and the UI says so.
- `lib/lobby/posters.ts` → `poster(id, variant)`: hashed key-art files.
- Helpers: `gamesIn(category, favorites)`, `similarGames(id)` (same kind first, then registry order, up to 6), `inCategory`, `gameForPath`, `searchText`.

Categories (`LOBBY_CATEGORIES`): `slots`, `live` and `instant` follow `kind`; `new` follows `isNew`; `fair` follows `provablyFair`; `favorites` follows the player's list. The tiles and the chips link to `?c=<category>`.

## Adding a game to the lobby

1. **Route.** Create `app/game/<id>/page.tsx` (or `app/live/<id>/page.tsx` for a shared LIVE game). Pages under `app/game/` get the `slotKit` and `lobby` messages and the "Similar games" row from `app/game/layout.tsx`.
2. **Registry entry** in `lib/lobby/games.ts`. Add the id to `LOBBY_GAME_IDS` (its position sets the sidebar order) and an entry to `LOBBY_GAMES`:

   | field | meaning |
   |---|---|
   | `id` | lower-case id, the same one used in `common.games.<id>` and the poster file names |
   | `href` | the route from step 1 |
   | `kind` | `slot`, `live` or `instant` (sets the category and the lobby row) |
   | `icon` | a name in `components/icons.tsx` (add an original 24×24 stroke icon if none fits) |
   | `short` | untranslated brand name for the sidebar and search |
   | `released` | first evidence date (`ops/evidence/<id>-<date>`) |
   | `isNew` | shows the "New" badge and puts the game in the New row and category |
   | `provablyFair` | `true` only if the player can re-compute the result (for example through `/verify`); browser-random practice games are `false` |
   | `hero` | slide index in the hero carousel, or `null` (needs `wide` and `narrow` posters) |
   | `tone` | two placeholder gradient colours shown while the poster loads |
   | `keywords` | extra search words (themes, in English and Turkish without diacritics) |
3. **Stats** in `lib/lobby/stats.ts`. For a slot, register the game in `SLOT_GAME_META` (protocol, engine-free) and copy the engine evidence `standard.rtp` and `standard.stdDev` into `SLOT_STANDARD_RTP`. Extend the RTP test in `tests/lobby.test.ts` with the engine constant. For a non-slot game, add an explicit `case` to `lobbyStats` (use `null` for anything without a real source). Never invent a number.
4. **Posters.** Add the game's own art to `/lab/lobby-posters` (`components/lobby/poster-lab.tsx`), then run `apps/web/scripts/lobby-posters.mjs`. It writes `public/images/lobby/<id>-{tile,wide,narrow,land}.webp` and updates `posters.generated.ts`. Only `tile` (360×480) is required. Art must be fully original: no other studio's brand, logo, colours, imagery or copy, and no real people.
5. **i18n** (9 locales, `en de pt fr it es tr zh ko`, key parity checked by `tests/i18n.test.ts`):
   - `messages/<locale>/common.json`: `games.<id>` (display title).
   - `messages/<locale>/lobby.json`: `cards.<id>.tagline`, `cards.<id>.text`, `cards.<id>.type`.
   - The game's own namespace, following `docs/architecture/i18n.md`.
6. **Info strip.** Render `<GameInfoStrip id="<id>" />` directly under the game table (slots: after `<SessionBar>`; see `components/storm/tarhun-game.tsx`). It shows "Sollish Original", the RTP and max win only when `lobbyStats` has them, the pool fee, the provably-fair link to `/verify` (or the "not provably fair" note), DEMO, and the "simulated, not certified" line.
7. **Tests.**
   - `tests/lobby.test.ts` already fails if a `/game/*` page is missing from the registry, lacks a `GameInfoStrip`, or is missing `common.games` or `lobby.cards` copy in any locale. Update the category counts it asserts (for example `inCategory(g, 'slots')` = 6) and the hero order.
   - Browser: `tests/browser/lobby.spec.ts` asserts row and category counts (Originals 6, slots 6, instant 3, new 6, fair 8, live 1), so update them. `tests/browser/game-info.spec.ts` has one row per game.
   - Run `typecheck`, `pnpm --filter @sollish/web test`, and the lobby, game-info and i18n specs on `next dev`, one spec at a time.

## Live card

The Ringside card shows a "LIVE" status badge only. The arena snapshot carries `online` and `participants` (`RingSnapshot`), but only clients connected to the arena WebSocket receive them. A lobby connection would use admission slots and keep the arena advancing rounds. No public, read-only audience endpoint exists, so the lobby shows no viewer number. If one is added later (for example a cached count on `/v1/public/status`), show it only from that source, and hide it when the source is unavailable.

## Limits

RTP and volatility are simulated DEMO estimates and are not certified. Crash and Coinflip practice uses browser randomness and is not provably fair. Translations were written by hand and have not had a native-speaker review.
