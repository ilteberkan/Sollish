/** SlotWallet: one Durable Object per DEMO slot session (name `slot:<sha256(token)>`), SQLite storage.
 * Holds the DEMO balance, the ledger, the round records and the server-seed state. Authoritative text:
 * docs/architecture/slot-rgs.md.
 *
 * Order of a round (POST /v1/slots/:game/rounds), all inside this single-threaded object:
 *   1. token hash, session expiry, request rate (memory) and one-request-at-a-time (SESSION_BUSY otherwise);
 *   2. strict body; the same idempotencyKey returns the stored receipt (same bytes), a different body -> 409;
 *   3. durable round rate (4/s, 600/min), bet level, mode, integer cost, exposure, round cap, balance;
 *   4. seedHex = HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)[0..16), engine resolves the whole round;
 *   5. ONE SQLite transaction re-reads the session/seed/nonce, debits the cost, credits the payout, writes the round and
 *      the ledger row and advances the nonce. Any failure rolls all of it back; nothing is returned before commit.
 * Server seeds and the signing key never leave storage/env except a seed explicitly revealed by a rotation.
 */
import { DurableObject } from "cloudflare:workers";
import {
  SLOT_FAIR_VERSION, SLOT_ROUND_ID_PATTERN, deriveSeedHex, slotBytesToHex, slotGame, slotReceiptMessage, slotReplayMessage, slotServerSeedHash,
  type SlotGameDefinition, type SlotReceiptFields, type SlotRoundSummary,
} from "@sollish/protocol";
import { SLOT_LIMITS, SlotError, admitBet, errorResponseFor, parseExactObject, parseRoundBody, rtpMinRounds, signText, signingSecret, slotErrorResponse, slotJson, timingSafeEqualHex, type SlotEnv, type SlotSignature } from "./slots";
import { rtpAlert } from "./slot-stats";
import { replayFields, type SlotReplayRecord } from "./slot-records";

type SessionRow = { token_hash: string; balance: number; seed_id: number; rounds: number; rotations: number; shares: number; created_at: number; last_seen: number };
type SeedRow = { id: number; seed: string; hash: string; next_nonce: number; created_at: number; revealed_at: number | null };
type RoundRow = { round_id: string; idem: string; fingerprint: string; game: string; engine: string; mode: string; bet: number; cost: number; payout: number; total: number; seed_id: number; nonce: number; client_seed: string; seed_hex: string; balance_after: number; at: number };
type StatsRow = { game: string; mode: string; rounds: number; cost: number; payout: number; cost_sq: number; max_payout: number; pending_rounds: number; pending_cost: number; pending_payout: number; pending_cost_sq: number; pending_max_payout: number; alert_rounds: number };

