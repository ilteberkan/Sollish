import { DurableObject } from 'cloudflare:workers';
import { parseLiveClientFrame, type LivePublicRound } from '@sollish/protocol';
import { allowedOrigin } from './security';
import { ArenaError, LIVE_INITIAL_CENTS, LIVE_SESSION_MS, LIVE_MAX_SESSIONS, LIVE_MAX_TICKETS_PER_SESSION, LIVE_MAX_TICKETS_PER_ROUND, admitTicket, closeRound, finishRound, openRound, settleTicket, startFight, type ArenaSession, type ArenaTicket, type LiveArenaServerFrame } from './live-arena-state';

export interface LiveArenaEnv { ALLOWED_ORIGINS?: string; LIVE_ARENA_ENABLED?: string }
type Attachment = { sessionId: string | null; connectedAt: number; windowStart: number; count: number };
type SessionRow = { id: string; balance: number; expires: number };
type TicketRow = { session: string; round: string; client: string; side: 'kor' | 'ayaz'; amount: number; status: 'accepted' | 'settled'; payout: number };
const MAX_SOCKETS = 256, MAX_FRAME_BYTES = 10_240, MAX_SESSION_SOCKETS = 3, HANDSHAKE_MS = 10_000;
const hex = (bytes: Uint8Array) => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
const ticketFromRow = (row: TicketRow): ArenaTicket => ({ clientId: row.client, roundId: row.round, side: row.side, amountCents: row.amount, status: row.status, payoutCents: row.payout });
const sessionFromRow = (row: SessionRow): ArenaSession => ({ balanceCents: row.balance, expiresAtMs: row.expires });

/** A single bounded, server-authoritative practice room. No wallet, Supabase or on-chain claims.
 * SQLite transactions commit each command before any acknowledgement; hibernation restores from SQL.
 * The queue serializes async hashing/storage flushes as well as alarm and socket handlers.
 */
export class LiveArena extends DurableObject<LiveArenaEnv> {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: LiveArenaEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS arena_round (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS arena_sessions (id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance>=0), expires INTEGER NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS arena_tickets (session TEXT NOT NULL, round TEXT NOT NULL, client TEXT NOT NULL, side TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, payout INTEGER NOT NULL, PRIMARY KEY(session,client), UNIQUE(session,round))`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS arena_tickets_round ON arena_tickets(round,status)`);
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.pending.then(fn); this.pending = result.catch(() => undefined); return result;
  }
  private query<T extends Record<string, SqlStorageValue>>(query: string, ...values: SqlStorageValue[]): T[] { return this.ctx.storage.sql.exec<T>(query, ...values).toArray(); }
  private current(): LivePublicRound | null {
    const row = this.query<{ body: string }>('SELECT body FROM arena_round WHERE singleton=1')[0];
    return row ? JSON.parse(row.body) as LivePublicRound : null;
  }
  private saveRound(round: LivePublicRound): void { this.ctx.storage.sql.exec('INSERT INTO arena_round(singleton,body) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body', JSON.stringify(round)); }
  private session(id: string): SessionRow | null { return this.query<SessionRow>('SELECT id,balance,expires FROM arena_sessions WHERE id=?', id)[0] ?? null; }
  private ticket(id: string, client: string): TicketRow | null { return this.query<TicketRow>('SELECT * FROM arena_tickets WHERE session=? AND client=?', id, client)[0] ?? null; }
  private sockets(): WebSocket[] { return this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN); }
  private attachment(ws: WebSocket): Attachment { return ws.deserializeAttachment() as Attachment; }
  private send(ws: WebSocket, frame: LiveArenaServerFrame): void { try { ws.send(JSON.stringify(frame)); } catch { try { ws.close(1011, 'CONNECTION_CLOSED'); } catch { /* already closed */ } } }
  private publicSnapshot(now: number): Extract<LiveArenaServerFrame, { type: 'arena.snapshot' }> | null {
    const round = this.current(); if (!round) return null;
    if ((round.phase === 'open' || round.phase === 'closed') && round.winner !== null) throw new ArenaError('SERVICE_UNAVAILABLE');
    const ticketCount = this.query<{ count: number }>('SELECT COUNT(*) AS count FROM arena_tickets WHERE round=?', round.roundId)[0].count;
    return { v: 1, type: 'arena.snapshot', version: round.version, serverTimeMs: now, round, ticketCount };
  }
  private sendSnapshot(ws: WebSocket, now: number): void { const snapshot = this.publicSnapshot(now); if (snapshot) this.send(ws, snapshot); }
  private sendPrivate(ws: WebSocket): void {
    const id = this.attachment(ws).sessionId; if (!id) return;
    const session = this.session(id); if (!session) return;
    this.send(ws, { v: 1, type: 'arena.session', balanceCents: session.balance, expiresAtMs: session.expires });
    // Latest ticket survives reconnect even when the next round has already opened.
    const row = this.query<TicketRow>('SELECT * FROM arena_tickets WHERE session=? ORDER BY rowid DESC LIMIT 1', id)[0];
    if (row) this.send(ws, { v: 1, type: 'arena.ticket', ticket: ticketFromRow(row) });
  }
  private broadcast(now: number, changedSessions: ReadonlySet<string> = new Set()): void {
    // The public state/count is read once regardless of viewer count. Only affected ledgers are read.
    const snapshot = this.publicSnapshot(now); if (!snapshot) return;
    for (const ws of this.sockets()) {
      this.send(ws, snapshot);
      const id = this.attachment(ws).sessionId; if (id && changedSessions.has(id)) this.sendPrivate(ws);
    }
  }
  private cleanup(now: number): void {
    // Never delete a reserved ticket. Expired sessions are reclaimed after settlement, not refunded.
    this.ctx.storage.sql.exec(`DELETE FROM arena_tickets WHERE session IN (SELECT id FROM arena_sessions WHERE expires<=? AND NOT EXISTS(SELECT 1 FROM arena_tickets t WHERE t.session=arena_sessions.id AND t.status='accepted'))`, now);
    this.ctx.storage.sql.exec(`DELETE FROM arena_sessions WHERE expires<=? AND NOT EXISTS(SELECT 1 FROM arena_tickets t WHERE t.session=arena_sessions.id)`, now);
  }
  private async schedule(now: number): Promise<void> {
    const round = this.current(), sockets = this.sockets(); let when: number | null = null;
    if (round?.phase === 'open') when = round.closesAtMs;
    if (round?.phase === 'closed') when = now + 1000;
    if (round?.phase === 'fighting') when = round.resultAtMs;
    if (round?.phase === 'result' && sockets.length) when = round.nextRoundAtMs;
    for (const ws of sockets) {
      const attachment = this.attachment(ws), session = attachment.sessionId ? this.session(attachment.sessionId) : null;
      const expires = session?.expires ?? attachment.connectedAt + HANDSHAKE_MS;
      when = when === null ? expires : Math.min(when, expires);
    }
    if (when === null) await this.ctx.storage.deleteAlarm(); else await this.ctx.storage.setAlarm(Math.max(now + 1, when));
  }
  private async advance(now: number, openingConnection = false): Promise<void> {
    let round = this.current(), changed = false; const changedSessions = new Set<string>();
    if (!round) { round = openRound(null, now); this.ctx.storage.transactionSync(() => this.saveRound(round!)); await this.ctx.storage.sync(); changed = true; }
    if (round.phase === 'open' && now >= round.closesAtMs) {
      round = closeRound(round, now); this.ctx.storage.transactionSync(() => this.saveRound(round!));
      // Explicit durability boundary: randomness is not even drawn until CLOSED is persisted.
      await this.ctx.storage.sync(); changed = true;
    }
    if (round.phase === 'closed') {
      let winner: 'kor' | 'ayaz';
      try { winner = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'kor' : 'ayaz'; }
      catch { if (changed) this.broadcast(now); await this.schedule(now); return; }
      round = startFight(round, now, winner); this.ctx.storage.transactionSync(() => this.saveRound(round!)); await this.ctx.storage.sync(); changed = true;
    }
    if (round.phase === 'fighting' && round.resultAtMs !== null && now >= round.resultAtMs) {
      const finished = finishRound(round, now);
      this.ctx.storage.transactionSync(() => {
        const tickets = this.query<TicketRow>("SELECT * FROM arena_tickets WHERE round=? AND status='accepted'", finished.roundId);
        if (tickets.length > LIVE_MAX_TICKETS_PER_ROUND) throw new ArenaError('SERVICE_UNAVAILABLE');
        for (const row of tickets) {
          const session = this.session(row.session); if (!session) throw new ArenaError('SERVICE_UNAVAILABLE');
          const settled = settleTicket(ticketFromRow(row), finished.winner!, session.balance);
          this.ctx.storage.sql.exec('UPDATE arena_sessions SET balance=? WHERE id=?', settled.balanceCents, row.session);
          this.ctx.storage.sql.exec("UPDATE arena_tickets SET status='settled',payout=? WHERE session=? AND client=? AND status='accepted'", settled.ticket.payoutCents, row.session, row.client);
          changedSessions.add(row.session);
        }
        this.saveRound(finished);
      });
      round = finished; await this.ctx.storage.sync(); changed = true;
    }
    if (round.phase === 'result' && round.nextRoundAtMs !== null && now >= round.nextRoundAtMs && (openingConnection || this.sockets().length > 0)) {
      round = openRound(round, now); this.ctx.storage.transactionSync(() => this.saveRound(round!)); await this.ctx.storage.sync(); changed = true;
    }
    this.ctx.storage.transactionSync(() => this.cleanup(now));
    await this.ctx.storage.sync();
    if (changed) this.broadcast(now, changedSessions);
    await this.schedule(now);
  }
  fetch(request: Request): Promise<Response> { return this.exclusive(async () => {
    if (this.env.LIVE_ARENA_ENABLED !== 'true') return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
    if (!allowedOrigin(request.headers.get('Origin'), this.env)) return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || new URL(request.url).search) return Response.json({ code: 'INVALID_MESSAGE' }, { status: 400 });
    if (this.sockets().length >= MAX_SOCKETS) return Response.json({ code: 'CAPACITY' }, { status: 503 });
    try {
      const now = Date.now(); await this.advance(now, true);
      const pair = new WebSocketPair(), client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ sessionId: null, connectedAt: now, windowStart: now, count: 0 } satisfies Attachment);
      this.sendSnapshot(server, now); await this.schedule(now);
      return new Response(null, { status: 101, webSocket: client });
    } catch { return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 }); }
  }); }
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> { return this.exclusive(async () => {
    try {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_FRAME_BYTES) { ws.close(1009, 'MESSAGE_TOO_LARGE'); return; }
      const now = Date.now(), attachment = this.attachment(ws);
      if (!attachment.sessionId && now >= attachment.connectedAt + HANDSHAKE_MS) { ws.close(1008, 'SESSION_EXPIRED'); return; }
      if (now - attachment.windowStart >= 60_000) { attachment.windowStart = now; attachment.count = 0; }
      attachment.count++; ws.serializeAttachment(attachment);
      if (attachment.count > 40) { ws.close(1008, 'RATE_LIMITED'); return; }
      const frame = parseLiveClientFrame(raw); if (!frame) throw new ArenaError('INVALID_MESSAGE');
      // A delayed alarm cannot extend a wager's acceptance window.
      await this.advance(now);
      if (frame.type === 'ping') { this.send(ws, { v: 1, type: 'pong', serverTimeMs: now }); return; }
      if (frame.type === 'sync') { this.sendSnapshot(ws, now); this.sendPrivate(ws); return; }
      if (frame.type === 'session') {
        if (attachment.sessionId) throw new ArenaError('SESSION_ALREADY_SET');
        const token = frame.token ?? hex(crypto.getRandomValues(new Uint8Array(32)));
        const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
        let session = this.session(id);
        if (frame.token && !session) throw new ArenaError('SESSION_INVALID');
        if (session && session.expires <= now) throw new ArenaError('SESSION_EXPIRED');
        if (this.sockets().filter(s => this.attachment(s).sessionId === id).length >= MAX_SESSION_SOCKETS) throw new ArenaError('CAPACITY');
        if (!session) {
          this.ctx.storage.transactionSync(() => {
            if (this.query<{ count: number }>('SELECT COUNT(*) AS count FROM arena_sessions')[0].count >= LIVE_MAX_SESSIONS) throw new ArenaError('CAPACITY');
            this.ctx.storage.sql.exec('INSERT INTO arena_sessions(id,balance,expires) VALUES(?,?,?)', id, LIVE_INITIAL_CENTS, now + LIVE_SESSION_MS);
          });
          await this.ctx.storage.sync(); session = this.session(id)!;
        }
        attachment.sessionId = id; ws.serializeAttachment(attachment);
        this.send(ws, { v: 1, type: 'arena.session', ...(frame.token ? {} : { token }), balanceCents: session.balance, expiresAtMs: session.expires });
        this.sendPrivate(ws); this.sendSnapshot(ws, now); await this.schedule(now); return;
      }
      if (!attachment.sessionId) throw new ArenaError('SESSION_REQUIRED');
      const id = attachment.sessionId;
      let ticket: ArenaTicket | null = null, duplicate = false;
      this.ctx.storage.transactionSync(() => {
        const session = this.session(id), round = this.current(); if (!session || !round) throw new ArenaError('SESSION_INVALID');
        const existing = this.ticket(id, frame.clientId.toLowerCase());
        const alreadyBet = this.query<{ count: number }>('SELECT COUNT(*) AS count FROM arena_tickets WHERE session=? AND round=?', id, frame.roundId)[0].count > 0;
        const command = { clientId: frame.clientId.toLowerCase(), roundId: frame.roundId, side: frame.side, amountCents: frame.amountCents };
        const admitted = admitTicket(round, sessionFromRow(session), command, Date.now(), existing && ticketFromRow(existing), alreadyBet);
        ticket = admitted.ticket; duplicate = admitted.duplicate;
        if (duplicate) return;
        if (this.query<{ count: number }>('SELECT COUNT(*) AS count FROM arena_tickets WHERE session=?', id)[0].count >= LIVE_MAX_TICKETS_PER_SESSION || this.query<{ count: number }>('SELECT COUNT(*) AS count FROM arena_tickets WHERE round=?', round.roundId)[0].count >= LIVE_MAX_TICKETS_PER_ROUND) throw new ArenaError('CAPACITY');
        this.ctx.storage.sql.exec('INSERT INTO arena_tickets(session,round,client,side,amount,status,payout) VALUES(?,?,?,?,?,?,0)', id, frame.roundId, command.clientId, frame.side, frame.amountCents, 'accepted');
        this.ctx.storage.sql.exec('UPDATE arena_sessions SET balance=? WHERE id=?', admitted.balanceCents, id);
        this.saveRound({ ...round, version: round.version + 1 });
      });
      await this.ctx.storage.sync();
      this.send(ws, { v: 1, type: 'arena.ticket', ticket: ticket! });
      if (!duplicate) this.broadcast(Date.now(), new Set([id])); else this.sendPrivate(ws);
    } catch (e) {
      this.send(ws, { v: 1, type: 'arena.error', code: e instanceof ArenaError ? e.code : 'SERVICE_UNAVAILABLE' });
    }
  }); }
  webSocketClose(ws: WebSocket): Promise<void> { return this.exclusive(async () => { try { ws.close(1000, 'CLOSED'); } catch { /* closed */ } await this.schedule(Date.now()); }); }
  webSocketError(ws: WebSocket): Promise<void> { return this.webSocketClose(ws); }
  alarm(): Promise<void> { return this.exclusive(async () => {
    const now = Date.now();
    for (const ws of this.sockets()) {
      const attachment = this.attachment(ws), session = attachment.sessionId ? this.session(attachment.sessionId) : null;
      if (now >= (session?.expires ?? attachment.connectedAt + HANDSHAKE_MS)) ws.close(1008, 'SESSION_EXPIRED');
    }
    await this.advance(now);
  }); }
}