export interface SlotReceipt {
  v: 1; roundId: string; game: string; engineId: string; mode: string; betCents: number; costCents: number; payoutCents: number; totalHundredths: number;
  /** Session balance right after this round committed. */
  balanceCents: number; at: number;
  fair: { version: typeof SLOT_FAIR_VERSION; serverSeedHash: string; clientSeed: string; nonce: number; seedHex: string };
  signature: SlotSignature;
  /** Full engine output for presentation (every spin, step and grid). */
  round: SlotRoundSummary;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS slot_session (singleton INTEGER PRIMARY KEY CHECK(singleton=1), token_hash TEXT NOT NULL, balance INTEGER NOT NULL CHECK(balance>=0), seed_id INTEGER NOT NULL, rounds INTEGER NOT NULL, rotations INTEGER NOT NULL, shares INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS slot_seeds (id INTEGER PRIMARY KEY, seed TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, next_nonce INTEGER NOT NULL CHECK(next_nonce>=0), created_at INTEGER NOT NULL, revealed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS slot_rounds (round_id TEXT PRIMARY KEY, idem TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, game TEXT NOT NULL, engine TEXT NOT NULL, mode TEXT NOT NULL, bet INTEGER NOT NULL CHECK(bet>0), cost INTEGER NOT NULL CHECK(cost>0), payout INTEGER NOT NULL CHECK(payout>=0), total INTEGER NOT NULL CHECK(total>=0), seed_id INTEGER NOT NULL, nonce INTEGER NOT NULL CHECK(nonce>=0), client_seed TEXT NOT NULL, seed_hex TEXT NOT NULL, balance_after INTEGER NOT NULL CHECK(balance_after>=0), at INTEGER NOT NULL, UNIQUE(seed_id, nonce))`,
  `CREATE INDEX IF NOT EXISTS slot_rounds_at ON slot_rounds(at)`,
  `CREATE INDEX IF NOT EXISTS slot_rounds_game ON slot_rounds(game, at)`,
  `CREATE TABLE IF NOT EXISTS slot_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('grant','round','reset')), round_id TEXT, debit INTEGER NOT NULL CHECK(debit>=0), credit INTEGER NOT NULL CHECK(credit>=0), balance_after INTEGER NOT NULL CHECK(balance_after>=0), at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS slot_stats (game TEXT NOT NULL, mode TEXT NOT NULL, rounds INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0, payout INTEGER NOT NULL DEFAULT 0, cost_sq REAL NOT NULL DEFAULT 0, max_payout INTEGER NOT NULL DEFAULT 0, pending_rounds INTEGER NOT NULL DEFAULT 0, pending_cost INTEGER NOT NULL DEFAULT 0, pending_payout INTEGER NOT NULL DEFAULT 0, pending_cost_sq REAL NOT NULL DEFAULT 0, pending_max_payout INTEGER NOT NULL DEFAULT 0, alert_rounds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(game, mode))`,
  `CREATE TABLE IF NOT EXISTS slot_shares (round_id TEXT PRIMARY KEY, seed_id INTEGER NOT NULL)`,
];
const fingerprint = (game: string, betCents: number, mode: string, clientSeed: string) => `${game}|${betCents}|${mode}|${clientSeed}`;

export class SlotWallet extends DurableObject<SlotEnv> {
  private active = false;
  private schemaReady = false;
  private window = { start: 0, count: 0 };

  // No schema in the constructor: a well-formed but unknown token must not leave storage behind.
  private hasSchema(): boolean {
    if (!this.schemaReady) this.schemaReady = this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='slot_session'").toArray().length > 0;
    return this.schemaReady;
  }
  private migrate(): void { for (const statement of SCHEMA) this.ctx.storage.sql.exec(statement); this.schemaReady = true; }
  private query<T extends Record<string, SqlStorageValue>>(sql: string, ...values: SqlStorageValue[]): T[] { return this.ctx.storage.sql.exec<T>(sql, ...values).toArray(); }
  private exec(sql: string, ...values: SqlStorageValue[]): void { this.ctx.storage.sql.exec(sql, ...values); }
  private sessionRow(): SessionRow | null { return this.query<SessionRow>("SELECT * FROM slot_session WHERE singleton=1")[0] ?? null; }
  private seedRow(id: number): SeedRow | null { return this.query<SeedRow>("SELECT * FROM slot_seeds WHERE id=?", id)[0] ?? null; }
  private roundByIdem(key: string): RoundRow | null { return this.query<RoundRow>("SELECT * FROM slot_rounds WHERE idem=?", key)[0] ?? null; }

  /** Engine seed of one round. A method (not inlined) so a local test fixture can hold a round in flight. */
  protected deriveRoundSeed(serverSeedHex: string, clientSeed: string, nonce: number): Promise<string> { return deriveSeedHex(serverSeedHex, clientSeed, nonce); }

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    if (now - this.window.start >= 1000) this.window = { start: now, count: 0 };
    this.window.count++;
    if (this.window.count > SLOT_LIMITS.requestsPerSecond) return slotErrorResponse("RATE_LIMITED", 1);
    // One request per session at a time: a second one is refused, never queued behind a debit.
    if (this.active) return slotErrorResponse("SESSION_BUSY", 1);
    this.active = true;
    try { return await this.dispatch(request); } catch (error) { return errorResponseFor(error); } finally { this.active = false; }
  }

  private async dispatch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname.slice(1);
    const tokenHash = request.headers.get("x-slot-token-hash") ?? "";
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new SlotError("AUTH_INVALID");
    const text = await request.text();
    if (text.length > SLOT_LIMITS.bodyBytes) throw new SlotError("MESSAGE_TOO_LARGE");
    const now = Date.now();
    if (op === "create") return this.create(tokenHash, text, now);
    const session = await this.requireSession(tokenHash, now);
    switch (op) {
      case "round": return this.round(session, request.headers.get("x-slot-game") ?? "", text, now);
      case "last": this.noBody(text); return this.last(session, request.headers.get("x-slot-game") ?? "");
      case "state": this.noBody(text); return slotJson(this.state(session, now));
      case "history": this.noBody(text); return slotJson(this.history(session));
      case "rotate": parseExactObject(text, []); return this.rotate(session, now);
      case "reset": parseExactObject(text, []); return this.reset(now);
      case "share": return this.share(session, text);
      default: throw new SlotError("NOT_FOUND");
    }
  }
  private noBody(text: string): void { if (text !== "") throw new SlotError("INVALID_MESSAGE"); }

  private async requireSession(tokenHash: string, now: number): Promise<SessionRow> {
    if (!this.hasSchema()) throw new SlotError("AUTH_INVALID");
    const session = this.sessionRow();
    if (!session || !timingSafeEqualHex(session.token_hash, tokenHash)) throw new SlotError("AUTH_INVALID");
    if (now >= session.last_seen + SLOT_LIMITS.sessionIdleMs) { await this.wipe(); throw new SlotError("SESSION_EXPIRED"); }
    if (now - session.last_seen >= 60_000) { this.exec("UPDATE slot_session SET last_seen=? WHERE singleton=1", now); session.last_seen = now; }
    return session;
  }
  private async wipe(): Promise<void> { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); this.schemaReady = false; }

  private async create(tokenHash: string, text: string, now: number): Promise<Response> {
    parseExactObject(text, []);
    if (this.hasSchema() && this.sessionRow()) throw new SlotError("SESSION_LIMIT");
    const seed = slotBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await slotServerSeedHash(seed);
    this.migrate();
    this.ctx.storage.transactionSync(() => {
      this.exec("INSERT INTO slot_seeds(id, seed, hash, next_nonce, created_at) VALUES(1, ?, ?, 0, ?)", seed, hash, now);
      this.exec("INSERT INTO slot_session(singleton, token_hash, balance, seed_id, rounds, rotations, shares, created_at, last_seen) VALUES(1, ?, ?, 1, 0, 0, 0, ?, ?)", tokenHash, SLOT_LIMITS.startBalanceCents, now, now);
      this.exec("INSERT INTO slot_ledger(kind, round_id, debit, credit, balance_after, at) VALUES('grant', NULL, 0, ?, ?, ?)", SLOT_LIMITS.startBalanceCents, SLOT_LIMITS.startBalanceCents, now);
    });
    await this.ctx.storage.sync();
    await this.scheduleAlarm(now);
    return slotJson({ v: 1, balanceCents: SLOT_LIMITS.startBalanceCents, serverSeedHash: hash, nonce: 0, expiresAt: now + SLOT_LIMITS.sessionIdleMs, signature: signingSecret(this.env).kind }, 201);
  }

  private limitRounds(now: number): void {
    const second = this.query<{ n: number }>("SELECT COUNT(*) AS n FROM slot_rounds WHERE at > ?", now - 1000)[0]!.n;
    if (second >= SLOT_LIMITS.roundsPerSecond) throw new SlotError("RATE_LIMITED", 1);
    const minute = this.query<{ n: number; oldest: number | null }>("SELECT COUNT(*) AS n, MIN(at) AS oldest FROM slot_rounds WHERE at > ?", now - 60_000)[0]!;
    if (minute.n >= SLOT_LIMITS.roundsPerMinute) throw new SlotError("RATE_LIMITED", ((minute.oldest ?? now) + 60_000 - now) / 1000);
  }

  private async round(session: SessionRow, gameId: string, text: string, now: number): Promise<Response> {
    const game = slotGame(gameId);
    if (!game) throw new SlotError("UNKNOWN_GAME");
    const body = parseRoundBody(text);
    const print = fingerprint(game.id, body.betCents, body.mode, body.clientSeed);
    // Retry first: the original receipt comes back even if the balance or the rate would refuse a new round now.
    const prior = this.roundByIdem(body.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== print) throw new SlotError("IDEMPOTENCY_CONFLICT");
      return slotJson(await this.receipt(prior), 200, { "Idempotent-Replayed": "true" });
    }
    this.limitRounds(now);
    const cost = admitBet(game, body.betCents, body.mode);
    if (session.rounds >= SLOT_LIMITS.maxRoundsPerSession) throw new SlotError("SESSION_LIMIT");
    if (cost > session.balance) throw new SlotError("INSUFFICIENT_BALANCE");
    const seed = this.seedRow(session.seed_id);
    if (!seed || seed.revealed_at !== null) throw new SlotError("SERVICE_UNAVAILABLE");
    const nonce = seed.next_nonce;
    const seedHex = await this.deriveRoundSeed(seed.seed, body.clientSeed, nonce);
    const round = this.resolve(game, seedHex, body.betCents, body.mode, cost);
    const roundId = slotBytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const row = this.ctx.storage.transactionSync((): RoundRow => {
      // Everything the decision used is read again inside the transaction (no TOCTOU across the await above).
      const current = this.sessionRow(), currentSeed = current ? this.seedRow(current.seed_id) : null;
      if (!current || !currentSeed || current.seed_id !== seed.id || currentSeed.next_nonce !== nonce || currentSeed.revealed_at !== null || this.roundByIdem(body.idempotencyKey)) throw new SlotError("SESSION_BUSY");
      if (current.balance < cost) throw new SlotError("INSUFFICIENT_BALANCE");
      const balanceAfter = current.balance - cost + round.payoutCents;
      if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) throw new SlotError("SERVICE_UNAVAILABLE");
      const row: RoundRow = { round_id: roundId, idem: body.idempotencyKey, fingerprint: print, game: game.id, engine: game.engineId, mode: body.mode, bet: body.betCents, cost, payout: round.payoutCents, total: round.totalHundredths, seed_id: seed.id, nonce, client_seed: body.clientSeed, seed_hex: seedHex, balance_after: balanceAfter, at: now };
      this.exec("INSERT INTO slot_rounds(round_id, idem, fingerprint, game, engine, mode, bet, cost, payout, total, seed_id, nonce, client_seed, seed_hex, balance_after, at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        row.round_id, row.idem, row.fingerprint, row.game, row.engine, row.mode, row.bet, row.cost, row.payout, row.total, row.seed_id, row.nonce, row.client_seed, row.seed_hex, row.balance_after, row.at);
      this.exec("INSERT INTO slot_ledger(kind, round_id, debit, credit, balance_after, at) VALUES('round', ?, ?, ?, ?, ?)", roundId, cost, round.payoutCents, balanceAfter, now);
      this.exec("UPDATE slot_session SET balance=?, rounds=rounds+1, last_seen=? WHERE singleton=1", balanceAfter, now);
      this.exec("UPDATE slot_seeds SET next_nonce=next_nonce+1 WHERE id=? AND next_nonce=?", seed.id, nonce);
      this.exec(`INSERT INTO slot_stats(game, mode, rounds, cost, payout, cost_sq, max_payout, pending_rounds, pending_cost, pending_payout, pending_cost_sq, pending_max_payout) VALUES(?,?,1,?,?,?,?,1,?,?,?,?)
        ON CONFLICT(game, mode) DO UPDATE SET rounds=rounds+1, cost=cost+excluded.cost, payout=payout+excluded.payout, cost_sq=cost_sq+excluded.cost_sq, max_payout=MAX(max_payout, excluded.max_payout),
        pending_rounds=pending_rounds+1, pending_cost=pending_cost+excluded.cost, pending_payout=pending_payout+excluded.payout, pending_cost_sq=pending_cost_sq+excluded.cost_sq, pending_max_payout=MAX(pending_max_payout, excluded.max_payout)`,
        game.id, body.mode, cost, round.payoutCents, cost * cost, round.payoutCents, cost, round.payoutCents, cost * cost, round.payoutCents);
      return row;
    });
    await this.ctx.storage.sync();
    // Monitoring and scheduling never turn a committed round into an error (a retry would still return it).
    try { this.sessionRtpCheck(game.id, body.mode); await this.scheduleAlarm(now); } catch { /* next round or alarm retries */ }
    return slotJson(await this.receipt(row, round));
  }

  /** Runs the engine and refuses any result outside the game's declared bounds. */
  private resolve(game: SlotGameDefinition, seedHex: string, betCents: number, mode: string, cost: number): SlotRoundSummary {
    let round: SlotRoundSummary;
    try { round = game.play(seedHex, betCents, mode); } catch { throw new SlotError("INVALID_BET"); }
    const cap = betCents * game.maxMultiplier;
    if (round.engine !== game.engineId || round.seedHex !== seedHex || round.betCents !== betCents || round.mode !== mode || round.costCents !== cost
      || !Number.isSafeInteger(round.payoutCents) || round.payoutCents < 0 || round.payoutCents > cap
      || !Number.isSafeInteger(round.totalHundredths) || round.totalHundredths < 0 || round.totalHundredths > game.maxMultiplier * 100) throw new SlotError("SERVICE_UNAVAILABLE");
    return round;
  }

  /** Same row -> same bytes (stored balance/time, deterministic engine and HMAC). */
  private async receipt(row: RoundRow, computed?: SlotRoundSummary): Promise<SlotReceipt> {
    const game = slotGame(row.game);
    if (!game || game.engineId !== row.engine) throw new SlotError("ENGINE_RETIRED");
    const round = computed ?? game.play(row.seed_hex, row.bet, row.mode);
    if (round.payoutCents !== row.payout || round.totalHundredths !== row.total || round.costCents !== row.cost || round.seedHex !== row.seed_hex) throw new SlotError("SERVICE_UNAVAILABLE");
    const seed = this.seedRow(row.seed_id);
    if (!seed) throw new SlotError("SERVICE_UNAVAILABLE");
    const fields: SlotReceiptFields = { roundId: row.round_id, game: row.game, engineId: row.engine, mode: row.mode, betCents: row.bet, costCents: row.cost, payoutCents: row.payout, totalHundredths: row.total, seedHex: row.seed_hex, serverSeedHash: seed.hash, clientSeed: row.client_seed, nonce: row.nonce, balanceCents: row.balance_after, at: row.at };
    return {
      v: 1, roundId: row.round_id, game: row.game, engineId: row.engine, mode: row.mode, betCents: row.bet, costCents: row.cost, payoutCents: row.payout, totalHundredths: row.total,
      balanceCents: row.balance_after, at: row.at,
      fair: { version: SLOT_FAIR_VERSION, serverSeedHash: seed.hash, clientSeed: row.client_seed, nonce: row.nonce, seedHex: row.seed_hex },
      signature: await signText(this.env, slotReceiptMessage(fields)), round,
    };
  }

  private async last(session: SessionRow, gameId: string): Promise<Response> {
    const game = slotGame(gameId);
    if (!game) throw new SlotError("UNKNOWN_GAME");
    const row = this.query<RoundRow>("SELECT * FROM slot_rounds WHERE game=? ORDER BY at DESC, rowid DESC LIMIT 1", game.id)[0];
    const seed = this.seedRow(session.seed_id)!;
    return slotJson({ v: 1, last: row ? await this.receipt(row) : null, balanceCents: session.balance, serverSeedHash: seed.hash, nonce: seed.next_nonce });
  }

  private state(session: SessionRow, now: number) {
    const seed = this.seedRow(session.seed_id)!;
    const revealed = this.query<SeedRow>("SELECT * FROM slot_seeds WHERE revealed_at IS NOT NULL ORDER BY id DESC LIMIT ?", SLOT_LIMITS.revealedSeedsShown)
      .map(s => ({ serverSeed: s.seed, serverSeedHash: s.hash, nonces: s.next_nonce, revealedAt: s.revealed_at }));
    return { v: 1, balanceCents: session.balance, serverSeedHash: seed.hash, nonce: seed.next_nonce, rounds: session.rounds, expiresAt: Math.max(now, session.last_seen) + SLOT_LIMITS.sessionIdleMs, signature: signingSecret(this.env).kind, revealed };
  }

  private history(session: SessionRow) {
    const rows = this.query<RoundRow & { hash: string; seed: string; revealed_at: number | null }>(
      "SELECT r.*, s.hash AS hash, s.seed AS seed, s.revealed_at AS revealed_at FROM slot_rounds r JOIN slot_seeds s ON s.id = r.seed_id ORDER BY r.at DESC, r.rowid DESC LIMIT ?", SLOT_LIMITS.historyRows);
    const seed = this.seedRow(session.seed_id)!;
    return {
      v: 1, balanceCents: session.balance, serverSeedHash: seed.hash, nonce: seed.next_nonce,
      rounds: rows.map(r => ({
        roundId: r.round_id, game: r.game, engineId: r.engine, mode: r.mode, betCents: r.bet, costCents: r.cost, payoutCents: r.payout, totalHundredths: r.total, balanceCents: r.balance_after, at: r.at,
        fair: { version: SLOT_FAIR_VERSION, serverSeedHash: r.hash, clientSeed: r.client_seed, nonce: r.nonce, seedHex: r.seed_hex, serverSeed: r.revealed_at === null ? null : r.seed },
      })),
    };
  }

  private async rotate(session: SessionRow, now: number): Promise<Response> {
    if (session.rotations >= SLOT_LIMITS.maxRotationsPerSession) throw new SlotError("SESSION_LIMIT");
    const old = this.seedRow(session.seed_id);
    if (!old || old.revealed_at !== null) throw new SlotError("SERVICE_UNAVAILABLE");
    const fresh = slotBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const freshHash = await slotServerSeedHash(fresh);
    this.ctx.storage.transactionSync(() => {
      const current = this.sessionRow();
      if (!current || current.seed_id !== old.id) throw new SlotError("SESSION_BUSY");
      this.exec("UPDATE slot_seeds SET revealed_at=? WHERE id=? AND revealed_at IS NULL", now, old.id);
      this.exec("INSERT INTO slot_seeds(seed, hash, next_nonce, created_at) VALUES(?, ?, 0, ?)", fresh, freshHash, now);
      this.exec("UPDATE slot_session SET seed_id=last_insert_rowid(), rotations=rotations+1, last_seen=? WHERE singleton=1", now);
    });
    await this.ctx.storage.sync();
    // Rounds already shared become verifiable: republish them with the revealed seed (best effort, the player can re-share).
    for (const share of this.query<{ round_id: string }>("SELECT round_id FROM slot_shares WHERE seed_id=? LIMIT 100", old.id)) {
      const row = this.query<RoundRow>("SELECT * FROM slot_rounds WHERE round_id=?", share.round_id)[0];
      if (row) { try { await this.publish(await this.replayRecord(row)); } catch { /* re-share repairs it */ } }
    }
    return slotJson({ v: 1, revealed: { serverSeed: old.seed, serverSeedHash: old.hash, nonces: old.next_nonce, revealedAt: now }, serverSeedHash: freshHash, nonce: 0 });
  }

  private reset(now: number): Response {
    const balance = this.ctx.storage.transactionSync((): number => {
      const current = this.sessionRow()!;
      const start = SLOT_LIMITS.startBalanceCents;
      this.exec("INSERT INTO slot_ledger(kind, round_id, debit, credit, balance_after, at) VALUES('reset', NULL, ?, ?, ?, ?)", Math.max(0, current.balance - start), Math.max(0, start - current.balance), start, now);
      this.exec("UPDATE slot_session SET balance=?, last_seen=? WHERE singleton=1", start, now);
      return start;
    });
    return slotJson({ v: 1, balanceCents: balance });
  }

  private async replayRecord(row: RoundRow): Promise<SlotReplayRecord> {
    const seed = this.seedRow(row.seed_id);
    if (!seed) throw new SlotError("SERVICE_UNAVAILABLE");
    const revealed = seed.revealed_at !== null;
    const record: Omit<SlotReplayRecord, "signature"> = {
      v: 1, roundId: row.round_id, game: row.game, engineId: row.engine, mode: row.mode, betCents: row.bet, costCents: row.cost, payoutCents: row.payout, totalHundredths: row.total,
      fair: { version: SLOT_FAIR_VERSION, seedHex: row.seed_hex, serverSeedHash: seed.hash, nonce: row.nonce, serverSeed: revealed ? seed.seed : null, clientSeed: revealed ? row.client_seed : null },
    };
    return { ...record, signature: await signText(this.env, slotReplayMessage(replayFields(record))) };
  }
  private async publish(record: SlotReplayRecord): Promise<void> {
    const replay = this.env.SLOT_REPLAY;
    if (!replay) throw new SlotError("SERVICE_UNAVAILABLE");
    const response = await replay.get(replay.idFromName(`replay:${record.roundId.slice(0, 2)}`)).fetch("https://slot-replay.internal/put", { method: "POST", body: JSON.stringify({ record }) });
    if (!response.ok) throw new SlotError("SERVICE_UNAVAILABLE");
  }
  private async share(session: SessionRow, text: string): Promise<Response> {
    const body = parseExactObject(text, ["roundId"]);
    if (typeof body.roundId !== "string" || !SLOT_ROUND_ID_PATTERN.test(body.roundId)) throw new SlotError("INVALID_MESSAGE");
    const row = this.query<RoundRow>("SELECT * FROM slot_rounds WHERE round_id=?", body.roundId)[0];
    if (!row) throw new SlotError("NOT_FOUND");
    const known = this.query<{ n: number }>("SELECT COUNT(*) AS n FROM slot_shares WHERE round_id=?", row.round_id)[0]!.n > 0;
    if (!known && session.shares >= SLOT_LIMITS.maxSharesPerSession) throw new SlotError("SESSION_LIMIT");
    const record = await this.replayRecord(row);
    await this.publish(record);
    if (!known) this.ctx.storage.transactionSync(() => {
      this.exec("INSERT OR IGNORE INTO slot_shares(round_id, seed_id) VALUES(?, ?)", row.round_id, row.seed_id);
      this.exec("UPDATE slot_session SET shares=shares+1 WHERE singleton=1");
    });
    return slotJson({ v: 1, roundId: row.round_id, path: `/replay/${row.round_id}`, revealed: record.fair.serverSeed !== null });
  }

  /* ---------------------------------------------------------------- monitoring and expiry */
  private sessionRtpCheck(game: string, mode: string): void {
    const s = this.query<StatsRow>("SELECT * FROM slot_stats WHERE game=? AND mode=?", game, mode)[0];
    if (!s || (s.alert_rounds > 0 && s.rounds < s.alert_rounds * 2)) return;
    const alert = rtpAlert("session", game, mode, { rounds: s.rounds, costCents: s.cost, payoutCents: s.payout, costSquares: s.cost_sq }, rtpMinRounds(this.env));
    if (!alert) return;
    console.warn(JSON.stringify(alert));
    this.exec("UPDATE slot_stats SET alert_rounds=? WHERE game=? AND mode=?", s.rounds, game, mode);
  }
  private async scheduleAlarm(now: number): Promise<void> {
    const session = this.sessionRow(); if (!session) return;
    let desired = session.last_seen + SLOT_LIMITS.sessionIdleMs;
    const pending = this.env.SLOT_MONITOR && this.query<{ n: number }>("SELECT COUNT(*) AS n FROM slot_stats WHERE pending_rounds > 0")[0]!.n > 0;
    if (pending) desired = Math.min(desired, now + SLOT_LIMITS.monitorFlushMs);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > desired) await this.ctx.storage.setAlarm(Math.max(now + 1, desired));
  }
  /** Counters only, at least once (a lost acknowledgement can count a batch twice). Never on the round path. */
  private async flushStats(): Promise<void> {
    const monitor = this.env.SLOT_MONITOR; if (!monitor) return;
    const rows = this.query<StatsRow>("SELECT * FROM slot_stats WHERE pending_rounds > 0");
    if (!rows.length) return;
    const deltas = rows.map(r => ({ game: r.game, mode: r.mode, rounds: r.pending_rounds, cost: r.pending_cost, payout: r.pending_payout, costSq: r.pending_cost_sq, maxPayout: r.pending_max_payout }));
    let ok = false;
    try { ok = (await monitor.get(monitor.idFromName("global")).fetch("https://slot-monitor.internal/add", { method: "POST", body: JSON.stringify({ deltas }) })).ok; } catch { ok = false; }
    if (!ok) return;
    this.ctx.storage.transactionSync(() => {
      for (const d of deltas) this.exec(`UPDATE slot_stats SET pending_rounds=pending_rounds-?, pending_cost=pending_cost-?, pending_payout=pending_payout-?, pending_cost_sq=MAX(0, pending_cost_sq-?),
        pending_max_payout=CASE WHEN pending_rounds-?<=0 THEN 0 ELSE pending_max_payout END WHERE game=? AND mode=?`, d.rounds, d.cost, d.payout, d.costSq, d.rounds, d.game, d.mode);
    });
  }
  async alarm(): Promise<void> {
    if (!this.hasSchema()) return;
    const session = this.sessionRow(); if (!session) return;
    const now = Date.now();
    if (now >= session.last_seen + SLOT_LIMITS.sessionIdleMs) {
      if (this.active) { await this.ctx.storage.setAlarm(now + 1000); return; }
      await this.wipe(); return;
    }
    await this.flushStats();
    await this.scheduleAlarm(now);
  }
}
